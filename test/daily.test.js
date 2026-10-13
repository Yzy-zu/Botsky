'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const db = require('../src/services/db');
const evolution = require('../src/services/evolution');
const { handleDaily, pickPrize, formatCooldownRemaining, PRIZES, ONE_DAY_MS, TWO_DAYS_MS } = require('../src/commands/daily');
const { normalizeIncomingMessage } = require('../src/core/message_normalizer');
const { isRegisteredCommand } = require('../src/core/commandRegistry');

test('Daily: commandRegistry reconoce los aliases de daily', () => {
    assert.strictEqual(isRegisteredCommand('daily'), true);
    assert.strictEqual(isRegisteredCommand('diario'), true);
    assert.strictEqual(isRegisteredCommand('ruletadiaria'), true);
    assert.strictEqual(isRegisteredCommand('recompensa'), true);
});

test('Daily: pickPrize mapea probabilidades correctamente con descripciones limpias', () => {
    const jackpot = pickPrize(1);
    assert.strictEqual(jackpot.baseXp, 1000);
    assert.ok(jackpot.title.includes('Premio mayor'));
    assert.ok(!jackpot.desc.includes('chicle'), 'Cero modismos nacos');

    const big = pickPrize(10);
    assert.strictEqual(big.baseXp, 300);

    const empty = pickPrize(98);
    assert.strictEqual(empty.baseXp, 0);
    assert.ok(empty.title.includes('Sin premio'));
});

test('Daily: formatCooldownRemaining calcula horas y minutos correctamente', () => {
    const text1 = formatCooldownRemaining(5 * 60 * 60 * 1000 + 30 * 60 * 1000);
    assert.strictEqual(text1, '5 horas y 30 minutos');

    const text2 = formatCooldownRemaining(45 * 60 * 1000);
    assert.strictEqual(text2, '45 minutos');
});

test('Daily: ciclo completo de primer reclamo, cooldown de 24h y racha consecutiva en SQLite', async () => {
    const testChat = `test_daily_chat_${Date.now()}@g.us`;
    const userJid = `52155${Date.now().toString().slice(-8)}@s.whatsapp.net`;
    const userName = 'JugadorEstrella';

    const sentMessages = [];
    const origPost = evolution.client.post;
    evolution.client.post = async (url, data) => {
        if (data && data.text) sentMessages.push(data.text);
        return { data: { status: 'SUCCESS' } };
    };

    try {
        const initialUser = await db.getOrCreateUser(userJid);
        const initialXp = initialUser.xp;

        // 1. Primer reclamo (racha = 1)
        const result = await handleDaily({}, testChat, { key: { participant: userJid }, pushName: userName });
        assert.ok(sentMessages.length > 0);
        assert.ok(sentMessages[0].includes('Tu daily'));

        const claim1 = await db.getDailyClaim(userJid);
        assert.ok(claim1);
        assert.strictEqual(claim1.streak, 1);
        assert.strictEqual(claim1.total_claims, 1);
        assert.equal(result.status, 'claimed');
        assert.equal(result.success, true);
        assert.equal((await db.getOrCreateUser(userJid)).xp - initialXp, result.xp_ganados);

        // 2. Intento inmediato antes de 24 horas -> Debe rechazar con cooldown
        sentMessages.length = 0;
        await handleDaily({}, testChat, { key: { participant: userJid }, pushName: userName });
        assert.ok(sentMessages.length > 0);
        assert.ok(sentMessages[0].includes('Tu giro ya salió'));
        assert.ok(sentMessages[0].includes('El siguiente está listo'));

        // 3. Simular que transcurrieron 25 horas (racha consecutiva exitosa -> racha = 2)
        const past25Hours = Date.now() - (25 * 60 * 60 * 1000);
        await db.recordDailyClaim(userJid, past25Hours, 1);

        sentMessages.length = 0;
        await handleDaily({}, testChat, { key: { participant: userJid }, pushName: userName });
        assert.ok(sentMessages.length > 0);
        assert.ok(sentMessages[0].includes('Tu daily'));

        const claim2 = await db.getDailyClaim(userJid);
        assert.strictEqual(claim2.streak, 2);
        assert.ok(claim2.total_claims >= 2);

        // 4. Simular que transcurrieron 55 horas (>48h) -> La racha se reinicia a 1
        const past55Hours = Date.now() - (55 * 60 * 60 * 1000);
        await db.recordDailyClaim(userJid, past55Hours, 5); // Tenía racha 5

        sentMessages.length = 0;
        await handleDaily({}, testChat, { key: { participant: userJid }, pushName: userName });
        assert.ok(sentMessages.length > 0);

        const claim3 = await db.getDailyClaim(userJid);
        assert.strictEqual(claim3.streak, 1, 'Racha debe reiniciarse a 1 después de 48h');
    } finally {
        evolution.client.post = origPost;
    }
});

test('Daily: normalizador conserva frases sin prefijo para interpretación semántica', () => {
    const msg1 = normalizeIncomingMessage({
        key: { remoteJid: 'test_group@g.us', participant: '123@s.whatsapp.net', fromMe: false, id: 'd1' },
        message: { conversation: 'mi daily' },
        pushName: 'User1'
    });
    assert.ok(msg1);
    assert.strictEqual(msg1.text, 'mi daily');
    assert.strictEqual(msg1.hasPrefix, false);

    const msg2 = normalizeIncomingMessage({
        key: { remoteJid: 'test_group@g.us', participant: '123@s.whatsapp.net', fromMe: false, id: 'd2' },
        message: { conversation: 'ruleta diaria' },
        pushName: 'User1'
    });
    assert.ok(msg2);
    assert.strictEqual(msg2.text, 'ruleta diaria');

    const msg3 = normalizeIncomingMessage({
        key: { remoteJid: 'test_group@g.us', participant: '123@s.whatsapp.net', fromMe: false, id: 'd3' },
        message: { conversation: 'girar ruleta diaria' },
        pushName: 'User1'
    });
    assert.ok(msg3);
    assert.strictEqual(msg3.text, 'girar ruleta diaria');
});
