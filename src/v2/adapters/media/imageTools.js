// @ts-check
'use strict';

const fsPromises = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

const execFileAsync = promisify(execFile);
const PREFIX = 'botsky-image-tools-';
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
const DEFAULT_TTL_MS = 60 * 60 * 1000;
const CENSOR_LABEL = 'CENSURADO POR BOTSKY (COOPEREN XP)';
const FONT = '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf';
const IMAGE_TYPES = Object.freeze({
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp'
});

/** @param {typeof execFileAsync} [execute] */
function createExecFileRunner(execute = execFileAsync) {
    /** @param {string} command @param {string[]} args @param {{timeoutMs:number,signal:AbortSignal,maxBuffer:number}} options */
    return (command, args, options) => execute(command, args, {
        timeout: options.timeoutMs, signal: options.signal, maxBuffer: options.maxBuffer, windowsHide: true
    });
}

/** @param {unknown} error */
function isAbort(error) { return Boolean(error && typeof error === 'object' && /** @type {{name?:string}} */(error).name === 'AbortError'); }
/** @param {string} extension */
function safeExtension(extension) {
    const clean = String(extension || '').replace(/^\./, '').toLowerCase();
    if (!Object.hasOwn(IMAGE_TYPES, clean)) throw new TypeError('Unsupported image format');
    return /** @type {keyof typeof IMAGE_TYPES} */ (clean);
}
/** @param {Buffer} buffer @param {string} extension */
function validateImage(buffer, extension) {
    const ext = safeExtension(extension);
    if (!Buffer.isBuffer(buffer) || buffer.length < 12 || buffer.length > MAX_MEDIA_BYTES) throw new Error('Invalid image size');
    const valid = ext === 'jpg' || ext === 'jpeg' ? buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
        : ext === 'png' ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            : ext === 'webp' ? buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'
                : ext === 'gif' ? /^GIF8[79]a$/.test(buffer.toString('ascii', 0, 6))
                    : buffer.toString('ascii', 0, 2) === 'BM';
    if (!valid) throw new Error('Image content does not match its declared format');
    return { extension: ext, mime: IMAGE_TYPES[ext] };
}
/** Escape only a generated text-file path for FFmpeg's filter parser; user labels remain file contents. @param {string} value */
function filterPath(value) { return value.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/,/g, '\\,').replace(/\[/g, '\\[').replace(/\]/g, '\\]'); }
/** @param {string} value */
function plainLabel(value) { return String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90); }

/**
 * ImageToolsOptions
 * @typedef {{run?:(command:string,args:string[],options:{timeoutMs:number,signal:AbortSignal,maxBuffer:number})=>Promise<{stdout?:string|Buffer,stderr?:string|Buffer}>,download:(source:Record<string,unknown>,signal:AbortSignal)=>Promise<{buffer:Buffer,extension:string}>,downloadUrl:(url:string,signal:AbortSignal)=>Promise<{buffer:Buffer,extension:string}>,tempDirectory:string,files?:typeof fsPromises,clock?:{now:()=>number},randomId?:()=>string,maxMediaBytes?:number,outputTtlMs?:number,fontFile?:string}} ImageToolsOptions
 */

/** @param {ImageToolsOptions} options */
function createImageTools({ run = createExecFileRunner(), download, downloadUrl, tempDirectory, files = fsPromises,
    clock = { now: Date.now }, randomId = () => randomBytes(12).toString('hex'), maxMediaBytes = MAX_MEDIA_BYTES,
    outputTtlMs = DEFAULT_TTL_MS, fontFile = FONT }) {
    if (typeof download !== 'function' || typeof downloadUrl !== 'function') throw new TypeError('Image download ports are required');
    if (!path.isAbsolute(tempDirectory) || path.resolve(tempDirectory) !== tempDirectory || path.basename(tempDirectory) !== 'botsky-v2-media') throw new TypeError('Dedicated botsky-v2-media directory required');
    if (![maxMediaBytes, outputTtlMs].every(Number.isSafeInteger) || maxMediaBytes < 1 || outputTtlMs < 1000) throw new RangeError('Invalid image resource limits');
    if (fontFile !== null && (typeof fontFile !== 'string' || !path.isAbsolute(fontFile))) throw new TypeError('Font file must be an absolute configured path');
    /** @type {Promise<void>|undefined} */ let ready;
    /** @type {Map<string,number>} */ const leases = new Map();
    async function ensureDirectory() {
        if (!ready) ready = (async () => {
            await files.mkdir(tempDirectory, { recursive: true, mode: 0o700 });
            const stat = await files.lstat(tempDirectory);
            if (!stat.isDirectory() || stat.isSymbolicLink() || await files.realpath(tempDirectory) !== tempDirectory) throw new Error('Unsafe media temp directory');
            await files.chmod(tempDirectory, 0o700);
        })();
        return ready;
    }
    /** @param {AbortSignal} signal */
    async function workspace(signal) {
        signal.throwIfAborted(); await ensureDirectory(); signal.throwIfAborted();
        const id = randomId(); if (!/^[a-f0-9]{8,64}$/i.test(id)) throw new Error('Invalid image workspace id');
        return files.mkdtemp(path.join(tempDirectory, `${PREFIX}${id}-`));
    }
    /** @param {string} filename @param {Buffer|string} data */
    async function writePrivate(filename, data) { await files.writeFile(filename, data, { flag: 'wx', mode: 0o600 }); await files.chmod(filename, 0o600); }
    /** @param {string} directory */
    async function removeWorkspace(directory) {
        const resolved = path.resolve(directory);
        if (path.dirname(resolved) === tempDirectory && path.basename(resolved).startsWith(PREFIX)) await files.rm(resolved, { recursive: true, force: true });
    }
    /** @param {string} command @param {string[]} args @param {AbortSignal} signal */
    async function execute(command, args, signal) {
        signal.throwIfAborted(); const result = await run(command, args, { timeoutMs: 90_000, signal, maxBuffer: 4 * 1024 * 1024 }); signal.throwIfAborted(); return result;
    }
    /** @param {Record<string,unknown>} source @param {AbortSignal} signal */
    async function getImage(source, signal) {
        signal.throwIfAborted(); const media = await download(source, signal); signal.throwIfAborted();
        if (!media || !Buffer.isBuffer(media.buffer) || media.buffer.length > maxMediaBytes) throw new Error('Invalid downloaded image');
        return { ...validateImage(media.buffer, media.extension), buffer: media.buffer };
    }
    /** @param {string} ref */
    function ownedPath(ref) {
        if (typeof ref !== 'string' || !path.isAbsolute(ref)) return null;
        const resolved = path.resolve(ref), directory = path.dirname(resolved);
        if (path.dirname(directory) !== tempDirectory || !path.basename(directory).startsWith(PREFIX) || !/^output\.(?:jpg|jpeg)$/.test(path.basename(resolved))) return null;
        return { ref: resolved, directory };
    }
    /** @param {string} output */
    async function checkOutput(output) {
        const stat = await files.lstat(output);
        if (!stat.isFile() || stat.isSymbolicLink() || await files.realpath(output) !== output || stat.size < 1 || stat.size > maxMediaBytes) throw new Error('Image tool output is invalid');
        const header = await files.readFile(output);
        if (!Buffer.isBuffer(header) || header.length < 3 || header[0] !== 0xff || header[1] !== 0xd8 || header[2] !== 0xff) throw new Error('Image tool output is not a JPEG');
        await files.chmod(output, 0o600);
    }
    /** @param {string} directory @param {string} label */
    async function makeLabel(directory, label) {
        const filename = path.join(directory, 'label.txt'); await writePrivate(filename, label); return filename;
    }
    /** @param {Record<string,unknown>} source @param {{signal:AbortSignal,pixelBlock:number,barStart:number,barHeight:number,label:string}} options */
    async function censor(source, { signal, pixelBlock = 36, barStart = 0.38, barHeight = 0.24, label = CENSOR_LABEL }) {
        if (pixelBlock !== 36 || barStart !== 0.38 || barHeight !== 0.24 || typeof label !== 'string' || !label.trim()) throw new TypeError('Unsupported censor settings');
        let directory;
        try {
            const image = await getImage(source, signal); directory = await workspace(signal);
            const input = path.join(directory, `input.${image.extension}`), output = path.join(directory, 'output.jpg');
            await writePrivate(input, image.buffer); const labelFile = await makeLabel(directory, plainLabel(label));
            const baseFilter = 'pixelize=w=36:h=36,drawbox=x=0:y=ih*0.38:w=iw:h=ih*0.24:color=black:t=fill';
            const font = fontFile ? `:fontfile='${filterPath(fontFile)}'` : '';
            const withText = `${baseFilter},drawtext=textfile='${filterPath(labelFile)}':expansion=none:fontcolor=white:fontsize=h/22:x=(w-text_w)/2:y=h*0.38+(h*0.24-text_h)/2${font}`;
            try { await execute('ffmpeg', ['-y', '-i', input, '-vf', withText, '-frames:v', '1', output], signal); }
            catch (error) {
                if (isAbort(error)) throw error;
                await execute('ffmpeg', ['-y', '-i', input, '-vf', baseFilter, '-frames:v', '1', output], signal);
            }
            await checkOutput(output); leases.set(output, clock.now() + outputTtlMs); return { ref: output, mime: 'image/jpeg' };
        } catch (error) { if (directory) await removeWorkspace(directory); throw isAbort(error) ? error : new Error('Image censorship failed'); }
    }
    /** @param {Array<{title:string,thumbnailUrl?:string}>} items @param {AbortSignal} signal */
    async function render(items, signal) {
        if (!Array.isArray(items) || !items.length) return null;
        const selected = items.slice(0, 8).filter(item => item && typeof item.title === 'string');
        if (!selected.some(item => typeof item.thumbnailUrl === 'string')) return null;
        let directory;
        try {
            directory = await workspace(signal);
            const cols = selected.length === 1 ? 1 : 2, filters = [], inputs = [], positions = [], downloaded = [];
            for (let i = 0; i < selected.length; i++) {
                signal.throwIfAborted(); const item = selected[i]; let inputIndex = i;
                if (typeof item.thumbnailUrl === 'string' && item.thumbnailUrl) {
                    let media;
                    try {
                        const url = new URL(item.thumbnailUrl);
                        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid thumbnail URL');
                        media = await downloadUrl(url.href, signal); signal.throwIfAborted();
                        if (!media || !Buffer.isBuffer(media.buffer) || media.buffer.length > maxMediaBytes) throw new Error('Invalid thumbnail data');
                        const type = validateImage(media.buffer, media.extension);
                        const input = path.join(directory, `thumb-${i}.${type.extension}`); await writePrivate(input, media.buffer);
                        inputs.push('-i', input); downloaded.push(i);
                    } catch (error) { if (isAbort(error)) throw error; inputIndex = -1; }
                } else inputIndex = -1;
                if (inputIndex < 0) { inputs.push('-f', 'lavfi', '-i', 'color=c=0x1E1E1E:s=320x180:d=1'); inputIndex = i; }
                const labelFile = path.join(directory, `title-${i}.txt`);
                await writePrivate(labelFile, plainLabel(item.title) || `Video ${i + 1}`);
                const font = fontFile ? `:fontfile='${filterPath(fontFile)}'` : '';
                filters.push(`[${inputIndex}:v]scale=320:180:force_original_aspect_ratio=increase,crop=320:180,drawtext=text='${i + 1}':fontcolor=white:fontsize=36:box=1:boxcolor=black@0.85:boxborderw=8:x=12:y=12,drawtext=textfile='${filterPath(labelFile)}':expansion=none:fontcolor=white:fontsize=18:box=1:boxcolor=black@0.75:boxborderw=5:x=12:y=h-th-12${font}[v${i}]`);
                positions.push(`${(i % cols) * 320}_${Math.floor(i / cols) * 180}`);
            }
            if (!downloaded.length) { await removeWorkspace(directory); return null; }
            const output = path.join(directory, 'output.jpg');
            const stack = selected.length === 1 ? '[v0]copy[out]' : `${selected.map((_, i) => `[v${i}]`).join('')}xstack=inputs=${selected.length}:layout=${positions.join('|')}:fill=black[out]`;
            const filter = `${filters.join(';')};${stack}`;
            await execute('ffmpeg', ['-y', ...inputs, '-filter_complex', filter, '-map', '[out]', '-frames:v', '1', '-update', '1', '-q:v', '3', output], signal);
            await checkOutput(output); leases.set(output, clock.now() + outputTtlMs); return { ref: output, mime: 'image/jpeg' };
        } catch (error) { if (directory) await removeWorkspace(directory); if (isAbort(error)) throw error; return null; }
    }
    /** @param {string} ref */
    async function release(ref) {
        const owned = ownedPath(ref); if (!owned || !leases.has(owned.ref)) return false;
        leases.delete(owned.ref); await removeWorkspace(owned.directory); return true;
    }
    async function cleanupExpired() {
        await ensureDirectory(); let removed = 0;
        for (const name of await files.readdir(tempDirectory)) {
            if (!name.startsWith(PREFIX)) continue;
            const directory = path.join(tempDirectory, name);
            try {
                const stat = await files.lstat(directory);
                if (!stat.isDirectory() || stat.isSymbolicLink() || await files.realpath(directory) !== directory) continue;
                let expiresAt = leases.get(path.join(directory, 'output.jpg')) || leases.get(path.join(directory, 'output.jpeg'));
                if (!expiresAt) expiresAt = stat.mtimeMs + outputTtlMs;
                if (expiresAt <= clock.now()) { await removeWorkspace(directory); leases.delete(path.join(directory, 'output.jpg')); leases.delete(path.join(directory, 'output.jpeg')); removed++; }
            } catch { /* Workspace disappeared during cleanup. */ }
        }
        return removed;
    }
    return { censor, render, release, cleanupExpired };
}

module.exports = { createImageTools, createExecFileRunner, validateImage, plainLabel };
