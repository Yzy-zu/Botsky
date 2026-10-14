'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createVoiceMedia, cleanTextForSpeech, resolveVoice } = require('../../../../src/v2/adapters/media/voice');

async function fixture(options = {}) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-media-test-'));
    const tempDirectory = path.join(root, 'botsky-v2-media');
    const calls = [];
    let probeCount = 0;
    const run = async (command, args, runOptions) => {
        calls.push({ command, args, options: runOptions });
        if (options.run) return options.run(command, args, runOptions, calls);
        if (command === 'ffprobe') {
            probeCount++;
            return { stdout: options.durations?.[probeCount - 1] || '8.0' };
        }
        await fs.writeFile(args.at(-1), Buffer.from(`generated:${command}`));
        return { stdout: '' };
    };
    const adapter = createVoiceMedia({
        tempDirectory, run, callLLM: options.callLLM,
        elevenLabs: options.elevenLabs,
        ...options.adapter
    });
    return { adapter, calls, root, tempDirectory };
}

test('clean text and profile resolution preserve legacy aliases and filter behavior', () => {
    assert.equal(cleanTextForSpeech(' **Hola** https://example.test/a 😃 mundo_~ '), 'Hola mundo');
    assert.equal(resolveVoice('_alvin').key, 'ardilla');
    assert.equal(resolveVoice('paisa').profile.voice, 'es-CO-GonzaloNeural');
    assert.equal(resolveVoice('anime').profile.pitch, '+16Hz');
    assert.equal(resolveVoice('daniel').key, 'daniel');
    assert.equal(resolveVoice('humana').key, 'humana');
    assert.equal(resolveVoice('luisito').key, 'luisito');
    assert.equal(resolveVoice('unknown').key, 'hombre');
});

test('verbatim preparation bypasses the LLM and preserves literal wording', async t => {
    const f = await fixture(); t.after(() => fs.rm(f.root, { recursive: true, force: true }));
    const script = await f.adapter.prepareScript({ request: 'léelo exacto', literalText: '  Hola, mundo.  ', mode: 'verbatim', voice: 'mujer', durationSeconds: 10 }, new AbortController().signal);
    assert.deepEqual(script, { success: true, mode: 'verbatim', text: 'Hola, mundo.', voice: 'mujer', durationSeconds: 10 });
    assert.equal(f.calls.length, 0);
    const atLegacyBounds = await f.adapter.prepareScript({ literalText: 'x'.repeat(20000), mode: 'verbatim', durationSeconds: 600 }, new AbortController().signal);
    assert.equal(atLegacyBounds.text.length, 20000);
    assert.equal(atLegacyBounds.durationSeconds, 600);
    const overText = await f.adapter.prepareScript({ literalText: 'x'.repeat(20001), mode: 'verbatim' }, new AbortController().signal);
    assert.equal(overText.success, false);
    const overDuration = await f.adapter.prepareScript({ literalText: 'exact', mode: 'verbatim', durationSeconds: 601 }, new AbortController().signal);
    assert.equal(overDuration.needsClarification, true);
});

test('compose script sends bounded semantic context to the injected LLM and validates response', async t => {
    let request;
    const f = await fixture({ callLLM: async input => {
        request = input;
        return JSON.stringify({ mode: 'compose', text: 'Buenos días, equipo.', voice: 'hombre', durationSeconds: null });
    } });
    t.after(() => fs.rm(f.root, { recursive: true, force: true }));
    const script = await f.adapter.prepareScript({ request: 'manda un audio sobre la reunión', mode: 'compose', voice: 'hombre',
        durationSeconds: 15, history: Array.from({ length: 10 }, (_, i) => ({ role: 'user', content: `h${i}` })), quotedText: 'el martes', userName: 'Ana', isGroup: true }, new AbortController().signal);
    assert.equal(script.success, true);
    assert.equal(script.text, 'Buenos días, equipo.');
    assert.equal(script.durationSeconds, 15);
    assert.equal(request.maxOutputTokens, 800);
    const context = JSON.parse(request.user);
    assert.equal(context.historial.length, 8);
    assert.equal(context.cita, 'el martes');
    assert.match(request.system, /únicamente el texto que se pronunciará/);
    assert.equal((await f.adapter.prepareScript({ request: 'audio', mode: 'compose' }, new AbortController().signal)).success, true);
});

test('compose asks for clarification on missing context and rejects malformed or echoed scripts', async t => {
    const f = await fixture({ callLLM: async () => JSON.stringify({ mode: 'compose', text: 'manda audio', voice: 'hombre' }) });
    t.after(() => fs.rm(f.root, { recursive: true, force: true }));
    assert.equal((await f.adapter.prepareScript({ mode: 'compose' }, new AbortController().signal)).needsClarification, true);
    const echo = await f.adapter.prepareScript({ request: 'manda audio', mode: 'compose' }, new AbortController().signal);
    assert.equal(echo.success, false);
    assert.match(echo.error, /separar/);
});

test('synthesis uses safe edge-tts argv, cleans speech text, applies legacy voice filters and retains a releasable output', async t => {
    const f = await fixture(); t.after(() => fs.rm(f.root, { recursive: true, force: true }));
    const result = await f.adapter.synthesize('**Hola** https://example.test 😃', { voice: 'ardilla', signal: new AbortController().signal });
    assert.equal(result.mime, 'audio/mpeg');
    const edge = f.calls.find(call => call.command === 'edge-tts');
    assert.ok(edge.args.includes('--text=Hola'));
    assert.ok(f.calls.some(call => call.command === 'ffmpeg' && call.args.includes('asetrate=24000*1.45,aresample=24000,atempo=1/1.2')));
    assert.ok(await fs.stat(result.ref));
    assert.equal(await f.adapter.release(result.ref), true);
    assert.deepEqual(await fs.readdir(f.tempDirectory), []);
});

test('TTS keeps option-looking user text inside the text argument for Edge and gTTS', async t => {
    const payload = '--file=/synthetic/private';
    const edge = await fixture(); t.after(() => fs.rm(edge.root, { recursive: true, force: true }));
    await edge.adapter.synthesize(payload, { voice: 'hombre', signal: new AbortController().signal });
    assert.ok(edge.calls.some(call => call.command === 'edge-tts' && call.args.includes(`--text=${payload}`)));

    const fallback = await fixture({ run: async (command, args) => {
        if (command === 'edge-tts') throw Error('synthetic edge failure');
        await fs.writeFile(args[args.indexOf('--output') + 1], Buffer.from('fallback')); return {};
    } });
    t.after(() => fs.rm(fallback.root, { recursive: true, force: true }));
    await fallback.adapter.synthesize(payload, { voice: 'hombre', signal: new AbortController().signal });
    assert.deepEqual(fallback.calls.find(call => call.command === 'gtts-cli').args.slice(-2), ['--', payload]);
});

test('professional/persona voices prefer optional ElevenLabs; failures fall back to Edge then gTTS', async t => {
    const preferred = await fixture({ elevenLabs: async (text, voice) => {
        assert.equal(text, 'Hola'); assert.equal(voice, 'goku'); return Buffer.from('elevenlabs audio');
    } });
    t.after(() => fs.rm(preferred.root, { recursive: true, force: true }));
    const result = await preferred.adapter.synthesize('Hola', { voice: 'goku', signal: new AbortController().signal });
    assert.equal(preferred.calls.some(call => call.command === 'edge-tts'), false);
    assert.equal(result.mime, 'audio/mpeg');

    const fallback = await fixture({ run: async (command, args) => {
        if (command === 'edge-tts') throw new Error('offline edge');
        await fs.writeFile(args[args.indexOf('--output') + 1], Buffer.from('fallback')); return {};
    } });
    t.after(() => fs.rm(fallback.root, { recursive: true, force: true }));
    const backup = await fallback.adapter.synthesize('Hola', { voice: 'hombre', signal: new AbortController().signal });
    assert.ok(fallback.calls.some(call => call.command === 'gtts-cli'));
    assert.deepEqual(fallback.calls.find(call => call.command === 'gtts-cli').args.slice(-2), ['--', 'Hola']);
    assert.equal(backup.mime, 'audio/mpeg');
});

test('duration measurement and fitting use bounded ffprobe/ffmpeg filters and honor adjustment bounds', async t => {
    const f = await fixture({ durations: ['10.8', '10.1', '10.1'] }); t.after(() => fs.rm(f.root, { recursive: true, force: true }));
    const media = await f.adapter.synthesize('Hola', { voice: 'hombre', signal: new AbortController().signal });
    const fitted = await f.adapter.fitDuration(media, 10, new AbortController().signal);
    assert.equal(fitted.durationSeconds, 10.1);
    assert.match(fitted.ref, /voice-timed\.mp3$/);
    const ffmpeg = f.calls.find(call => call.command === 'ffmpeg');
    assert.ok(ffmpeg.args.some(arg => typeof arg === 'string' && /^atempo=1\.080000$/.test(arg)));
    assert.ok(f.calls.filter(call => call.command === 'ffprobe').every(call => call.options.timeoutMs === 15_000));
    const outOfBounds = await f.adapter.fitDuration(media, 20, new AbortController().signal);
    assert.equal(outOfBounds.durationSeconds, 10.1);
    assert.equal(outOfBounds.ref, media.ref, 'extreme time changes return the original, measured audio');
    const maxDuration = await f.adapter.fitDuration(media, 600, new AbortController().signal);
    assert.equal(maxDuration.ref, media.ref, '600 seconds is a valid legacy target');
    await assert.rejects(f.adapter.fitDuration(media, 601, new AbortController().signal), /Invalid target duration/);
});

test('cancellation and provider failures are bounded, cleanup workspaces, and TTL removes retained outputs', async t => {
    const f = await fixture({ run: async command => { if (command === 'edge-tts') throw Object.assign(new Error('gone'), { code: 'ENOENT' }); throw new Error('gtts offline'); } });
    t.after(() => fs.rm(f.root, { recursive: true, force: true }));
    await assert.rejects(f.adapter.synthesize('Hola', { voice: 'hombre', signal: new AbortController().signal }), error => error.name === 'AppError' && error.kind === 'network');
    assert.deepEqual(await fs.readdir(f.tempDirectory), []);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(f.adapter.synthesize('Hola', { voice: 'hombre', signal: controller.signal }), { name: 'AbortError' });
    assert.deepEqual(await fs.readdir(f.tempDirectory), []);
    assert.equal((await f.adapter.prepareScript({ request: 'x', literalText: 'exact', mode: 'verbatim' }, new AbortController().signal)).success, true);

    const retained = await fixture(); t.after(() => fs.rm(retained.root, { recursive: true, force: true }));
    const audio = await retained.adapter.synthesize('Voz retenida', { voice: 'hombre', signal: new AbortController().signal });
    assert.ok(await fs.stat(audio.ref));
    const janitor = createVoiceMedia({ tempDirectory: retained.tempDirectory, clock: { now: () => Date.now() + 2 * 60 * 60 * 1000 } });
    assert.equal(await janitor.cleanupExpired(), 1);
    assert.deepEqual(await fs.readdir(retained.tempDirectory), []);
});

