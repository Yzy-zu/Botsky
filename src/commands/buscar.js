'use strict';

const fs = require('fs');
const { searchFiles, downloadFile } = require('../services/drive');
const { sendText, sendMedia } = require('../services/evolution');
const logger = require('../services/logger');

// Mapa para mantener las sesiones de búsqueda. 
// Llave: JID del usuario (from), Valor: { files: Array, timestamp: Number }
const searchSessions = new Map();

// Limpiar sesiones caducadas cada hora
setInterval(() => {
    const now = Date.now();
    for (const [from, session] of searchSessions.entries()) {
        // Expirar sesión si pasaron más de 15 minutos (900000 ms)
        if (now - session.timestamp > 900_000) {
            searchSessions.delete(from);
        }
    }
}, 3600_000);

function hasActiveSearchSession(from) {
    const session = searchSessions.get(from);
    if (!session) return false;
    // Si pasaron más de 15 minutos, la damos por inválida en tiempo real
    if (Date.now() - session.timestamp > 900_000) {
        searchSessions.delete(from);
        return false;
    }
    return true;
}

function getSessionKey(from, messageData) {
    const isGroup = from.endsWith('@g.us');
    if (isGroup) {
        const participant = messageData?.key?.participant || from;
        return `${participant}:${from}`;
    }
    return from;
}

async function handleBuscar(parsed, from, messageData) {
    const sessionKey = getSessionKey(from, messageData);
    try {
        const query = parsed.args.join(' ').trim();
        if (!query) {
            return sendText(from, '> dime qué archivo quieres que busque en Drive\n\nEjemplo: `/@ buscar factura`');
        }

        // Mensaje de carga eliminado para priorizar la UX por reacciones
        const files = await searchFiles(query);

        if (!files || files.length === 0) {
            searchSessions.delete(sessionKey);
            return sendText(from, `> ❌ No encontré ningún archivo que coincida con \`${query}\``);
        }

        // Guardar resultados en sesión
        searchSessions.set(sessionKey, { files, timestamp: Date.now() });

        let listMsg = `🔎 *Resultados para "${query}":*\n\n`;
        files.forEach((f, idx) => {
            const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];
            const bullet = emojis[idx] || `${idx + 1}.`;
            listMsg += `${bullet} ${f.name}\n`;
        });
        listMsg += '\n👉 Responde solo con el número (ejemplo: 1) para descargar el archivo.';

        await sendText(from, listMsg);

    } catch (err) {
        logger.error('Error en handleBuscar:', err);
        await sendText(from, '> ⚠️ Ocurrió un error al buscar en Drive.');
    }
}

async function handleDownloadDrive(parsed, from, messageData) {
    const sessionKey = getSessionKey(from, messageData);
    let filePath = null;
    try {
        const session = searchSessions.get(sessionKey);
        if (!session) {
            return sendText(from, '> ⚠️ Tu búsqueda expiró o no hay una activa. Escribe `/@ buscar [nombre]` para buscar de nuevo.');
        }

        const numberStr = parsed.args[0] || parsed.raw;
        const index = parseInt(numberStr, 10) - 1;

        if (isNaN(index) || index < 0 || index >= session.files.length) {
            return sendText(from, `> ⚠️ Número inválido. Por favor responde con un número del 1 al ${session.files.length}.`);
        }

        const selectedFile = session.files[index];
        searchSessions.delete(sessionKey); // Limpiamos sesión para evitar doble descarga accidental

        // Mensaje de carga eliminado

        const result = await downloadFile(selectedFile.id, selectedFile.name, selectedFile.mimeType);
        filePath = result.filePath;
        const outputName = result.outputName;

        await sendMedia(from, filePath, `> ✅ Aquí tienes tu archivo:\n\n📄 *${outputName}*`, false, false, null, outputName);

    } catch (err) {
        logger.error('Error en handleDownloadDrive:', err);
        await sendText(from, '> ⚠️ Error al descargar el archivo de Drive.');
    } finally {
        if (filePath && fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch (e) {}
        }
    }
}

module.exports = {
    handleBuscar,
    handleDownloadDrive,
    hasActiveSearchSession,
    getSessionKey
};
