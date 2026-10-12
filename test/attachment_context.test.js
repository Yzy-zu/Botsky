'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const contentIntent = {};

function harness({ pdfSession = false } = {}) {
    let now = 1000000;
    const timers = [];
    const errors = [];
    const FakeDate = class extends Date { static now() { return now; } };
    const logger = { info() {}, warn() {}, error(message) { errors.push(message); } };
    function load(file, dependencies) {
        const module = { exports: {} };
        vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
            module, exports: module.exports,
            require(name) { if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`); return dependencies[name]; },
            Date: FakeDate, process: { env: {} },
            setTimeout(fn, wait) { const timer = { fn, wait, cleared: false }; timers.push(timer); return timer; },
            clearTimeout(timer) { if (timer) timer.cleared = true; }
        }, { filename: file });
        return module.exports;
    }
    const context = load('src/services/attachmentContext.js', { '../utils/mediaDeliveryRequest': {}, '../utils/contentIntent': contentIntent });
    const normalizer = load('src/core/message_normalizer.js', {
        '../services/logger': logger,
        '../commands/documentos': { hasActiveSession: () => pdfSession ? 'pdf' : false },
        '../commands/buscar': { hasActiveSearchSession: () => false, getSessionKey: () => '' },
        '../commands/mensaje': { hasPendingContactChoice: () => false },
        '../commands/ruleta': { hasActiveRouletteLobby: () => false },
        '../commands/blackjack': { hasActiveBlackjackGame: () => false, hasActiveBlackjackTableLobby: () => false, hasActiveBlackjackTablePlaying: () => false },
        '../services/scheduler': { registerTask() {} },
        '../services/attachmentContext': context,
        '../utils/mediaDeliveryRequest': {}, '../utils/contentIntent': contentIntent
    });
    const coalescer = load('src/core/coalescer.js', {
        '../services/logger': logger,
        '../services/attachmentContext': context,
        '../utils/mediaDeliveryRequest': {}, '../utils/contentIntent': contentIntent
    });
    const normalize = normalizer.normalizeIncomingMessage;
    return {
        context, normalize, coalescer, errors,
        advance(ms) { now += ms; },
        async flush(dispatch) {
            for (const key of [...coalescer._pendingBuffers.keys()]) await coalescer.flushSender(key, dispatch);
        },
        async fireTimers() {
            const active = timers.filter(timer => !timer.cleared);
            active.forEach(timer => { timer.cleared = true; timer.fn(); });
            await Promise.all([...coalescer._dispatchChains.values()]);
        }
    };
}

function message(id, text, { from = 'u@s.whatsapp.net', participant } = {}) {
    return { key: { id, remoteJid: from, ...(participant ? { participant } : {}) }, pushName: 'Actual', message: { conversation: text }, messageType: 'conversation' };
}
function media(id, { type = 'documentMessage', caption = '', fileName = 'clase.pdf', mimetype = 'application/pdf', from = 'u@s.whatsapp.net', participant } = {}) {
    const data = message(id, '', { from, participant });
    data.messageType = type;
    data.message = { [type]: { caption, fileName, mimetype, url: 'https://media.test/file', mediaKey: 'decrypt-key', jpegThumbnail: 'PRIVATE_THUMBNAIL', base64: 'PRIVATE_FILE_BYTES', buffer: { data: [1, 2, 3] } } };
    return data;
}

test('El normalizador conserva texto y sesiones sin decidir una intención por regex', () => {
    const h=harness({pdfSession:true});const norm=h.normalize(media('file',{caption:'No lo conviertas, explícame el 2'}));
    assert.equal(norm.text,'No lo conviertas, explícame el 2');assert.equal(norm.hasPrefix,false);assert.equal(norm.sessions.pdf,'pdf');
    const follow=h.normalize(message('follow','haz los primeros tres'));assert.equal(follow.attachment,null);
    assert.equal(h.context.resolveAttachment({from:'u@s.whatsapp.net',id:'file'}).attachment.id,'file');
});

test('Adjuntos se seleccionan sólo por ID del catálogo de ese chat y solicitante', () => {
    const h=harness();h.normalize(media('first'));h.normalize(media('second'));
    assert.equal(h.context.getAttachmentState({from:'u@s.whatsapp.net'}).attachments.length,2);
    assert.equal(h.context.resolveAttachment({from:'u@s.whatsapp.net',text:'el segundo archivo'}).attachment,null);
    assert.equal(h.context.resolveAttachment({from:'u@s.whatsapp.net',id:'second'}).attachment.id,'second');
    assert.equal(h.context.resolveAttachment({from:'other@s.whatsapp.net',id:'second'}).attachment,null);
});

test('Sólo una aclaración semántica guarda la instrucción anterior al archivo', () => {
    const h=harness();h.normalize(message('before','resuelve 2 + 2'));assert.equal(h.normalize(media('new')).text,'');
    h.context.rememberInstruction({from:'u@s.whatsapp.net',text:'resuelve este PDF'});assert.equal(h.normalize(media('next')).text,'resuelve este PDF');
    h.context.rememberInstruction({from:'u@s.whatsapp.net',text:'resuelve'});h.advance(90001);assert.equal(h.normalize(media('expired')).text,'');
});

test('TTL, límites y metadatos mínimos no retienen bytes de archivo', () => {
    const h=harness();h.normalize(media('file'));const state=h.context.getAttachmentState({from:'u@s.whatsapp.net'});
    assert.ok(!JSON.stringify(state).includes('PRIVATE_FILE_BYTES'));assert.ok(!JSON.stringify(state).includes('PRIVATE_THUMBNAIL'));
    h.advance(h.context.TTL_MS+1);assert.equal(h.context.getAttachmentState({from:'u@s.whatsapp.net'}).attachments.length,0);
    for(let i=0;i<250;i++)h.normalize(media('f'+i,{from:i+'@s.whatsapp.net'}));assert.ok(h.context._contexts.size<=200);
});

test('Metadatos de descifrado admiten todas las formas binarias de Evolution y descartan contenido pesado', () => {
    const bytes = Array.from({ length: 32 }, (_, index) => index);
    const shapes = [bytes, Object.fromEntries(bytes.map((byte, index) => [index, byte])), { type: 'Buffer', data: bytes }, Uint8Array.from(bytes), Buffer.from(bytes)];
    for (const type of ['imageMessage', 'documentMessage', 'audioMessage', 'videoMessage', 'stickerMessage']) {
        for (const shape of shapes) {
            const h = harness();
            const data = { key: { id: 'original', remoteJid: 'sender@s.whatsapp.net', remoteJidAlt: 'user@lid', addressingMode: 'pn' },
                message: { [type]: { mediaKey: shape, fileSha256: shape, fileEncSha256: shape,
                    fileLength: { low: 113348, high: 0, unsigned: true }, mediaKeyTimestamp: { low: 1791554011, high: 0, unsigned: false },
                    base64: 'PRIVATE_FILE_BYTES', jpegThumbnail: 'PRIVATE_THUMBNAIL' } } };
            const clean = h.context.minimalMessageData(data, type);
            for (const field of ['mediaKey', 'fileSha256', 'fileEncSha256']) assert.deepEqual(Array.from(clean.message[type][field]), bytes);
            assert.equal(clean.message[type].fileLength, 113348);
            assert.equal(clean.message[type].mediaKeyTimestamp, 1791554011);
            assert.equal(clean.key.remoteJidAlt, 'user@lid');
            assert.equal(clean.message[type].base64, undefined); assert.equal(clean.message[type].jpegThumbnail, undefined);
            if (Array.isArray(shape)) assert.notEqual(clean.message[type].mediaKey, shape);
        }
    }
});

test('Clave multimedia se conserva en archivo actual, cita y seguimiento reciente', () => {
    const bytes = Object.fromEntries(Array.from({ length: 32 }, (_, index) => [index, index]));
    const h = harness();
    const original = media('original', { type: 'imageMessage', mimetype: 'image/jpeg', caption: 'manda esta foto al grupo' });
    original.message.imageMessage.mediaKey = bytes;
    const current = h.normalize(original);
    assert.equal(current.actualMessageData.message.imageMessage.mediaKey.length, 32);
    const follow = h.normalize(message('recent', 'manda esta foto al grupo'));
    const recent = { actualMessageData: h.context.attachToMessage(h.context.resolveAttachment({from:'u@s.whatsapp.net',id:'original'}).attachment,follow.actualMessageData) };
    assert.equal(recent.actualMessageData.quotedStanzaId, 'original');
    assert.deepEqual(Array.from(recent.actualMessageData.message.imageMessage.mediaKey), Array.from({ length: 32 }, (_, index) => index));
    const quoted = message('quote', 'manda esta foto al grupo');
    quoted.message = { extendedTextMessage: { text: 'manda esta foto al grupo', contextInfo: {
        stanzaId: 'original', participant: 'sender@s.whatsapp.net', quotedMessage: original.message
    } } };
    const cited = h.normalize(quoted);
    assert.equal(cited.actualMessageData.message.imageMessage.mediaKey.length, 32);
    assert.equal(cited.actualMessageData.key.id, 'quote');
});

test('Metadatos binarios inválidos o enormes no se guardan como claves', () => {
    const h = harness();
    for (const value of [new Array(32), Array(31).fill(1), Array(33).fill(1), Array(32).fill(-1), { type: 'Buffer', data: Array(32).fill(256) }, { secret: 'PRIVATE' }]) {
        const clean = h.context.minimalMessageData({ message: { imageMessage: { mediaKey: value } } }, 'imageMessage');
        assert.equal(clean.message.imageMessage.mediaKey, undefined);
    }
});
