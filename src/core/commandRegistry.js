'use strict';

const { sendText } = require('../services/evolution');
const { handleAyuda } = require('../commands/ayuda');
const { handleDescargar } = require('../commands/descargar');
const { handleTranscribir } = require('../commands/transcribir');
const { handleConvertir } = require('../commands/convertir');
const { handleSticker } = require('../commands/sticker');
const { handleInfo, handleBotStatus } = require('../commands/info');
const { handleDoc, handleComprimir, handlePdf2Img, handleUnirPdf, handleRecortarPdf } = require('../commands/documentos');
const { handleLeer } = require('../commands/ocr');
const { handleEfecto } = require('../commands/efectos');
const { handleQr } = require('../commands/qr');
const { handleModeracion } = require('../commands/moderacion');
const { handleRank, handleTop, handleDarXp } = require('../commands/niveles');
const { handleMaicra } = require('../commands/maicra');
const { handleApagar } = require('../commands/sistema');
const { cambiarTele } = require('../commands/cambiarTV');
const { handleBuscar, handleDownloadDrive } = require('../commands/buscar');
const { handleDrive } = require('../commands/drive');
const { handleLore } = require('../commands/lore');
const { handleVoz } = require('../commands/voz');
const { handleRecordar } = require('../commands/recordatorios');
const { handleTerminal } = require('../commands/terminal');
const { handleNotas } = require('../commands/notas');
const { handleRuleta } = require('../commands/ruleta');
const { handleNuclear } = require('../commands/nuclear');
const { handleDaily } = require('../commands/daily');
const { handleAfinidad } = require('../commands/afinidad');
const { handleDoxeo } = require('../commands/doxeo');
const { handleBlackjack } = require('../commands/blackjack');
const { handleEncuesta } = require('../commands/encuesta');
const { handleTareas } = require('../commands/tareas');
const { handleDifusion } = require('../commands/difusion');
const { handleMensaje } = require('../commands/mensaje');
const { handleEnviarMedia } = require('../commands/enviarmedia');
const { handleCooperacha } = require('../commands/cooperacha');
const { handlePack } = require('../commands/pack');
const { handleHoraFeliz } = require('../commands/happyHour');

const registry = new Map();

/**
 * Registra un comando con sus aliases y configuración.
 * @param {string|string[]} aliases - Nombres/comandos para invocar
 * @param {object} config - Configuración del comando ({ tier, execute })
 */
function register(aliases, config) {
    const list = Array.isArray(aliases) ? aliases : [aliases];
    for (const name of list) {
        registry.set(name.toLowerCase(), config);
    }
}

// ─── Registro de Comandos ──────────────────────────────────────────────────────

// Ayuda e Información
register(['ayuda', 'help'], {
    execute: (parsed, from) => ({
        handler: () => handleAyuda(parsed, from),
        queueTier: null
    })
});

register(['info'], {
    execute: (parsed, from) => ({
        handler: () => handleInfo(parsed, from),
        queueTier: null
    })
});

register(['estado', 'estadobot', 'status'], {
    execute: (parsed, from) => ({
        handler: () => handleBotStatus(parsed, from),
        queueTier: null
    })
});

// Descargas Multimedia
register(['descargar', 'descarga', 'baja', 'bajar', 'bajalo', 'bajate', 'descargalo', 'tumbate', 'dl', 'tiktok', 'tt', 'tk', 'video', 'videos', 'youtube', 'yt', 'buscavideo', 'buscavideos', 'buscarvideo', 'buscarvideos'], {
    execute: (parsed, from, messageData) => ({
        handler: () => handleDescargar(parsed, from, messageData),
        queueTier: 'heavy'
    })
});

// Música y Canciones (descarga directa en MP3 vía yt-dlp)
register(['musica', 'cancion', 'canciones', 'music', 'song', 'rola', 'rolas'], {
    execute: (parsed, from, messageData) => {
        parsed.flags = parsed.flags || {};
        if (!parsed.flags.f && !parsed.flags.formato) parsed.flags.f = 'mp3';
        return {
            handler: () => handleDescargar(parsed, from, messageData),
            queueTier: 'heavy'
        };
    }
});

// Recordatorios y Alarmas (Feature #13)
register(['recordar', 'recordatorio', 'recuerdame', 'recordatorios', 'alarma', 'remind'], {
    execute: (parsed, from, messageData) => ({
        handler: () => handleRecordar(parsed, from, messageData),
        queueTier: null
    })
});

// Audio y Voz
register(['enviarmedia', 'reenviar'], {
    execute: (parsed, from, messageData) => ({ handler: () => handleEnviarMedia(parsed, from, messageData), queueTier: 'light' })
});

register(['transcribir', 'transcribe', 'tr'], {
    execute: (parsed, from, messageData) => ({
        handler: () => handleTranscribir(parsed, from, messageData),
        queueTier: 'light'
    })
});

register(['efecto'], {
    execute: (parsed, from, messageData) => ({
        handler: () => handleEfecto(parsed, from, messageData),
        queueTier: 'light'
    })
});

register(['voz', 'audio', 'tts', 'habla', 'hablar', 'notadevoz'], {
    execute: (parsed, from, messageData) => ({
        handler: () => handleVoz(parsed, from, messageData),
        queueTier: 'light'
    })
});

// Conversión y Stickers
register(['convertir', 'cv'], {
    execute: (parsed, from, messageData) => ({
        handler: () => handleConvertir(parsed, from, messageData),
        queueTier: 'heavy'
    })
});

register(['sticker', 's', 'stickers', 'calca', 'calcas', 'pegatina', 'pegatinas'], {
    execute: (parsed, from, messageData) => ({
        handler: () => handleSticker(parsed, from, messageData),
        queueTier: 'light'
    })
});

// Google Drive
register(['buscar'], {
    execute: (parsed, from, messageData) => ({
        handler: () => handleBuscar(parsed, from, messageData),
        queueTier: 'light'
    })
});

register(['descargardrive'], {
    execute: (parsed, from, messageData) => ({
        handler: () => handleDownloadDrive(parsed, from, messageData),
        queueTier: 'heavy'
    })
});

register(['drive'], {
    execute: (parsed, from, messageData) => ({
        handler: () => handleDrive(parsed, from, messageData),
        queueTier: 'heavy'
    })
});

// Documentos y PDFs (Manejo dinámico de colas)
register(['doc', 'pdf'], {
    execute: (parsed, from, messageData) => {
        const isDocumentImage = messageData?.messageType?.toLowerCase().includes('document') &&
            (messageData.message?.documentMessage?.mimetype?.startsWith('image/') ||
                messageData.message?.documentMessage?.fileName?.toLowerCase().match(/\.(jpe?g|png|webp|gif)$/i));
        const isDocument = messageData?.messageType?.toLowerCase().includes('document') && !isDocumentImage;
        const isTerminarDoc = parsed.args[0] === 'terminar' || parsed.flags.terminar;
        const isCancelarDoc = parsed.args[0] === 'cancelar' || parsed.flags.cancelar;

        let queueTier = null;
        if (isTerminarDoc || isDocument) {
            queueTier = 'heavy';
        } else if (isCancelarDoc) {
            queueTier = null;
        }

        return {
            handler: () => handleDoc(parsed, from, messageData),
            queueTier
        };
    }
});

register(['comprimir'], {
    execute: (parsed, from, messageData) => ({
        handler: () => handleComprimir(parsed, from, messageData),
        queueTier: 'light'
    })
});

register(['recortar', 'recortarpdf', 'cortar', 'cortarpdf', 'extraerpdf'], {
    execute: (parsed, from, messageData) => ({
        handler: () => handleRecortarPdf(parsed, from, messageData),
        queueTier: 'light'
    })
});

register(['unir', 'unirpdf', 'unirpdfs'], {
    execute: (parsed, from, messageData) => {
        const isTerminarUnir = parsed.args[0] === 'terminar' || parsed.flags.terminar;
        const queueTier = isTerminarUnir ? 'heavy' : null;

        return {
            handler: () => handleUnirPdf(parsed, from, messageData),
            queueTier
        };
    }
});

register(['pdf2img', 'extraer'], {
    execute: (parsed, from, messageData) => ({
        handler: () => handlePdf2Img(parsed, from, messageData),
        queueTier: 'heavy'
    })
});

// OCR y Utilidades
register(['leer', 'ocr'], {
    execute: (parsed, from, messageData) => ({
        handler: () => handleLeer(parsed, from, messageData),
        queueTier: 'light'
    })
});

register(['qr'], {
    execute: (parsed, from, messageData) => ({
        handler: () => handleQr(parsed, from, messageData),
        queueTier: 'light'
    })
});

// Moderación y Niveles de Grupo
register(['kick', 'ban', 'promote', 'demote', 'mute', 'unmute', 'warn', 'unwarn'], {
    execute: (parsed, from, messageData) => ({
        handler: () => handleModeracion(parsed, from, messageData),
        queueTier: null
    })
});

register(['rank', 'nivel'], {
    execute: (parsed, from, messageData) => ({
        handler: () => handleRank(parsed, from, messageData),
        queueTier: null
    })
});

register(['top'], {
    execute: (parsed, from, messageData) => ({
        handler: () => handleTop(parsed, from, messageData),
        queueTier: null
    })
});

// Otorgar experiencia (Admin)
register(['darxp', 'addxp', 'añademe', 'anademe', 'damexp', 'sumarxp', 'xpadmin'], {
    execute: (parsed, from, messageData) => ({
        handler: () => handleDarXp(parsed, from, messageData),
        queueTier: null
    })
});

// Minecraft Bedrock
register(['maicra', 'mc', 'minecraft', 'mine', 'server'], {
    execute: (parsed, from, messageData) => ({
        handler: () => handleMaicra(parsed, from, messageData),
        queueTier: 'light'
    })
});

// Lore y Eventos
register(['lore', 'lores', 'canon', 'cronica'], {
    execute: (parsed, from, messageData) => ({
        handler: () => handleLore(parsed, from, messageData),
        queueTier: 'light'
    })
});

// Control de TV y Sistema
register(['canal'], {
    execute: async (parsed, from) => {
        const arg = parsed.args.join(' ');
        if (arg === 'futbol') {
            return { handler: () => cambiarTele(from, 'https://futbol-libres.su/'), queueTier: null };
        } else if (arg === 'llutuv') {
            return { handler: () => cambiarTele(from, 'https://youtube.com/tv'), queueTier: null };
        } else {
            await sendText(from, `> no entendi \`${parsed.raw}\`\n\nescribe */@ ayuda* para ver los comandos`);
            return { handled: true };
        }
    }
});

register(['apagate'], {
    execute: async (parsed, from) => {
        if (parsed.args.join(' ') === 'papu') {
            return { handler: () => handleApagar(from), queueTier: null };
        } else {
            await sendText(from, `> no entendi \`${parsed.raw}\`\n\nescribe */@ ayuda* para ver los comandos`);
            return { handled: true };
        }
    }
});

register(['terminal', 'bash', 'cmd', 'sh', 'agente', 'vps', 'linux', 'recursos', 'sistema'], {
    execute: (parsed, from, messageData) => ({
        handler: () => handleTerminal(parsed, from, messageData),
        queueTier: 'heavy'
    })
});

// Notas compartidas de grupo
register(['notas', 'nota', 'apunte', 'apuntes', 'tablon'], {
    execute: (parsed, from, messageData) => ({
        handler: () => handleNotas(parsed, from, messageData),
        queueTier: null
    })
});

// Encuestas de grupo
register(['encuesta', 'encuestas', 'poll', 'votacion'], {
    execute: (parsed, from, messageData) => ({
        handler: () => handleEncuesta(parsed, from, messageData),
        queueTier: null
    })
});

// Tareas escolares y publicación programada
register(['tarea', 'tareas', 'deberes'], {
    execute: (parsed, from, messageData) => ({
        handler: () => handleTareas(parsed, from, messageData),
        queueTier: null
    })
});

// Ruleta Rusa multijugador con apuestas
register(['ruleta', 'ruletarusa', 'roulette'], {
    execute: (parsed, from, messageData) => ({
        handler: () => handleRuleta(parsed, from, messageData),
        queueTier: null
    })
});

// Comando Nuclear Kamikaze (5,000 XP)
register(['nuclear', 'nuke', 'bomba', 'kamikaze'], {
    execute: (parsed, from, messageData) => ({
        handler: () => handleNuclear(parsed, from, messageData),
        queueTier: null
    })
});

// Ruleta de la Suerte Diaria (daily)
register(['daily', 'diario', 'ruletadiaria', 'recompensa'], {
    execute: (parsed, from, messageData) => ({
        handler: () => handleDaily(parsed, from, messageData),
        queueTier: null
    })
});

// Afinidad, Emociones y Karma Social
register(['afinidad', 'karma', 'relacion', 'rencor', 'amistad'], {
    execute: (parsed, from, messageData) => ({
        handler: () => handleAfinidad(parsed, from, messageData),
        queueTier: null
    })
});

// Doxeo Técnico Paródico
register(['doxeo', 'doxear', 'doxxeo', 'localizar'], {
    execute: (parsed, from, messageData) => ({
        handler: () => handleDoxeo(parsed, from, messageData),
        queueTier: 'light'
    })
});

// Blackjack 21 (Casino contra Botsky con apuestas de XP)
register(['blackjack', '21', 'bj'], {
    execute: (parsed, from, messageData) => ({
        handler: () => handleBlackjack(parsed, from, messageData),
        queueTier: null
    })
});

// Difusión Masiva Rápida a Miembros del Grupo
register(['difusion', 'difundir', 'broadcast'], {
    execute: (parsed, from, messageData) => ({
        handler: () => handleDifusion(parsed, from, messageData),
        queueTier: 'light'
    })
});

// Mensaje privado a un contacto/miembro del grupo
register(['mensaje', 'recado', 'dile', 'mandale', 'escribele'], {
    execute: (parsed, from, messageData) => ({
        handler: () => handleMensaje(parsed, from, messageData),
        queueTier: 'light'
    })
});

// Cooperacha de XP (Reto grupal con foto censurada y revelación)
register(['cooperacha', 'coop', 'coperacha', 'vaquita', 'reto', 'destapar', 'cooperar', 'aportar'], {
    execute: (parsed, from, messageData) => ({
        handler: () => handleCooperacha(parsed, from, messageData),
        queueTier: null
    })
});

// Mercado Negro / Packs de fotos por XP (150 XP, View Once privado)
register(['pack', 'packs', 'mercadonegro', 'comprarpack'], {
    execute: (parsed, from, messageData) => ({
        handler: () => handlePack(parsed, from, messageData),
        queueTier: null
    })
});

register(['comprar', 'compra'], {
    execute: (parsed, from, messageData) => {
        const item = parsed.args[0]?.toLowerCase();
        if (item === 'pack' || item === 'packs') {
            const forwardParsed = {
                ...parsed,
                command: 'pack',
                args: parsed.args.slice(1)
            };
            return {
                handler: () => handlePack(forwardParsed, from, messageData),
                queueTier: null
            };
        }
        return {
            handler: async () => {
                const { sendText } = require('../services/evolution');
                const happyHour = require('../services/happyHour');
                const isHappy = happyHour.isHappyHourActive(from);
                const packCostStr = isHappy ? '75 XP (¡50% OFF por Hora Feliz!)' : '150 XP';
                await sendText(from, `🛍️ *Mercado Negro Botsky*\n\nPor ahora solo tengo disponibles *!pack* de fotos por ${packCostStr} con visualización única al privado.\nEscribe *!pack* o *!comprar pack* para comprar uno.`);
            },
            queueTier: null
        };
    }
});

// Sistema de Hora Feliz (control administrativo y consulta)
register(['horafeliz', 'happyhour', 'hf'], {
    execute: (parsed, from, messageData) => ({
        handler: () => handleHoraFeliz(parsed, from, messageData),
        queueTier: null
    })
});


// ─── Métodos Públicos ──────────────────────────────────────────────────────────

function isRegisteredCommand(name) {
    return typeof name === 'string' && registry.has(name.toLowerCase());
}

function getRegisteredCommands() {
    return Array.from(registry.keys());
}

async function getCommandHandler(name, context = {}) {
    if (typeof name !== 'string') return null;
    context = context && typeof context === 'object' ? context : {};
    const {from,messageData} = context;
    if (typeof from !== 'string' || !from.trim()) return null;
    const input = context.parsed;
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const parsed = input;
    parsed.args = Array.isArray(parsed.args) ? parsed.args : [];
    if (parsed.args.some(arg => typeof arg !== 'string' && typeof arg !== 'number')) return null;
    parsed.args = parsed.args.map(arg => typeof arg === 'number' ? String(arg) : arg);
    parsed.flags = parsed.flags && typeof parsed.flags === 'object' && !Array.isArray(parsed.flags) ? parsed.flags : {};
    parsed.raw = typeof parsed.raw === 'string' ? parsed.raw : '';
    const config = registry.get(name.toLowerCase());
    if (!config) return null;
    return await config.execute(parsed, from, messageData);
}

module.exports = {
    isRegisteredCommand,
    getRegisteredCommands,
    getCommandHandler
};
