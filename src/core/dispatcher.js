'use strict';

const { parse, extractUrl } = require('../core/parser');
const { registerTask } = require('../services/scheduler');
const queue = require('../core/queue');
const logger = require('../services/logger');
const evolution = require('../services/evolution');
const sendText = (to, text) => evolution.sendText(to, text);
const sendTyping = (to) => evolution.sendTyping(to);
const sendRecording = (to) => evolution.sendRecording(to);
const descargarCmd = require('../commands/descargar');
const getSearchSession = (...args) => (descargarCmd.getSearchSession ? descargarCmd.getSearchSession(...args) : null);
const getDownloadSessionKey = (...args) => (descargarCmd.getDownloadSessionKey ? descargarCmd.getDownloadSessionKey(...args) : args[0]);
function localExtractAdultUrl(text) {
    if (!text || typeof text !== 'string') return null;
    const m = text.match(/(?:https?:\/\/)?(?:www\.)?(?:[a-zA-Z0-9-]+\.)?(?:xvideos\d*|pornhub\w*|xnxx\d*|redtube|youporn|spankbang|xhamster\d*|chaturbate|onlyfans|rule34|eporner|tnaflix|beeg|tube8|brazzers)\.[a-z0-9.]+(?:\/[^\s]*)?/i);
    if (!m) return null;
    let url = m[0].replace(/[.,;:!?)>"'«»“”‘’]+$/, '');
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    return url;
}
const extractAdultUrl = (text) => (descargarCmd.extractAdultUrl ? descargarCmd.extractAdultUrl(text) : localExtractAdultUrl(text));
const matchSelection = (text) => (descargarCmd.matchSelection ? descargarCmd.matchSelection(text) : null);
const ai = require('../services/ai');
const chatWithBotsky = (...args) => ai.chatWithBotsky(...args);
const defaultRouteWithAI = ai.routeWithAI;
const routeWithAIOutcome = async (...args) => {
    if (typeof ai.routeWithAI === 'function' && ai.routeWithAI !== defaultRouteWithAI) {
        const decision = await ai.routeWithAI(...args);
        return decision ? { ok: true, decision } : { ok: false, failure: { kind: 'unknown' } };
    }
    if (typeof ai.routeWithAIOutcome === 'function') return ai.routeWithAIOutcome(...args);
    const decision = await ai.routeWithAI(...args);
    return decision ? { ok: true, decision } : { ok: false, failure: { kind: 'unknown' } };
};
const { runUniversalAgent } = require('../services/agentEngine');
const { getHistory, addMessage } = require('../services/history');
const { isRegisteredCommand, getCommandHandler } = require('./commandRegistry');
const { isAuthorizedAdmin, getSenderJid, cleanJidNumber, normalizePhoneNumber } = require('./auth');
const { recordGroupActivity, maybeTriggerBurstIntervention } = require('../services/proactive');
const {
    getUserAffinityContext,
    adjustUserAffinity,
    canTriggerPrivateRevenge,
    recordPrivateRevenge,
    setUserDoxxedState,
    isUserDoxxed,
    addLoreEvent
} = require('../services/db');
const { generateMockDoxeo } = require('../commands/doxeo');
const { handlePendingContactChoice, getPendingContactContext } = require('../commands/mensaje');
const attachments = require('../services/attachmentContext');
const { publicAttachment } = require('../services/semanticRouting');
const { prepareContent } = require('../services/contentReader');
const { aiRoutingFailureMessage } = require('../services/operationFeedback');
const cooperachaCmd = require('../commands/cooperacha');
const hasActiveCooperacha = (...args) => (typeof cooperachaCmd?.hasActiveCooperacha === 'function' ? cooperachaCmd.hasActiveCooperacha(...args) : false);
const { cleanCategory } = require('../services/packImages');

function getAllAllowed() {
    const groupsNormal = process.env.ALLOWED_GROUPS_NORMAL ? process.env.ALLOWED_GROUPS_NORMAL.split(',').map(n => n.trim().replace(/@.*$/, '')).filter(Boolean) : [];
    const numbersNormal = process.env.ALLOWED_NUMBERS_NORMAL ? process.env.ALLOWED_NUMBERS_NORMAL.split(',').map(n => n.trim().replace(/@.*$/, '')).filter(Boolean) : [];
    const groupsAdmin = process.env.ALLOWED_GROUPS_ADMIN ? process.env.ALLOWED_GROUPS_ADMIN.split(',').map(n => n.trim().replace(/@.*$/, '')).filter(Boolean) : [];
    const numbersAdmin = process.env.ALLOWED_NUMBERS_ADMIN ? process.env.ALLOWED_NUMBERS_ADMIN.split(',').map(n => n.trim().replace(/@.*$/, '')).filter(Boolean) : [];
    const numbersTasks = process.env.ALLOWED_NUMBERS_TASKS ? process.env.ALLOWED_NUMBERS_TASKS.split(',').map(n => n.trim().replace(/@.*$/, '')).filter(Boolean) : [];
    return [...groupsNormal, ...numbersNormal, ...groupsAdmin, ...numbersAdmin, ...numbersTasks];
}

// Disabled by default: keep imports/mocks and behavior identical to baseline.
function observeCommandUsage(command, from, operation, options) {
    if (process.env.LEGACY_COMMAND_USAGE_ENABLED !== 'true') return operation();
    return require('../services/commandUsageRuntime').track(command, from, operation, options);
}

function getAllAdmins() {
    const groupsAdmin = process.env.ALLOWED_GROUPS_ADMIN ? process.env.ALLOWED_GROUPS_ADMIN.split(',').map(n => n.trim().replace(/@.*$/, '')).filter(Boolean) : [];
    const numbersAdmin = process.env.ALLOWED_NUMBERS_ADMIN ? process.env.ALLOWED_NUMBERS_ADMIN.split(',').map(n => n.trim().replace(/@.*$/, '')).filter(Boolean) : [];
    return [...groupsAdmin, ...numbersAdmin];
}

const ADULT_URL_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:[a-zA-Z0-9-]+\.)?(?:xvideos\d*|pornhub\w*|xnxx\d*|redtube|youporn|spankbang|xhamster\d*|chaturbate|onlyfans|rule34|eporner|tnaflix|beeg|tube8|brazzers)\.[a-z0-9.]+/i;
const ADULT_KEYWORDS_REGEX = /\b(?:nopor(?:sito|cito)?|porno|porn|xxx|hentai|milf|teen|chichis|tetas|culonas?|chichonas?|tetonas?|anal|creampie|blowjob|erotico|erotica|eroticos|eroticas|erótico|erótica|sensual|xvideos|pornhub|xnxx|redtube|onlyfans|rule34|pajero|paja|cochinadas?)\b/i;
const DOWNLOAD_VERBS_REGEX = /\b(?:desc[aá]rga\w*|b[aá]ja\w*|t[uú]mba\w*|p[aá]sa\w*|m[aá]nda\w*|dame|dl)\b/i;
const SEARCH_VERBS_REGEX = /\b(?:b[uú]sca\w*|encuentra\w*|p[oó]n\w*|ver|quiero|video\w*|clip\w*|pel[ií]cula\w*|peli\b)\b/i;

function isAdultIntent(rawText, activeSession = null) {
    if (activeSession && activeSession.isAdult && matchSelection(rawText)) return true;
    if (!rawText || typeof rawText !== 'string') return false;
    const text = rawText.trim();
    if (ADULT_URL_REGEX.test(text)) return true;
    if (ADULT_KEYWORDS_REGEX.test(text)) {
        if (DOWNLOAD_VERBS_REGEX.test(text) || SEARCH_VERBS_REGEX.test(text)) return true;
        const clean = text
            .replace(/@[^\s,]+\s*/g, '')
            .replace(/^(?:(?:oye\s+)?(?:compa\s+|bot\s+|botsky\s+|botsito\s+)[,\s]*)/i, '')
            .trim();
        if (/^(?:(?:un|una|el|la)\s+)?(?:porno|nopor|hentai|xxx|xvideos|pornhub|xnxx|redtube|milf|teen|chichis|tetas|culonas?|chichonas?|tetonas?|anal|creampie|blowjob|cochinadas?)\b/i.test(clean)) return true;
    }
    return false;
}

const chatCooldowns = new Map();
const groupCasualCounters = new Map();

class ConcurrencyLimiter {
    constructor(maxConcurrent = 3) {
        this.maxConcurrent = maxConcurrent;
        this.running = 0;
        this.queue = [];
    }

    async run(fn) {
        if (this.running >= this.maxConcurrent) {
            await new Promise(resolve => this.queue.push(resolve));
        }
        this.running++;
        try {
            return await fn();
        } finally {
            this.running--;
            if (this.queue.length > 0) {
                const next = this.queue.shift();
                next();
            }
        }
    }

    get activeCount() {
        return this.running;
    }

    get pendingCount() {
        return this.queue.length;
    }
}

const aiLimiter = new ConcurrencyLimiter(parseInt(process.env.MAX_AI_CONCURRENCY || '3', 10));


// Limpieza periódica coordinada de cooldowns (PERF-2)
registerTask('dispatcher-cooldowns', 5, () => {
    const now = Date.now();
    for (const [key, time] of chatCooldowns.entries()) {
        if (now - time > 60000) chatCooldowns.delete(key);
    }
});

/**
 * Mapea los argumentos estructurados devueltos por Gemini a flags y argumentos posicionales esperados por los comandos.
 */
async function applyAiArgsToParsed(parsed, args, downloadSessionKey, from) {
    if (!args || typeof args !== 'object') return true;
    parsed.aiArgs = { ...args };

    // Formato y calidad
    if (args.formato) parsed.flags.f = args.formato;
    if (args.calidad) parsed.flags.q = args.calidad;
    if (args.bitrate !== undefined && args.bitrate !== null) {
        parsed.flags.bitrate = args.bitrate;
        parsed.flags.b = args.bitrate;
    }

    // Tiempos de corte
    if (args.ss) parsed.flags.ss = args.ss;
    if (args.to) parsed.flags.to = args.to;

    // Velocidad de reproducción
    if (args.velocidad !== undefined && args.velocidad !== null) {
        parsed.flags.speed = args.velocidad;
        parsed.flags.v = args.velocidad;
    }

    // Flags booleanas
    if (args.animado) {
        parsed.flags.a = true;
        parsed.flags.animado = true;
    }
    if (args.recortar) {
        parsed.flags.r = true;
        parsed.flags.recortar = true;
    }
    if (args.adult) {
        parsed.flags.adult = true;
        parsed.flags.nopor = true;
    }
    if (args.subtitulos) {
        parsed.flags.s = true;
        parsed.flags.subtitulos = true;
    }
    if (args.comoDocumento) {
        parsed.flags.c = true;
        parsed.flags.comoDocumento = true;
    }
    if (args.zip) parsed.flags.zip = true;
    if (args.terminar) {
        parsed.flags.terminar = true;
        parsed.args = ['terminar'];
    }
    if (args.flac) parsed.flags.flac = true;

    // Parámetros de documentos
    if (args.paginas) {
        parsed.flags.pages = args.paginas;
        parsed.flags.p = args.paginas;
        parsed.flags.paginas = args.paginas;
    }
    if (args.nombre) {
        parsed.flags.name = args.nombre;
        parsed.flags.n = args.nombre;
    }

    // Redirección inteligente: si Gemini clasificó como 'doc' con páginas para un PDF, convertir a 'recortarpdf'

    // Recorte de PDFs
    if (['recortar', 'recortarpdf', 'cortar', 'cortarpdf', 'extraerpdf'].includes(parsed.command)) {
        if (args.paginas && parsed.args.length === 0) {
            parsed.args = [String(args.paginas)];
        }
    }

    // Efectos de voz
    if (args.tipo) {
        parsed.args = [args.tipo];
    }

    // Minecraft Bedrock (Fase 2)
    if (['maicra', 'mc', 'minecraft', 'mine', 'server'].includes(parsed.command)) {
        const sub = args.subcomando || args.accion || args.action;
        if (sub) {
            parsed.args = [String(sub).trim()];
            const extra = args.mod || args.parametro || args.query || args.texto || (args.comando && args.comando !== sub ? args.comando : null);
            if (extra) {
                parsed.args.push(String(extra).trim());
            }
        } else if (parsed.raw && parsed.raw.trim()) {
            parsed.args = [parsed.raw.trim()];
        }
    }

    // Terminal
    if (['terminal', 'bash', 'cmd', 'sh', 'agente'].includes(parsed.command)) {
        if (args.comando || args.prompt || args.consulta) {
            const cmdVal = args.comando || args.prompt || args.consulta;
            parsed.args = [String(cmdVal).trim()];
        } else if (parsed.raw && parsed.raw.trim()) {
            // En lenguaje natural: si el router no extrajo un comando específico, usar parsed.raw
            // para que no se pierda el verbo inicial ni la orden general (ej: "reinicia...", "apaga...", "checa...")
            parsed.args = [parsed.raw.trim()];
        }
    }

    // Conversión de formatos y extracción de audio
    if (['convertir', 'cv'].includes(parsed.command)) {
        const fmt = args.formato || args.format || parsed.flags.f || 'mp3';
        parsed.flags.f = fmt;
        parsed.flags.formato = fmt;
    }

    // Google Drive
    if (args.accion || args.action) {
        const act = args.accion || args.action;
        parsed.flags.accion = act;
        parsed.args = [act];
    }

    // Encuestas generadas por IA: conservar pregunta y opciones estructuradas.
    if (parsed.command === 'encuesta' || parsed.command === 'poll' || parsed.command === 'votacion') {
        const question = args.pregunta || args.question;
        const options = args.opciones || args.options;
        if (question) parsed.flags.pregunta = String(question).slice(0, 300);
        if (Array.isArray(options)) parsed.flags.opciones = options.map(option => String(option).slice(0, 120));
        if (question && Array.isArray(options)) parsed.args = ['crear'];
        const choice = args.opcion ?? args.option;
        if (choice !== undefined && choice !== null) parsed.flags.opcion = choice;
    }

    if (['tarea', 'tareas', 'deberes'].includes(parsed.command)) {
        const taskAction = args.accion || args.action;
        const subject = args.materia || args.subject;
        const title = args.titulo || args.title || args.mensaje;
        const due = args.fecha || args.entrega || args.due;
        if (taskAction === 'grupo' && (args.grupo || args.group)) {
            parsed.args = ['grupo', String(args.grupo || args.group)];
        } else if (taskAction === 'horas' && args.hora1 && args.hora2) {
            parsed.args = ['horas', String(args.hora1), String(args.hora2)];
        } else if (taskAction) parsed.args = [String(taskAction)];
        if (args.horario) parsed.flags.horario = String(args.horario).slice(0, 4000);
        if (subject && title && due) {
            parsed.args = ['crear', subject, title, due];
            if (args.detalles || args.details) parsed.args.push(args.detalles || args.details);
        }
    }

    // Código QR y Notas de voz
    if (args.texto) {
        parsed.args = [args.texto];
    }
    if (args.voz || args.voice) {
        parsed.flags.voz = args.voz || args.voice;
        const v = String(args.voz || args.voice).toLowerCase();
        if (v === 'loquendo' || v === 'jorge') parsed.flags.loquendo = true;
        else if (v === 'dross' || v === 'drossrotzank') parsed.flags.dross = true;
        else if (v === 'luisito' || v === 'luis' || v === 'luisitocomunica') parsed.flags.luisito = true;
        else if (v === 'goku') parsed.flags.goku = true;
        else if (v === 'babidi') parsed.flags.babidi = true;
        else if (v === 'donramon' || v === 'ramon' || v === 'monchito') parsed.flags.donramon = true;
        else if (v === 'anime' || v === 'waifu' || v === 'loli' || v === 'monachina' || v === 'cute') parsed.flags.anime = true;
        else if (v === 'mujer' || v === 'chica' || v === 'female' || v === 'morra' || v === 'reels') {
            parsed.flags.m = true;
            parsed.flags.mujer = true;
        }
    }

    // Mensajes a contactos / Recordatorios y Alarmas
    if (args.contacto || args.destinatario || args.nombre) {
        parsed.flags.contacto = args.contacto || args.destinatario || args.nombre;
    }
    if (args.mensaje) {
        parsed.flags.mensaje = args.mensaje;
        parsed.flags.texto = args.mensaje;
    }
    if (args.tiempo) {
        parsed.flags.tiempo = args.tiempo;
    }
    if (args.minutos !== undefined && args.minutos !== null) {
        parsed.flags.minutos = args.minutos;
    }
    if (args.id !== undefined && args.id !== null) {
        parsed.flags.id = args.id;
        if (!parsed.args.includes(String(args.id))) parsed.args.push(String(args.id));
    }

    // Transcripción / Resumen de voz
    if (args.resumir || args.resumen) {
        parsed.flags.resumir = true;
        parsed.flags.resumen = true;
    }

    // Ruleta Rusa
    if (args.apuesta !== undefined && args.apuesta !== null) {
        parsed.flags.apuesta = args.apuesta;
        if (!parsed.args.length) parsed.args = [String(args.apuesta)];
    }

    // Cooperacha de XP
    if (['cooperacha', 'coop', 'coperacha', 'vaquita', 'reto', 'destapar', 'cooperar', 'aportar'].includes(parsed.command)) {
        const val = args.cantidad ?? args.meta ?? args.monto ?? args.xp ?? args.apuesta;
        if (val !== undefined && val !== null && !parsed.args.length) {
            parsed.args = [String(val)];
        }
    }

    // Mercado Negro / Packs de XP
    if (['pack', 'packs', 'mercadonegro', 'comprarpack'].includes(parsed.command)) {
        const cat = args.categoria ?? args.category ?? args.tema ?? args.query;
        if (cat && !parsed.args.length) {
            parsed.args = [String(cat)];
        }
    }

    // Hora Feliz
    if (['horafeliz', 'happyhour', 'hf'].includes(parsed.command)) {
        const accion = (args.accion || args.action || args.subcomando || '').toLowerCase();
        if (accion === 'iniciar' || accion === 'on' || accion === 'activar' || accion === 'prender') {
            parsed.args = ['on'];
            const dur = args.duracion ?? args.duration ?? args.minutos ?? args.tiempo;
            if (dur) parsed.args.push(String(dur));
        } else if (accion === 'apagar' || accion === 'off' || accion === 'detener' || accion === 'desactivar') {
            parsed.args = ['off'];
        } else if (accion === 'estado' || accion === 'status' || accion === 'info') {
            parsed.args = ['status'];
        } else if (accion === 'airdrop' || accion === 'drop') {
            parsed.args = ['airdrop'];
        } else if (accion === 'lluvia' || accion === 'rain') {
            parsed.args = ['lluvia'];
        }
    }

    // Notas compartidas
    if (args.contenido || args.nota) {
        const c = args.contenido || args.nota;
        parsed.flags.contenido = c;
        if (!parsed.args.length || parsed.args[0] === 'guardar') {
            parsed.args = ['guardar', c];
        }
    }

    // Otorgar experiencia (Admin)
    if (args.cantidad !== undefined || args.xp !== undefined || args.amount !== undefined) {
        const cant = args.cantidad ?? args.xp ?? args.amount;
        parsed.args = [String(cant)];
    }

    // Control de TV
    if (args.canal) {
        parsed.args = [args.canal];
    }

    // Lore / Canon / Crónica / Moderación
    if (args.user) {
        parsed.args = [args.user];
        if (args.reason) parsed.args.push(args.reason);
    } else if (args.reason && parsed.args.length > 0) {
        parsed.args.push(args.reason);
    }

    // URL y Query / Búsqueda flexible (admite query, busqueda, tema, video, cancion, search)
    const searchVal = args.query || args.busqueda || args.tema || args.video || args.cancion || args.search || args.consulta;
    if (['difusion', 'difundir', 'broadcast'].includes(parsed.command)) {
        if (args.mensaje) parsed.args = [String(args.mensaje).trim()];
        if (args.roast) parsed.flags.roast = true;
    } else if (['mensaje', 'recado', 'dile', 'mandale', 'escribele'].includes(parsed.command)) {
        const c = args.contacto || args.destinatario || args.nombre || parsed.flags.contacto;
        const m = args.mensaje || args.texto || args.recado || parsed.flags.mensaje;
        parsed.args = [];
        if (c) {
            parsed.flags.contacto = String(c).trim();
            parsed.args.push(String(c).trim());
        }
        if (m) {
            parsed.flags.mensaje = String(m).trim();
            parsed.args.push(String(m).trim());
        }
        if (args.anonimo) parsed.flags.anonimo = true;
    } else if (args.url) {
        parsed.args = [args.url];
    } else if (searchVal) {
        parsed.args = [String(searchVal).trim()];
    }

    // Selección de lista de búsqueda activa
    if (args.selection) {
        if (parsed.command === 'descargardrive') {
            parsed.args = [String(args.selection)];
        } else if (parsed.command === 'descargar' || parsed.command === 'bajar') {
            const sess = getSearchSession(downloadSessionKey);
            if (sess) {
                const sIdx = parseInt(args.selection, 10) - 1;
                if (sIdx >= 0 && sIdx < sess.results.length) {
                    const selItem = sess.results[sIdx];
                    sess.timestamp = Date.now();
                    parsed.args = [selItem.url];
                    if (sess.isAdult) {
                        parsed.flags.adult = true;
                        parsed.flags.nopor = true;
                    }
                    logger.info(`[AI-SELECT] ${from} seleccionó #${args.selection}: "${selItem.title}"`);
                } else {
                    await sendText(from, `Ese número no está en la lista, por favor escoge del 1 al ${sess.results.length}.`);
                    return false;
                }
            } else {
                await sendText(from, `No hay ninguna lista de videos activa compa (o ya expiró). Pídeme una búsqueda primero, ej: *descarga video de [tema]*`);
                return false;
            }
        }
    }

    return true;
}

async function dispatch(context) {
    // Guard: Evolution API envía webhooks de sistema (delivery receipts, status broadcasts,
    // typing indicators) que llegan con context malformado o sin campo remitente.
    // Validar shape estrictamente antes de destructurar para evitar TypeError.
    if (!context || typeof context !== 'object') return;

    let { text } = context;
    let { from, messageType } = context;
    let messageData = context.messageData || context.actualMessageData;

    // Coerción defensiva: si from existe pero vale undefined explícito, los fallbacks
    // también pueden ser undefined — por eso se valida el tipo antes de asignar.
    from = (typeof from === 'string' && from)
        || (typeof context.remoteJid === 'string' && context.remoteJid)
        || (typeof context.sender === 'string' && context.sender)
        || '';

    // Descartar silenciosamente webhooks sin remitente identificable (sistema/receipt/status)
    if (!from) {
        logger.warn(`[DISPATCH] Webhook sin remitente descartado. tipo=${messageType || 'desconocido'}`);
        return;
    }

    const isGroup = typeof from === 'string' && from.endsWith('@g.us');

    // 1. Verificar seguridad general (whitelist)
    const participant = messageData?.key?.participant || messageData?.participant || context.participant || from;
    const allAllowed = getAllAllowed();
    if (allAllowed.length > 0) {
        const normFrom = normalizePhoneNumber(cleanJidNumber(from));
        const normPart = normalizePhoneNumber(cleanJidNumber(participant));
        const isWhitelisted = allAllowed.some(id => {
            const cleanId = id.replace(/[^0-9]/g, '');
            const normId = normalizePhoneNumber(cleanId);
            return (from || '').includes(id) ||
                   (participant || '').includes(id) ||
                   (normFrom && normId && normFrom === normId) ||
                   (normPart && normId && normPart === normId);
        });
        if (!isWhitelisted) {
            logger.warn(`Acceso denegado a ${from}`);
            return;
        }
    }

    // A bare upload is still a request context; Gemini decides whether to ask or act.
    if (!text && !messageData?.message && !context.attachment) return;
    text = typeof text === 'string' ? text : '';
    // 3. Sistema Anti-Spam / Cooldown
    const now = Date.now();
    const cooldownKey = isGroup ? `${from}_${participant}` : from;
    const isAdmin = isAuthorizedAdmin(from, messageData);
    const cooldownMs = isGroup ? 1500 : 800; // 1.5 segs en grupos, 800ms en privado
    const lastTime = chatCooldowns.get(cooldownKey) || 0;

    if (!isAdmin && now - lastTime < cooldownMs) {
        logger.warn(`Spam detectado en ${cooldownKey}, ignorando petición`);
        return;
    }
    chatCooldowns.set(cooldownKey, now);

    const downloadSessionKey = getDownloadSessionKey(from, messageData);
    const activeSession = getSearchSession(downloadSessionKey);
    // 5. Parseo básico de entrada
    const parsed = parse(text || "adjunto recibido");
    if (parsed && !text) parsed.raw = "";
    if (!parsed) return;

    let cmdToSwitch = parsed.command.replace(/^[\/@!#]+/, '');
    parsed.command = cmdToSwitch;

    const userName = messageData?.pushName || 'Compa';
    const contextInfo = messageData?.message?.extendedTextMessage?.contextInfo ||
                        messageData?.contextInfo ||
                        messageData?.message?.[messageType]?.contextInfo;
    const quotedMsg = contextInfo?.quotedMessage;
    const quotedText = quotedMsg?.conversation || quotedMsg?.extendedTextMessage?.text || '';
    const chatHistory = getHistory(from, 8);

    // Detectar si el usuario le está respondiendo directamente a un mensaje de Botsky
    const botNumber = (process.env.BOT_NUMBER || '5214437367565').replace(/[^0-9]/g, '');
    const quotedParticipant = (contextInfo?.participant || '').replace(/[^0-9]/g, '');
    const isQuotingBotsky = Boolean(
        (quotedParticipant && botNumber && quotedParticipant.includes(botNumber)) ||
        (quotedText && chatHistory.some(m => m.role === 'assistant' && (
            (m.content && m.content.includes(quotedText.slice(0, 30))) ||
            (quotedText && quotedText.includes((m.content || '').slice(0, 30)))
        )))
    );

    const quotePrefix = isQuotingBotsky
        ? `(respondiendo directamente a un mensaje previo de Botsky: "${quotedText.slice(0, 80).replace(/\n/g, ' ')}") `
        : (quotedText ? `(respondiendo a: "${quotedText.slice(0, 80).replace(/\n/g, ' ')}") ` : '');

    let userMsgWithContext = `${quotePrefix}${parsed.raw}`.trim();

    let contentIntent = { intent: 'unknown', operation: null };
    const mediaMessage = messageData?.message?.[messageType];
    let mediaContext = ['audioMessage', 'imageMessage', 'videoMessage', 'documentMessage'].includes(messageType) ? {
        type: messageType,
        mimetype: mediaMessage?.mimetype || '',
        fileName: mediaMessage?.fileName || '',
        attachmentId: context.attachment?.id || messageData?.key?.id || messageData?.quotedStanzaId || ''
    } : null;

    const prepareConversationContent = async () => {
        if (!mediaContext || !/^(?:image|document)/i.test(messageType) || mediaContext.base64 || mediaContext.extractedText) return true;
        const prepared = await aiLimiter.run(() => prepareContent({ messageData, messageType }));
        if (!prepared.success) {
            await sendText(from, prepared.question || prepared.error || 'No pude leer el archivo. Vuelve a enviarlo.');
            return false;
        }
        mediaContext = { ...prepared.mediaContext, contentIntent: contentIntent.intent, attachmentSource: context.attachment?.source || 'current' };
        return true;
    };

    // Ingesta inmediata en historial (Memoria pasiva a costo cero para que Botsky siempre recuerde)
    addMessage(from, 'user', userMsgWithContext, userName);
    if (isGroup) {
        recordGroupActivity(from, participant, text);
    }

    const hasExplicitPrefix = Boolean(context.hasPrefix || parsed.hasPrefix);
    let affinityContext = '';
    const mentions = Array.isArray(contextInfo?.mentionedJid) ? contextInfo.mentionedJid : [];
    const isMentioned = mentions.some(jid => normalizePhoneNumber(cleanJidNumber(jid)) === normalizePhoneNumber(botNumber));
    let isDirectlyAddressed = !isGroup;
    const isExplicitCommand = hasExplicitPrefix && !context.isTaskDirectCommand && isRegisteredCommand(cmdToSwitch);

    if (!isExplicitCommand) {
        // R1. Fast-Path Pre-LLM para Adultos y Sitios para Adultos
        const isDirectlyAddressedInGroup = isMentioned ||
            isQuotingBotsky ||
            hasExplicitPrefix ||
            /\b(?:botsky|bot|botsito)\b/i.test(parsed.raw || '') ||
            Boolean(activeSession && matchSelection(parsed.raw));
        // Fast-Path para Cooperacha de XP en grupos
        const coopText = (parsed.raw || '').trim()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/^(?:oye\s+)?@?(?:botsky|bot|botsito)\b[,\s]*/i, '')
            .replace(/[.!?]+$/, '').trim();
        const coopContributeMatch = isGroup && hasActiveCooperacha(from)
            ? coopText.match(/^(?:(?:le\s+)?meto|(?:le\s+)?pongo|aporto|coopero|coop|vaquita)\s+(\d+)/i)
            : null;

        const coopStartMatch = isGroup
            ? coopText.match(/^(?:(?:inicia(?:r)?|abre|abrir|arma(?:r)?|empieza|empezar|haz|hacer)\s+)?(?:(?:la|una)\s+)?(?:cooperacha|coperacha|cooperacion|vaquita|reto\s+de\s+foto)(?:\s+(\d+)(?:\s*xp)?)?$/i) ||
                coopText.match(/^(?:echate|saca|tira|manda(?:me|nos)?|envia(?:me|nos)?|pasa(?:me|nos)?|pon|dame|quiero)\s+(?:(?:una|la)\s+)?(?:foto|fotito|fotita|imagen)\s+censurada(?:\s+(?:para\s+juntar|por|de)\s+(\d+)(?:\s*xp)?)?$/i)
            : null;

        if (coopContributeMatch) {
            logger.info(`[FAST-PATH-COOPERACHA] Aporte natural detectado en grupo: "${parsed.raw}"`);
            cmdToSwitch = 'coop';
            parsed.command = 'coop';
            parsed.args = [coopContributeMatch[1]];
        } else if (coopStartMatch && (isDirectlyAddressedInGroup || !hasExplicitPrefix)) {
            logger.info(`[FAST-PATH-COOPERACHA] Inicio de cooperacha natural detectado en grupo: "${parsed.raw}"`);
            cmdToSwitch = 'cooperacha';
            parsed.command = 'cooperacha';
            // Con una sesión activa, pedir otra foto muestra el reto existente;
            // la meta de la solicitud nunca se interpreta como una aportación.
            parsed.args = hasActiveCooperacha(from) ? ['estado'] :
                (coopStartMatch[1] ? [coopStartMatch[1]] : []);
        } else if (
            // Fast-Path para Mercado Negro / Packs de fotos por XP (R1)
            (parsed.raw || '').trim().match(/^(?:(?:oye\s+)?@?(?:botsky|bot|botsito)[,\s]*)?(?:(?:me\s+)?v[eé]nde(?:me|nos|s|r)?|(?:te\s+)?compr(?:ar?|o)|quiero(?:\s+comprar)?|(?:me\s+)?p[aá]sa(?:me|s)?|(?:me\s+)?m[aá]nda(?:me|s)?|(?:me\s+)?r[oó]la(?:me|s)?|dame|(?:me\s+)?das|saca|tira|tienes)\s+(?:(?:un|el|los|unos)\s+)?packs?\b(?:[,\s]+(?:de\s+)?([^.!?\r\n]+?))?[.!?\s]*$/i) ||
            (!isGroup && /^(?:(?:(?:un|el|los|unos)\s+)?packs?)\b(?:[,\s]+(?:de\s+)?([^.!?\r\n]+?))?[.!?\s]*$/i.test((parsed.raw || '').trim()))
        ) {
            const packMatch = (parsed.raw || '').trim().match(/^(?:(?:oye\s+)?@?(?:botsky|bot|botsito)[,\s]*)?(?:(?:me\s+)?v[eé]nde(?:me|nos|s|r)?|(?:te\s+)?compr(?:ar?|o)|quiero(?:\s+comprar)?|(?:me\s+)?p[aá]sa(?:me|s)?|(?:me\s+)?m[aá]nda(?:me|s)?|(?:me\s+)?r[oó]la(?:me|s)?|dame|(?:me\s+)?das|saca|tira|tienes)\s+(?:(?:un|el|los|unos)\s+)?packs?\b(?:[,\s]+(?:de\s+)?([^.!?\r\n]+?))?[.!?\s]*$/i) ||
                (!isGroup ? (parsed.raw || '').trim().match(/^(?:(?:(?:un|el|los|unos)\s+)?packs?)\b(?:[,\s]+(?:de\s+)?([^.!?\r\n]+?))?[.!?\s]*$/i) : null);
            logger.info(`[FAST-PATH-PACK] Solicitud de pack detectada: "${parsed.raw}"`);
            cmdToSwitch = 'pack';
            parsed.command = 'pack';
            const rawCat = packMatch && packMatch[1] ? packMatch[1].trim() : null;
            const cat = typeof cleanCategory === 'function' ? cleanCategory(rawCat) : (rawCat ? rawCat.replace(/^de\s+/i, '').trim() : null);
            parsed.args = cat ? [cat] : [];
        } else if (
            // Fast-Path para Hora Feliz (R5)
            (() => {
                const hfClean = (parsed.raw || '').trim()
                    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                    .replace(/^(?:oye\s+)?@?(?:botsky|bot|botsito)\b[,\s]*/i, '')
                    .replace(/[.!?]+$/, '').trim();
                return /^(?:(?:inicia(?:r)?|activa(?:r)?|prende(?:r)?|abre|abrir|pon(?:er)?)\s+)?(?:la\s+)?(?:hora\s+feliz|happy\s*hour)(?:\s+(\d+)(?:\s*(?:minutos?|min|m))?)?$/i.test(hfClean) ||
                       /^(?:(?:hora\s+feliz|happy\s*hour)\s+(?:on|iniciar|activar))(?:\s+(\d+)(?:\s*(?:minutos?|min|m))?)?$/i.test(hfClean) ||
                       /^(?:(?:apaga(?:r)?|deten(?:er)?|desactiva(?:r)?|cancela(?:r)?|cierra|cerrar|termina(?:r)?)\s+)(?:la\s+)?(?:hora\s+feliz|happy\s*hour)$/i.test(hfClean) ||
                       /^(?:(?:hora\s+feliz|happy\s*hour)\s+(?:off|apagar|detener|cancelar))$/i.test(hfClean) ||
                       /^(?:(?:hay|como\s+va|cuanto\s+queda|tiempo\s+de|estado\s+de|que\s+onda\s+con)\s+)?(?:la\s+)?(?:hora\s+feliz|happy\s*hour)(?:\s+(?:activa|status|estado))?\??$/i.test(hfClean) ||
                       /^(?:(?:hora\s+feliz|happy\s*hour)\s+(?:status|estado|info))\??$/i.test(hfClean) ||
                       /^(?:(?:suelta|tira|lanza|avienta|manda|haz|activa|dame)\s+(?:un\s+)?airdrop|airdrop)$/i.test(hfClean) ||
                       /^(?:(?:suelta|tira|lanza|avienta|manda|haz)\s+(?:la\s+)?lluvia|lluvia(?:\s+de\s+media)?)$/i.test(hfClean);
            })() && (isDirectlyAddressedInGroup || !hasExplicitPrefix || !isGroup)
        ) {
            const hfClean = (parsed.raw || '').trim()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .replace(/^(?:oye\s+)?@?(?:botsky|bot|botsito)\b[,\s]*/i, '')
                .replace(/[.!?]+$/, '').trim();
            const hfAirdropMatch = /^(?:(?:suelta|tira|lanza|avienta|manda|haz|activa|dame)\s+(?:un\s+)?airdrop|airdrop)$/i.test(hfClean);
            const hfRainMatch = /^(?:(?:suelta|tira|lanza|avienta|manda|haz)\s+(?:la\s+)?lluvia|lluvia(?:\s+de\s+media)?)$/i.test(hfClean);
            const hfStartMatch = hfClean.match(/^(?:(?:inicia(?:r)?|activa(?:r)?|prende(?:r)?|abre|abrir|pon(?:er)?)\s+)?(?:la\s+)?(?:hora\s+feliz|happy\s*hour)(?:\s+(\d+)(?:\s*(?:minutos?|min|m))?)?$/i) ||
                                 hfClean.match(/^(?:(?:hora\s+feliz|happy\s*hour)\s+(?:on|iniciar|activar))(?:\s+(\d+)(?:\s*(?:minutos?|min|m))?)?$/i);
            const hfStopMatch = hfClean.match(/^(?:(?:apaga(?:r)?|deten(?:er)?|desactiva(?:r)?|cancela(?:r)?|cierra|cerrar|termina(?:r)?)\s+)(?:la\s+)?(?:hora\s+feliz|happy\s*hour)$/i) ||
                                hfClean.match(/^(?:(?:hora\s+feliz|happy\s*hour)\s+(?:off|apagar|detener|cancelar))$/i);

            cmdToSwitch = 'horafeliz';
            parsed.command = 'horafeliz';
            if (hfAirdropMatch) {
                logger.info(`[FAST-PATH-HORAFELIZ] AirDrop detectado: "${parsed.raw}"`);
                parsed.args = ['airdrop'];
            } else if (hfRainMatch) {
                logger.info(`[FAST-PATH-HORAFELIZ] Lluvia detectada: "${parsed.raw}"`);
                parsed.args = ['lluvia'];
            } else if (hfStopMatch) {
                logger.info(`[FAST-PATH-HORAFELIZ] Apagado detectado: "${parsed.raw}"`);
                parsed.args = ['off'];
            } else if (hfStartMatch) {
                logger.info(`[FAST-PATH-HORAFELIZ] Inicio detectado: "${parsed.raw}"`);
                parsed.args = ['on'];
                if (hfStartMatch[1]) parsed.args.push(hfStartMatch[1]);
            } else {
                logger.info(`[FAST-PATH-HORAFELIZ] Consulta de estado detectada: "${parsed.raw}"`);
                parsed.args = ['status'];
            }
        } else if (isAdultIntent(parsed.raw, activeSession) && (!isGroup || isDirectlyAddressedInGroup)) {
            logger.info(`[FAST-PATH-ADULT] Solicitud para adultos detectada, redirigiendo directo a descargar sin consultar IA: "${parsed.raw}"`);
            cmdToSwitch = 'descargar';
            parsed.command = 'descargar';
            parsed.flags = parsed.flags || {};
            parsed.flags.adult = true;
            parsed.flags.nopor = true;

            if (!parsed.flags.f && !parsed.flags.formato) {
                if (/\b(?:mp3|audio)\b/i.test(parsed.raw)) {
                    parsed.flags.f = 'mp3';
                } else if (/\b(?:mp4)\b/i.test(parsed.raw)) {
                    parsed.flags.f = 'mp4';
                }
            }

            const adultUrl = extractUrl(parsed.raw) || extractAdultUrl(parsed.raw);
            if (adultUrl) {
                parsed.args = [adultUrl];
            } else {
                let cleanQuery = parsed.raw
                    .replace(/@[^\s,]+\s*/g, '')
                    .replace(/^(?:(?:oye\s+)?(?:compa\s+|bot\s+|botsky\s+|botsito\s+)[,\s]*)/i, '')
                    .replace(/^(?:b[uú]sca(?:me)?|buscar|desc[aá]rga(?:me|te)?|descargar|b[aá]ja(?:me|te)?|bajar|p[aá]sa(?:me|te)?|pasar|t[uú]mba(?:te|me)?|tumbar|quiero(?:\s+ver)?|p[oó]n(?:me|te)?|dame|m[aá]nda(?:me|te)?|enseña(?:me)?|encuentra|ver|videos?\s+de|video\s+de|videos?)\s+/i, '')
                    .trim();
                cleanQuery = cleanQuery.replace(/\s+(?:en\s+|a\s+|como\s+)?(?:mp3|audio|mp4|video)\s*$/i, '').trim();
                parsed.args = [cleanQuery || parsed.raw];
            }
        } else {
            const senderJid = getSenderJid(from, messageData);
            const rawParticipant = messageData?.key?.participant || messageData?.participant;
            const altJid = (senderJid && rawParticipant && senderJid !== rawParticipant) ? rawParticipant : null;
            const isSenderAdmin = isAuthorizedAdmin(from, messageData);
            try {
                affinityContext = await getUserAffinityContext(senderJid, userName, altJid, isSenderAdmin);
            } catch (_) {}

            const state = attachments.getAttachmentState({ from, participant });
            const catalogue = state.attachments.map(item => publicAttachment(context.attachment?.id === item.id ? context.attachment : item));
            const drive = require('../commands/buscar');
            const routingContext = { attachments: catalogue, activeId: state.activeId, pendingRequest: state.pendingRequest,
                quote: quotedText, mentioned: isMentioned, quotingBot: isQuotingBotsky,
                sessions: { ...(context.sessions || {}), contacts: getPendingContactContext(from, messageData),
                    downloads: activeSession?.results?.map((item, index) => ({ numero: index + 1, titulo: item.title })) || [],
                    drive: drive.getSearchContext ? drive.getSearchContext(from, messageData) : Boolean(context.sessions?.drive) } };
            const routingOutcome = await aiLimiter.run(() => routeWithAIOutcome(parsed.raw || '', userName, isGroup, chatHistory, mediaContext, affinityContext, senderJid, from, routingContext));
            const aiDecision = routingOutcome.ok ? routingOutcome.decision : null;

        if (aiDecision) {
            const action = aiDecision.action;
            isDirectlyAddressed = aiDecision.addressed_to_bot === true || !isGroup;
            if (isGroup && !isDirectlyAddressed) return;
            parsed.semanticDecision = aiDecision;
            // Parser grammar is only for explicit commands. Natural-language flags
            // and words cannot override the structured model decision.
            parsed.args = []; parsed.flags = {};
            contentIntent = { intent: aiDecision.content_intent || 'unknown', operation: action };
            if (action === 'ignore') return;
            if (aiDecision.needs_clarification || aiDecision.awaiting_attachment) {
                attachments.rememberPendingRequest({ from, participant, text: state.pendingRequest || parsed.raw });
                if (aiDecision.awaiting_attachment) attachments.rememberInstruction({ from, participant, text: state.pendingRequest || parsed.raw });
                await sendText(from, aiDecision.question || 'Me falta un dato para hacerlo. ¿Me aclaras qué necesitas?');
                return;
            }
            if (action === 'contact_choice') {
                const choice = await handlePendingContactChoice({ from, messageData, args: aiDecision.args });
                if (!choice?.consumed) await sendText(from, 'Esa selección ya no está disponible. Dime de nuevo a quién y qué le mando.');
                return;
            }
            const selected = aiDecision.attachment_id ? attachments.resolveAttachment({ from, participant, id: aiDecision.attachment_id }).attachment : null;
            const needsFile = new Set(['enviarmedia', 'transcribir', 'efecto', 'sticker', 'doc', 'comprimir', 'pdf2img', 'recortarpdf', 'leer']);
            if ((aiDecision.uses_attachment || aiDecision.attachment_id || needsFile.has(action) || (action === 'convertir' && !aiDecision.args?.url)) && !selected) {
                attachments.rememberInstruction({ from, participant, text: state.pendingRequest || parsed.raw });
                attachments.rememberPendingRequest({ from, participant, text: state.pendingRequest || parsed.raw });
                await sendText(from, 'No tengo identificado ese archivo. Cítalo o adjúntalo para usar el correcto.');
                return;
            }
            if (selected) {
                attachments.selectAttachment({ from, participant, attachment: selected });
                messageType = selected.messageType;
                messageData = attachments.attachToMessage(selected, messageData);
                const data = messageData.message?.[messageType];
                mediaContext = { type: messageType, mimetype: data?.mimetype || '', fileName: data?.fileName || '', attachmentId: selected.id };
                if (state.pendingRequest) userMsgWithContext = `${state.pendingRequest}\nAclaración actual: ${parsed.raw}`;
            } else {
                mediaContext = null;
                // Do not expose an unrelated current/quoted upload to a tool.
                messageData = { ...messageData, message: { conversation: parsed.raw }, messageType: 'conversation', contextInfo };
                messageType = 'conversation';
            }
            attachments.clearPendingRequest({ from, participant });
            parsed.voiceContext = { history: chatHistory, mediaContext };
            const sentiment = aiDecision.sentiment;

            // Actualización asíncrona de afinidad y memoria social en SQLite
            let triggeredRevenge = false;
            if (sentiment && senderJid) {
                if (sentiment === 'ofensa') {
                    // Si el remitente es el Creador/Admin, no aplicar penalización ni venganza privada (doxeo en DM)
                    if (!isSenderAdmin) {
                        try {
                            const updatedAff = await adjustUserAffinity(senderJid, userName, -15, aiDecision.sentiment_reason || 'Ofensa o mentada de madre', altJid);
                            // Venganza en Privado: Si el usuario ofendió en un grupo y su afinidad cayó en rencor extremo (score <= -50)
                            if (isGroup && updatedAff && updatedAff.score <= -50) {
                                const canRevenge = await canTriggerPrivateRevenge(senderJid);
                                if (canRevenge) {
                                    await recordPrivateRevenge(senderJid);
                                    triggeredRevenge = true;
                                    // Bug #4 fix: await todas las ops para que el estado SQLite quede
                                    // consistente antes de continuar. Fire-and-forget causaba is_doxxed
                                    // inconsistente si el proceso moría entre operaciones.
                                    await setUserDoxxedState(senderJid, 1).catch((e) => {
                                        logger.warn(`[REVENGE] Error al marcar doxxed a ${senderJid}: ${e.message}`);
                                    });
                                    await addLoreEvent(senderJid, userName, 'Terminó ubicado, amenazado en su privado y con su IP expuesta tras pasarse de lanza en el grupo.', 'Botsky').catch((e) => {
                                        logger.warn(`[REVENGE] Error al registrar lore de ${senderJid}: ${e.message}`);
                                    });
                                    const privateDoxeo = generateMockDoxeo(userName, true);
                                    await sendText(senderJid, privateDoxeo).catch((err) => {
                                        logger.warn(`[REVENGE] Error al enviar DM de doxeo a ${senderJid}: ${err.message}`);
                                    });
                                }
                            }
                        } catch (e) {
                            logger.warn(`[AFFINITY] Error al procesar ofensa: ${e.message}`);
                        }
                    } else {
                        logger.info(`[AFFINITY] Ofensa/insistencia ignorada para el Creador/Admin ${senderJid}`);
                    }
                } else if (sentiment === 'disculpa') {
                    adjustUserAffinity(senderJid, userName, 25, aiDecision.sentiment_reason || 'Disculpa sincera o tregua', altJid).catch(() => {});
                    isUserDoxxed(senderJid).then((wasDoxxed) => {
                        if (wasDoxxed) {
                            setUserDoxxedState(senderJid, 0).catch(() => {});
                            addLoreEvent(senderJid, userName, 'Se dobló ante Botsky y pidió disculpas públicas para que le levantaran la sentencia cibernética.', 'Botsky').catch(() => {});
                        }
                    }).catch(() => {});
                } else if (sentiment === 'agradecimiento') {
                    adjustUserAffinity(senderJid, userName, 5, aiDecision.sentiment_reason || 'Agradecimiento o trato amable', altJid).catch(() => {});
                }
            }

            // Silencio en grupo: Si la IA determina que es una conversación entre usuarios ajena al bot
            if (['ignore', 'ignorar', 'silencio', 'none', 'skip'].includes(action)) {
                logger.info(`[AI-ROUTER] Mensaje ignorado en grupo (charla ajena entre usuarios): "${parsed.raw.slice(0, 60)}"`);
                if (mediaContext) mediaContext.base64 = null;
                // Si es grupo, evaluar de forma asíncrona si la conversación genera un momentum propicio para remate proactivo
                if (isGroup) {
                    maybeTriggerBurstIntervention(from).catch(() => {});
                }
                return;
            }

            if (action === 'chat') {
                // En grupos, solo responder conversacionalmente si el bot fue directamente llamado o citado
                if (isGroup && !isDirectlyAddressed) {
                    logger.info(`[AI-CHAT] Ignorando respuesta conversacional en grupo porque Botsky no fue llamado ni citado: "${parsed.raw.slice(0, 50)}"`);
                    return;
                }

                // La decisión usa la petición del chat; sólo su rama de lectura
                // prepara bytes para la IA. Una conversión no hereda sus límites.
                if (!await prepareConversationContent()) return;

                // Activar presencia "Escribiendo..." solo cuando se confirmó que Botsky va a responder
                sendTyping(from).catch(() => {});

                const isComplexOrToolQuery = aiDecision.use_tools === true;

                let reply;
                if (isComplexOrToolQuery) {
                    try {
                        const agentRes = await aiLimiter.run(() => runUniversalAgent({
                            userMessage: userMsgWithContext,
                            userName,
                            from,
                            messageData,
                            history: chatHistory,
                            mediaContext,
                            affinityContext,
                            isAdmin: isSenderAdmin,
                            isGroup
                        }));
                        if (agentRes?.silent) return;
                        reply = agentRes?.text;
                    } catch (agentErr) {
                        logger.warn(`[AGENT-ENGINE] Fallover a chatWithBotsky por error: ${agentErr.message}`);
                        reply = await aiLimiter.run(() => chatWithBotsky(userMsgWithContext, userName, isGroup, chatHistory, mediaContext, affinityContext, { response_mode: aiDecision.response_mode }));
                    }
                } else {
                    reply = await aiLimiter.run(() => chatWithBotsky(userMsgWithContext, userName, isGroup, chatHistory, mediaContext, affinityContext, { response_mode: aiDecision.response_mode }));
                }
                if (mediaContext) mediaContext.base64 = null; // PERF-1: Liberar base64 inmediatamente tras resolver chat
                if (reply) {
                    if (triggeredRevenge && !reply.toLowerCase().includes('privado')) {
                        reply += `\n\n_Revisa tus mensajes privados, cabrón._`;
                    }
                    logger.info(`[AI-CHAT] Respondiendo como Botsky: "${String(reply).slice(0, 50)}..."`);
                    groupCasualCounters.set(from, 0);
                    await sendText(from, reply);
                    return;
                }
            } else if (action) {
                if (mediaContext) mediaContext.base64 = null; // PERF-1: Liberar base64 inmediatamente (los comandos no usan este base64)
                logger.info(`[AI-ROUTER] Acción detectada: ${action} (args: ${JSON.stringify(aiDecision.args || {})}) para: "${parsed.raw}"`);

                cmdToSwitch = action;
                parsed.command = action;

                if (['voz', 'audio', 'habla'].includes(cmdToSwitch)) {
                    sendRecording(from).catch(() => {});
                } else {
                    sendTyping(from).catch(() => {});
                }

                const ok = await applyAiArgsToParsed(parsed, aiDecision.args, downloadSessionKey, from);
                if (!ok) return;
            }
        } else {
            if (isGroup && !isDirectlyAddressedInGroup) return;

            // R2. Fallback de Rescate ante Bloqueos de Seguridad (blocked)
            if (routingOutcome.failure?.kind === 'blocked') {
                const hasAdultTerms = ADULT_URL_REGEX.test(parsed.raw) || ADULT_KEYWORDS_REGEX.test(parsed.raw);
                const hasDownloadIntent = DOWNLOAD_VERBS_REGEX.test(parsed.raw) ||
                    isAdultIntent(parsed.raw, activeSession) ||
                    (activeSession && Boolean(matchSelection(parsed.raw)));

                if (hasAdultTerms || hasDownloadIntent) {
                    logger.warn(`[AI-RESCUE] Bloqueo de seguridad detectado (kind: blocked) con intención de descarga/adultos. Rescatando localmente hacia handleDescargar: "${parsed.raw}"`);
                    cmdToSwitch = 'descargar';
                    parsed.command = 'descargar';
                    parsed.flags = parsed.flags || {};
                    if (hasAdultTerms || (activeSession && activeSession.isAdult)) {
                        parsed.flags.adult = true;
                        parsed.flags.nopor = true;
                    }
                    if (!parsed.flags.f && !parsed.flags.formato) {
                        if (/\b(?:mp3|audio)\b/i.test(parsed.raw)) {
                            parsed.flags.f = 'mp3';
                        } else if (/\b(?:mp4)\b/i.test(parsed.raw)) {
                            parsed.flags.f = 'mp4';
                        }
                    }
                    const urlCandidate = extractUrl(parsed.raw) || extractAdultUrl(parsed.raw);
                    if (urlCandidate) {
                        parsed.args = [urlCandidate];
                    } else {
                        let cleanQuery = parsed.raw
                            .replace(/@[^\s,]+\s*/g, '')
                            .replace(/^(?:(?:oye\s+)?(?:compa\s+|bot\s+|botsky\s+|botsito\s+)[,\s]*)/i, '')
                            .replace(/^(?:b[uú]sca(?:me)?|buscar|desc[aá]rga(?:me|te)?|descargar|b[aá]ja(?:me|te)?|bajar|p[aá]sa(?:me|te)?|pasar|t[uú]mba(?:te|me)?|tumbar|quiero(?:\s+ver)?|p[oó]n(?:me|te)?|dame|m[aá]nda(?:me|te)?|enseña(?:me)?|encuentra|ver|videos?\s+de|video\s+de|videos?)\s+/i, '')
                            .trim();
                        cleanQuery = cleanQuery.replace(/\s+(?:en\s+|a\s+|como\s+)?(?:mp3|audio|mp4|video)\s*$/i, '').trim();
                        parsed.args = [cleanQuery || parsed.raw];
                    }
                } else {
                    logger.warn('[AI-FAIL] No hubo una decisión semántica válida; no ejecuté herramientas.');
                    await sendText(from, aiRoutingFailureMessage(routingOutcome.failure));
                    return;
                }
            } else {
                logger.warn('[AI-FAIL] No hubo una decisión semántica válida; no ejecuté herramientas.');
                await sendText(from, aiRoutingFailureMessage(routingOutcome.failure));
                return;
            }
        }
    }
}

    // 7. Seguridad de comandos sensibles y de sistema
    // Apagar bot: estrictamente super-admin (dueño)
    if (cmdToSwitch === 'apagate') {
        // Bug #5 fix: usar isAuthorizedAdmin() en lugar de .includes() naive sobre el JID.
        // El .includes() podía dar falso positivo si el número del admin era subcadena del
        // JID del grupo (ej: admin '1234' dentro de '120363...1234...@g.us').
        const isSuperAdmin = isAuthorizedAdmin(from, messageData);
        if (!isSuperAdmin) {
            await sendText(from, `[!] acceso denegado\nsolo el mero dueño puede apagar el bot`);
            return;
        }
    }

    // Comandos de Minecraft: grupos autorizados y admins para acciones críticas
    const mcCommands = ['maicra', 'mc', 'minecraft', 'mine', 'server'];
    if (mcCommands.includes(cmdToSwitch)) {
        const isAuthorized = getAllAllowed().some(id => (from || '').includes(id) || (participant || '').includes(id)) || getAllAdmins().some(id => (from || '').includes(id) || (participant || '').includes(id));
        if (!isAuthorized) {
            await sendText(from, `[!] acceso denegado\neste grupo o chat no tiene permisos para el servidor de minecraft`);
            return;
        }

        const action = parsed.args[0]?.toLowerCase();
        const adminActions = ['on', 'encender', 'off', 'apagar', 'reiniciar', 'restart', 'kill', 'cmd', 'comando', 'prender', 'start', 'detener', 'stop', 'reboot', 'backup', 'respaldo', 'activarmod', 'desactivarmod', 'activar', 'desactivar', 'quitarmod', 'ponermod', 'instalarmod'];
        if (adminActions.includes(action)) {
            const isAdminUser = isAuthorizedAdmin(from, messageData);
            if (!isAdminUser) {
                await sendText(from, `[!] acceso denegado\nsolo los administradores pueden encender, apagar o ejecutar comandos en el servidor de minecraft`);
                return;
            }
        }
    }

    // Terminal y Agentic Core: estrictamente administradores autorizados (Fase 4)
    const terminalCommands = ['terminal', 'bash', 'cmd', 'sh', 'agente', 'vps', 'linux', 'recursos', 'sistema'];
    if (terminalCommands.includes(cmdToSwitch)) {
        const isAuthorized = isAuthorizedAdmin(from, messageData);
        if (!isAuthorized) {
            logger.warn(`[SECURITY] Intento no autorizado de acceso a terminal desde ${from} (sender: ${getSenderJid(from, messageData)})`);
            await sendText(from, `[!] acceso denegado\nsolo los administradores autorizados pueden usar la terminal del servidor`);
            return;
        }
    }

    // Otorgar experiencia: estrictamente administradores autorizados
    const xpCommands = ['darxp', 'addxp', 'añademe', 'anademe', 'damexp', 'sumarxp', 'xpadmin'];
    if (xpCommands.includes(cmdToSwitch)) {
        const isAuthorized = isAuthorizedAdmin(from, messageData);
        if (!isAuthorized) {
            logger.warn(`[SECURITY] Intento no autorizado de otorgar XP desde ${from} (sender: ${getSenderJid(from, messageData)})`);
            await sendText(from, `> ❌ Acceso denegado. Solo el administrador autorizado puede otorgar experiencia.`);
            return;
        }
    }

    // Hora Feliz: activación y desactivación estrictamente administradores autorizados
    const hfCommands = ['horafeliz', 'happyhour', 'hf'];
    if (hfCommands.includes(cmdToSwitch)) {
        const sub = (parsed.args[0] || '').toLowerCase();
        const adminActions = ['on', 'iniciar', 'activar', 'prender', 'off', 'apagar', 'detener', 'cancelar', 'desactivar'];
        if (adminActions.includes(sub)) {
            const isAuthorized = isAuthorizedAdmin(from, messageData);
            if (!isAuthorized) {
                logger.warn(`[SECURITY] Intento no autorizado de controlar Hora Feliz desde ${from} (sender: ${getSenderJid(from, messageData)})`);
                await sendText(from, `> ❌ Acceso denegado. Solo administradores pueden activar o desactivar la Hora Feliz.`);
                return;
            }
        }
    }

    // 8. Ejecución mediante Command Registry
    let handler = null;
    let queueTier = null;

    if (isRegisteredCommand(cmdToSwitch)) {
        if (mediaContext) mediaContext.base64 = null; // PERF-1: Asegurar liberación antes de esperar en cola
        sendTyping(from).catch(() => {});
        const result = await getCommandHandler(cmdToSwitch, { parsed, from, messageData });
        if (!result) return;
        if (result.handled) return;
        handler = result.handler;
        queueTier = result.queueTier;
    } else {
        // Si no es un comando registrado (o la IA no mapeó a comando), responder como chat
        if (!await prepareConversationContent()) return;
        sendTyping(from).catch(() => {});
        handler = async () => {
            try {
                const history = getHistory(from, 8);
                const reply = await aiLimiter.run(() => chatWithBotsky(userMsgWithContext, userName, isGroup, history, mediaContext, affinityContext));
                groupCasualCounters.set(from, 0);
                await sendText(from, reply);
            } finally {
                if (mediaContext) mediaContext.base64 = null; // PERF-1: Liberar al concluir chat diferido
            }
        };
        queueTier = 'light';
    }

    if (handler) {
        const originalHandler = handler;
        handler = () => observeCommandUsage(isRegisteredCommand(cmdToSwitch) ? cmdToSwitch : 'chat', from,
            originalHandler, { item: parsed.args?.[0], adult: parsed.aiArgs?.isAdult === true || parsed.flags?.adult === true });
        try {
            if (queueTier) {
                const queueUserId = isGroup ? `${from}_${participant}` : from;
                await queue.add(queueUserId, handler, queueTier, cmdToSwitch);
            } else {
                await handler();
            }
        } catch (err) {
            if (err.userMessage) {
                await sendText(from, `> ❌ ${err.userMessage}`);
            } else if (err.message && err.message.includes('espera')) {
                await sendText(from, err.message);
            } else if (err.message && !err.message.startsWith('Command failed') && !err.stack?.includes('at Object.')) {
                logger.warn(`[COMMAND-WARN] ${cmdToSwitch}: ${err.message}`);
                await sendText(from, `> ⚠️ ${err.message}`);
            } else {
                logger.error(`error al ejecutar comando ${cmdToSwitch}:`, err);
                await sendText(from, `[!] error al ejecutar: ${cmdToSwitch}`);
            }
        }
    }
}

module.exports = { dispatch, isAuthorizedAdmin, getSenderJid, _resetCooldowns: () => { chatCooldowns.clear(); groupCasualCounters.clear(); }, _groupCasualCounters: groupCasualCounters, _aiLimiter: aiLimiter };
