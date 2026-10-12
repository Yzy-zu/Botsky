'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const axios = require('axios');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { getSanitizedEnv, executeBash, executeCommand } = require('../src/services/terminal');
const { isAuthorizedAdmin, getSenderJid, cleanJidNumber, normalizePhoneNumber } = require('../src/core/auth');
const { normalizeIncomingMessage } = require('../src/core/message_normalizer');
const { _aiLimiter } = require('../src/core/dispatcher');
const { callGemini, routeWithAI, _resetPoolState, _keyStateMap } = require('../src/services/ai');
const evolution = require('../src/services/evolution');

// ─── 1. Pruebas de Aislamiento de Secretos en Terminal ────────────────────────

test('Fix 1 (Terminal): getSanitizedEnv elimina secretos y credenciales pero preserva entorno base', () => {
    const mockEnv = {
        PATH: '/usr/bin:/bin',
        USER: 'petrov',
        HOME: '/home/petrov',
        SHELL: '/bin/bash',
        CUSTOM_VAR: 'diagnostico_ok',
        GEMINI_API_KEY: 'AQ.TestGeminiSecretKey_11111',
        GEMINI_API_KEY_2: 'AQ.TestGeminiSecretKey_22222',
        GEMINI_API_KEYS: 'AQ.Key1,AQ.Key2',
        GROQ_API_KEY: 'gsk_TestGroqSecretKey_33333',
        EVOLUTION_API_KEY: 'wa_secret_api_key_44444',
        SPOTIFY_CLIENT_SECRET: 'spotify_secret_55555',
        MASTER_KEY: 'master_key_secret_66666',
        DATABASE_URL: 'sqlite:///data/bot.db',
        AUTH_TOKEN: 'bearer_token_77777',
        ADMIN_PASSWORD: 'admin_password_88888'
    };

    const clean = getSanitizedEnv(mockEnv);

    // Variables operativas deben mantenerse
    assert.strictEqual(clean.PATH, '/usr/bin:/bin');
    assert.strictEqual(clean.USER, 'petrov');
    assert.strictEqual(clean.HOME, '/home/petrov');
    assert.strictEqual(clean.SHELL, '/bin/bash');
    assert.strictEqual(clean.CUSTOM_VAR, 'diagnostico_ok');

    // Ningún secreto debe estar presente
    assert.strictEqual(clean.GEMINI_API_KEY, undefined);
    assert.strictEqual(clean.GEMINI_API_KEY_2, undefined);
    assert.strictEqual(clean.GEMINI_API_KEYS, undefined);
    assert.strictEqual(clean.GROQ_API_KEY, undefined);
    assert.strictEqual(clean.EVOLUTION_API_KEY, undefined);
    assert.strictEqual(clean.SPOTIFY_CLIENT_SECRET, undefined);
    assert.strictEqual(clean.MASTER_KEY, undefined);
    assert.strictEqual(clean.AUTH_TOKEN, undefined);
    assert.strictEqual(clean.ADMIN_PASSWORD, undefined);
});

test('Fix 1 (Terminal): executeBash no hereda GEMINI_API_KEY del proceso en subshell Bash', async () => {
    // Probar que el entorno hijo de Bash no puede leer ni exfiltrar la clave en texto ni en base64
    const res = await executeBash('echo -n "VAL:[$GEMINI_API_KEY]" && echo -n "$GEMINI_API_KEY" | base64');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.stdout.trim(), 'VAL:[]');
});


test('Fix 1b (Terminal Seguridad): executeBash no expone variables sensibles en texto ni base64', async () => {
    const resRaw = await executeBash('echo $GEMINI_API_KEY');
    assert.strictEqual(resRaw.success, true);
    assert.strictEqual(resRaw.stdout.trim(), '', 'echo $GEMINI_API_KEY debe estar vacío');

    const resB64 = await executeBash('echo -n $GEMINI_API_KEY | base64');
    assert.strictEqual(resB64.success, true);
    assert.strictEqual(resB64.stdout.trim(), '', 'echo -n $GEMINI_API_KEY | base64 debe estar vacío');
});

test('Fix 1c (Terminal Seguridad): executeBash tiene bloqueado el acceso a /home/petrov/botsky/.env en filesystem', async () => {
    const resCheck = await executeBash('test -r /home/petrov/botsky/.env && echo READABLE || echo BLOCKED');
    assert.strictEqual(resCheck.success, true);
    assert.strictEqual(resCheck.stdout.trim(), 'BLOCKED', 'test -r debe evaluar falso y reportar BLOCKED');

    const resCat = await executeBash('cat /home/petrov/botsky/.env');
    assert.strictEqual(resCat.success, false, 'cat .env debe fallar con código no-cero');
    assert.strictEqual(resCat.stdout.trim(), '', 'stdout no debe contener ningún dato');
    assert.ok(resCat.stderr.includes('Permission denied') || resCat.stderr.includes('denegado'), 'stderr debe indicar Permission denied');
});

test('Fix 1d (Terminal Seguridad): executeCommand con options.env forzado pasa obligatoriamente por getSanitizedEnv', async () => {
    const res = await executeCommand(['/bin/bash', '-c', 'echo "G:$GEMINI_API_KEY|E:$EVOLUTION_API_KEY|GR:$GROQ_API_KEY"'], {
        env: process.env
    });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.stdout.trim(), 'G:|E:|GR:', 'Ningún secreto debe sobrevivir aunque options.env sea process.env');
});

test('Fix 1e (Terminal Seguridad): executeBash permite ejecutar comandos normales del agente (id, pwd, uptime, git status, docker ps)', async () => {
    const resId = await executeBash('id');
    assert.strictEqual(resId.success, true);
    assert.ok(resId.stdout.includes('petrov'));

    const resPwd = await executeBash('pwd');
    assert.strictEqual(resPwd.success, true);
    assert.strictEqual(resPwd.stdout.trim(), '/home/petrov/botsky');

    const resUptime = await executeBash('uptime');
    assert.strictEqual(resUptime.success, true);
    assert.ok(resUptime.stdout.includes('load average'));

    const resGit = await executeBash('git status --short');
    assert.strictEqual(resGit.success, true);

    const resDocker = await executeBash('docker ps');
    assert.strictEqual(resDocker.success, true);
});

// ─── 2. Pruebas de LID y Autorización ─────────────────────────────────────────

test('Fix 2 (LID): cleanJidNumber rechaza identificadores @lid devolviendo cadena vacía (Fail-Closed)', () => {
    assert.strictEqual(cleanJidNumber('80530972373009@lid'), '');
    assert.strictEqual(cleanJidNumber('80530972373009:1@lid'), '');
    assert.strictEqual(cleanJidNumber('5215512345678@s.whatsapp.net'), '5215512345678');
});

test('Fix 2 (LID): getSenderJid extrae JID telefónico alternativo cuando participant es @lid', () => {
    const fromGroup = '120363045678901234@g.us';

    // 1. Con participantAlt
    const msgWithAlt = {
        key: {
            participant: '80530972373009@lid',
            participantAlt: '5215512345678@s.whatsapp.net'
        }
    };
    assert.strictEqual(getSenderJid(fromGroup, msgWithAlt), '5215512345678@s.whatsapp.net');

    // 2. Con senderPn
    const msgWithPn = {
        key: { participant: '80530972373009@lid' },
        senderPn: '5215587654321'
    };
    assert.strictEqual(getSenderJid(fromGroup, msgWithPn), '5215587654321');

    // 3. Con solo LID y sin campo alternativo -> devuelve el LID que cleanJidNumber invalidará
    const msgOnlyLid = {
        key: { participant: '80530972373009@lid' }
    };
    assert.strictEqual(getSenderJid(fromGroup, msgOnlyLid), '80530972373009@lid');
});

test('Fix 2 (LID): isAuthorizedAdmin autoriza por JID alternativo y falla cerrado si solo hay LID', () => {
    const origEnv = process.env.ALLOWED_NUMBERS_ADMIN;
    process.env.ALLOWED_NUMBERS_ADMIN = '5215512345678';

    try {
        const fromGroup = '120363045678901234@g.us';

        // Admin en grupo con LID + participantAlt telefónico válido
        const adminMsgWithAlt = {
            key: {
                participant: '80530972373009@lid',
                participantAlt: '5215512345678@s.whatsapp.net'
            }
        };
        assert.strictEqual(isAuthorizedAdmin(fromGroup, adminMsgWithAlt), true);

        // Admin en grupo con LID + senderPn telefónico válido
        const adminMsgWithPn = {
            key: { participant: '80530972373009@lid' },
            senderPn: '5215512345678'
        };
        assert.strictEqual(isAuthorizedAdmin(fromGroup, adminMsgWithPn), true);

        // Usuario en grupo con solo LID sin mapeo telefónico -> Fail-Closed
        const unmappedLidMsg = {
            key: { participant: '80530972373009@lid' }
        };
        assert.strictEqual(isAuthorizedAdmin(fromGroup, unmappedLidMsg), false);
    } finally {
        process.env.ALLOWED_NUMBERS_ADMIN = origEnv;
    }
});

test('Fix 2 (LID): normalizePhoneNumber unifica variantes móviles 521 vs 52 de México', () => {
    assert.strictEqual(normalizePhoneNumber('5215512345678'), '525512345678');
    assert.strictEqual(normalizePhoneNumber('525512345678'), '525512345678');
    assert.strictEqual(normalizePhoneNumber('14155552671'), '14155552671'); // USA sin cambio

    const origEnv = process.env.ALLOWED_NUMBERS_ADMIN;
    process.env.ALLOWED_NUMBERS_ADMIN = '5215512345678'; // Configurado con 521 (13 dígitos)

    try {
        // Recibido sin 1 móvil: 525512345678 (12 dígitos)
        assert.strictEqual(isAuthorizedAdmin('525512345678@s.whatsapp.net', {}), true);
    } finally {
        process.env.ALLOWED_NUMBERS_ADMIN = origEnv;
    }
});

// ─── 3. Pruebas de Concurrencia Bounded en Dispatcher ─────────────────────────

test('Fix 3 (Concurrencia): _aiLimiter limita llamadas concurrentes y procesa en cola', async () => {
    assert.ok(_aiLimiter, 'aiLimiter debe estar disponible en dispatcher');

    let currentRunning = 0;
    let maxObserved = 0;

    const task = async () => {
        currentRunning++;
        if (currentRunning > maxObserved) maxObserved = currentRunning;
        await new Promise(r => setTimeout(r, 50));
        currentRunning--;
    };

    // Lanzar 6 tareas simultáneas con límite
    const promises = [1, 2, 3, 4, 5, 6].map(() => _aiLimiter.run(task));
    await Promise.all(promises);

    assert.ok(maxObserved <= _aiLimiter.maxConcurrent, `La concurrencia máxima observada (${maxObserved}) no debe superar ${_aiLimiter.maxConcurrent}`);
    assert.strictEqual(currentRunning, 0, 'Al finalizar todas las tareas running debe ser 0');
});

// ─── 4. Pruebas de Failover Granular en Pool Gemini ───────────────────────────

test('Fix 4 (Gemini Pool): Error 400 NO hace failover a otras claves (no-retriable)', async () => {
    _resetPoolState();
    const originalPost = axios.post;
    let callsCount = 0;

    axios.post = async () => {
        callsCount++;
        const err = new Error('Request failed with status code 400');
        err.response = { status: 400, data: { error: { message: 'Invalid argument' } } };
        throw err;
    };

    const orig1 = process.env.GEMINI_API_KEY;
    const orig2 = process.env.GEMINI_API_KEY_2;
    try {
        process.env.GEMINI_API_KEY = 'AQ.Key1_111111111111111111111111111111111';
        process.env.GEMINI_API_KEY_2 = 'AQ.Key2_222222222222222222222222222222222';

        await assert.rejects(async () => {
            await callGemini({ userMessage: 'test' });
        });

        assert.strictEqual(callsCount, 1, 'Error 400 debe abortar de inmediato sin probar la clave 2');
    } finally {
        axios.post = originalPost;
        if (orig1) process.env.GEMINI_API_KEY = orig1; else delete process.env.GEMINI_API_KEY;
        if (orig2) process.env.GEMINI_API_KEY_2 = orig2; else delete process.env.GEMINI_API_KEY_2;
    }
});

test('Fix 4 (Gemini Pool): Error 403 (Forbidden) hace failover a la siguiente clave del pool', async () => {
    _resetPoolState();
    const originalPost = axios.post;
    let callsCount = 0;

    axios.post = async () => {
        callsCount++;
        if (callsCount === 1) {
            const err = new Error('Request failed with status code 403');
            err.response = { status: 403, data: { error: { message: 'Permission denied / Quota exceeded' } } };
            throw err;
        }
        return {
            data: {
                candidates: [{ content: { parts: [{ text: 'Exito con clave 2 tras 403' }] } }]
            }
        };
    };

    const orig1 = process.env.GEMINI_API_KEY;
    const orig2 = process.env.GEMINI_API_KEY_2;
    try {
        process.env.GEMINI_API_KEY = 'AQ.Key1_111111111111111111111111111111111';
        process.env.GEMINI_API_KEY_2 = 'AQ.Key2_222222222222222222222222222222222';

        const res = await callGemini({ userMessage: 'test' });
        assert.strictEqual(res, 'Exito con clave 2 tras 403');
        assert.strictEqual(callsCount, 2, 'Debió probar clave 2 tras error 403 en clave 1');
    } finally {
        axios.post = originalPost;
        if (orig1) process.env.GEMINI_API_KEY = orig1; else delete process.env.GEMINI_API_KEY;
        if (orig2) process.env.GEMINI_API_KEY_2 = orig2; else delete process.env.GEMINI_API_KEY_2;
    }
});

test('Fix 4 (Gemini Pool): Error 503 (Model Overloaded) hace failover a la siguiente clave del pool', async () => {
    _resetPoolState();
    const originalPost = axios.post;
    let callsCount = 0;

    axios.post = async () => {
        callsCount++;
        if (callsCount === 1) {
            const err = new Error('Request failed with status code 503');
            err.response = { status: 503, data: { error: { message: 'The model is overloaded' } } };
            throw err;
        }
        return {
            data: {
                candidates: [{ content: { parts: [{ text: 'Exito con clave 2 tras 503' }] } }]
            }
        };
    };

    const orig1 = process.env.GEMINI_API_KEY;
    const orig2 = process.env.GEMINI_API_KEY_2;
    try {
        process.env.GEMINI_API_KEY = 'AQ.Key1_111111111111111111111111111111111';
        process.env.GEMINI_API_KEY_2 = 'AQ.Key2_222222222222222222222222222222222';

        const res = await callGemini({ userMessage: 'test' });
        assert.strictEqual(res, 'Exito con clave 2 tras 503');
        assert.strictEqual(callsCount, 2, 'Debió probar clave 2 tras error 503 en clave 1');
    } finally {
        axios.post = originalPost;
        if (orig1) process.env.GEMINI_API_KEY = orig1; else delete process.env.GEMINI_API_KEY;
        if (orig2) process.env.GEMINI_API_KEY_2 = orig2; else delete process.env.GEMINI_API_KEY_2;
    }
});

// ─── 5. Pruebas de Prefijos Consistentes en Grupos ────────────────────────────

test('Fix 5 (Prefijos): Normalizador activa shouldDispatch con ! / # . y /@ en grupos', () => {
    const prefixes = ['/@terminal uptime', '!terminal uptime', '/terminal uptime', '#terminal uptime', '.terminal uptime', '!ayuda'];

    for (const text of prefixes) {
        const rawMsg = {
            key: {
                remoteJid: '120363045678901234@g.us', // Grupo
                participant: '5215512345678@s.whatsapp.net',
                id: 'PREF_TEST_' + Math.random()
            },
            message: { conversation: text }
        };

        const norm = normalizeIncomingMessage(rawMsg);
        assert.strictEqual(norm.shouldDispatch, true, `El comando "${text}" debe tener shouldDispatch: true en grupos`);
        assert.strictEqual(norm.hasPrefix, true, `El comando "${text}" debe tener hasPrefix: true`);
    }

    // Texto no-comando con puntos suspensivos en grupo no debe tener prefijo
    const normalChat = {
        key: {
            remoteJid: '120363045678901234@g.us',
            participant: '5215512345678@s.whatsapp.net',
            id: 'PREF_TEST_' + Math.random()
        },
        message: { conversation: '...hola gente' }
    };
    const normChat = normalizeIncomingMessage(normalChat);
    assert.strictEqual(normChat.hasPrefix, false, 'Puntos suspensivos en grupo no deben tener hasPrefix');
    assert.strictEqual(normChat.shouldDispatch, true, 'Mensajes naturales en grupo deben llegar al router IA');
});

// ─── 6. Pruebas de Menciones Nativas en Evolution / Recordatorios ──────────────

test('Fix 6 (Recordatorios): sendText serializa options.mentions para mención nativa de WhatsApp', async () => {
    const origPost = evolution.client.post;
    let capturedPayload = null;

    evolution.client.post = async (url, payload) => {
        capturedPayload = payload;
        return { data: { status: 'SUCCESS' } };
    };

    try {
        await evolution.sendText('120363045678901234@g.us', '¡Recordatorio! @5215512345678', {
            mentions: ['5215512345678@s.whatsapp.net']
        });

        assert.ok(capturedPayload, 'Debe enviar payload HTTP');
        assert.strictEqual(capturedPayload.number, '120363045678901234@g.us');
        assert.strictEqual(capturedPayload.options?.mentions?.everyOne, false);
        assert.deepStrictEqual(capturedPayload.options?.mentions?.mentioned, ['5215512345678@s.whatsapp.net']);
    } finally {
        evolution.client.post = origPost;
    }
});


// ─── 7. Pruebas de UX: Detección Automática de Intención VPS vs Chat ──────────

test('UX 1: Petición VPS sin prefijo en privado ("cómo está el servidor?") enruta a agent (terminal)', async () => {
    // Probar tanto con Gemini real/mock como con router
    const res = await routeWithAI('cómo está el servidor?', 'AdminUser', false, []);
    assert.ok(res, 'routeWithAI debe devolver decisión estructurada');
    assert.strictEqual(res.action, 'terminal', 'Petición sobre el servidor debe resolver action: terminal');
});

test('UX 2: Charla normal en privado ("hola qué haces?") enruta a chat sin invocar terminal', async () => {
    const res = await routeWithAI('hola qué haces?', 'Compa', false, []);
    assert.ok(res, 'routeWithAI debe devolver decisión estructurada');
    assert.strictEqual(res.action, 'chat', 'Charla casual debe resolver action: chat');
    assert.notStrictEqual(res.action, 'terminal');
});

test('UX 3: Comando explícito ("/@terminal uptime" o "!terminal uptime") enruta a agent', async () => {
    const rawMsg = {
        key: { remoteJid: '5215512345678@s.whatsapp.net', id: 'UX_EXPL_1' },
        message: { conversation: '/@terminal uptime' }
    };
    const norm = normalizeIncomingMessage(rawMsg);
    assert.strictEqual(norm.hasPrefix, true);
    assert.strictEqual(norm.text, 'terminal uptime');

    const res = await routeWithAI(norm.text, 'AdminUser', false, []);
    assert.strictEqual(res.action, 'terminal');
});

test('UX 4: Petición VPS en grupo sin prefijo ("qué contenedores Docker están activos?") enruta a agent', async () => {
    const rawMsg = {
        key: {
            remoteJid: '120363045678901234@g.us',
            participant: '5215512345678@s.whatsapp.net',
            id: 'UX_GRP_VPS_1'
        },
        message: { conversation: 'qué contenedores Docker están activos?' }
    };
    const norm = normalizeIncomingMessage(rawMsg);
    assert.strictEqual(norm.shouldDispatch, true, 'Mensaje natural en grupo debe despacharse al router');
    assert.strictEqual(norm.hasPrefix, false);

    const res = await routeWithAI(norm.text, 'AdminUser', true, []);
    assert.strictEqual(res.action, 'terminal', 'Consulta de Docker en grupo debe enrutar a terminal');
});

test('UX 5: Charla normal en grupo sin prefijo ("hola gente cómo andan?") enruta a ignore o chat y no a terminal', async () => {
    const rawMsg = {
        key: {
            remoteJid: '120363045678901234@g.us',
            participant: '5219999999999@s.whatsapp.net',
            id: 'UX_GRP_CHAT_1'
        },
        message: { conversation: 'hola gente cómo andan?' }
    };
    const norm = normalizeIncomingMessage(rawMsg);
    assert.strictEqual(norm.shouldDispatch, true);
    assert.strictEqual(norm.hasPrefix, false);

    const res = await routeWithAI(norm.text, 'UsuarioGrupo', true, []);
    assert.ok(res.action === 'ignore' || res.action === 'chat', 'Charla casual en grupo debe resolver ignore o chat');
    assert.notStrictEqual(res.action, 'terminal', 'No debe ejecutar terminal');
});

test('UX 6: Mensaje ambiguo con términos técnicos ("¿qué es Linux?") enruta a chat sin ejecutar terminal', async () => {
    // Preguntas teóricas o conceptuales NO deben ejecutar terminal en el VPS
    const resLinux = await routeWithAI('¿qué es Linux y para qué sirve?', 'Curioso', false, []);
    assert.strictEqual(resLinux.action, 'chat', 'Pregunta conceptual sobre Linux debe ser chat');

    const resServer = await routeWithAI('¿para qué sirve un servidor web?', 'Curioso', false, []);
    assert.strictEqual(resServer.action, 'chat', 'Pregunta conceptual sobre servidor debe ser chat');
});
