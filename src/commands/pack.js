'use strict';

const fs = require('fs');
const evolution = require('../services/evolution');
const db = require('../services/db');
const logger = require('../services/logger');
const { getSenderJid, cleanJidNumber } = require('../core/auth');
const packImages = require('../services/packImages');

const STANDARD_COST_XP = 150;
const DEFAULT_THROTTLE_MS = 500;

/**
 * Pausa asíncrona para throttling entre envíos.
 * @param {number} ms
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Normaliza un JID de usuario eliminando sufijos de dispositivo.
 * @param {string} jid
 * @returns {string}
 */
function normalizeJid(jid) {
    if (!jid || typeof jid !== 'string') return '';
    return jid.trim().replace(/:[0-9]+(?=@)/, '').replace(/:[0-9]+$/, '');
}

/**
 * Verifica si un grupo está autorizado para operar comandos.
 * @param {string} from - JID del grupo (@g.us)
 * @param {object} [options={}]
 * @returns {boolean}
 */
function isGroupAuthorized(from, options = {}) {
    if (!from || typeof from !== 'string' || !from.endsWith('@g.us')) {
        return false;
    }
    if (options.authorized || options.skipAuth) {
        return true;
    }
    const normal = process.env.ALLOWED_GROUPS_NORMAL;
    const admin = process.env.ALLOWED_GROUPS_ADMIN;
    if (!normal && !admin) {
        return true;
    }
    const allowed = [
        ...(normal ? normal.split(',') : []),
        ...(admin ? admin.split(',') : [])
    ].map(g => g.trim().replace(/@.*$/, '')).filter(Boolean);
    if (allowed.length === 0) {
        return true;
    }
    const clean = from.replace(/[^0-9]/g, '');
    return allowed.some(id => from.includes(id) || clean.includes(id.replace(/[^0-9]/g, '')));
}

/**
 * Saneamiento y resolución del destinatario privado del comprador (R4).
 * Maneja variantes telefónicas mexicanas ('521' vs '52') y opera en Fail-Closed
 * estricto si el remitente solo dispone de un identificador '@lid' sin número telefónico.
 *
 * @param {string} from - JID del chat entrante
 * @param {object} messageData - Metadatos del mensaje
 * @returns {Promise<{ isLidOnly: boolean, senderJid: string, userJid: string, privateJid: string, phone: string }>}
 */
async function resolveBuyer(from, messageData = {}, options = {}) {
    const senderJid = getSenderJid(from, messageData);
    const cleanDigits = cleanJidNumber(senderJid);

    // Fail-Closed: Si no se pueden obtener dígitos telefónicos (LID puro o inválido)
    if (!cleanDigits) {
        return {
            isLidOnly: true,
            senderJid,
            userJid: normalizeJid(senderJid),
            privateJid: '',
            phone: ''
        };
    }

    // Normalización de números en México para WhatsApp:
    // Formato canónico móvil de WhatsApp: 521 + 10 dígitos (13 dígitos)
    let canonicalPhone = cleanDigits;
    if (cleanDigits.length === 10) {
        canonicalPhone = `521${cleanDigits}`;
    } else if (cleanDigits.length === 12 && cleanDigits.startsWith('52')) {
        canonicalPhone = `521${cleanDigits.slice(2)}`;
    }

    const privateJid = `${canonicalPhone}@s.whatsapp.net`;
    const normalizedSender = normalizeJid(senderJid);

    let isHappy = options?.isHappyHour;
    if (isHappy === undefined) {
        try {
            const happyHour = require('../services/happyHour');
            isHappy = happyHour.isHappyHourActive(from);
        } catch (_) {
            isHappy = false;
        }
    }
    const requiredXp = typeof options?.cost === 'number'
        ? options.cost
        : (options?.free ? 0 : (isHappy ? 75 : STANDARD_COST_XP));

    // Actividad, rank y daily guardan XP con el participante original, que puede
    // ser @lid. El teléfono alternativo resuelve la entrega, no sustituye su saldo.
    const participant = normalizeJid(messageData?.key?.participant || messageData?.participant);
    const candidates = [...new Set([participant, normalizedSender, privateJid]
        .filter(jid => jid && !jid.endsWith('@g.us')))];
    let userJid = candidates[0];
    for (const candidate of candidates) {
        const user = await db.getOrCreateUser(candidate);
        if ((user?.xp || 0) >= requiredXp) {
            userJid = candidate;
            break;
        }
    }

    return {
        isLidOnly: false,
        senderJid: normalizedSender || senderJid,
        userJid,
        privateJid,
        phone: canonicalPhone
    };
}

/**
 * Manejador principal de la compra de Packs por XP en el Mercado Negro.
 *
 * @param {object} parsed - Objeto parseado ({ args, flags, raw })
 * @param {string} from - JID del chat de origen (grupo o privado)
 * @param {object} messageData - Metadatos del mensaje
 * @param {object} [options={}] - Opciones de prueba/inyección
 * @returns {Promise<object>} Resultado de la operación
 */
async function handlePack(parsed = {}, from, messageData = {}, options = {}) {
    if (!from) return null;

    const isGroup = typeof from === 'string' && from.endsWith('@g.us');
    const userName = messageData?.pushName || 'Compa';

    // 1. Verificación de autorización en grupos (R4)
    if (isGroup && !isGroupAuthorized(from, options)) {
        const deniedMsg = `> ❌ Acceso denegado. Este grupo no está autorizado para el Mercado Negro.`;
        if (options.sendConfirmation !== false) {
            await evolution.sendText(from, deniedMsg);
        }
        return { success: false, reason: 'UNAUTHORIZED_GROUP', message: deniedMsg };
    }

    // 2. Resolución y saneamiento del comprador (R4)
    let isHappyHour = options.isHappyHour;
    if (isHappyHour === undefined) {
        try {
            const happyHour = require('../services/happyHour');
            isHappyHour = happyHour.isHappyHourActive(from);
        } catch (_) {
            isHappyHour = false;
        }
    }
    const isFree = Boolean(options.free || options.cost === 0);
    const effectiveCost = isFree ? 0 : (typeof options.cost === 'number' ? options.cost : (isHappyHour ? 75 : STANDARD_COST_XP));

    const buyer = await resolveBuyer(from, messageData, { cost: effectiveCost, free: isFree, isHappyHour });
    if (buyer.isLidOnly) {
        logger.warn(`[PACK] Compra rechazada: remitente ${buyer.senderJid} opera solo con @lid (Fail-Closed).`);
        const lidMsg =
            `⚠️ *No pude localizar tu chat privado, ${userName}.*\n\n` +
            `Tu cuenta tiene identificador oculto (@lid) y WhatsApp no me permite abrir tu chat privado directo. ` +
            `No se dedujo ningún XP de tu cuenta.`;
        if (options.sendConfirmation !== false) {
            await evolution.sendText(from, lidMsg);
        }
        return { success: false, reason: 'LID_ONLY', balance: null, message: lidMsg };
    }

    // 3. Extracción de categoría/tema opcional
    let rawCategory = null;
    const flagCat = parsed.flags?.categoria || parsed.flags?.category || parsed.flags?.tema || parsed.flags?.c;
    if (flagCat) {
        rawCategory = String(flagCat);
    } else if (Array.isArray(parsed.args) && parsed.args.length > 0) {
        rawCategory = parsed.args.join(' ');
    } else if (options.category) {
        rawCategory = String(options.category);
    }
    const cleanFn = packImages.cleanCategory || ((c) => c ? String(c).replace(/^de\s+/i, '').trim() : null);
    const category = cleanFn(rawCategory);

    // 4. Deducción atómica de XP en SQLite (R1, R3)
    let deduction = { success: true, balance: 0 };
    if (effectiveCost > 0) {
        deduction = await db.deductUserXpAtomic(buyer.userJid, effectiveCost);
        if (!deduction.success) {
            const balance = deduction.balance || 0;
            logger.info(`[PACK] Saldo insuficiente para ${buyer.userJid}: tiene ${balance} XP, requiere ${effectiveCost} XP.`);
            const discountTag = isHappyHour ? ' (¡con 50% de descuento por Hora Feliz!)' : '';
            const rejectMsg =
                `❌ *No te alcanza la lana, ${userName}.*\n\n` +
                `Tu saldo actual es de *${balance} XP* y el pack del mercado negro cuesta *${effectiveCost} XP*${discountTag}.\n\n` +
                `💡 *¿Cómo conseguir más XP?*\n` +
                `• Tira tu *!daily* para ganarte hasta 1,000 XP del tiro diario.\n` +
                `• Cotorrea en el grupo para ir sumando XP.\n` +
                `• Pruébate en la *!ruleta* o *!blackjack* si te sientes con suerte.`;
            if (options.sendConfirmation !== false) {
                await evolution.sendText(from, rejectMsg);
            }
            return {
                success: false,
                reason: 'INSUFFICIENT_FUNDS',
                balance,
                cost: effectiveCost,
                message: rejectMsg
            };
        }
    } else {
        const u = await db.getOrCreateUser(buyer.userJid).catch(() => null);
        deduction.balance = u?.xp || 0;
    }

    // 4.5. Consulta de historial de entregas para algoritmo anti-repetición
    let excludePhotoIds = [];
    if (typeof db.getDeliveredPhotoIds === 'function') {
        try {
            const seenSet = await db.getDeliveredPhotoIds('user', buyer.userJid, category || '');
            if (seenSet && seenSet.size > 0) {
                excludePhotoIds = Array.from(seenSet);
            }
        } catch (histErr) {
            logger.warn(`[PACK] Error consultando historial de entregas: ${histErr.message}`);
        }
    }

    // 5. Selección híbrida de contenido (R3): 4 a 6 fotos/vídeos en Hora Feliz, 3 a 5 estándar
    const targetCount = options.count ?? (isHappyHour ? (Math.floor(Math.random() * 3) + 4) : (Math.floor(Math.random() * 3) + 3));
    let images = [];
    try {
        const fetchFn = options.getPackImages || packImages.getPackImages;
        images = await fetchFn(category, {
            count: targetCount,
            customDir: options.customDir,
            excludePhotoIds: options.excludePhotoIds !== undefined ? options.excludePhotoIds : excludePhotoIds
        });
    } catch (fetchErr) {
        logger.warn(`[PACK] Error obteniendo imágenes: ${fetchErr.message}`);
    }

    // Si falló la obtención o no hay suficientes imágenes (mínimo 3), reembolsar XP intacto
    const minRequired = typeof options.count === 'number' ? Math.min(options.count, 3) : 3;
    if (!images || images.length < minRequired) {
        logger.error(`[PACK] Inventario insuficiente para ${buyer.userJid}: ${images?.length || 0} de ${minRequired}. Reembolsando ${effectiveCost} XP.`);
        if (effectiveCost > 0) {
            await db.refundUserXp(buyer.userJid, effectiveCost).catch(() => {});
        }
        // Limpiar archivos temporales parciales si hubo
        if (Array.isArray(images)) {
            for (const img of images) {
                if (img.isTemporary && img.path) {
                    fs.promises.unlink(img.path).catch(() => {});
                }
            }
        }
        const refundMsg =
            `⚠️ *Hubo bronca con la mercancía, ${userName}.*\n\n` +
            `No se pudieron conseguir las fotos del mercado negro en este momento. ` +
            (effectiveCost > 0 ? `Tus *${effectiveCost} XP* han sido devueltos intactos a tu cuenta. ` : '') +
            `Intenta más tarde.`;
        if (options.sendConfirmation !== false) {
            await evolution.sendText(from, refundMsg);
        }
        return {
            success: false,
            reason: 'CONTENT_UNAVAILABLE',
            refunded: effectiveCost > 0,
            balance: (deduction.balance || 0) + effectiveCost,
            cost: effectiveCost,
            message: refundMsg
        };
    }

    // 6. Despacho y entrega (R2)
    const throttleMs = typeof options.throttleMs === 'number' ? options.throttleMs : DEFAULT_THROTTLE_MS;
    const anyDeckCycled = images.some(img => img.deckCycled);

    try {
        const deckNotice = anyDeckCycled
            ? `\n\n🏆 *¡Colección completada!* Has desbloqueado todas las fotos de este álbum. La baraja se ha reiniciado para tus próximas compras.`
            : '';

        // A. Si se solicitó desde un grupo, aviso público con mención y tono mexicano
        if (isGroup) {
            const groupNotice =
                `📦 *MERCADO NEGRO BOTSKY* 🕶️\n\n` +
                `Sobres @${buyer.phone}, ya te cayó la mercancía al privado con visualización única. ` +
                `Chécalas antes de que te las borren, canijo.` +
                deckNotice;
            if (options.sendConfirmation !== false) {
                await evolution.sendText(from, groupNotice, {
                    mentions: [buyer.senderJid, buyer.privateJid]
                });
            }
        } else {
            // Chat privado directo con Botsky
            const privateNotice =
                `📦 *MERCADO NEGRO BOTSKY* 🕶️\n\n` +
                `Sobres, aquí tienes tu mercancía con visualización única. Chécalas antes de que se borren, compa.` +
                deckNotice;
            if (options.sendConfirmation !== false) {
                await evolution.sendText(buyer.privateJid, privateNotice);
            }
        }

        // B. Entrega directa y exclusiva al chat privado del usuario con viewOnce: true (R2)
        for (let i = 0; i < images.length; i++) {
            const img = images[i];
            const caption = `Mercancía ${i + 1}/${images.length} 🔒 (View Once)`;
            await evolution.sendMedia(
                buyer.privateJid,
                img.path,
                caption,
                { viewOnce: true },
                false,
                null,
                null,
                { viewOnce: true }
            );

            // Throttling de 500ms entre envíos consecutivos para proteger el transporte
            if (i < images.length - 1 && throttleMs > 0) {
                await sleep(throttleMs);
            }
        }

        // C. Registro en historial anti-repetición tras entrega exitosa
        try {
            if (anyDeckCycled && typeof db.clearDeliveredPhotoHistory === 'function') {
                await db.clearDeliveredPhotoHistory('user', buyer.userJid, category || '');
            }
            const deliveredIds = images.map(img => img.id || (img.path ? require('path').basename(img.path) : null)).filter(Boolean);
            if (deliveredIds.length > 0 && typeof db.recordDeliveredPhotos === 'function') {
                await db.recordDeliveredPhotos('user', buyer.userJid, category || '', deliveredIds);
            }
        } catch (saveHistErr) {
            logger.warn(`[PACK] Error registrando historial de entrega para ${buyer.userJid}: ${saveHistErr.message}`);
        }

        return {
            success: true,
            delivered_to: buyer.privateJid,
            images_sent: images.length,
            balance: deduction.balance,
            cost: effectiveCost,
            isGroup,
            deckCycled: anyDeckCycled
        };
    } catch (deliveryErr) {
        logger.error(`[PACK] Error en despacho de fotos a ${buyer.privateJid}: ${deliveryErr.message}`);
        if (effectiveCost > 0) {
            await db.refundUserXp(buyer.userJid, effectiveCost).catch(() => {});
        }
        if (options.sendConfirmation !== false) {
            await evolution.sendText(from, `⚠️ Hubo un error de entrega con el proveedor.${effectiveCost > 0 ? ` Tus ${effectiveCost} XP fueron reembolsados.` : ''}`);
        }
        return {
            success: false,
            reason: 'DELIVERY_FAILED',
            error: deliveryErr.message,
            refunded: effectiveCost > 0
        };
    } finally {
        // Limpieza de archivos temporales descargados de internet
        for (const img of images) {
            if (img.isTemporary && img.path) {
                fs.promises.unlink(img.path).catch(() => {});
            }
        }
    }
}

module.exports = {
    handlePack,
    resolveBuyer,
    isGroupAuthorized,
    STANDARD_COST_XP,
    DEFAULT_THROTTLE_MS
};
