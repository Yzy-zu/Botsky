'use strict';

/**
 * Parser de comandos estilo terminal.
 *
 * Soporta:
 *   - Comandos simples:          ayuda
 *   - Flags booleanas:           sticker --sin-borde
 *   - Flags con valor:           descargar -f mp3 -q 192
 *   - Argumentos posicionales:   descargar https://youtu.be/xxx
 *   - Valores con espacios:      descargar -t "mi titulo aqui" URL
 *
 * Ejemplo de resultado:
 *   Input:  "descargar -f mp4 -q 720 https://youtu.be/abc"
 *   Output: {
 *     command: 'descargar',
 *     flags: { f: 'mp4', q: '720' },
 *     args: ['https://youtu.be/abc'],
 *     raw: 'descargar -f mp4 -q 720 https://youtu.be/abc'
 *   }
 */

/**
 * Tokeniza un string respetando comillas simples y dobles.
 * @param {string} input
 * @returns {string[]}
 */
function tokenize(input) {
    const tokens = [];
    let current = '';
    let inQuote = null; // ' o "

    for (let i = 0; i < input.length; i++) {
        const ch = input[i];

        if (inQuote) {
            if (ch === inQuote) {
                inQuote = null; // Cierra comilla
            } else {
                current += ch;
            }
        } else if (ch === '"' || ch === "'") {
            inQuote = ch; // Abre comilla
        } else if (ch === ' ' || ch === '\t') {
            if (current.length > 0) {
                tokens.push(current);
                current = '';
            }
        } else {
            current += ch;
        }
    }

    if (current.length > 0) tokens.push(current);
    return tokens;
}

/**
 * Parsea una línea de comando.
 * @param {string} input - Texto del mensaje de WhatsApp
 * @returns {{ command: string, flags: Object, args: string[], raw: string } | null}
 */
function parse(input) {
    if (!input || typeof input !== 'string') return null;

    const trimmed = input.trim();
    if (trimmed.length === 0) return null;

    const tokens = tokenize(trimmed);
    if (tokens.length === 0) return null;

    const command = tokens[0].toLowerCase();
    const flags = {};
    const args = [];

    let i = 1;
    while (i < tokens.length) {
        const token = tokens[i];

        if (token.startsWith('--')) {
            // Flag larga: --formato mp3  o  --sin-borde (booleana)
            const key = token.slice(2);
            if (i + 1 < tokens.length && !tokens[i + 1].startsWith('-')) {
                flags[key] = tokens[i + 1];
                i += 2;
            } else {
                flags[key] = true;
                i++;
            }
        } else if (token.startsWith('-') && token.length === 2) {
            // Flag corta: -f mp3  o  -v (booleana)
            const key = token.slice(1);
            if (i + 1 < tokens.length && !tokens[i + 1].startsWith('-')) {
                flags[key] = tokens[i + 1];
                i += 2;
            } else {
                flags[key] = true;
                i++;
            }
        } else {
            // Argumento posicional
            args.push(token);
            i++;
        }
    }

    return {
        command,
        originalCommand: tokens[0],
        flags,
        args,
        raw: trimmed,
    };
}

/**
 * Valida si un string tiene forma de URL.
 */
function isUrl(str) {
    try {
        const u = new URL(str);
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
        return false;
    }
}

/**
 * Extrae la primera URL que aparezca en el array de args.
 */
function extractUrl(args) {
    return args.find(a => isUrl(a)) ?? null;
}

module.exports = { parse, tokenize, isUrl, extractUrl };
