'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('node:os');
const vm = require('node:vm');
const { promisify } = require('node:util');
const execute = promisify(require('node:child_process').execFile);
function whisperFixture() {
    const calls = [];
    const module = { exports: {} };
    const dependencies = { fs, 'form-data': require('form-data'), './logger': { info() {}, warn() {}, error() {} },
        axios: { async post(url, payload, options) {
            calls.push({ url, payload, options });
            assert.equal(options.headers.Authorization, 'Bearer synthetic-groq-key');
            if (url.endsWith('/audio/transcriptions')) {
                assert.ok(payload.getHeaders()['content-type'].includes('multipart/form-data'));
                // Consume the real multipart stream while faking only the HTTP provider.
                await new Promise((resolve, reject) => { payload.on('error', reject); payload.on('end', resolve); payload.resume(); });
                return { data: { text: 'Texto de audio sintético confirmado', duration: 0.4, language: 'es' } };
            }
            assert.ok(url.endsWith('/chat/completions'));
            assert.ok(payload.messages[1].content.includes('servidor'));
            return { data: { choices: [{ message: { content: '• Se corrigió la memoria del servidor.\n• Mañana se verifica estabilidad.' } }] } };
        } } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/services/whisper.js'), 'utf8'), {
        module, exports: module.exports, Date, Buffer,
        process: { env: { GROQ_API_KEY: 'synthetic-groq-key' } },
        require(id) { assert.ok(id in dependencies, `Missing Whisper fixture dependency ${id}`); return dependencies[id]; }
    }, { filename: 'whisper-offline.js' });
    return { ...module.exports, calls };
}

test('Whisper: transcribeAudio envía audio sintético real a proveedor Groq fixture', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'botsky-whisper-fixture-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const audioPath = path.join(directory, 'synthetic.ogg');
    await execute('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=500:sample_rate=24000', '-t', '0.4', audioPath]);
    const harness = whisperFixture();

    const result = await harness.transcribeAudio(audioPath);
    assert.ok(result);
    assert.ok(typeof result.text === 'string');
    assert.ok(result.text.length > 0);
    assert.ok(result.provider === 'groq-whisper' || result.provider === 'gemini-fallback');
    assert.ok(result.elapsedMs < 5000); // Debe ser ultra rápido (< 5s en Groq)
    assert.equal(result.text, 'Texto de audio sintético confirmado');
    assert.equal(result.duration, 0.4);
    assert.equal(harness.calls.length, 1);
});

test('Whisper: summarizeTranscription genera resumen conciso para audios extensos', async () => {
    const sampleText = 'Hola compa, te aviso que ya revisamos los reportes de la base de datos y encontramos que el servidor se estaba reiniciando por falta de memoria RAM. Ya ajustamos los límites del pool de conexiones y reiniciamos el servicio de base de datos. Mañana a primera hora confirmamos que todo siga estable.';
    const harness = whisperFixture();
    const summary = await harness.summarizeTranscription(sampleText);
    assert.ok(summary);
    assert.ok(typeof summary === 'string');
    assert.ok(summary.length > 10);
    assert.ok(harness.calls[0].payload.messages[1].content.includes(sampleText));
    assert.equal(harness.calls.length, 1);
});
