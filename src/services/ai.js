'use strict';

const axios = require('axios');
const logger = require('./logger');

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
        return JSON.parse(raw);
    } catch (err) {
        logger.warn('[AI] routeWithAI error o timeout:', err.response?.data?.error?.message || err.message);
        return null;
    }
}

module.exports = {
    generateLoreChronicle,
    chatWithLlama,
    routeWithAI
};
