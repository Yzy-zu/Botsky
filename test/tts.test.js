'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { generateVoiceNote, cleanTextForSpeech, resolveVoiceProfile } = require('../src/services/tts');

test('TTS: limpia emojis y markdown para síntesis de voz', () => {
    const raw = '*Hola* _compa_ 😄 https://ejemplo.com ¿cómo estás?';
    const clean = cleanTextForSpeech(raw);
    assert.strictEqual(clean, 'Hola compa ¿cómo estás?');
});

test('TTS: resuelve perfiles regionales y de efectos correctamente', () => {
    assert.strictEqual(resolveVoiceProfile({ voz: 'loquendo' }).name, 'Loquendo Clásico (España)');
    assert.strictEqual(resolveVoiceProfile({ voz: 'goku' }).name, 'Goku');
    assert.strictEqual(resolveVoiceProfile({ voz: 'dross' }).name, 'Dross Rotzank');
    assert.strictEqual(resolveVoiceProfile({ voz: 'babidi' }).name, 'Babidi');
    assert.strictEqual(resolveVoiceProfile({ voz: 'donramon' }).name, 'Don Ramón');
    assert.strictEqual(resolveVoiceProfile({ voz: 'colombiano' }).name, 'Colombiano Paisa');
    assert.strictEqual(resolveVoiceProfile({ voz: 'argentino' }).name, 'Argentino Che');
    assert.strictEqual(resolveVoiceProfile({ voz: 'ardilla' }).name, 'Ardilla Alvin');
    assert.strictEqual(resolveVoiceProfile({ voz: 'demonio' }).name, 'Demonio Ultratumba');
    assert.strictEqual(resolveVoiceProfile({ voz: 'anime' }).name, 'Mona China Cute');
    assert.strictEqual(resolveVoiceProfile({ voz: 'hombre' }).name, 'Botsky (México)');
});

test('TTS: genera archivo de audio mp3 con fallback resiliente y ejecuta cleanup', async () => {
    const { filePath, cleanup, profile, provider } = await generateVoiceNote('Audio de prueba para tests', { voz: 'colombiano' });
    assert.ok(fs.existsSync(filePath), 'El archivo generado debe existir');
    assert.ok(fs.statSync(filePath).size > 1000, 'El archivo debe pesar más de 1KB');
    assert.ok(['edge-tts', 'elevenlabs', 'gtts'].includes(provider), `Provider ${provider} no esperado`);
    assert.strictEqual(profile.name, 'Colombiano Paisa');
    cleanup();
    assert.ok(!fs.existsSync(filePath), 'El archivo debe ser eliminado tras cleanup');
});

test('TTS: genera archivo de audio con ElevenLabs cuando se solicita daniel', async () => {
    if (!process.env.ELEVENLABS_API_KEY) return;
    const { filePath, cleanup, provider } = await generateVoiceNote('Prueba corta para ElevenLabs', { voz: 'daniel' });
    assert.ok(fs.existsSync(filePath), 'El archivo generado por ElevenLabs debe existir');
    assert.strictEqual(provider, 'elevenlabs');
    cleanup();
    assert.ok(!fs.existsSync(filePath), 'El archivo debe ser eliminado tras cleanup');
});
