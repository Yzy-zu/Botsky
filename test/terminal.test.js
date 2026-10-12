'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const {
    executeCommand,
    sanitizeOutput,
    parseCommandString,
    DEFAULT_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
    DEFAULT_MAX_STDOUT_BYTES,
    DEFAULT_MAX_STDERR_BYTES
} = require('../src/services/terminal');

// ─── 1. Pruebas Mínimas Obligatorias (1 a 8: Comandos Básicos) ────────────────

test('Terminal 1: echo hello ejecuta correctamente', async () => {
    const res = await executeCommand('echo hello');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.exitCode, 0);
    assert.strictEqual(res.timedOut, false);
    assert.strictEqual(res.stdout.trim(), 'hello');
    assert.strictEqual(res.stderr, '');
    assert.ok(typeof res.durationMs === 'number' && res.durationMs >= 0);
});

test('Terminal 2: printf formatea y devuelve salida limpia', async () => {
    const res = await executeCommand('printf', { args: ['%s_%s', 'botsky', 'agentic'] });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.exitCode, 0);
    assert.strictEqual(res.stdout, 'botsky_agentic');
});

test('Terminal 3: pwd devuelve directorio válido', async () => {
    const res = await executeCommand('pwd');
    assert.strictEqual(res.success, true);
    assert.ok(res.stdout.trim().startsWith('/'));
});

test('Terminal 4: id muestra información del usuario petrov (UID 1002)', async () => {
    const res = await executeCommand('id');
    assert.strictEqual(res.success, true);
    assert.ok(res.stdout.includes('uid=1002(petrov)'), `stdout debe ser de petrov: ${res.stdout}`);
    assert.ok(res.stdout.includes('gid=1002(petrov)'));
});

test('Terminal 5: uptime devuelve estadísticas del servidor', async () => {
    const res = await executeCommand('uptime');
    assert.strictEqual(res.success, true);
    assert.ok(res.stdout.includes('load average') || res.stdout.includes('up'));
});

test('Terminal 6: df -h devuelve uso de disco montado', async () => {
    const res = await executeCommand('df -h');
    assert.strictEqual(res.success, true);
    assert.ok(res.stdout.includes('Filesystem') || res.stdout.includes('S.ficheros'));
});

test('Terminal 7: free -m devuelve memoria RAM del sistema', async () => {
    const res = await executeCommand('free -m');
    assert.strictEqual(res.success, true);
    assert.ok(res.stdout.includes('Mem:') || res.stdout.includes('Memoria:'));
});

test('Terminal 8: docker ps lista contenedores si Docker está disponible', async () => {
    const res = await executeCommand('docker ps');
    assert.strictEqual(res.success, true);
    assert.ok(res.stdout.includes('CONTAINER ID'));
});

// ─── 2. Pruebas de Códigos de Salida y Errores (9 a 10) ───────────────────────

test('Terminal 9: comando con exit code distinto de 0', async () => {
    const res = await executeCommand('node', { args: ['-e', 'process.exit(42)'] });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.exitCode, 42);
    assert.strictEqual(res.timedOut, false);
});

test('Terminal 10: comando que supera 25 segundos y debe terminar por timeout', { timeout: 35000 }, async () => {
    // Prueba estricta con el timeout máximo de 25s por defecto
    const startTime = Date.now();
    const res = await executeCommand('sleep 30'); // timeout por defecto = 25000ms
    const elapsed = Date.now() - startTime;

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.timedOut, true);
    assert.ok(elapsed >= 24900, `Debe durar al menos 25s, duró: ${elapsed}ms`);
    assert.ok(elapsed < 28000, `No debe tardar mucho más de 25s, duró: ${elapsed}ms`);
});

// ─── 3. Pruebas de Truncado Seguro de Salida (11 a 12) ─────────────────────────

test('Terminal 11: stdout grande se trunca de forma segura sin consumir memoria', async () => {
    // Generar ~100KB de salida con límite de 2KB
    const res = await executeCommand('node', {
        args: ['-e', 'console.log("X".repeat(100000))'],
        maxStdoutBytes: 2048
    });

    assert.strictEqual(res.success, true);
    assert.ok(res.stdout.includes('[... Salida truncada: se excedió el límite de 2048 bytes'));
    assert.ok(res.stdout.length < 5000, 'El string en memoria debe permanecer acotado');
});

test('Terminal 12: stderr grande se trunca de forma segura', async () => {
    const res = await executeCommand('node', {
        args: ['-e', 'console.error("E".repeat(100000))'],
        maxStderrBytes: 1024
    });

    assert.strictEqual(res.success, true);
    assert.ok(res.stderr.includes('[... Salida truncada: se excedió el límite de 1024 bytes'));
    assert.ok(res.stderr.length < 3000);
});

// ─── 4. Pruebas de Sanitización de Secretos (13 a 15) ──────────────────────────

test('Terminal 13: salida que contenga una API key ficticia es sanitizada', async () => {
    const fakeKey = 'AQ.FakeSingleKey_TestSecret9876543210';
    const res = await executeCommand('echo', {
        args: [`clave de prueba: ${fakeKey}`],
        extraSecrets: [fakeKey]
    });

    assert.strictEqual(res.stdout.includes(fakeKey), false, 'La clave secreta no debe aparecer en stdout');
    assert.ok(res.stdout.includes('clave de prueba: [REDACTED_SECRET]'));
});

test('Terminal 14: salida que contenga múltiples secretos ficticios', async () => {
    const fakeKey1 = 'AQ.MultiSecret1_Alpha123456789';
    const fakeKey2 = 'gsk_MultiSecret2_Beta123456789';
    const fakeToken = 'WA_MultiSecret3_Gamma123456789';

    const res = await executeCommand('echo', {
        args: [`${fakeKey1} y también ${fakeKey2} con token ${fakeToken}`],
        extraSecrets: [fakeKey1, fakeKey2, fakeToken]
    });

    assert.strictEqual(res.stdout.includes(fakeKey1), false);
    assert.strictEqual(res.stdout.includes(fakeKey2), false);
    assert.strictEqual(res.stdout.includes(fakeToken), false);

    const occurrences = (res.stdout.match(/\[REDACTED_SECRET\]/g) || []).length;
    assert.strictEqual(occurrences, 3, 'Deben reemplazarse exactamente los 3 secretos');
});

test('Terminal 15: sanitizeOutput maneja null, undefined y valores no-string con seguridad', () => {
    assert.strictEqual(sanitizeOutput(null), '');
    assert.strictEqual(sanitizeOutput(undefined), '');
    assert.strictEqual(sanitizeOutput(123456), '123456');
    assert.strictEqual(sanitizeOutput({ test: 'ok' }), '[object Object]');
    assert.strictEqual(sanitizeOutput(''), '');
});

// ─── 5. Verificación de Usuario (16) ──────────────────────────────────────────

test('Terminal 16: verificar que el proceso ejecutado corresponde al usuario petrov', async () => {
    const resWho = await executeCommand('whoami');
    assert.strictEqual(resWho.success, true);
    assert.strictEqual(resWho.stdout.trim(), 'petrov', 'whoami debe devolver estrictamente petrov');

    const resId = await executeCommand('id -u');
    assert.strictEqual(resId.success, true);
    assert.strictEqual(resId.stdout.trim(), '1002', 'UID debe ser 1002 (petrov)');
});

// ─── 6. Prueba Específica Contra Fugas (Requisito 9) ───────────────────────────

test('Terminal: prueba específica contra fugas en stdout y stderr con secretos múltiples', async () => {
    const fakeGemini = 'AQ.Ab8RN6_SPECIFIC_LEAK_GEMINI_KEY_88888';
    const fakeGroq = 'gsk_SPECIFIC_LEAK_GROQ_KEY_888888888888';
    const fakeWaToken = 'EAABwz_SPECIFIC_LEAK_WA_TOKEN_888888888';
    const normalDiagnostic = 'DIAGNOSTICO_NORMAL_SISTEMA_OK';

    // 1. Prueba en stdout
    const resOut = await executeCommand('node', {
        args: ['-e', `console.log("${fakeGemini} | ${fakeGroq} | ${fakeWaToken} | ${normalDiagnostic}")`],
        extraSecrets: [fakeGemini, fakeGroq, fakeWaToken]
    });

    assert.strictEqual(resOut.stdout.includes(fakeGemini), false, 'fakeGemini no debe aparecer en stdout');
    assert.strictEqual(resOut.stdout.includes(fakeGroq), false, 'fakeGroq no debe aparecer en stdout');
    assert.strictEqual(resOut.stdout.includes(fakeWaToken), false, 'fakeWaToken no debe aparecer en stdout');
    assert.ok(resOut.stdout.includes(normalDiagnostic), 'El texto normal debe conservarse íntegro');
    assert.ok(resOut.stdout.includes('[REDACTED_SECRET]'));

    // 2. Prueba en stderr
    const resErr = await executeCommand('node', {
        args: ['-e', `console.error("FATAL: fallo con clave ${fakeGemini}")`],
        extraSecrets: [fakeGemini]
    });

    assert.strictEqual(resErr.stderr.includes(fakeGemini), false, 'fakeGemini no debe aparecer en stderr');
    assert.ok(resErr.stderr.includes('FATAL: fallo con clave [REDACTED_SECRET]'));
});

// ─── 7. Pruebas de Seguridad de Procesos (Requisito 10) ────────────────────────

test('Terminal: proceso terminado por timeout no deja procesos huérfanos', async () => {
    const marker = 'botsky_orphan_probe_test_9999';

    // Lanzar un proceso con un hijo 'sleep 100' y forzar timeout rápido (500ms)
    const res = await executeCommand('node', {
        args: ['-e', `
            const { spawn } = require('child_process');
            spawn('sleep', ['100', '${marker}'], { stdio: 'ignore' });
            setInterval(() => {}, 1000);
        `],
        timeoutMs: 500
    });

    assert.strictEqual(res.timedOut, true);

    // Esperar 600ms para asegurar que la señal SIGKILL haya terminado de propagarse al grupo
    await new Promise(r => setTimeout(r, 600));

    // Verificar en la tabla de procesos del sistema que 'sleep 100 marker' ya no exista
    const check = await executeCommand('pgrep', { args: ['-f', marker] });
    assert.strictEqual(check.stdout.trim(), '', 'No debe quedar ningún proceso huérfano en el sistema');
});

test('Terminal: comando inexistente devuelve resultado estructurado sin crashear el proceso', async () => {
    const res = await executeCommand('comando_completamente_inexistente_xyz_12345');
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.exitCode, 127);
    assert.strictEqual(res.timedOut, false);
    assert.ok(res.stderr.length > 0);
    assert.strictEqual(typeof res.durationMs, 'number');
});

test('Terminal: comando vacío o inválido devuelve resultado controlado', async () => {
    const resEmpty = await executeCommand('');
    assert.strictEqual(resEmpty.success, false);
    assert.strictEqual(resEmpty.exitCode, 1);

    const resNull = await executeCommand(null);
    assert.strictEqual(resNull.success, false);
    assert.strictEqual(resNull.exitCode, 1);
});

test('Terminal: parseCommandString separa correctamente comando y argumentos sin invocar shell', () => {
    const parsed1 = parseCommandString('df -h');
    assert.strictEqual(parsed1.bin, 'df');
    assert.deepStrictEqual(parsed1.args, ['-h']);

    const parsed2 = parseCommandString("echo \"hola mundo\" 'otra cosa'");
    assert.strictEqual(parsed2.bin, 'echo');
    assert.deepStrictEqual(parsed2.args, ['hola mundo', 'otra cosa']);

    // Comandos con inyección simulada tipo '; rm -rf /' NO se ejecutan en subshell
    const parsed3 = parseCommandString('ls; rm -rf /');
    assert.strictEqual(parsed3.bin, 'ls;');
    assert.deepStrictEqual(parsed3.args, ['rm', '-rf', '/']);
});
