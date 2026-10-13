'use strict';

const logger = require('./logger');
const db = require('./db');
const evolution = require('./evolution');
const { resolveMessageText } = require('../utils/messageText');
const { prepareReminder } = require('../utils/reminderInput');

// ─── Declaración de Herramientas para Gemini Function Calling ────────────────
const BOTSKY_TOOL_DECLARATIONS = [
    // 1. Minecraft Bedrock Server (VPS redspi)
    {
        name: 'minecraft_control',
        description: 'Control y diagnóstico total del servidor Minecraft Bedrock en VPS redspi vía Tailscale. Permite consultar telemetría viva (uptime, ping Tailscale, lag/TPS, specs de RAM/CPU/disco, jugadores conectados, modo de juego, dificultad, trucos activos, addons/mods), ejecutar comandos de consola (/time set day, /gamemode creative, /difficulty, /gamerule, /op, etc.), gestionar mods del mundo (activar o desactivar addons) y control de energía (on, off, restart, logs, mundos).',
        parameters: {
            type: 'OBJECT',
            properties: {
                accion: {
                    type: 'STRING',
                    description: 'Acción a realizar',
                    enum: ['telemetria', 'comando_consola', 'activar_mod', 'desactivar_mod', 'ciclo_vida', 'mundos']
                },
                comando: {
                    type: 'STRING',
                    description: 'Comando de consola BDS a enviar si accion="comando_consola" (ej: "time set day", "gamemode creative", "difficulty peaceful", "gamerule keepInventory true", "op Petrov", etc.)'
                },
                mod: {
                    type: 'STRING',
                    description: 'Nombre o UUID del mod/addon si accion="activar_mod" o "desactivar_mod"'
                },
                operacion_energia: {
                    type: 'STRING',
                    description: 'Operación si accion="ciclo_vida": "on", "off", "restart", "logs"',
                    enum: ['on', 'off', 'restart', 'logs']
                }
            },
            required: ['accion']
        }
    },

    // 2. Terminal Bash Linux (VPS) - Requiere privilegios de Admin
    {
        name: 'ejecutar_terminal',
        description: 'Ejecuta comandos libres en la terminal Bash del servidor Linux como el usuario petrov. Por defecto ejecuta en el host local ("miroslav"). Si el usuario pide explícitamente revisar o diagnosticar el servidor remoto "redspi" (donde corre Minecraft), puedes usar comandos SSH como "ssh -o BatchMode=yes redspi df -h /", "ssh -o BatchMode=yes redspi free -h" o "ssh -o BatchMode=yes redspi docker ps". Solo disponible para administradores autorizados.',
        parameters: {
            type: 'OBJECT',
            properties: {
                comando: {
                    type: 'STRING',
                    description: 'El comando o script Bash a ejecutar (ej: "uptime", "free -m", "docker ps", "df -h", "pm2 status", etc.)'
                }
            },
            required: ['comando']
        }
    },

    // 3. Tablón Grupal de Notas
    {
        name: 'notas_tablon',
        description: 'Gestiona notas y recordatorios de texto compartidos en el grupo o chat. Permite guardar una nota nueva, listar todas las notas guardadas, buscar notas por palabra clave o borrar una nota por su número de ID.',
        parameters: {
            type: 'OBJECT',
            properties: {
                accion: {
                    type: 'STRING',
                    description: 'Operación sobre notas',
                    enum: ['guardar', 'listar', 'buscar', 'borrar']
                },
                contenido: {
                    type: 'STRING',
                    description: 'Contenido para guardar o término a buscar. Si dice guardar esto y cita un mensaje, omite contenido: se usa la cita.'
                },
                id: {
                    type: 'INTEGER',
                    description: 'ID numérico de la nota a borrar'
                }
            },
            required: ['accion']
        }
    },

    // 4. Recordatorios y Alarmas Automáticas
    {
        name: 'recordatorios_alarmas',
        description: 'Programa alarmas o recordatorios automáticos que el bot enviará al chat cuando se cumpla el tiempo indicado (ej: en 15 minutos, en 2 horas, mañana a las 8am). Permite crear, listar o cancelar recordatorios pendientes.',
        parameters: {
            type: 'OBJECT',
            properties: {
                accion: {
                    type: 'STRING',
                    description: 'Operación',
                    enum: ['crear', 'listar', 'cancelar']
                },
                mensaje: {
                    type: 'STRING',
                    description: 'Mensaje del recordatorio. Si dice recuérdame esto y cita un mensaje, omite mensaje: se usa la cita.'
                },
                tiempo: {
                    type: 'STRING',
                    description: 'Fecha ISO 8601 completa con zona horaria. Normaliza cualquier expresión humana a ISO o usa minutos numéricos y omite tiempo. Si no indica cuándo, pregunta; no inventes el plazo.'
                },
                minutos: {
                    type: 'NUMBER',
                    description: 'Minutos de espera calculados desde un plazo explícito del usuario (opcional; sin tiempo). Nunca usar un valor por defecto si no indicó cuándo.'
                },
                id: {
                    type: 'INTEGER',
                    description: 'ID del recordatorio a cancelar'
                }
            },
            required: ['accion']
        }
    },

    // 5. Tareas Escolares y Horario Universitario
    {
        name: 'tareas_escolares',
        description: 'Gestiona tareas académicas universitarias (grupo TI-7B) y consulta de horarios de clase. Permite registrar una nueva tarea, listar pendientes, cancelar una tarea entregada o consultar el horario escolar.',
        parameters: {
            type: 'OBJECT',
            properties: {
                accion: {
                    type: 'STRING',
                    description: 'Operación académica',
                    enum: ['crear', 'listar', 'cancelar', 'horario']
                },
                materia: {
                    type: 'STRING',
                    description: 'Materia escolar (ej: Matemáticas, Redes, Base de Datos, etc.)'
                },
                titulo: {
                    type: 'STRING',
                    description: 'Qué hay que hacer, extraído de lo que dijo el usuario en lenguaje natural. No pedir comandos ni separadores.'
                },
                fecha: {
                    type: 'STRING',
                    description: 'Fecha mencionada por el usuario (ej: "el viernes"). Opcional: omitir si no la dijo; no inventar una fecha.'
                },
                detalles: {
                    type: 'STRING',
                    description: 'Requisitos o notas adicionales de la tarea'
                },
                id: {
                    type: 'INTEGER',
                    description: 'ID de la tarea a cancelar'
                }
            },
            required: ['accion']
        }
    },

    // 6. Google Drive
    {
        name: 'google_drive',
        description: 'Consulta almacenamiento libre y usado en Google Drive o busca archivos existentes guardados en Drive.',
        parameters: {
            type: 'OBJECT',
            properties: {
                accion: {
                    type: 'STRING',
                    description: 'Operación en Drive',
                    enum: ['espacio', 'buscar']
                },
                query: {
                    type: 'STRING',
                    description: 'Nombre o término de búsqueda del archivo en Drive'
                }
            },
            required: ['accion']
        }
    },

    // 7. Descargar Video o Música de Redes Sociales
    {
        name: 'descargar_multimedia',
        description: 'Descarga videos o música de YouTube, TikTok, Instagram, Twitter/X, Facebook o Spotify y los envía directamente al chat de WhatsApp.',
        parameters: {
            type: 'OBJECT',
            properties: {
                query_o_url: {
                    type: 'STRING',
                    description: 'Enlace web directo o término de búsqueda del video/canción'
                },
                formato: {
                    type: 'STRING',
                    description: '"mp3" para audio/música, "mp4" para video',
                    enum: ['mp3', 'mp4']
                },
                calidad: {
                    type: 'STRING',
                    description: 'Calidad de video deseada (ej: "360", "480", "720", "1080", "best")'
                }
            },
            required: ['query_o_url']
        }
    },

    // 8. Síntesis de Voz (TTS) y Efectos de Audio
    {
        name: 'sintetizar_voz',
        description: 'Compone y envía una nota de voz usando la petición, cita e historial reales. Distingue encargo de texto literal y ajusta la duración solicitada. No copies instrucciones como si fueran el guion. Admite voces y filtros.',
        parameters: {
            type: 'OBJECT',
            properties: {
                destino_scope: { type: 'STRING', enum: ['current_chat', 'main_group', 'contact'], description: 'Destino interpretado por sentido; nunca extraído del contenido hablado.' },
                contacto: { type: 'STRING', description: 'Nombre o teléfono si destino_scope es contact.' },
                texto_literal: { type: 'STRING', description: 'Palabras exactas sólo para modo verbatim.' },
                texto: {
                    type: 'STRING',
                    description: 'Texto disponible como dato o referencia. La petición original determina si se lee literalmente o se compone.'
                },
                instruccion: {
                    type: 'STRING', description: 'Encargo completo: tema, destinatario y tono que debe comunicar el audio.'
                },
                durationSeconds: {
                    type: 'NUMBER', description: 'Duración del audio en segundos, sólo si el usuario la pidió.'
                },
                modo: {
                    type: 'STRING', enum: ['compose', 'verbatim'], description: 'Verbatim únicamente si el usuario pidió lectura exactamente literal.'
                },
                voz: {
                    type: 'STRING',
                    description: 'Nombre de la voz o personaje deseado (daniel, goku, dross, donramon, ardilla, demonio, robot, anime, loquendo, mujer, hombre)'
                }
            },
            required: ['destino_scope', 'modo']
        }
    },

    {
        name: 'enviar_archivo_contacto',
        description: 'Reenvía el audio, foto, video o archivo adjunto/citado/reciente a un contacto o al grupo. Conserva el archivo original; no genera otro audio ni otra foto. Requiere administrador para otros chats.',
        parameters: {
            type: 'OBJECT',
            properties: {
                destino_scope: { type: 'STRING', enum: ['current_chat', 'main_group', 'contact'] },
                contacto: { type: 'STRING', description: 'Nombre o número si el destino es contact.' },
                caption_mode: { type: 'STRING', enum: ['none', 'original', 'compose', 'literal'] },
                caption: { type: 'STRING', description: 'Recado a componer o texto exacto según caption_mode. La orden de envío no es la leyenda.' },
                instruccion: { type: 'STRING', description: 'Petición completa del usuario. Nunca una URL o ruta de archivo inventada.' }
            },
            required: ['destino_scope', 'caption_mode']
        }
    },

    // 9. Juegos y Economía (XP, Ruleta, Daily, Nuclear)
    {
        name: 'juegos_y_economia',
        description: 'Maneja juegos grupales y economía de puntos de experiencia (XP): reclamar recompensa diaria ("daily"), ruleta rusa con apuestas de XP ("ruleta"), tabla de niveles ("rank" o "top") o protocolo de bomba nuclear.',
        parameters: {
            type: 'OBJECT',
            properties: {
                juego: {
                    type: 'STRING',
                    description: 'Tipo de juego o acción',
                    enum: ['daily', 'ruleta', 'rank', 'top', 'nuclear']
                },
                apuesta: {
                    type: 'INTEGER',
                    description: 'Cantidad de XP a apostar en la ruleta (opcional)'
                }
            },
            required: ['juego']
        }
    },

    // 10. Afinidad Social y Lore del Grupo
    {
        name: 'afinidad_y_lore',
        description: 'Consulta el nivel de afinidad, respeto o rencor que Botsky tiene con un usuario, o genera una crónica épica del lore del grupo.',
        parameters: {
            type: 'OBJECT',
            properties: {
                accion: {
                    type: 'STRING',
                    description: 'Acción social',
                    enum: ['afinidad', 'lore']
                }
            },
            required: ['accion']
        }
    },

    // 11. Control de Televisión de la Casa
    {
        name: 'control_tv',
        description: 'Cambia el canal o aplicación en la televisión inteligente de la casa.',
        parameters: {
            type: 'OBJECT',
            properties: {
                canal: {
                    type: 'STRING',
                    description: 'Canal o app a poner: "futbol", "youtube", "netflix", etc.'
                }
            },
            required: ['canal']
        }
    },

    // 12. Enviar Mensaje a Contacto o Miembro del Grupo
    {
        name: 'enviar_mensaje_contacto',
        description: 'Envía un mensaje privado o recado de WhatsApp a un contacto o miembro del grupo "Gente del señor chiqui 🐓" buscándolo por su nombre o apodo (ej: "Fernando", "Fer", "Lisandro", "Emmanuel", etc.). Solo disponible para administradores o el creador.',
        parameters: {
            type: 'OBJECT',
            properties: {
                destino_scope: { type: 'STRING', enum: ['current_chat', 'main_group', 'contact'] },
                contacto: {
                    type: 'STRING',
                    description: 'Nombre o apodo del contacto a quien enviar el mensaje (ej: "Fernando")'
                },
                mensaje: {
                    type: 'STRING',
                    description: 'Texto exacto o recado a enviarle al contacto'
                },
                anonimo: {
                    type: 'BOOLEAN',
                    description: 'Si el usuario pide anonimato, conserva esa preferencia también al aclarar el destinatario.'
                }
            },
            required: ['destino_scope', 'mensaje']
        }
    }
];

/**
 * Devuelve las declaraciones de herramientas filtradas según permisos del usuario.
 * @param {boolean} isAdmin - Si el usuario es administrador autorizado
 */
function getToolDeclarations(isAdmin = false) {
    const list = BOTSKY_TOOL_DECLARATIONS.filter(tool => {
        if (tool.name === 'ejecutar_terminal' && !isAdmin) return false;
        if (tool.name === 'enviar_mensaje_contacto' && !isAdmin) return false;
        if (tool.name === 'enviar_archivo_contacto' && !isAdmin) return false;
        return true;
    });
    return [{ functionDeclarations: list }];
}

/**
 * Ejecutor universal de herramientas para Function Calling.
 * Recibe el nombre de la función, los argumentos JSON de Gemini y el contexto de ejecución.
 *
 * @param {string} name - Nombre de la herramienta invocada
 * @param {object} args - Argumentos estructurados generados por Gemini
 * @param {object} context - Contexto { from, messageData, userName, senderJid, isAdmin, isGroup }
 * @returns {Promise<object>} Resultado estructurado devuelto al modelo
 */
// Tool arguments must be JSON data. Reject accessors/cycles/BigInt without
// evaluating getters or allowing malformed metadata to escape the contract.
function toolInput(value, ancestors = new Set(), depth = 0) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (value === undefined) return undefined;
    if (typeof value !== 'object' || depth > 12 || ancestors.has(value)) throw new TypeError('Argumentos de herramienta inválidos.');
    ancestors.add(value);
    try {
        const result = Array.isArray(value) ? [] : Object.create(null);
        for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
            if (!descriptor.enumerable) continue;
            if (!('value' in descriptor)) throw new TypeError('Argumentos de herramienta inválidos.');
            result[key] = toolInput(descriptor.value, ancestors, depth + 1);
        }
        return result;
    } finally { ancestors.delete(value); }
}

async function executeTool(name, args = {}, context = {}) {
    if (!name || typeof name !== 'string') {
        return { success: false, error: 'Nombre de herramienta no especificado o inválido.' };
    }

    if (!BOTSKY_TOOL_DECLARATIONS.some(tool=>tool.name===name)) return {success:false,error:`Herramienta "${name}" no está registrada en el sistema.`};
    try {
        if (Array.isArray(args)||Array.isArray(context)) throw new TypeError('Argumentos de herramienta inválidos.');
        const safeArgs = (args && typeof args === 'object') ? toolInput(args) : {};
        const safeContext = (context && typeof context === 'object') ? toolInput(context) : {};
        const { from, messageData, userName, isGroup = false } = safeContext;
        if (typeof from !== 'string' || !from.trim()) return {success:false,error:'Falta el chat autenticado para ejecutar la herramienta.'};
        const {getSenderJid,isAuthorizedAdmin} = require('../core/auth');
        const senderJid = getSenderJid(from,messageData);
        const isAdmin = isAuthorizedAdmin(from,messageData);

        logger.info(`[TOOL-RUN] Ejecutando herramienta "${name}"`);

        switch (name) {
            // ── 1. MINECRAFT BEDROCK ─────────────────────────────────────────
            case 'minecraft_control': {
                const mc = require('./minecraftRemote');
                const accion = (typeof safeArgs.accion === 'string' ? safeArgs.accion : '').toLowerCase().trim() || 'telemetria';

                if (accion === 'telemetria') {
                    const [status, players, mods] = await Promise.all([
                        mc.getRemoteServerStatus(true).catch(err => ({
                            online: false,
                            containerStatus: 'unreachable',
                            uptime: 'Desconocido',
                            startedAt: 'Desconocido',
                            latencyMs: -1,
                            lag: 'Desconectado',
                            cpu: 'N/A',
                            memory: 'N/A',
                            disk: 'N/A',
                            activeWorld: 'Desconocido',
                            gamemode: 'survival',
                            difficulty: 'normal',
                            allowCheats: false,
                            serverPort: 19132,
                            error: err.message
                        })),
                        mc.getOnlinePlayers().catch(() => ({ players: [], count: 0, max: 0 })),
                        mc.getActiveModsAndPacks().catch(err => ({ behaviorPacks: [], resourcePacks: [], error: err.message }))
                    ]);
                    return {
                        success: true,
                        online: status.online,
                        estado_contenedor: status.containerStatus,
                        uptime: status.uptime,
                        iniciado_el: status.startedAt,
                        latencia_tailscale_ms: status.latencyMs,
                        salud_lag: status.lag,
                        cpu: status.cpu,
                        ram: status.memory,
                        disco_vps: status.disk,
                        mundo_activo: status.activeWorld,
                        modo_juego: status.gamemode,
                        dificultad: status.difficulty,
                        trucos_cheats: status.allowCheats,
                        puerto: status.serverPort,
                        jugadores_conectados: players?.players || [],
                        total_jugadores: `${players?.count ?? 0}/${players?.max ?? 0}`,
                        behavior_packs: (mods?.behaviorPacks || []).map(p => `${p.name} (v${p.version})`),
                        resource_packs: (mods?.resourcePacks || []).map(p => `${p.name} (v${p.version})`)
                    };
                }

                if (accion === 'comando_consola') {
                    if (!isAdmin) {
                        return { success: false, error: 'Acceso denegado: solo administradores pueden ejecutar comandos en la consola de Minecraft.' };
                    }
                    const cmd = (typeof safeArgs.comando === 'string' ? safeArgs.comando : '').trim();
                    if (!cmd) return { success: false, error: 'Debes especificar el comando a enviar a la consola.' };
                    try {
                        const res = await mc.executeServerAction('cmd', cmd);
                        return { success: !!res?.success, comando_enviado: cmd, mensaje: res?.message, salida_consola: res?.output };
                    } catch (err) {
                        return { success: false, error: `Error enviando comando a Minecraft: ${err.message}` };
                    }
                }

                if (accion === 'activar_mod') {
                    if (!isAdmin) {
                        return { success: false, error: 'Acceso denegado: solo administradores pueden activar mods en el servidor de Minecraft.' };
                    }
                    const mod = (typeof safeArgs.mod === 'string' ? safeArgs.mod : '').trim();
                    if (!mod) return { success: false, error: 'Indica el nombre o UUID del mod a activar.' };
                    try {
                        const res = await mc.activateWorldPack(mod, true);
                        return { success: !!res?.success, mod, mensaje: res?.message };
                    } catch (err) {
                        return { success: false, error: `Error activando mod en Minecraft: ${err.message}` };
                    }
                }

                if (accion === 'desactivar_mod') {
                    if (!isAdmin) {
                        return { success: false, error: 'Acceso denegado: solo administradores pueden desactivar mods en el servidor de Minecraft.' };
                    }
                    const mod = (typeof safeArgs.mod === 'string' ? safeArgs.mod : '').trim();
                    if (!mod) return { success: false, error: 'Indica el nombre o UUID del mod a desactivar.' };
                    try {
                        const res = await mc.deactivateWorldPack(mod, true);
                        return { success: !!res?.success, mod, mensaje: res?.message };
                    } catch (err) {
                        return { success: false, error: `Error desactivando mod en Minecraft: ${err.message}` };
                    }
                }

                if (accion === 'ciclo_vida') {
                    if (!isAdmin) {
                        return { success: false, error: 'Acceso denegado: solo administradores pueden controlar la energía del servidor de Minecraft.' };
                    }
                    const op = (typeof safeArgs.operacion_energia === 'string' ? safeArgs.operacion_energia : 'restart').trim().toLowerCase();
                    try {
                        const res = await mc.executeServerAction(op);
                        return { success: !!res?.success, operacion: op, mensaje: res?.message };
                    } catch (err) {
                        return { success: false, error: `Error en ciclo de vida de Minecraft: ${err.message}` };
                    }
                }

                if (accion === 'mundos') {
                    try {
                        const worldsData = await mc.getWorldsList();
                        return { success: true, mundos: worldsData?.worlds || [], mundo_activo: worldsData?.activeWorld || 'Desconocido' };
                    } catch (err) {
                        return { success: false, error: `Error consultando mundos de Minecraft: ${err.message}` };
                    }
                }

                return { success: false, error: `Acción no reconocida en minecraft_control: "${accion}"` };
            }

            // ── 2. TERMINAL BASH VPS (Admin) ────────────────────────────────
            case 'ejecutar_terminal': {
                if (!isAdmin) {
                    return { success: false, error: 'Acceso denegado: solo el administrador autorizado puede ejecutar comandos en la terminal.' };
                }
                const cmd = typeof safeArgs.comando === 'string' ? safeArgs.comando.trim() : '';
                if (!cmd) return { success: false, error: 'Debes especificar el comando a ejecutar en la terminal.' };
                const { executeBash } = require('./terminal');
                try {
                    return await executeBash(cmd);
                } catch (err) {
                    return { success: false, error: `Error ejecutando comando en terminal: ${err.message}` };
                }
            }

            // ── 3. TABLÓN DE NOTAS ──────────────────────────────────────────
            case 'notas_tablon': {
                const accion = (typeof safeArgs.accion === 'string' ? safeArgs.accion : 'listar').toLowerCase().trim();

                if (accion === 'guardar') {
                    const contenido = resolveMessageText(safeArgs.contenido, messageData);
                    if (!contenido) return { success: false, needs_clarification: true, missing_fields: ['contenido'], question: '¿Qué guardamos? También puedes responder al mensaje que quieres guardar.', error: '¿Qué guardamos? También puedes responder al mensaje que quieres guardar.' };
                    try {
                        const res = await db.addNote(from, senderJid, userName, contenido);
                        return { success: true, nota_id: res?.id, contenido, mensaje: 'Va, guardé la nota en este chat.' };
                    } catch (err) {
                        return { success: false, error: `Error al guardar nota: ${err.message}` };
                    }
                }

                if (accion === 'listar') {
                    try {
                        const notas = await db.getNotes(from);
                        return {
                            success: true,
                            total: notas ? notas.length : 0,
                            notas: (notas || []).map(n => ({ id: n.id, autor: n.user_name, contenido: n.content, fecha: n.created_at }))
                        };
                    } catch (err) {
                        return { success: false, error: `Error al listar notas: ${err.message}` };
                    }
                }

                if (accion === 'buscar') {
                    const query = typeof safeArgs.contenido === 'string' ? safeArgs.contenido.trim() : '';
                    if (!query) return { success: false, error: 'Indica qué palabra deseas buscar en las notas.' };
                    try {
                        const notas = await db.searchNotes(from, query);
                        return {
                            success: true,
                            coincidencias: notas ? notas.length : 0,
                            notas: (notas || []).map(n => ({ id: n.id, autor: n.user_name, contenido: n.content }))
                        };
                    } catch (err) {
                        return { success: false, error: `Error al buscar notas: ${err.message}` };
                    }
                }

                if (accion === 'borrar') {
                    const rawId = safeArgs.id;
                    const noteId = Number(rawId);
                    if (rawId === undefined || rawId === null || !Number.isInteger(noteId) || noteId <= 0) {
                        return { success: false, error: 'Indica el ID numérico válido de la nota a borrar.' };
                    }
                    try {
                        const deleted = await db.deleteNote(from, noteId);
                        return { success: !!deleted, mensaje: deleted ? `Nota #${noteId} eliminada` : `No se encontró la nota #${noteId}` };
                    } catch (err) {
                        return { success: false, error: `Error al borrar nota: ${err.message}` };
                    }
                }

                return { success: false, error: `Acción desconocida en notas: "${accion}"` };
            }

            // ── 4. RECORDATORIOS Y ALARMAS ──────────────────────────────────
            case 'recordatorios_alarmas': {
                const accion = (typeof safeArgs.accion === 'string' ? safeArgs.accion : 'crear').toLowerCase().trim();

                if (accion === 'crear') {
                    const creation = prepareReminder(safeArgs, messageData);
                    if (!creation.success) return creation;
                    const { mensaje, dueAt, timeDesc } = creation;

                    try {
                        const res = await db.addReminder(from, senderJid, userName, mensaje, dueAt);
                        return {
                            success: true,
                            recordatorio_id: res?.id,
                            mensaje_recordatorio: mensaje,
                            dispara_en: timeDesc,
                            fecha_estimada: new Date(dueAt).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })
                        };
                    } catch (err) {
                        return { success: false, error: `Error al crear recordatorio: ${err.message}` };
                    }
                }

                if (accion === 'listar') {
                    try {
                        const list = await db.getUserPendingReminders(from, isAdmin ? null : senderJid);
                        return {
                            success: true,
                            total: list ? list.length : 0,
                            recordatorios: (list || []).map(r => ({
                                id: r.id,
                                mensaje: r.reminder_text || r.message,
                                entrega: new Date(r.due_at).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })
                            }))
                        };
                    } catch (err) {
                        return { success: false, error: `Error al listar recordatorios: ${err.message}` };
                    }
                }

                if (accion === 'cancelar') {
                    const rawId = safeArgs.id;
                    const id = Number(rawId);
                    if (rawId === undefined || rawId === null || !Number.isInteger(id) || id <= 0) {
                        return { success: false, error: 'Indica el ID numérico del recordatorio a cancelar.' };
                    }
                    try {
                        const del = await db.cancelReminder(id, senderJid, isAdmin);
                        return { success: !!del, mensaje: del ? `Recordatorio #${id} cancelado.` : `No se pudo cancelar el recordatorio #${id}.` };
                    } catch (err) {
                        return { success: false, error: `Error al cancelar recordatorio: ${err.message}` };
                    }
                }

                return { success: false, error: `Acción desconocida en recordatorios: "${accion}"` };
            }

            // ── 5. TAREAS ESCOLARES ─────────────────────────────────────────
            case 'tareas_escolares': {
                const accion = (typeof safeArgs.accion === 'string' ? safeArgs.accion : 'listar').toLowerCase().trim();

                if (accion === 'crear') {
                    try {
                        const { handleDirectTaskMessage } = require('./school');
                        return await handleDirectTaskMessage({
                            text: safeContext.userMessage || '',
                            from,
                            messageData,
                            taskDetails: safeArgs,
                            sendConfirmation: false
                        });
                    } catch (err) {
                        logger.error('[SCHOOL-TOOL] Error guardando tarea:', err.message);
                        return { success: false, error: 'No pude guardar la tarea. Intenta de nuevo en un momento.' };
                    }
                }

                if (accion === 'listar') {
                    try {
                        const tareas = await db.getSchoolTasks();
                        return {
                            success: true,
                            total_pendientes: tareas ? tareas.length : 0,
                            tareas: (tareas || []).map(t => ({
                                id: t.id,
                                materia: t.subject,
                                titulo: t.title,
                                entrega: t.due_text || (t.due_at ? new Date(t.due_at).toLocaleDateString('es-MX') : 'Pendiente'),
                                detalles: t.details || ''
                            }))
                        };
                    } catch (err) {
                        return { success: false, error: `Error al listar tareas escolares: ${err.message}` };
                    }
                }

                if (accion === 'cancelar') {
                    const rawId = safeArgs.id;
                    const id = Number(rawId);
                    if (rawId === undefined || rawId === null || !Number.isInteger(id) || id <= 0) {
                        return { success: false, error: 'Indica el ID numérico de la tarea a cancelar.' };
                    }
                    try {
                        const res = await db.cancelSchoolTask(id);
                        return { success: !!res, mensaje: res ? `Tarea #${id} cancelada` : `No se encontró la tarea #${id}` };
                    } catch (err) {
                        return { success: false, error: `Error al cancelar tarea escolar: ${err.message}` };
                    }
                }

                if (accion === 'horario') {
                    try {
                        const { UTM_SCHEDULE_TI7B } = require('./school_schedule_data');
                        return { success: true, horario_semanal: UTM_SCHEDULE_TI7B };
                    } catch (err) {
                        return { success: false, error: `Error consultando horario escolar: ${err.message}` };
                    }
                }

                return { success: false, error: `Acción escolar no reconocida: "${accion}"` };
            }

            // ── 6. GOOGLE DRIVE ─────────────────────────────────────────────
            case 'google_drive': {
                const accion = (typeof safeArgs.accion === 'string' ? safeArgs.accion : 'espacio').toLowerCase().trim();

                if (accion === 'espacio') {
                    try {
                        const { getQuota } = require('./drive');
                        const quota = await getQuota();
                        const limit = parseInt(quota?.limit, 10);
                        const usage = parseInt(quota?.usage, 10);
                        const limitGB = (!isNaN(limit) && limit > 0) ? (limit / (1024 ** 3)).toFixed(2) : '0';
                        const usageGB = (!isNaN(usage) && usage >= 0) ? (usage / (1024 ** 3)).toFixed(2) : '0';
                        const freeGB = (!isNaN(limit) && !isNaN(usage)) ? Math.max(0, limitGB - usageGB).toFixed(2) : '0';
                        const percent = (!isNaN(limit) && limit > 0 && !isNaN(usage)) ? ((usage / limit) * 100).toFixed(1) : '0';
                        return {
                            success: true,
                            limiteGB: limitGB,
                            usadoGB: usageGB,
                            libreGB: freeGB,
                            porcentaje_usado: `${percent}%`
                        };
                    } catch (err) {
                        return { success: false, error: `Error consultando espacio en Google Drive: ${err.message}` };
                    }
                }

                if (accion === 'buscar') {
                    const query = typeof safeArgs.query === 'string' ? safeArgs.query.trim() : '';
                    if (!query) return { success: false, error: 'Indica el nombre del archivo a buscar en Google Drive.' };
                    try {
                        const { searchFiles } = require('./drive');
                        const files = await searchFiles(query);
                        return {
                            success: true,
                            encontrados: files ? files.length : 0,
                            archivos: (files || []).slice(0, 8).map(f => ({ nombre: f.name, id: f.id, mime: f.mimeType }))
                        };
                    } catch (err) {
                        return { success: false, error: `Error buscando archivos en Google Drive: ${err.message}` };
                    }
                }

                return { success: false, error: `Acción no reconocida en drive: "${accion}"` };
            }

            // ── 7. DESCARGAR MULTIMEDIA ─────────────────────────────────────
            case 'descargar_multimedia': {
                const rawTarget = safeArgs.query_o_url || safeArgs.url || safeArgs.query;
                const target = typeof rawTarget === 'string' ? rawTarget.trim() : '';
                if (!target) return { success: false, error: 'Debes indicar el enlace o término de búsqueda a descargar.' };
                try {
                    const { handleDescargar } = require('../commands/descargar');
                    const formato = typeof safeArgs.formato === 'string' ? safeArgs.formato.toLowerCase().trim() : 'mp4';
                    const calidad = typeof safeArgs.calidad === 'string' ? safeArgs.calidad.trim() : '480';
                    const parsed = {
                        args: [target],
                        flags: {
                            f: formato,
                            q: calidad
                        },
                        raw: `descargar ${target}`
                    };
                    await handleDescargar(parsed, from, messageData);
                    return { success: true, formato, enviado_al_chat: true, mensaje: 'El archivo multimedia fue procesado y enviado al chat.' };
                } catch (err) {
                    return { success: false, error: `Error al procesar descarga multimedia: ${err.message}` };
                }
            }

            case 'enviar_archivo_contacto': {
                if (!isAdmin) return { success: false, error: 'Solo administradores pueden enviar a otros chats.' };
                return await require('../commands/enviarmedia').handleEnviarMedia({
                    raw: safeContext.userMessage || safeArgs.instruccion || '', aiArgs: safeArgs
                }, from, messageData);
            }

            // ── 8. SÍNTESIS DE VOZ (TTS) ────────────────────────────────────
            case 'sintetizar_voz': {
                const rawText = safeArgs.texto || safeArgs.text || safeArgs.mensaje;
                const texto = typeof rawText === 'string' ? rawText.trim() : '';
                const voz = typeof safeArgs.voz === 'string' ? safeArgs.voz.toLowerCase().trim() : 'hombre';
                try {
                    const { handleVoz } = require('../commands/voz');
                    const parsed = {
                        args: [texto],
                        flags: { voz },
                        raw: safeContext.userMessage || safeArgs.instruccion || '',
                        aiArgs: { destino_scope: 'current_chat', ...safeArgs, voz },
                        voiceContext: { history: safeContext.history || [], mediaContext: safeContext.mediaContext || null }
                    };
                    const result = await handleVoz(parsed, from, messageData);
                    return result || { success: false, error: 'No se confirmó la entrega del audio.' };
                } catch (err) {
                    return { success: false, error: `Error al sintetizar voz: ${err.message}` };
                }
            }

            // ── 9. JUEGOS Y ECONOMÍA ────────────────────────────────────────
            case 'juegos_y_economia': {
                const juego = (typeof safeArgs.juego === 'string' ? safeArgs.juego : 'daily').toLowerCase().trim();

                if (juego === 'daily') {
                    try {
                        const { handleDaily } = require('../commands/daily');
                        const result = await handleDaily({ args: [], flags: {} }, from, messageData, { sendConfirmation: false });
                        return { ...result, juego: 'daily' };
                    } catch (err) {
                        return { success: false, error: `Error al reclamar recompensa diaria: ${err.message}` };
                    }
                }

                if (juego === 'ruleta') {
                    let apuestaArgs = [];
                    const rawApuesta = safeArgs.apuesta !== undefined ? safeArgs.apuesta : (safeArgs.cantidad !== undefined ? safeArgs.cantidad : safeArgs.monto);
                    if (rawApuesta !== undefined && rawApuesta !== null && rawApuesta !== '') {
                        const numApuesta = Number(rawApuesta);
                        if (!Number.isInteger(numApuesta) || numApuesta <= 0) {
                            return { success: false, error: 'La apuesta debe ser un número entero positivo.' };
                        }
                        apuestaArgs = [String(numApuesta)];
                    }
                    try {
                        const { handleRuleta } = require('../commands/ruleta');
                        await handleRuleta({ args: apuestaArgs, flags: {} }, from, messageData);
                        return { success: true, juego: 'ruleta', apuesta: apuestaArgs[0] || 'por defecto', mensaje: 'Jugada de ruleta procesada' };
                    } catch (err) {
                        return { success: false, error: `Error al ejecutar ruleta: ${err.message}` };
                    }
                }

                if (juego === 'rank' || juego === 'top') {
                    try {
                        const { handleRank, handleTop } = require('../commands/niveles');
                        if (juego === 'top') {
                            await handleTop({ args: [], flags: {} }, from, messageData);
                        } else {
                            await handleRank({ args: [], flags: {} }, from, messageData);
                        }
                        return { success: true, juego, mensaje: 'Ranking enviado al chat' };
                    } catch (err) {
                        return { success: false, error: `Error al consultar niveles: ${err.message}` };
                    }
                }

                if (juego === 'darxp' || juego === 'xp') {
                    const rawCant = safeArgs.cantidad !== undefined ? safeArgs.cantidad : (safeArgs.monto !== undefined ? safeArgs.monto : safeArgs.apuesta);
                    const numCant = rawCant !== undefined && rawCant !== null ? Number(rawCant) : 1000;
                    if (!Number.isInteger(numCant) || numCant <= 0) {
                        return { success: false, error: 'La cantidad de XP debe ser un número entero positivo.' };
                    }
                    try {
                        const { handleDarXp } = require('../commands/niveles');
                        await handleDarXp({ args: [String(numCant)], flags: {}, aiArgs: { cantidad: numCant, target: safeArgs.target || safeArgs.usuario } }, from, messageData);
                        return { success: true, juego: 'darxp', cantidad: numCant, mensaje: `Otorgados ${numCant} XP` };
                    } catch (err) {
                        return { success: false, error: `Error al otorgar XP: ${err.message}` };
                    }
                }

                if (juego === 'nuclear') {
                    try {
                        const { handleNuclear } = require('../commands/nuclear');
                        await handleNuclear({ args: [], flags: {} }, from, messageData);
                        return { success: true, juego: 'nuclear', mensaje: 'Protocolo nuclear activado' };
                    } catch (err) {
                        return { success: false, error: `Error en protocolo nuclear: ${err.message}` };
                    }
                }

                return { success: false, error: `Juego desconocido: "${juego}"` };
            }

            // ── 10. AFINIDAD Y LORE ─────────────────────────────────────────
            case 'afinidad_y_lore': {
                const accion = (typeof safeArgs.accion === 'string' ? safeArgs.accion : 'afinidad').toLowerCase().trim();

                if (accion === 'afinidad') {
                    try {
                        const aff = await db.getUserAffinity(senderJid);
                        return {
                            success: true,
                            usuario: userName,
                            score: aff?.score || 0,
                            nivel: aff?.tier || 'Neutral',
                            sentimiento_reciente: aff?.last_reason || 'Sin incidentes'
                        };
                    } catch (err) {
                        return { success: false, error: `Error al consultar afinidad: ${err.message}` };
                    }
                }

                if (accion === 'lore') {
                    try {
                        const { handleLore } = require('../commands/lore');
                        await handleLore({ command: 'lore', args: [], flags: {} }, from, messageData);
                        return { success: true, mensaje: 'Crónica épica generada' };
                    } catch (err) {
                        return { success: false, error: `Error al generar crónica/lore: ${err.message}` };
                    }
                }

                return { success: false, error: `Acción social no reconocida: "${accion}"` };
            }

            // ── 11. CONTROL DE TELEVISIÓN ───────────────────────────────────
            case 'control_tv': {
                const canal = typeof safeArgs.canal === 'string' ? safeArgs.canal.trim() : 'futbol';
                try {
                    const { cambiarTele } = require('../commands/cambiarTV');
                    await cambiarTele({ args: [canal], flags: {} }, from, messageData);
                    return { success: true, canal, mensaje: `Canal cambiado a ${canal}` };
                } catch (err) {
                    return { success: false, error: `Error al cambiar canal de televisión: ${err.message}` };
                }
            }

            // ── 12. MENSAJE A CONTACTO ──────────────────────────────────────
            case 'enviar_mensaje_contacto': {
                if (!isAdmin) {
                    return { success: false, error: 'Acceso denegado: solo el creador y administradores autorizados pueden pedirle a Botsky enviar recados a otros contactos.' };
                }
                const contacto = typeof safeArgs.contacto === 'string' ? safeArgs.contacto.trim() : '';
                const mensaje = typeof safeArgs.mensaje === 'string' ? safeArgs.mensaje.trim() : '';
                try {
                    const { handleMensaje } = require('../commands/mensaje');
                    return await handleMensaje({ aiArgs: { ...safeArgs, contacto, mensaje } }, from, messageData);
                } catch (err) {
                    return { success: false, error: `Error enviando recado a contacto: ${err.message}` };
                }
            }

            default:
                return { success: false, error: `Herramienta "${name}" no está registrada en el sistema.` };
        }
    } catch (err) {
        let detail = 'Argumentos de herramienta inválidos.';
        try { const message = err && Object.getOwnPropertyDescriptor(err,'message')?.value; if (typeof message === 'string') detail = message; } catch (_) {}
        logger.error(`[TOOL-ERROR] Error ejecutando herramienta "${name}":`, detail);
        return { success: false, error: `Fallo interno al ejecutar ${name}: ${detail}` };
    }
}

module.exports = {
    BOTSKY_TOOL_DECLARATIONS,
    getToolDeclarations,
    executeTool: (name, args, context) => {
        if (typeof process === 'undefined' || process.env.LEGACY_COMMAND_USAGE_ENABLED !== 'true') return executeTool(name, args, context);
        let safeArgs; let safeContext;
        try {
            safeArgs = args && typeof args === 'object' ? toolInput(args) : {};
            safeContext = context && typeof context === 'object' ? toolInput(context) : {};
        } catch (_) { return executeTool(name, args, context); }
        let operation;
        const run = () => operation || (operation = executeTool(name, args, context));
        try { return require('./commandUsageRuntime').trackTool(name, safeArgs, safeContext, run); }
        catch (_) { return run(); }
    }
};
