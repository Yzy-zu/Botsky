'use strict';

// Caché a nivel de módulo para almacenar los archivos ya requeridos
const moduleCache = {};

/**
 * Traduce los parámetros semánticos de la IA a las flags canónicas
 * que esperan los handlers heredados (igual que ai_dispatcher_legacy.js buildParsed).
 *
 * @param {Object} aiArgs - Args que devolvió la IA { animado, formato, calidad, ... }
 * @returns {{ args: Array, flags: Object }}
 */
function buildParsed(aiArgs = {}) {
    const flags = {};
    const args  = [];

    // Mappings de parámetros AI → flags del dispatcher original
    if (aiArgs.formato)    flags.f  = aiArgs.formato;
    if (aiArgs.calidad) {
        const qMap = { alta: '1080', media: '720', baja: '360' };
        flags.q = qMap[aiArgs.calidad] ?? aiArgs.calidad;
    }
    if (aiArgs.subtitulos) flags.s   = true;
    if (aiArgs.recortar)   flags.r   = true;
    if (aiArgs.animado)    flags.a   = true;
    if (aiArgs.zip)        flags.zip = true;
    if (aiArgs.como_audio) flags.w   = true;
    if (aiArgs.accion) {
        if (aiArgs.accion === 'terminar') flags.terminar = true;
        if (aiArgs.accion === 'cancelar') flags.cancelar = true;
    }
    if (aiArgs.formato === 'flac') flags.flac = true;

    // Args posicionales: URL o texto libre
    if (aiArgs.url)   args.push(aiArgs.url);
    if (aiArgs.query) args.push(aiArgs.query);
    if (aiArgs.texto) args.push(aiArgs.texto);

    return { args, flags };
}

/**
 * Carga dinámicamente y ejecuta el manejador de una herramienta.
 *
 * @param {Object} tool - El objeto de la herramienta desde tools.js.
 * @param {Object} dynamicArgs - Los argumentos extraídos por la IA.
 * @param {Object} context - El contexto completo de WhatsApp (from, text, messageType, messageData).
 * @returns {Promise<any>} - Resultado de la ejecución del handler.
 */
async function executeTool(tool, dynamicArgs, context) {
    const modulePath = tool.handler.module;

    // Resolución dinámica y caché
    if (!moduleCache[modulePath]) {
        moduleCache[modulePath] = require(modulePath);
    }

    // Fusión de argumentos (estáticos sobrescriben dinámicos en caso de colisión)
    const mergedArgs = { ...dynamicArgs, ...tool.handler.invokeArgs };

    // Traducir args de la IA a flags canónicas que esperan los handlers
    const parsed = buildParsed(mergedArgs);

    // Ejecución del método
    const method = tool.handler.method;
    return await moduleCache[modulePath][method](parsed, context.from, context.messageData);
}

module.exports = { executeTool };
