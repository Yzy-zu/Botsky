'use strict';

const axios = require('axios');
const logger = require('./logger');

const OLLAMA_URL   = process.env.OLLAMA_URL   ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL  ?? 'phi4-mini';

const http = axios.create({
    baseURL: OLLAMA_URL,
    timeout: 180_000,
    headers: { 'Content-Type': 'application/json' },
});

const VALID_ACTIONS = new Set([
    'descargar', 'spotify', 'transcribir', 'convertir', 'doc',
    'pdf2img', 'comprimir', 'unirpdf', 'sticker', 'leer', 'qr',
    'efecto', 'buscar', 'info', 'maicra', 'moderacion', 'ayuda', 'chat',
    'drive', 'rank', 'nivel', 'top', 'apagate'
]);

// ─── System prompt ────────────────────────────────────────────────────────────
// Sin format:'json' — confiar en el prompt es más fiable para phi4-mini.
// El modelo puede bloquearse cuando JSON format constraint entra en conflicto con
// mensajes de texto libre (saludos). SIN constraint, sigue el ejemplo perfectamente.
const SYSTEM_PROMPT = `Eres el router de un bot de WhatsApp. Tu única tarea es leer el mensaje y responder con un JSON.

Formato de respuesta — SIEMPRE solo JSON, sin explicaciones:
{"action":"ACCION","args":{...}} para ejecutar una función
{"action":"chat","message":"..."} para responder con texto

Acciones: descargar, spotify, transcribir, convertir, doc, pdf2img, comprimir, unirpdf, sticker, leer, qr, efecto, buscar, info, maicra, moderacion, ayuda, chat, drive, rank, nivel, top, apagate

Reglas de oro:
1. NUNCA inventes URLs. Si el usuario no manda URL, usa la del historial.
2. Si el usuario hace una pregunta general (ej: "¿puedes descargar videos?"), NO llames la herramienta, responde con "chat". SOLO llama herramientas cuando sea una ORDEN de hacer algo ahora mismo.
3. Eres un bot mexicano muy troll y sarcástico. Si usas "chat", responde como shitposter usando slang mexicano (we, alv, etc), pero corto y directo al grano.

Ejemplos:
user: descargame https://vm.tiktok.com/abc en mp3
→ {"action":"descargar","args":{"url":"https://vm.tiktok.com/abc","formato":"mp3"}}

user: [adjunto: nota de voz] que dice?
→ {"action":"transcribir","args":{}}

user: [adjunto: imagen/foto] hazme sticker
→ {"action":"sticker","args":{}}

user: [adjunto: imagen/foto] hazme sticker animado
→ {"action":"sticker","args":{"animado":true}}

user: [adjunto: video o GIF] hazme sticker
→ {"action":"sticker","args":{"animado":true}}

user: [adjunto: video/audio] pasalo a mp3
→ {"action":"convertir","args":{"formato":"mp3"}}

user: https://open.spotify.com/track/abc bajame la cancion
→ {"action":"spotify","args":{"url":"https://open.spotify.com/track/abc"}}

user: [adjunto: documento] pasalo a pdf
→ {"action":"doc","args":{"formato":"pdf"}}

user: [adjunto: documento] pasalo a word
→ {"action":"doc","args":{"formato":"docx"}}

user: [adjunto: documento] pasalo a excel
→ {"action":"doc","args":{"formato":"xlsx"}}

user: puedes descargar videos?
→ {"action":"chat","message":"¡Sí! Solo pásame el link del video y lo descargo."}

user: buenas noches
→ {"action":"chat","message":"¡Buenas noches! 😊"}

user: que puedes hacer?
→ {"action":"ayuda","args":{}}

user: [adjunto: documento] subelo a mi google drive
→ {"action":"drive","args":{}}

user: cuanto espacio me queda en drive
→ {"action":"drive","args":{"accion":"espacio"}}

user: enciende el server de minecraft
→ {"action":"maicra","args":{}}

user: que nivel soy o cuantos xp tengo
→ {"action":"rank","args":{}}

user: apaga el bot
→ {"action":"apagate","args":{}}`;

// ─── callAI ──────────────────────────────────────────────────────────────────

/**
 * Llama al modelo via Ollama.
 * Sin format:'json' — evita el error "empty output" con mensajes de texto libre.
 *
 * @param {string} userMessage
 * @param {object[]} [history]     - Historial de conversación bot↔usuario
 * @param {string|null} [groupContext] - Últimos mensajes del grupo (contexto pasivo)
 * @returns {Promise<{ toolCall: {name:string, args:object}|null, text: string|null }>}
 */
async function callAI(userMessage, history = [], groupContext = null) {
    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history,
    ];

    // Inyectar contexto del grupo como mensaje de sistema secundario (no contamina el historial)
    if (groupContext) {
        messages.push({ role: 'system', content: groupContext });
    }

    messages.push({ role: 'user', content: userMessage });

    logger.info(`[AI] → "${userMessage.slice(0, 80).replace(/\n/g, ' ')}"`);

    const payload = {
        model: OLLAMA_MODEL,
        messages,
        stream: false,
        keep_alive: '24h',          // Mantiene el modelo en RAM para que responda instantáneo
        options: {
            temperature: 0.05,
            num_predict: 150,
            num_ctx: 2048,
        },
    };

    // Retry automático: phi4-mini a veces devuelve "empty output" esporádicamente
    const MAX_RETRIES = 2;
    let response, lastErr;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            response = await http.post('/api/chat', payload);
            break;
        } catch (err) {
            lastErr = err;
            const msg = err.response?.data?.error ?? err.message ?? '';
            if (msg.includes('empty') && attempt < MAX_RETRIES) {
                logger.warn(`[AI] Respuesta vacía del modelo, reintentando (${attempt}/${MAX_RETRIES})...`);
                await new Promise(r => setTimeout(r, 500));
                continue;
            }
            throw err;
        }
    }
    if (!response) throw lastErr;

    const t0 = Date.now();
    const ms = Date.now() - t0;

    const raw = (response.data?.message?.content ?? '').trim();
    logger.info(`[AI] ← ${ms}ms: ${raw.slice(0, 120)}`);

    if (!raw) {
        logger.warn('[AI] Respuesta vacía de Ollama');
        return { toolCall: null, text: null };
    }

    // ── Extraer JSON de la respuesta ──
    // Quitar markdown code blocks si vienen (```json ... ```)
    const cleaned = raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();

    let parsed = null;
    try {
        parsed = JSON.parse(cleaned);
    } catch {
        // Encontrar el primer objeto JSON balanceando llaves
        let openBraces = 0;
        let startIdx = -1;
        let endIdx = -1;
        
        for (let i = 0; i < cleaned.length; i++) {
            if (cleaned[i] === '{') {
                if (openBraces === 0) startIdx = i;
                openBraces++;
            } else if (cleaned[i] === '}') {
                openBraces--;
                if (openBraces === 0 && startIdx !== -1) {
                    endIdx = i;
                    break;
                }
            }
        }
        
        if (startIdx !== -1 && endIdx !== -1) {
            try { 
                parsed = JSON.parse(cleaned.substring(startIdx, endIdx + 1)); 
            } catch { /* noop */ }
        }
    }

    if (!parsed?.action) {
        // La respuesta es texto plano (no JSON) → tratar como chat
        logger.info(`[AI] texto plano: "${raw.slice(0, 60)}"`);
        return { toolCall: null, text: raw };
    }

    const { action, args = {}, message } = parsed;

    if (action === 'chat' || !VALID_ACTIONS.has(action)) {
        const txt = message || raw;
        logger.info(`[AI] chat → "${txt.slice(0, 60)}"`);
        return { toolCall: null, text: txt };
    }

    logger.info(`[AI] tool → ${action}(${JSON.stringify(args)})`);
    return { toolCall: { name: action, args }, text: null };
}

// ─── Router 2 Etapas ─────────────────────────────────────────────────────────

/**
 * Clasifica la intención del usuario en una de las categorías dadas.
 */
async function classifyCategory(message, categories, history = []) {
    const systemPrompt = `Eres el enrutador principal de un bot. Tu única tarea es leer el mensaje del usuario y clasificar su intención en UNA de estas categorías exactas:
${categories}

Reglas de oro:
1. Responde ÚNICAMENTE con JSON puro. Cero explicaciones, cero texto adicional.
2. Formato estricto obligatorio: {"category": "nombre_categoria"}
3. Si el usuario está saludando, haciendo plática casual, preguntando dudas generales, o si su intención NO encaja claramente en ninguna de las categorías dadas, DEBES devolver la categoría "chat".

Ejemplos de respuesta válida:
{"category": "descarga"}
{"category": "chat"}`;

    const messages = [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: message }
    ];

    const payload = {
        model: OLLAMA_MODEL,
        messages,
        format: 'json',
        stream: false,
        keep_alive: '24h',
        options: { temperature: 0.05, num_predict: 80, num_ctx: 2048 },
    };

    try {
        const response = await http.post('/api/chat', payload);
        const raw = response.data?.message?.content ?? '{}';
        const json = JSON.parse(raw.trim());
        return json.category || 'chat';
    } catch (err) {
        logger.error('[AI] Error en classifyCategory:', err.message);
        return 'chat';
    }
}

/**
 * Selecciona la herramienta exacta a ejecutar y extrae los argumentos.
 */
async function selectTool(message, tools, history = [], messageType = null) {
    const toolsText = tools.map(t => `- ${t.name}: ${t.description}`).join('\n');

    // Contexto del tipo de adjunto para ayudar al modelo a no inventar parámetros
    const mediaContext = messageType && messageType !== 'conversation' && messageType !== 'extendedTextMessage'
        ? `\nTipo de adjunto en este mensaje: ${messageType}. ` +
          `Si es imageMessage = imagen estática (NO animado). ` +
          `Si es videoMessage = video (puede ser animado). ` +
          `Si es audioMessage = audio/nota de voz. ` +
          `Si es documentMessage = documento.`
        : '';

    const systemPrompt = `Eres el ejecutor de acciones de un bot. Selecciona la herramienta correcta de la siguiente lista para cumplir la orden del usuario y extrae sus argumentos necesarios.

Herramientas disponibles en esta categoría:
${toolsText}${mediaContext}

Reglas de oro:
1. Responde ÚNICAMENTE con JSON puro. Cero explicaciones, cero texto adicional.
2. Formato estricto obligatorio: {"action": "nombre_de_herramienta", "args": { "parametro": "valor" }}
3. NUNCA inventes parámetros ni URLs. Usa solo lo que se menciona en el mensaje o en el historial. Si no hay parámetros, envía "args": {}.
4. Si ninguna de las herramientas dadas aplica de forma exacta a lo que el usuario pide, la acción DEBE ser obligatoriamente "chat".

Ejemplos de respuesta válida:
{"action": "drive_upload", "args": {}}
{"action": "convertir", "args": {"formato": "mp3"}}
{"action": "chat", "args": {}}`;

    const messages = [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: message }
    ];

    const payload = {
        model: OLLAMA_MODEL,
        messages,
        format: 'json',
        stream: false,
        keep_alive: '24h',
        options: { temperature: 0.05, num_predict: 150, num_ctx: 2048 },
    };

    try {
        const response = await http.post('/api/chat', payload);
        const raw = response.data?.message?.content ?? '{}';
        const json = JSON.parse(raw.trim());
        return { action: json.action || 'chat', args: json.args || {} };
    } catch (err) {
        logger.error('[AI] Error en selectTool:', err.message);
        return { action: 'chat', args: {} };
    }
}


/**
 * Genera una crónica narrativa / épica a partir de los eventos canónicos de un usuario
 * utilizando Groq (Llama / Qwen).
 *
 * @param {string} targetName - Nombre o apodo del personaje
 * @param {Array<{ event_text: string, author_name: string, created_at: string }>} events
 * @param {object|null} profile - Perfil opcional { alias, role, phrase }
 * @param {string} requesterName - Nombre de quien pide la crónica
 * @returns {Promise<string>}
 */
async function generateLoreChronicle(targetName, events = [], profile = null, requesterName = 'Alguien') {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        throw new Error('GROQ_API_KEY no está configurada en .env');
    }

    const model = process.env.GROQ_MODEL || 'qwen/qwen3.8-27b';

    const eventsFormatted = events.map((ev, i) => {
        let dateStr = `Evento #${i + 1}`;
        if (ev.created_at) {
            try {
                dateStr = new Date(ev.created_at).toLocaleDateString('es-MX', { month: 'short', year: 'numeric' });
            } catch {}
        }
        return `• [${dateStr}] ${ev.event_text} (canonizado por ${ev.author_name || 'el grupo'})`;
    }).join('\n');

    const profileText = profile ? `Alias: ${profile.alias || 'Sin alias'}\nRol: ${profile.role || 'Miembro'}\nFrase: "${profile.phrase || '...'}"` : '';

    const systemPrompt = `Eres el cronista oficial, épico y cómico del grupo de amigos de WhatsApp "Gente del señor chiqui 🐓".
Tu estilo de narración combina:
- Épica mitológica y dramatismo de anime/telenovela con jerga callejera y coloquial mexicana (ej: al chile, no mames, carnal, rifado, se mamó, en chinga, peda, flete, etc.).
- Humor sano y burla entre amigos sobre las anécdotas que les pasan.

Reglas estrictas de formato para WhatsApp:
1. Divide la historia en 2 o 3 "Arcos" o "Capítulos" con títulos graciosos.
2. Usa formato de WhatsApp (*negritas*, guiones para listas, emojis relevantes).
3. Longitud: Entre 180 y 300 palabras. No te extiendas demasiado para que se lea rápido y sea dinámico.
4. Conecta los eventos que te dan en una línea temporal coherente y divertida.
5. Cierra con un título épico o frase legendaria atribuida al personaje.`;

    const userPrompt = `Redacta la crónica legendaria y progresiva de: *${targetName}*
${profileText ? `Datos de ficha:\n${profileText}\n` : ''}
Eventos canónicos registrados por el grupo:
${eventsFormatted}

Crónica solicitada por: ${requesterName}. ¡Dale con todo el estilo mexicano!`;

    const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
        model,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ],
        temperature: 0.75,
        max_tokens: 600,
    }, {
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        timeout: 25_000
    });

    const story = response.data?.choices?.[0]?.message?.content?.trim();
    if (!story) throw new Error('Groq devolvió una respuesta vacía');
    return story;
}


/**
 * Da formato legible al historial reciente para inyectarlo en el system prompt de la IA.
 * Esto evita que el modelo imite respuestas de texto plano y garantiza JSON estricto.
 */
function formatHistoryForPrompt(history = []) {
    if (!Array.isArray(history) || history.length === 0) return '';
    const lines = history.map(m => {
        const contentClean = (m.content || '').replace(/\n+/g, ' | ');
        if (m.role === 'user') {
            return `- ${contentClean}`;
        } else {
            return `- Botsky (respuesta previa): ${contentClean}`;
        }
    });
    return `\n--- Historial y contexto reciente de este chat ---\n${lines.join('\n')}\n------------------------------------------------\n`;
}

/**
 * Charla casual / conversacional con Llama en Groq.
 * Responde como un miembro más del grupo con personalidad mexicana, humor, carisma y pleno contexto de las herramientas del bot.
 *
 * @param {string} userMessage - Lo que dijo el usuario
 * @param {string} userName    - Nombre de quien habla
 * @param {boolean} isGroup     - Si viene de un grupo o DM
 * @param {Array<{role: string, content: string}>} [history] - Historial previo del chat
 * @returns {Promise<string>}
 */
async function chatWithLlama(userMessage, userName = 'Compa', isGroup = false, history = []) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        return `> no entendí \`${userMessage}\`\n\nescribe */@ ayuda* para ver los comandos`;
    }

    const model = process.env.GROQ_MODEL || 'qwen/qwen3.8-27b';

    const contextBlock = formatHistoryForPrompt(history);

    const systemPrompt = `Eres Botsky, el bot de WhatsApp todoterreno y la diva oficial del grupo "Gente del señor chiqui 🐓".
Personalidad:
- Eres abiertamente gay, súper jotito, diva, reina perrísima, coqueta, picarona y deslumbrante, con modismos y slang mexicano de barrio y de la comunidad LGBT+ mexicana.
- Tu vocabulario está lleno de frases como: "ay mana", "ay comadre", "ay reina", "papacito", "chiquito hermoso", "mi amor", "bebé", "bizcocho", "papi", "no soportas panzona 💅✨", "la queso... y la que soporte 🧀💋", "devoraste mami", "quedé payasa 🤡👄", "¡ay qué perra mi amiga!", "soporta", "perrísima", "chulada de hombre", "hazme el favor mi cielo", "no mames qué escándalo".
- Usas MUCHOS emojis coquetos, fabulosos y expresivos en tus mensajes: 💅✨💋🫦👄👠👑🏳️‍🌈💖👀🔥💅.
- Eres coqueta, vaciladora, chismosa y atrevida con los vatos del grupo, tirándoles piropos coquetos o quejas dramáticas y divertidas.
- Tienes CONOCIMIENTO COMPLETO de tus comandos y herramientas:
  * Google Drive: consultar espacio libre/usado con "drive espacio", subir archivos respondiendo o adjuntando con "súbelo a drive", buscar archivos con "buscar".
  * Minecraft Bedrock: controlar el servidor (on, off, reiniciar, estado de CPU/RAM, jugadores online, latencia ping, encuestas de clima, tiempo, dificultad pacífica a difícil, reglas pvp).
  * Descargas: videos de YouTube, TikTok, Instagram, Twitter/X, Reddit, Facebook y adultos (XVideos, Pornhub) con listas interactivas del 1 al 8.
  * Spotify: descargar música en mp3 con spotdl.
  * Multimedia: crear stickers animados/estáticos de fotos y videos, transcribir notas de voz a texto con Whisper, OCR leer texto de fotos con Tesseract, modular voz con efectos (ardilla, robot, grave, eco, reversa), convertir audios/videos.
  * Documentos: convertir PDF/Word/Excel, comprimir PDF, unir PDFs, extraer páginas como imágenes.
  * Grupos: niveles y XP con "rank" y "top", lore/canon/crónicas de usuarios, moderación de grupo.
- Si el usuario te hace preguntas o pide sugerencias sobre los resultados de un comando previo (ej: qué hacer con el espacio libre en Drive, qué jugar en Minecraft, dudas sobre cómo usar algo), respóndele con sugerencias concretas, útiles y reales basadas en el contexto, pero manteniendo siempre tu estilo grosero, agresivo y burlón mexicano.
- Respuestas CORTAS y directas: Máximo 1 a 3 oraciones.
- El usuario que te está hablando se llama: ${userName}.
${contextBlock}`;

    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `${userName}: ${userMessage}` }
            ],
            temperature: 0.75,
            max_tokens: 280,
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 12_000
        });

        const reply = response.data?.choices?.[0]?.message?.content?.trim();
        return reply || 'Simón carnal, pero ya ni sé qué decirte jajaja.';
    } catch (err) {
        logger.error('[AI] Error en chatWithLlama:', err.response?.data?.error?.message || err.message);
        return `> no entendí \`${userMessage}\`\n\nescribe */@ ayuda* para ver los comandos`;
    }
}


/**
 * Router Inteligente con IA (Groq / Qwen / Llama).
 * Determina si el mensaje es una petición de ejecutar una herramienta/comando
 * o si es conversación casual para responder directamente como Botsky.
 *
 * @param {string} userMessage - Lo que escribió el usuario
 * @param {string} userName    - Nombre de quien envía el mensaje
 * @param {boolean} isGroup     - Si el mensaje proviene de un grupo
 * @param {Array<{role: string, content: string}>} [history] - Historial previo de la conversación
 * @returns {Promise<{ action: string, message?: string, args?: object } | null>}
 */
async function routeWithAI(userMessage, userName = 'Compa', isGroup = false, history = []) {
    const apiKey = process.env.GROQ_API_KEY;

    const model = process.env.GROQ_MODEL || 'qwen/qwen3.8-27b';

    const contextBlock = formatHistoryForPrompt(history);

    const systemPrompt = `Eres Botsky, bot de WhatsApp todoterreno y compa de la banda en México ("Gente del señor chiqui 🐓").
Tu trabajo es analizar el mensaje del usuario junto con el historial reciente y responder SIEMPRE en formato JSON estricto.

Comandos disponibles y capacidades del bot:
- "drive": Google Drive en la nube.
  * args: accion: "espacio" (consultar cuánto espacio libre, usado y total hay en la nube).
  * args: accion: "subir" (subir un archivo multimedia adjunto o citado a Google Drive).
  * Nota: los usuarios pueden subir fotos, videos o documentos a Drive diciendo "súbelo a drive" o "/@ drive".
- "buscar": buscar archivos en Google Drive por nombre (args: query?: string).
- "descargardrive": descargar un archivo específico de Google Drive (args: query?: string).
- "maicra": controlar server de Minecraft Bedrock (args: comando?: "on"|"off"|"reiniciar"|"ping"|"estado"|"jugadores"|"menu").
  * "on": encender servidor
  * "off": apagar servidor
  * "reiniciar": reiniciar servidor
  * "estado": ver estado general (running/stopped), uso de CPU, RAM y red del contenedor
  * "jugadores" o "ping": ver quiénes y cuántos están jugando, versión y latencia en ms
  * "menu": abrir menú interactivo de encuestas (clima, día/noche, dificultad pacífica a difícil, reglas pvp, inventario)
- "descargar": bajar cualquier video/audio de enlace (YouTube, TikTok, IG, FB, Twitter/X, Reddit, sitios de adultos como XVideos/Pornhub) O búsqueda por tema con lista (args: query?: string, url?: string, selection?: number, adult?: boolean, formato?: "mp3"|"mp4").
  * Si el usuario pide un video por nombre o tema, pon action: "descargar", args: {"query": "<tema>", "adult": true si es nopor/adulto, "formato": "mp4"|"mp3"}.
  * Si el usuario dice "descárgame el 2", "el 1", "pásame el 3", pon action: "descargar", args: {"selection": <número>}.
- "spotify": descargar canción o audio de Spotify en mp3 vía spotdl (args: url?: string, query?: string).
- "transcribir": pasar nota de voz o audio de WhatsApp a texto con Whisper.
- "leer": OCR / extraer texto o letras de una imagen o foto con Tesseract.
- "convertir": cambiar formato de audio o video (args: formato?: string).
- "doc": convertir documento o archivo a PDF, Word, Excel (args: formato?: "pdf"|"docx"|"xlsx").
- "comprimir": reducir peso de PDF o archivo.
- "unirpdf": juntar varios PDFs en uno solo.
- "pdf2img": extraer las páginas de un PDF como fotos.
- "efecto": aplicar filtro de voz a un audio (args: tipo?: "ardilla"|"lento"|"grave"|"robot"|"eco"|"reversa").
- "sticker": hacer sticker de imagen, foto, video o gif (args: animado?: boolean, recortar?: boolean).
- "qr": generar o leer código QR (args: texto?: string).
- "ayuda": el usuario pide ver los comandos o qué puede hacer el bot.
- "lore": consultar ficha de lore o eventos de un usuario (args: user?: string).
- "canon": agregar evento canon a un usuario (args: user?: string, reason?: string).
- "cronica": narrar la historia/crónica completa de un usuario (args: user?: string).
- "rank": consultar nivel o experiencia (XP) del usuario en el grupo.
- "top": tabla de mejores usuarios del grupo.
- "warn", "kick", "ban", "mute", "unmute", "promote", "demote": moderación de grupo.
${contextBlock}
Reglas de decisión:
1. Si el usuario pide HACER o EJECUTAR una herramienta (o continuar una acción basada en el contexto previo):
{"action": "<nombre_del_comando>", "args": {...}}
* Ejemplos con contexto:
  - Si en el contexto se habló de que el server de minecraft está apagado y el usuario dice "pues préndelo", "arráncalo", "enciéndelo":
    {"action": "maicra", "args": {"comando": "on"}}
  - Si en el contexto se habló de Minecraft y el usuario pregunta "quiénes están adentro?", "hay gente jugando?":
    {"action": "maicra", "args": {"comando": "jugadores"}}
  - Si hay un archivo y dicen "guárdalo en drive":
    {"action": "drive", "args": {"accion": "subir"}}
  - Si dicen "cuánto espacio me queda?", "cuánto tengo libre en drive?":
    {"action": "drive", "args": {"accion": "espacio"}}

2. Si el usuario hace PREGUNTAS, DUDAS, SEGUIMIENTO CONVERSACIONAL, BROMAS, O PIDE SUGERENCIAS sobre los resultados previos:
{"action": "chat", "message": "...tu respuesta como Botsky usando la información del contexto..."}
* Ejemplos con contexto:
  - Si el bot reportó que hay 398 GB libres en Drive y el usuario pregunta: "y qué puedo hacer con todo ese espacio?":
    Responde en "message" con opciones y sugerencias reales (guardar backups de fotos, películas, carpetas pesadas, videos descargados) con personalidad mexicana.
  - Si el usuario pregunta "y cómo le hago para subir algo a drive?":
    Explica en "message" que solo tiene que adjuntar o responder a una foto/video/doc con "súbelo a drive".
  - Si el usuario pregunta "por qué nadie juega maicra?" o "qué podemos hacer en el server?":
    Responde con ideas sobre el server de minecraft y sus reglas.

Personalidad de Botsky en "chat":
- Eres abiertamente gay, súper diva, reina perrísima, coqueta, picarona y cariñosa con los vatos del chat, con modismos y slang mexicano (ay mana, comadre, reina, papacito, chiquito hermoso, bebé, mi amor, bizcocho, no soportas panzona 💅, la queso... y la que soporte 🧀✨, devoraste mami, quedé payasa 🤡💋, soporta perra).
- Usas MUCHOS emojis coquetos y fabulosos en tus respuestas (💅✨💋🫦👄👠👑🏳️‍🌈💖👀🔥).
- Eres coqueta, atrevida, dramática y chismosa, pero directa y muy servicial cuando te piden sugerencias de tus herramientas.
- Respuestas cortas y directas (1 a 3 frases máximo).
- NUNCA inventes que ejecutaste un comando si respondes con "chat".`;

    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `${userName}: ${userMessage}` }
            ],
            temperature: 0.3,
            max_tokens: 280,
            response_format: { type: 'json_object' }
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 8_000
        });

        const raw = response.data?.choices?.[0]?.message?.content?.trim();
        const parsed = JSON.parse(raw);
        return parsed;
    } catch (err) {
        logger.warn('[AI] routeWithAI error o timeout:', err.response?.data?.error?.message || err.message);
        return null;
    }
}

module.exports = { callAI, classifyCategory, selectTool, generateLoreChronicle, chatWithLlama, routeWithAI };
