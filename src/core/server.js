'use strict';

require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
// Dispatcher clásico autónomo con NLP sin dependencia de Ollama
const { dispatch } = require('../core/dispatcher');
const history = require('../services/history');
const addGroupMessage = (from, name, text) => { try { history.addMessage(from, name === 'Bot' ? 'assistant' : 'user', text, name); } catch(_) {} };
const logger = require('../services/logger');
const { startCleanupCron } = require('../services/cleanup');

// Iniciar cronjob de mantenimiento
startCleanupCron();

// ─── Monitor de RAM preventivo (Bug #25) ──────────────────────────────────────
// PM2 reinicia a 1GB sin aviso. Este monitor loggea advertencias antes de llegar al límite.
const RAM_WARN_MB  = parseInt(process.env.RAM_WARN_MB  ?? '700', 10); // ~70% de 1GB
const RAM_CRIT_MB  = parseInt(process.env.RAM_CRIT_MB  ?? '900', 10); // ~90% de 1GB
let _ramWarnFired  = false;
let _ramCritFired  = false;

setInterval(() => {
    const heapMB = process.memoryUsage().rss / (1024 * 1024);
    if (heapMB >= RAM_CRIT_MB && !_ramCritFired) {
        _ramCritFired = true;
        logger.error(`[RAM] ⛔ CRÍTICO: ${heapMB.toFixed(0)}MB — PM2 reiniciará el bot pronto`);
    } else if (heapMB >= RAM_WARN_MB && !_ramWarnFired) {
        _ramWarnFired = true;
        logger.warn(`[RAM] ⚠️  ADVERTENCIA: ${heapMB.toFixed(0)}MB — acercándose al límite de PM2`);
        if (typeof global.gc === 'function') {
            logger.info('[RAM] 🧹 Forzando Garbage Collection preventiva...');
            try { global.gc(); } catch (_) {}
        }
    } else if (heapMB < RAM_WARN_MB) {
        // Resetear flags si la memoria bajó (por GC o cleanup)
        _ramWarnFired = false;
        _ramCritFired = false;
    }
}, 60000); // Chequear cada 1 minuto

const app = express();
const PORT = parseInt(process.env.WEBHOOK_PORT ?? '3000', 10);
const HOST = process.env.WEBHOOK_HOST ?? '172.17.0.1';

// Asegurar directorio temporal
fs.mkdirSync(process.env.TMP_DIR ?? '/tmp/whatsapp-bot', { recursive: true });

// ─── Middlewares ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ─── Health check ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

// ─── Helpers para parsear el payload de Evolution API ─────────────────────────

/**
 * Extrae el texto de un mensaje según su tipo.
 * Soporta texto plano, extended text y captions de media.
 */
function extractText(message) {
    if (!message) return '';

    // Texto simple
    if (message.conversation) return message.conversation;

    // Texto extendido (links, quotes, etc.)
    if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;

    // Captions de media (imagen, video, documento, audio)
    const mediaTypes = [
        'imageMessage',
        'videoMessage',
        'audioMessage',
        'documentMessage',
        'documentWithCaptionMessage',
        'stickerMessage',
    ];

    for (const type of mediaTypes) {
        if (message[type]?.caption) return message[type].caption;
    }

    // Soporte especial para documentWithCaptionMessage
    if (message.documentWithCaptionMessage?.message?.documentMessage?.caption) {
        return message.documentWithCaptionMessage.message.documentMessage.caption;
    }

    return '';
}

/**
 * Detecta el tipo de mensaje.
 */
function detectMessageType(message) {
    if (!message) return 'unknown';

    const types = [
        'conversation',
        'extendedTextMessage',
        'imageMessage',
        'videoMessage',
        'audioMessage',
        'documentMessage',
        'documentWithCaptionMessage',
        'stickerMessage',
        'reactionMessage',
    ];

    return types.find(t => t in message) ?? 'unknown';
}

// ─── Memoria a corto plazo para multimedia ────────────────────────────────────
const lastMediaByUser = {};
const mediaCacheById = new Map(); // Para subir a Drive mediante reacciones
const processedPolls = new Map(); // Para asegurar que cada encuesta solo se procese una vez (pollId -> timestamp)

// Limpiar encuestas viejas de la memoria cada 10 minutos (evita memory leaks de setTimeout)
setInterval(() => {
    const now = Date.now();
    for (const [id, ts] of processedPolls) {
        if (now - ts > 3600000) processedPolls.delete(id); // 1 hora
    }
}, 600000);

// Limpiar mediaCacheById cada 15 minutos: entradas > 1h o si supera 500 entradas
setInterval(() => {
    const now = Date.now();
    const MAX_ENTRIES = 500;
    for (const [key, value] of mediaCacheById) {
        if (now - value.timestamp > 3600000) mediaCacheById.delete(key);
    }
    // Si aun así hay demasiadas, borrar las más viejas
    if (mediaCacheById.size > MAX_ENTRIES) {
        const sorted = [...mediaCacheById.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
        const toDelete = sorted.slice(0, mediaCacheById.size - MAX_ENTRIES);
        for (const [key] of toDelete) mediaCacheById.delete(key);
    }
}, 900000);

// ─── Webhook principal ────────────────────────────────────────────────────────

app.post('/webhook', async (req, res) => {
    // Responder rápido a Evolution API para evitar retries
    res.sendStatus(200);

    try {
        const body = req.body;

        if (body.event !== 'messages.upsert') return;

        const data = body.data;
        if (!data) return;

        if (data.key?.fromMe) {
            const from = data.key?.remoteJid;
            const text = extractText(data.message).trim();
            if (from && from.endsWith('@g.us') && text) {
                addGroupMessage(from, 'Bot', text);
            }
            return;
        }

        const from = data.key?.remoteJid;
        if (!from) return;

        const message = data.message;
        const messageType = data.messageType ?? detectMessageType(message);
        let text = extractText(message).trim();
        const pushName = data.pushName ?? 'Usuario';
        const isGroup = from.endsWith('@g.us');
        const participant = data.key?.participant || from;
        const cacheKey = isGroup ? participant : from;

        // ── Guardar multimedia en caché ANTES de filtrar ──
        const currentMediaTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'documentWithCaptionMessage', 'stickerMessage'];
        if (currentMediaTypes.includes(messageType)) {
            // En grupos guardamos por persona (participant) para que no se crucen las fotos de diferentes usuarios
            lastMediaByUser[cacheKey] = { data, messageType };

            // Para el sistema de Drive con reacciones, guardamos por ID del mensaje
            const messageId = data.key?.id;
            if (messageId) {
                mediaCacheById.set(messageId, { data, messageType, timestamp: Date.now() });
            }
        }

        // ── Lógica de Reacciones (Subida a Drive) ──
        if (messageType === 'reactionMessage' || data.reactionMessage || message?.reactionMessage) {
            const reaction = data.reactionMessage || message?.reactionMessage;
            if (reaction && reaction.text === '👍') {
                const targetMsgId = reaction.key?.id;
                if (targetMsgId && mediaCacheById.has(targetMsgId)) {
                    const cachedMedia = mediaCacheById.get(targetMsgId);
                    
                    const { handleDrive } = require('../commands/drive');
                    // Ejecutamos la subida a Drive (sin await para no bloquear el webhook)
                    handleDrive(cachedMedia.data, from, targetMsgId).catch(err => {
                        console.error('Error al subir por reacción:', err);
                    });
                }
            }
            return; // No procesar la reacción como un comando de texto
        }

        // ── Lógica del prefijo /@ ──
        const PREFIX = '/@';
        let hasPrefix = false;
        let isPollCommand = false;
        if (text.startsWith(PREFIX)) {
            text = text.slice(PREFIX.length).trim();
            hasPrefix = true;
        }

        // ── Lógica de Votos de Encuestas ──
        if (messageType === 'pollUpdateMessage' || data.pollUpdateMessage) {
            const vote = message?.pollUpdateMessage?.vote || data?.pollUpdateMessage?.vote || data?.vote || message?.pollUpdateMessage?.voters?.[0];
            const options = vote?.selectedOptions || vote?.options;

            if (options && Array.isArray(options) && options.length > 0) {
                const pollCreationKey = message?.pollUpdateMessage?.pollCreationMessageKey || null;
                const pollId = pollCreationKey?.id || data?.key?.id;
                const optionName = options[0].name || options[0];
                const cleanOption = optionName.toString().trim();

                // Asegurar que la encuesta solo se procese UNA VEZ para evitar bugs,
                // PERO permitir que "Volver al Menú" se pueda usar infinitas veces en la misma encuesta
                if (pollId) {
                    if (cleanOption !== '🔙 Volver al Menú Principal') {
                        if (processedPolls.has(pollId)) return;
                        processedPolls.set(pollId, Date.now());
                    }
                }

                // Mapeo de opciones de encuestas a comandos reales
                const pollMappings = {
                    // Menús de Categorías Principales
                    '⚙️ Gestión del Servidor': 'maicra menu server',
                    '🌍 Mundo y Clima': 'maicra menu mundo',
                    '🎮 Modos y Dificultad': 'maicra menu jugadores',
                    '📜 Reglas del Juego': 'maicra menu reglas',
                    '🔙 Volver al Menú Principal': 'maicra menu',

                    // Opciones de Servidor (Max 10)
                    '🟢 Encender Servidor': 'maicra on',
                    '🔴 Apagar Servidor': 'maicra off',
                    '🔄 Reiniciar Servidor': 'maicra reiniciar',
                    '📊 Estado y Recursos': 'maicra estado',
                    '📡 Ping y Jugadores': 'maicra ping',
                    '💾 Forzar Guardado': 'maicra cmd save-all',
                    '🗑️ Limpiar Basura (Items)': 'maicra cmd kill @e[type=item]',
                    '📜 Ver Logs (Últimos 10)': 'maicra logs',
                    '⛔ Apagar de Emergencia': 'maicra kill',

                    // Opciones de Mundo (Max 10)
                    '☀️ Hacer de Día (6am)': 'maicra cmd time set day',
                    '🌆 Atardecer (6pm)': 'maicra cmd time set sunset',
                    '🌙 Hacer de Noche': 'maicra cmd time set night',
                    '🌌 Medianoche (12am)': 'maicra cmd time set midnight',
                    '🌧️ Activar Lluvia': 'maicra cmd weather rain',
                    '☀️ Quitar Lluvia': 'maicra cmd weather clear',
                    '🌩️ Activar Tormenta': 'maicra cmd weather thunder',
                    '⏸️ Pausar Ciclo de Día': 'maicra cmd gamerule dodaylightcycle false',
                    '▶️ Reanudar Ciclo de Día': 'maicra cmd gamerule dodaylightcycle true',

                    // Opciones de Modos y Dificultad (Max 10)
                    '🧑‍💻 Todos a Creativo': 'maicra cmd gamemode creative @a',
                    '🗡️ Todos a Supervivencia': 'maicra cmd gamemode survival @a',
                    '🗺️ Todos a Aventura': 'maicra cmd gamemode adventure @a',
                    '🕊️ Dificultad: Pacífica': 'maicra cmd difficulty peaceful',
                    '🟢 Dificultad: Fácil': 'maicra cmd difficulty easy',
                    '🟡 Dificultad: Normal': 'maicra cmd difficulty normal',
                    '🔴 Dificultad: Difícil': 'maicra cmd difficulty hard',

                    // Reglas del Juego (Max 10)
                    '🛡️ Quitar Fuego Amigo (PvP Off)': 'maicra cmd gamerule pvp false',
                    '⚔️ Activar Fuego Amigo (PvP On)': 'maicra cmd gamerule pvp true',
                    '🎒 Conservar Inventario': 'maicra cmd gamerule keepinventory true',
                    '💥 Perder Inventario': 'maicra cmd gamerule keepinventory false',
                    '🚫 Quitar Daño por Caída': 'maicra cmd gamerule falldamage false',
                    '☠️ Activar Daño por Caída': 'maicra cmd gamerule falldamage true'
                };

                logger.info(`[POLL DEBUG] Opción seleccionada: "${cleanOption}" por participante: ${participant} en ${from}`);

                const upperCleanOption = cleanOption.toUpperCase();

                if (pollMappings[cleanOption]) {
                    text = pollMappings[cleanOption];
                    hasPrefix = true; // Simular que el voto fue un comando intencional
                    isPollCommand = true;
                    logger.info(`Voto de encuesta procesado: ${cleanOption} -> ${text}`);
                }

            }
        }

        // ── Sistema de Experiencia (Solo en Grupos y mensajes normales) ──
        if (isGroup && !hasPrefix && messageType !== 'unknown') {
            const db = require('../services/db');
            try {
                // Agregar 1 de XP por mensaje
                const { levelUp, level } = await db.addXp(participant);
                if (levelUp && level > 1) {
                    logger.info(`🏆 ${participant} subió a nivel ${level}`);
                    // Opcional: puedes descomentar esto si quieres que el bot los felicite en el grupo
                    // await require('../services/evolution').sendText(from, `🎉 ¡Felicidades @${participant.split('@')[0]}! Has subido al Nivel ${level} 🏆`);
                }
            } catch (err) {
                logger.error(`Error sumando XP a ${participant}:`, err.message);
            }
        }

        // Si el mensaje NO tiene el prefijo /@ (ya sea en grupo o privado), lo ignoramos como comando
        // A menos que sea una imagen/documento y el usuario tenga una sesión activa de unir/crear PDF,
        // o si es una respuesta numérica para descargar de Drive
        if (!hasPrefix) {
            // ── Registrar en el log de contexto del grupo (plática pasiva) ──
            // Esto permite al bot conocer de qué habla el grupo cuando alguien le pregunta
            if (isGroup && text && text.trim()) {
                addGroupMessage(from, pushName, text);
            }

            const { hasActiveSession } = require('../commands/documentos');
            const { hasActiveSearchSession, getSessionKey } = require('../commands/buscar');
            
            const sessionType = hasActiveSession(from, participant);
            const isImage = messageType?.toLowerCase().includes('image') || 
                            (messageType?.toLowerCase().includes('document') && 
                             (data.message?.documentMessage?.mimetype?.startsWith('image/') || 
                              data.message?.documentMessage?.fileName?.toLowerCase().match(/\.(jpe?g|png|webp|gif)$/i) ||
                              data.message?.documentWithCaptionMessage?.message?.documentMessage?.mimetype?.startsWith('image/') ||
                              data.message?.documentWithCaptionMessage?.message?.documentMessage?.fileName?.toLowerCase().match(/\.(jpe?g|png|webp|gif)$/i)));
            const isPdf = messageType?.toLowerCase().includes('document') && 
                          (text.toLowerCase().endsWith('.pdf') || 
                           (data.message?.documentMessage?.mimetype === 'application/pdf') || 
                           (data.message?.documentWithCaptionMessage?.message?.documentMessage?.mimetype === 'application/pdf'));

            // Usar la misma clave que usa buscar.js (participante en grupos)
            const driveSessionKey = getSessionKey(from, data);

            if (hasActiveSearchSession(driveSessionKey) && /^[1-5]$/.test(text.trim())) {
                text = `descargardrive ${text.trim()}`;
                hasPrefix = true;
            } else if (sessionType === 'pdf' && isImage) {
                text = 'pdf';
                hasPrefix = true;
            } else if (sessionType === 'unir' && isPdf) {
                text = 'unir';
                hasPrefix = true;
            } else if (!isGroup && text && text.trim()) {
                // En chat privado, permitir conversación directa sin necesidad de prefijo /@
                hasPrefix = true;
            } else {
                return;
            }
        }

        logger.info(`[${pushName} | ${from}] ${messageType}: "${text.slice(0, 80)}"`);


        let actualMessageData = data;
        let actualMessageType = messageType;

        // Si es un documento con caption (nativa de WhatsApp)
        if (messageType === 'documentWithCaptionMessage' && message.documentWithCaptionMessage?.message?.documentMessage) {
            actualMessageType = 'documentMessage';
            actualMessageData = {
                ...data,
                message: { documentMessage: message.documentWithCaptionMessage.message.documentMessage },
                messageType: 'documentMessage'
            };
        }
        // ── Extracción de Quotes SIEMPRE ACTIVA (Se eliminó el 'else' restrictivo) ──
        // Buscar contextInfo exhaustivamente: en cada sub-objeto de message y en data raíz
        let contextInfo = null;

        // 1. Dentro de cada campo de message (el más común)
        if (message && typeof message === 'object') {
            for (const val of Object.values(message)) {
                if (val && typeof val === 'object' && val.contextInfo?.quotedMessage) {
                    contextInfo = val.contextInfo;
                    break;
                }
            }
        }

        // 2. Directamente en data (algunos clientes lo mandan así)
        if (!contextInfo && data.contextInfo?.quotedMessage) {
            contextInfo = data.contextInfo;
        }

        if (contextInfo?.quotedMessage) {
            const quoted = contextInfo.quotedMessage;
            const quotedType = detectMessageType(quoted);
            logger.info(`[QUOTE] tipo detectado en mensaje citado: ${quotedType}`);

            if (currentMediaTypes.includes(quotedType)) {
                let finalQuoted = quoted;
                let finalType = quotedType;

                // Desestructuración segura y explícita para documentos citados
                if (quotedType === 'documentWithCaptionMessage' && quoted.documentWithCaptionMessage?.message?.documentMessage) {
                    finalQuoted = { documentMessage: quoted.documentWithCaptionMessage.message.documentMessage };
                    finalType = 'documentMessage';
                } else if (quotedType === 'documentMessage') {
                    finalQuoted = { documentMessage: quoted.documentMessage };
                    finalType = 'documentMessage';
                }

                actualMessageType = finalType;
                actualMessageData = {
                    ...data,
                    message: finalQuoted,
                    messageType: finalType,
                    // La key del mensaje citado: participant es quien lo envió originalmente
                    quotedStanzaId: contextInfo.stanzaId,
                    quotedParticipant: contextInfo.participant ?? data.key?.remoteJid,
                };
                logger.info(`[QUOTE] multimedia encontrado: tipo=${finalType}, stanzaId=${contextInfo.stanzaId}`);
            } else {
                logger.info(`[QUOTE] mensaje citado no es multimedia (${quotedType}), ignorando`);
            }
        }
        
        // Si NO se encontró un quote con multimedia, intentar con el último multimedia en caché
        if (actualMessageType === messageType && !currentMediaTypes.includes(messageType) && lastMediaByUser[cacheKey]) {
            const parts = text.split(' ');
            const parsedCommand = parts[0].toLowerCase();
            const commandsRequiringMedia = ['efecto', 'leer', 'ocr', 'comprimir', 'sticker', 's', 'pdf2img', 'extraer', 'transcribir', 'tr', 'convertir', 'cv'];

            const isMediaIntent = commandsRequiringMedia.includes(parsedCommand) ||
                                  (parsedCommand === 'qr' && parts.length === 1) ||
                                  /\b(sticker|calca|pegatina|transcribe|escucha|leer|ocr|comprime|pdf|convierte)\b/i.test(text);

            if (isMediaIntent) {
                const last = lastMediaByUser[cacheKey];
                let lastType = last.messageType;
                let lastData = last.data;
                let lastMsg = lastData.message;

                if (lastType === 'documentWithCaptionMessage' && lastMsg.documentWithCaptionMessage?.message?.documentMessage) {
                    lastData = { ...lastData, message: { documentMessage: lastMsg.documentWithCaptionMessage.message.documentMessage } };
                    lastType = 'documentMessage';
                }

                actualMessageType = lastType;
                actualMessageData = lastData;
                logger.info(`Usando el último multimedia enviado por ${participant} (${lastType}) para el comando ${parsedCommand}`);
            }
        }

        // ── Dispatch ──
        await dispatch({
            from,
            text,
            messageType: actualMessageType,
            messageData: actualMessageData,
            isPollCommand,
        });

    } catch (err) {
        logger.error('Webhook error:', err.message, err.stack?.split('\n')[1]);
    }
});

// ─── Ruta de estado de la cola ────────────────────────────────────────────────
app.get('/status', (req, res) => {
    const queue = require('../core/queue');
    res.json({
        status: 'running',
        queue: queue.stats,
        time: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
    });
});

// ─── Iniciar servidor ─────────────────────────────────────────────────────────
const axios = require('axios');

async function startServer() {
    app.listen(PORT, HOST, () => {
        logger.success(`Bot iniciado en http://${HOST}:${PORT}`);
        logger.info(`Webhook:  POST http://${HOST}:${PORT}/webhook`);
        logger.info(`Status:   GET  http://${HOST}:${PORT}/status`);
        logger.info(`Instancia Evolution API: ${process.env.EVOLUTION_INSTANCE}`);
        logger.info('Modo:     Comandos directos (/@) autónomos con Dispatcher + NLP (sin Ollama)');

        const allowed = process.env.ALLOWED_NUMBERS_NORMAL;
        if (allowed) {
            logger.info(`Números autorizados: ${allowed}`);
        } else {
            logger.warn('⚠️  Sin ALLOWED_NUMBERS definidos — cualquier número puede usar el bot.');
        }
    });
}

startServer().catch(err => {
    logger.error('Fallo crítico al iniciar el bot:', err);
    process.exit(1);
});

// ─── Manejo de errores no capturados ─────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
    logger.error('UnhandledRejection:', reason?.message ?? reason);
});
process.on('uncaughtException', (err) => {
    logger.error('UncaughtException:', err.message);
    // No salir; el bot debe seguir corriendo
});

// Limpieza de /tmp gestionada centralizadamente por src/services/cleanup.js
