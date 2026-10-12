'use strict';

const evolution = require('../services/evolution');
const { isAuthorizedAdmin, getSenderJid } = require('../core/auth');
const db = require('../services/db');
const logger = require('../services/logger');

const { callGemini, callGroq } = require('../services/ai');

const MAIN_GROUP_JID = '120363315296139888@g.us';

/**
 * Genera el mensaje que Botsky le enviará directamente al amigo o al grupo,
 * hablando como Botsky mismo (tono mexicano, compa de barrio).
 *
 * Si es para el grupo o es cizaña/carrilla/mentada de madre o se pide anonimato,
 * NUNCA delata al emisor y sale 100% de la cosecha de Botsky.
 * Si es un recado personal a un amigo, lo entrega como amigo en común.
 *
 * @param {string} senderName - Nombre de quien pide enviar el mensaje (ej: "Azael")
 * @param {string} recipientName - Nombre del amigo o "el grupo"
 * @param {string} messageText - Contenido del recado o instrucción
 * @param {object} [options] - { isGroup: bool, isAnonymous: bool, rawInstruction: string }
 * @returns {Promise<string>}
 */
async function generateRelayedMessage(senderName, recipientName, messageText, options = {}) {
    const cleanSender = senderName || 'Azael';
    const cleanRecipient = recipientName || 'compa';
    const cleanText = messageText || '';
    const isGroup = Boolean(options.isGroup);
    const isAnonymous = Boolean(options.isAnonymous);

    const systemPrompt = `Eres Botsky, el bot con personalidad 100% mexicana, cotorro, de barrio, arisco y compa del grupo de amigos "Gente del señor chiqui 🐓".
Tu compa ${cleanSender} te está pidiendo que mandes un mensaje a ${cleanRecipient} por WhatsApp.

TU META: Escribir el mensaje que Botsky mandará a ${cleanRecipient} con tu personalidad mexicana, directa, irreverente y de barrio.

REGLAS DE MODO (CRÍTICO):
1. ¿CUÁNDO SALIR DE BOTSKY SIN MENCIONAR A ${cleanSender} (MODO CIZAÑOSO / ANÓNIMO / DE TU COSECHA)?
   - Si el mensaje va al GRUPO (o a todos los miembros).
   - Si la orden es tirar carrilla, cizaña, provocación, mentar madres, burla, o queja cotidiana (ej: "mentándole la madre a todos", "que dejen de huevonear", "que se pongan a jalar").
   - Si ${cleanSender} dice "no digas que fui yo", "que salga de ti", "anónimo", "hazte el loco", "no me menciones".
   ${isAnonymous ? `- SEÑAL CONFIRMADA: ${cleanSender} pidió explícitamente anonimato. PROHIBIDO MENCIONARLO.` : ''}
   -> En estos casos, TIENES ESTRICTAMENTE PROHIBIDO mencionar a ${cleanSender}. El mensaje debe sonar 100% como una ocurrencia o bronca tuya propia (de Botsky) como el compa desmadroso del grupo.

2. ¿CUÁNDO SÍ MENCIONAR A ${cleanSender} (MODO RECADO)?
   - Si ${cleanSender} dice explícitamente "de mi parte", "diles que yo dije", "avísales que yo...".
   - Si es un recado personal para un amigo individual donde es indispensable saber quién lo busca o quién lo extraña (ej: "lo extraño", "dile que me llame"), a menos que haya pedido no decir quién fue.
   -> En estos casos, dilo natural entre compas (ej: "Qué onda Fer, me manda ${cleanSender} a decirte que...", "Oye Fer, dice ${cleanSender} que...").

FORMATO: 1 o 2 oraciones en caló mexicano de barrio. Cero plantillas ("Mensaje de..."), cero comillas envolventes, cero modismos de España ("tío", "chaval").`;

    const userPrompt = `Instrucción de ${cleanSender} para enviar a ${cleanRecipient}: "${cleanText}". Escribe lo que Botsky dirá exactamente:`;

    try {
        let generated = null;
        try {
            generated = await callGemini({
                systemInstruction: systemPrompt,
                userMessage: userPrompt,
                temperature: 0.88,
                maxOutputTokens: 120,
                timeout: 3500
            });
        } catch (_) {}

        if (!generated) {
            try {
                generated = await callGroq({
                    systemInstruction: systemPrompt,
                    userMessage: userPrompt,
                    temperature: 0.88,
                    maxTokens: 120,
                    timeout: 4000
                });
            } catch (_) {}
        }

        if (generated && generated.trim().length > 5) {
            return generated.trim().replace(/^["'«“]+|["'»”]+$/g, '').trim();
        }
    } catch (e) {
        logger.warn(`[MENSAJE-RELAY] Fallo IA generando mensaje de recado: ${e.message}`);
    }

    throw new Error('No pude redactar el recado; no envié la instrucción original.');
}

const CONTACT_CHOICE_TTL_MS = 10 * 60 * 1000;
const pendingContacts = new Map();

function normalizeName(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function contactSessionKey(from, messageData) {
    const sender = getSenderJid(from, messageData);
    return sender ? `${from}:${sender}` : null;
}

function clearExpiredContactSessions() {
    for (const [key, session] of pendingContacts) {
        if (!session.busy && session.expiresAt <= Date.now()) pendingContacts.delete(key);
    }
}

/** Returns every plausible destination; a partial name never selects the first row. */
async function findGroupContact(query) {
    if (typeof query !== 'string' || !query.trim()) return null;
    const clean = normalizeName(query);
    // Only an actual phone number is a direct destination (not a name containing digits).
    const digitsOnly = clean.replace(/[^0-9]/g, '');
    if (/^[+\d\s().-]+$/.test(clean) && digitsOnly.length >= 10 && digitsOnly.length <= 15) {
        const phone = digitsOnly.length === 10 ? `521${digitsOnly}` : digitsOnly;
        return { jid: `${phone}@s.whatsapp.net`, user_name: query.trim(), is_group: false };
    }

    let candidates = [];
    try {
        const escaped = clean.replace(/[\\%_]/g, char => `\\${char}`);
        const rows = await new Promise(resolve => {
            db.db.all(
                "SELECT jid, user_name FROM user_affinities WHERE jid LIKE '%@s.whatsapp.net' AND (LOWER(user_name) LIKE ? ESCAPE '\\' OR LOWER(user_name) LIKE ? ESCAPE '\\') LIMIT 30",
                [`%${escaped}%`, `%${escaped.slice(0, 3)}%`],
                (err, rows) => resolve(err ? [] : (rows || []))
            );
        });
        const unique = new Map();
        for (const row of rows) {
            if (row.jid?.endsWith('@s.whatsapp.net') && !row.jid.includes('test_')) {
                unique.set(row.jid, { jid: row.jid, user_name: row.user_name || row.jid.split('@')[0], is_group: false });
            }
        }
        candidates = [...unique.values()];
        const exact = candidates.filter(row => normalizeName(row.user_name) === clean);
        const partial = candidates.filter(row => normalizeName(row.user_name).includes(clean));
        candidates = exact.length ? exact : partial;
    } catch (err) {
        logger.warn(`[MENSAJE] Error buscando contactos: ${err.message}`);
    }

    if (!candidates.length) {
        try {
            const response = await evolution.getGroupInfo(MAIN_GROUP_JID);
            const participants = (response?.data || response)?.participants || [];
            const unique = new Map();
            for (const participant of participants) {
                const name = participant.name || participant.pushName || participant.notify || '';
                const jid = participant.phoneNumber || participant.id || '';
                if (String(jid).endsWith('@lid')) continue;
                const digits = String(jid).split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
                if (digits.length >= 10 && name && normalizeName(name).includes(clean)) {
                    unique.set(digits, { jid: `${digits}@s.whatsapp.net`, user_name: name, is_group: false });
                }
            }
            candidates = [...unique.values()];
            const exact = candidates.filter(row => normalizeName(row.user_name) === clean);
            if (exact.length) candidates = exact;
        } catch (err) {
            logger.warn(`[MENSAJE] Error consultando contactos del grupo: ${err.message}`);
        }
    }
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) return { ambiguous: true, candidates };
    return null;
}

function clarificationResult(pregunta, missing_fields = ['contacto'], extra = {}) {
    return { success: false, status: 'needs_clarification', needs_clarification: true,
        question: pregunta, pregunta, missing_fields, ...extra };
}

function choiceResult(session, prefix = '¿A cuál te refieres?') {
    const opciones = session.candidates.map((contact, index) => ({
        numero: index + 1,
        nombre: contact.user_name,
        terminacion: contact.jid.split('@')[0].slice(-4)
    }));
    const pregunta = `${prefix}\n${opciones.map(option => `${option.numero}. ${option.nombre} (…${option.terminacion})`).join('\n')}\nDime el número o su nombre. Tengo guardado tu ${session.payloadLabel || 'recado'}.`;
    return clarificationResult(pregunta, ['contacto'], { opciones });
}

async function sendFeedback(from, result, enabled) {
    if (enabled) {
        try {
            await evolution.sendText(from, result.pregunta || result.confirmacion || result.error);
            result.enviado_al_chat = true;
        } catch (err) {
            // A failed confirmation must not turn an already delivered recado into a failure.
            logger.warn(`[MENSAJE] No se pudo confirmar en el chat: ${err.message}`);
            result.enviado_al_chat = false;
        }
    }
    return result;
}

async function deliverContactMessage(session, target) {
    if (session.execute) return session.execute(target);
    try {
        const textToSend = await generateRelayedMessage(session.senderName, target.user_name, session.messageText, {
            isGroup: Boolean(target.is_group), isAnonymous: session.isAnonymous, rawInstruction: session.raw
        });
        await evolution.sendText(target.jid, textToSend);
        logger.info(`[MENSAJE-CONTACTO] Recado entregado a ${target.jid}`);
        const destination = target.is_group ? 'al grupo' : `a ${target.user_name}`;
        return {
            success: true, status: 'sent', destinatario: target.user_name, jid: target.jid,
            mensaje_enviado: textToSend, confirmacion: `Va, ya le escribí ${destination}:\n“${textToSend}”`
        };
    } catch (err) {
        logger.error(`[MENSAJE-CONTACTO] Falló entrega: ${err.message}`);
        return { success: false, status: 'send_failed', error: `No pude mandarle el recado a ${target.user_name}. Puedes intentar otra vez.` };
    }
}

/** Resolve once, then deliver the original payload. Shared by text, voice and files. */
async function deliverToRecipient({ contacto, from, messageData = {}, execute, payloadLabel = 'envío' } = {}) {
    if (!isAuthorizedAdmin(from, messageData)) {
        return sendFeedback(from, { success: false, status: 'denied', error: 'Solo el creador y los administradores autorizados pueden enviar a otros chats.' }, true);
    }
    clearExpiredContactSessions();
    const key = contactSessionKey(from, messageData);
    if (key && pendingContacts.get(key)?.busy) {
        return sendFeedback(from, { success: false, status: 'busy', error: 'Estoy haciendo tu envío, dame un momento.' }, true);
    }
    const target = await findGroupContact(contacto);
    if (!target) return sendFeedback(from, clarificationResult(`No encontré a “${contacto}”. Dime su nombre completo o número; no envié nada.`), true);
    const session = { execute, payloadLabel, expiresAt: Date.now() + CONTACT_CHOICE_TTL_MS, busy: false };
    if (target.ambiguous) {
        if (!key) return sendFeedback(from, clarificationResult('Dime el nombre completo del destinatario.'), true);
        session.candidates = target.candidates;
        pendingContacts.set(key, session);
        return sendFeedback(from, choiceResult(session), true);
    }
    if (key) pendingContacts.delete(key);
    const result = await execute(target);
    return result.enviado_al_chat ? result : sendFeedback(from, result, true);
}

/** Shared command/tool API; sendConfirmation:false leaves feedback to the agent. */
async function sendContactMessage({ contacto, mensaje, anonimo = false, from, messageData = {}, userName, raw = '', sendConfirmation = true } = {}) {
    if (!isAuthorizedAdmin(from, messageData)) {
        return sendFeedback(from, { success: false, status: 'denied', error: 'Solo el creador y los administradores autorizados pueden mandar recados.' }, sendConfirmation);
    }
    const contactName = String(contacto || '').trim();
    const messageText = String(mensaje || '').trim();
    if (!contactName || !messageText) {
        const missing = [...(!contactName ? ['contacto'] : []), ...(!messageText ? ['mensaje'] : [])];
        const question = missing.length === 2 ? '¿A quién le escribo y qué le digo? Por ejemplo: “Dile a Fernando que me llame”.'
            : !contactName ? '¿A quién le mando ese recado?' : `¿Qué le digo a ${contactName}?`;
        return sendFeedback(from, clarificationResult(question, missing), sendConfirmation);
    }
    clearExpiredContactSessions();
    const key = contactSessionKey(from, messageData);
    if (key && pendingContacts.get(key)?.busy) {
        return sendFeedback(from, { success: false, status: 'busy', error: 'Estoy mandando tu recado, dame un momento.' }, sendConfirmation);
    }
    const target = await findGroupContact(contactName);
    if (!target) {
        return sendFeedback(from, { success: false, status: 'not_found', error: `No encontré a “${contactName}”. Pásame su nombre completo o su número.` }, sendConfirmation);
    }
    const session = {
        messageText, isAnonymous: Boolean(anonimo), senderName: userName || messageData.pushName || 'tu compa',
        raw, expiresAt: Date.now() + CONTACT_CHOICE_TTL_MS, busy: false
    };
    if (target.ambiguous) {
        if (!key) {
            return sendFeedback(from, clarificationResult('Hay varios contactos con ese nombre. Dime el nombre completo del destinatario.'), sendConfirmation);
        }
        session.candidates = target.candidates;
        pendingContacts.set(key, session);
        return sendFeedback(from, choiceResult(session), sendConfirmation);
    }
    // A new valid recado supersedes an earlier pending selection in the same chat.
    if (key) pendingContacts.delete(key);
    return sendFeedback(from, await deliverContactMessage(session, target), sendConfirmation);
}

/** Used by normalization to preserve contact choices ahead of media shortcuts. */
function hasPendingContactChoice(from, messageData = {}) {
    clearExpiredContactSessions();
    const key = contactSessionKey(from, messageData);
    return Boolean(key && pendingContacts.has(key) && isAuthorizedAdmin(from, messageData));
}

/** Public, scoped metadata for the semantic router; never expose destination JIDs. */
function getPendingContactContext(from, messageData = {}) {
    clearExpiredContactSessions();
    if (!isAuthorizedAdmin(from, messageData)) return [];
    const key = contactSessionKey(from, messageData);
    const session = key ? pendingContacts.get(key) : null;
    return (session?.candidates || []).map((contact, index) => ({
        numero: index + 1, nombre: contact.user_name,
        terminacion: contact.jid.split('@')[0].slice(-4)
    }));
}

/** Gemini chooses a candidate index or cancels; execution never reparses its words. */
async function handlePendingContactChoice({ from, messageData = {}, args = {} } = {}) {
    clearExpiredContactSessions();
    const key = contactSessionKey(from, messageData);
    const session = key ? pendingContacts.get(key) : null;
    if (!session || !isAuthorizedAdmin(from, messageData)) return { consumed: false };
    if (args.cancel !== true && !Number.isInteger(args.selection)) return { consumed: false };
    if (session.busy) {
        return { consumed: true, ...await sendFeedback(from, { success: false, status: 'busy', error: 'Estoy haciendo tu envío, dame un momento.' }, true) };
    }
    if (args.cancel === true) {
        pendingContacts.delete(key);
        return { consumed: true, ...await sendFeedback(from, { success: false, status: 'cancelled', confirmacion: 'Va, cancelé el envío.' }, true) };
    }
    const target = session.candidates[args.selection - 1];
    if (!target) return { consumed: true, ...await sendFeedback(from, choiceResult(session, 'Ese número no está en la lista. ¿Cuál de ellos?'), true) };
    session.busy = true;
    let result;
    try { result = await deliverContactMessage(session, target); }
    catch (err) {
        logger.warn(`[MENSAJE] Falló el envío pendiente: ${err.message}`);
        result = { success: false, status: 'send_failed', error: 'No pude hacer el envío. Revisa el chat antes de reintentarlo.' };
    } finally { session.busy = false; }
    // A transport failure can leave delivery uncertain. Do not replay automatically.
    if (pendingContacts.get(key) === session) pendingContacts.delete(key);
    return { consumed: true, ...(result.enviado_al_chat ? result : await sendFeedback(from, result, true)) };
}

async function handleMensaje(parsed = {}, from, messageData = {}) {
    let args = parsed.aiArgs || parsed.semanticDecision?.args;
    if (!args) {
        const { routeWithAI } = require('../services/ai');
        const decision = await routeWithAI(parsed.raw || '', messageData.pushName, from.endsWith('@g.us'),
            [], null, null, getSenderJid(from, messageData), from);
        if (!decision || decision.needs_clarification || decision.action !== 'mensaje') {
            const question = decision?.question || '¿A quién le escribo y qué le digo?';
            return sendFeedback(from, clarificationResult(question), true);
        }
        args = decision.args;
    }
    const messageText = String(args.mensaje || args.texto || args.recado || '').trim();
    if (!messageText) return sendFeedback(from, clarificationResult('¿Qué le digo?', ['mensaje']), true);
    const { deliverSemantic } = require('../services/outboundDelivery');
    return deliverSemantic({ args, from, messageData, payloadLabel: 'recado', execute: target => deliverContactMessage({
        messageText, isAnonymous: args.anonimo === true,
        senderName: messageData.pushName || 'tu compa', raw: args.instruccion || parsed.raw || ''
    }, target) });
}

module.exports = {
    handleMensaje, findGroupContact, generateRelayedMessage, sendContactMessage,
    handlePendingContactChoice, hasPendingContactChoice, getPendingContactContext, CONTACT_CHOICE_TTL_MS, deliverToRecipient, MAIN_GROUP_JID
};
