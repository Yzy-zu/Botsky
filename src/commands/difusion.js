'use strict';

const fs = require('fs');
const path = require('path');
const evolution = require('../services/evolution');
const { isAuthorizedAdmin } = require('../core/auth');
const db = require('../services/db');
const logger = require('../services/logger');
const { callGemini } = require('../services/ai');
const { cleanup } = require('../utils/cleanup');

const BOT_NUMBER = (process.env.BOT_NUMBER || '5214437367565').replace(/[^0-9]/g, '');
const DIFUSION_XP_COST = 5000;
const TMP_DIR = process.env.TMP_DIR ?? '/tmp/whatsapp-bot';

/**
 * Concurrencia controlada para enviar a todos los destinatarios en paralelo
 * completando ~12 envíos en 2-4 segundos.
 */
async function parallelDispatch(items, concurrency, fn) {
    const results = [];
    const executing = new Set();
    for (const item of items) {
        const p = Promise.resolve().then(() => fn(item));
        results.push(p);
        executing.add(p);
        const clean = () => executing.delete(p);
        p.then(clean, clean);
        if (executing.size >= concurrency) {
            await Promise.race(executing);
        }
    }
    return Promise.allSettled(results);
}

/**
 * Extrae el JID estándar de WhatsApp para enviar mensajes directos
 */
function getParticipantJid(p) {
    if (!p) return null;
    if (typeof p === 'string') return p;
    if (p.phoneNumber) {
        const num = String(p.phoneNumber).replace(/[^0-9]/g, '');
        if (num.length >= 10) return `${num}@s.whatsapp.net`;
    }
    if (p.id) {
        if (p.id.endsWith('@s.whatsapp.net')) return p.id;
        const num = String(p.id).replace(/[^0-9]/g, '');
        if (!p.id.includes('@lid') && num.length >= 10) return `${num}@s.whatsapp.net`;
        return p.id;
    }
    return null;
}

/**
 * Verifica si un JID corresponde al bot
 */
function isBotJid(jid) {
    if (!jid) return true;
    const clean = String(jid).replace(/[^0-9]/g, '');
    return clean.includes(BOT_NUMBER);
}

/**
 * Genera mensajes ácidos y personalizados para cada integrante del grupo con Gemini en una sola llamada
 */
async function generateRoastMessages(targets) {
    const targetList = targets.map(t => ({
        jid: t.jid,
        name: t.name || 'Compa'
    }));

    const systemPrompt = `Eres Botsky, el bot con humor norteño/mexicano, pesado, sarcástico y burlón de un grupo escolar.
Genera un mini-mensaje privado (1 o 2 frases contundentes, máximo 20 palabras) para cada uno de los integrantes del grupo escolar explicando con humor negro por qué te cae mal o soltando una verdad pesada pero cómica.
Prohibido modismos españoles (nada de tío, chaval, coño). 100% mexicano callejero y ácido.
Devuelve ÚNICAMENTE un JSON donde la clave sea el JID y el valor la frase de texto.`;

    const userMessage = `Integrantes del grupo:\n${JSON.stringify(targetList, null, 2)}`;

    try {
        const raw = await callGemini({
            systemInstruction: systemPrompt,
            userMessage,
            temperature: 0.9,
            maxOutputTokens: 800,
            responseMimeType: 'application/json',
            timeout: 4500
        });
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
    } catch (err) {
        logger.warn(`[DIFUSION-AI] Fallback en generación de roasts: ${err.message}`);
    }
    return null;
}

/**
 * Manejador principal del comando de difusión masiva
 */
async function handleDifusion(parsed = {}, from, messageData = {}) {
    const senderJid = messageData?.key?.participant || messageData?.participant || from;
    const isAdmin = isAuthorizedAdmin(from, messageData);
    const isGroup = from.endsWith('@g.us');

    const params = parsed.aiArgs || {};
    const rawText = String(params.mensaje ?? params.texto ?? (!parsed.semanticDecision ? parsed.args?.join(' ') : '') ?? '').trim();
    const isRoast = parsed.semanticDecision ? params.roast === true : params.roast === true || parsed.flags?.roast === true;
    if (!rawText && !isRoast) {
        return await evolution.sendText(from, '¿Qué mensaje quieres mandar a todos?');
    }

    // 1. Control de Acceso y Costo de Experiencia
    if (!isAdmin) {
        const user = await db.getOrCreateUser(senderJid);
        if (user.xp < DIFUSION_XP_COST) {
            return await evolution.sendText(from,
                `📢 *DIFUSIÓN DENEGADA*\n\n` +
                `Para enviar una difusión a todos los miembros necesitas ser *Administrador* o pagar *${DIFUSION_XP_COST.toLocaleString('es-MX')} XP*.\n` +
                `Tu saldo actual: *${user.xp.toLocaleString('es-MX')} XP*.`
            );
        }
        await db.subtractXp(senderJid, DIFUSION_XP_COST);
        logger.info(`[DIFUSION] Descontados ${DIFUSION_XP_COST} XP a ${senderJid} por difusión.`);
    }

    // 2. Determinar el grupo objetivo
    let targetGroupJid = isGroup ? from : null;
    if (!targetGroupJid) {
        const schoolSettings = await db.getSchoolSettings(senderJid);
        if (schoolSettings?.target_group_jid && schoolSettings.target_group_jid.endsWith('@g.us')) {
            targetGroupJid = schoolSettings.target_group_jid;
        }
    }

    if (!targetGroupJid) {
        return await evolution.sendText(from,
            `> ⚠️ Para hacer una difusión desde privado debes tener configurado el grupo escolar (o usar el comando dentro del grupo).`
        );
    }

    // 3. Obtener participantes del grupo
    let groupData = null;
    try {
        const res = await evolution.getGroupInfo(targetGroupJid);
        groupData = res?.data || res;
        if (Array.isArray(groupData)) groupData = groupData[0];
    } catch (e) {
        logger.error(`[DIFUSION] Error al obtener participantes del grupo ${targetGroupJid}: ${e.message}`);
        return await evolution.sendText(from, `> ❌ No se pudo consultar la lista de participantes del grupo.`);
    }

    const participants = groupData?.participants || [];
    if (!participants || participants.length === 0) {
        return await evolution.sendText(from, `> ⚠️ No se encontraron integrantes en el grupo.`);
    }

    // 4. Filtrar destinatarios (excluir al bot y al emisor para no autospamearse)
    const cleanSender = String(senderJid).replace(/[^0-9]/g, '');
    const targets = [];
    for (const p of participants) {
        const jid = getParticipantJid(p);
        if (!jid) continue;
        if (isBotJid(jid)) continue;
        if (jid.replace(/[^0-9]/g, '') === cleanSender) continue;

        targets.push({
            jid,
            name: p.name || p.pushName || p.notify || 'Compa'
        });
    }

    if (targets.length === 0) {
        return await evolution.sendText(from, `> ⚠️ No hay destinatarios válidos para la difusión.`);
    }

    // 5. Detectar si viene con imagen adjunta o citada
    let mediaPath = null;
    const isImage = messageData?.messageType === 'imageMessage' ||
                    messageData?.actualMessageType === 'imageMessage' ||
                    messageData?.message?.imageMessage ||
                    messageData?.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;

    if (isImage) {
        try {
            const downloadTarget = messageData?.actualMessageData || messageData;
            const downloaded = await evolution.downloadMedia(downloadTarget);
            if (downloaded && downloaded.buffer) {
                const ext = downloaded.extension || 'jpg';
                const tempFile = path.join(TMP_DIR, `difusion_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`);
                fs.writeFileSync(tempFile, downloaded.buffer);
                mediaPath = tempFile;
            }
        } catch (err) {
            logger.warn(`[DIFUSION] No se pudo descargar la imagen para difusión: ${err.message}`);
        }
    }

    // 6. Preparar contenido del mensaje
    let roastMap = null;
    if (isRoast) {
        await evolution.sendText(from, `> ⚡ Generando y disparando difusión personalizada a los ${targets.length} integrantes...`);
        roastMap = await generateRoastMessages(targets);
    }

    // Mensaje base si no hay roast
    const defaultBroadcast = rawText || (mediaPath ? '📢 Mensaje de difusión grupal' : '📢 Mensaje de difusión grupal de Botsky.');

    // 7. Envío paralelo con concurrencia 4 (máxima velocidad: 12 personas en 1.5 - 3.5 segundos)
    const startTime = Date.now();
    let sentCount = 0;
    let failCount = 0;

    try {
        await parallelDispatch(targets, 4, async (target) => {
            const personalText = (roastMap && roastMap[target.jid])
                ? roastMap[target.jid]
                : defaultBroadcast;

            try {
                if (mediaPath) {
                    await evolution.sendMedia(target.jid, mediaPath, personalText);
                } else {
                    await evolution.sendText(target.jid, personalText);
                }
                sentCount++;
            } catch (err) {
                failCount++;
                logger.warn(`[DIFUSION] Error enviando a ${target.jid}: ${err.message}`);
            }
        });
    } finally {
        if (mediaPath) {
            cleanup(mediaPath);
        }
    }

    const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);

    // 8. Confirmación al solicitante
    return await evolution.sendText(from,
        `📢 *DIFUSIÓN COMPLETADA*\n\n` +
        `✅ *Enviados:* ${sentCount} personas\n` +
        (failCount > 0 ? `❌ *Fallidos:* ${failCount}\n` : '') +
        `⏱️ *Tiempo total:* ${elapsedSeconds}s\n` +
        (!isAdmin ? `💰 *Costo:* 5,000 XP consumidos\n` : `👑 *Autorizado:* Administrador`)
    );
}

module.exports = {
    handleDifusion,
    parallelDispatch,
    getParticipantJid,
    isBotJid,
    DIFUSION_XP_COST
};
