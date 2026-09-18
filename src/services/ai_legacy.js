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

Ejemplos:
user: descargame https://vm.tiktok.com/abc en mp3
→ {"action":"descargar","args":{"url":"https://vm.tiktok.com/abc","formato":"mp3"}}

user: [adjunto: nota de voz] que dice?
→ {"action":"transcribir","args":{}}

user: [adjunto: imagen/video] hazme sticker animado
→ {"action":"sticker","args":{"animado":true}}

user: [adjunto: video/audio] pasalo a mp3
→ {"action":"convertir","args":{"formato":"mp3"}}

user: https://open.spotify.com/track/abc bajame la cancion
→ {"action":"spotify","args":{"url":"https://open.spotify.com/track/abc"}}

user: [adjunto: documento] pasalo a pdf
→ {"action":"doc","args":{"formato":"pdf"}}

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
 * Llama a phi4-mini via Ollama.
 * Sin format:'json' — evita el error "empty output" con mensajes de texto libre.
 *
 * @param {string} userMessage
 * @param {object[]} [history]
 * @returns {Promise<{ toolCall: {name:string, args:object}|null, text: string|null }>}
 */
async function callAI(userMessage, history = []) {
    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history,
        { role: 'user', content: userMessage },
    ];

    logger.info(`[AI] → "${userMessage.slice(0, 80).replace(/\n/g, ' ')}"`);

    const payload = {
        model: OLLAMA_MODEL,
        messages,
        stream: false,
        keep_alive: '24h',          // Mantiene el modelo en RAM para que responda instantáneo
        options: {
            temperature: 0.05,
            num_predict: 200,
            num_ctx: 4096,          // Baja de 131k a 4k tokens, acelera enormemente en CPU
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

module.exports = { callAI };
