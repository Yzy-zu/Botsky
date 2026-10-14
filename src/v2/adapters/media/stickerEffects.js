// @ts-check
'use strict';

const fsPromises = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
/** @type {StickerEffectsOptions['webpMux']} */
// @ts-ignore node-webpmux does not publish a declaration file.
const WebpMux = require('node-webpmux');

const execFileAsync = promisify(execFile);
const PREFIX = 'botsky-sticker-';
const DEFAULT_LIMIT = 20 * 1024 * 1024;
const DEFAULT_TTL = 60 * 60 * 1000;
const IMAGE_EXTENSIONS = Object.freeze(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff']);
const VIDEO_EXTENSIONS = Object.freeze(['mp4', 'mov', 'avi', 'webm']);
const EFFECTS = Object.freeze({
    ardilla: ['-filter_complex', 'rubberband=pitch=1.5'],
    robot: ['-filter_complex', "afftfilt=real='hypot(re,im)*sin(0)':imag='hypot(re,im)*cos(0)':win_size=512:overlap=0.75"],
    lento: ['-filter_complex', 'rubberband=tempo=0.5'],
    rapido: ['-filter_complex', 'rubberband=tempo=2.0'],
    grave: ['-filter_complex', 'rubberband=pitch=0.7'],
    eco: ['-filter_complex', 'aecho=0.8:0.88:60:0.4'],
    reversa: ['-af', 'areverse']
});

/** @typedef {{buffer:Buffer,extension:string}} DownloadedMedia */
/** @typedef {{ref:string,mime:string,kind?:string,id?:string,chatId?:string,ownerJid?:string}} MediaSource */
/** @typedef {{run?:(command:string,args:string[],options:{timeoutMs:number,signal:AbortSignal,maxBuffer:number})=>Promise<{stdout?:string|Buffer,stderr?:string|Buffer}>,download:(source:MediaSource,signal:AbortSignal)=>Promise<DownloadedMedia>,downloadUrl?:(url:string,signal:AbortSignal)=>Promise<DownloadedMedia>,tempDirectory:string,files?:typeof fsPromises,clock?:{now:()=>number},randomId?:()=>string,maxMediaBytes?:number,outputTtlMs?:number,webpMux?:{Image:new()=>{load(filename:string):Promise<void>,exif:Buffer,save(filename:string):Promise<void>}}}} StickerEffectsOptions */

/** @param {typeof execFileAsync} [execute] */
function createExecFileRunner(execute = execFileAsync) {
    /** @param {string} command @param {string[]} args @param {{timeoutMs:number,signal:AbortSignal,maxBuffer:number}} options */
    return (command, args, options) => execute(command, args, {
        timeout: options.timeoutMs, signal: options.signal, maxBuffer: options.maxBuffer, windowsHide: true
    });
}

/** @param {string} extension */
function safeExtension(extension) {
    const clean = String(extension || '').replace(/^\./, '').toLowerCase();
    if (!/^[a-z0-9]{1,8}$/.test(clean)) throw new TypeError('Invalid media extension');
    return clean;
}

/** @param {unknown} value @param {number} maxBytes @returns {asserts value is DownloadedMedia} */
function assertMedia(value, maxBytes) {
    if (!value || typeof value !== 'object' || !Buffer.isBuffer(/** @type {DownloadedMedia} */(value).buffer) ||
        /** @type {DownloadedMedia} */(value).buffer.length < 1 || /** @type {DownloadedMedia} */(value).buffer.length > maxBytes) {
        throw new Error('Media input is invalid or exceeds the configured limit');
    }
    safeExtension(/** @type {DownloadedMedia} */(value).extension);
}

/** @param {unknown} error */
function isAbort(error) { return Boolean(error && typeof error === 'object' && /** @type {{name?:string}} */(error).name === 'AbortError'); }

/** @param {StickerEffectsOptions} options */
function createStickerEffectsMedia({ run = createExecFileRunner(), download, downloadUrl, tempDirectory,
    files = fsPromises, clock = { now: Date.now }, randomId = () => randomBytes(12).toString('hex'),
    maxMediaBytes = DEFAULT_LIMIT, outputTtlMs = DEFAULT_TTL, webpMux = WebpMux }) {
    const mux = /** @type {NonNullable<StickerEffectsOptions['webpMux']>} */ (webpMux);
    if (typeof download !== 'function') throw new TypeError('Media download port is required');
    if (!path.isAbsolute(tempDirectory) || path.resolve(tempDirectory) !== tempDirectory || path.basename(tempDirectory) !== 'botsky-v2-media') {
        throw new TypeError('Dedicated botsky-v2-media directory required');
    }
    if (![maxMediaBytes, outputTtlMs].every(Number.isSafeInteger) || maxMediaBytes < 1 || outputTtlMs < 1000) throw new RangeError('Invalid media resource limits');
    /** @type {Promise<void>|undefined} */ let ready;
    /** @returns {Promise<void>} */
    async function ensureDirectory() {
        if (ready) return ready;
        ready = (async () => {
            await files.mkdir(tempDirectory, { recursive: true, mode: 0o700 });
            const stat = await files.lstat(tempDirectory);
            if (!stat.isDirectory() || stat.isSymbolicLink() || await files.realpath(tempDirectory) !== tempDirectory) throw new Error('Unsafe media temp directory');
            await files.chmod(tempDirectory, 0o700);
        })();
        return ready;
    }
    /** @param {AbortSignal} signal */
    const check = signal => signal.throwIfAborted();
    /** @param {AbortSignal} signal */
    async function workspace(signal) {
        check(signal); await ensureDirectory(); check(signal);
        const id = randomId();
        if (!/^[a-f0-9]{8,64}$/i.test(id)) throw new Error('Invalid media workspace id');
        return files.mkdtemp(path.join(tempDirectory, `${PREFIX}${id}-`));
    }
    /** @param {string} filename @param {Buffer} buffer */
    async function writePrivate(filename, buffer) { await files.writeFile(filename, buffer, { flag: 'wx', mode: 0o600 }); await files.chmod(filename, 0o600); }
    /** @param {string} directory */
    async function removeWorkspace(directory) {
        const resolved = path.resolve(directory);
        if (path.dirname(resolved) === tempDirectory && path.basename(resolved).startsWith(PREFIX)) await files.rm(resolved, { recursive: true, force: true });
    }
    /** @param {string} command @param {string[]} args @param {number} timeoutMs @param {AbortSignal} signal */
    async function execute(command, args, timeoutMs, signal) {
        check(signal); const result = await run(command, args, { timeoutMs, signal, maxBuffer: 4 * 1024 * 1024 }); check(signal); return result;
    }
    /** @param {MediaSource} source @param {AbortSignal} signal */
    async function fetch(source, signal) {
        check(signal); const media = await download(source, signal); check(signal); assertMedia(media, maxMediaBytes); return media;
    }
    /** @param {string} ref @param {AbortSignal} signal */
    async function localSource(ref, signal) {
        if (!path.isAbsolute(ref)) return null;
        const resolved = path.resolve(ref);
        if (path.dirname(path.dirname(resolved)) !== tempDirectory || !path.basename(path.dirname(resolved)).startsWith(PREFIX) || !path.basename(resolved).startsWith('input.')) return null;
        check(signal);
        const stat = await files.lstat(resolved);
        if (!stat.isFile() || stat.isSymbolicLink() || await files.realpath(resolved) !== resolved || stat.size < 1 || stat.size > maxMediaBytes) throw new TypeError('Invalid managed media reference');
        return { directory: path.dirname(resolved), input: resolved, extension: safeExtension(path.extname(resolved)) };
    }
    /** @param {MediaSource} source @param {AbortSignal} signal */
    async function sourcePath(source, signal) {
        const local = await localSource(source.ref, signal);
        if (local) return local;
        const media = await fetch(source, signal); const directory = await workspace(signal);
        const input = path.join(directory, `input.${safeExtension(media.extension)}`);
        await writePrivate(input, media.buffer); return { directory, input, extension: safeExtension(media.extension) };
    }
    /** @param {string} output */
    async function addExif(output) {
        const image = new mux.Image(); await image.load(output);
        const metadata = { 'sticker-pack-id': '', 'sticker-pack-name': '', 'sticker-pack-publisher': '', emojis: [] };
        const header = Buffer.from([0x49,0x49,0x2A,0x00,0x08,0x00,0x00,0x00,0x01,0x00,0x41,0x57,0x07,0x00,0x00,0x00,0x00,0x00,0x16,0x00,0x00,0x00]);
        const json = Buffer.from(JSON.stringify(metadata), 'utf8'); const exif = Buffer.concat([header, json]); exif.writeUIntLE(json.length, 14, 4);
        image.exif = exif; await image.save(output);
    }
    /** @param {string} input @param {string} output @param {boolean} crop */
    function stillArgs(input, output, crop) {
        const scale = crop ? 'scale=512:512:force_original_aspect_ratio=increase,crop=512:512' : "scale='if(gt(iw,ih),512,-2)':'if(gt(iw,ih),-2,512)'";
        return ['-y','-i',input,'-vf',scale,'-c:v','libwebp','-quality','90','-lossless','0','-frames:v','1',output];
    }
    /** @param {string} input @param {string} output @param {boolean} crop @param {AbortSignal} signal */
    async function animated(input, output, crop, signal) {
        const scale = crop ? 'scale=512:512:force_original_aspect_ratio=increase,crop=512:512' : 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000';
        const gif = path.join(path.dirname(output), 'animated.gif');
        await execute('ffmpeg', ['-y','-t','6','-i',input,'-vf',`fps=10,${scale},split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`,'-loop','0',gif], 60_000, signal);
        try { await execute('gif2webp', [gif,'-lossy','-q','30','-m','3','-mt','-min_size','-o',output], 60_000, signal); }
        finally { await files.rm(gif, { force: true }); }
    }
    /** @param {{ref:string,mime:string}} media @param {{crop:boolean,forceAnimated:boolean,maxDurationSeconds:6,signal:AbortSignal}} options */
    async function createSticker(media, { crop, forceAnimated, maxDurationSeconds, signal }) {
        if (!media || typeof media.ref !== 'string' || !media.ref || typeof media.mime !== 'string' || maxDurationSeconds !== 6) throw new TypeError('Invalid sticker input');
        const source = await sourcePath(media, signal); const output = path.join(source.directory, 'sticker.webp');
        let keep = false;
        try {
            if (![...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS].includes(source.extension)) throw new TypeError('Unsupported sticker media format');
            const video = VIDEO_EXTENSIONS.includes(source.extension);
            if (video ? !media.mime.toLowerCase().startsWith('video/') : !media.mime.toLowerCase().startsWith('image/')) throw new TypeError('Sticker media type does not match its format');
            const animatedInput = video || source.extension === 'gif' && await probeAnimated(source.input, signal);
            const requestedAnimation = forceAnimated && ['gif','mp4'].includes(source.extension);
            const useAnimated = animatedInput || requestedAnimation;
            if (useAnimated) await animated(source.input, output, crop, signal);
            else await execute('ffmpeg', stillArgs(source.input, output, crop), 30_000, signal);
            check(signal);
            const stat = await files.stat(output);
            if (!stat.isFile() || stat.size < 1 || stat.size > maxMediaBytes) throw new Error('Sticker output is invalid');
            await addExif(output); check(signal); keep = true;
            return { ref: output, mime: 'image/webp' };
        } catch (error) { if (isAbort(error)) throw error; throw new Error('Sticker processing failed'); }
        finally { if (!keep) await removeWorkspace(source.directory); }
    }
    /** @param {string} input @param {AbortSignal} signal */
    async function probeAnimated(input, signal) {
        try {
            const result = await execute('ffprobe', ['-v','error','-select_streams','v:0','-show_entries','stream=nb_frames','-of','default=noprint_wrappers=1:nokey=1',input], 30_000, signal);
            const value = typeof result.stdout === 'string' ? result.stdout.trim() : Buffer.isBuffer(result.stdout) ? result.stdout.toString('utf8').trim() : '';
            return Number.parseInt(value, 10) > 1;
        } catch (error) { if (isAbort(error)) throw error; return false; }
    }
    /** @param {{ref:string,mime:string}} media @param {string} effect @param {AbortSignal} signal */
    async function applyEffect(media, effect, signal) {
        if (!media || typeof media.ref !== 'string' || !media.ref || !Object.hasOwn(EFFECTS, effect)) throw new TypeError('Invalid audio effect input');
        const source = await sourcePath(media, signal); const output = path.join(source.directory, 'effect.ogg'); let keep = false;
        try {
            if (!['mp4','mov','avi','webm','mp3','ogg','opus','wav','m4a','aac','flac'].includes(source.extension)) throw new TypeError('Unsupported effect media format');
            if (!/^audio\//i.test(media.mime) && !/^video\//i.test(media.mime)) throw new TypeError('Audio effect requires audio or video');
            await execute('ffmpeg', ['-y','-i',source.input,...EFFECTS[/** @type {keyof typeof EFFECTS} */(effect)],'-c:a','libopus','-b:a','74k','-vn',output], 60_000, signal);
            check(signal); const stat = await files.stat(output);
            if (!stat.isFile() || stat.size < 1 || stat.size > maxMediaBytes) throw new Error('Effect output is invalid');
            keep = true; return { ref: output, mime: 'audio/ogg' };
        } catch (error) { if (isAbort(error)) throw error; throw new Error('Audio effect processing failed'); }
        finally { if (!keep) await removeWorkspace(source.directory); }
    }
    /** @param {string} url @param {AbortSignal} signal */
    async function downloadUrlMedia(url, signal) {
        if (typeof downloadUrl !== 'function') throw new Error('URL media download is unavailable');
        let parsed;
        try { parsed = new URL(url); } catch { throw new TypeError('Invalid media URL'); }
        if (!['http:','https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new TypeError('Invalid media URL');
        const media = await downloadUrl(parsed.href, signal); check(signal); assertMedia(media, maxMediaBytes);
        const directory = await workspace(signal); const extension = safeExtension(media.extension); const input = path.join(directory, `input.${extension}`);
        try { await writePrivate(input, media.buffer); return { ref: input, mime: mimeFor(extension), kind: VIDEO_EXTENSIONS.includes(extension) ? 'video' : 'image' }; }
        catch (error) { await removeWorkspace(directory); throw error; }
    }
    /** @param {string} extension */
    function mimeFor(extension) {
        return ({jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',webp:'image/webp',bmp:'image/bmp',tiff:'image/tiff',mp4:'video/mp4',mov:'video/quicktime',avi:'video/x-msvideo',webm:'video/webm'})[extension] || 'application/octet-stream';
    }
    /** Retained refs remain valid until delivery; this explicit janitor bounds storage when the pipeline has no delivery callback. */
    async function cleanupExpired() {
        await ensureDirectory(); const now = clock.now(); let removed = 0;
        for (const name of await files.readdir(tempDirectory)) {
            if (!name.startsWith(PREFIX)) continue;
            const directory = path.join(tempDirectory, name); const stat = await files.lstat(directory);
            if (stat.isDirectory() && !stat.isSymbolicLink() && now - stat.mtimeMs >= outputTtlMs) { await removeWorkspace(directory); removed++; }
        }
        return removed;
    }
    /** Remove only a generated file in an owned workspace, after composer delivery. @param {string} ref */
    async function release(ref) {
        if (typeof ref !== 'string' || !path.isAbsolute(ref)) return false;
        const resolved = path.resolve(ref); const directory = path.dirname(resolved); const name = path.basename(resolved);
        if (!['sticker.webp','effect.ogg'].includes(name) || path.dirname(directory) !== tempDirectory || !path.basename(directory).startsWith(PREFIX)) return false;
        try {
            const stat = await files.lstat(resolved);
            if (!stat.isFile() || stat.isSymbolicLink() || await files.realpath(resolved) !== resolved) return false;
            await removeWorkspace(directory); return true;
        } catch (error) {
            if (error && typeof error === 'object' && /** @type {{code?:string}} */(error).code === 'ENOENT') return false;
            throw error;
        }
    }
    return { createSticker, applyEffect, downloadUrl: downloadUrlMedia, cleanupExpired, release };
}

module.exports = { createStickerEffectsMedia, createExecFileRunner, EFFECTS, safeExtension };
