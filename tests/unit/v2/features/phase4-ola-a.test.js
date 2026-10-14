'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createQrFeature } = require('../../../../src/v2/features/qr/manifest');
const { createOcrFeature } = require('../../../../src/v2/features/ocr/manifest');
const { createTranscriptionFeature, parseExplicit: parseTranscription } = require('../../../../src/v2/features/transcription/manifest');
const { normalizeUrl, splitText } = require('../../../../src/v2/features/transcription/handler');
const { isReply } = require('../../../../src/v2/domain/types');

function hasUnpairedSurrogate(text) {
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code >= 0xD800 && code <= 0xDBFF) { const next = text.charCodeAt(i + 1); if (!(next >= 0xDC00 && next <= 0xDFFF)) return true; i++; }
        else if (code >= 0xDC00 && code <= 0xDFFF) return true;
    }
    return false;
}

const signal = () => new AbortController().signal;
function context({ attachment, text = '', kind = 'text' } = {}) {
    return { event: { id: 'in-qr', chatId: '15555550123@s.whatsapp.net', isGroup: false,
        sender: { jid: '15555550123@s.whatsapp.net', number: '15555550123', name: 'Tester' }, text, kind }, attachment };
}

test('QR manifest creates a media reply from injected encoder and decodes only attached images', async () => {
    let encoded;
    const qr = createQrFeature({ create: async (value, abort) => { encoded = value; assert.equal(abort.aborted, false); return { ref: '/tmp/qr.png' }; },
        read: async attachment => { assert.equal(attachment.ref, '/tmp/in.png'); return 'https://example.test'; } });
    const command = qr.commands[0];
    const created = await command.handler(context(), { text: '  https://example.test  ' }, signal());
    assert.equal(encoded, 'https://example.test');
    assert.equal(isReply(created), true);
    assert.deepEqual(created.parts[0], { type: 'image', ref: '/tmp/qr.png', mime: 'image/png', caption: 'Listo, aquí está tu QR.' });

    const read = await command.handler(context({ attachment: { id: 'img', ownerJid: 'u', expiresAt: 1, ref: '/tmp/in.png', mime: 'image/png', kind: 'image' } }), {}, signal());
    assert.match(read.parts[0].text, /https:\/\/example\.test/);
    assert.equal(read.replyTo, 'in-qr');
    const guidance = await command.handler(context(), {}, signal());
    assert.match(guidance.parts[0].text, /¿Lo creamos o lo leemos/);
    assert.equal(qr.intents[0].schema, command.argsSchema);
    assert.deepEqual(command.parseExplicit(['texto', 'con', 'espacios']), { text: 'texto con espacios' });
    assert.throws(() => command.parseExplicit(['x'.repeat(2049)]), /Invalid explicit/);
});

test('QR failures and empty detections return bounded user guidance without exposing adapter errors', async () => {
    const qr = createQrFeature({ create: async () => { throw Error('private provider detail'); }, read: async () => '' });
    const created = await qr.commands[0].handler(context(), { text: 'hello' }, signal());
    assert.match(created.parts[0].text, /No pude generar el QR/);
    assert.doesNotMatch(created.parts[0].text, /private provider detail/);
    const decoded = await qr.commands[0].handler(context({ attachment: { id: 'img', ownerJid: 'u', expiresAt: 1, ref: 'img', mime: 'image/png', kind: 'image' } }), {}, signal());
    assert.match(decoded.parts[0].text, /No encontré un QR/);
});

test('QR handler caps malicious injected decoder output with a visible Unicode-safe notice', async () => {
    const qr = createQrFeature({ create: async () => ({ ref: 'qr' }), read: async () => '😀'.repeat(5000) });
    const attachment = { id: 'img', ownerJid: 'u', chatId: 'chat', expiresAt: 1, ref: 'img', mime: 'image/png', kind: 'image' };
    const reply = await qr.commands[0].handler(context({ attachment }), {}, signal());
    const text = reply.parts[0].text;
    assert.ok(text.length < 8 * 1024 + 50);
    assert.match(text, /Lectura QR recortada/);
    assert.equal(hasUnpairedSurrogate(text), false);
});

test('OCR accepts image/document attachments, fixes Spanish and English recognition, and handles blank scans', async () => {
    let received;
    const feature = createOcrFeature({ readText: async (attachment, options) => { received = { attachment, options }; return '  Número de factura 123  '; } });
    const command = feature.commands[0];
    const attachment = { id: 'doc', ownerJid: 'u', expiresAt: 1, ref: '/safe/doc.pdf', mime: 'application/pdf', kind: 'document' };
    const reply = await command.handler(context({ attachment }), {}, signal());
    assert.equal(received.attachment, attachment);
    assert.equal(received.options.language, 'spa+eng');
    assert.equal(received.options.signal.aborted, false);
    assert.match(reply.parts[0].text, /Número de factura 123/);
    assert.equal(reply.replyTo, 'in-qr');
    const wrong = await command.handler(context({ attachment: { ...attachment, kind: 'audio', mime: 'audio/ogg' } }), {}, signal());
    assert.match(wrong.parts[0].text, /Responde a la imagen/);
    assert.equal(command.parseExplicit([]) && command.name, 'leer');
    assert.deepEqual(command.aliases, ['ocr']);

    const blank = createOcrFeature({ readText: async () => ' \n ' }).commands[0].handler;
    assert.match((await blank(context({ attachment }), {}, signal())).parts[0].text, /No alcancé a leer texto/);
});

test('OCR adapter failure is converted to a user message and cancellation prevents I/O', async () => {
    let calls = 0;
    const handler = createOcrFeature({ readText: async () => { calls++; throw Error('private file path'); } }).commands[0].handler;
    const attachment = { id: 'img', ownerJid: 'u', expiresAt: 1, ref: '/private/image', mime: 'image/png', kind: 'image' };
    const failed = await handler(context({ attachment }), {}, signal());
    assert.match(failed.parts[0].text, /No pude leer esa imagen/);
    assert.doesNotMatch(failed.parts[0].text, /private file path/);
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(handler(context({ attachment }), {}, aborted.signal), { name: 'AbortError' });
    assert.equal(calls, 1);
});

test('OCR handler independently caps malicious adapter results with a visible notice', async () => {
    const handler = createOcrFeature({ readText: async () => '文'.repeat(40_000) }).commands[0].handler;
    const attachment = { id: 'img', ownerJid: 'u', chatId: 'chat', expiresAt: 1, ref: 'img', mime: 'image/png', kind: 'image' };
    const text = (await handler(context({ attachment }), {}, signal())).parts[0].text;
    assert.ok(text.length < 32 * 1024 + 40);
    assert.match(text, /Texto OCR recortado/);
});

test('transcription manifest parses legacy model and language flags into the closed schema', async () => {
    assert.deepEqual(parseTranscription(['--m', 'large', '--idioma=es', '--resumir']), {
        model: 'whisper-large-v3', language: 'es', summarize: true
    });
    assert.deepEqual(parseTranscription(['https://example.test/audio.mp3']), { url: 'https://example.test/audio.mp3' });
    assert.throws(() => parseTranscription(['--m', 'untrusted']), /Invalid explicit/);
    assert.throws(() => parseTranscription(['file:///etc/passwd']), /Invalid explicit/);
    assert.throws(() => parseTranscription(['https://user:pass@example.test/a']), /Invalid explicit/);
    assert.equal(normalizeUrl('http://example.test/audio'), 'http://example.test/audio');
    assert.throws(() => normalizeUrl('javascript:alert(1)'), /Invalid audio URL/);
});

test('transcription uses injected URL/media ports, normalizes output, and summarizes long audio', async () => {
    const calls = [];
    const feature = createTranscriptionFeature({
        downloadUrl: async url => { calls.push(['download', url]); return { ref: 'media://audio-1', mime: 'audio/mpeg' }; },
        transcribe: async (media, options) => {
            calls.push(['transcribe', media, options]);
            return { text: Array.from({ length: 800 }, (_, i) => `palabra${i}`).join(' '), duration: 12.34 };
        },
        summarize: async text => { calls.push(['summarize', text]); return '• Idea principal'; }
    });
    const command = feature.commands[0];
    const reply = await command.handler(context(), { url: 'https://example.test/voice', model: 'whisper-large-v3', language: 'es' }, signal());
    assert.deepEqual(calls[0], ['download', 'https://example.test/voice']);
    assert.equal(calls[1][1].ref, 'media://audio-1');
    assert.equal(calls[1][2].model, 'whisper-large-v3');
    assert.equal(calls[1][2].language, 'es');
    assert.equal(calls[2][0], 'summarize');
    assert.match(reply.parts[0].text, /El audio salió largo/);
    assert.match(reply.parts.at(-1).text, /Lo principal/);
    assert.equal(reply.replyTo, 'in-qr');
    assert.equal(command.allowLong, true);
    assert.equal(feature.intents[0].schema, command.argsSchema);
});

test('transcription supports attached audio, keeps short transcripts unsummarized, and bounds chunk lengths', async () => {
    let summaryCalls = 0;
    let transcribed;
    const command = createTranscriptionFeature({ transcribe: async (media, options) => { transcribed = { media, options }; return { text: 'Hola, mundo.', duration: 2.34 }; }, summarize: async () => { summaryCalls++; return 'summary'; } }).commands[0];
    const attachment = { id: 'audio', ownerJid: 'u', expiresAt: 1, ref: 'media://voice', mime: 'audio/ogg', kind: 'audio' };
    const reply = await command.handler(context({ attachment }), {}, signal());
    assert.equal(transcribed.media.ref, attachment.ref);
    assert.equal(transcribed.options.model, 'whisper-large-v3-turbo');
    assert.equal(transcribed.options.language, 'auto');
    assert.equal(summaryCalls, 0);
    assert.match(reply.parts[0].text, /2\.3s/);
    const configured = createTranscriptionFeature({ defaultLanguage: 'es', transcribe: async (_media, options) => {
        assert.equal(options.language, 'es'); return { text: 'Hola.' };
    } }).commands[0].handler;
    assert.match((await configured(context({ attachment }), {}, signal())).parts[0].text, /Hola\./);
    assert.equal(splitText('a'.repeat(7201)).every(part => part.length <= 3500), true);
    assert.match((await command.handler(context(), {}, signal())).parts[0].text, /No se encontró audio/);
});

test('transcription refuses invalid adapter results and hides provider errors', async () => {
    const handler = createTranscriptionFeature({
        downloadUrl: async () => ({ ref: 'file:///etc/passwd', mime: 'application/octet-stream' }),
        transcribe: async () => { throw Error('private provider response'); }
    }).commands[0].handler;
    const invalidUrl = await handler(context(), { url: 'file:///secret' }, signal());
    assert.match(invalidUrl.parts[0].text, /No pude transcribir/);
    const attachment = { id: 'audio', ownerJid: 'u', expiresAt: 1, ref: 'media://voice', mime: 'audio/ogg', kind: 'audio' };
    const failed = await handler(context({ attachment }), {}, signal());
    assert.match(failed.parts[0].text, /No pude transcribir/);
    assert.doesNotMatch(failed.parts[0].text, /private provider response/);
    const empty = createTranscriptionFeature({ transcribe: async () => ({ text: ' ' }) }).commands[0].handler;
    assert.match((await empty(context({ attachment }), {}, signal())).parts[0].text, /No alcancé a distinguir/);
});

test('transcription handler caps hostile adapter and summarizer output and never emits over twelve parts', async () => {
    const huge = '🙂'.repeat(18_000);
    const handler = createTranscriptionFeature({ transcribe: async () => ({ text: huge }), summarize: async () => '句'.repeat(5000) }).commands[0].handler;
    const attachment = { id: 'audio', ownerJid: 'u', chatId: 'chat', expiresAt: 1, ref: 'media://voice', mime: 'audio/ogg', kind: 'audio' };
    const reply = await handler(context({ attachment }), { summarize: true }, signal());
    assert.ok(reply.parts.length <= 12);
    const joined = reply.parts.map(part => part.text).join('');
    assert.ok(joined.includes('Transcripción recortada'));
    assert.ok(joined.includes('Resumen recortado'));
    assert.equal(reply.parts.every(part => Array.from(part.text).length <= 3550), true);
    for (const part of reply.parts) assert.equal(hasUnpairedSurrogate(part.text), false);
});
