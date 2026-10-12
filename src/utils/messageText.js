'use strict';

const { extractNativeTableText } = require('./whatsappText');

// La cita puede venir de un texto, una imagen/documento o un mensaje envuelto.
function extractQuotedText(messageData) {
    function findQuote(value, depth = 0) {
        if (!value || typeof value !== 'object' || depth > 8) return null;
        if (value.contextInfo?.quotedMessage) return value.contextInfo.quotedMessage;
        for (const child of Object.values(value)) {
            const quote = findQuote(child, depth + 1);
            if (quote) return quote;
        }
        return null;
    }
    function readText(message, depth = 0) {
        if (!message || typeof message !== 'object' || depth > 8) return '';
        const candidates = [message.conversation, message.extendedTextMessage?.text,
            message.imageMessage?.caption, message.videoMessage?.caption, message.documentMessage?.caption];
        const text = candidates.find(value => typeof value === 'string' && value.trim());
        if (text) return text.trim();
        const tableText = extractNativeTableText(message);
        if (tableText) return tableText;
        for (const wrapper of ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'documentWithCaptionMessage']) {
            const nested = readText(message[wrapper]?.message, depth + 1);
            if (nested) return nested;
        }
        return '';
    }
    return readText(findQuote(messageData)) || null;
}

function resolveMessageText(explicitText, messageData) {
    const text = typeof explicitText === 'string' ? explicitText.trim() : '';
    return text || extractQuotedText(messageData) || '';
}

module.exports = { extractQuotedText, resolveMessageText };
