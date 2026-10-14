'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTranscriptionMedia } = require('../../../../src/v2/adapters/media/transcription');
const { AppError } = require('../../../../src/v2/domain/errors');

function hasUnpairedSurrogate(text) {
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code >= 0xD800 && code <= 0xDBFF) { const next = text.charCodeAt(i + 1); if (!(next >= 0xDC00 && next <= 0xDFFF)) return true; i++; }
        else if (code >= 0xDC00 && code <= 0xDFFF) return true;
    }
    return false;
}

function fixture(overrides = {}) {
    const calls = { downloads: [], urls: [], requests: [], parts: [], fallback: [], summaries: [] };
    const deps = {
        downloadMedia: async (source, options) => { calls.downloads.push({ source, options }); return audio(); },
        downloadUrl: async (url, options) => { calls.urls.push({ url, options }); return audio(); },
        formData: () => ({ append: (name, value, options) => calls.parts.push({ name, value, options }), getHeaders: () => ({ 'Content-Type': 'multipart/form-data; boundary=test' }) }),
        http: { post: async (url, form, options) => { calls.requests.push({ url, form, options }); return { data: { text: 'recognized speech', duration: 12.3, language: 'es' } }; } },
        config: { groqApiKey: 'injected-secret', groqEndpoint: 'https://groq.invalid/transcribe' },
        fallbackTranscribe: async input => { calls.fallback.push(input); return { text: 'fallback speech' }; },
        summarizeText: async (text, options) => { calls.summaries.push({ text, options }); return 'summary'; },
        ...overrides
    };
    return { media: createTranscriptionMedia(deps), calls };
}

function audio(overrides = {}) { return { buffer: Buffer.from('fake-audio'), extension: 'ogg', mime: 'audio/ogg', ...overrides }; }
function source(overrides = {}) { return { id: 'm-1', chatId: 'chat-1', ownerJid: 'user-1', ref: 'opaque-ref', mime: 'audio/ogg', ...overrides }; }
function request(signal = new AbortController().signal, overrides = {}) { return { model: 'whisper-large-v3-turbo', language: 'es', signal, ...overrides }; }

test('transcription downloads by attachment identity and sends bounded Groq multipart request', async () => {
    const f = fixture();
    const result = await f.media.transcribe(source(), request());
    assert.deepEqual(result, { text: 'recognized speech', duration: 12.3, language: 'es' });
    assert.equal(f.calls.downloads[0].source.chatId, 'chat-1');
    assert.equal(f.calls.downloads[0].options.maxBytes, 25 * 1024 * 1024);
    assert.deepEqual(f.calls.parts.map(part => part.name), ['file', 'model', 'response_format', 'language']);
    assert.equal(f.calls.parts[0].options.filename, 'audio.ogg');
    assert.equal(f.calls.parts[1].value, 'whisper-large-v3-turbo');
    assert.equal(f.calls.parts[2].value, 'verbose_json');
    assert.equal(f.calls.requests[0].options.headers.Authorization, 'Bearer injected-secret');
    assert.equal(f.calls.requests[0].options.signal.aborted, false);
    assert.equal(f.calls.fallback.length, 0);
});

test('auto language omits Groq language field and provider errors fall back to injected multimodal transcription', async () => {
    const f = fixture({ http: { post: async () => { throw new Error('provider private detail'); } } });
    const result = await f.media.transcribe(source(), request(undefined, { language: 'auto' }));
    assert.deepEqual(result, { text: 'fallback speech' });
    assert.deepEqual(f.calls.parts.map(part => part.name), ['file', 'model', 'response_format']);
    assert.equal(f.calls.fallback.length, 1);
    assert.equal(f.calls.fallback[0].mime, 'audio/ogg');
    assert.equal(f.calls.fallback[0].model, 'whisper-large-v3-turbo');
});

test('failed fallback exposes only a generic error and never logs or returns provider details', async () => {
    const f = fixture({ http: { post: async () => { throw new Error('sensitive provider response'); } },
        fallbackTranscribe: async () => { throw new Error('private LLM response'); } });
    await assert.rejects(f.media.transcribe(source(), request()), { message: 'Transcription providers failed' });
});

test('typed quota errors survive transcription download, primary provider and fallback boundaries', async () => {
    const download = fixture({ downloadMedia: async () => { throw new AppError('quota'); } });
    await assert.rejects(download.media.transcribe(source(), request()), e => e instanceof AppError && e.kind === 'quota');
    const primary = fixture({ http: { post: async () => { throw new AppError('quota'); } } });
    await assert.rejects(primary.media.transcribe(source(), request()), e => e instanceof AppError && e.kind === 'quota');
    const fallback = fixture({ http: { post: async () => { throw Error('primary generic'); } }, fallbackTranscribe: async () => { throw new AppError('quota'); } });
    await assert.rejects(fallback.media.transcribe(source(), request()), e => e instanceof AppError && e.kind === 'quota');
});

test('URL helper validates without fetching and transcription uses only the injected bounded downloader', async () => {
    const f = fixture();
    const ref = await f.media.downloadUrl('https://media.invalid/audio.ogg', new AbortController().signal);
    assert.equal(ref.url, true);
    assert.equal(f.calls.urls.length, 0);
    await f.media.transcribe(ref, request());
    assert.equal(f.calls.urls.length, 1);
    assert.equal(f.calls.urls[0].url, 'https://media.invalid/audio.ogg');
    await assert.rejects(f.media.downloadUrl('file:///etc/passwd', new AbortController().signal), /Invalid audio URL/);
    await assert.rejects(f.media.downloadUrl('https://user:pass@host/audio.ogg', new AbortController().signal), /Invalid audio URL/);
});

test('oversized, unsupported and malformed media are rejected before provider request', async () => {
    const tooLarge = fixture({ downloadMedia: async () => audio({ buffer: Buffer.alloc(32 * 1024 * 1024) }) });
    await assert.rejects(tooLarge.media.transcribe(source(), request()), { message: 'Audio download failed' });
    assert.equal(tooLarge.calls.requests.length, 0);
    const badExt = fixture({ downloadMedia: async () => audio({ extension: 'exe' }) });
    await assert.rejects(badExt.media.transcribe(source(), request()), { message: 'Audio download failed' });
    assert.equal(badExt.calls.requests.length, 0);
    const missingIdentity = fixture();
    await assert.rejects(missingIdentity.media.transcribe(source({ chatId: undefined }), request()), { message: 'Audio download failed' });
});

test('provider timeout aborts its signal and falls back; cancellation propagates without fallback', async () => {
    let timedSignal;
    const timeout = fixture({ timeoutMs: 10, http: { post: (_url, _form, options) => {
        timedSignal = options.signal;
        return new Promise(() => {});
    } } });
    const result = await timeout.media.transcribe(source(), request());
    assert.equal(result.text, 'fallback speech');
    assert.equal(timedSignal.aborted, true);
    const controller = new AbortController();
    let requestSignal;
    const cancelled = fixture({ http: { post: (_url, _form, options) => {
        requestSignal = options.signal;
        return new Promise(() => {});
    } } });
    const work = cancelled.media.transcribe(source(), request(controller.signal));
    while (!requestSignal) await new Promise(resolve => setTimeout(resolve, 1));
    controller.abort();
    await assert.rejects(work, { name: 'AbortError' });
    assert.equal(cancelled.calls.fallback.length, 0);
});

test('optional text summarization receives caller cancellation signal', async () => {
    const f = fixture();
    assert.equal(await f.media.summarize('recognized', new AbortController().signal), 'summary');
    assert.equal(f.calls.summaries[0].text, 'recognized');
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(f.media.summarize('text', controller.signal), { name: 'AbortError' });
});

test('transcript and summary outputs are capped with Unicode-safe notices before returning', async () => {
    const hugeTranscript = '🙂'.repeat(18_000);
    const f = fixture({ http: { post: async () => ({ data: { text: hugeTranscript } }) },
        summarizeText: async input => { assert.ok(Array.from(input).length <= 32 * 1024); return '語'.repeat(5000); } });
    const result = await f.media.transcribe(source(), request());
    assert.ok(result.text.length <= 32 * 1024);
    assert.match(result.text, /Transcripción recortada/);
    const summary = await f.media.summarize(result.text, new AbortController().signal);
    assert.ok(summary.length <= 4 * 1024);
    assert.match(summary, /Resumen recortado/);
    assert.equal(hasUnpairedSurrogate(result.text), false);
    assert.equal(hasUnpairedSurrogate(summary), false);
});
