// @ts-check
'use strict';
const { createTranscriptionHandler, LANGUAGES } = require('./handler');

/** @param {Parameters<typeof createTranscriptionHandler>[0]} ports @returns {import('../../pipeline/contracts').Feature} */
function createTranscriptionFeature(ports) {
    const argsSchema = { type: 'object', properties: {
        url: { type: 'string', maxLength: 2048 },
        model: { type: 'string', enum: ['whisper-large-v3-turbo', 'whisper-large-v3'] },
        language: { type: 'string', enum: [...LANGUAGES] },
        summarize: { type: 'boolean' }
    }, additionalProperties: false };
    return { id: 'transcription', commands: [{ name: 'transcribir', aliases: ['transcribe', 'tr'],
        scope: ['private', 'group'], access: 'public', tier: 'heavy', timeoutMs: 120_000, allowLong: true,
        argsSchema, parseExplicit, help: { short: 'Transcribe un audio adjunto o una URL.', examples: ['transcribir (responde a un audio)', 'transcribir --idioma es --resumir'] },
        handler: createTranscriptionHandler(ports) }], intents: [{ id: 'transcription.transcribe',
        description: 'Transcribir audio adjunto o URL; puede pedir idioma, modelo o resumen.', schema: argsSchema, command: 'transcribir' }] };
}

/** @type {Readonly<Record<string,string>>} */
const MODEL_ALIASES = Object.freeze({ turbo: 'whisper-large-v3-turbo', fast: 'whisper-large-v3-turbo', small: 'whisper-large-v3-turbo', base: 'whisper-large-v3-turbo', tiny: 'whisper-large-v3-turbo', large: 'whisper-large-v3', 'large-v3': 'whisper-large-v3' });

/** @param {string[]} tokens @returns {Record<string,unknown>} */
function parseExplicit(tokens) {
    /** @type {Record<string,unknown>} */ const args = {};
    const source = [];
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (['--resumir', '--resumen', '-r'].includes(token) || ['resumir', 'resumen'].includes(token.toLowerCase())) {
            args.summarize = true;
            continue;
        }
        const match = /^(?:--m|--modelo|--model|--l|--idioma|--language)(?:=(.*))?$/.exec(token);
        if (match) {
            const name = token.split(/[=]/, 1)[0];
            const value = match[1] ?? tokens[++i];
            if (!value) throw new TypeError('Invalid explicit transcription arguments');
            if (['--m', '--modelo', '--model'].includes(name)) {
                const model = MODEL_ALIASES[value.toLowerCase()] || value.toLowerCase();
                if (!['whisper-large-v3-turbo', 'whisper-large-v3'].includes(model)) throw new TypeError('Invalid explicit transcription arguments');
                args.model = model;
            } else {
                const language = value.toLowerCase();
                if (!LANGUAGES.includes(language)) throw new TypeError('Invalid explicit transcription arguments');
                args.language = language;
            }
            continue;
        }
        if (token.startsWith('-')) throw new TypeError('Invalid explicit transcription arguments');
        source.push(token);
    }
    if (source.length) {
        const raw = source.join(' ');
        let url;
        try { url = new URL(raw); } catch { throw new TypeError('Invalid explicit transcription arguments'); }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || raw.length > 2048) throw new TypeError('Invalid explicit transcription arguments');
        args.url = url.href;
    }
    return args;
}

module.exports = { createTranscriptionFeature, parseExplicit };
