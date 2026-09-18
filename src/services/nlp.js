'use strict';

const { NlpManager } = require('node-nlp');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const MODEL_PATH = path.join(__dirname, '../../data/model.nlp');
const MODISMOS_PATH = path.join(__dirname, '../../data/corpus_modismos.json');

// Inicializar NLP Manager para Español con extracción forzada de entidades
const manager = new NlpManager({ languages: ['es'], forceNER: true, modelFileName: MODEL_PATH });

// Cargar el modelo pre-entrenado desde disco si existe
if (fs.existsSync(MODEL_PATH)) {
    try {
        manager.load(MODEL_PATH);
        logger.info(`[NLP] Modelo pre-entrenado cargado desde '${MODEL_PATH}'.`);
    } catch (err) {
        logger.warn(`[NLP] No se pudo cargar '${MODEL_PATH}': ${err.message}`);
    }
}

/**
 * Normalizador élite de lenguaje natural coloquial, diminutivos,
 * fonética informal y modismos comunes en WhatsApp (México / Latinoamérica).
 */
function normalizeText(text) {
    if (!text || typeof text !== 'string') return '';
    let t = text.toLowerCase().trim();

    // Eliminar URLs completas para que los identificadores aleatorios (ej: v=dQw4w...) no contaminen los tokens bayesianos
    t = t.replace(/https?:\/\/[^\s]+/gi, '').trim();

    // 1. Reducir repeticiones excesivas de caracteres (ej: "videeeeto" -> "videeto", "alvvv" -> "alv")
    t = t.replace(/([a-zA-ZáéíóúÁÉÍÓÚñÑ])\1{2,}/g, '$1$1');

    // 2. Normalización fonética y modismos comunes
    const phoneticSlang = [
        // Hazme / hazlo / hacer
        [/\b(asme|azme|hasme|hazmelo|aslo|azlo|haslo|hazme el paro|asme el paro|echame la mano|echame la mano pa|tirame paro)\b/g, 'hazme'],
        [/\b(acer)\b/g, 'hacer'],
        // PDF fonético y variaciones
        [/\b(pidief|pidef|pedeefe|pe\s*de\s*efe|pe-de-efe|pdfe|pfd)\b/g, 'pdf'],
        // Word fonético
        [/\b(uord|guor|wordcito)\b/g, 'word'],
        // Excel fonético
        [/\b(exel|ecel|eksel|excelcito)\b/g, 'excel'],
        // PowerPoint
        [/\b(power\s*point|pitor|diapos|pauergüin|pawer)\b/g, 'powerpoint'],
        // Video / clip / redes
        [/\b(bideo|videito|videocito|videazo|videaso)\b/g, 'video'],
        [/\b(tiktoc)\b/g, 'tiktok'],
        [/\b(tuiter)\b/g, 'twitter'],
        [/\b(feis)\b/g, 'facebook'],
        [/\b(ril)\b/g, 'reel'],
        // Spotify / música
        [/\b(spoti|spoty)\b/g, 'spotify'],
        [/\b(rolita|rolon|cumbion|temon)\b/g, 'cancion'],
        // Sticker / calca
        [/\b(calca|calcomania|calcomanía|estampita|momo|estiquer|calquita)\b/g, 'sticker'],
        // Transcribir / texto
        [/\b(dise|dize)\b/g, 'dice'],
        [/\b(toy)\b/g, 'estoy'],
        [/\b(qede)\b/g, 'quede'],
        // Diminutivos frecuentes
        [/\b(archivito|ficherito)\b/g, 'archivo'],
        [/\b(documentito|docu)\b/g, 'documento'],
        [/\b(fotito|fotaza|fotasa)\b/g, 'foto'],
        [/\b(audito)\b/g, 'audio'],
        [/\b(chiquito|liviano|menos\s*pesado)\b/g, 'ligero']
    ];

    for (const [pattern, replacement] of phoneticSlang) {
        t = t.replace(pattern, replacement);
    }

    // 3. Limpiar muletillas de relleno coloquial que confunden el clasificador si están solas
    t = t.replace(/\b(alv|we|wey|morro|pana|bro|mano|plis|pls|porfa|por\s*favor|tio|chaval|kbron|cabron)\b/g, '').replace(/\s+/g, ' ').trim();

    return t;
}

function setupCorpus() {
    // --- NER (ENTIDADES NOMBRADAS) ---
    // Formatos de Documentos
    manager.addNamedEntityText('formatoDoc', 'pdf', ['es'], ['pdf', 'documento', 'archivo']);
    manager.addNamedEntityText('formatoDoc', 'docx', ['es'], ['docx', 'word', 'doc']);
    manager.addNamedEntityText('formatoDoc', 'xlsx', ['es'], ['xlsx', 'excel', 'tabla', 'hoja de calculo']);
    manager.addNamedEntityText('formatoDoc', 'pptx', ['es'], ['pptx', 'powerpoint', 'diapositiva', 'diapositivas', 'ppt']);
    manager.addNamedEntityText('formatoDoc', 'txt', ['es'], ['txt', 'texto plano', 'bloc de notas']);

    // Formatos Multimedia
    manager.addNamedEntityText('formatoMedia', 'mp3', ['es'], ['mp3', 'audio', 'musica', 'cancion']);
    manager.addNamedEntityText('formatoMedia', 'mp4', ['es'], ['mp4', 'video', 'clip']);
    manager.addNamedEntityText('formatoMedia', 'gif', ['es'], ['gif', 'animacion']);
    manager.addNamedEntityText('formatoMedia', 'ogg', ['es'], ['ogg', 'nota de voz', 'vn', 'opus']);
    manager.addNamedEntityText('formatoMedia', 'wav', ['es'], ['wav']);
    manager.addNamedEntityText('formatoMedia', 'flac', ['es'], ['flac']);

    // Formatos Imagen
    manager.addNamedEntityText('formatoImg', 'img', ['es'], ['img', 'imagen', 'imagenes', 'foto', 'fotos', 'png', 'jpg', 'jpeg']);

    // Efectos de Audio
    manager.addNamedEntityText('efectoTipo', 'ardilla', ['es'], ['ardilla', 'alvin', 'chillon', 'pitufo', 'agudo', 'raton']);
    manager.addNamedEntityText('efectoTipo', 'lento', ['es'], ['lento', 'despacio', 'tortuga', 'slow', 'frenado']);
    manager.addNamedEntityText('efectoTipo', 'grave', ['es'], ['grave', 'grueso', 'demonio', 'diablo', 'monstruo', 'ronco', 'hondo']);
    manager.addNamedEntityText('efectoTipo', 'rapido', ['es'], ['rapido', 'veloz', 'flash', 'acelerado', 'fast']);
    manager.addNamedEntityText('efectoTipo', 'robot', ['es'], ['robot', 'autotune', 'ciborg', 'metalico']);
    manager.addNamedEntityText('efectoTipo', 'eco', ['es'], ['eco', 'cueva', 'estadio', 'repeticion']);
    manager.addNamedEntityText('efectoTipo', 'reversa', ['es'], ['reversa', 'al reves', 'invertido']);

    // --- CORPUS BASE BALANCEADO ---
    const coreCorpus = {
        descargar: [
            'descargar', 'descargame', 'descargalo', 'descargamelo', 'baja', 'bajar', 'bajame', 'bajalo',
            'guardame esto', 'guarda este video', 'baja este video', 'descarga este video',
            'dame este video', 'dame este video rico', 'dame este video en full hd', 'dame este video en 1080',
            'tumbate este video', 'tumbate este reel', 'tumbate este tiktok', 'tumbate este short',
            'robate este video', 'robate este tiktok', 'robate este reel', 'robate este short',
            'sacame este video', 'sacame este clip', 'baja este tiktok', 'descarga de youtube',
            'baja de instagram', 'baja este reel', 'pasame este clip', 'pasame este video',
            'descargamelo rapido', 'baja este enlace', 'descarga este link', 'bajate este enlace', 'tiktok', 'reel', 'short'
        ],
        spotify: [
            'spotify', 'cancion', 'musica', 'descarga esta cancion', 'bajame esta musica', 'quiero esa cancion',
            'pasa el temazo', 'descargar track', 'baja esta cancion de spotify', 'quiero esta cancion',
            'bajame esta cancion de spotify', 'pasa la cancion', 'descargar de spotify', 'cancion de spotify',
            'temazo de spotify', 'baja este tema', 'descarga la musica de spotify', 'track de spotify',
            'pasa el audio de spotify', 'bajame este audio de spotify', 'rola de spotify'
        ],
        transcribir: [
            'transcribir', 'transcribe', 'transcribeme', 'transcribelo', 'transcribe esto',
            'transcribe el audio', 'transcribe este audio', 'que dice', 'que dice el audio',
            'que dice este audio', 'que dice aqui', 'que dicen', 'que dice la nota',
            'que dice la nota de voz', 'dime que dice', 'escribelo', 'escribe esto',
            'escribe el audio', 'pasa este audio a texto', 'pasa a texto', 'audio a texto',
            'texto del audio', 'sacar texto del audio', 'que estan diciendo', 'que habla',
            'no puedo escuchar', 'no puedo oir', 'estoy sordo', 'estoy sordo que dice este audio',
            'escuchalo', 'escucha esto', 'escucha y dime que dice', 'dictado', 'dictar',
            'dictame', 'resumen del audio', 'hazme un resumen', 'que dice la nota de voz',
            'que carajos dice el audio', 'traduce la nota de voz'
        ],
        leer: [
            'leer', 'ocr', 'escanear', 'traducir', 'lee', 'escanea', 'copiar',
            'que dice esta foto', 'sacar texto de la foto', 'extraer texto de la foto',
            'letras de la foto', 'leeme esto', 'copiar texto', 'texto de la foto',
            'que dice la foto', 'sacale el texto a la foto', 'sacale las letras a la foto', 'extrae las letras',
            'que texto tiene esta foto', 'pasa esta foto a texto', 'copiame lo que dice aqui',
            'lee lo que dice en la foto', 'escanear texto', 'extrae las letras de la foto'
        ],
        doc: [
            'doc', 'documento', 'hazme este archivo a pdf', 'hazme este archivo en pdf',
            'hazme este documento a pdf', 'hazme este archivo a word', 'hazme este documento a excel',
            'hazmelo pdf', 'hazlo pdf', 'pasalo a pdf', 'pasamelo a pdf', 'pasalo a word', 'pasalo a excel',
            'convertir a %formatoDoc%', 'pasalo a %formatoDoc%', 'hazlo %formatoDoc%',
            'a %formatoDoc%', 'en %formatoDoc%', 'transformalo a %formatoDoc%',
            'dejalo en %formatoDoc%', 'sacalo en %formatoDoc%', 'cambialo a %formatoDoc%',
            'convertir documento a %formatoDoc%', 'pasa este archivo a %formatoDoc%',
            'convierteme este documento a %formatoDoc%', 'hazme un pdf de este archivo',
            'quiero esto en word', 'quiero este documento en pdf', 'creame un pdf', 'crear pdf', 'pdf'
        ],
        convertir: [
            'convertir', 'transformar', 'mutar', 'cambiar formato', 'cambiale el formato',
            'pasalo a %formatoMedia%', 'hazlo %formatoMedia%', 'convierteme este video a %formatoMedia%',
            'cambiar formato a %formatoMedia%', 'transformar a %formatoMedia%', 'vuelve esto %formatoMedia%',
            'convertir a %formatoMedia%', 'sacale el audio en %formatoMedia%', 'hazmelo %formatoMedia%',
            'dejalo en %formatoMedia%', 'sacame la cancion en %formatoMedia%', 'sacale el audio',
            'pasa este video a audio', 'extrae el audio', 'conviertelo a audio',
            'convierteme a mp3', 'pasamelo a mp3', 'quiero el audio en mp3', 'cambialo a mp4',
            'transformalo a video', 'conviertelo a gif', 'hazlo gif', 'pasa este video a mp3'
        ],
        sticker: [
            'sticker', 'pegatina', 'haz un sticker', 'crea un sticker', 'hazme un sticker',
            'hazlo sticker', 'hazme un sticker recortado', 'sacale el sticker', 'quiero este sticker',
            'recortar sticker', 'sticker recortado', 'sticker sin fondo', 'recortamelo', 'recorta la cara',
            'sticker animado', 'hazlo animado', 'que se mueva', 'con movimiento',
            'hazme un sticker animado', 'stickers', 'hazme un sticker bien perron'
        ],
        comprimir: [
            'comprimir', 'bajar peso', 'hacer ligero', 'reducir', 'achicar',
            'pesa mucho', 'aligerar', 'comprime', 'aplastar', 'hazlo menos pesado',
            'encoger', 'pesa mucho comprime esto', 'bajale el peso al pdf',
            'hazlo mas liviano', 'comprimir pdf', 'bajarle los megas', 'reduce el archivo', 'comprime esto'
        ],
        unir: [
            'unir', 'juntar', 'combinar', 'fusionar', 'pegar', 'une estos pdfs',
            'junta los archivos', 'combina esto', 'mezclar', 'unelos',
            'pega estos documentos', 'uneme estos archivos en un solo pdf',
            'fusiona estos documentos', 'mezclar pdfs', 'armar un solo pdf', 'uneme estos dos pdfs',
            'juntame estos dos archivitos', 'junta estos dos pdfs', 'unir pdfs'
        ],
        pdf2img: [
            'pdf2img', 'pdf a foto', 'necesito las fotos de este pdf',
            'saca las fotos del documento pdf', 'extraer paginas', 'separar pdf',
            'desarmar pdf', 'separa este pdf', 'saca las fotos del pdf', 'desarma este pdf',
            'extrae las paginas como foto', 'pdf a imagenes', 'convertir pdf a imagenes',
            'sacale las fotos a este pdf'
        ],
        efecto: [
            'efecto', 'ardilla', 'voz lenta', 'voz de robot', 'voz grave', 'ponle filtro',
            'rapido', 'modificar voz', 'distorsionar', 'agudo', 'voz gruesa', 'diablo',
            'ponle efecto de ardilla', 'haz la voz lenta', 'voz de monstruo', 'voz de alvin',
            'ponle voz de ardilla a este audio', 'cambia este audio a voz lenta', 'ponle efecto al audio'
        ],
        qr: [
            'qr', 'codigo qr', 'escanear qr', 'crear qr', 'hazme un qr', 'codigo de barras',
            'haz un codigo qr', 'generar qr', 'crea un qr con esto', 'hazme un qr de este link'
        ],
        ayuda: [
            'ayuda', 'help', 'menu', 'comandos', 'lista de comandos', 'opciones',
            'sos', 'auxilio', 'que puedes hacer', 'como se usa', 'manual', 'que comandos tienes'
        ],
        drive: [
            'drive', 'subir a drive', 'subelo a drive', 'guardalo en mi drive',
            'guarda esto en drive', 'respaldalo en drive', 'respaldo drive',
            'espacio drive', 'cuanto espacio tengo en drive', 'subelo a mi drive'
        ],
        maicra: [
            'maicra', 'minecraft', 'server de minecraft', 'prende el server de maicra',
            'prende el servidor de minecraft', 'enciende el servidor de maicra', 'apaga el maicra',
            'apaga el server de minecraft', 'reinicia el server de maicra', 'reiniciar servidor de minecraft',
            'estado del servidor de minecraft', 'jugadores conectados al servidor', 'quienes estan en el servidor de minecraft', 'ping al servidor de minecraft'
        ]
    };

    for (const [intent, phrases] of Object.entries(coreCorpus)) {
        for (const phrase of phrases) {
            manager.addDocument('es', normalizeText(phrase), intent);
        }
    }

    // --- CARGA DINÁMICA DE MODISMOS MASIVOS (JSON) ---
    if (fs.existsSync(MODISMOS_PATH)) {
        try {
            const rawModismos = fs.readFileSync(MODISMOS_PATH, 'utf8');
            const modismosData = JSON.parse(rawModismos);
            let count = 0;
            for (const [intent, phrases] of Object.entries(modismosData)) {
                if (Array.isArray(phrases)) {
                    for (const phrase of phrases) {
                        const norm = normalizeText(phrase);
                        if (norm && norm.length >= 2) {
                            manager.addDocument('es', norm, intent);
                            count++;
                        }
                    }
                }
            }
            logger.info(`[NLP] Corpus ampliado con ${count} modismos y jergas desde '${MODISMOS_PATH}'.`);
        } catch (err) {
            logger.error(`[NLP] Error al cargar modismos desde '${MODISMOS_PATH}': ${err.message}`);
        }
    }

    // Moderación y Rankings
    ['ban', 'banea', 'kick', 'expulsar', 'sacalo del grupo', 'dale ban'].forEach(u => manager.addDocument('es', u, 'ban'));
    ['promote', 'admin', 'ascender', 'hazlo admin'].forEach(u => manager.addDocument('es', u, 'promote'));
    ['demote', 'degradar', 'quitar admin'].forEach(u => manager.addDocument('es', u, 'demote'));
    ['mute', 'silenciar', 'callar al usuario'].forEach(u => manager.addDocument('es', u, 'mute'));
    ['unmute', 'desmutear', 'desilenciar'].forEach(u => manager.addDocument('es', u, 'unmute'));
    ['warn', 'advertir', 'dar advertencia'].forEach(u => manager.addDocument('es', u, 'warn'));
    ['nivel', 'experiencia', 'rango', 'perfil', 'stats', 'mi nivel'].forEach(u => manager.addDocument('es', u, 'nivel'));
    ['top', 'ranking', 'mejores', 'clasificacion', 'tabla de niveles'].forEach(u => manager.addDocument('es', u, 'top'));
}

async function initializeNlp() {
    setupCorpus();
    logger.info('[NLP] Entrenando modelo de Lenguaje Natural Bayesiano...');
    await manager.train();
    
    // Asegurar directorio y guardar modelo en data y en la raíz
    const dataDir = path.dirname(MODEL_PATH);
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    manager.save(MODEL_PATH);

    // Guardado centralizado exclusivamente en data/model.nlp

    logger.info('[NLP] Modelo élite masivo entrenado y guardado exitosamente.');
}

async function processText(text) {
    if (!text || typeof text !== 'string') return null;
    const normalized = normalizeText(text);
    return await manager.process('es', normalized);
}

/**
 * Convierte un formato de tiempo flexible a HH:MM:SS o segundos.
 * Soporta: "1:30", "01:30", "2:15", "45", "1m 30s", "minuto 1", "minuto y medio", "cero", etc.
 */
function parseTimeString(str) {
    if (!str) return null;
    str = str.trim().toLowerCase();

    if (str === "minuto y medio" || str === "1 minuto y medio") return "00:01:30";
    if (str === "medio minuto") return "00:00:30";
    if (str === "cero") return "00:00:00";
    if (str === "minuto" || str === "un minuto") return "00:01:00";

    // 1m 30s o 1m 10s o 1m30s o 2m
    const mAndS = str.match(/^(\d+)\s*m(?:in(?:utos?)?)?(?:\s*(\d+)\s*s(?:eg(?:undos?)?)?)?$/);
    if (mAndS) {
        const mins = parseInt(mAndS[1], 10);
        const secs = mAndS[2] ? parseInt(mAndS[2], 10) : 0;
        return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }

    // MM:SS o H:MM:SS
    const timeMatch = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (timeMatch) {
        if (timeMatch[3]) {
            return `${String(timeMatch[1]).padStart(2, "0")}:${timeMatch[2]}:${timeMatch[3]}`;
        }
        return `00:${String(timeMatch[1]).padStart(2, "0")}:${timeMatch[2]}`;
    }

    // "minuto 1", "min 3"
    const minPre = str.match(/^(?:minuto|min|m)\s*(\d+)$/);
    if (minPre) {
        return `00:${String(minPre[1]).padStart(2, "0")}:00`;
    }

    // "segundo 10", "seg 45"
    const secPre = str.match(/^(?:segundo|seg|s)\s*(\d+)$/);
    if (secPre) {
        const s = parseInt(secPre[1], 10);
        return `00:${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
    }

    // "30 seg", "45s", "5 min", "5m"
    const numPost = str.match(/^(\d+)\s*(seg(?:undos?)?|min(?:utos?)?|s|m)$/);
    if (numPost) {
        const val = parseInt(numPost[1], 10);
        if (numPost[2].startsWith("m")) {
            return `00:${String(val).padStart(2, "0")}:00`;
        }
        return `00:${String(Math.floor(val / 60)).padStart(2, "0")}:${String(val % 60).padStart(2, "0")}`;
    }

    // Número simple
    const numOnly = str.match(/^(\d+)$/);
    if (numOnly) {
        const n = parseInt(numOnly[1], 10);
        if (n <= 10) return `00:${String(n).padStart(2, "0")}:00`;
        return `00:${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
    }

    return null;
}

/**
 * Extrae parámetros específicos (recortes de tiempo, rangos de páginas,
 * velocidades, calidades y nombres personalizados) a partir de lenguaje natural.
 */
function extractParameters(rawText) {
    if (!rawText || typeof rawText !== "string") return {};
    const text = rawText.toLowerCase();
    const params = {};

    // ─────────────────────────────────────────────────────────────
    // 1. TIEMPOS DE RECORTE
    // ─────────────────────────────────────────────────────────────
    const primMatch = text.match(/\b(?:l(?:os)?\s+)?primeros?\s+(\d+)\s*(seg(?:undos?)?|min(?:utos?)?|s|m)\b/);
    if (primMatch) {
        const val = parseInt(primMatch[1], 10);
        const unit = primMatch[2];
        params.ss = "00:00:00";
        if (unit.startsWith("m")) {
            params.to = `00:${String(val).padStart(2, "0")}:00`;
        } else {
            params.to = `00:00:${String(val).padStart(2, "0")}`;
        }
    }

    if (!params.ss) {
        const rangeMatch = text.match(/\b(?:del?|desde(?:\s+el)?|d)\s+([0-9:ms]+(?:\s*[0-9]+s)?|(?:el\s+)?(?:minuto|min|segundo|seg)\s+[0-9]+|[0-9]+\s*(?:seg|min|s|m)|minuto y medio|cero)\s+(?:al?|hasta(?:\s+el)?|a)\s+([0-9:ms]+(?:\s*[0-9]+s)?|(?:el\s+)?(?:minuto|min|segundo|seg)\s+[0-9]+|[0-9]+\s*(?:seg|min|s|m)|minuto|final|acabe)\b/);
        if (rangeMatch) {
            const startStr = rangeMatch[1].replace(/^el\s+/, "");
            const endStr = rangeMatch[2].replace(/^el\s+/, "");
            const startTime = parseTimeString(startStr);
            if (startTime) params.ss = startTime;
            if (endStr !== "final" && endStr !== "acabe") {
                const endTime = parseTimeString(endStr);
                if (endTime) params.to = endTime;
            }
        }
    }

    if (!params.ss) {
        const fwdMatch = text.match(/\b(?:del?|desde(?:\s+el)?|a\s+partir\s+del?)\s+([0-9:ms]+|(?:minuto|min|segundo|seg)\s+[0-9]+|[0-9]+\s*(?:seg|min|s|m))\s*(?:en adelante|pa\s*lante|pa\s*delante|para\s*adelante|hasta\s*el\s*final|hasta\s*q\s*acabe)?\b/);
        if (fwdMatch && (text.includes("adelante") || text.includes("delante") || text.includes("lante") || text.includes("final") || text.includes("acabe") || text.includes("a partir") || text.includes("desde"))) {
            const startTime = parseTimeString(fwdMatch[1]);
            if (startTime) params.ss = startTime;
        }
    }

    if (!params.ss) {
        const singleTimeMatch = text.match(/\b(?:corta(?:lo)?\s+(?:en|desde)|deja\s+desde|desde\s+el?|en\s+el)\s+([0-9]{1,2}:[0-9]{2}|minuto\s+[0-9]+|minuto y medio)\b/);
        if (singleTimeMatch) {
            const startTime = parseTimeString(singleTimeMatch[1]);
            if (startTime) params.ss = startTime;
        }
    }

    // ─────────────────────────────────────────────────────────────
    // 2. RANGO DE PÁGINAS
    // ─────────────────────────────────────────────────────────────
    const pageRangeMatch = text.match(/\b(?:de\s+la\s+|p[aá]ginas?\s+|hojas?\s+|d\s+la\s+|del?\s+|desde\s+la\s+)(?:p[aá]g(?:ina)?\s+|pajina\s+|ojita\s+|hoja\s+)?(\d+)\s*(?:a\s*(?:la\s*)?|al\s*|hasta\s*(?:la\s*)?)(?:p[aá]g(?:ina)?\s+|pajina\s+|ojita\s+|hoja\s+)?(\d+)\b/);
    if (pageRangeMatch) {
        params.pages = `${pageRangeMatch[1]}-${pageRangeMatch[2]}`;
    } else {
        const primPagMatch = text.match(/\bprimeras?\s+(\d+)\s*(?:p[aá]ginas?|pags?|hojas?)\b/);
        if (primPagMatch) {
            params.pages = `1-${primPagMatch[1]}`;
        } else {
            const fwdPagMatch = text.match(/\b(?:de\s+la\s+|p[aá]ginas?\s+|hojas?\s+|a\s+partir\s+de\s+la\s+hoja\s+|d\s+la\s+p[aá]gina\s+|desde\s+la\s+pag\s+)(\d+)\s*(?:en\s*adelante|en\s*delante)?\b/);
            if (fwdPagMatch && (text.includes("adelante") || text.includes("delante") || text.includes("a partir") || text.includes("desde"))) {
                params.pages = `${fwdPagMatch[1]}-`;
            } else {
                const soloPagMatch = text.match(/\b(?:solo\s*(?:kiero|qiero|dejame|ocuppo)?\s*(?:la\s*)?|saca\s*solo\s*(?:la\s*)?|dame\s*la\s*|mandame\s*la\s*pura\s*|sacale\s*la\s*|extrae\s*la\s*|convierte\s*la\s*|la\s*purita\s*)(?:p[aá]g(?:ina)?|pajina|ojita|hoja)\s*(\d+)\b/);
                if (soloPagMatch) {
                    params.pages = `${soloPagMatch[1]}`;
                } else {
                    const simplePagMatch = text.match(/\b(?:p[aá]g(?:ina)?|pajina|ojita|hoja)\s*(\d+)\b/);
                    if (simplePagMatch) {
                        params.pages = `${simplePagMatch[1]}`;
                    } else {
                        const multiPags = text.match(/\b(?:p[aá]ginas?|hojas?)\s+(\d+(?:\s*(?:,|y)\s*\d+)+)\b/);
                        if (multiPags) {
                            params.pages = multiPags[1].replace(/\s*y\s*/g, ",").replace(/\s+/g, ",");
                        }
                    }
                }
            }
        }
    }

    // ─────────────────────────────────────────────────────────────
    // 3. VELOCIDAD DE AUDIO
    // ─────────────────────────────────────────────────────────────
    const speedMatch = text.match(/\b(?:x\s*([0-2](?:\.[0-9]+)?)|([0-2](?:\.[0-9]+)?)\s*x)\b/);
    if (speedMatch) {
        params.speed = parseFloat(speedMatch[1] || speedMatch[2]);
    } else {
        const velMatch = text.match(/\b(?:vel(?:ocidad)?\s*(?:a|d)?|ralentizalo\s+a|a)\s+([0-2](?:\.[0-9]+)?)(?:\s*d\s*vel)?\b/);
        if (velMatch) {
            params.speed = parseFloat(velMatch[1]);
        } else if (text.match(/\b(?:al\s*doble|velocidad\s+doble|doble\s*vel)\b/)) {
            params.speed = 2.0;
        } else if (text.match(/\bc[aá]mara\s*lenta\b/)) {
            params.speed = 0.5;
        }
    }

    // ─────────────────────────────────────────────────────────────
    // 4. RESOLUCIONES Y CALIDADES NUMÉRICAS
    // ─────────────────────────────────────────────────────────────
    const resMatch = text.match(/\b(144|240|360|480|720|1080)\s*p?\b/);
    if (resMatch) {
        params.q = resMatch[1];
    } else if (text.match(/\b4k\b/)) {
        params.q = "1080";
    }

    const bitMatch = text.match(/\b(128|192|256|320)\s*kbps\b/);
    if (bitMatch) {
        params.bitrate = `${bitMatch[1]}k`;
    }

    // ─────────────────────────────────────────────────────────────
    // 5. NOMBRE DE ARCHIVO PERSONALIZADO
    // ─────────────────────────────────────────────────────────────
    const mDoc = text.match(/\bponle\s+([a-zA-Z0-9_\-\.]+)\s+al\s+(?:doc|documento|archivo|video|audio|pdf|uord|word)\b/);
    if (mDoc) {
        params.customName = mDoc[1].trim();
    } else {
        const mLlame = text.match(/(?:(?:se|c)\s*(?:llame|yame)|as\s*(?:k|que|q)\s*(?:se|c)\s*(?:llame|yame)|(?:el\s+[a-z]+\s+)(?:se|c)\s*(?:llame|yame))\s+([a-zA-Z0-9_\-\.]+)/);
        if (mLlame) {
            params.customName = mLlame[1].trim();
        } else {
            const mGen = text.match(/\b(?:guardal[oa]|guardatel[oa]|q(?:ue)?\s*(?:se|c)\s*guarde|k\s*qede|q\s*se\s*guarde\s*bajo\s*el\s*nombre)\s*(?:como|cm|cmo)?\s+([a-zA-Z0-9_\-\.]+)/);
            if (mGen) {
                params.customName = mGen[1].trim();
            } else {
                const mNom = text.match(/\b(?:nombral[oa]|titulal[oa]|ponle\s+(?:de\s+|d\s+)?nombre(?:\s+de)?|con\s+(?:el\s+)?(?:nombre|titulo)(?:\s+de)?|q\s+lleve\s+d\s+nombre|ponle)\s+([a-zA-Z0-9_\-\.]+)/);
                if (mNom) params.customName = mNom[1].trim();
            }
        }
    }

    return params;
}

module.exports = {
    initializeNlp,
    processText,
    normalizeText,
    extractParameters,
    parseTimeString
};
