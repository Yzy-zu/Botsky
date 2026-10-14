// @ts-check
'use strict';
const { createVoiceHandler, VOICES, MODES } = require('./handler');

/** @param {Parameters<typeof createVoiceHandler>[0]} ports @returns {import('../../pipeline/contracts').Feature} */
function createVoiceFeature(ports) {
    const argsSchema = { type: 'object', properties: {
        instruction: { type: 'string', maxLength: 2000 }, literalText: { type: 'string', maxLength: 20000 },
        mode: { type: 'string', enum: [...MODES] }, voice: { type: 'string', enum: [...VOICES] },
        durationSeconds: { type: 'integer', minimum: 1, maximum: 600 },
        destinationScope: { type: 'string', enum: ['current_chat', 'main_group', 'contact'] },
        contactQuery: { type: 'string', maxLength: 160 }
    }, additionalProperties: false };
    return { id: 'voice', commands: [{ name: 'voz', aliases: ['audio', 'tts', 'habla', 'hablar', 'notadevoz'],
        scope: ['private', 'group'], access: 'public', tier: 'heavy', timeoutMs: 240_000, allowLong: true,
        argsSchema, parseExplicit,
        help: { short: 'Prepara una nota de voz con texto, voz, duración y destino opcionales.', examples: ['voz hola, ya voy', 'voz --voice goku Hola', 'voz --duration 30 explica esto', 'voz --scope main_group Hola', 'voz --to Fer Hola'] },
        handler: createVoiceHandler(ports) }], intents: [{ id: 'voice.create',
        description: 'Preparar una nota de voz con texto literal o una instrucción, voz y duración opcionales. destinationScope y contactQuery solo si pidió enviarla a otro chat; nombres dentro del texto hablado no son destinatarios.', schema: argsSchema, command: 'voz' }] };
}

/** @type {Readonly<Record<string,string>>} */
const VOICE_ALIASES = Object.freeze({ donramón: 'donramon', loquendo: 'loquendo', 'eleven-labs': 'elevenlabs' });

/** @param {string[]} tokens @returns {Record<string,unknown>} */
function parseExplicit(tokens) {
    let voice = 'hombre', durationSeconds;
    let destinationScope, contactQuery;
    const source = [];
    for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index];
        const lower = token.toLowerCase();
        const flag = /^(--(?:voice|voz|duration|duracion|segundos|texto|text|scope|to|m)|-(?:m|t))(?:=(.*))?$/.exec(lower);
        if (flag) {
            const name = flag[1];
            const value = flag[2] !== undefined ? token.slice(token.indexOf('=') + 1) : tokens[++index];
            if (name === '-m' || name === '--m') {
                voice = 'mujer';
                if (value) source.unshift(value);
            } else if (!value) throw new TypeError('Invalid explicit voice arguments');
            else if (['--voice', '--voz'].includes(name)) {
                const candidate = VOICE_ALIASES[value.toLowerCase()] || value.toLowerCase();
                if (!VOICES.includes(candidate)) throw new TypeError('Invalid explicit voice arguments');
                voice = candidate;
            } else if (['--duration', '--duracion', '--segundos'].includes(name)) {
                durationSeconds = Number(value);
                if (!Number.isSafeInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 600) throw new TypeError('Invalid explicit voice arguments');
            } else if (name === '--scope') {
                destinationScope = value.toLowerCase();
                if (!['current_chat', 'main_group', 'contact'].includes(destinationScope)) throw new TypeError('Invalid explicit voice arguments');
            } else if (name === '--to') {
                contactQuery = value.trim();
                if (!contactQuery || contactQuery.length > 160) throw new TypeError('Invalid explicit voice arguments');
            } else source.push(value);
            continue;
        }
        if (lower.startsWith('--')) {
            const candidate = VOICE_ALIASES[lower.slice(2)] || lower.slice(2);
            if (VOICES.includes(candidate)) { voice = candidate; continue; }
            throw new TypeError('Invalid explicit voice arguments');
        }
        if (lower.startsWith('-') && lower.length === 2) {
            throw new TypeError('Invalid explicit voice arguments');
        }
        if (source.length === 0 && VOICES.includes(VOICE_ALIASES[lower] || lower)) {
            voice = VOICE_ALIASES[lower] || lower;
            continue;
        }
        source.push(token);
    }
    const literalText = source.join(' ').trim();
    if (literalText.length > 20000) throw new TypeError('Invalid explicit voice arguments');
    if (contactQuery && destinationScope && destinationScope !== 'contact') throw new TypeError('Invalid explicit voice arguments');
    if (contactQuery) destinationScope = 'contact';
    return { mode: 'verbatim', voice, literalText, ...(durationSeconds === undefined ? {} : { durationSeconds }),
        ...(destinationScope ? { destinationScope } : {}), ...(contactQuery ? { contactQuery } : {}) };
}

module.exports = { createVoiceFeature, parseExplicit };
