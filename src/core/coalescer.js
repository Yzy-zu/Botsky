'use strict';

const logger = require('../services/logger');
const { attachToMessage } = require('../services/attachmentContext');

// Ventana fija de agrupación por remitente
const BASE_DEBOUNCE_MS = parseInt(process.env.MESSAGE_DEBOUNCE_MS || '1200', 10);
// Tiempo máximo que un mensaje puede esperar acumulando antes de ser forzado
const MAX_WAIT_MS = 3500;

// Estado en memoria de los buffers: Map(senderKey -> BufferEntry)
const pendingBuffers = new Map();
const dispatchChains = new Map();
const ATTACHMENT_DEBOUNCE_MS = 1200;

// Batching is a transport concern. Only Gemini interprets the combined request.
function calculateAdaptiveDebounce() { return BASE_DEBOUNCE_MS; }
function shouldBypassCoalescence(norm) {
    if (!norm || BASE_DEBOUNCE_MS <= 0) return true;
    return Boolean(norm.hasPrefix || norm.isPollCommand || norm.isReaction);
}

/**
 * Clave única para agrupar mensajes por emisor en un chat.
 */
function getSenderKey(from, norm) {
    const participant = norm?.participant || from;
    return JSON.stringify([from, participant]);
}

/** Bare readable uploads get one short window; audio and explicit transforms stay immediate. */
function isBareReadableAttachment(norm) {
    if (norm?.attachment?.source !== 'current' || (norm.text || '').trim()) return false;
    return norm.attachment.messageType === 'imageMessage' || norm.attachment.messageType === 'documentMessage';
}

function toPayload(norm, text = norm?.text || '') {
    return {
        ...norm,
        from: norm?.from || norm?.remoteJid,
        text,
        messageType: norm?.actualMessageType,
        messageData: norm?.actualMessageData,
        isPollCommand: Boolean(norm?.isPollCommand),
        hasPrefix: Boolean(norm?.hasPrefix),
        isTaskDirectCommand: Boolean(norm?.isTaskDirectCommand)
    };
}

/** Dispatches for one sender are serialized, including a buffered text before media. */
function enqueueDispatch(key, payload, dispatchFn) {
    const run = () => dispatchFn(payload);
    const previous = dispatchChains.get(key);
    let result;
    try { result = previous ? previous.then(run) : run(); }
    catch (error) { result = Promise.reject(error); }
    const completion = Promise.resolve(result).catch(error => {
        logger.error(`[COALESCER] Error en dispatch: ${error.message}`);
    });
    dispatchChains.set(key, completion);
    completion.then(() => {
        if (dispatchChains.get(key) === completion) dispatchChains.delete(key);
    });
    return completion;
}

function canJoinAttachment(entry, norm) {
    const incoming = norm.attachment;
    const stored = entry.norm.attachment;
    // Distinct uploads are separate events; never discard one of their identities.
    return !(incoming && stored && incoming.id !== stored.id);
}

function mergeInto(entry, norm) {
    const text = (norm.text || '').trim();
    // A remembered preceding instruction may already appear as the upload text.
    if (text && text !== entry.texts[entry.texts.length - 1]) entry.texts.push(text);
    const previous = entry.norm;
    let merged = {
        ...norm,
        hasPrefix: Boolean(previous.hasPrefix || norm.hasPrefix),
        isTaskDirectCommand: Boolean(previous.isTaskDirectCommand || norm.isTaskDirectCommand),
        isPollCommand: Boolean(previous.isPollCommand || norm.isPollCommand)
    };
    if (!norm.attachment && previous.attachment) {
        merged.attachment = { ...previous.attachment, source: 'recent' };
        merged.actualMessageType = previous.attachment.messageType;
        merged.actualMessageData = attachToMessage(previous.attachment, norm.actualMessageData);
    }
    entry.norm = merged;
}

function armTimer(key, entry, dispatchFn) {
    if (entry.timer) clearTimeout(entry.timer);
    const wait = isBareReadableAttachment(entry.norm) ? ATTACHMENT_DEBOUNCE_MS
        : calculateAdaptiveDebounce(entry.texts[entry.texts.length - 1] || '', entry.texts.length - 1);
    const remaining = Math.max(0, MAX_WAIT_MS - (Date.now() - entry.firstSeen));
    entry.timer = setTimeout(() => { void flushSender(key, dispatchFn); }, Math.min(wait, remaining));
}

/** Queue conversational text or a bare upload, preserving normalized context/flags. */
function coalesceAndDispatch(norm, dispatchFn) {
    if (!norm) return Promise.resolve();
    const from = norm.from || norm.remoteJid;
    const key = getSenderKey(from, norm);
    if (shouldBypassCoalescence(norm)) {
        if (pendingBuffers.has(key)) void flushSender(key, dispatchFn);
        return enqueueDispatch(key, toPayload(norm), dispatchFn);
    }
    const existing = pendingBuffers.get(key);
    if (existing && canJoinAttachment(existing, norm)) {
        mergeInto(existing, norm);
        if (norm.attachment?.source === 'current' && norm.text) return flushSender(key, dispatchFn);
        armTimer(key, existing, dispatchFn);
        return Promise.resolve();
    }

    // Distinct uploads and unrelated text must never inherit pending media.
    if (existing && (existing.norm.attachment || norm.attachment?.source === 'current')) {
        void flushSender(key, dispatchFn);
    }
    if (shouldBypassCoalescence(norm)) {
        if (pendingBuffers.has(key)) void flushSender(key, dispatchFn);
        return enqueueDispatch(key, toPayload(norm), dispatchFn);
    }

    const current = pendingBuffers.get(key);
    if (current) {
        mergeInto(current, norm);
        if (Date.now() - current.firstSeen >= MAX_WAIT_MS) return flushSender(key, dispatchFn);
        armTimer(key, current, dispatchFn);
    } else {
        const entry = { from, texts: norm.text?.trim() ? [norm.text.trim()] : [], norm, firstSeen: Date.now(), timer: null };
        pendingBuffers.set(key, entry);
        armTimer(key, entry, dispatchFn);
    }
    return Promise.resolve();
}

/** Flush also sends a bare upload: an empty caption is not an empty request. */
function flushSender(key, dispatchFn) {
    const entry = pendingBuffers.get(key);
    if (!entry) return Promise.resolve();
    if (entry.timer) clearTimeout(entry.timer);
    pendingBuffers.delete(key);
    const text = entry.texts.join('\n').trim();
    if (!text && !entry.norm.attachment) return Promise.resolve();
    return enqueueDispatch(key, toPayload(entry.norm, text), dispatchFn);
}

function clearAllBuffers() {
    for (const entry of pendingBuffers.values()) {
        if (entry.timer) clearTimeout(entry.timer);
    }
    pendingBuffers.clear();
}

module.exports = {
    coalesceAndDispatch, flushSender, clearAllBuffers, shouldBypassCoalescence,
    calculateAdaptiveDebounce, isBareReadableAttachment,
    _pendingBuffers: pendingBuffers, _dispatchChains: dispatchChains
};
