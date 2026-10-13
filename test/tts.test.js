'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const childProcess = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(childProcess.execFile);
const { generateVoiceNote, cleanTextForSpeech, resolveVoiceProfile } = require('../src/services/tts');

function ttsHarness({ edgeFails = false, elevenlabs = false } = {}) {
    const calls = [];
    const outputs = [];
    const module = { exports: {} };
    function audioSpawn(filename) {
        outputs.push(filename);
        return childProcess.spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=500:sample_rate=24000',
            '-t', '0.4', '-c:a', 'libmp3lame', '-b:a', '96k', filename]);
    }
    const deps = {
        child_process: { spawn(binary, args) {
            if (!['edge-tts', 'gtts-cli'].includes(binary)) return childProcess.spawn(binary, args);
            calls.push({ binary, args });
            if (binary === 'edge-tts' && edgeFails) {
                return childProcess.spawn(process.execPath, ['-e', 'process.stderr.write("synthetic provider unavailable");process.exit(1)']);
            }
            const flag = binary === 'edge-tts' ? '--write-media' : '--output';
            return audioSpawn(args[args.indexOf(flag) + 1]);
        } },
        fs, path,
        './logger': { info() {}, warn() {}, error() {} },
        './elevenlabs': { resolveElevenLabsVoiceId() { return 'synthetic-daniel'; },
            async generateElevenLabsVoiceNote(text, voice) {
                calls.push({ binary: 'elevenlabs', text, voice });
                if (!elevenlabs) throw new Error('Synthetic ElevenLabs unavailable');
                const filePath = path.join(os.tmpdir(), `botsky-tts-fixture-${Date.now()}-${Math.random()}.mp3`);
                await new Promise((resolve, reject) => {
                    const child = audioSpawn(filePath);
                    child.once('error', reject);
                    child.once('close', code => code === 0 ? resolve() : reject(new Error('Audio fixture failed')));
                });
                return { filePath, cleanup() { fs.rmSync(filePath, { force: true }); } };
            } }
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/services/tts.js'), 'utf8'), {
        module, exports: module.exports, Date, Math, Set, Buffer,
        process: { env: elevenlabs ? { ELEVENLABS_API_KEY: 'synthetic-tts-key' } : {} },
        require(id) { assert.ok(id in deps, `Missing TTS fixture dependency ${id}`); return deps[id]; }
    }, { filename: 'tts-fixture.js' });
    return { ...module.exports, calls, cleanup() { for (const output of outputs) fs.rmSync(output, { force: true }); } };
}

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

test('TTS: fallback explícito de proveedor fixture genera MP3 real y ejecuta cleanup', async t => {
    const harness = ttsHarness({ edgeFails: true });
    t.after(() => harness.cleanup());
    const { filePath, cleanup, profile, provider } = await harness.generateVoiceNote('Audio de prueba para tests', { voz: 'colombiano' });
    assert.ok(fs.existsSync(filePath), 'El archivo generado debe existir');
    assert.ok(fs.statSync(filePath).size > 1000, 'El archivo debe pesar más de 1KB');
    assert.ok(['edge-tts', 'elevenlabs', 'gtts'].includes(provider), `Provider ${provider} no esperado`);
    assert.strictEqual(provider, 'gtts');
    assert.deepStrictEqual(harness.calls.map(call => call.binary), ['edge-tts', 'gtts-cli']);
    const { stdout } = await execute('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', filePath]);
    assert.ok(Number(stdout.trim()) > 0);
    assert.strictEqual(profile.name, 'Colombiano Paisa');
    cleanup();
    assert.ok(!fs.existsSync(filePath), 'El archivo debe ser eliminado tras cleanup');
});

test('TTS: solicita daniel al adapter ElevenLabs fixture y conserva cleanup real', async t => {
    const harness = ttsHarness({ elevenlabs: true });
    t.after(() => harness.cleanup());
    const { filePath, cleanup, provider } = await harness.generateVoiceNote('Prueba corta para ElevenLabs', { voz: 'daniel' });
    assert.ok(fs.existsSync(filePath), 'El archivo generado por ElevenLabs debe existir');
    assert.strictEqual(provider, 'elevenlabs');
    assert.strictEqual(harness.calls[0].binary, 'elevenlabs');
    assert.strictEqual(harness.calls[0].voice, 'daniel');
    assert.ok(harness.calls[0].text.includes('Prueba corta'));
    cleanup();
    assert.ok(!fs.existsSync(filePath), 'El archivo debe ser eliminado tras cleanup');
});
