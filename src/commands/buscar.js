'use strict';

const fs = require('fs');
const drive = require('../services/drive');
const evolution = require('../services/evolution');
const sendText = (to, text, opts) => evolution.sendText(to, text, opts);
const sendMedia = (...args) => evolution.sendMedia(...args);
const logger = require('../services/logger');
const { registerTask } = require('../services/scheduler');
const { getSessionKey } = require('../utils/session');

// Mapa para mantener las sesiones de búsqueda. 
// Llave: JID del usuario (from), Valor: { files: Array, timestamp: Number }
const searchSessions = new Map();

// Limpiar sesiones caducadas en el scheduler coordinado (PERF-2)
registerTask('buscar-sessions', 60, () => {
    const now = Date.now();
    for (const [from, session] of searchSessions.entries()) {
        // Expirar sesión si pasaron más de 15 minutos (900000 ms)
        if (now - session.timestamp > 900_000) {
            searchSessions.delete(from);
        }
    }
});

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



async function handleBuscar(parsed, from, messageData) {
    const sessionKey = getSessionKey(from, messageData);
    try {
        const params = parsed?.aiArgs || parsed || {};
        const query = (params.query || params.termino || params.archivo || params.busqueda || parsed?.args?.join(' ') || '').trim();
        if (!query) {
            return sendText(from, '¿Qué archivo busco en Drive? Por ejemplo: busca la factura.');
        }

        // Mensaje de carga eliminado para priorizar la UX por reacciones
        const files = await drive.searchFiles(query);

        if (!files || files.length === 0) {
            searchSessions.delete(sessionKey);
            return sendText(from, `> ❌ No encontré ningún archivo que coincida con \`${query}\``);
        }

        // Guardar resultados en sesión
        searchSessions.set(sessionKey, { files, timestamp: Date.now(), downloading: false });

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
    let session = null;
    let locked = false;
    try {
        if (!hasActiveSearchSession(sessionKey)) {
            return sendText(from, 'Tu búsqueda ya expiró. Dime qué archivo busco y te paso la lista otra vez.');
        }
        session = searchSessions.get(sessionKey);
        if (session.downloading) return sendText(from, 'Ya estoy bajando un archivo de esa lista. Dame un momento.');

        const params = parsed?.aiArgs || parsed || {};
        const numberStr = params.numero || params.index || parsed?.args?.[0] || parsed?.raw;
        const selection = String(numberStr ?? '').trim();
        const index = /^\d+$/.test(selection) ? Number(selection) - 1 : NaN;

        if (isNaN(index) || index < 0 || index >= session.files.length) {
            return sendText(from, `> ⚠️ Número inválido. Por favor responde con un número del 1 al ${session.files.length}.`);
        }

        const selectedFile = session.files[index];
        session.downloading = true;
        locked = true;

        // Mensaje de carga eliminado

        const result = await drive.downloadFile(selectedFile.id, selectedFile.name, selectedFile.mimeType);
        filePath = result.filePath;
        const outputName = result.outputName;

        await sendMedia(from, filePath, `Aquí tienes: *${outputName}*`, false, false, null, outputName);
        // Una búsqueda nueva puede haber llegado mientras se descargaba.
        if (searchSessions.get(sessionKey) === session) searchSessions.delete(sessionKey);
        return { success: true, archivo: outputName, enviado_al_chat: true };

    } catch (err) {
        logger.error('Error en handleDownloadDrive:', err);
        const message = 'No pude bajar ese archivo. Responde con el mismo número para intentarlo otra vez.';
        await sendText(from, message);
        return { success: false, error: message, reintentable: true, enviado_al_chat: true };
    } finally {
        if (locked && session) session.downloading = false;
        if (filePath && fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch (e) {}
        }
    }
}

module.exports = {
    handleBuscar,
    handleDownloadDrive,
    getSearchContext(from, messageData) {
        const session = searchSessions.get(getSessionKey(from, messageData));
        if (!session || !hasActiveSearchSession(getSessionKey(from, messageData))) return null;
        return session.files.map((item, index) => ({ numero: index + 1, nombre: item.name }));
    },
    hasActiveSearchSession,
    getSessionKey
};
