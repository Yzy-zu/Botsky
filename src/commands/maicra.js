'use strict';

const evolution = require('../services/evolution');
const sendText = (to, text, opts) => evolution.sendText(to, text, opts);
const minecraftRemote = require('../services/minecraftRemote');
const logger = require('../services/logger');
const { isAuthorizedAdmin } = require('../core/auth');

// Alias técnicos de subcomandos explícitos; las frases las interpreta el router.
const ACTION_ALIASES = new Map([
    ['menu', 'menu'], ['panel', 'menu'], ['info', 'menu'],
    ['mod', 'mods'], ['mods', 'mods'], ['addon', 'mods'], ['addons', 'mods'], ['pack', 'mods'], ['packs', 'mods'],
    ['jugador', 'jugadores'], ['jugadores', 'jugadores'], ['player', 'jugadores'], ['players', 'jugadores'], ['online', 'jugadores'], ['conectados', 'jugadores'],
    ['estado', 'estado'], ['status', 'estado'], ['stats', 'estado'], ['recursos', 'estado'], ['ping', 'estado'],
    ['mundo', 'mundos'], ['mundos', 'mundos'], ['world', 'mundos'], ['worlds', 'mundos'], ['mapa', 'mundos'], ['mapas', 'mundos'],
    ['modo', 'config'], ['gamemode', 'config'], ['trucos', 'config'], ['cheats', 'config'], ['dificultad', 'config'], ['config', 'config'], ['propiedades', 'config'],
    ['on', 'on'], ['encender', 'on'], ['prender', 'on'], ['start', 'on'],
    ['off', 'off'], ['apagar', 'off'], ['detener', 'off'], ['stop', 'off'],
    ['reiniciar', 'restart'], ['restart', 'restart'], ['reboot', 'restart'], ['kill', 'kill'],
    ['cmd', 'cmd'], ['comando', 'cmd'], ['log', 'logs'], ['logs', 'logs'], ['registro', 'logs'], ['registros', 'logs'],
    ['backup', 'backup'], ['respaldo', 'backup'],
    ['desactivarmod', 'desactivarmod'], ['quitarmod', 'desactivarmod'], ['removermod', 'desactivarmod'],
    ['activarmod', 'activarmod'], ['ponermod', 'activarmod'], ['instalarmod', 'activarmod']
]);
const ADMIN_ACTIONS = new Set(['desactivarmod', 'activarmod', 'on', 'off', 'restart', 'kill', 'cmd', 'backup']);

/**
 * Handler principal para Minecraft Bedrock en el VPS remoto (redspi vía Tailscale).
 * Totalmente conversacional y libre de encuestas/polls.
 */
async function handleMaicra(parsed = {}, from, messageData) {
    const params = parsed.aiArgs || parsed || {};
    const args = parsed.args || (Array.isArray(params) ? params : []);
    const requestedAction = String(params.subcomando || params.accion || params.action || (!parsed.semanticDecision && args[0]) || '').toLowerCase().trim();
    const action = requestedAction ? ACTION_ALIASES.get(requestedAction) : (parsed.semanticDecision ? null : 'menu');

    try {
        // Si no hay argumentos específicos o pide menú/panel, entregar reporte en vivo unificado sin encuestas
        if (action === 'menu') {
            const [status, players, modsData] = await Promise.all([
                minecraftRemote.getRemoteServerStatus(true),
                minecraftRemote.getOnlinePlayers(),
                minecraftRemote.getActiveModsAndPacks()
            ]);
            const text = `${minecraftRemote.formatStatusSummary(status, players)}\n\n${minecraftRemote.formatModsSummary(modsData)}`;
            return await sendText(from, text);
        }

        const isModDeactivation = action === 'desactivarmod';
        const isModActivation = action === 'activarmod';

        // 1. Consulta de Mods y Addons
        if (action === 'mods') {
            await sendText(from, '> 🔍 *Consultando mods y addons en redspi...*');
            const modsData = await minecraftRemote.getActiveModsAndPacks();
            const text = minecraftRemote.formatModsSummary(modsData);
            return await sendText(from, text);
        }

        // 2. Consulta de Jugadores
        if (action === 'jugadores') {
            const players = await minecraftRemote.getOnlinePlayers();
            if (!players.online) {
                return await sendText(from, `> ⚪ *Minecraft Bedrock:* El servidor está apagado o iniciando.\n_Pídeme_ *"prende el maicra"* _para encenderlo._`);
            }
            const names = (players.players && players.players.length > 0)
                ? players.players.join(', ')
                : 'Nadie conectado ahorita, está solo el changarro';
            return await sendText(from, 
                `> 🟢 *Minecraft Bedrock* (\`${minecraftRemote.REMOTE_HOST}\`)\n\n` +
                `👥 *Jugadores en línea (${players.count}/${players.max}):*\n` +
                `\`${names}\``
            );
        }

        // 3. Estado, Recursos y Métricas
        if (action === 'estado') {
            const [status, players] = await Promise.all([
                minecraftRemote.getRemoteServerStatus(true),
                minecraftRemote.getOnlinePlayers()
            ]);
            const text = minecraftRemote.formatStatusSummary(status, players);
            return await sendText(from, text);
        }

        // 4. Mundos creados
        if (action === 'mundos') {
            const data = await minecraftRemote.getWorldsList();
            const lines = [`> 🌍 *Mundos en Minecraft Bedrock* (\`${minecraftRemote.REMOTE_HOST}\`):\n`];
            for (const w of data.worlds) {
                if (w.isActive) {
                    lines.push(`• ⭐ *${w.name}* _(MUNDO ACTIVO)_`);
                } else {
                    lines.push(`• 📁 \`${w.name}\``);
                }
            }
            return await sendText(from, lines.join('\n'));
        }

        // 5. Configuración, Modo de juego, Dificultad y Trucos
        if (action === 'config') {
            const status = await minecraftRemote.getRemoteServerStatus(false);
            const modeName = status.gamemode === 'survival' ? 'Supervivencia' : (status.gamemode === 'creative' ? 'Creativo' : (status.gamemode || 'Normal'));
            const cheatsStr = status.allowCheats ? 'Activados ⚠️' : 'Desactivados (Todo legal)';
            return await sendText(from,
                `> 🎮 *Configuración del Servidor Bedrock* (\`${minecraftRemote.REMOTE_HOST}\`):\n\n` +
                `• *Mundo activo:* \`${status.activeWorld}\`\n` +
                `• *Modo de juego:* \`${modeName}\` (\`${status.gamemode}\`)\n` +
                `• *Dificultad:* \`${status.difficulty}\`\n` +
                `• *Trucos (Cheats):* \`${cheatsStr}\`\n` +
                `• *Puerto IPv4:* \`${status.serverPort}\`\n` +
                `• *Xbox Live / Online Mode:* \`${status.onlineMode ? 'Requerido' : 'No'}\``
            );
        }

        // Comprobación de autorización administrativa centralizada para todas las acciones administrativas/destructivas
        const isAdminAction = ADMIN_ACTIONS.has(action);

        if (isAdminAction && !isAuthorizedAdmin(from, messageData)) {
            return await sendText(from, '> ❌ *Acceso denegado:* Solo los administradores pueden realizar esta acción en el servidor de Minecraft.');
        }

        // 6. Desactivar un Mod / Addon del mundo
        if (isModDeactivation) {
            const modTarget = params.mod || params.addon || params.pack || (!parsed.semanticDecision ? args.slice(1).join(' ').trim() : '');
            if (!modTarget) {
                return await sendText(from, '> ⚠️ Indica el nombre o UUID del mod o addon que deseas desactivar.');
            }
            await sendText(from, `> ⏳ *Desactivando mod "${modTarget}" en redspi...*`);
            const res = await minecraftRemote.deactivateWorldPack(modTarget, true);
            return await sendText(from, res.message);
        }

        // 7. Activar un Mod / Addon en el mundo
        if (isModActivation) {
            const modTarget = params.mod || params.addon || params.pack || (!parsed.semanticDecision ? args.slice(1).join(' ').trim() : '');
            if (!modTarget) {
                return await sendText(from, '> ⚠️ Indica el nombre o UUID del mod o addon que deseas activar.');
            }
            await sendText(from, `> ⏳ *Activando mod "${modTarget}" en redspi...*`);
            const res = await minecraftRemote.activateWorldPack(modTarget, true);
            return await sendText(from, res.message);
        }

        // 8. Encender
        if (action === 'on') {
            await sendText(from, '> ⏳ *Encendiendo servidor de Minecraft en VPS redspi...*');
            const res = await minecraftRemote.executeServerAction('on');
            return await sendText(from, `> 🟢 *${res.message}*`);
        }

        // 8. Apagar
        if (action === 'off') {
            await sendText(from, '> ⏳ *Apagando servidor de Minecraft...*');
            const res = await minecraftRemote.executeServerAction('off');
            return await sendText(from, `> 🔴 *${res.message}*`);
        }

        // 9. Reiniciar
        if (action === 'restart') {
            await sendText(from, '> 🔄 *Reiniciando servidor de Minecraft...*');
            const res = await minecraftRemote.executeServerAction('restart');
            return await sendText(from, `> 🔄 *${res.message}*`);
        }

        // 10. Kill forzoso
        if (action === 'kill') {
            await sendText(from, '> ⛔ *Forzando apagado inmediato del contenedor...*');
            const res = await minecraftRemote.executeServerAction('kill');
            return await sendText(from, `> ⛔ *${res.message}*`);
        }

        // 11. Comandos de consola
        if (action === 'cmd') {
            const mcCommand = params.comando || params.cmd || (!parsed.semanticDecision ? args.slice(1).join(' ').trim() : '');
            if (!mcCommand) {
                return await sendText(from, '> ⚠️ Especifica el comando a enviar a la consola de Minecraft.');
            }
            const res = await minecraftRemote.executeServerAction('cmd', mcCommand);
            const out = res.output ? `\n\`\`\`\n${res.output}\n\`\`\`` : '';
            return await sendText(from, `> ✅ ${res.message}${out}`);
        }

        // 12. Logs
        if (action === 'logs') {
            const lines = Number(params.lineas ?? params.lines ?? args[1] ?? 15);
            if (!Number.isInteger(lines) || lines < 1 || lines > 1000) {
                return await sendText(from, 'Dime cuántas líneas de logs quieres (entre 1 y 1000).');
            }
            const res = await minecraftRemote.executeServerAction('logs', lines);
            return await sendText(from, `> 📜 *Últimos ${lines} logs de Minecraft Bedrock:*\n\`\`\`\n${res.output || 'Sin logs'}\n\`\`\``);
        }

        // 13. Respaldo Drive
        if (action === 'backup') {
            await sendText(from, '> 💾 *Ejecutando respaldo completo de Minecraft en Google Drive...* (puede tardar ~1 min)');
            const res = await minecraftRemote.executeServerAction('backup');
            return await sendText(from, `> 💾 *${res.message}*\n\`\`\`\n${(res.output || '').slice(-200)}\n\`\`\``);
        }

        return await sendText(from, '¿Qué necesitas del servidor de Minecraft? Puedo consultar su estado, jugadores, mods o ejecutar una acción concreta.');
    } catch (err) {
        logger.error(`[MAICRA] Error procesando acción "${action}":`, err.message);
        return await sendText(from, `> ❌ *Error en Minecraft:* ${err.message}`);
    }
}

module.exports = { handleMaicra };
