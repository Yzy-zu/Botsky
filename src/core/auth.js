'use strict';

/**
 * Módulo central de autenticación y autorización para Botsky.
 *
 * REGLAS ESTRICTAS DE SEGURIDAD (FASE 4):
 * 1. La autorización se basa EXCLUSIVAMENTE en el JID / senderId estable provisto por WhatsApp.
 * 2. NUNCA se autoriza basándose en pushName, userName, nombre visible, contenido del mensaje o contraseñas en texto.
 * 3. Si falta configuración de administrador (ALLOWED_NUMBERS_ADMIN vacío o ausente), el sistema opera en FAIL-CLOSED (nadie es admin).
 * 4. En grupos de WhatsApp (@g.us), el remitente real es SIEMPRE el participante o su JID alternativo telefónico,
 *    NUNCA el JID del grupo.
 * 5. Si en grupos solo se dispone de un identificador @lid sin mapeo telefónico alternativo confiable,
 *    el sistema opera en FAIL-CLOSED (nadie es admin por defecto).
 */

/**
 * Obtiene el JID real y confiable del remitente del mensaje.
 * En grupos con direccionamiento LID, busca prioritariamente campos con JID telefónico alternativo
 * provistos por Baileys / Evolution API (participantAlt, senderPn, participantPn, sender).
 *
 * @param {string} from - JID del chat o grupo (ej: '120363045678901234@g.us' o '5215512345678@s.whatsapp.net')
 * @param {object} [messageData] - Metadatos del webhook de WhatsApp / Baileys / Evolution API
 * @returns {string} JID del remitente o cadena vacía si no se puede determinar
 */
function getSenderJid(from, messageData) {
    if (!from || typeof from !== 'string') return '';
    const isGroup = from.endsWith('@g.us');

    if (isGroup) {
        // En grupos, buscar primero si Evolution/Baileys entregó un JID telefónico alternativo
        const candidateAlt =
            messageData?.key?.participantAlt ||
            messageData?.key?.participantPn ||
            messageData?.key?.senderPn ||
            messageData?.participantAlt ||
            messageData?.senderPn ||
            messageData?.participantPn;

        if (candidateAlt && typeof candidateAlt === 'string' && !candidateAlt.endsWith('@lid')) {
            return candidateAlt.trim();
        }

        // Si sender en raíz es un número o JID no-LID
        if (messageData?.sender && typeof messageData.sender === 'string' && !messageData.sender.endsWith('@lid')) {
            return messageData.sender.trim();
        }

        const rawParticipant = messageData?.key?.participant || messageData?.participant;
        return rawParticipant ? String(rawParticipant).trim() : '';
    }

    // En chats privados/directos, el emisor es el participante o el propio chat 'from'
    const rawParticipant = messageData?.key?.participant || messageData?.participant;
    return String(rawParticipant || from).trim();
}

/**
 * Limpia y normaliza un identificador JID de WhatsApp a su número telefónico canónico en dígitos.
 * Elimina sufijos de servidor (@s.whatsapp.net, @g.us) y sufijos de dispositivo (:0, :1, etc.).
 * Si el JID corresponde a un LID puro (@lid), devuelve cadena vacía para forzar FAIL-CLOSED.
 *
 * @param {string} jid - JID de WhatsApp (ej: '5215512345678:2@s.whatsapp.net')
 * @returns {string} Dígitos limpios del número telefónico (ej: '5215512345678') o vacío si es LID/inválido
 */
function cleanJidNumber(jid) {
    if (!jid || typeof jid !== 'string') return '';
    const trimmed = jid.trim();
    if (trimmed.endsWith('@lid') || trimmed.includes('@lid')) {
        return '';
    }
    const withoutServer = trimmed.split('@')[0];
    const withoutDevice = withoutServer.split(':')[0];
    return withoutDevice.replace(/[^0-9]/g, '');
}

/**
 * Normaliza números de teléfono para comparaciones, unificando variantes de numeración móvil
 * en México (521XXXXXXXXXX de 13 dígitos y 52XXXXXXXXXX de 12 dígitos).
 *
 * @param {string} num - Cadena de dígitos numéricos
 * @returns {string} Número normalizado
 */
function normalizePhoneNumber(num) {
    if (!num || typeof num !== 'string') return '';
    const clean = num.replace(/[^0-9]/g, '');
    if (clean.length === 13 && clean.startsWith('521')) {
        return '52' + clean.slice(3);
    }
    if (clean.length === 10) {
        return '52' + clean;
    }
    return clean;
}

/**
 * Obtiene la lista actual de números de administradores configurados en el entorno.
 * Se consulta dinámicamente de process.env para soportar reconfiguraciones sin reiniciar.
 *
 * @returns {string[]} Lista de números de teléfono canónicos de administradores
 */
function getAdminNumbers() {
    const raw = process.env.ALLOWED_NUMBERS_ADMIN;
    if (!raw || typeof raw !== 'string') return [];
    return raw
        .split(',')
        .map(cleanJidNumber)
        .filter(Boolean);
}

/**
 * Determina si el remitente de un mensaje de WhatsApp es un administrador autorizado.
 *
 * @param {string} from - JID del chat o grupo
 * @param {object} [messageData] - Metadatos del mensaje
 * @returns {boolean} true si el remitente es un administrador autorizado; false en cualquier otro caso
 */
function isAuthorizedAdmin(from, messageData) {
    const senderJid = getSenderJid(from, messageData);
    if (!senderJid) return false;

    const senderNumber = cleanJidNumber(senderJid);
    if (!senderNumber) return false;

    const adminList = getAdminNumbers();
    if (adminList.length === 0) {
        // FAIL-CLOSED: Si no hay administradores configurados en el entorno, se deniega todo acceso
        return false;
    }

    const normalizedSender = normalizePhoneNumber(senderNumber);
    return adminList.some(adminNum => {
        return adminNum === senderNumber || normalizePhoneNumber(adminNum) === normalizedSender;
    });
}

/**
 * Obtiene la lista de números configurados específicamente con permiso para subir tareas escolares.
 *
 * @returns {string[]} Lista de números telefónicos limpios
 */
function getTaskUploaderNumbers() {
    const raw = process.env.ALLOWED_NUMBERS_TASKS;
    if (!raw || typeof raw !== 'string') return [];
    return raw
        .split(',')
        .map(cleanJidNumber)
        .filter(Boolean);
}

/**
 * Determina si el remitente está autorizado para registrar y gestionar tareas escolares.
 * Tienen permiso: los administradores (ALLOWED_NUMBERS_ADMIN) y los números específicos de tareas (ALLOWED_NUMBERS_TASKS).
 *
 * @param {string} from - JID del chat o grupo
 * @param {object} [messageData] - Metadatos del mensaje
 * @returns {boolean} true si tiene permiso para subir tareas
 */
function isAuthorizedTaskUploader(from, messageData) {
    if (isAuthorizedAdmin(from, messageData)) {
        return true;
    }

    const senderJid = getSenderJid(from, messageData);
    if (!senderJid) return false;

    const senderNumber = cleanJidNumber(senderJid);
    if (!senderNumber) return false;

    const taskList = getTaskUploaderNumbers();
    if (taskList.length === 0) {
        return false;
    }

    const normalizedSender = normalizePhoneNumber(senderNumber);
    return taskList.some(taskNum => {
        return taskNum === senderNumber || normalizePhoneNumber(taskNum) === normalizedSender;
    });
}

module.exports = {
    getSenderJid,
    cleanJidNumber,
    normalizePhoneNumber,
    getAdminNumbers,
    isAuthorizedAdmin,
    getTaskUploaderNumbers,
    isAuthorizedTaskUploader
};

