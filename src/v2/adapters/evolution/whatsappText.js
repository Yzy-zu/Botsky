// @ts-check
'use strict';
/** @typedef {{headers:string[],rows:string[][],title?:string}} Table */
/** @typedef {{fence:string|null,inline:boolean,styles:string[]}} FormatState */
/** @typedef {{type:'text',text:string}|({type:'table',text:string}&Table)} MessageChunk */

const WHATSAPP_FORMAT_INSTRUCTIONS = `La respuesta se leerá en WhatsApp. Usa párrafos cortos y listas cuando ayuden. Negritas con *un asterisco*, cursivas con _guiones bajos_ y código con comillas invertidas. Cuando el usuario pida una tabla, o una comparación de varios elementos se lea mejor en columnas, usa una tabla Markdown con encabezados, separador | --- | --- | y filas: Botsky la enviará como tabla nativa de WhatsApp. Escribe las tablas fuera de bloques de código; mantén columnas consistentes y celdas breves. No alinees columnas con espacios ni pegues tablas crudas de consola. Para respuestas simples usa texto o listas. No uses encabezados con # ni enlaces Markdown: escribe el nombre y su URL. Expresa las matemáticas con pasos y fórmulas legibles, por ejemplo x = (a + b) / 2, x^2 y √(x); evita LaTeX sin renderizar. Conserva unidades, condiciones y todas las respuestas de los ejercicios. Usa bloques de código solamente para código o texto que necesita alineación.`;

/** @param {string} text */
function protectCode(text) {
    /** @type {string[]} */ const fragments = [];
    const prefix = '\uE000BOTSKY';
    // Private-use sentinels are unique within this input; user content is preserved.
    let marker = prefix;
    while (text.includes(marker)) marker += 'X';
    const protectedText = text.replace(/```[^\n]*\n[\s\S]*?(?:```|$)|`[^`\n]+`/g, code => {
        fragments.push(code);
        return `${marker}${fragments.length - 1}\uE001`;
    });
    return { text: protectedText, restore: (/** @type {string} */ value) => value.replace(new RegExp(`${marker}(\\d+)\uE001`, 'g'), (_, index) => fragments[Number(index)]) };
}

/** @param {string} line */
function tableCells(line) {
    const cells = [];
    let cell = '';
    for (let i = 0; i < line.length; i++) {
        if (line[i] === '\\' && line[i + 1] === '|') { cell += '|'; i++; }
        else if (line[i] === '|') { cells.push(cell.trim()); cell = ''; }
        else cell += line[i];
    }
    cells.push(cell.trim());
    if (line.trim().startsWith('|')) cells.shift();
    if (line.trim().endsWith('|')) cells.pop();
    return cells;
}

/** @param {string} text */
function convertTables(text) {
    const lines = text.split('\n');
    const output = [];
    for (let i = 0; i < lines.length; i++) {
        const separator = i + 1 < lines.length ? tableCells(lines[i + 1]) : [];
        if (!lines[i].includes('|') || !separator.length || !separator.every(cell => /^:?-{3,}:?$/.test(cell))) {
            output.push(lines[i]);
            continue;
        }
        const headers = tableCells(lines[i]);
        const rows = [];
        i += 2;
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
            rows.push(tableCells(lines[i]));
            i++;
        }
        i--;
        if (!rows.length) output.push(headers.join(' · '));
        for (const row of rows) {
            output.push(row.map((value, column) => `- ${headers[column] || `Columna ${column + 1}`}: ${value}`).join('\n'));
            output.push('');
        }
    }
    return output.join('\n');
}

/** Small balanced LaTeX reader, not a renderer. Unknown commands remain readable. */
/** @param {string} input */
function plainMath(input) {
    let index = 0;
    /** @type {Record<string,string>} */ const symbols = { times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', infty: '∞', pi: 'π', theta: 'θ', alpha: 'α', beta: 'β', gamma: 'γ', Delta: 'Δ', delta: 'δ', sigma: 'σ', sum: 'Σ', prod: 'Π', int: '∫', to: '→', rightarrow: '→', implies: '⇒', degree: '°', percent: '%' };
    function group() {
        while (/\s/.test(input[index] || '') && index < input.length) index++;
        if (input[index] !== '{') return null;
        index++;
        let depth = 1;
        const start = index;
        while (index < input.length && depth) {
            if (input[index] === '{') depth++;
            else if (input[index] === '}') depth--;
            if (depth) index++;
        }
        const value = input.slice(start, index);
        if (depth === 0) index++;
        return plainMath(value);
    }
    let out = '';
    while (index < input.length) {
        const char = input[index++];
        if (char === '\\') {
            const match = input.slice(index).match(/^[A-Za-z]+/);
            if (!match) { out += input[index++] || '\\'; continue; }
            const command = match[0];
            index += command.length;
            if (command === 'frac' || command === 'dfrac' || command === 'tfrac') {
                const numerator = group(); const denominator = group();
                out += numerator !== null && denominator !== null ? `(${numerator}) / (${denominator})` : `${command}${numerator !== null ? `{${numerator}}` : ''}${denominator !== null ? `{${denominator}}` : ''}`;
            } else if (command === 'sqrt') {
                let degree = '';
                if (input[index] === '[') {
                    const end = input.indexOf(']', index);
                    if (end !== -1) { degree = input.slice(index + 1, end); index = end + 1; }
                }
                const value = group();
                out += value === null ? '√' : degree ? `root[${degree}](${value})` : `√(${value})`;
            } else if (['text', 'mathrm', 'mathbf', 'operatorname', 'mathit', 'textrm'].includes(command)) {
                const value = group(); out += value === null ? command : value;
            } else if (['left', 'right'].includes(command)) {
                // Only remove the sizing command; the delimiter still follows.
            } else out += symbols[command] || command;
        } else if (char === '^' && input[index] === '{') {
            const value = group(); out += `^(${value})`;
        } else if (char === '_' && input[index] === '{') {
            const value = group(); out += `_(${value})`;
        } else out += char;
    }
    return out;
}

/** @param {any} value */
function formatWhatsAppText(value) {
    if (value === null || value === undefined) return '';
    const protectedCode = protectCode(String(value).replace(/\r\n/g, '\n'));
    let text = convertTables(protectedCode.text);
    text = text.replace(/!\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)/g, (_, name, url) => name ? `${name}: ${url}` : url);
    text = text.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, name, url) => name === url ? url : `${name}: ${url}`);
    // URLs are literals; underscores, stars and dollar signs inside them are not markup.
    /** @type {string[]} */ const urls = [];
    let urlMarker = '\uE002BOTSKY';
    while (text.includes(urlMarker)) urlMarker += 'X';
    text = text.replace(/https?:\/\/[^\s<>]+/g, url => { urls.push(url); return `${urlMarker}${urls.length - 1}\uE003`; });
    text = text.replace(/\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)|\$\$([\s\S]*?)\$\$|(?<!\$)\$([^$\n]+)\$(?!\$)/g, (original, a, b, c, d) => {
        // Two currency signs in prose are not a pair of math delimiters.
        if (d !== undefined && !/\\[A-Za-z]|[=^_+*/]|^\s*[A-Za-z0-9]+(?:\.\d+)?\s*$/.test(d)) return original;
        return plainMath(a ?? b ?? c ?? d);
    });
    text = text.replace(/\\(?:frac|dfrac|tfrac|sqrt|text|mathrm|mathbf|operatorname)\b(?:\[[^\]\n]*\])?(?:\{[^\n]*\})+/g, plainMath);
    text = text.replace(/\*\*([^\n]+?)\*\*/g, '*$1*').replace(/__([^\n]+?)__/g, '_$1_').replace(/~~([^\n]+?)~~/g, '~$1~');
    text = text.replace(/^\s{0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/gm, (_, title) => `*${title.replace(/\*([^*\n]+)\*/g, '$1')}*`);
    text = text.replace(new RegExp(`${urlMarker}(\\d+)\uE003`, 'g'), (_, index) => urls[Number(index)]);
    return protectedCode.restore(text).trim();
}

/** @param {string} text @param {FormatState} state @param {number} start @param {number} end */
function updateFormattingState(text, state, start, end) {
    for (let i = start; i < end; i++) {
        if (text.startsWith('```', i)) {
            if (state.fence !== null) { state.fence = null; i += 2; }
            else {
                const newline = text.indexOf('\n', i + 3);
                state.fence = newline === -1 ? '' : text.slice(i + 3, newline);
                i = newline === -1 ? i + 2 : newline;
            }
            continue;
        }
        if (state.fence !== null) continue;
        const char = text[i];
        if (char === '`') { state.inline = !state.inline; continue; }
        if (state.inline || !'*_~'.includes(char)) continue;
        const before = text[i - 1] || ''; const after = text[i + 1] || '';
        const activeIndex = state.styles.indexOf(char);
        const opens = (!before || /[\s([{>*_~]/.test(before)) && after && !/\s/.test(after);
        const closes = before && !/\s/.test(before) && (!after || /[\s.,!?;:)\]}*_~]/.test(after));
        if (activeIndex !== -1 && closes) state.styles.splice(activeIndex, 1);
        else if (activeIndex === -1 && opens) state.styles.push(char);
    }
}

/** @param {FormatState} state @param {string} segment */
function closing(state, segment) {
    return state.fence !== null ? `${segment.endsWith('\n') ? '' : '\n'}\`\`\`` : `${state.inline ? '`' : ''}${[...state.styles].reverse().join('')}`;
}
/** @param {FormatState} state */
function opening(state) {
    return state.fence !== null ? `\`\`\`${state.fence}\n` : `${state.styles.join('')}${state.inline ? '`' : ''}`;
}

/** Splits already formatted text, balancing code/style across WhatsApp messages. */
/** @param {any} value @param {any} options1 */
function splitWhatsAppText(value, { maxLength = 3500 } = {}) {
    const text = String(value ?? '');
    if (!Number.isInteger(maxLength) || maxLength < 32) throw new RangeError('maxLength debe ser un entero de al menos 32');
    if (!text) return [];
    if (text.length <= maxLength) return [text];
    const chunks = [];
    /** @type {FormatState} */ const state = { fence: null, inline: false, styles: [] };
    let offset = 0;
    while (offset < text.length) {
        const prefix = opening(state);
        if (prefix.length + text.length - offset <= maxLength) {
            chunks.push(prefix + text.slice(offset));
            break;
        }
        // Reserve closers and allow language tags to remain intact.
        const room = maxLength - prefix.length - 8;
        if (room < 8) throw new RangeError('El límite no permite conservar el bloque de código');
        let end = Math.min(offset + room, text.length);
        if (end < text.length) {
            const sample = text.slice(offset, end);
            const paragraph = sample.lastIndexOf('\n\n');
            const line = sample.lastIndexOf('\n');
            const space = sample.lastIndexOf(' ');
            const cut = paragraph >= room / 3 ? paragraph + 2 : line >= room / 3 ? line + 1 : space >= room / 3 ? space + 1 : room;
            end = offset + cut;
            // A language label alone would produce a confusing empty code message.
            if (/^```[^\n]*\n$/.test(text.slice(offset, end))) end = Math.min(offset + room, text.length);
            // Never cut a fence marker or a UTF-16 surrogate pair.
            for (let start = Math.max(offset, end - 2); start < end; start++) {
                if (text.startsWith('```', start) && start + 3 > end) { end = start; break; }
            }
            if (end > offset && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--;
        }
        const segment = text.slice(offset, end);
        updateFormattingState(text, state, offset, end);
        chunks.push(prefix + segment + (end < text.length ? closing(state, segment) : ''));
        offset = end;
    }
    return chunks;
}

/** Table cells respect escaped pipes and inline code, including multiple backticks. */
/** @param {string} value */
function nativeTableCells(value) {
    const line = value.trim();
    const cells = [];
    const separators = [];
    let cell = '';
    let codeWidth = 0;
    for (let i = 0; i < line.length; i++) {
        if (line[i] === '\\' && i + 1 < line.length) {
            const next = line[++i];
            cell += next === '|' || next === '\\' ? next : `\\${next}`;
        } else if (line[i] === '`') {
            let width = 1;
            while (line[i + width] === '`') width++;
            if (!codeWidth && line.indexOf('`'.repeat(width), i + width) !== -1) codeWidth = width;
            else if (codeWidth === width) codeWidth = 0;
            cell += '`'.repeat(width);
            i += width - 1;
        } else if (line[i] === '|' && !codeWidth) {
            separators.push(i);
            cells.push(cell.trim());
            cell = '';
        } else cell += line[i];
    }
    cells.push(cell.trim());
    if (separators[0] === 0) cells.shift();
    if (separators.at(-1) === line.length - 1) cells.pop();
    return { cells, hasPipe: separators.length > 0 };
}

/** Working WhatsApp native table envelope, matching the validated C experiment. */
/** @param {Table} table @param {{mentions?:string[]}} [options] */
function buildNativeTableMessage({ headers, rows, title = '' }, { mentions = [] } = {}) {
    /** @type {Record<string,any>} */ const contextInfo = {
        forwardingScore: 1,
        isForwarded: true,
        forwardedAiBotMessageInfo: { botJid: '867051314767696@bot' },
        forwardOrigin: 4
    };
    if (mentions.length) contextInfo.mentionedJid = [...mentions];
    return { botForwardedMessage: { message: { richResponseMessage: {
        messageType: 1,
        submessages: [{ messageType: 4, tableMetadata: {
            title,
            rows: [{ items: [...headers], isHeading: true }, ...rows.map(items => ({ items: [...items] }))]
        } }],
        contextInfo
    } } } };
}

/** Readable fallback uses parsed cells, avoiding another Markdown table parse. */
/** @param {Table} table */
function formatNativeTableFallback({ headers, rows, title = '' }) {
    const entries = rows.map((/** @type {any} */ row) => row.map((/** @type {string} */ cell, /** @type {number} */ column) =>
        `- ${headers[column] || `Columna ${column + 1}`}: ${cell}`).join('\n')).join('\n\n');
    return formatWhatsAppText([title, entries || headers.join(' · ')].filter(Boolean).join('\n\n'));
}

/** Canonical text for AI history, quoting and correlation of native table echoes. */
/** @param {any} message */
function extractNativeTableText(message) {
    const rich = message?.richResponseMessage || message?.botForwardedMessage?.message?.richResponseMessage;
    if (!rich || !Array.isArray(rich.submessages)) return '';
    const sections = [];
    const escapeCell = (/** @type {unknown} */ value) => String(value ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
    const markdownRow = (/** @type {unknown[]} */ row) => `| ${row.map(escapeCell).join(' | ')} |`;
    for (const submessage of rich.submessages) {
        if (typeof submessage.messageText === 'string' && submessage.messageText.trim()) sections.push(submessage.messageText.trim());
        const metadata = submessage.tableMetadata;
        if (!metadata || !Array.isArray(metadata.rows) || !metadata.rows.length) continue;
        const sourceRows = metadata.rows.filter((/** @type {any} */ row) => Array.isArray(row.items));
        if (!sourceRows.length) continue;
        const headingIndex = sourceRows.findIndex((/** @type {any} */ row) => row.isHeading);
        const headers = headingIndex === -1
            ? Array.from({ length: Math.max(...sourceRows.map((/** @type {any} */ row) => row.items.length)) }, (_, index) => `Columna ${index + 1}`)
            : sourceRows[headingIndex].items;
        const rows = sourceRows.filter((/** @type {any} */ _, /** @type {number} */ index) => index !== headingIndex).map((/** @type {any} */ row) => row.items);
        const columns = Math.max(headers.length, ...rows.map((/** @type {any} */ row) => row.length));
        const pad = (/** @type {unknown[]} */ row) => [...row, ...Array(Math.max(0, columns - row.length)).fill('')];
        const lines = [markdownRow(pad(headers)), markdownRow(Array(columns).fill('---')), ...rows.map((/** @type {any} */ row) => markdownRow(pad(row)))];
        if (metadata.title) lines.unshift(String(metadata.title));
        sections.push(lines.join('\n'));
    }
    return sections.join('\n\n');
}

/** Separate native tables from prose without changing the legacy caption formatter. */
/** @param {any} value @param {any} options1 */
/** @param {unknown} value @param {{maxLength?:number}} [options] @returns {MessageChunk[]} */
function planWhatsAppMessages(value, { maxLength = 3500 } = {}) {
    // Validate the same limit even when the response is empty or entirely tables.
    splitWhatsAppText('', { maxLength });
    const lines = String(value ?? '').replace(/\r\n/g, '\n').split('\n');
    /** @type {MessageChunk[]} */ const messages = [];
    /** @type {string[]} */ let prose = [];
    let fenceWidth = 0;
    const emitText = (/** @type {string} */ text) => {
        for (const chunk of splitWhatsAppText(formatWhatsAppText(text), { maxLength })) {
            messages.push({ type: 'text', text: chunk });
        }
    };
    const flushProse = () => { emitText(prose.join('\n')); prose = []; };
    const emitTable = (/** @type {string[]} */ headers, /** @type {string[][]} */ rows, /** @type {string[]} */ sourceLines) => {
        const headerLines = sourceLines.slice(0, 2);
        /** @type {string[][]} */ let pendingRows = [];
        /** @type {string[]} */ let pendingLines = [];
        const table = (/** @type {string[][]} */ batchRows, /** @type {string[]} */ batchLines) => ({ type: /** @type {'table'} */ ('table'), text: [...headerLines, ...batchLines].join('\n'), headers, rows: batchRows, title: '' });
        const fits = (/** @type {Table & {text:string}} */ candidate) => candidate.headers.length <= 20 && candidate.rows.length <= 100 &&
            candidate.headers.every(cell => cell.length <= 3500) && candidate.rows.every(row => row.every(cell => cell.length <= 3500)) &&
            Math.max(candidate.text.length, JSON.stringify(buildNativeTableMessage(candidate)).length) <= Math.min(maxLength, 64 * 1024);
        const flushRows = () => {
            if (pendingRows.length) messages.push(table(pendingRows, pendingLines));
            pendingRows = []; pendingLines = [];
        };
        if (!rows.length) {
            emitText(headers.join(' · '));
            return;
        }
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
            const row = rows[rowIndex];
            const line = sourceLines[rowIndex + 2];
            if (fits(table([...pendingRows, row], [...pendingLines, line]))) {
                pendingRows.push(row); pendingLines.push(line);
                continue;
            }
            flushRows();
            if (fits(table([row], [line]))) {
                pendingRows.push(row); pendingLines.push(line);
            } else {
                // Oversized cells remain complete; only their readable text is split.
                emitText(formatNativeTableFallback({ headers, rows: [row] }));
            }
        }
        flushRows();
    };
    for (let i = 0; i < lines.length; i++) {
        const fence = lines[i].match(/^\s{0,3}(`{3,})(.*)$/);
        if (fence) {
            if (!fenceWidth) fenceWidth = fence[1].length;
            else if (fence[1].length >= fenceWidth && !fence[2].trim()) fenceWidth = 0;
            prose.push(lines[i]);
            continue;
        }
        if (fenceWidth || i + 1 >= lines.length) { prose.push(lines[i]); continue; }
        const header = nativeTableCells(lines[i]);
        const separator = nativeTableCells(lines[i + 1]);
        if (!header.hasPipe || !header.cells.length || separator.cells.length !== header.cells.length ||
            !separator.cells.every(cell => /^:?-{3,}:?$/.test(cell))) {
            prose.push(lines[i]);
            continue;
        }
        flushProse();
        const sourceLines = [lines[i], lines[i + 1]];
        const headers = [...header.cells];
        const rows = [];
        i += 2;
        while (i < lines.length && lines[i].trim() && !/^\s{0,3}`{3,}/.test(lines[i])) {
            const parsed = nativeTableCells(lines[i]);
            if (!parsed.hasPipe) break;
            rows.push(parsed.cells);
            sourceLines.push(lines[i++]);
        }
        i--;
        // Ragged Markdown rows never discard extra or empty cells.
        const columns = Math.max(headers.length, ...rows.map((/** @type {any} */ row) => row.length));
        while (headers.length < columns) headers.push(`Columna ${headers.length + 1}`);
        for (const row of rows) while (row.length < columns) row.push('');
        emitTable(headers, rows, sourceLines);
    }
    flushProse();
    return messages;
}

module.exports = { formatWhatsAppText, splitWhatsAppText, planWhatsAppMessages, buildNativeTableMessage, formatNativeTableFallback, extractNativeTableText, WHATSAPP_FORMAT_INSTRUCTIONS };
