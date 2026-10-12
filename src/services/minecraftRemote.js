'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const logger = require('./logger');

const execFileAsync = promisify(execFile);

// Configuración de conexión y rutas remotas
const REMOTE_HOST = process.env.MINECRAFT_SSH_HOST || 'redspi';
const CONTAINER_NAME = process.env.MINECRAFT_CONTAINER || 'mc-bedrock';
const BASE_PATH = process.env.MINECRAFT_BASE_PATH || '/home/petrov/docker/minecraft';
const DEFAULT_TIMEOUT_MS = parseInt(process.env.MINECRAFT_CMD_TIMEOUT || '15000', 10);

// Caché en memoria para optimizar lecturas I/O remotas (TTL: 5 minutos)
let modsManifestCache = null;
let modsCacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Ejecuta un comando en la máquina remota vía SSH usando autenticación por llave.
 *
 * @param {string} remoteCommand - Comando a ejecutar en el servidor remoto.
 * @param {object} [options]
 * @param {number} [options.timeout] - Timeout en milisegundos.
 * @returns {Promise<{ stdout: string, stderr: string, durationMs: number }>}
 */
async function executeRemoteCommand(remoteCommand, options = {}) {
    const timeout = options.timeout || DEFAULT_TIMEOUT_MS;
    const t0 = Date.now();

    try {
        const { stdout, stderr } = await execFileAsync('ssh', [
            '-o', 'BatchMode=yes',
            '-o', 'ConnectTimeout=5',
            REMOTE_HOST,
            remoteCommand
        ], { timeout });

        return {
            stdout: stdout || '',
            stderr: stderr || '',
            durationMs: Date.now() - t0
        };
    } catch (err) {
        const durationMs = Date.now() - t0;
        const msg = err.message || '';

        if (err.killed || msg.includes('TIMEDOUT') || msg.includes('timeout')) {
            logger.error(`[MC-REMOTE] Timeout (${timeout}ms) ejecutando comando en ${REMOTE_HOST}`);
            throw new Error(`Timeout conectando con el servidor de Minecraft en ${REMOTE_HOST}`);
        }

        if (msg.includes('Permission denied') || msg.includes('Host key verification failed')) {
            logger.error(`[MC-REMOTE] Error de autenticación SSH con ${REMOTE_HOST}: ${msg}`);
            throw new Error(`Error de autenticación SSH al conectar con ${REMOTE_HOST}`);
        }

        if (msg.includes('Could not resolve hostname') || msg.includes('No route to host')) {
            logger.error(`[MC-REMOTE] Host inalcanzable ${REMOTE_HOST} (Tailscale desconectado?): ${msg}`);
            throw new Error(`El servidor remoto ${REMOTE_HOST} no está alcanzable vía Tailscale`);
        }

        logger.warn(`[MC-REMOTE] Error en ejecución remota (${durationMs}ms): ${msg}`);
        throw err;
    }
}

/**
 * Ejecuta código JavaScript en el entorno Node remoto de redspi de manera 100% blindada,
 * usando codificación Base64 para evitar cualquier colisión de comillas, variables de shell (zsh/bash)
 * o problemas de caracteres especiales y regex.
 *
 * @param {string} jsScript - Código JavaScript a ejecutar en el Node remoto.
 * @param {object} [options]
 * @returns {Promise<{ stdout: string, stderr: string, durationMs: number }>}
 */
async function executeRemoteNodeScript(jsScript, options = {}) {
    const b64 = Buffer.from(jsScript.trim()).toString('base64');
    const remoteCmd = `node -e 'eval(Buffer.from("${b64}","base64").toString())'`;
    return executeRemoteCommand(remoteCmd, options);
}

/**
 * Calcula un tiempo transcurrido legible en español (ej: "2 días, 4 horas").
 */
function formatUptime(startedAtIso) {
    if (!startedAtIso) return 'Desconocido';
    const started = new Date(startedAtIso).getTime();
    if (isNaN(started)) return 'Desconocido';

    const diffMs = Math.max(0, Date.now() - started);
    const totalSecs = Math.floor(diffMs / 1000);
    const days = Math.floor(totalSecs / 86400);
    const hours = Math.floor((totalSecs % 86400) / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);

    const parts = [];
    if (days > 0) parts.push(`${days} día${days > 1 ? 's' : ''}`);
    if (hours > 0) parts.push(`${hours} hora${hours > 1 ? 's' : ''}`);
    if (days === 0 && mins > 0) parts.push(`${mins} min${mins > 1 ? 's' : ''}`);
    if (parts.length === 0) return 'Menos de 1 minuto';

    return parts.join(', ');
}

/**
 * Obtiene el estado del contenedor, uptime, uso de CPU, RAM y red del servidor de Minecraft.
 *
 * @param {boolean} [includeStats=true] - Si se debe consultar docker stats (agrega ~1.5s por muestreo).
 * @returns {Promise<object>} Estado estructurado del servidor.
 */
async function getRemoteServerStatus(includeStats = true) {
    try {
        const remoteJs = `
            const fs = require('fs');
            const path = require('path');
            const { execSync } = require('child_process');

            let container = "${CONTAINER_NAME}";
            try {
                execSync("docker inspect " + container + " 2>/dev/null");
            } catch (_) {
                try {
                    const autoC = execSync('docker ps -a --filter "ancestor=itzg/minecraft-bedrock-server" --format "{{.Names}}" 2>/dev/null', { encoding: 'utf8' }).trim().split('\\n')[0];
                    if (autoC) container = autoC;
                } catch (_) {}
            }

            let DATA = path.join("${BASE_PATH}", "data");
            try {
                const mount = execSync('docker inspect -f "{{range .Mounts}}{{if eq .Destination \\"/data\\"}}{{.Source}}{{end}}{{end}}" ' + container + ' 2>/dev/null', { encoding: 'utf8' }).trim();
                if (mount && fs.existsSync(mount)) DATA = mount;
            } catch (_) {}

            let statusInspect = "offline||";
            try {
                statusInspect = execSync('docker inspect -f "{{.State.Status}}|{{.State.StartedAt}}|{{.State.Health.Status}}" ' + container + ' 2>/dev/null', { encoding: 'utf8' }).trim();
            } catch (_) {}

            let props = {
                activeWorld: "Desconocido",
                gamemode: "survival",
                difficulty: "normal",
                allowCheats: "false",
                serverPort: "19132",
                serverName: "Servidorsito",
                onlineMode: "true"
            };
            const propsPath = path.join(DATA, "server.properties");
            if (fs.existsSync(propsPath)) {
                const lines = fs.readFileSync(propsPath, 'utf8').split(/\\r?\\n/);
                for (const line of lines) {
                    const m = line.match(/^\\s*([a-zA-Z0-9_-]+)\\s*=\\s*(.*)$/);
                    if (m) {
                        const key = m[1].toLowerCase().trim();
                        const val = m[2].trim().replace(/^["']|["']$/g, '');
                        props[key] = val;
                        if (key === 'level-name') props.activeWorld = val;
                        if (key === 'gamemode') props.gamemode = val;
                        if (key === 'difficulty') props.difficulty = val;
                        if (key === 'allow-cheats') props.allowCheats = val;
                        if (key === 'server-port') props.serverPort = val;
                        if (key === 'server-name') props.serverName = val;
                        if (key === 'online-mode') props.onlineMode = val;
                    }
                }
            }

            let disk = "122GB disponibles (16% usado)";
            try {
                const df = execSync('df -h "' + DATA + '" 2>/dev/null', { encoding: 'utf8' }).trim().split('\\n')[1].replace(/\\s+/g, ' ').split(' ');
                if (df.length >= 5) {
                    disk = df[3] + " disponibles (" + df[4] + " usado de " + df[1] + ")";
                }
            } catch (_) {}

            let stats = "0%|0B / 0B|0B / 0B";
            const isRunning = statusInspect.startsWith("running|");
            if (${includeStats ? 'true' : 'false'} && isRunning) {
                try {
                    stats = execSync('docker stats --no-stream --format "{{.CPUPerc}}|{{.MemUsage}}|{{.NetIO}}" ' + container + ' 2>/dev/null', { encoding: 'utf8' }).trim();
                } catch (_) {}
            }

            console.log(JSON.stringify({ statusInspect, props, stats, disk }));
        `;

        const { stdout, durationMs } = await executeRemoteNodeScript(remoteJs);
        const data = JSON.parse(stdout.trim());
        const [status, startedAt, health] = (data.statusInspect || 'offline||').split('|');
        const isRunning = status === 'running';

        let cpu = '0%';
        let memory = '0B / 0B';
        let network = '0B / 0B';

        if (isRunning && data.stats) {
            const statsParts = data.stats.split('|');
            if (statsParts.length >= 3) {
                cpu = statsParts[0].trim();
                memory = statsParts[1].trim();
                network = statsParts[2].trim();
            }
        }

        const props = data.props || {};

        const cpuNum = parseFloat(cpu.replace('%', '')) || 0;
        let lagStatus = 'Excelente / Cero lag (20 TPS estimados)';
        if (cpuNum > 85) lagStatus = `Lag alto / Servidor saturado (${cpu} CPU)`;
        else if (cpuNum > 50) lagStatus = `Carga moderada (${cpu} CPU)`;

        return {
            online: isRunning,
            reachable: true,
            containerStatus: status || 'unknown',
            health: health || 'none',
            startedAt: startedAt || null,
            uptime: isRunning ? formatUptime(startedAt) : 'Apagado',
            activeWorld: props.activeWorld || 'Desconocido',
            gamemode: props.gamemode || 'survival',
            difficulty: props.difficulty || 'normal',
            allowCheats: props.allowCheats === 'true',
            serverPort: props.serverPort || '19132',
            serverName: props.serverName || 'Servidorsito',
            onlineMode: props.onlineMode === 'true',
            allProps: props,
            cpu,
            memory,
            network,
            disk: data.disk || '122GB disponibles',
            latencyMs: durationMs || 35,
            lag: isRunning ? lagStatus : 'Servidor apagado'
        };
    } catch (err) {
        return {
            online: false,
            reachable: false,
            containerStatus: 'unreachable',
            error: err.message,
            message: `No se pudo contactar con ${REMOTE_HOST}: ${err.message}`
        };
    }
}

/**
 * Consulta la lista de jugadores conectados actualmente en el servidor Bedrock.
 * Compatible con servidores usando protocolo NetherNet (WebRTC).
 *
 * @returns {Promise<{ online: boolean, count: number, max: number, players: string[], rawText?: string }>}
 */
async function getOnlinePlayers() {
    try {
        // En Bedrock con NetherNet, enviamos 'send-command list' y leemos los logs generados
        const cmd = `
            CONTAINER="${CONTAINER_NAME}"
            if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
                AUTO_C=$(docker ps -a --filter "ancestor=itzg/minecraft-bedrock-server" --format "{{.Names}}" 2>/dev/null | head -n1)
                if [ -n "$AUTO_C" ]; then CONTAINER="$AUTO_C"; fi
            fi
            STATUS=$(docker inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo "offline")
            if [ "$STATUS" != "running" ]; then
                echo "SERVER_OFFLINE"
                exit 0
            fi
            docker exec "$CONTAINER" send-command list >/dev/null 2>&1
            sleep 0.25
            docker logs --tail 4 "$CONTAINER" 2>&1
        `;

        const { stdout } = await executeRemoteCommand(cmd);

        if (stdout.includes('SERVER_OFFLINE')) {
            return {
                online: false,
                count: 0,
                max: 0,
                players: [],
                message: 'El servidor está apagado'
            };
        }

        // Buscar línea de respuesta del comando 'list'
        // Formato típico de BDS: "There are 0/10 players online:" o "There are 2/10 players online: Alex, Steve"
        const match = stdout.match(/There are\s+(\d+)\/(\d+)\s+players online:(.*)/i);

        if (match) {
            const count = parseInt(match[1], 10);
            const max = parseInt(match[2], 10);
            const namesRaw = match[3] ? match[3].trim() : '';
            const players = namesRaw ? namesRaw.split(',').map(n => n.trim()).filter(Boolean) : [];

            return {
                online: true,
                count,
                max,
                players,
                rawText: match[0].trim()
            };
        }

        // Si no capturó la línea exacta pero está corriendo
        return {
            online: true,
            count: 0,
            max: 10,
            players: [],
            message: 'Servidor activo (sin jugadores detectados en la consulta actual)'
        };
    } catch (err) {
        return {
            online: false,
            count: 0,
            max: 0,
            players: [],
            error: err.message,
            message: `Error al consultar jugadores: ${err.message}`
        };
    }
}

/**
 * Obtiene el listado de Addons (Behavior Packs y Resource Packs) activos en el mundo actual,
 * cruzando los UUIDs con sus manifiestos para obtener nombres humanos, versiones y descripciones.
 *
 * @param {boolean} [forceRefresh=false] - Si es true, ignora el caché y re-escanea los manifiestos.
 * @returns {Promise<object>}
 */
async function getActiveModsAndPacks(forceRefresh = false) {
    const now = Date.now();
    const hasValidCache = !forceRefresh && modsManifestCache && (now - modsCacheTimestamp < CACHE_TTL_MS);

    // Node script ejecutado en redspi codificado en Base64 para inmunidad total de shell
    const remoteNodeJs = `
        const fs = require('fs');
        const path = require('path');
        const { execSync } = require('child_process');

        // 1. Auto-descubrimiento dinámico de contenedor
        let container = "${CONTAINER_NAME}";
        try {
            execSync("docker inspect " + container + " 2>/dev/null");
        } catch (_) {
            try {
                const autoC = execSync('docker ps -a --filter "ancestor=itzg/minecraft-bedrock-server" --format "{{.Names}}" 2>/dev/null', { encoding: 'utf8' }).trim().split('\\n')[0];
                if (autoC) container = autoC;
            } catch (_) {}
        }

        // 2. Auto-descubrimiento dinámico de la ruta host montada en /data
        let DATA = path.join("${BASE_PATH}", "data");
        try {
            const mount = execSync('docker inspect -f "{{range .Mounts}}{{if eq .Destination \\"/data\\"}}{{.Source}}{{end}}{{end}}" ' + container + ' 2>/dev/null', { encoding: 'utf8' }).trim();
            if (mount && fs.existsSync(mount)) DATA = mount;
        } catch (_) {}
        const BASE = path.dirname(DATA);

        // Parser seguro para JSONs de Bedrock (soporta comentarios // o /*, comas colgantes y BOM)
        function safeReadJson(filePath) {
            if (!fs.existsSync(filePath)) return null;
            try {
                let content = fs.readFileSync(filePath, 'utf8').trim();
                if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
                content = content.replace(/\\/\\*[\\s\\S]*?\\*\\/|\\/\\/.*/g, '');
                content = content.replace(/,\\s*([}\\]])/g, (m, p1) => p1);
                return JSON.parse(content);
            } catch (_) {
                return null;
            }
        }

        // 3. Obtener mundo activo de server.properties
        let activeWorld = "Supervivencia";
        const propsPath = path.join(DATA, "server.properties");
        if (fs.existsSync(propsPath)) {
            const lines = fs.readFileSync(propsPath, 'utf8').split(/\\r?\\n/);
            for (const line of lines) {
                const match = line.match(/^\\s*level-name\\s*=\\s*(.+)$/i);
                if (match) {
                    activeWorld = match[1].trim().replace(/^["']|["']$/g, '');
                    break;
                }
            }
        }

        // 4. Obtener packs enlazados al mundo activo
        const worldDir = path.join(DATA, "worlds", activeWorld);
        const bpPath = path.join(worldDir, "world_behavior_packs.json");
        const rpPath = path.join(worldDir, "world_resource_packs.json");

        const activeBP = safeReadJson(bpPath) || [];
        const activeRP = safeReadJson(rpPath) || [];

        // 5. Escanear manifiestos instalados en behavior_packs y resource_packs
        function scanManifests(dir) {
            const map = {};
            if (!fs.existsSync(dir)) return map;
            for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
                if (!ent.isDirectory()) continue;
                const mf = path.join(dir, ent.name, "manifest.json");
                const j = safeReadJson(mf);
                if (j && j.header && j.header.uuid) {
                    const h = j.header;
                    map[h.uuid] = {
                        name: (h.name && h.name !== 'pack.name') ? h.name : ent.name,
                        version: Array.isArray(h.version) ? h.version.join('.') : (h.version || '1.0.0'),
                        description: (h.description && h.description !== 'pack.description') ? h.description : '',
                        folder: ent.name
                    };
                }
            }
            return map;
        }

        const bpManifests = scanManifests(path.join(DATA, "behavior_packs"));
        const rpManifests = scanManifests(path.join(DATA, "resource_packs"));

        // 6. Listar catálogo de global_mods listos para instalar
        const globalDirs = [
            path.join(BASE, "global_mods"),
            path.join(DATA, "global_mods"),
            "/home/petrov/docker/minecraft/global_mods",
            "/home/petrov/petrovsky/backend/global_mods"
        ];
        const globalMods = [];
        const seenFiles = new Set();
        for (const gDir of globalDirs) {
            if (fs.existsSync(gDir)) {
                for (const file of fs.readdirSync(gDir)) {
                    if ((file.endsWith(".mcaddon") || file.endsWith(".mcpack") || file.endsWith(".zip")) && !seenFiles.has(file)) {
                        seenFiles.add(file);
                        try {
                            const stat = fs.statSync(path.join(gDir, file));
                            globalMods.push({
                                fileName: file,
                                sizeMb: Math.round((stat.size / (1024 * 1024)) * 10) / 10
                            });
                        } catch (_) {}
                    }
                }
            }
        }

        console.log(JSON.stringify({
            activeWorld,
            activeBP,
            activeRP,
            bpManifests,
            rpManifests,
            globalMods
        }));
    `;

    try {
        const { stdout } = await executeRemoteNodeScript(remoteNodeJs);
        const data = JSON.parse(stdout.trim());

        // Actualizar caché de manifiestos
        modsManifestCache = {
            bp: data.bpManifests || {},
            rp: data.rpManifests || {}
        };
        modsCacheTimestamp = Date.now();

        // Cruzar BP activos con manifiestos
        const behaviorPacks = (data.activeBP || []).map(item => {
            const uuid = item.pack_id;
            const meta = (data.bpManifests && data.bpManifests[uuid]) || {};
            const versionStr = Array.isArray(item.version) ? item.version.join('.') : (meta.version || '1.0.0');

            return {
                uuid,
                version: versionStr,
                name: meta.name || meta.folder || `Addon (${uuid.slice(0, 8)})`,
                description: meta.description || '',
                folder: meta.folder || null,
                type: 'Behavior'
            };
        });

        // Cruzar RP activos con manifiestos
        const resourcePacks = (data.activeRP || []).map(item => {
            const uuid = item.pack_id;
            const meta = (data.rpManifests && data.rpManifests[uuid]) || {};
            const versionStr = Array.isArray(item.version) ? item.version.join('.') : (meta.version || '1.0.0');

            return {
                uuid,
                version: versionStr,
                name: meta.name || meta.folder || `Textura (${uuid.slice(0, 8)})`,
                description: meta.description || '',
                folder: meta.folder || null,
                type: 'Resource'
            };
        });

        return {
            activeWorld: data.activeWorld || 'Desconocido',
            behaviorPacks,
            resourcePacks,
            globalMods: data.globalMods || [],
            totalActive: behaviorPacks.length + resourcePacks.length
        };
    } catch (err) {
        logger.error(`[MC-REMOTE] Error obteniendo mods remotos: ${err.message}`);
        throw new Error(`Error al leer los mods del servidor: ${err.message}`);
    }
}

/**
 * Obtiene la lista de todos los mundos creados en el servidor.
 *
 * @returns {Promise<{ activeWorld: string, worlds: Array<{ name: string, isActive: boolean }> }>}
 */
async function getWorldsList() {
    const remoteNodeJs = `
        const fs = require('fs');
        const path = require('path');
        const { execSync } = require('child_process');

        // Auto-descubrimiento dinámico de contenedor y ruta de datos
        let container = "${CONTAINER_NAME}";
        try {
            execSync("docker inspect " + container + " 2>/dev/null");
        } catch (_) {
            try {
                const autoC = execSync('docker ps -a --filter "ancestor=itzg/minecraft-bedrock-server" --format "{{.Names}}" 2>/dev/null', { encoding: 'utf8' }).trim().split('\\n')[0];
                if (autoC) container = autoC;
            } catch (_) {}
        }

        let DATA = path.join("${BASE_PATH}", "data");
        try {
            const mount = execSync('docker inspect -f "{{range .Mounts}}{{if eq .Destination \\"/data\\"}}{{.Source}}{{end}}{{end}}" ' + container + ' 2>/dev/null', { encoding: 'utf8' }).trim();
            if (mount && fs.existsSync(mount)) DATA = mount;
        } catch (_) {}

        let activeWorld = "Supervivencia";
        const propsPath = path.join(DATA, "server.properties");
        if (fs.existsSync(propsPath)) {
            const lines = fs.readFileSync(propsPath, 'utf8').split(/\\r?\\n/);
            for (const line of lines) {
                const match = line.match(/^\\s*level-name\\s*=\\s*(.+)$/i);
                if (match) {
                    activeWorld = match[1].trim().replace(/^["']|["']$/g, '');
                    break;
                }
            }
        }

        const worldsDir = path.join(DATA, "worlds");
        const worlds = [];
        if (fs.existsSync(worldsDir)) {
            for (const w of fs.readdirSync(worldsDir, { withFileTypes: true })) {
                if (w.isDirectory()) {
                    worlds.push({
                        name: w.name,
                        isActive: w.name === activeWorld
                    });
                }
            }
        }

        console.log(JSON.stringify({ activeWorld, worlds }));
    `;

    try {
        const { stdout } = await executeRemoteNodeScript(remoteNodeJs);
        return JSON.parse(stdout.trim());
    } catch (err) {
        logger.error(`[MC-REMOTE] Error obteniendo lista de mundos: ${err.message}`);
        throw new Error(`Error al listar los mundos del servidor: ${err.message}`);
    }
}

/**
 * Script bash helper para resolver el contenedor dinámicamente en cualquier acción de ciclo de vida.
 */
function getContainerResolutionBash() {
    return `
        C="${CONTAINER_NAME}"
        if ! docker inspect "$C" >/dev/null 2>&1; then
            AUTO_C=$(docker ps -a --filter "ancestor=itzg/minecraft-bedrock-server" --format "{{.Names}}" 2>/dev/null | head -n1)
            if [ -n "$AUTO_C" ]; then C="$AUTO_C"; fi
        fi
    `;
}

/**
 * Ejecuta una acción de ciclo de vida o comando de consola sobre el servidor de Minecraft en redspi.
 *
 * @param {string} action - 'on'|'off'|'restart'|'kill'|'cmd'|'logs'|'backup'
 * @param {string|number} [param=''] - Parámetro adicional (ej: comando a enviar o cantidad de líneas de logs).
 * @returns {Promise<{ success: boolean, message: string, output?: string }>}
 */
async function executeServerAction(action, param = '') {
    const act = (action || '').toLowerCase().trim();
    const resolveContainer = getContainerResolutionBash();

    switch (act) {
        case 'on':
        case 'encender':
        case 'start': {
            await executeRemoteCommand(`${resolveContainer}\ndocker start "$C"`);
            return { success: true, message: 'Servidor de Minecraft encendido en el VPS remoto' };
        }

        case 'off':
        case 'apagar':
        case 'stop': {
            await executeRemoteCommand(`${resolveContainer}\ndocker stop "$C"`);
            return { success: true, message: 'Servidor de Minecraft apagado correctamente' };
        }

        case 'restart':
        case 'reiniciar': {
            await executeRemoteCommand(`${resolveContainer}\ndocker restart "$C"`);
            return { success: true, message: 'Servidor de Minecraft reiniciado' };
        }

        case 'kill': {
            await executeRemoteCommand(`${resolveContainer}\ndocker kill "$C"`);
            return { success: true, message: 'Servidor de Minecraft detenido forzosamente (kill)' };
        }

        case 'cmd':
        case 'comando': {
            const rawCmd = String(param || '').trim();
            const cleanCmd = rawCmd.replace(/^\/+/, '');
            if (!cleanCmd) {
                return { success: false, message: 'Debes especificar un comando a enviar al servidor' };
            }
            // Escapar caracteres especiales para evitar expansión de variables o subshells
            const escaped = cleanCmd
                .replace(/\\/g, '\\\\')
                .replace(/"/g, '\\"')
                .replace(/\$/g, '\\$')
                .replace(/`/g, '\\`');
            const { stdout } = await executeRemoteCommand(
                `${resolveContainer}\ndocker exec "$C" send-command "${escaped}" >/dev/null 2>&1\nsleep 0.35\ndocker logs --tail 3 "$C" 2>&1`
            );
            return { success: true, message: `Comando enviado a la consola: /${cleanCmd}`, output: stdout.trim() };
        }

        case 'logs': {
            const lines = parseInt(param || '15', 10);
            const { stdout } = await executeRemoteCommand(`${resolveContainer}\ndocker logs --tail ${lines} "$C" 2>&1`);
            return { success: true, message: `Últimos ${lines} logs`, output: stdout.trim() };
        }

        case 'backup': {
            const backupScript = '/home/petrov/scripts/backup_minecraft.js';
            const { stdout } = await executeRemoteCommand(`node ${backupScript} 2>&1`, { timeout: 120000 });
            return { success: true, message: 'Respaldo ejecutado con éxito', output: stdout.trim() };
        }

        case 'desactivarmod':
        case 'quitarmod': {
            return await deactivateWorldPack(param, true);
        }

        case 'activarmod':
        case 'ponermod': {
            return await activateWorldPack(param, true);
        }

        default:
            return { success: false, message: `Acción desconocida: ${action}` };
    }
}

/**
 * Desactiva un Addon (Behavior Pack o Resource Pack) del mundo activo.
 * Remueve su UUID de world_behavior_packs.json o world_resource_packs.json
 * y opcionalmente reinicia el servidor para aplicar el cambio.
 *
 * @param {string} packQuery - Nombre, carpeta o UUID del mod/pack a desactivar.
 * @param {boolean} [autoRestart=true] - Si se debe reiniciar el servidor automáticamente.
 * @returns {Promise<{ success: boolean, message: string, packName?: string }>}
 */
async function deactivateWorldPack(packQuery, autoRestart = true) {
    if (!packQuery || !packQuery.trim()) {
        return { success: false, message: 'Debes indicar el nombre o UUID del mod a desactivar.' };
    }

    const remoteJs = `
        const fs = require('fs');
        const path = require('path');
        const { execSync } = require('child_process');

        let container = "${CONTAINER_NAME}";
        try {
            execSync("docker inspect " + container + " 2>/dev/null");
        } catch (_) {
            try {
                const autoC = execSync('docker ps -a --filter "ancestor=itzg/minecraft-bedrock-server" --format "{{.Names}}" 2>/dev/null', { encoding: 'utf8' }).trim().split('\\n')[0];
                if (autoC) container = autoC;
            } catch (_) {}
        }

        let DATA = path.join("${BASE_PATH}", "data");
        try {
            const mount = execSync('docker inspect -f "{{range .Mounts}}{{if eq .Destination \\"/data\\"}}{{.Source}}{{end}}{{end}}" ' + container + ' 2>/dev/null', { encoding: 'utf8' }).trim();
            if (mount && fs.existsSync(mount)) DATA = mount;
        } catch (_) {}

        let activeWorld = "Supervivencia";
        const propsPath = path.join(DATA, "server.properties");
        if (fs.existsSync(propsPath)) {
            const lines = fs.readFileSync(propsPath, 'utf8').split(/\\r?\\n/);
            for (const line of lines) {
                const match = line.match(/^\\s*level-name\\s*=\\s*(.+)$/i);
                if (match) {
                    activeWorld = match[1].trim().replace(/^["']|["']$/g, '');
                    break;
                }
            }
        }

        const worldDir = path.join(DATA, "worlds", activeWorld);
        const bpPath = path.join(worldDir, "world_behavior_packs.json");
        const rpPath = path.join(worldDir, "world_resource_packs.json");

        function safeReadJson(filePath) {
            if (!fs.existsSync(filePath)) return null;
            try {
                let content = fs.readFileSync(filePath, 'utf8').trim();
                if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
                content = content.replace(/\\/\\*[\\s\\S]*?\\*\\/|\\/\\/.*/g, '');
                content = content.replace(/,\\s*([}\\]])/g, (m, p1) => p1);
                return JSON.parse(content);
            } catch (_) {
                return null;
            }
        }

        const bpList = safeReadJson(bpPath) || [];
        const rpList = safeReadJson(rpPath) || [];

        function scanManifests(dir) {
            const map = {};
            if (!fs.existsSync(dir)) return map;
            for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
                if (!ent.isDirectory()) continue;
                const mf = path.join(dir, ent.name, "manifest.json");
                const j = safeReadJson(mf);
                if (j && j.header && j.header.uuid) {
                    const h = j.header;
                    map[h.uuid] = {
                        name: (h.name && h.name !== 'pack.name') ? h.name : ent.name,
                        folder: ent.name
                    };
                }
            }
            return map;
        }

        const bpManifests = scanManifests(path.join(DATA, "behavior_packs"));
        const rpManifests = scanManifests(path.join(DATA, "resource_packs"));

        const query = ${JSON.stringify(packQuery.toLowerCase().trim())};

        let targetUuid = null;
        let matchedName = null;
        let removedFromBp = false;
        let removedFromRp = false;

        for (const item of bpList) {
            const uuid = item.pack_id;
            const meta = bpManifests[uuid] || {};
            const name = (meta.name || meta.folder || '').toLowerCase();
            const folder = (meta.folder || '').toLowerCase();
            if (uuid.toLowerCase() === query || name.includes(query) || folder.includes(query)) {
                targetUuid = uuid;
                matchedName = meta.name || meta.folder || uuid;
                break;
            }
        }

        if (!targetUuid) {
            for (const item of rpList) {
                const uuid = item.pack_id;
                const meta = rpManifests[uuid] || {};
                const name = (meta.name || meta.folder || '').toLowerCase();
                const folder = (meta.folder || '').toLowerCase();
                if (uuid.toLowerCase() === query || name.includes(query) || folder.includes(query)) {
                    targetUuid = uuid;
                    matchedName = meta.name || meta.folder || uuid;
                    break;
                }
            }
        }

        if (!targetUuid) {
            console.log(JSON.stringify({ success: false, message: "No se encontró ningún mod activo que coincida con '" + query + "' en el mundo " + activeWorld }));
            process.exit(0);
        }

        const newBp = bpList.filter(item => {
            if (item.pack_id.toLowerCase() === targetUuid.toLowerCase()) {
                removedFromBp = true;
                return false;
            }
            return true;
        });

        const newRp = rpList.filter(item => {
            if (item.pack_id.toLowerCase() === targetUuid.toLowerCase()) {
                removedFromRp = true;
                return false;
            }
            return true;
        });

        try {
            if (removedFromBp || fs.existsSync(bpPath)) {
                fs.writeFileSync(bpPath, JSON.stringify(newBp, null, 2), 'utf8');
            }
        } catch (_) {
            const tmpFile = '/tmp/bp_' + Date.now() + '.json';
            fs.writeFileSync(tmpFile, JSON.stringify(newBp, null, 2), 'utf8');
            execSync('sudo mv ' + tmpFile + ' "' + bpPath + '" && sudo chown 100000:100000 "' + bpPath + '"');
        }

        try {
            if (removedFromRp || fs.existsSync(rpPath)) {
                fs.writeFileSync(rpPath, JSON.stringify(newRp, null, 2), 'utf8');
            }
        } catch (_) {
            const tmpFile = '/tmp/rp_' + Date.now() + '.json';
            fs.writeFileSync(tmpFile, JSON.stringify(newRp, null, 2), 'utf8');
            execSync('sudo mv ' + tmpFile + ' "' + rpPath + '" && sudo chown 100000:100000 "' + rpPath + '"');
        }

        console.log(JSON.stringify({
            success: true,
            activeWorld,
            packName: matchedName,
            uuid: targetUuid,
            removedFromBp,
            removedFromRp
        }));
    `;

    try {
        const { stdout } = await executeRemoteNodeScript(remoteJs);
        const res = JSON.parse(stdout.trim());
        if (!res.success) return res;

        invalidateManifestCache();

        if (autoRestart) {
            await executeServerAction('restart');
            return {
                success: true,
                message: `✅ El mod *${res.packName}* fue desactivado del mundo \`${res.activeWorld}\` y el servidor se reinició para aplicar los cambios.`,
                packName: res.packName
            };
        }

        return {
            success: true,
            message: `✅ El mod *${res.packName}* fue desactivado del mundo \`${res.activeWorld}\`.`,
            packName: res.packName
        };
    } catch (err) {
        logger.error(`[MC-REMOTE] Error desactivando mod: ${err.message}`);
        throw new Error(`Error al desactivar el mod: ${err.message}`);
    }
}

/**
 * Activa un Addon (Behavior Pack o Resource Pack) en el mundo activo.
 * Busca el pack en los manifiestos instalados en el servidor,
 * lo agrega a world_behavior_packs.json o world_resource_packs.json
 * y opcionalmente reinicia el servidor.
 *
 * @param {string} packQuery - Nombre, carpeta o UUID del mod a activar.
 * @param {boolean} [autoRestart=true]
 * @returns {Promise<{ success: boolean, message: string, packName?: string }>}
 */
async function activateWorldPack(packQuery, autoRestart = true) {
    if (!packQuery || !packQuery.trim()) {
        return { success: false, message: 'Debes indicar el nombre o UUID del mod a activar.' };
    }

    const remoteJs = `
        const fs = require('fs');
        const path = require('path');
        const { execSync } = require('child_process');

        let container = "${CONTAINER_NAME}";
        try {
            execSync("docker inspect " + container + " 2>/dev/null");
        } catch (_) {
            try {
                const autoC = execSync('docker ps -a --filter "ancestor=itzg/minecraft-bedrock-server" --format "{{.Names}}" 2>/dev/null', { encoding: 'utf8' }).trim().split('\\n')[0];
                if (autoC) container = autoC;
            } catch (_) {}
        }

        let DATA = path.join("${BASE_PATH}", "data");
        try {
            const mount = execSync('docker inspect -f "{{range .Mounts}}{{if eq .Destination \\"/data\\"}}{{.Source}}{{end}}{{end}}" ' + container + ' 2>/dev/null', { encoding: 'utf8' }).trim();
            if (mount && fs.existsSync(mount)) DATA = mount;
        } catch (_) {}

        let activeWorld = "Supervivencia";
        const propsPath = path.join(DATA, "server.properties");
        if (fs.existsSync(propsPath)) {
            const lines = fs.readFileSync(propsPath, 'utf8').split(/\\r?\\n/);
            for (const line of lines) {
                const match = line.match(/^\\s*level-name\\s*=\\s*(.+)$/i);
                if (match) {
                    activeWorld = match[1].trim().replace(/^["']|["']$/g, '');
                    break;
                }
            }
        }

        const worldDir = path.join(DATA, "worlds", activeWorld);
        const bpPath = path.join(worldDir, "world_behavior_packs.json");
        const rpPath = path.join(worldDir, "world_resource_packs.json");

        function safeReadJson(filePath) {
            if (!fs.existsSync(filePath)) return null;
            try {
                let content = fs.readFileSync(filePath, 'utf8').trim();
                if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
                content = content.replace(/\\/\\*[\\s\\S]*?\\*\\/|\\/\\/.*/g, '');
                content = content.replace(/,\\s*([}\\]])/g, (m, p1) => p1);
                return JSON.parse(content);
            } catch (_) {
                return null;
            }
        }

        function scanAllManifests(dir, type) {
            const list = [];
            if (!fs.existsSync(dir)) return list;
            for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
                if (!ent.isDirectory()) continue;
                const mf = path.join(dir, ent.name, "manifest.json");
                const j = safeReadJson(mf);
                if (j && j.header && j.header.uuid) {
                    const h = j.header;
                    list.push({
                        uuid: h.uuid,
                        version: Array.isArray(h.version) ? h.version : [1, 0, 0],
                        name: (h.name && h.name !== 'pack.name') ? h.name : ent.name,
                        folder: ent.name,
                        type
                    });
                }
            }
            return list;
        }

        const allBp = scanAllManifests(path.join(DATA, "behavior_packs"), "Behavior");
        const allRp = scanAllManifests(path.join(DATA, "resource_packs"), "Resource");
        const allPacks = [...allBp, ...allRp];

        const query = ${JSON.stringify(packQuery.toLowerCase().trim())};
        const matches = allPacks.filter(p => 
            p.uuid.toLowerCase() === query || 
            p.name.toLowerCase().includes(query) || 
            p.folder.toLowerCase().includes(query)
        );

        if (matches.length === 0) {
            console.log(JSON.stringify({ success: false, message: "No se encontró ningún mod instalado que coincida con '" + query + "'." }));
            process.exit(0);
        }

        const bpList = safeReadJson(bpPath) || [];
        const rpList = safeReadJson(rpPath) || [];

        let activatedCount = 0;
        let mainName = matches[0].name;

        for (const m of matches) {
            if (m.type === "Behavior") {
                if (!bpList.some(item => item.pack_id.toLowerCase() === m.uuid.toLowerCase())) {
                    bpList.push({ pack_id: m.uuid, version: m.version });
                    activatedCount++;
                }
            } else if (m.type === "Resource") {
                if (!rpList.some(item => item.pack_id.toLowerCase() === m.uuid.toLowerCase())) {
                    rpList.push({ pack_id: m.uuid, version: m.version });
                    activatedCount++;
                }
            }
        }

        if (activatedCount === 0) {
            console.log(JSON.stringify({ success: true, message: "El mod '" + mainName + "' ya estaba activo en el mundo " + activeWorld, alreadyActive: true }));
            process.exit(0);
        }

        try {
            fs.writeFileSync(bpPath, JSON.stringify(bpList, null, 2), 'utf8');
        } catch (_) {
            const tmp = '/tmp/bp_act_' + Date.now() + '.json';
            fs.writeFileSync(tmp, JSON.stringify(bpList, null, 2), 'utf8');
            execSync('sudo mv ' + tmp + ' "' + bpPath + '" && sudo chown 100000:100000 "' + bpPath + '"');
        }

        try {
            fs.writeFileSync(rpPath, JSON.stringify(rpList, null, 2), 'utf8');
        } catch (_) {
            const tmp = '/tmp/rp_act_' + Date.now() + '.json';
            fs.writeFileSync(tmp, JSON.stringify(rpList, null, 2), 'utf8');
            execSync('sudo mv ' + tmp + ' "' + rpPath + '" && sudo chown 100000:100000 "' + rpPath + '"');
        }

        console.log(JSON.stringify({
            success: true,
            activeWorld,
            packName: mainName,
            activatedCount
        }));
    `;

    try {
        const { stdout } = await executeRemoteNodeScript(remoteJs);
        const res = JSON.parse(stdout.trim());
        if (!res.success || res.alreadyActive) return res;

        invalidateManifestCache();

        if (autoRestart) {
            await executeServerAction('restart');
            return {
                success: true,
                message: `✅ El mod *${res.packName}* fue activado en el mundo \`${res.activeWorld}\` y el servidor se reinició para cargarlo.`,
                packName: res.packName
            };
        }

        return {
            success: true,
            message: `✅ El mod *${res.packName}* fue activado en el mundo \`${res.activeWorld}\`.`,
            packName: res.packName
        };
    } catch (err) {
        logger.error(`[MC-REMOTE] Error activando mod: ${err.message}`);
        throw new Error(`Error al activar el mod: ${err.message}`);
    }
}

/**
 * Formatea la información de mods y paquetes para mensaje de WhatsApp con formato enriquecido.
 */
function formatModsSummary(modsData) {
    if (!modsData) return '> ⚠️ No se pudo obtener la información de mods del servidor.';

    const lines = [];
    lines.push(`> 🌍 *Mundo activo:* \`${modsData.activeWorld}\``);
    lines.push(`> 📦 *Total de Addons activos:* \`${modsData.totalActive}\`\n`);

    if (modsData.behaviorPacks && modsData.behaviorPacks.length > 0) {
        lines.push(`*🛠️ Behavior Packs (Mecánicas y Entidades):*`);
        for (const bp of modsData.behaviorPacks) {
            const desc = bp.description ? ` — _${bp.description.slice(0, 60)}_` : '';
            lines.push(`• *${bp.name}* (v${bp.version})${desc}`);
        }
        lines.push('');
    } else {
        lines.push(`*🛠️ Behavior Packs:* Ninguno activo en este mundo.`);
        lines.push('');
    }

    if (modsData.resourcePacks && modsData.resourcePacks.length > 0) {
        lines.push(`*🎨 Resource Packs (Texturas y Animaciones):*`);
        for (const rp of modsData.resourcePacks) {
            const desc = rp.description ? ` — _${rp.description.slice(0, 60)}_` : '';
            lines.push(`• *${rp.name}* (v${rp.version})${desc}`);
        }
        lines.push('');
    }

    if (modsData.globalMods && modsData.globalMods.length > 0) {
        lines.push(`*📁 Addons listos en almacén global (${modsData.globalMods.length}):*`);
        for (const gm of modsData.globalMods.slice(0, 8)) {
            lines.push(`- \`${gm.fileName}\` (${gm.sizeMb} MB)`);
        }
        if (modsData.globalMods.length > 8) {
            lines.push(`_... y ${modsData.globalMods.length - 8} más en almacén._`);
        }
    }

    return lines.join('\n').trim();
}

/**
 * Formatea el estado general del servidor y los jugadores conectados.
 */
function formatStatusSummary(statusData, playersData) {
    if (!statusData || !statusData.reachable) {
        return `> 🔴 *Minecraft Bedrock:* Inalcanzable\n${statusData?.message || 'Error de conexión con el VPS de Minecraft.'}`;
    }

    if (!statusData.online) {
        return `> ⚪ *Minecraft Bedrock:* Apagado (\`${statusData.containerStatus}\`)\n` +
               `> 🌍 *Mundo:* \`${statusData.activeWorld}\`\n\n` +
               `_Pídele a Botsky "prende el server de maicra" para levantarlo._`;
    }

    const playerCount = playersData?.count ?? 0;
    const playerMax = playersData?.max ?? 10;
    const playerNames = (playersData?.players && playersData.players.length > 0)
        ? playersData.players.join(', ')
        : 'Nadie conectado';

    const modeName = statusData.gamemode === 'survival' ? 'Supervivencia' : (statusData.gamemode === 'creative' ? 'Creativo' : (statusData.gamemode || 'Normal'));
    const cheatsStr = statusData.allowCheats ? 'Activados ⚠️' : 'Desactivados (Todo legal)';

    return `> 🟢 *Minecraft Bedrock Online* (\`${REMOTE_HOST}\`)\n\n` +
           `👥 *Jugadores (${playerCount}/${playerMax}):* \`${playerNames}\`\n` +
           `🌍 *Mundo:* \`${statusData.activeWorld}\` | *Modo:* \`${modeName}\`\n` +
           `⚙️ *Dificultad:* \`${statusData.difficulty || 'Normal'}\` | *Trucos:* \`${cheatsStr}\`\n` +
           `⏱️ *Uptime:* ${statusData.uptime}\n` +
           `📊 *CPU:* \`${statusData.cpu}\` | *RAM:* \`${statusData.memory}\`\n` +
           `🌐 *Red:* \`${statusData.network}\` | *Puerto:* \`${statusData.serverPort || '19132'}\``;
}

module.exports = {
    REMOTE_HOST,
    CONTAINER_NAME,
    BASE_PATH,
    executeRemoteCommand,
    executeRemoteNodeScript,
    getRemoteServerStatus,
    getOnlinePlayers,
    getActiveModsAndPacks,
    getWorldsList,
    executeServerAction,
    deactivateWorldPack,
    activateWorldPack,
    formatModsSummary,
    formatStatusSummary,
    invalidateManifestCache: () => {
        modsManifestCache = null;
        modsCacheTimestamp = 0;
    }
};
