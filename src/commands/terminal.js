'use strict';

const logger = require('../services/logger');
const evolution = require('../services/evolution');
const sendText = (to, text) => evolution.sendText(to, text);
const sendTyping = (to) => evolution.sendTyping(to);
const agent = require('../services/agent');
const runAgentWithTerminal = (params) => agent.runAgentWithTerminal(params);
const { isAuthorizedAdmin, getSenderJid } = require('../core/auth');
const { getHistory } = require('../services/history');

/**
 * Manejador del comando de terminal y agente para administradores autorizados.
 *
 * @param {object} parsed - Objeto devuelto por el parser
 * @param {string} from - JID del chat o grupo
 * @param {object} [messageData] - Metadatos del mensaje
 */
async function handleTerminal(parsed, from, messageData) {
    // Capa de defensa en profundidad: verificación estricta de autorización
    if (!isAuthorizedAdmin(from, messageData)) {
        const sender = getSenderJid(from, messageData);
        logger.warn(`[SECURITY] Intento no autorizado en handleTerminal desde ${from} (sender: ${sender})`);
        await sendText(from, `[!] acceso denegado\nsolo los administradores autorizados pueden usar la terminal del servidor`);
        return;
    }

    const userName = messageData?.pushName || 'Admin';
    const params = parsed?.aiArgs || parsed || {};
    // Si fue invocado con prefijo explícito (ej: /@terminal <cmd>, !terminal <cmd>, /cmd <cmd>), los argumentos están en parsed.args.
    // Si vino por lenguaje natural / Router IA (sin prefijo de comando terminal), usamos siempre parsed.raw completo para no perder la primera palabra (verbo).
    const cleanCmd = String(parsed?.command || parsed?.originalCommand || '').replace(/^[\/@!#~]+/, '').toLowerCase();
    const hasPrefix = Boolean(parsed?.hasPrefix || /^[\/@!#~]/.test(String(parsed?.raw || '').trim()));
    const isExplicitTerminalCmd = hasPrefix && ['terminal', 'bash', 'cmd', 'sh', 'agente', 'vps', 'linux', 'recursos', 'sistema'].includes(cleanCmd);

    let userPrompt;
    if (isExplicitTerminalCmd) {
        userPrompt = parsed?.args?.length > 0 ? parsed.args.join(' ') : (parsed?.raw || 'revisa el estado general del servidor');
    } else if (parsed?.raw && parsed.raw.trim()) {
        // En lenguaje natural sin prefijo (ej: "oye búscame cuanto espacio hay en redspi"):
        // Usamos siempre parsed.raw completo para que el agente reciba el objetivo, el contexto y el servidor de destino íntegros.
        userPrompt = parsed.raw.trim();
    } else {
        userPrompt = params.comando || params.prompt || params.consulta || (parsed?.args?.length > 0 ? parsed.args.join(' ') : 'revisa el estado general del servidor');
    }

    logger.info(`[AGENT] Ejecutando Agentic Core para admin ${getSenderJid(from, messageData)}: "${userPrompt.slice(0, 80)}"`);
    sendTyping(from).catch(() => {});

    try {
        const history = getHistory(from, 6);
        const agentResult = await runAgentWithTerminal({
            userMessage: userPrompt,
            userName: userName,
            history
        });

        if (agentResult && agentResult.text) {
            await sendText(from, agentResult.text);
        } else {
            await sendText(from, 'El agente terminó la ejecución pero no devolvió texto de respuesta.');
        }
    } catch (err) {
        logger.error(`[AGENT] Error inesperado en runAgentWithTerminal:`, err);
        await sendText(from, `[!] error al ejecutar en la terminal: ${err.message || 'Error desconocido'}`);
    }
}

module.exports = { handleTerminal };
