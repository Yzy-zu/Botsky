// @ts-check
'use strict';
const { createDocumentHandlers } = require('./handler');

/** @param {Parameters<typeof createDocumentHandlers>[0]} ports @returns {import('../../pipeline/contracts').Feature} */
function createDocumentsFeature(ports) {
    const handlers = createDocumentHandlers(ports);
    const argsSchema = { type: 'object', properties: {
        format: { type: 'string', enum: ['mp3','m4a','ogg','wav','opus','mp4','webm','avi','gif','webp','pdf','docx','doc','xlsx','xls','pptx','ppt','odt','ods','odp'] },
        quality: { type: 'string', enum: ['alta','media','baja'] }, speed: { type: 'number', minimum: 0.25, maximum: 4 },
        bitrate: { type: 'string', maxLength: 16 }, trimStart: { type: 'string', maxLength: 16 }, trimEnd: { type: 'string', maxLength: 16 },
        name: { type: 'string', maxLength: 100 }, url: { type: 'string', maxLength: 2048 },
        action: { type: 'string', enum: ['finish','cancel'] }, cancel: { type: 'boolean' }, finish: { type: 'boolean' },
        pages: { type: 'string', maxLength: 100 }, zip: { type: 'boolean' }
    }, additionalProperties: false };
    /** @type {import('../../pipeline/contracts').Command[]} */
    const commands = [
        command('convertir', ['cv'], handlers.convert, 'Cambia el formato de un archivo de audio, video o imagen.', ['convertir -f mp3 con adjunto', 'convertir -f mp4 -q alta']),
        command('doc', ['pdf'], handlers.document, 'Convierte documentos entre formatos o crea un PDF con imágenes.', ['doc -f pdf con adjunto', 'pdf terminar']),
        command('comprimir', [], handlers.compress, 'Reduce el tamaño de un PDF adjunto.', ['comprimir (responde a un PDF)']),
        command('recortarpdf', ['recortar','cortar','cortarpdf','extraerpdf'], handlers.crop, 'Extrae páginas de un PDF.', ['recortar 1-5 (responde a un PDF)', 'recortar ultima']),
        command('unirpdf', ['unir','unirpdfs'], handlers.collectPdfs, 'Une varios PDF adjuntos.', ['unir (responde a un PDF)', 'unir terminar', 'unir cancelar']),
        command('pdf2img', ['extraer'], handlers.pdfImages, 'Extrae páginas de un PDF como imágenes.', ['pdf2img (responde a un PDF)', 'pdf2img --zip']),
        command('leer', ['ocr'], handlers.read, 'Extrae texto de una imagen, documento o página web.', ['leer (responde a una imagen)', 'ocr (responde a un PDF)'])
    ].map(item => ({ ...item, argsSchema, parseExplicit: tokens => parseExplicit(item.name, tokens) }));
    return { id: 'documents', commands, attachmentContinuation: handlers.attachmentContinuation, intents: [
        intent('documents.convert-media', 'Convertir audio, video o imagen a otro formato; acepta formato, calidad, velocidad, bitrate, recorte y nombre.', 'convertir'),
        intent('documents.convert-document', 'Convertir un documento entre formatos o reunir imágenes en un PDF; puede terminar o cancelar la colección.', 'doc'),
        intent('documents.compress-pdf', 'Comprimir o reducir el tamaño de un PDF adjunto.', 'comprimir'),
        intent('documents.crop-pdf', 'Extraer páginas específicas de un PDF adjunto.', 'recortarpdf'),
        intent('documents.merge-pdfs', 'Unir varios PDF adjuntos; terminar o cancelar la lista.', 'unirpdf'),
        intent('documents.pdf-to-images', 'Extraer páginas de un PDF adjunto como imágenes, opcionalmente en ZIP.', 'pdf2img'),
        intent('documents.read', 'Leer el texto de una imagen o documento adjunto, o una página web indicada mediante url.', 'leer')
    ] };

    /** @param {string} name @param {string[]} aliases @param {import('./handler').Handler} handler @param {string} short @param {string[]} examples @returns {import('../../pipeline/contracts').Command} */
    function command(name, aliases, handler, short, examples) {
        return { name, aliases, scope: ['private','group'], access: 'public', tier: 'heavy', timeoutMs: 900_000, allowLong: true,
            help: { short, examples }, handler };
    }
    /** @param {string} id @param {string} description @param {string} commandName */
    function intent(id, description, commandName) { return { id, description, schema: argsSchema, command: commandName }; }
}

/** @param {string} commandName @param {string[]} tokens @returns {Record<string,unknown>} */
function parseExplicit(commandName, tokens) {
    /** @type {Record<string,unknown>} */ const args = {};
    /** @type {string[]} */ const positional = [];
    const aliases = new Map([
        ['f','format'],['formato','format'],['format','format'],['q','quality'],['calidad','quality'],
        ['speed','speed'],['v','speed'],['velocidad','speed'],['bitrate','bitrate'],['b','bitrate'],
        ['ss','trimStart'],['i','trimStart'],['inicio','trimStart'],['to','trimEnd'],['e','trimEnd'],['fin','trimEnd'],
        ['name','name'],['n','name'],['nombre','name'],['pages','pages'],['p','pages'],['paginas','pages']
    ]);
    for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index];
        if (['terminar','finish'].includes(token.toLowerCase())) { args.action='finish'; continue; }
        if (['cancelar','cancel','--cancelar'].includes(token.toLowerCase())) { args.action='cancel'; continue; }
        if (token === '--zip' || token === 'zip') { args.zip=true; continue; }
        const flag = /^--?([a-zA-Z]+)(?:=(.*))?$/.exec(token);
        if (flag) {
            const key = aliases.get(flag[1].toLowerCase());
            if (!key) throw new TypeError('Invalid explicit document arguments');
            const value = flag[2] ?? tokens[++index];
            if (!value) throw new TypeError('Invalid explicit document arguments');
            if (key === 'speed') {
                const parsed = Number(value.toLowerCase().replace(/x$/,'').replace(',','.'));
                if (!Number.isFinite(parsed)) throw new TypeError('Invalid explicit document arguments');
                args.speed=parsed;
            } else args[key]=value;
            continue;
        }
        if (token.startsWith('-')) throw new TypeError('Invalid explicit document arguments');
        positional.push(token);
    }
    if (['convertir','leer'].includes(commandName) && positional.length) {
        const joined = positional.join(' ');
        if (!validUrl(joined)) throw new TypeError('Invalid explicit document arguments');
        args.url = joined;
    } else if (commandName === 'recortarpdf' && positional.length) args.pages=positional.join(' ');
    else if (commandName === 'pdf2img' && positional.length) args.pages=positional.join(' ');
    else if (commandName === 'doc' && positional.length && String(args.format || '').toLowerCase() === 'pdf' && args.pages === undefined) args.pages=positional.join(' ');
    else if (positional.length) throw new TypeError('Invalid explicit document arguments');
    return args;
}

/** @param {string} value */
function validUrl(value) { try { const url = new URL(value); return ['http:','https:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; } }
module.exports = { createDocumentsFeature, parseExplicit };
