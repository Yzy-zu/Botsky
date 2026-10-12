'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { transcribeAudio, summarizeTranscription } = require('../src/services/whisper');

test('Whisper: transcribeAudio transcribe archivo de audio con Groq', async () => {
    const audioPath = '/tmp/test_dalia.ogg';
    if (!fs.existsSync(audioPath)) {
        return; // Saltear si no existe archivo de prueba temporal
    }

    const result = await transcribeAudio(audioPath);
    assert.ok(result);
    assert.ok(typeof result.text === 'string');
    assert.ok(result.text.length > 0);
    assert.ok(result.provider === 'groq-whisper' || result.provider === 'gemini-fallback');
    assert.ok(result.elapsedMs < 5000); // Debe ser ultra rápido (< 5s en Groq)
});

test('Whisper: summarizeTranscription genera resumen conciso para audios extensos', async () => {
    const sampleText = 'Hola compa, te aviso que ya revisamos los reportes de la base de datos y encontramos que el servidor se estaba reiniciando por falta de memoria RAM. Ya ajustamos los límites del pool de conexiones y reiniciamos el servicio de base de datos. Mañana a primera hora confirmamos que todo siga estable.';
    const summary = await summarizeTranscription(sampleText);
    assert.ok(summary);
    assert.ok(typeof summary === 'string');
    assert.ok(summary.length > 10);
});
