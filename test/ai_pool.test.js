'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {harness}=require('./aiOfflineHarness.test');
const h=harness({env:{GEMINI_API_KEY:'offline-pool-key-long'}});
const env=h.env;const axios=h.http;
const {maskKey,getNextApiKey,markKeyCooldown,isRateLimitError,getConfiguredApiKeys,callGemini,_keyStateMap,_resetPoolState}=h.ai;

test('AI-Pool: maskKey enmascara claves y nunca expone el secreto completo', () => {
    const fullKey = 'AQ.MockKeyTestSample1234567890abcdefghijklmnopqrstuvwxyz9999';
    const masked = maskKey(fullKey);

    assert.strictEqual(masked.startsWith('AQ.Moc...'), true);
    assert.strictEqual(masked.endsWith('9999'), true);
    assert.strictEqual(masked.includes('KeyTestSample1234567890abcdefghijklmnopqrstuvwxyz'), false, 'No debe contener el cuerpo secreto');
    assert.strictEqual(maskKey(''), 'none');
    assert.strictEqual(maskKey(null), 'none');
    assert.strictEqual(maskKey('12345'), '***');
});

test('AI-Pool: getConfiguredApiKeys detecta hasta 3 claves configuradas', () => {
    const keys = getConfiguredApiKeys();
    assert.ok(Array.isArray(keys));
    assert.ok(keys.length >= 1, 'Debe haber al menos 1 clave configurada');
    // Verificar que ninguna clave esté vacía
    for (const k of keys) {
        assert.ok(k && k.length > 10, 'La clave debe ser válida y no vacía');
    }
});

test('AI-Pool: rotación Round-Robin cíclica entre 3 claves simuladas', () => {
    _resetPoolState();
    const mockKeys = [
        'AQ.TestKeyOne_111111111111111111111111111111111111',
        'AQ.TestKeyTwo_222222222222222222222222222222222222',
        'AQ.TestKeyThree_3333333333333333333333333333333333'
    ];

    const pick1 = getNextApiKey(mockKeys);
    const pick2 = getNextApiKey(mockKeys);
    const pick3 = getNextApiKey(mockKeys);
    const pick4 = getNextApiKey(mockKeys); // Debe volver a la primera

    assert.strictEqual(pick1, mockKeys[0], 'Primer llamado debe ser Key 1');
    assert.strictEqual(pick2, mockKeys[1], 'Segundo llamado debe ser Key 2');
    assert.strictEqual(pick3, mockKeys[2], 'Tercer llamado debe ser Key 3');
    assert.strictEqual(pick4, mockKeys[0], 'Cuarto llamado debe ser cíclico (Key 1)');
});

test('AI-Pool: comportamiento transparente cuando solamente existe 1 clave', () => {
    _resetPoolState();
    const singleKey = ['AQ.OnlyOneKey_1111111111111111111111111111111111'];

    assert.strictEqual(getNextApiKey(singleKey), singleKey[0]);
    assert.strictEqual(getNextApiKey(singleKey), singleKey[0]);
    assert.strictEqual(getNextApiKey(singleKey), singleKey[0]);
});

test('AI-Pool: cooldown automático tras error 429 y salto a clave disponible', () => {
    _resetPoolState();
    const mockKeys = [
        'AQ.KeyFailing429_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        'AQ.KeyAvailable2_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        'AQ.KeyAvailable3_CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'
    ];

    // Marcar Key 1 con 429
    markKeyCooldown(mockKeys[0], 30000); // 30 segundos de cooldown

    // Los siguientes llamados deben rotar únicamente entre Key 2 y Key 3
    const call1 = getNextApiKey(mockKeys);
    const call2 = getNextApiKey(mockKeys);
    const call3 = getNextApiKey(mockKeys);

    assert.notStrictEqual(call1, mockKeys[0], 'Key 1 no debe ser elegida mientras esté en cooldown');
    assert.notStrictEqual(call2, mockKeys[0], 'Key 1 no debe ser elegida mientras esté en cooldown');
    assert.notStrictEqual(call3, mockKeys[0], 'Key 1 no debe ser elegida mientras esté en cooldown');
    assert.ok([mockKeys[1], mockKeys[2]].includes(call1));
    assert.ok([mockKeys[1], mockKeys[2]].includes(call2));
});

test('AI-Pool: recuperación de una clave tras expirar su cooldown', () => {
    _resetPoolState();
    const mockKeys = [
        'AQ.RecoverableKey_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        'AQ.AnotherKey___BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
    ];

    // Simular un cooldown que ya expiró en el pasado
    _keyStateMap.set(mockKeys[0], {
        cooldownUntil: h.now - 500, // Expiró hace medio segundo
        failures: 1
    });

    const chosen = getNextApiKey(mockKeys);
    // Debe poder ser elegida nuevamente porque su cooldown ya pasó
    assert.ok(mockKeys.includes(chosen));
    const chosen2 = getNextApiKey(mockKeys);
    assert.ok(mockKeys.includes(chosen2));
});

test('AI-Pool: isRateLimitError identifica códigos 429 y RESOURCE_EXHAUSTED', () => {
    assert.strictEqual(isRateLimitError({ response: { status: 429 } }), true);
    assert.strictEqual(isRateLimitError({ response: { data: { error: { code: 429 } } } }), true);
    assert.strictEqual(isRateLimitError({ response: { data: { error: { status: 'RESOURCE_EXHAUSTED' } } } }), true);
    assert.strictEqual(isRateLimitError(new Error('Request failed with status code 429')), true);

    // Errores que NO son rate limit
    assert.strictEqual(isRateLimitError({ response: { status: 400 } }), false);
    assert.strictEqual(isRateLimitError({ response: { status: 500 } }), false);
    assert.strictEqual(isRateLimitError(new Error('Network timeout')), false);
    assert.strictEqual(isRateLimitError(null), false);
});

test('AI-Pool: getConfiguredApiKeys soporta 1, 2, 3 o ninguna clave de forma independiente', () => {
    const savedKeys = {};
    for (const k of Object.keys(env)) {
        if (k.startsWith('GEMINI_API_KEY')) {
            savedKeys[k] = env[k];
            delete env[k];
        }
    }

    try {
        // 1. Ninguna clave
        assert.deepStrictEqual(JSON.parse(JSON.stringify(getConfiguredApiKeys())), [], 'Sin variables debe devolver array vacío');

        // 2. Solo GEMINI_API_KEY_2 (segunda clave únicamente)
        env.GEMINI_API_KEY_2 = 'AQ.OnlyKeyTwo_222222222222222222222222222222222';
        assert.deepStrictEqual(JSON.parse(JSON.stringify(getConfiguredApiKeys())), ['AQ.OnlyKeyTwo_222222222222222222222222222222222']);

        // 3. Dos claves: GEMINI_API_KEY_2 y GEMINI_API_KEY_3
        env.GEMINI_API_KEY_3 = 'AQ.OnlyKeyThree_33333333333333333333333333333333';
        assert.deepStrictEqual(JSON.parse(JSON.stringify(getConfiguredApiKeys())), [
            'AQ.OnlyKeyTwo_222222222222222222222222222222222',
            'AQ.OnlyKeyThree_33333333333333333333333333333333'
        ]);

        // 4. Tres claves completas
        env.GEMINI_API_KEY = 'AQ.OnlyKeyOne_111111111111111111111111111111111';
        assert.deepStrictEqual(JSON.parse(JSON.stringify(getConfiguredApiKeys())), [
            'AQ.OnlyKeyOne_111111111111111111111111111111111',
            'AQ.OnlyKeyTwo_222222222222222222222222222222222',
            'AQ.OnlyKeyThree_33333333333333333333333333333333'
        ]);
    } finally {
        for (const k of Object.keys(env)) {
            if (k.startsWith('GEMINI_API_KEY')) delete env[k];
        }
        for (const [k, v] of Object.entries(savedKeys)) {
            env[k] = v;
        }
    }
});

test('AI-Pool: simulación HTTP de error 429 con Axios mock -> reintento con siguiente clave del pool, sin key en URL y con x-goog-api-key correcto', async () => {
    _resetPoolState();
    const originalPost = axios.post;

    const requestedUrls = [];
    const usedHeaders = [];
    const mockKeys = [
        'AQ.TestKeyOne_111111111111111111111111111111111111',
        'AQ.TestKeyTwo_222222222222222222222222222222222222'
    ];

    let callCount = 0;
    axios.post = async (url, payload, config) => {
        callCount++;
        requestedUrls.push(url);
        usedHeaders.push(config.headers);

        if (callCount === 1) {
            const error = new Error('Request failed with status code 429');
            error.response = {
                status: 429,
                data: {
                    error: {
                        code: 429,
                        message: 'Resource has been exhausted (check quota).',
                        status: 'RESOURCE_EXHAUSTED'
                    }
                }
            };
            throw error;
        }

        return {
            data: {
                candidates: [
                    {
                        content: {
                            parts: [{ text: 'Respuesta simulada exitosa de Gemini con segunda clave' }]
                        }
                    }
                ]
            }
        };
    };

    const savedKeys = {};
    for (const k of Object.keys(env)) {
        if (k.startsWith('GEMINI_API_KEY')) {
            savedKeys[k] = env[k];
            delete env[k];
        }
    }

    try {
        env.GEMINI_API_KEY = mockKeys[0];
        env.GEMINI_API_KEY_2 = mockKeys[1];

        const result = await callGemini({
            userMessage: 'Test de failover por 429',
            temperature: 0.2
        });

        // 1. Verificación de resultado exitoso tras reintento
        assert.strictEqual(result, 'Respuesta simulada exitosa de Gemini con segunda clave');
        assert.strictEqual(callCount, 2, 'Debieron ejecutarse exactamente 2 llamadas HTTP (intento 1 falló con 429, intento 2 tuvo éxito)');

        // 2. Verificación estricta de URLs (sin ?key= ni secretos)
        for (const u of requestedUrls) {
            assert.strictEqual(u.includes('?key='), false, `La URL no debe tener ?key=: ${u}`);
            assert.strictEqual(u.includes(mockKeys[0]), false, `La URL no debe exponer la Key 1: ${u}`);
            assert.strictEqual(u.includes(mockKeys[1]), false, `La URL no debe exponer la Key 2: ${u}`);
            assert.strictEqual(u.endsWith(':generateContent'), true, `La URL debe terminar limpiamente en :generateContent: ${u}`);
        }

        // 3. Verificación del header 'x-goog-api-key' en ambos intentos
        assert.strictEqual(usedHeaders[0]['x-goog-api-key'], mockKeys[0], 'El primer intento debió enviar Key 1 en x-goog-api-key');
        assert.strictEqual(usedHeaders[1]['x-goog-api-key'], mockKeys[1], 'El segundo intento debió enviar Key 2 en x-goog-api-key');

        // 4. Verificación de que la primera clave quedó en cooldown
        const state1 = _keyStateMap.get(mockKeys[0]);
        assert.ok(state1, 'Debe existir registro en _keyStateMap para Key 1');
        assert.ok(state1.cooldownUntil > h.now, 'Key 1 debe tener cooldown activo');
        assert.strictEqual(state1.failures, 1, 'Key 1 debe registrar 1 fallo acumulado');

        // 5. Verificación de que la segunda clave NO quedó en cooldown
        const state2 = _keyStateMap.get(mockKeys[1]);
        assert.ok(!state2 || state2.cooldownUntil <= h.now, 'Key 2 no debe estar en cooldown');

    } finally {
        axios.post = originalPost;
        for (const k of Object.keys(env)) {
            if (k.startsWith('GEMINI_API_KEY')) delete env[k];
        }
        for (const [k, v] of Object.entries(savedKeys)) {
            env[k] = v;
        }
    }
});

test('AI-Pool: backoff exponencial escala los cooldowns ante 429 repetidos (15s -> 30s -> 60s -> 120s)', () => {
    _resetPoolState();
    const testKey = 'AQ.BackoffKey_Test12345678901234567890123456789';

    // Fallo 1 (prev=0): 15s * 2^0 = 15s (15000ms)
    markKeyCooldown(testKey, 15000, 'Rate Limit 429', true);
    let state = _keyStateMap.get(testKey);
    assert.strictEqual(state.failures, 1);
    let remaining = state.cooldownUntil - h.now;
    assert.ok(remaining >= 14000 && remaining <= 16000, `Debe rondar 15s, got ${remaining}ms`);

    // Fallo 2 (prev=1): 15s * 2^1 = 30s (30000ms)
    markKeyCooldown(testKey, 15000, 'Rate Limit 429', true);
    state = _keyStateMap.get(testKey);
    assert.strictEqual(state.failures, 2);
    remaining = state.cooldownUntil - h.now;
    assert.ok(remaining >= 29000 && remaining <= 31000, `Debe rondar 30s, got ${remaining}ms`);

    // Fallo 3 (prev=2): 15s * 2^2 = 60s (60000ms)
    markKeyCooldown(testKey, 15000, 'Rate Limit 429', true);
    state = _keyStateMap.get(testKey);
    assert.strictEqual(state.failures, 3);
    remaining = state.cooldownUntil - h.now;
    assert.ok(remaining >= 59000 && remaining <= 61000, `Debe rondar 60s, got ${remaining}ms`);

    // Fallo 4 (prev=3): 15s * 2^3 = 120s (cap máximo 120000ms)
    markKeyCooldown(testKey, 15000, 'Rate Limit 429', true);
    state = _keyStateMap.get(testKey);
    assert.strictEqual(state.failures, 4);
    remaining = state.cooldownUntil - h.now;
    assert.ok(remaining >= 119000 && remaining <= 121000, `Debe rondar 120s, got ${remaining}ms`);

    // Fallo 5 (prev=4): sigue con cap en 120s
    markKeyCooldown(testKey, 15000, 'Rate Limit 429', true);
    state = _keyStateMap.get(testKey);
    assert.strictEqual(state.failures, 5);
    remaining = state.cooldownUntil - h.now;
    assert.ok(remaining >= 119000 && remaining <= 121000, `Debe topar en 120s, got ${remaining}ms`);
});

