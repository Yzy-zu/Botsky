'use strict';

const { exec, execFile } = require('child_process');
const { promisify } = require('util');
const util = require('minecraft-server-util');
const { sendText } = require('../services/evolution');
const logger = require('../services/logger');

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const CONTAINER_NAME = 'mc-bedrock';

async function handleMaicra({ args }, from, messageData) {
    // La validacion de admin ya se hace en dispatcher.js

    if (args.length === 0) {
        return require('../services/evolution').sendPoll(from, '[+]maicra', [
            '⚙️ Gestión del Servidor',
            '🌍 Mundo y Clima',
            '🎮 Modos y Dificultad',
            '📜 Reglas del Juego'
        ]);
    }

    const action = args[0].toLowerCase();

    try {
        switch (action) {
            case 'menu':
            case 'server':
            case 'mundo':
            case 'modos':
            case 'reglas':
                const menuType = action === 'menu' ? args[1]?.toLowerCase() : action;
                
                if (menuType === 'server') {
                    return require('../services/evolution').sendPoll(from, '[+] gestion del servidor', [
                        '🟢 Encender Servidor',
                        '🔴 Apagar Servidor',
                        '🔄 Reiniciar Servidor',
                        '📊 Estado y Recursos',
                        '📡 Ping y Jugadores',
                        '💾 Forzar Guardado',
                        '🗑️ Limpiar Basura (Items)',
                        '📜 Ver Logs (Últimos 10)',
                        '⛔ Apagar de Emergencia',
                        '🔙 Volver al Menú Principal'
                    ]);
                } else if (menuType === 'mundo') {
                    return require('../services/evolution').sendPoll(from, '[+] mundo y clima', [
                        '☀️ Hacer de Día (6am)',
                        '🌆 Atardecer (6pm)',
                        '🌙 Hacer de Noche',
                        '🌌 Medianoche (12am)',
                        '🌧️ Activar Lluvia',
                        '☀️ Quitar Lluvia',
                        '🌩️ Activar Tormenta',
                        '⏸️ Pausar Ciclo de Día',
                        '▶️ Reanudar Ciclo de Día',
                        '🔙 Volver al Menú Principal'
                    ]);
                } else if (menuType === 'jugadores' || menuType === 'modos') {
                    return require('../services/evolution').sendPoll(from, '[+] modos y dificultad', [
                        '🧑‍💻 Todos a Creativo',
                        '🗡️ Todos a Supervivencia',
                        '🗺️ Todos a Aventura',
                        '🕊️ Dificultad: Pacífica',
                        '🟢 Dificultad: Fácil',
                        '🟡 Dificultad: Normal',
                        '🔴 Dificultad: Difícil',
                        '🔙 Volver al Menú Principal'
                    ]);
                } else if (menuType === 'reglas') {
                    return require('../services/evolution').sendPoll(from, '[+] reglas del juego', [
                        '🛡️ Quitar Fuego Amigo (PvP Off)',
                        '⚔️ Activar Fuego Amigo (PvP On)',
                        '🎒 Conservar Inventario',
                        '💥 Perder Inventario',
                        '🚫 Quitar Daño por Caída',
                        '☠️ Activar Daño por Caída',
                        '🔙 Volver al Menú Principal'
                    ]);
                }
                // Si no hay subtipo o es 'menu' a secas, mostrar el principal
                return require('../services/evolution').sendPoll(from, '[+] panel principal de maicra', [
                    '⚙️ Gestión del Servidor',
                    '🌍 Mundo y Clima',
                    '🎮 Modos y Dificultad',
                    '📜 Reglas del Juego'
                ]);

            case 'on':
            case 'encender':
                await sendText(from, '> encendiendo servidor');
                await execAsync(`docker start ${CONTAINER_NAME}`, { timeout: 30_000 });
                await sendText(from, '> servidor encendido');
                break;

            case 'off':
            case 'apagar':
                await sendText(from, '> apagando servidor');
                await execAsync(`docker stop ${CONTAINER_NAME}`, { timeout: 30_000 });
                await sendText(from, '> servidor apagado');
                break;

            case 'reiniciar':
            case 'restart':
                await sendText(from, '> reiniciando servidor');
                await execAsync(`docker restart ${CONTAINER_NAME}`, { timeout: 30_000 });
                await sendText(from, '> servidor reiniciado');
                break;

            case 'estado':
            case 'stats':
                // Obtenemos estado general y uso de recursos
                const { stdout: status } = await execAsync(`docker inspect -f '{{.State.Status}}' ${CONTAINER_NAME}`, { timeout: 15_000 });
                let statsStr = '';
                if (status.trim() === 'running') {
                    const { stdout: stats } = await execAsync(`docker stats --no-stream --format "CPU: {{.CPUPerc}}\\nRAM: {{.MemUsage}}\\nRed: {{.NetIO}}" ${CONTAINER_NAME}`, { timeout: 15_000 });
                    statsStr = `\n${stats}`;
                }

                await sendText(from,
                    `> estado \`${CONTAINER_NAME}\`\n\nstatus: \`${status.trim().toLowerCase()}\`` +
                    statsStr
                );
                break;

            case 'ping':
            case 'jugadores':
                try {
                    // Bedrock usa el puerto 19132 UDP por defecto
                    const startPing = Date.now();
                    const result = await util.statusBedrock(process.env.MINECRAFT_HOST || '100.104.54.2', parseInt(process.env.MINECRAFT_PORT || '29132', 10), { timeout: 3000 });
                    const latency = result.roundTripLatency ?? (Date.now() - startPing);
                    await sendText(from,
                        `> maicra online\n` +
                        `jugadores: \`${result.players.online}/${result.players.max}\`\n` +
                        `version: \`${result.version.name}\`\n` +
                        `latencia: \`${latency}ms\``
                    );
                } catch (e) {
                    await sendText(from, '> servidor apagado o iniciando');
                }
                break;

            case 'cmd':
            case 'comando':
                const mcCommand = args.slice(1).join(' ');
                if (!mcCommand) {
                    return sendText(from, '> especifica un comando\nusa `/@ maicra cmd [comando]`');
                }

                await sendText(from, `> ejecutando \`/${mcCommand}\``);
                await execFileAsync('docker', ['exec', CONTAINER_NAME, 'send-command', mcCommand], { timeout: 15_000 });
                await sendText(from, '> comando enviado');
                break;

            case 'kill':
                await sendText(from, '> forzando apagado');
                await execAsync(`docker kill ${CONTAINER_NAME}`, { timeout: 15_000 });
                await sendText(from, '> servidor apagado forzosamente');
                break;

            case 'logs':
                const { stdout: logs } = await execAsync(`docker logs --tail 10 ${CONTAINER_NAME}`, { timeout: 15_000 });
                await sendText(from, `> ultimos logs\n\`\`\`\n${logs}\n\`\`\``);
                break;

            default:
                await sendText(from, `> accion desconocida \`${action}\``);
        }
    } catch (err) {
        logger.error('Error en maicra:', err.message);
        const userErr = new Error(err.message);
        userErr.userMessage = err.message;
        throw userErr;
    }
}

module.exports = { handleMaicra };
