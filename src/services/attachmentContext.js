'use strict';


const TTL_MS = 15 * 60 * 1000;
const INSTRUCTION_TTL_MS = 90 * 1000;
const MAX_CONTEXTS = 200;
const MAX_ATTACHMENTS = 500;
const MAX_PER_CONTEXT = 5;
const contexts = new Map();
const MEDIA_TYPES = new Set(['imageMessage', 'documentMessage', 'documentWithCaptionMessage', 'audioMessage', 'videoMessage', 'stickerMessage']);
const MEDIA_FIELDS = ['url', 'directPath', 'mediaKey', 'fileEncSha256', 'fileSha256', 'fileLength', 'mediaKeyTimestamp', 'mimetype', 'fileName', 'caption', 'height', 'width', 'pageCount', 'seconds', 'ptt'];
const MEDIA_BYTE_FIELDS = new Set(['mediaKey', 'fileEncSha256', 'fileSha256']);

/** These 32-byte fields are decryption metadata, not the media payload. */
function mediaBytes(value) {
    if (!value || typeof value !== 'object') return null;
    let bytes;
    if (Array.isArray(value)) bytes = value;
    else if (value.type === 'Buffer' && Array.isArray(value.data)) bytes = value.data;
    else {
        const keys = Object.keys(value);
        if (keys.length !== 32 || keys.some((key, index) => key !== String(index))) return null;
        bytes = keys.map(key => value[key]);
    }
    if (bytes.length !== 32 || Array.from(bytes).some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) return null;
    return [...bytes];
}

function mediaLong(value) {
    if (!value || !Number.isInteger(value.low) || !Number.isInteger(value.high) || value.high < 0 || value.high > 0x1fffff) return null;
    const number = value.high * 0x100000000 + (value.low >>> 0);
    return Number.isSafeInteger(number) ? number : null;
}

/** Chat and requesting sender must both be part of the key, including in groups. */
function getAttachmentContextKey(from, participant = from) {
    return JSON.stringify([from || '', participant || from || '']);
}

/** Retains download metadata only: never webhook bytes, base64 media or thumbnails. */
function minimalMessageData(data, messageType) {
    const type = messageType === 'documentWithCaptionMessage' ? 'documentMessage' : messageType;
    const media = messageType === 'documentWithCaptionMessage'
        ? data?.message?.documentWithCaptionMessage?.message?.documentMessage
        : data?.message?.[type];
    if (!MEDIA_TYPES.has(messageType) || !media) return null;
    const clean = {};
    for (const name of MEDIA_FIELDS) {
        const value = media[name];
        if (MEDIA_BYTE_FIELDS.has(name) && value && typeof value === 'object') {
            const bytes = mediaBytes(value);
            if (bytes) clean[name] = bytes;
        } else if ((name === 'fileLength' || name === 'mediaKeyTimestamp') && value && typeof value === 'object') {
            const number = mediaLong(value);
            if (number !== null) clean[name] = number;
        } else if (typeof value === 'string') clean[name] = value.slice(0, name === 'caption' ? 8192 : 4096);
        else if (typeof value === 'number' || typeof value === 'boolean') clean[name] = value;
    }
    return {
        key: {
            remoteJid: data.key?.remoteJid,
            participant: data.key?.participant || data.participant,
            id: data.key?.id,
            fromMe: Boolean(data.key?.fromMe),
            ...(typeof data.key?.remoteJidAlt === 'string' ? { remoteJidAlt: data.key.remoteJidAlt } : {}),
            ...(typeof data.key?.participantAlt === 'string' ? { participantAlt: data.key.participantAlt } : {}),
            ...(typeof data.key?.addressingMode === 'string' ? { addressingMode: data.key.addressingMode } : {})
        },
        participant: data.key?.participant || data.participant,
        pushName: data.pushName || 'Usuario',
        messageType: type,
        message: { [type]: clean },
        ...(data.quotedStanzaId ? { quotedStanzaId: data.quotedStanzaId, quotedParticipant: data.quotedParticipant,
            quotedRemoteJid: data.quotedRemoteJid, quotedFromMe: data.quotedFromMe } : {})
    };
}

function prune(now = Date.now()) {
    let count = 0;
    for (const [key, context] of contexts) {
        context.attachments = context.attachments.filter(item => now - item.timestamp <= TTL_MS);
        if (context.instruction && now - context.instruction.timestamp > INSTRUCTION_TTL_MS) context.instruction = null;
        if (context.pendingRequest && now - context.pendingRequest.timestamp > INSTRUCTION_TTL_MS) context.pendingRequest = null;
        if (!context.attachments.length && !context.instruction && !context.pendingRequest) contexts.delete(key);
        else count += context.attachments.length;
    }
    while (contexts.size > MAX_CONTEXTS || count > MAX_ATTACHMENTS) {
        const oldest = contexts.keys().next().value;
        count -= contexts.get(oldest).attachments.length;
        contexts.delete(oldest);
    }
}

function getContext(from, participant, create = false) {
    prune();
    const key = getAttachmentContextKey(from, participant);
    let context = contexts.get(key);
    if (!context && create) {
        context = { attachments: [], activeId: null, instruction: null, pendingRequest: null };
        contexts.set(key, context);
    }
    return context;
}

/**
 * Store a descriptor and return it. For quoted files, messageData retains the
 * requesting sender, while quotedParticipant identifies the media owner only.
 */
function rememberAttachment({ from, participant, messageData, messageType, source = 'current', id }) {
    const data = minimalMessageData(messageData, messageType);
    if (!data) return null;
    const normalizedType = data.messageType;
    const media = data.message[normalizedType];
    const descriptor = {
        id: id || messageData.quotedStanzaId || messageData.key?.id || '',
        messageType: normalizedType,
        messageData: data,
        mimetype: media.mimetype || '',
        fileName: media.fileName || '',
        source,
        timestamp: Date.now()
    };
    const context = getContext(from, participant, true);
    const index = context.attachments.findIndex(item => item.id && item.id === descriptor.id);
    if (index >= 0) context.attachments.splice(index, 1);
    context.attachments.push(descriptor);
    if (context.attachments.length > MAX_PER_CONTEXT) context.attachments.shift();
    if (source === 'current') context.activeId = null;
    else context.activeId = descriptor.id;
    const key = getAttachmentContextKey(from, participant);
    contexts.delete(key);
    contexts.set(key, context);
    prune();
    return descriptor;
}

/** Mark an explicitly addressed attachment as the target for later continuation. */
function selectAttachment({ from, participant, attachment }) {
    const context = getContext(from, participant);
    if (context && attachment) context.activeId = attachment.id;
}

/** Only Gemini selects a file; the executor verifies its scoped identity. */
function getAttachmentState({ from, participant }) {
    const context = getContext(from, participant);
    return { attachments: (context?.attachments || []).map(item => ({ ...item, source: 'recent' })),
        activeId: context?.activeId || null, pendingRequest: context?.pendingRequest?.text || null };
}

function resolveAttachment({ from, participant, id }) {
    const context = getContext(from, participant);
    const attachment = typeof id === 'string' && id ? context?.attachments.find(item => item.id === id) : null;
    return { attachment: attachment ? { ...attachment, source: 'recent' } : null, ambiguity: null };
}

function rememberPendingRequest({ from, participant, text }) {
    const context = getContext(from, participant, true);
    context.pendingRequest = { text: String(text || '').slice(0, 8192), timestamp: Date.now() };
}

function clearPendingRequest({ from, participant }) {
    const context = getContext(from, participant);
    if (context) { context.pendingRequest = null; context.instruction = null; }
}

/** Build a downloadable media payload without replacing the current sender/id. */
function attachToMessage(attachment, currentData = {}) {
    const stored = attachment.messageData;
    const mediaId = stored.quotedStanzaId || attachment.id || stored.key?.id;
    const currentId = currentData.key?.id;
    const currentMessage = currentData.message?.[currentData.messageType];
    const requestContext = currentData.contextInfo || currentMessage?.contextInfo ||
        currentMessage?.message?.documentMessage?.contextInfo ||
        Object.values(currentData.message || {}).find(value => value?.contextInfo)?.contextInfo;
    return {
        ...currentData,
        message: stored.message,
        messageType: attachment.messageType,
        ...(requestContext ? { contextInfo: requestContext } : {}),
        ...(mediaId && mediaId !== currentId ? {
            quotedStanzaId: mediaId,
            quotedParticipant: stored.quotedParticipant || stored.key?.participant || stored.key?.remoteJid,
            quotedRemoteJid: stored.quotedRemoteJid || stored.key?.remoteJid,
            quotedFromMe: stored.quotedFromMe ?? stored.key?.fromMe
        } : {})
    };
}

/** A short lived instruction allows 'resuelve esto' followed by an attachment. */
function rememberInstruction({ from, participant, text, hasPrefix = false }) {
    if (!text) return;
    const context = getContext(from, participant, true);
    context.instruction = { text: String(text).slice(0, 8192), hasPrefix, timestamp: Date.now() };
    prune();
}

function consumeInstruction({ from, participant }) {
    const context = getContext(from, participant);
    const instruction = context?.instruction || null;
    if (context) context.instruction = null;
    return instruction;
}

function clearAttachmentContexts() { contexts.clear(); }

module.exports = {
    TTL_MS, INSTRUCTION_TTL_MS, MAX_CONTEXTS, MAX_ATTACHMENTS,
    getAttachmentContextKey, minimalMessageData, rememberAttachment, selectAttachment,
    resolveAttachment, attachToMessage, getAttachmentState, rememberPendingRequest, clearPendingRequest, rememberInstruction, consumeInstruction,
    clearAttachmentContexts, prune, _contexts: contexts
};
