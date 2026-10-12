'use strict';

const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const logger = require('./logger');

const GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const DEFAULT_MODEL = 'whisper-large-v3-turbo';

/**
 * Transcribe un archivo de audio usando Groq Whisper (ultra-rápido en la nube, ~300-500ms).
 * Con fallback automático a Gemini si Groq falla.
 *
 * @param {string} audioPath - Ruta local al archivo de audio (ogg, mp3, m4a, wav, etc.)
 * @param {object} options - { model, language, prompt }
 * @returns {Promise<{ text: string, duration: number|null, language: string|null }>}
 */
async function transcribeAudio(audioPath, options = {}) {
    if (!fs.existsSync(audioPath)) {
        throw new Error(`Archivo de audio no encontrado: ${audioPath}`);
    }

    const groqKey = process.env.GROQ_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    if (!groqKey && !geminiKey) {
        throw new Error('Faltan claves de API: GROQ_API_KEY o GEMINI_API_KEY requeridas para transcripción.');
    }

    // ── Intento principal: Groq Whisper Cloud (whisper-large-v3-turbo) ──
    if (groqKey) {
        try {
            const form = new FormData();
            form.append('file', fs.createReadStream(audioPath));
            form.append('model', options.model || DEFAULT_MODEL);
            form.append('response_format', 'verbose_json');
            form.append('temperature', '0');

            if (options.language && options.language !== 'auto') {
                form.append('language', options.language);
            }

            const t0 = Date.now();
            const response = await axios.post(GROQ_TRANSCRIPTION_URL, form, {
                headers: {
                    'Authorization': `Bearer ${groqKey}`,
                    ...form.getHeaders()
                },
                timeout: 30000,
                maxBodyLength: 30 * 1024 * 1024
            });

            const elapsed = Date.now() - t0;
            const data = response.data || {};
            const text = (data.text || '').trim();
            const duration = typeof data.duration === 'number' ? Math.round(data.duration * 10) / 10 : null;
            const language = data.language || null;

            logger.info(`[WHISPER-GROQ] Transcripción completada en ${elapsed}ms (${duration ? duration + 's' : 'audio'}, ${text.length} caracteres)`);

            return {
                text,
                duration,
                language,
                provider: 'groq-whisper',
                elapsedMs: elapsed
            };
        } catch (err) {
            const errorDetail = err.response?.data?.error?.message || err.message;
            logger.warn(`[WHISPER-GROQ] Error en Groq Whisper (${errorDetail}). Intentando fallback...`);
        }
    }

    // ── Fallback: Google Gemini 2.5 Flash Audio ──
    if (geminiKey) {
        try {
            const t0 = Date.now();
            const buffer = await fs.promises.readFile(audioPath);
            const base64Audio = buffer.toString('base64');
            const ext = audioPath.split('.').pop().toLowerCase();
            const mimeMap = {
                mp3: 'audio/mp3',
                ogg: 'audio/ogg',
                opus: 'audio/ogg',
                wav: 'audio/wav',
                m4a: 'audio/mp4',
                aac: 'audio/aac',
                webm: 'audio/webm'
            };
            const mimeType = mimeMap[ext] || 'audio/mp3';

            const geminiModel = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`;
            const payload = {
                contents: [{
                    parts: [
                        {
                            inlineData: {
                                mimeType,
                                data: base64Audio
                            }
                        },
                        {
                            text: 'Transcribe fiel y exactamente todo lo que se dice en este audio en texto plano. Devuelve ÚNICAMENTE la transcripción, sin introducciones, sin comillas, sin formato adicional.'
                        }
                    ]
                }],
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: 2000
                }
            };

            const response = await axios.post(url, payload, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 30000
            });

            const elapsed = Date.now() - t0;
            const text = (response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
            logger.info(`[WHISPER-FALLBACK] Gemini transcribió en ${elapsed}ms: ${text.length} caracteres`);

            return {
                text,
                duration: null,
                language: 'es',
                provider: 'gemini-fallback',
                elapsedMs: elapsed
            };
        } catch (geminiErr) {
            logger.error(`[WHISPER-FALLBACK] Gemini también falló: ${geminiErr.message}`);
        }
    }

    throw new Error('No se pudo transcribir el audio ni con Groq Whisper ni con Gemini.');
}

/**
 * Genera un resumen conciso y sarcástico/directo al estilo de Botsky para audios largos.
 *
 * @param {string} text - Texto completo transcrito
 * @returns {Promise<string|null>}
 */
async function summarizeTranscription(text) {
    if (!text || text.trim().length < 50) return null;

    const groqKey = process.env.GROQ_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;
    const groqModel = process.env.GROQ_MODEL || 'qwen/qwen3.8-27b';

    const systemPrompt = `Eres Botsky, un bot de WhatsApp inteligente, directo, mordaz y con estilo mexicano.
Tu tarea es resumir la transcripción de una nota de voz para un compa que no tiene tiempo de escucharla o leerla completa.
Directrices:
- Extrae de 1 a 3 puntos clave o conclusiones más importantes en viñetas (•).
- Sé directo, sin rodeos corporativos ni introducciones como "En resumen...".
- Usa un tono casual y natural mexicano.`;

    const userMessage = `Resume esta nota de voz:\n"${text}"`;

    if (groqKey) {
        try {
            const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                model: groqModel,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMessage }
                ],
                temperature: 0.5,
                max_tokens: 300
            }, {
                headers: {
                    'Authorization': `Bearer ${groqKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            });

            const summary = res.data?.choices?.[0]?.message?.content?.trim();
            if (summary) return summary;
        } catch (err) {
            logger.warn(`[WHISPER-RESUMEN] Groq resumen falló: ${err.message}`);
        }
    }

    if (geminiKey) {
        try {
            const geminiModel = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`;
            const res = await axios.post(url, {
                contents: [{
                    parts: [{ text: `${systemPrompt}\n\n${userMessage}` }]
                }],
                generationConfig: {
                    temperature: 0.5,
                    maxOutputTokens: 300
                }
            }, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 10000
            });

            const summary = res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
            if (summary) return summary;
        } catch (err) {
            logger.warn(`[WHISPER-RESUMEN] Gemini resumen falló: ${err.message}`);
        }
    }

    return null;
}

module.exports = {
    transcribeAudio,
    summarizeTranscription
};
