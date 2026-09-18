'use strict';

const { callAI } = require('../services/ai');
const queue      = require('../core/queue');
const logger     = require('../services/logger');
const { sendText, sendTyping, sendReaction } = require('../services/evolution');

const { handleAyuda }                                        = require('../commands/ayuda');
const { handleDescargar }                                    = require('../commands/descargar');
const { handleTranscribir }                                  = require('../commands/transcribir');
const { handleConvertir }                                    = require('../commands/convertir');
const { handleSticker }                                      = require('../commands/sticker');
const { handleInfo }                                         = require('../commands/info');
const { handleDoc, handleComprimir, handlePdf2Img,
        handleUnirPdf }                                      = require('../commands/documentos');
const { handleLeer }                                         = require('../commands/ocr');
const { handleEfecto }                                       = require('../commands/efectos');
const { handleQr }                                           = require('../commands/qr');
const { handleModeracion }                                   = require('../commands/moderacion');
const { handleRank, handleTop }                              = require('../commands/niveles');
const { handleMaicra }                                       = require('../commands/maicra');
const { handleSpotify }                                      = require('../commands/spotify');
const { handleApagar }                                       = require('../commands/sistema');
const { handleBuscar }                                       = require('../commands/buscar');
const { handleDrive }                                        = require('../commands/drive');

// ─── Permisos ─────────────────────────────────────────────────────────────────
const groupsNormal  = process.env.ALLOWED_GROUPS_NORMAL  ? process.env.ALLOWED_GROUPS_NORMAL.split(',').map(s => s.trim()).filter(Boolean)  : [];
const numbersNormal = process.env.ALLOWED_NUMBERS_NORMAL ? process.env.ALLOWED_NUMBERS_NORMAL.split(',').map(s => s.trim()).filter(Boolean) : [];
const groupsAdmin   = process.env.ALLOWED_GROUPS_ADMIN   ? process.env.ALLOWED_GROUPS_ADMIN.split(',').map(s => s.trim()).filter(Boolean)   : [];
const numbersAdmin  = process.env.ALLOWED_NUMBERS_ADMIN  ? process.env.ALLOWED_NUMBERS_ADMIN.split(',').map(s => s.trim()).filter(Boolean)  : [];

const allAllowed = [...groupsNormal, ...numbersNormal, ...groupsAdmin, ...numbersAdmin];
const allAdmins  = [...groupsAdmin, ...numbersAdmin];

// ─── Comandos solo-admin ───────────────────────────────────────────────────────
const ADMIN_TOOLS = new Set(['maicra', 'moderacion', 'apagate']);

// ─── Prioridad de cola por herramienta ────────────────────────────────────────
const QUEUE_TIER = {
    descargar:  'heavy',
    spotify:    'heavy',
    transcribir:'heavy',
    convertir:  'heavy',
    doc:        'heavy',
    pdf2img:    'heavy',
    maicra:     'heavy',
    drive:      'heavy',
    sticker:    'light',
    buscar:     'light',
    comprimir:  'light',
    leer:       'light',
    qr:         'light',
};

// Número máximo de mensajes del grupo a guardar como contexto (configurable en .env)
const GROUP_CTX_SIZE = parseInt(process.env.GROUP_CONTEXT_MESSAGES ?? '10', 10);

// ─── Historial de conversación (Memoria en RAM) ───────────────────────────────
const chatHistories = new Map();

// ─── Log de mensajes de grupo (contexto pasivo) ───────────────────────────────
const groupLogs = new Map(); // groupJid -> { messages: [{ name, text }], lastActive: number }

/**
 * Registra un mensaje normal del grupo (sin prefijo) en el log de contexto.
 * @param {string} groupJid
 * @param {string} name
 * @param {string} text
 */
function addGroupMessage(groupJid, name, text) {
    if (!text || !text.trim()) return;
    if (!groupLogs.has(groupJid)) groupLogs.set(groupJid, { messages: [], lastActive: Date.now() });
    
    const logEntry = groupLogs.get(groupJid);
    logEntry.lastActive = Date.now();
    const log = logEntry.messages;
    
    log.push({ name, text: text.slice(0, 200) });
    if (log.length > GROUP_CTX_SIZE) log.shift();
}

/**
 * Construye el bloque de contexto del grupo para inyectar al modelo.
 */
function buildGroupContext(groupJid) {
    const logEntry = groupLogs.get(groupJid);
    if (!logEntry || logEntry.messages.length === 0) return null;
    const lines = logEntry.messages.map(m => `${m.name}: ${m.text}`).join('\n');
    return `[Contexto reciente del grupo — mensajes anteriores de los participantes]:\n${lines}\n[Fin del contexto]`;
}

// Cronjob interno para prevenir memory leaks: limpiar historiales y logs inactivos (>24h)
setInterval(() => {
    const now = Date.now();
    for (const [from, history] of chatHistories.entries()) {
        if (history.lastActive && (now - history.lastActive > 24 * 60 * 60 * 1000)) {
            chatHistories.delete(from);
        }
    }
    for (const [groupJid, logEntry] of groupLogs.entries()) {
        if (logEntry.lastActive && (now - logEntry.lastActive > 24 * 60 * 60 * 1000)) {
            groupLogs.delete(groupJid);
        }
    }
}, 60 * 60 * 1000); // Revisar cada hora

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convierte los args de la IA al objeto `parsed` que esperan los handlers existentes.
 * Así los handlers no necesitan ningún cambio.
 */
function buildParsed(text, aiArgs = {}) {
    // Extraer flags y args posicionales desde los parámetros de la IA
    const flags = {};
    const args  = [];

    // Mappings de parámetros AI → flags del dispatcher original
    if (aiArgs.formato) {
        // Normalizar alias naturales → formatos reales que esperan los handlers
        const fmtAlias = {
            'word': 'docx', 'excel': 'xlsx', 'powerpoint': 'pptx',
            'ppt': 'pptx', 'xls': 'xlsx', 'doc': 'docx',
        };
        flags.f = fmtAlias[aiArgs.formato.toLowerCase()] ?? aiArgs.formato.toLowerCase();
    }
    if (aiArgs.calidad) {
        const qMap = { alta: '1080', media: '720', baja: '360' };
        flags.q = qMap[aiArgs.calidad] ?? aiArgs.calidad;
    }
    if (aiArgs.subtitulos) flags.s  = true;
    if (aiArgs.recortar)   flags.r  = true;
    if (aiArgs.animado)    flags.a  = true;
    if (aiArgs.zip)        flags.zip = true;
    if (aiArgs.como_audio) flags.w  = true;
    if (aiArgs.accion) {
        if (aiArgs.accion === 'terminar')  flags.terminar = true;
        if (aiArgs.accion === 'cancelar')  flags.cancelar = true;
    }

    // Formato para Spotify (flac, m4a, etc.)
    if (aiArgs.formato === 'flac') flags.flac = true;

    // Args posicionales: URL o texto libre van como args[0], args[1]...
    if (aiArgs.url)    args.push(aiArgs.url);
    if (aiArgs.texto)  args.push(aiArgs.texto);
    if (aiArgs.query)  args.push(aiArgs.query);
    if (aiArgs.accion && !flags.terminar && !flags.cancelar) args.push(aiArgs.accion);
    if (aiArgs.menu)   args.push(aiArgs.menu);       // para comandos como maicra
    if (aiArgs.tipo)   args.push(aiArgs.tipo);       // efecto
    if (aiArgs.usuario) args.push(aiArgs.usuario);   // moderación
    if (aiArgs.objetivo) args.push(aiArgs.objetivo); // info
    if (aiArgs.idioma) flags.l = aiArgs.idioma;

    return { command: '', flags, args, raw: text ?? '' };
}

/**
 * Construye el mensaje de contexto para la IA, incluyendo info del adjunto si existe.
 */
function buildUserMessage(text, messageType, messageData) {
    const parts = [];

    // Contexto del tipo de adjunto
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
    } else if (messageType === 'audioMessage') {
        // Audio sin texto → transcribir automáticamente sin llamar a la IA
        return '__AUTO_TRANSCRIBIR__';
    }

    return parts.join('\n') || '__SIN_TEXTO__';
}

// ─── Dispatcher principal ─────────────────────────────────────────────────────

async function dispatch(context) {
    const { from, text, messageType, messageData } = context;
    const isGroup = from.endsWith('@g.us');

    // ── Verificar acceso ──
    if (allAllowed.length > 0 && !allAllowed.some(id => from.includes(id))) {
        logger.warn(`[AI] Acceso denegado: ${from}`);
        return;
    }

    // ── Construir mensaje para la IA ──
    const userMessage = buildUserMessage(text, messageType, messageData);

    // ── Atajo: audio sin texto → transcribir directo (sin gastar tokens de la IA) ──
    if (userMessage === '__AUTO_TRANSCRIBIR__') {
        logger.info('[AI] Atajo automático: audio → transcribir');
        const parsed = buildParsed(text ?? '');
        await runHandler('transcribir', parsed, from, messageData);
        return;
    }

    if (userMessage === '__SIN_TEXTO__') return;

    // ── Atajo automático: Votos de encuestas (Bypass total de IA) ──
    // Al ser clics en botones predefinidos, la IA no debe meter las manos para evitar alucinaciones.
    if (context.isPollCommand) {
        logger.info(`[AI] Atajo automático: voto de encuesta → bypass IA (${text})`);
        const parts = text.split(' ');
        const toolName = parts[0].toLowerCase();
        const parsed = { command: toolName, flags: {}, args: parts.slice(1), raw: text };
        
        // Verificar permisos igual que la IA
        if (ADMIN_TOOLS.has(toolName)) {
            const participant = messageData?.key?.participant || from;
            const isAdmin = allAdmins.some(id => from.includes(id) || participant.includes(id));
            if (!isAdmin) {
                await sendText(from, `[!] acceso denegado\nno tienes privilegios para "${toolName}"`);
                return;
            }
        }
        
        await runHandler(toolName, parsed, from, messageData);
        return;
    }

    // ── Historial bot↔usuario ──
    if (!chatHistories.has(from)) chatHistories.set(from, []);
    const history = chatHistories.get(from);
    history.lastActive = Date.now();

    // ── Contexto del grupo (plática pasiva) ──
    const groupContext = isGroup ? buildGroupContext(from) : null;

    // ── Enviar "escribiendo..." y reaccionar ⏳ mientras la IA procesa ──
    sendTyping(from).catch(() => {});
    if (messageData && messageData.key) {
        sendReaction(from, '⏳', messageData.key).catch(() => {});
    }

    // ── Llamar al modelo ──
    let aiResult;
    try {
        aiResult = await callAI(userMessage, history, groupContext);
    } catch (err) {
        logger.error('[AI] Error llamando a Ollama:', err.message);
        await sendText(from, '⚠️ el cerebro del bot no responde, intenta de nuevo en unos segundos');
        return;
    }

    const { toolCall, text: aiText } = aiResult;

    // ── Guardar en el historial (Optimizado para IA Local) ──
    const safeUserMsg = userMessage.length > 300 ? userMessage.slice(0, 300) + '...[recortado]' : userMessage;
    history.push({ role: 'user', content: safeUserMsg });
    
    if (toolCall) {
        history.push({ role: 'assistant', content: JSON.stringify({ action: toolCall.name, args: toolCall.args }) });
    } else if (aiText) {
        const safeAiText = aiText.length > 150 ? aiText.slice(0, 150) + '...[recortado]' : aiText;
        history.push({ role: 'assistant', content: JSON.stringify({ action: 'chat', message: safeAiText }) });
    }
    // Mantener solo las últimas 6 interacciones (3 pares usuario-bot) para no saturar Ollama
    if (history.length > 6) history.splice(0, history.length - 6);

    // ── Respuesta de texto libre (saludo, pregunta, etc.) ──
    if (!toolCall) {
        if (messageData && messageData.key) {
            sendReaction(from, '', messageData.key).catch(() => {}); // Remover el ⏳ si solo fue charla
        }
        if (aiText) await sendText(from, aiText);
        return;
    }

    // ── Verificar permisos de admin ──
    const { name, args: aiArgs } = toolCall;
    if (ADMIN_TOOLS.has(name)) {
        const participant = messageData?.key?.participant || from;
        const isAdmin = allAdmins.some(id => from.includes(id) || participant.includes(id));
        if (!isAdmin) {
            await sendText(from, `[!] acceso denegado\nno tienes privilegios para "${name}"`);
            return;
        }
    }

    logger.info(`[AI] Ejecutando herramienta: ${name}`, aiArgs);

    // ── Construir el "parsed" compatible con los handlers existentes ──
    const parsed = buildParsed(text ?? '', aiArgs);

    // ── Ejecutar el handler y capturar su resultado para el historial ──
    // El primer texto que envíe el handler se guarda como respuesta del asistente,
    // así el modelo puede responder preguntas de seguimiento ('eso es mucho o poco?')
    await runHandler(name, parsed, from, messageData, (toolResultText) => {
        if (toolResultText && history.length > 0) {
            history.push({ role: 'assistant', content: toolResultText.slice(0, 150) + (toolResultText.length > 150 ? '...' : '') });
            if (history.length > 6) history.splice(0, history.length - 6);
        }
    });
}

/**
 * Ejecuta el handler correspondiente, con cola si aplica.
 * @param {Function} [onResult] - Callback que recibe el primer texto enviado al usuario
 */
async function runHandler(toolName, parsed, from, messageData, onResult = null) {
    let handler = null;
    const tier  = QUEUE_TIER[toolName] ?? null;

    // Wrapper de sendText que intercepta el primer mensaje enviado para el historial
    let resultCaptured = false;
    const capturingSendText = async (to, txt) => {
        if (!resultCaptured && onResult && txt) {
            resultCaptured = true;
            onResult(txt);
        }
        return sendText(to, txt);
    };

    switch (toolName) {
        case 'ayuda':
            handler = () => handleAyuda(parsed, from, messageData);
            break;

        case 'descargar':
            handler = () => handleDescargar(parsed, from, messageData);
            break;

        case 'spotify':
            handler = () => handleSpotify(parsed, from, messageData);
            break;

        case 'transcribir':
            handler = () => handleTranscribir(parsed, from, messageData);
            break;

        case 'convertir':
            handler = () => handleConvertir(parsed, from, messageData);
            break;

        case 'sticker':
            handler = () => handleSticker(parsed, from, messageData);
            break;

        case 'info':
            handler = () => handleInfo(parsed, from, messageData);
            break;

        case 'buscar':
            handler = () => handleBuscar(parsed, from, messageData);
            break;

        case 'doc':
            handler = () => handleDoc(parsed, from, messageData);
            break;

        case 'pdf2img':
            handler = () => handlePdf2Img(parsed, from, messageData);
            break;

        case 'comprimir':
            handler = () => handleComprimir(parsed, from, messageData);
            break;

        case 'unirpdf':
            handler = () => handleUnirPdf(parsed, from, messageData);
            break;

        case 'leer':
            handler = () => handleLeer(parsed, from, messageData);
            break;

        case 'efecto':
            handler = () => handleEfecto(parsed, from, messageData);
            break;

        case 'qr':
            handler = () => handleQr(parsed, from, messageData);
            break;

        case 'moderacion':
            handler = () => handleModeracion(parsed, from, messageData);
            break;

        case 'rank':
        case 'nivel':
            handler = () => handleRank(parsed, from, messageData);
            break;

        case 'top':
            handler = () => handleTop(parsed, from, messageData);
            break;

        case 'maicra':
            handler = () => handleMaicra(parsed, from, messageData);
            break;

        case 'drive':
            handler = () => handleDrive(parsed, from, messageData);
            break;

        case 'apagate':
            handler = () => handleApagar(from, messageData);
            break;

        default:
            logger.warn(`[AI] Tool desconocida (Alucinación): ${toolName}`);
            await sendText(from, `Perdón, no sé cómo ayudarte con eso o todavía no tengo esa función activada. 😓`);
            return;
    }

    // Nota: capturingSendText está definido pero los handlers usan sendText directamente.
    // Para capturar el resultado del tool, escuchamos la respuesta en el catch/resolve.
    // En una futura iteración los handlers podrán devolver el texto enviado.
    void capturingSendText; // suprimir warning de variable no usada

    if (!handler) return;

    try {
        if (messageData && messageData.key) {
            await sendReaction(from, '⏳', messageData.key).catch(() => {});
        }
        
        let result;
        if (tier) {
            result = await queue.add(from, handler, tier, toolName);
        } else {
            result = await handler();
        }
        
        if (messageData && messageData.key) {
            await sendReaction(from, '✅', messageData.key).catch(() => {});
        }
        
        // Si el handler devuelve texto, capturarlo para el historial
        if (result && typeof result === 'string' && onResult) {
            onResult(result);
        }
    } catch (err) {
        if (messageData && messageData.key) {
            await sendReaction(from, '❌', messageData.key).catch(() => {});
        }
        
        if (err.userMessage) {
            await sendText(from, `❌ ${err.userMessage}`);
        } else if (err.message?.includes('espera')) {
            await sendText(from, err.message);
        } else {
            logger.error(`[AI] Error ejecutando ${toolName}:`, err);
            await sendText(from, `[!] error ejecutando: ${toolName}`);
        }
    }
}

module.exports = { dispatch, addGroupMessage };
