'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { generateElevenLabsVoiceNote, resolveElevenLabsVoiceId } = require('./elevenlabs');

const DEFAULT_VOICE = 'es-MX-JorgeNeural';
const FEMALE_VOICE = 'es-MX-DaliaNeural';

// Voces y Efectos nativos de Edge-TTS (Gratis y locales)
const VOICE_PROFILES = {
    // ── Voces Regionales Humanas ──
    hombre: {
        name: 'Botsky (México)',
        voice: 'es-MX-JorgeNeural',
        rate: '+3%',
        pitch: '-2Hz',
        filter: null
    },
    mujer: {
        name: 'Mexicana Femenina',
        voice: 'es-MX-DaliaNeural',
        rate: '+3%',
        pitch: '+0Hz',
        filter: null
    },
    colombiano: {
        name: 'Colombiano Paisa',
        voice: 'es-CO-GonzaloNeural',
        rate: '+2%',
        pitch: '+0Hz',
        filter: null
    },
    colombiana: {
        name: 'Colombiana Femenina',
        voice: 'es-CO-SalomeNeural',
        rate: '+2%',
        pitch: '+0Hz',
        filter: null
    },
    argentino: {
        name: 'Argentino Che',
        voice: 'es-AR-TomasNeural',
        rate: '+0%',
        pitch: '-2Hz',
        filter: null
    },
    argentina: {
        name: 'Argentina Femenina',
        voice: 'es-AR-ElenaNeural',
        rate: '+0%',
        pitch: '+0Hz',
        filter: null
    },
    loquendo: {
        name: 'Loquendo Clásico (España)',
        voice: 'es-ES-AlvaroNeural',
        rate: '+0%',
        pitch: '+0Hz',
        filter: null
    },
    chileno: {
        name: 'Chileno',
        voice: 'es-CL-LorenzoNeural',
        rate: '+2%',
        pitch: '+0Hz',
        filter: null
    },
    venezolano: {
        name: 'Venezolano',
        voice: 'es-VE-SebastianNeural',
        rate: '+2%',
        pitch: '+0Hz',
        filter: null
    },
    peruano: {
        name: 'Peruano',
        voice: 'es-PE-AlexNeural',
        rate: '+0%',
        pitch: '+0Hz',
        filter: null
    },
    anime: {
        name: 'Mona China Cute',
        voice: 'es-ES-ElviraNeural',
        rate: '+10%',
        pitch: '+16Hz',
        filter: null
    },

    // ── Efectos Especiales con Modulación FFmpeg ──
    ardilla: {
        name: 'Ardilla Alvin',
        voice: 'es-MX-DaliaNeural',
        rate: '+10%',
        pitch: '+20Hz',
        filter: 'asetrate=24000*1.45,aresample=24000,atempo=1/1.2'
    },
    demonio: {
        name: 'Demonio Ultratumba',
        voice: 'es-MX-JorgeNeural',
        rate: '-5%',
        pitch: '-20Hz',
        filter: 'asetrate=24000*0.75,aresample=24000,atempo=1/0.85,bass=g=8'
    },
    robot: {
        name: 'Robot Ciborg',
        voice: 'es-MX-JorgeNeural',
        rate: '+0%',
        pitch: '+0Hz',
        filter: 'flanger=delay=3:depth=2:regen=50:width=80:speed=2'
    },
    radio: {
        name: 'Radio Policial / Walkie-Talkie',
        voice: 'es-MX-JorgeNeural',
        rate: '+0%',
        pitch: '+0Hz',
        filter: 'highpass=f=400,lowpass=f=3000,volume=1.5'
    },
    dross: {
        name: 'Dross Rotzank',
        voice: 'es-AR-TomasNeural',
        rate: '-8%',
        pitch: '-6Hz',
        filter: 'bass=g=6,aecho=0.8:0.88:35:0.25'
    },
    goku: {
        name: 'Goku',
        voice: 'es-MX-JorgeNeural',
        rate: '+8%',
        pitch: '+10Hz',
        filter: 'asetrate=24000*1.12,aresample=24000,atempo=1/1.1'
    },
    donramon: {
        name: 'Don Ramón',
        voice: 'es-MX-JorgeNeural',
        rate: '-4%',
        pitch: '-4Hz',
        filter: 'equalizer=f=1200:width_type=o:width=1.5:g=4'
    },
    babidi: {
        name: 'Babidi',
        voice: 'es-MX-JorgeNeural',
        rate: '+15%',
        pitch: '+22Hz',
        filter: 'asetrate=24000*1.2,aresample=24000,atempo=1/1.2,equalizer=f=2500:width_type=o:width=1:g=8'
    }
};

// Conjunto de palabras que indican preferencia o personaje de ElevenLabs
const ELEVENLABS_TRIGGERS = new Set([
    'elevenlabs', 'realista', 'humana', 'daniel', 'narrador',
    'adam', 'charlie', 'george', 'harry', 'liam', 'alice',
    'lily', 'jessica', 'bill', 'goku', 'donramon', 'dross', 'luisito'
]);

/**
 * Resuelve el perfil de voz para Edge-TTS.
 */
function resolveVoiceProfile(options = {}) {
    let key = options.voiceProfile || options.voz || options.voice || '';
    if (typeof key === 'string') key = key.toLowerCase().trim().replace(/^[-_]+/, '');

    // Aliases regionales
    if (['colombiano', 'colombia', 'paisa', 'parcero'].includes(key)) return VOICE_PROFILES.colombiano;
    if (['colombiana'].includes(key)) return VOICE_PROFILES.colombiana;
    if (['argentino', 'argentina', 'che', 'boludo'].includes(key)) return VOICE_PROFILES.argentino;
    if (['chileno', 'chile', 'weon'].includes(key)) return VOICE_PROFILES.chileno;
    if (['venezolano', 'venezuela', 'chamo'].includes(key)) return VOICE_PROFILES.venezolano;
    if (['peruano', 'peru', 'causa'].includes(key)) return VOICE_PROFILES.peruano;
    if (['loquendo', 'espanol', 'espana', 'castellano'].includes(key)) return VOICE_PROFILES.loquendo;
    if (['ardilla', 'alvin'].includes(key)) return VOICE_PROFILES.ardilla;
    if (['demonio', 'monstruo', 'diablo'].includes(key)) return VOICE_PROFILES.demonio;
    if (['robot', 'cyborg', 'ciborg'].includes(key)) return VOICE_PROFILES.robot;
    if (['radio', 'policia', 'walkietalkie'].includes(key)) return VOICE_PROFILES.radio;

    // Personajes
    if (['dross', 'drossrotzank'].includes(key)) return VOICE_PROFILES.dross;
    if (['goku'].includes(key)) return VOICE_PROFILES.goku;
    if (['donramon', 'ramon', 'monchito'].includes(key)) return VOICE_PROFILES.donramon;
    if (['babidi'].includes(key)) return VOICE_PROFILES.babidi;
    if (['anime', 'waifu', 'loli', 'monachina', 'cute'].includes(key)) return VOICE_PROFILES.anime;
    if (['mujer', 'chica', 'morra', 'reels', 'female', 'f', 'm'].includes(key)) return VOICE_PROFILES.mujer;

    if (VOICE_PROFILES[key]) return VOICE_PROFILES[key];
    return VOICE_PROFILES.hombre;
}

/**
 * Limpia y normaliza el texto para síntesis de voz.
 */
function cleanTextForSpeech(text) {
    if (!text || typeof text !== 'string') return '';
    return text
        .replace(/https?:\/\/\S+/gi, '')
        .replace(/[*_~`]/g, '')
        .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}

let edgeTtsCircuitBreakerUntil = 0;

/**
 * Aplica un filtro de audio FFmpeg sobre un archivo de entrada.
 */
function applyFfmpegFilter(inputPath, filter) {
    if (!filter) return Promise.resolve(inputPath);
    const filteredPath = path.join('/tmp', `botsky_filter_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`);
    return new Promise((resolve, reject) => {
        const proc = spawn('ffmpeg', ['-y', '-i', inputPath, '-af', filter, filteredPath]);
        let stderr = '';
        proc.stderr.on('data', d => { stderr += d.toString(); });
        proc.on('close', code => {
            if (code === 0 && fs.existsSync(filteredPath)) {
                resolve(filteredPath);
            } else {
                reject(new Error(`FFmpeg falló aplicando filtro (${code}): ${stderr}`));
            }
        });
        proc.on('error', err => reject(new Error(`Error al invocar FFmpeg: ${err.message}`)));
    });
}

/**
 * Genera audio usando Google TTS (gTTS CLI) como fallback gratuito universal.
 */
function generateGtts(text, lang = 'es') {
    const baseTempId = `botsky_gtts_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const rawOutputPath = path.join('/tmp', `${baseTempId}.mp3`);
    return new Promise((resolve, reject) => {
        const proc = spawn('gtts-cli', [text, '--lang', lang, '--output', rawOutputPath]);
        let stderr = '';
        proc.stderr.on('data', d => { stderr += d.toString(); });
        proc.on('close', code => {
            if (code === 0 && fs.existsSync(rawOutputPath)) {
                resolve(rawOutputPath);
            } else {
                reject(new Error(`gTTS falló con código ${code}: ${stderr}`));
            }
        });
        proc.on('error', err => reject(new Error(`Error al invocar gtts-cli: ${err.message}`)));
    });
}

/**
 * Genera audio usando Edge-TTS (Microsoft).
 */
function generateEdgeTts(cleanedText, profile, options) {
    const voice = options.voice || profile.voice;
    const rate = options.rate || profile.rate;
    const pitch = options.pitch || profile.pitch;

    const baseTempId = `botsky_tts_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const rawOutputPath = path.join('/tmp', `${baseTempId}_raw.mp3`);

    return new Promise((resolve, reject) => {
        const args = [
            '--voice', voice,
            `--rate=${rate}`,
            `--pitch=${pitch}`,
            '--text', cleanedText,
            '--write-media', rawOutputPath
        ];

        const proc = spawn('edge-tts', args);
        let stderr = '';

        proc.stderr.on('data', d => {
            stderr += d.toString();
        });

        proc.on('close', code => {
            if (code !== 0 || !fs.existsSync(rawOutputPath)) {
                return reject(new Error(`edge-tts falló con código ${code}: ${stderr}`));
            }
            resolve(rawOutputPath);
        });

        proc.on('error', err => {
            reject(new Error(`Error al invocar edge-tts: ${err.message}`));
        });
    });
}

/**
 * Genera la nota de voz usando ElevenLabs, Edge-TTS o Google TTS con filtros FFmpeg.
 */
async function generateVoiceNote(text, options = {}) {
    const cleanedText = cleanTextForSpeech(text);
    if (!cleanedText) {
        throw new Error('El texto para la nota de voz está vacío.');
    }

    const rawKey = (options.voiceProfile || options.voz || options.voice || '').toLowerCase().trim().replace(/^[-_]+/, '');
    const hasElevenLabs = !!process.env.ELEVENLABS_API_KEY;
    const profile = resolveVoiceProfile(options);

    // ── 1. ElevenLabs prioritario si se solicitó explícitamente ──
    if (hasElevenLabs && (ELEVENLABS_TRIGGERS.has(rawKey) || options.useElevenLabs)) {
        try {
            logger.info(`[TTS] Generando voz con ElevenLabs (voz: ${rawKey || 'daniel'})...`);
            const result = await generateElevenLabsVoiceNote(cleanedText, rawKey);
            let finalPath = result.filePath;
            if (profile.filter) {
                finalPath = await applyFfmpegFilter(result.filePath, profile.filter);
                try { if (fs.existsSync(result.filePath)) fs.unlinkSync(result.filePath); } catch (_) {}
            }
            return {
                filePath: finalPath,
                profile: { name: `ElevenLabs (${rawKey || 'Daniel'})` },
                provider: 'elevenlabs',
                cleanup: () => {
                    try { if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath); } catch (_) {}
                }
            };
        } catch (elErr) {
            logger.warn(`[TTS] ElevenLabs solicitado falló (${elErr.message}). Probando alternativas...`);
        }
    }

    // ── 2. Intentar Edge-TTS (si no está en cooldown por 403 de Microsoft) ──
    const isEdgeBlocked = Date.now() < edgeTtsCircuitBreakerUntil;
    if (!isEdgeBlocked) {
        try {
            const rawOutputPath = await generateEdgeTts(cleanedText, profile, options);
            let finalPath = rawOutputPath;
            if (profile.filter) {
                finalPath = await applyFfmpegFilter(rawOutputPath, profile.filter);
                try { if (fs.existsSync(rawOutputPath)) fs.unlinkSync(rawOutputPath); } catch (_) {}
            }
            logger.info(`[TTS] Nota de voz generada exitosamente con Edge-TTS (${fs.statSync(finalPath).size} bytes, perfil: ${profile.name})`);
            return {
                filePath: finalPath,
                profile,
                provider: 'edge-tts',
                cleanup: () => {
                    try { if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath); } catch (_) {}
                }
            };
        } catch (edgeErr) {
            logger.warn(`[TTS] Edge-TTS falló (${edgeErr.message}). Activando cooldown y recurriendo a fallback...`);
            if (edgeErr.message.includes('403') || edgeErr.message.includes('WSServerHandshakeError')) {
                edgeTtsCircuitBreakerUntil = Date.now() + 15 * 60 * 1000;
            }
        }
    } else {
        logger.info(`[TTS] Edge-TTS en cooldown por bloqueo de Microsoft (403). Usando motor alternativo...`);
    }

    // ── 3. Fallback a ElevenLabs (Alta fidelidad neuronal) ──
    if (hasElevenLabs) {
        try {
            let elVoice = rawKey;
            if (!elVoice || ['hombre', 'colombiano', 'argentino', 'chileno', 'venezolano', 'peruano', 'loquendo'].includes(elVoice)) {
                elVoice = 'daniel';
            } else if (['mujer', 'colombiana', 'argentina', 'anime'].includes(elVoice)) {
                elVoice = 'alice';
            } else if (['demonio', 'monstruo', 'diablo'].includes(elVoice)) {
                elVoice = 'adam';
            }

            logger.info(`[TTS] Fallback a ElevenLabs con voz "${elVoice}"...`);
            const elResult = await generateElevenLabsVoiceNote(cleanedText, elVoice);
            let finalPath = elResult.filePath;
            if (profile.filter) {
                finalPath = await applyFfmpegFilter(elResult.filePath, profile.filter);
                try { if (fs.existsSync(elResult.filePath)) fs.unlinkSync(elResult.filePath); } catch (_) {}
            }

            logger.info(`[TTS] Audio generado exitosamente con ElevenLabs fallback (${fs.statSync(finalPath).size} bytes, perfil: ${profile.name})`);
            return {
                filePath: finalPath,
                profile,
                provider: 'elevenlabs',
                cleanup: () => {
                    try { if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath); } catch (_) {}
                    if (typeof elResult.cleanup === 'function') elResult.cleanup();
                }
            };
        } catch (elFallbackErr) {
            logger.warn(`[TTS] ElevenLabs fallback falló (${elFallbackErr.message}). Recurriendo a Google TTS...`);
        }
    }

    // ── 4. Fallback final a Google TTS (Universal, sin API keys, cero bloqueos) ──
    try {
        logger.info(`[TTS] Generando audio de respaldo con Google TTS (gTTS)...`);
        const gttsRaw = await generateGtts(cleanedText, 'es');
        let finalPath = gttsRaw;
        if (profile.filter) {
            finalPath = await applyFfmpegFilter(gttsRaw, profile.filter);
            try { if (fs.existsSync(gttsRaw)) fs.unlinkSync(gttsRaw); } catch (_) {}
        }

        logger.info(`[TTS] Audio generado exitosamente con Google TTS (${fs.statSync(finalPath).size} bytes, perfil: ${profile.name})`);
        return {
            filePath: finalPath,
            profile,
            provider: 'gtts',
            cleanup: () => {
                try { if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath); } catch (_) {}
            }
        };
    } catch (gttsErr) {
        logger.error(`[TTS] Todos los proveedores de voz (Edge, ElevenLabs, Google) fallaron: ${gttsErr.message}`);
        throw new Error(`No se pudo generar la nota de voz: ${gttsErr.message}`);
    }
}

module.exports = {
    generateVoiceNote,
    cleanTextForSpeech,
    resolveVoiceProfile,
    VOICE_PROFILES,
    DEFAULT_VOICE,
    FEMALE_VOICE
};
