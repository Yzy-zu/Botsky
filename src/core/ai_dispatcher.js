'use strict';

const tools = require('./tools');
const { validateMedia } = require('./media_validator');
const { executeTool } = require('./handler_loader');
const { callAI, classifyCategory, selectTool } = require('../services/ai');
const queue = require('./queue');
const logger = require('../services/logger');
const { sendText, sendTyping, sendReaction } = require('../services/evolution');

// ─── Permisos ─────────────────────────────────────────────────────────────────
const groupsNormal  = process.env.ALLOWED_GROUPS_NORMAL  ? process.env.ALLOWED_GROUPS_NORMAL.split(',').map(s => s.trim()).filter(Boolean)  : [];
const numbersNormal = process.env.ALLOWED_NUMBERS_NORMAL ? process.env.ALLOWED_NUMBERS_NORMAL.split(',').map(s => s.trim()).filter(Boolean) : [];
const groupsAdmin   = process.env.ALLOWED_GROUPS_ADMIN   ? process.env.ALLOWED_GROUPS_ADMIN.split(',').map(s => s.trim()).filter(Boolean)   : [];
const numbersAdmin  = process.env.ALLOWED_NUMBERS_ADMIN  ? process.env.ALLOWED_NUMBERS_ADMIN.split(',').map(s => s.trim()).filter(Boolean)  : [];

const allAllowed = [...groupsNormal, ...numbersNormal, ...groupsAdmin, ...numbersAdmin];
const allAdmins  = [...groupsAdmin, ...numbersAdmin];

// ─── Historial de conversación en RAM ─────────────────────────────────────────
const chatHistories = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [from, history] of chatHistories.entries()) {
        if (history.lastActive && (now - history.lastActive > 24 * 60 * 60 * 1000)) {
            chatHistories.delete(from);
        }
    }
}, 60 * 60 * 1000);

// ─── Utilidades ───────────────────────────────────────────────────────────────

// Obtiene programáticamente la lista de categorías únicas desde tools.js
const uniqueCategories = [...new Set(tools.map(t => t.category))].join(', ');

function buildUserMessage(text, messageType) {
    const parts = [];
    const attachmentInfo = {
        audioMessage:    '📎 [El usuario adjuntó una NOTA DE VOZ o AUDIO]',
        videoMessage:    '📎 [El usuario adjuntó un VIDEO]',
        imageMessage:    '📎 [El usuario adjuntó una IMAGEN o FOTO]',
        documentMessage: '📎 [El usuario adjuntó un DOCUMENTO/ARCHIVO]',
        documentWithCaptionMessage: '📎 [El usuario adjuntó un DOCUMENTO con caption]',
        stickerMessage:  '📎 [El usuario adjuntó un STICKER]',
    };

    if (messageType && attachmentInfo[messageType]) {
        parts.push(attachmentInfo[messageType]);
    }

    if (text && text.trim()) {
        parts.push(text.trim());
    }

    return parts.join('\n') || '__SIN_TEXTO__';
}

function getMediaData(messageType) {
    const map = {
        'imageMessage': 'image',
        'videoMessage': 'video',
        'audioMessage': 'audio',
        'documentMessage': 'document',
        'documentWithCaptionMessage': 'document',
        'stickerMessage': 'gif' // Mapeo del sticker como media compatible
    };
    const type = map[messageType] || null;
    return { hasMedia: !!type, type };
}

// ─── Dispatcher Principal ─────────────────────────────────────────────────────

async function dispatch(context) {
    const { from, text, messageType, messageData } = context;

    // Verificar acceso
    if (allAllowed.length > 0 && !allAllowed.some(id => from.includes(id))) {
        logger.warn(`[Dispatcher] Acceso denegado: ${from}`);
        return;
    }

    const userMessage = buildUserMessage(text, messageType);
    if (userMessage === '__SIN_TEXTO__') return;

    if (!chatHistories.has(from)) chatHistories.set(from, []);
    const history = chatHistories.get(from);
    history.lastActive = Date.now();

    sendTyping(from).catch(() => {});

    // 1. Llama a classifyCategory()
    const category = await classifyCategory(userMessage, uniqueCategories, history);
    logger.info(`[Dispatcher] categoría detectada: "${category}"`);

    // 2. Si la categoría es 'chat', llama a callAI() directamente, envía y termina
    if (category === 'chat') {
        const aiResult = await callAI(userMessage, history);
        
        history.push({ role: 'user', content: userMessage });
        if (aiResult.text) {
            history.push({ role: 'assistant', content: JSON.stringify({ action: 'chat', message: aiResult.text }) });
            if (history.length > 10) history.splice(0, history.length - 10);
            
            await sendText(from, aiResult.text);
        }
        return;
    }

    // 3. Filtra el array de tools para obtener solo las de esa categoría
    const categoryTools = tools.filter(t => t.category === category);
    logger.info(`[Dispatcher] tools en categoría "${category}": ${categoryTools.map(t => t.name).join(', ') || '(ninguna)'}`);

    // 4. Llama a selectTool() pasándole las herramientas filtradas y el tipo de adjunto
    const selected = await selectTool(userMessage, categoryTools, history, messageType);
    logger.info(`[Dispatcher] herramienta seleccionada: "${selected.action}" args: ${JSON.stringify(selected.args)}`);

    // 5. Busca la herramienta seleccionada. Si no existe, asume 'chat', llama a callAI y termina.
    const tool = tools.find(t => t.name === selected.action);
    if (!tool || tool.name === 'chat') {
        logger.warn(`[Dispatcher] tool "${selected.action}" no encontrada → fallback chat`);
        const aiResult = await callAI(userMessage, history);
        
        history.push({ role: 'user', content: userMessage });
        if (aiResult.text) {
            history.push({ role: 'assistant', content: JSON.stringify({ action: 'chat', message: aiResult.text }) });
            if (history.length > 10) history.splice(0, history.length - 10);
            
            await sendText(from, aiResult.text);
        }
        return;
    }

    // Verificación de seguridad para comandos admin
    if (tool.category === 'admin') {
        const participant = messageData?.key?.participant || from;
        const isAdmin = allAdmins.some(id => from.includes(id) || participant.includes(id));
        if (!isAdmin) {
            await sendText(from, `[!] acceso denegado\nno tienes privilegios para "${tool.name}"`);
            return;
        }
    }

    history.push({ role: 'user', content: userMessage });
    history.push({ role: 'assistant', content: JSON.stringify({ action: tool.name, args: selected.args }) });
    if (history.length > 10) history.splice(0, history.length - 10);

    // 6. Extrae la información multimedia para crear el objeto msgData
    const msgDataObj = getMediaData(messageType);

    // 7. Llama a validateMedia
    const validation = validateMedia(tool, msgDataObj);

    // 8. Si es inválido, responde al usuario con el errorMsg y termina
    if (!validation.valid) {
        await sendText(from, validation.reason);
        return;
    }

    // 9. Si tool.ui.handledBy === 'dispatcher', envía la reacción de carga ⏳
    if (tool.ui.handledBy === 'dispatcher' && messageData?.key) {
        await sendReaction(from, '⏳', messageData.key).catch(() => {});
    }

    // 10. Envuelve la ejecución en un bloque try/catch
    try {
        const executeTask = async () => {
            // 12. Dentro de la cola, llama a executeTool
            logger.info(`[Dispatcher] ejecutando handler: ${tool.name}`);
            await executeTool(tool, selected.args, context);
            logger.info(`[Dispatcher] handler ${tool.name} completado OK`);

            // 13. Si la ejecución es exitosa y handledBy dispatcher, envía ✅
            if (tool.ui.handledBy === 'dispatcher' && messageData?.key) {
                await sendReaction(from, '✅', messageData.key).catch(() => {});
            }
        };

        // 11. Encolamiento según el nivel de la herramienta (tool.queueTier)
        if (tool.queueTier) {
            await queue.add(from, executeTask, tool.queueTier);
        } else {
            await executeTask();
        }

    } catch (err) {
        // 14. En el catch: log del error y envía reacción ❌
        logger.error(`[Dispatcher] Error ejecutando ${tool.name}:`, err);
        if (tool.ui.handledBy === 'dispatcher' && messageData?.key) {
            await sendReaction(from, '❌', messageData.key).catch(() => {});
        }
        await sendText(from, `[!] error ejecutando: ${tool.name}`);
    }
}

module.exports = { dispatch };
