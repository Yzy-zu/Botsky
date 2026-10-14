// @ts-check
'use strict';
const { createQrFeature } = require('./qr/manifest');
const { createOcrFeature } = require('./ocr/manifest');
const { createDocumentsFeature } = require('./documents/manifest');
const { createTranscriptionFeature } = require('./transcription/manifest');
const { createStickerFeature } = require('./sticker/manifest');
const { createVoiceFeature } = require('./voice/manifest');

/** @typedef {{qr?:Parameters<typeof createQrFeature>[0],ocr?:Parameters<typeof createOcrFeature>[0],documents?:Parameters<typeof createDocumentsFeature>[0],transcription?:Parameters<typeof createTranscriptionFeature>[0],sticker?:Parameters<typeof createStickerFeature>[0],voice?:Parameters<typeof createVoiceFeature>[0]}} MediaFeaturePorts */
/** Only explicitly supplied, complete capabilities enter the manifest registry.
 * Documents owns leer/ocr when enabled; registering two owners is an error.
 * @param {MediaFeaturePorts} ports @returns {import('../pipeline/contracts').Feature[]} */
function createWaveAFeatures(ports) {
    if (ports.documents && ports.ocr) throw new TypeError('Documents and OCR cannot both own leer/ocr');
    /** @type {import('../pipeline/contracts').Feature[]} */ const features = [];
    if (ports.qr) { requireMethods(ports.qr, ['create', 'read']); features.push(createQrFeature(ports.qr)); }
    if (ports.ocr) { requireMethods(ports.ocr, ['readText']); features.push(createOcrFeature(ports.ocr)); }
    if (ports.documents) { requireMethods(ports.documents, ['process', 'readContent']); features.push(createDocumentsFeature(ports.documents)); }
    if (ports.transcription) { requireMethods(ports.transcription, ['transcribe']); features.push(createTranscriptionFeature(ports.transcription)); }
    if (ports.sticker) { requireMethods(ports.sticker, ['createSticker', 'applyEffect']); features.push(createStickerFeature(ports.sticker)); }
    if (ports.voice) { requireMethods(ports.voice, ['prepareScript', 'synthesize', 'fitDuration']); features.push(createVoiceFeature(ports.voice)); }
    return features;
}
/** @param {object} port @param {string[]} methods */
function requireMethods(port, methods) {
    const value = /** @type {Record<string,unknown>} */ (port);
    if (methods.some(name => typeof value[name] !== 'function')) throw new TypeError('Incomplete media feature capability');
}
module.exports = { createWaveAFeatures };
