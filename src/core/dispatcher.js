'use strict';

const { parse } = require('../core/parser');
const queue = require('../core/queue');
const logger = require('../services/logger');
const { sendText } = require('../services/evolution');
const nlp = require('../services/nlp');
const { detectFormatFromRegex, extractFlagsAndModifiers, adjustCommandByContext } = require('./extractors');

const { handleAyuda } = require('../commands/ayuda');
const { handleDescargar, getSearchSession, clearSearchSession, matchSelection, getDownloadSessionKey } = require('../commands/descargar');
const { handleTranscribir } = require('../commands/transcribir');
const { handleConvertir } = require('../commands/convertir');
const { handleSticker } = require('../commands/sticker');
const { handleInfo } = require('../commands/info');
const { handleDoc, handleComprimir, handlePdf2Img, handleUnirPdf } = require('../commands/documentos');
const { handleLeer } = require('../commands/ocr');
const { handleEfecto } = require('../commands/efectos');
const { handleQr } = require('../commands/qr');
const { handleModeracion } = require('../commands/moderacion');
const { handleRank, handleTop } = require('../commands/niveles');
const { handleMaicra } = require('../commands/maicra');
const { handleSpotify } = require('../commands/spotify');
const { handleApagar } = require('../commands/sistema');
const { cambiarTele } = require('../commands/cambiarTV');
const { handleBuscar, handleDownloadDrive } = require('../commands/buscar');
const { handleDrive } = require('../commands/drive');
const { handleSocial, SOCIAL_INTENTS } = require('../commands/social');
const { handleLore } = require('../commands/lore');
const { chatWithLlama, routeWithAI } = require('../services/ai');
const { getHistory, addMessage } = require('../services/history');
const groupsNormal = process.env.ALLOWED_GROUPS_NORMAL ? process.env.ALLOWED_GROUPS_NORMAL.split(',').map(n => n.trim().replace(/@.*$/, '')).filter(Boolean) : [];
const numbersNormal = process.env.ALLOWED_NUMBERS_NORMAL ? process.env.ALLOWED_NUMBERS_NORMAL.split(',').map(n => n.trim().replace(/@.*$/, '')).filter(Boolean) : [];
const groupsAdmin = process.env.ALLOWED_GROUPS_ADMIN ? process.env.ALLOWED_GROUPS_ADMIN.split(',').map(n => n.trim().replace(/@.*$/, '')).filter(Boolean) : [];
const numbersAdmin = process.env.ALLOWED_NUMBERS_ADMIN ? process.env.ALLOWED_NUMBERS_ADMIN.split(',').map(n => n.trim().replace(/@.*$/, '')).filter(Boolean) : [];

const allAllowed = [...groupsNormal, ...numbersNormal, ...groupsAdmin, ...numbersAdmin];
const allAdmins = [...groupsAdmin, ...numbersAdmin];

const chatCooldowns = new Map();

async function dispatch(context) {
    let { text } = context;
    const { from, messageType, messageData } = context;
    const isGroup = from.endsWith('@g.us');

    // Verificar seguridad general
    if (allAllowed.length > 0 && !allAllowed.some(id => from.includes(id))) {
        logger.warn(`Acceso denegado a ${from}`);
        return;
    }

    // Si no hay texto pero es un audio, asumir 'transcribir' automáticamente
    if (!text) {
        if (messageType === 'audioMessage' || messageData?.message?.audioMessage) {
            text = 'transcribir';
        } else {
            return;
        }
    }

    // ─── Sistema Anti-Spam / Cooldown (Desactivado temporalmente) ───
    /*
    const now = Date.now();
    const isGroup = from.endsWith('@g.us');
    const cooldownMs = isGroup ? 1000 : 1000; // 10 segs en grupos, 3 segs en privado
    const lastTime = chatCooldowns.get(from) || 0;

    if (now - lastTime < cooldownMs) {
        // Ignorar silenciosamente si envían comandos muy rápido
        logger.warn(`spam detectado en ${from}, espera:v`);
        return;
    }
    chatCooldowns.set(from, now);
    */

    // 🔍 Verificador de selección de lista activa aislado por participante
    const downloadSessionKey = getDownloadSessionKey(from, messageData);
    const activeSession = getSearchSession(downloadSessionKey);
    const selFromText = matchSelection(text);
    if (selFromText) {
        if (activeSession) {
            const idx = selFromText.num - 1;
            if (idx >= 0 && idx < activeSession.results.length) {
                const selected = activeSession.results[idx];
                activeSession.timestamp = Date.now();
                text = `descargar ${selected.url}${selFromText.format ? ' -f ' + selFromText.format : ''}`;
                logger.info(`[DISPATCHER-SELECT] ${downloadSessionKey} seleccionó #${selFromText.num}: "${selected.title}" (${selected.url})`);
            } else {
                await sendText(from, `Ese número no está en la lista cabrón, escoge del 1 al ${activeSession.results.length}.`);
                return;
            }
        } else if (text.trim().match(/^(?:oye\s+)?(?:descarga(?:me)?|baja(?:me)?|pasa(?:me)?|manda(?:me)?|tumba(?:te)?|dame|quiero)?\s*(?:el\s+|el\s+n[uú]mero\s+|n[uú]mero\s+|num\s+|#|el\s+video\s+|video\s+)?\s*\d{1,2}(?:\s+(?:en\s+|a\s+)?(?:mp3|mp4))?$/i)) {
            await sendText(from, `No hay ninguna lista de videos activa para ti compa (o ya expiró, dura 15 min). Pídeme una búsqueda primero, ej: *descarga video de [tema]*`);
            return;
        }
    }

    const parsed = parse(text);
    if (!parsed) return;

    const { command } = parsed;
    logger.info(`comando detectado: ${command}`);

    let handler = null;

    let cmdToSwitch = command;
    const rawUrl = require('../core/parser').extractUrl([parsed.originalCommand, ...parsed.args]);
    if (rawUrl && !['convertir', 'cv', 'doc', 'pdf', 'qr', 'buscar', 'drive', 'descargardrive'].includes(cmdToSwitch)) {
        if (!parsed.args.includes(rawUrl)) {
            parsed.args.unshift(rawUrl);
        }
        if (rawUrl.includes('spotify.com')) {
            cmdToSwitch = 'spotify';
        } else {
            // Cualquier enlace compatible con yt-dlp (YouTube, TikTok, IG, FB, Twitter/X, Reddit, sitios de adultos como XVideos/Pornhub, etc.)
            cmdToSwitch = 'descargar';
        }
    } else if (cmdToSwitch.includes('spotify.com')) {
        parsed.args.unshift(parsed.originalCommand);
        cmdToSwitch = 'spotify';
    } else if (require('../core/parser').extractUrl([cmdToSwitch])) {
        parsed.args.unshift(parsed.originalCommand);
        cmdToSwitch = 'descargar';
    }

    // 🧠 Motor NLP: siempre procesamos el texto para extraer entidades,
    // pero solo sobreescribimos el comando si NO fue un match exacto.
    const exactCommands = ['ayuda', 'help', 'descargar', 'descarga', 'baja', 'bajar', 'bajalo', 'bajate', 'descargalo', 'tumbate', 'dl', 'tiktok', 'tt', 'tk', 'spotify', 'sp', 'spo', 'transcribir', 'transcribe', 'tr', 'convertir', 'cv', 'sticker', 's', 'info', 'doc', 'pdf', 'comprimir', 'unir', 'unirpdf', 'unirpdfs', 'pdf2img', 'extraer', 'leer', 'ocr', 'efecto', 'qr', 'kick', 'ban', 'promote', 'demote', 'mute', 'unmute', 'warn', 'unwarn', 'rank', 'nivel', 'top', 'maicra', 'mc', 'apagate', 'buscar', 'descargardrive', 'drive', 'lore', 'lores', 'canon', 'cronica'];
    let nlpResult = null;

    const userName = messageData?.pushName || 'Compa';
    const quotedMsg = messageData?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const quotedText = quotedMsg?.conversation || quotedMsg?.extendedTextMessage?.text || '';
    const userMsgWithContext = quotedText ? `(respondiendo a: "${quotedText.slice(0, 100).replace(/\n/g, ' ')}") ${parsed.raw}` : parsed.raw;

    if (!exactCommands.includes(cmdToSwitch)) {
        const chatHistory = getHistory(from, 8);
        // Router Inteligente ultrarrápido con IA (Groq / Qwen / Llama)
        const aiDecision = await routeWithAI(userMsgWithContext, userName, isGroup, chatHistory);
        addMessage(from, 'user', userMsgWithContext, userName);

        if (aiDecision) {
            const action = aiDecision.action || aiDecision.comando || aiDecision.herramienta || aiDecision.tool;
            const chatMsg = aiDecision.message || aiDecision.args?.message;
            if (action === 'chat' && chatMsg) {
                logger.info(`[AI-CHAT] Respondiendo como Botsky: "${chatMsg.slice(0, 50)}..."`);
                await sendText(from, chatMsg);
                return;
            } else if (action && action !== 'chat') {
                logger.info(`[AI-ROUTER] Acción detectada: ${action} (args: ${JSON.stringify(aiDecision.args || {})}) para: "${parsed.raw}"`);
                cmdToSwitch = action;
                parsed.command = cmdToSwitch;
                if (aiDecision.args) {
                    if (aiDecision.args.animado) parsed.flags.a = true;
                    if (aiDecision.args.recortar) parsed.flags.r = true;
                    if (aiDecision.args.formato) parsed.flags.f = aiDecision.args.formato;
                    if (aiDecision.args.adult) parsed.flags.adult = true;
                    if (aiDecision.args.tipo) parsed.args = [aiDecision.args.tipo];
                    if (aiDecision.args.comando) parsed.args = [aiDecision.args.comando];
                    if (aiDecision.args.accion) {
                        parsed.flags.accion = aiDecision.args.accion;
                        parsed.args = [aiDecision.args.accion];
                    }
                    if (aiDecision.args.action) {
                        parsed.flags.accion = aiDecision.args.action;
                        parsed.args = [aiDecision.args.action];
                    }
                    if (aiDecision.args.user) {
                        parsed.args = [aiDecision.args.user];
                        if (aiDecision.args.reason) parsed.args.push(aiDecision.args.reason);
                    }
                    if (aiDecision.args.url) parsed.args = [aiDecision.args.url];
                    if (aiDecision.args.query) parsed.args = [aiDecision.args.query];
                    if (aiDecision.args.selection) {
                        const sess = getSearchSession(downloadSessionKey);
                        if (sess) {
                            const sIdx = aiDecision.args.selection - 1;
                            if (sIdx >= 0 && sIdx < sess.results.length) {
                                const selItem = sess.results[sIdx];
                                sess.timestamp = Date.now();
                                parsed.args = [selItem.url];
                                if (sess.isAdult) parsed.flags.adult = true;
                                logger.info(`[AI-SELECT] ${from} seleccionó #${aiDecision.args.selection}: "${selItem.title}"`);
                            } else {
                                await sendText(from, `Ese número no está en la lista cabrón, escoge del 1 al ${sess.results.length}.`);
                                return;
                            }
                        } else {
                            await sendText(from, `No hay ninguna lista de videos activa compa (o ya expiró). Pídeme una búsqueda primero, ej: *descarga video de [tema]*`);
                            return;
                        }
                    }
                }
            }
        } else {
            // Respaldo NLP SOLO si Groq no responde
            try {
                nlpResult = await nlp.processText(parsed.raw);
                if (nlpResult && nlpResult.intent && nlpResult.intent !== 'None' && nlpResult.score > 0.6) {
                    cmdToSwitch = nlpResult.intent;
                    parsed.command = cmdToSwitch;
                    logger.info(`[NLP] Asume intención: ${cmdToSwitch} (score: ${(nlpResult.score * 100).toFixed(1)}%) para: "${parsed.raw}"`);
                    parsed.args.unshift(parsed.originalCommand);
                }
            } catch (err) {
                logger.warn('[NLP] Error en respaldo NLP:', err.message);
            }
        }
    } else {
        addMessage(from, 'user', userMsgWithContext, userName);
    }

    // 💬 Interacción Social Directa (Saludos, agradecimientos, despedidas, etc.)
    if (SOCIAL_INTENTS.includes(cmdToSwitch)) {
        await handleSocial(cmdToSwitch, context);
        return;
    }

    // 🤖 Extracción de Entidades (Formatos) — corre SIEMPRE, incluso en comandos exactos.
    // Esto permite frases como "convertir a word" o "doc a pdf" sin usar flags manuales (-f).
    if (nlpResult && nlpResult.entities && !parsed.flags.f) {
        const formatoMedia = nlpResult.entities.find(e => e.entity === 'formatoMedia');
        const formatoDoc   = nlpResult.entities.find(e => e.entity === 'formatoDoc');
        const formatoImg   = nlpResult.entities.find(e => e.entity === 'formatoImg');

        if (formatoMedia) parsed.flags.f = formatoMedia.option;
        else if (formatoDoc) parsed.flags.f = formatoDoc.option;
        else if (formatoImg) parsed.flags.f = formatoImg.option;

        if (parsed.flags.f) {
            logger.info(`[NLP] Extrajo formato de destino mediante NER: -f ${parsed.flags.f}`);
        }
    }

    // Extracción de flag de animación (para stickers) — también corre siempre
    if ((cmdToSwitch === 'sticker' || cmdToSwitch === 'stiker') && !parsed.flags.a) {
        if (parsed.raw.toLowerCase().match(/animado|movimiento|animacion|mueve|gif|video/)) {
            parsed.flags.a = true;
            logger.info(`[NLP] Extrajo flag de animación automáticamente: -a`);
        }
    }

    const rawText = parsed.raw.toLowerCase();
    const normalizedText = nlp.normalizeText ? nlp.normalizeText(parsed.raw) : rawText;
    const combinedText = `${rawText} ${normalizedText}`;

    // 1.5. Extracción de Formato por Regex (Respaldo al NLP)
    if (!parsed.flags.f) {
        const detectedFmt = detectFormatFromRegex(combinedText);
        if (detectedFmt) {
            parsed.flags.f = detectedFmt;
            logger.info(`[REGEX] Extrajo formato de texto crudo: -f ${detectedFmt}`);
        }
    }

    // 🎯 Extracción Inteligente de Parámetros (Tiempos de corte, páginas, velocidad, calidad, nombre)
    const extractedParams = nlp.extractParameters(parsed.raw);
    if (extractedParams) {
        if (extractedParams.ss && !parsed.flags.ss) parsed.flags.ss = extractedParams.ss;
        if (extractedParams.to && !parsed.flags.to) parsed.flags.to = extractedParams.to;
        if (extractedParams.pages && !parsed.flags.pages && !parsed.flags.p) {
            parsed.flags.pages = extractedParams.pages;
            parsed.flags.p = extractedParams.pages;
        }
        if (extractedParams.speed && !parsed.flags.speed && !parsed.flags.v) {
            parsed.flags.speed = extractedParams.speed;
            parsed.flags.v = extractedParams.speed;
        }
        if (extractedParams.q && !parsed.flags.q) parsed.flags.q = extractedParams.q;
        if (extractedParams.bitrate && !parsed.flags.bitrate && !parsed.flags.b) {
            parsed.flags.bitrate = extractedParams.bitrate;
        }
        if (extractedParams.customName && !parsed.flags.name && !parsed.flags.n) {
            parsed.flags.name = extractedParams.customName;
            parsed.flags.n = extractedParams.customName;
        }
        if (Object.keys(extractedParams).length > 0) {
            logger.info(`[NLP] Parámetros extraídos: ${JSON.stringify(extractedParams)}`);
        }
    }

    // 2. Autocorrección de Sesgos (Contexto Cruzado y Tipo de Adjunto)
    cmdToSwitch = adjustCommandByContext(cmdToSwitch, rawText, messageData, parsed);

    // 3. Extracción de Modificadores (Flags Universales y Específicas)
    extractFlagsAndModifiers(cmdToSwitch, rawText, combinedText, parsed);

    // Verificar seguridad de comandos sensibles y de sistema
    // 1. Apagar host / bot: estrictamente super-admin (dueño)
    if (cmdToSwitch === 'apagate') {
        const participant = messageData?.key?.participant || from;
        const isSuperAdmin = numbersAdmin.some(id => from.includes(id) || participant.includes(id));
        if (!isSuperAdmin) {
            await sendText(from, `[!]acceso denegado\nsolo el mero dueño puede apagar el bot`);
            return;
        }
    }

    // 2. Comandos de Minecraft: permitidos en grupos y chats autorizados
    const mcCommands = ['maicra', 'mc'];
    if (mcCommands.includes(cmdToSwitch)) {
        const participant = messageData?.key?.participant || from;
        const isAuthorized = allAllowed.some(id => from.includes(id) || participant.includes(id)) || allAdmins.some(id => from.includes(id) || participant.includes(id));
        if (!isAuthorized) {
            await sendText(from, `[!]acceso denegado\neste grupo o chat no tiene permisos para el servidor de minecraft`);
            return;
        }
    }

    // ── queueTier: null = directo, 'light' = cola rápida (4 slots), 'heavy' = cola pesada (2 slots) ──
    let queueTier = null;

    switch (cmdToSwitch) {
        case 'ayuda':
        case 'help':
            handler = () => handleAyuda(parsed, from);
            break;

        case 'descargar':
        case 'descarga':
        case 'baja':
        case 'bajar':
        case 'bajalo':
        case 'bajate':
        case 'descargalo':
        case 'tumbate':
        case 'dl':
        case 'tiktok':
        case 'tt':
        case 'tk':
            handler = () => handleDescargar(parsed, from, messageData);
            queueTier = 'heavy';
            break;

        case 'spotify':
        case 'sp':
        case 'spo':
            handler = () => handleSpotify(parsed, from);
            queueTier = 'heavy';
            break;

        case 'transcribir':
        case 'tr':
            handler = () => handleTranscribir(parsed, from, messageData);
            queueTier = 'heavy';
            break;

        case 'convertir':
        case 'cv':
            handler = () => handleConvertir(parsed, from, messageData);
            queueTier = 'heavy';
            break;

        case 'sticker':
        case 's':
            handler = () => handleSticker(parsed, from, messageData);
            queueTier = 'light';
            break;

        case 'info':
            handler = () => handleInfo(parsed, from);
            break;

        case 'buscar':
            handler = () => handleBuscar(parsed, from, messageData);
            queueTier = 'light';
            break;
            
        case 'descargardrive':
            handler = () => handleDownloadDrive(parsed, from, messageData);
            queueTier = 'heavy';
            break;

        case 'drive':
            handler = () => handleDrive(parsed, from, messageData);
            queueTier = 'heavy';
            break;

        case 'doc':
        case 'pdf':
            {
                const isDocumentImage = messageData?.messageType?.toLowerCase().includes('document') &&
                    (messageData.message?.documentMessage?.mimetype?.startsWith('image/') ||
                        messageData.message?.documentMessage?.fileName?.toLowerCase().match(/\.(jpe?g|png|webp|gif)$/i));
                const isDocument = messageData?.messageType?.toLowerCase().includes('document') && !isDocumentImage;
                const isTerminarDoc = parsed.args[0] === 'terminar' || parsed.flags.terminar;
                const isCancelarDoc = parsed.args[0] === 'cancelar' || parsed.flags.cancelar;

                if (isTerminarDoc) {
                    queueTier = 'heavy';
                } else if (isCancelarDoc) {
                    queueTier = null;
                } else if (isDocument) {
                    // Conversión de documento con LibreOffice es pesada
                    queueTier = 'heavy';
                } else {
                    // Imagen para encolar o iniciar cola vacía es super ligera
                    queueTier = null;
                }
                handler = () => handleDoc(parsed, from, messageData);
            }
            break;

        case 'comprimir':
            handler = () => handleComprimir(parsed, from, messageData);
            queueTier = 'light';
            break;

        case 'unir':
        case 'unirpdf':
        case 'unirpdfs':
            {
                const isTerminarUnir = parsed.args[0] === 'terminar' || parsed.flags.terminar;
                const isCancelarUnir = parsed.args[0] === 'cancelar' || parsed.flags.cancelar;

                if (isTerminarUnir) {
                    queueTier = 'heavy';
                } else if (isCancelarUnir) {
                    queueTier = null;
                } else {
                    // Descargar/guardar el PDF temporal es super ligero
                    queueTier = null;
                }
                handler = () => handleUnirPdf(parsed, from, messageData);
            }
            break;

        case 'pdf2img':
        case 'extraer':
            handler = () => handlePdf2Img(parsed, from, messageData);
            queueTier = 'heavy';
            break;

        case 'leer':
        case 'ocr':
            handler = () => handleLeer(parsed, from, messageData);
            queueTier = 'light';
            break;

        case 'efecto':
            handler = () => handleEfecto(parsed, from, messageData);
            queueTier = 'light';
            break;

        case 'qr':
            handler = () => handleQr(parsed, from, messageData);
            queueTier = 'light';
            break;

        case 'kick':
        case 'ban':
        case 'promote':
        case 'demote':
        case 'mute':
        case 'unmute':
        case 'warn':
        case 'unwarn':
            handler = () => handleModeracion(parsed, from, messageData);
            break;

        case 'rank':
        case 'nivel':
            handler = () => handleRank(parsed, from, messageData);
            break;
        case 'canal':
            if (parsed.args.join(' ') == 'futbol'){
                const futbol = "https://futbol-libres.su/"
                handler = () => cambiarTele(from, futbol)
            }else if (parsed.args.join(' ')== 'llutuv'){
                const youtube = "https://youtube.com/tv"
                handler = () => cambiarTele(from, youtube)
            } else {
                await sendText(from, `> no entendi \`${parsed.raw}\`\n\nescribe */@ ayuda* para ver los comandos`);
                return;
            }
            break;
        case 'top':
            handler = () => handleTop(parsed, from, messageData);
            break;

        case 'maicra':
        case 'mc':
            handler = () => handleMaicra(parsed, from, messageData);
            queueTier = 'heavy';
            break;

        case 'lore':
        case 'lores':
        case 'canon':
        case 'cronica':
            handler = () => handleLore(parsed, from, messageData);
            queueTier = 'light';
            break;

        case 'apagate':
            if (parsed.args.join(' ') === 'papu') {
                // Ejecución directa, sin cola — el server se va a apagar
                handler = () => handleApagar(from);
            } else {
                await sendText(from, `> no entendi \`${parsed.raw}\`\n\nescribe */@ ayuda* para ver los comandos`);
                return;
            }
            break;


        default: {
            handler = async () => {
                const history = getHistory(from, 8);
                const reply = await chatWithLlama(userMsgWithContext, userName, isGroup, history);
                await sendText(from, reply);
            };
            queueTier = 'light';
            break;
        }
    }

    if (handler) {
        try {
            if (queueTier) {
                await queue.add(from, handler, queueTier);
            } else {
                await handler();
            }
        } catch (err) {
            if (err.message && err.message.includes('espera')) {
                await sendText(from, err.message);
            } else {
                logger.error(`error al ejecutar comando ${command}:`, err);
                await sendText(from, `[!] error al ejecutar: ${command}`);
            }
        }
    }
}

module.exports = { dispatch };

