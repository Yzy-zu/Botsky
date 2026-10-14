'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { AppError } = require('../../../../src/v2/domain/errors');
const { createQrHandler } = require('../../../../src/v2/features/qr/handler');
const { createOcrHandler } = require('../../../../src/v2/features/ocr/handler');
const { createTranscriptionHandler } = require('../../../../src/v2/features/transcription/handler');
const { createVoiceHandler } = require('../../../../src/v2/features/voice/handler');
const { createDocumentHandlers } = require('../../../../src/v2/features/documents/handler');
const { createStickerHandler, createEffectHandler } = require('../../../../src/v2/features/sticker/handler');
const { FakeClock } = require('../../../../src/v2/platform/clock');
const { TtlStore } = require('../../../../src/v2/platform/ttlStore');

const error = () => new AppError('quota');
const signal = () => new AbortController().signal;
const image = { id:'image-1', ownerJid:'19995550101@s.whatsapp.net', ref:'media://image', mime:'image/png', kind:'image' };
const audio = { id:'audio-1', ownerJid:'19995550101@s.whatsapp.net', ref:'media://audio', mime:'audio/ogg', kind:'audio' };
function context(attachment) {
    return { event:{id:'synthetic-event',chatId:'19995559999@g.us',isGroup:true,sender:{jid:'19995550101@s.whatsapp.net',name:'Tester'},text:'',quoted:undefined},
        history:[],roles:{admins:[],owners:[]},...(attachment?{attachment}:{}) };
}

test('QR and OCR rethrow typed provider errors but retain friendly replies for ordinary failures', async () => {
    const ctx = context(image);
    const qr = createQrHandler({ create: async () => { throw error(); }, read: async () => { throw Error('private'); } });
    await assert.rejects(qr(ctx, { text:'hi' }, signal()), e => e instanceof AppError && e.kind === 'quota');
    const readQr = createQrHandler({ create: async () => ({ref:'unused'}), read: async () => { throw Error('private'); } });
    assert.match((await readQr(ctx, {}, signal())).parts[0].text, /No pude leer el QR/);
    const ocr = createOcrHandler({ readText: async () => { throw error(); } });
    await assert.rejects(ocr(ctx, {}, signal()), e => e instanceof AppError && e.kind === 'quota');
    const plain = createOcrHandler({ readText: async () => { throw Error('secret'); } });
    assert.match((await plain(ctx, {}, signal())).parts[0].text, /No pude leer esa imagen/);
});

test('transcription and voice rethrow typed provider errors while keeping untyped failures friendly', async () => {
    const ctx = context(audio);
    const transcription = createTranscriptionHandler({ transcribe: async () => { throw error(); } });
    await assert.rejects(transcription(ctx, {}, signal()), e => e instanceof AppError && e.kind === 'quota');
    const plainTranscription = createTranscriptionHandler({ transcribe: async () => { throw Error('secret'); } });
    assert.match((await plainTranscription(ctx, {}, signal())).parts[0].text, /No pude transcribir/);
    const voice = createVoiceHandler({ prepareScript: async () => { throw error(); }, synthesize: async () => ({ref:'unused',mime:'audio/ogg'}), fitDuration: async media => media });
    await assert.rejects(voice(ctx, { instruction:'saluda' }, signal()), e => e instanceof AppError && e.kind === 'quota');
    const plainVoice = createVoiceHandler({ prepareScript: async () => { throw Error('secret'); }, synthesize: async () => ({ref:'unused',mime:'audio/ogg'}), fitDuration: async media => media });
    assert.match((await plainVoice(ctx, { instruction:'saluda' }, signal())).parts[0].text, /No pude preparar el texto/);
});

test('document, sticker, and effect handlers propagate typed errors without exposing untyped details', async () => {
    const ctx = context(image), clock = new FakeClock(), store = new TtlStore({clock});
    const docs = createDocumentHandlers({ process: async () => { throw error(); }, readContent: async () => { throw Error('secret'); }, clock, store });
    try {
        await assert.rejects(docs.convert(ctx, {format:'pdf'}, signal()), e => e instanceof AppError && e.kind === 'quota');
        assert.match((await docs.read(ctx, {}, signal())).parts[0].text, /No pude leer esa imagen/);
        const sticker = createStickerHandler({ downloadUrl: async () => ({ref:'unused',mime:'image/png'}), createSticker: async () => { throw error(); } });
        await assert.rejects(sticker(ctx, {}, signal()), e => e instanceof AppError && e.kind === 'quota');
        const effect = createEffectHandler({ applyEffect: async () => { throw error(); } });
        await assert.rejects(effect(context({ ...image, mime:'audio/ogg', kind:'audio' }), {effect:'ardilla'}, signal()), e => e instanceof AppError && e.kind === 'quota');
        const plainSticker = createStickerHandler({ downloadUrl: async () => ({ref:'unused',mime:'image/png'}), createSticker: async () => { throw Error('secret'); } });
        assert.match((await plainSticker(ctx, {}, signal())).parts[0].text, /No pude crear el sticker/);
    } finally { store.dispose(); }
});
