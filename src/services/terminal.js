'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

// ─── Constantes de Configuración ──────────────────────────────────────────────
const DEFAULT_TIMEOUT_MS = 25000;           // 25 segundos máximo por defecto
const MAX_TIMEOUT_MS = 25000;               // Límite duro de timeout
const DEFAULT_MAX_STDOUT_BYTES = 50 * 1024; // 50 KB de stdout máximo
const DEFAULT_MAX_STDERR_BYTES = 25 * 1024; // 25 KB de stderr máximo
const TARGET_USER = 'petrov';
const TARGET_UID = 1002;
const TARGET_GID = 1002;

/**
 * Recopila los secretos configurados en el entorno para enmascaramiento.
 * NO almacena ni hardcodea claves. Las consulta dinámicamente de process.env.
 *
 * @param {string[]} [extraSecrets] - Secretos adicionales opcionales
 * @returns {string[]} Lista de secretos únicos ordenados por longitud descendente
 */
function getSecretsToSanitize(extraSecrets = []) {
    const secrets = new Set();

    // 1. Claves explícitas sensibles de Botsky
    const explicitKeys = [
        'GEMINI_API_KEY',
        'GEMINI_API_KEY_2',
        'GEMINI_API_KEY_3',
        'GEMINI_API_KEYS',
        'GROQ_API_KEY',
        'EVOLUTION_API_KEY',
        'SPOTIFY_CLIENT_SECRET',
        'MASTER_KEY'
    ];

    for (const k of explicitKeys) {
        const val = process.env[k];
        if (val && typeof val === 'string') {
            const parts = val.split(',');
            for (const p of parts) {
                const clean = p.trim();
                if (clean.length >= 6) {
                    secrets.add(clean);
                }
            }
        }
    }

    // 2. Variables de entorno que coincidan con nombres sensibles
    const SENSITIVE_KEY_REGEX = /KEY|SECRET|TOKEN|PASSWORD|PASSWD|AUTH/i;
    for (const [envKey, envVal] of Object.entries(process.env)) {
        if (SENSITIVE_KEY_REGEX.test(envKey) && typeof envVal === 'string') {
            const clean = envVal.trim();
            if (clean.length >= 6) {
                secrets.add(clean);
            }
        }
    }

    // 3. Secretos adicionales pasados explícitamente (para pruebas o módulos)
    if (Array.isArray(extraSecrets)) {
        for (const s of extraSecrets) {
            if (s && typeof s === 'string') {
                const clean = s.trim();
                if (clean.length >= 6) {
                    secrets.add(clean);
                }
            }
        }
    }

    // Ordenar de mayor a menor longitud para evitar que un secreto corto
    // rompa parcialmente un secreto más largo que lo contenga.
    return Array.from(secrets).sort((a, b) => b.length - a.length);
}

/**
 * Sanitiza una cadena de texto eliminando y reemplazando secretos sensibles por [REDACTED_SECRET].
 *
 * NOTA CRÍTICA DE SEGURIDAD:
 * Esta función SOLAMENTE protege la información que sale del comando.
 * NO debe confundirse con seguridad de ejecución.
 * Un comando NO es seguro simplemente porque su salida esté sanitizada.
 *
 * @param {string} text - Texto a sanitizar
 * @param {string[]} [extraSecrets] - Secretos adicionales para enmascarar
 * @returns {string} Texto sanitizado
 */
function sanitizeOutput(text, extraSecrets = []) {
    if (text === null || text === undefined) return '';
    let sanitized = typeof text === 'string' ? text : String(text);

    const secrets = getSecretsToSanitize(extraSecrets);

    for (const secret of secrets) {
        // Reemplazo exacto
        sanitized = sanitized.split(secret).join('[REDACTED_SECRET]');
        // Reemplazo en caso de estar URL-encoded
        const urlEncoded = encodeURIComponent(secret);
        if (urlEncoded !== secret) {
            sanitized = sanitized.split(urlEncoded).join('[REDACTED_SECRET]');
        }
    }

    return sanitized;
}

/**
 * Genera un entorno limpio para el subproceso, eliminando credenciales sensibles
 * (API keys, tokens, passwords, secretos de Botsky) pero conservando variables
 * operativas estándar (PATH, HOME, USER, LANG, TERM, etc.).
 *
 * @param {object} [baseEnv] - Entorno base (default: process.env)
 * @returns {object} Objeto de entorno limpio
 */
function getSanitizedEnv(baseEnv = process.env) {
    const cleanEnv = {};
    const SENSITIVE_KEY_REGEX = /KEY|SECRET|TOKEN|PASSWORD|PASSWD|AUTH/i;
    const EXPLICIT_SENSITIVE_KEYS = new Set([
        'GEMINI_API_KEY',
        'GEMINI_API_KEY_2',
        'GEMINI_API_KEY_3',
        'GEMINI_API_KEYS',
        'GROQ_API_KEY',
        'EVOLUTION_API_KEY',
        'SPOTIFY_CLIENT_SECRET',
        'MASTER_KEY',
        'DATABASE_URL'
    ]);

    for (const [k, v] of Object.entries(baseEnv || {})) {
        if (EXPLICIT_SENSITIVE_KEYS.has(k) || SENSITIVE_KEY_REGEX.test(k)) {
            continue; // Omitir credenciales y secretos del bot
        }
        cleanEnv[k] = v;
    }

    // Asegurar variables mínimas de sistema para petrov si faltaran
    if (!cleanEnv.PATH) cleanEnv.PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
    if (!cleanEnv.USER) cleanEnv.USER = TARGET_USER;
    if (!cleanEnv.HOME) cleanEnv.HOME = '/home/' + TARGET_USER;
    if (!cleanEnv.SHELL) cleanEnv.SHELL = '/bin/bash';

    return cleanEnv;
}

/**
 * Parsea una cadena de comando dividiendo el ejecutable y sus argumentos,
 * respetando comillas simples y dobles para argumentos con espacios.
 *
 * NO invoca shells, NO evalúa variables de entorno, NO expande globs ni tuberías.
 *
 * @param {string} cmdStr - Cadena del comando (ej: 'df -h')
 * @returns {{ bin: string, args: string[] }}
 */
function parseCommandString(cmdStr) {
    if (!cmdStr || typeof cmdStr !== 'string') {
        throw new Error('El comando debe ser una cadena no vacía.');
    }
    const trimmed = cmdStr.trim();
    if (!trimmed) {
        throw new Error('El comando no puede estar vacío.');
    }

    const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
    const tokens = [];
    let match;
    while ((match = regex.exec(trimmed)) !== null) {
        if (match[1] !== undefined) {
            tokens.push(match[1]);
        } else if (match[2] !== undefined) {
            tokens.push(match[2]);
        } else {
            tokens.push(match[0]);
        }
    }

    if (tokens.length === 0) {
        throw new Error('No se pudo extraer ningún comando ejecutable.');
    }

    return {
        bin: tokens[0],
        args: tokens.slice(1)
    };
}

/**
 * Mata de forma limpia y garantizada un grupo de procesos en Linux (el proceso y todos sus hijos).
 *
 * @param {number} pid - PID del proceso líder del grupo
 * @param {string} signal - Señal ('SIGTERM', 'SIGKILL')
 */

/**
 * Localiza o crea un archivo centinela sin permisos de lectura (modo 0000)
 * para montar de forma segura sobre archivos confidenciales en la sandbox.
 * @returns {string|null} Ruta del centinela o null si no se pudo asegurar
 */
function getOrCreateBlockedSentinel() {
    const candidatePaths = [
        '/home/petrov/.botsky_blocked',
        '/tmp/.botsky_blocked'
    ];
    for (const p of candidatePaths) {
        try {
            if (!fs.existsSync(p)) {
                fs.writeFileSync(p, '', { mode: 0o000 });
            }
            try {
                fs.chmodSync(p, 0o000);
            } catch (_) {}
            return p;
        } catch (_) {
            if (fs.existsSync(p)) return p;
        }
    }
    return null;
}

function killProcessGroup(pid, signal = 'SIGTERM') {
    if (!pid || typeof pid !== 'number') return;
    try {
        // En Linux, pasar el PID negativo envía la señal a todo el Process Group (killpg)
        process.kill(-pid, signal);
    } catch (e) {
        // Si el grupo ya no existe (ESRCH), ignorar silenciosamente
    }
}

/**
 * Ejecuta un comando Linux de forma controlada como el usuario `petrov`.
 *
 * DECISIONES DE SEGURIDAD Y LIMITACIONES:
 * 1. Ejecución directa sin shell (`shell: false`): Previene inyecciones de comandos tipo `; rm -rf /`.
 * 2. Proceso en grupo independiente (`detached: true`): Permite matar el subárbol completo si hay timeout.
 * 3. Bounded streaming: Los buffers de stdout y stderr se truncan en tiempo real para no agotar la RAM.
 * 4. Timeout estricto: Bounded por DEFAULT_TIMEOUT_MS / MAX_TIMEOUT_MS (máximo 25s).
 * 5. Sanitización de salida: Remueve secretos conocidos y variables sensibles antes de devolver la respuesta.
 *
 * @param {string|string[]} command - Comando o array [bin, ...args]
 * @param {object} [options] - Opciones de ejecución
 * @param {string[]} [options.args] - Argumentos si command es solo el binario
 * @param {string}   [options.cwd]  - Directorio de trabajo (default: /home/petrov/botsky)
 * @param {number}   [options.timeoutMs] - Timeout en ms (default: 25000, max: 25000)
 * @param {number}   [options.maxStdoutBytes] - Máximo bytes en stdout (default: 50KB)
 * @param {number}   [options.maxStderrBytes] - Máximo bytes en stderr (default: 25KB)
 * @param {object}   [options.env]  - Variables de entorno
 * @param {string[]} [options.extraSecrets] - Secretos adicionales a sanitizar
 * @returns {Promise<{ success: boolean, stdout: string, stderr: string, exitCode: number|null, timedOut: boolean, durationMs: number }>}
 */
async function executeCommand(command, options = {}) {
    let bin = '';
    let args = [];

    if (Array.isArray(command)) {
        if (command.length === 0) {
            return {
                success: false,
                stdout: '',
                stderr: 'Comando vacío proporcionado como array.',
                exitCode: 1,
                timedOut: false,
                durationMs: 0
            };
        }
        bin = String(command[0]);
        args = command.slice(1).map(String);
    } else if (typeof command === 'string') {
        if (Array.isArray(options.args)) {
            bin = command.trim();
            args = options.args.map(String);
        } else {
            try {
                const parsed = parseCommandString(command);
                bin = parsed.bin;
                args = parsed.args;
            } catch (parseErr) {
                return {
                    success: false,
                    stdout: '',
                    stderr: parseErr.message,
                    exitCode: 1,
                    timedOut: false,
                    durationMs: 0
                };
            }
        }
    } else {
        return {
            success: false,
            stdout: '',
            stderr: 'Tipo de comando no válido. Debe ser string o array.',
            exitCode: 1,
            timedOut: false,
            durationMs: 0
        };
    }

    const requestedTimeout = typeof options.timeoutMs === 'number' ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
    const timeoutMs = Math.min(Math.max(requestedTimeout, 100), MAX_TIMEOUT_MS);
    const maxStdoutBytes = Number(options.maxStdoutBytes) || DEFAULT_MAX_STDOUT_BYTES;
    const maxStderrBytes = Number(options.maxStderrBytes) || DEFAULT_MAX_STDERR_BYTES;
    const cwd = options.cwd || '/home/petrov/botsky';
    // REQUISITO 1: SIEMPRE pasar el entorno por getSanitizedEnv(), incluso si options.env fue especificado explícitamente
    const env = getSanitizedEnv(options.env || process.env);

    // ── Aislamiento de Filesystem y Protección de .env con Bubblewrap (bwrap) ──
    const BWRAP_BIN = '/usr/bin/bwrap';
    const hasBwrap = fs.existsSync(BWRAP_BIN);

    let spawnBin = bin;
    let spawnArgs = args;

    const isShellOrInterpreter = bin.endsWith('bash') || bin.endsWith('sh') || bin.includes('python') || bin.includes('perl') || bin.includes('ruby');
    const shouldIsolate = hasBwrap && (options.isolateFs === true || isShellOrInterpreter || (options.isolateFs !== false && bin !== 'pgrep'));

    if (shouldIsolate) {
        const sentinel = getOrCreateBlockedSentinel();
        const bwrapArgs = [
            '--bind', '/', '/',
            '--dev-bind', '/dev', '/dev',
            '--proc', '/proc',
            '--die-with-parent'
        ];

        // Archivos sensibles a enmascarar en el sistema de archivos
        const sensitiveFiles = [
            '/home/petrov/botsky/.env',
            path.resolve(cwd, '.env')
        ];

        const masked = new Set();
        for (const f of sensitiveFiles) {
            if (f && !masked.has(f) && fs.existsSync(f) && sentinel) {
                masked.add(f);
                bwrapArgs.push('--ro-bind', sentinel, f);
            }
        }

        bwrapArgs.push('--', bin, ...args);
        spawnBin = BWRAP_BIN;
        spawnArgs = bwrapArgs;
    }

    // ── Garantía de usuario petrov (UID 1002) ─────────────────────────────────
    const isPetrov = process.getuid && process.getuid() === TARGET_UID;
    const isRoot = process.getuid && process.getuid() === 0;
    const stdio = options.stdinData !== undefined ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'];
    const spawnOpts = {
        cwd,
        env,
        detached: true,
        stdio,
        shell: false
    };

    if (!isPetrov) {
        if (isRoot) {
            spawnOpts.uid = TARGET_UID;
            spawnOpts.gid = TARGET_GID;
        } else {
            // Si el proceso padre corre como otro usuario (ej: ubuntu en desarrollo),
            // usar sudo no-interactivo para garantizar ejecución como petrov
            spawnArgs = ['-n', '-u', TARGET_USER, spawnBin, ...spawnArgs];
            spawnBin = 'sudo';
        }
    }

    return new Promise((resolve) => {
        const startTime = Date.now();
        let child = null;
        let timer = null;
        let timedOut = false;
        let settled = false;

        let stdout = '';
        let stdoutBytes = 0;
        let stdoutTruncated = false;

        let stderr = '';
        let stderrBytes = 0;
        let stderrTruncated = false;

        try {
            child = spawn(spawnBin, spawnArgs, spawnOpts);
            if (options.stdinData !== undefined && child.stdin) {
                child.stdin.end(options.stdinData);
            }
        } catch (spawnErr) {
            const durationMs = Date.now() - startTime;
            return resolve({
                success: false,
                stdout: '',
                stderr: sanitizeOutput(spawnErr.message || 'Error de spawn'),
                exitCode: null,
                timedOut: false,
                durationMs
            });
        }

        if (timeoutMs > 0) {
            timer = setTimeout(() => {
                timedOut = true;
                // 1. Enviar SIGTERM a todo el grupo de procesos
                killProcessGroup(child.pid, 'SIGTERM');
                // 2. Gracia de 500ms y luego SIGKILL para evitar procesos zombies o bloqueados
                setTimeout(() => {
                    killProcessGroup(child.pid, 'SIGKILL');
                }, 500);
            }, timeoutMs);
        }

        child.stdout.on('data', (chunk) => {
            stdoutBytes += chunk.length;
            if (stdout.length < maxStdoutBytes) {
                const remaining = maxStdoutBytes - stdout.length;
                if (chunk.length <= remaining) {
                    stdout += chunk.toString('utf-8');
                } else {
                    stdout += chunk.subarray(0, remaining).toString('utf-8');
                    stdoutTruncated = true;
                }
            } else {
                stdoutTruncated = true;
            }
        });

        child.stderr.on('data', (chunk) => {
            stderrBytes += chunk.length;
            if (stderr.length < maxStderrBytes) {
                const remaining = maxStderrBytes - stderr.length;
                if (chunk.length <= remaining) {
                    stderr += chunk.toString('utf-8');
                } else {
                    stderr += chunk.subarray(0, remaining).toString('utf-8');
                    stderrTruncated = true;
                }
            } else {
                stderrTruncated = true;
            }
        });

        child.on('error', (err) => {
            if (timer) clearTimeout(timer);
            if (settled) return;
            settled = true;

            const durationMs = Date.now() - startTime;
            resolve({
                success: false,
                stdout: sanitizeOutput(stdout, options.extraSecrets),
                stderr: sanitizeOutput(err.message || 'Error en proceso', options.extraSecrets),
                exitCode: err.code === 'ENOENT' ? 127 : null,
                timedOut: false,
                durationMs
            });
        });

        child.on('close', (exitCode, signal) => {
            if (timer) clearTimeout(timer);
            if (settled) return;
            settled = true;

            const durationMs = Date.now() - startTime;

            if (stdoutTruncated) {
                stdout += `\n\n[... Salida truncada: se excedió el límite de ${maxStdoutBytes} bytes (${stdoutBytes} bytes generados) ...]`;
            }
            if (stderrTruncated) {
                stderr += `\n\n[... Salida truncada: se excedió el límite de ${maxStderrBytes} bytes (${stderrBytes} bytes generados) ...]`;
            }

            const sanitizedStdout = sanitizeOutput(stdout, options.extraSecrets);
            const sanitizedStderr = sanitizeOutput(stderr, options.extraSecrets);

            let finalExitCode = exitCode !== null ? exitCode : (timedOut ? null : (signal ? -1 : 0));
            // Si bwrap reportó que el ejecutable no existe (execvp: No such file or directory),
            // normalizar al código estándar de comando no encontrado (127)
            if (finalExitCode === 1 && stderr.includes('execvp') && stderr.includes('No such file or directory')) {
                finalExitCode = 127;
            }

            const success = !timedOut && finalExitCode === 0;

            resolve({
                success,
                stdout: sanitizedStdout,
                stderr: sanitizedStderr,
                exitCode: finalExitCode,
                timedOut,
                durationMs
            });
        });
    });
}


/**
 * Ejecuta un comando o script Bash arbitrario como usuario petrov utilizando /bin/bash -c.
 * Permite sintaxis libre de Bash (pipes, redirecciones, subshells, &&, ||, variables).
 * Reutiliza estrictamente las garantías de seguridad de terminal.js:
 * - Usuario petrov garantizado (UID 1002, nunca root)
 * - Process group líder (detached: true) con killpg en timeout (SIGTERM + SIGKILL)
 * - Bounded streaming de stdout y stderr (máximo 50KB / 25KB)
 * - Timeout estricto de máximo 25 segundos (no modificable por el modelo)
 * - Sanitización automática de secretos en stdout y stderr
 *
 * @param {string} bashCommand - Comando Bash arbitrario
 * @param {object} [options]   - Opciones adicionales
 * @returns {Promise<{ success: boolean, stdout: string, stderr: string, exitCode: number|null, timedOut: boolean, durationMs: number }>}
 */
async function executeBash(bashCommand, options = {}) {
    if (typeof bashCommand !== 'string' || !bashCommand.trim()) {
        return {
            success: false,
            stdout: '',
            stderr: 'El comando Bash no puede estar vacío.',
            exitCode: 1,
            timedOut: false,
            durationMs: 0
        };
    }

    const requestedTimeout = typeof options.timeoutMs === 'number' ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
    const timeoutMs = Math.min(Math.max(requestedTimeout, 100), MAX_TIMEOUT_MS);

    // Ejecución segura de Bash mediante /bin/bash -s vía stdin:
    // 1. Evita exponer el comando o secretos en la tabla de procesos (/proc/cmdline, ps aux)
    // 2. Previene falsos positivos en búsquedas con pgrep -f
    return executeCommand(['/bin/bash', '-s'], {
        ...options,
        stdinData: bashCommand,
        timeoutMs
    });
}

module.exports = {
    executeCommand,
    executeBash,
    sanitizeOutput,
    getSanitizedEnv,
    getOrCreateBlockedSentinel,
    parseCommandString,
    getSecretsToSanitize,
    DEFAULT_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
    DEFAULT_MAX_STDOUT_BYTES,
    DEFAULT_MAX_STDERR_BYTES,
    TARGET_USER,
    TARGET_UID,
    TARGET_GID
};
