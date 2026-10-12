'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const TMP_DIR = process.env.TMP_DIR ?? '/tmp/whatsapp-bot';
const DEFAULT_MODEL = 'eleven_multilingual_v2';

// Caché de voces del usuario en ElevenLabs para evitar peticiones repetidas a /v1/voices
let cachedVoices = null;
let cachedVoicesTimestamp = 0;
const VOICES_CACHE_TTL = 10 * 60 * 1000; // 10 minutos

// Mapeo predefinido de nombres conocidos a Voice IDs estándar de ElevenLabs
const PRESET_VOICES = {
    daniel: 'onwK4e9ZLuTAKqWW03F9',    // Narrador profundo
    narrador: 'onwK4e9ZLuTAKqWW03F9',
    adam: 'pNInz6obpgDQGcFmaJgB',      // Firme / dominante
    charlie: 'IKne3meq5aSn9XLyUdCD',   // Enérgico
    george: 'JBFqnCBsd6RMkjVDRZzb',    // Cuentacuentos
    harry: 'SOYHLrjzK2X1ezoPC6cr',     // Guerrero
    liam: 'TX3LPaxmHKxFdv7VOQHJ',      // Social media
    alice: 'Xb7hH8MSUJpSbSDYk0k2',     // Femenina atractiva
    lily: 'pFZP5JQG7iQjIQuC4Bku',      // Femenina aterciopelada
    jessica: 'cgSgspJ2msm6clMCkdW9',   // Femenina alegre
    bill: 'pqHfZKP75CvOlQylNhV4'       // Maduro / sabio
};

/**
 * Obtiene las voces disponibles en la cuenta de ElevenLabs (VoiceLab y premade).
 */
async function fetchUserVoices(apiKey) {
    const now = Date.now();
    if (cachedVoices && now - cachedVoicesTimestamp < VOICES_CACHE_TTL) {
        return cachedVoices;
    }

    try {
        const res = await fetch('https://api.elevenlabs.io/v1/voices', {
            headers: {
                'xi-api-key': apiKey,
                'Content-Type': 'application/json'
            },
            signal: AbortSignal.timeout(6000)
        });

        if (res.ok) {
            const data = await res.json();
            cachedVoices = data.voices || [];
            cachedVoicesTimestamp = now;
            return cachedVoices;
        }
    } catch (err) {
        logger.warn(`[ELEVENLABS] No se pudieron sincronizar las voces: ${err.message}`);
    }

    return cachedVoices || [];
}

/**
 * Resuelve el Voice ID correspondiente a un nombre o personaje.
 * Busca primero en las voces del VoiceLab del usuario en ElevenLabs, luego en presets.
 */
async function resolveElevenLabsVoiceId(voiceName, apiKey) {
    if (!voiceName) return PRESET_VOICES.daniel;
    const clean = voiceName.toLowerCase().trim().replace(/[-_]/g, '');

    // 1. Si ya es un ID de 20 caracteres alfanuméricos directo
    if (/^[a-zA-Z0-9]{20}$/.test(clean)) {
        return clean;
    }

    // 2. Buscar en la cuenta del usuario en ElevenLabs (VoiceLab / Biblioteca añadida)
    const userVoices = await fetchUserVoices(apiKey);
    const matchedVoice = userVoices.find(v => {
        const vName = (v.name || '').toLowerCase().replace(/[-_\s]/g, '');
        return vName.includes(clean) || clean.includes(vName);
    });

    if (matchedVoice) {
        logger.info(`[ELEVENLABS] Voz encontrada en VoiceLab del usuario: "${matchedVoice.name}" (${matchedVoice.voice_id})`);
        return matchedVoice.voice_id;
    }

    // 3. Buscar en los presets conocidos
    if (PRESET_VOICES[clean]) {
        return PRESET_VOICES[clean];
    }

    // 4. Si pide goku, dross o donramon pero no los tiene añadidos en su cuenta, intentar el default
    return PRESET_VOICES.daniel;
}

/**
 * Genera un archivo de audio con ElevenLabs API.
 * 
 * @param {string} text - Texto a pronunciar
 * @param {string} voiceName - Nombre del personaje o voice_id
 * @returns {Promise<{ filePath: string, cleanup: Function, provider: string }>}
 */
async function generateElevenLabsVoiceNote(text, voiceName = 'daniel') {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
        throw new Error('No hay ELEVENLABS_API_KEY configurada.');
    }

    const voiceId = await resolveElevenLabsVoiceId(voiceName, apiKey);
    const baseTempId = `botsky_el_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    fs.mkdirSync(TMP_DIR, { recursive: true });
    const outputPath = path.join(TMP_DIR, `${baseTempId}.mp3`);

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
    const payload = {
        text,
        model_id: DEFAULT_MODEL,
        voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75
        }
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000)
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`ElevenLabs API error (${res.status}): ${errText.slice(0, 120)}`);
    }

    const arrayBuf = await res.arrayBuffer();
    fs.writeFileSync(outputPath, Buffer.from(arrayBuf));

    logger.info(`[ELEVENLABS] Audio generado con éxito (${fs.statSync(outputPath).size} bytes, voz: ${voiceName} -> ${voiceId})`);

    return {
        filePath: outputPath,
        provider: 'elevenlabs',
        cleanup: () => {
            try {
                if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            } catch (_) {}
        }
    };
}

module.exports = {
    generateElevenLabsVoiceNote,
    resolveElevenLabsVoiceId,
    fetchUserVoices,
    PRESET_VOICES
};
