// @ts-check
'use strict';

const fsPromises = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');

const execFileAsync = promisify(execFile);
const TEMP_PREFIX = 'botsky-media-';
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
const OUTPUT_TTL_MS = 60 * 60 * 1000;
const OCR_TIMEOUT_MS = 60 * 1000;
const QR_TIMEOUT_MS = 30 * 1000;
const MAX_PDF_PAGES = 5;
const MAX_QR_TEXT_CHARS = 8 * 1024;
const MAX_OCR_TEXT_CHARS = 32 * 1024;
const OCR_READ_MAX_BYTES = MAX_OCR_TEXT_CHARS * 4 + 16;
const OUTPUT_TRUNCATION_NOTICE = '[Salida recortada por límite de tamaño.]';

/** @param {string} text @param {number} maxChars @param {string} notice */
function capText(text, maxChars, notice = OUTPUT_TRUNCATION_NOTICE) {
    if (text.length <= maxChars) return text;
    return truncateText(text, maxChars, notice);
}

/** @param {string} text @param {number} maxChars @param {string} notice */
function truncateText(text, maxChars, notice) {
    const suffix = `\n\n${notice}`;
    const budget = Math.max(0, maxChars - suffix.length);
    let used = 0;
    let prefix = '';
    for (const char of text) { if (used + char.length > budget) break; prefix += char; used += char.length; }
    return `${prefix}${suffix}`;
}

/** @typedef {{buffer:Buffer,extension:string}} DownloadedMedia */
/** @typedef {{run?:(command:string,args:string[],options:{timeoutMs:number,signal:AbortSignal,maxBuffer:number})=>Promise<{stdout?:string|Buffer,stderr?:string|Buffer}>,download:(attachment:import('../../pipeline/contracts').Attachment,signal:AbortSignal)=>Promise<DownloadedMedia>,tempDirectory:string,files?:typeof fsPromises,clock?:{now:()=>number},maxMediaBytes?:number,outputTtlMs?:number,maxPdfPages?:number}} QrOcrOptions */

/** @param {typeof execFileAsync} [execute] */
function createExecFileRunner(execute = execFileAsync) {
    /** @param {string} command @param {string[]} args @param {{timeoutMs:number,signal:AbortSignal,maxBuffer:number}} options */
    const runner = (command, args, options) => execute(command, args, {
        timeout: options.timeoutMs,
        signal: options.signal,
        maxBuffer: options.maxBuffer,
        windowsHide: true
    });
    return runner;
}

/** @param {unknown} error */
function aborted(error) { return Boolean(error && typeof error === 'object' && /** @type {{name?:string}} */ (error).name === 'AbortError'); }

/** @param {string} extension */
function safeExtension(extension) {
    const clean = String(extension || '').replace(/^\./, '').toLowerCase();
    if (!/^[a-z0-9]{1,8}$/.test(clean)) throw new TypeError('Invalid media extension');
    return clean;
}

/** @param {unknown} value @param {number} maxBytes @returns {asserts value is DownloadedMedia} */
function assertDownloadedMedia(value, maxBytes) {
    if (!value || typeof value !== 'object' || !Buffer.isBuffer(/** @type {DownloadedMedia} */ (value).buffer) ||
        /** @type {DownloadedMedia} */ (value).buffer.length < 1 || /** @type {DownloadedMedia} */ (value).buffer.length > maxBytes) {
        throw new Error('Downloaded media is invalid or exceeds the configured limit');
    }
    safeExtension(/** @type {DownloadedMedia} */ (value).extension);
}

/** @param {QrOcrOptions} options */
function createQrOcrMedia({ run = createExecFileRunner(), download, tempDirectory, files = fsPromises,
    clock = { now: Date.now }, maxMediaBytes = MAX_MEDIA_BYTES, outputTtlMs = OUTPUT_TTL_MS, maxPdfPages = MAX_PDF_PAGES }) {
    if (typeof download !== 'function') throw new TypeError('Media download port is required');
    if (!path.isAbsolute(tempDirectory) || path.resolve(tempDirectory) !== tempDirectory || path.basename(tempDirectory) !== 'botsky-v2-media') {
        throw new TypeError('Dedicated botsky-v2-media directory required');
    }
    if (![maxMediaBytes, outputTtlMs, maxPdfPages].every(Number.isSafeInteger) || maxMediaBytes < 1 || outputTtlMs < 1000 || maxPdfPages < 1 || maxPdfPages > 20) {
        throw new RangeError('Invalid QR/OCR resource limits');
    }
    /** @type {Promise<void>|undefined} */ let ready;
    /** @returns {Promise<void>} */
    async function ensureTempDirectory() {
        if (ready) return ready;
        ready = (async () => {
            await files.mkdir(tempDirectory, { recursive: true, mode: 0o700 });
            const stat = await files.lstat(tempDirectory);
            if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe media temp directory');
            if (await files.realpath(tempDirectory) !== tempDirectory) throw new Error('Media temp directory is redirected');
            await files.chmod(tempDirectory, 0o700);
        })();
        return ready;
    }
    /** @param {AbortSignal} signal */
    function check(signal) { signal.throwIfAborted(); }
    /** @param {AbortSignal} signal */
    async function workspace(signal) {
        check(signal);
        await ensureTempDirectory();
        check(signal);
        return files.mkdtemp(path.join(tempDirectory, TEMP_PREFIX));
    }
    /** @param {string} filename @param {Buffer} buffer */
    async function writePrivate(filename, buffer) {
        await files.writeFile(filename, buffer, { flag: 'wx', mode: 0o600 });
        await files.chmod(filename, 0o600);
    }
    /** @param {string} directory */
    async function removeWorkspace(directory) {
        const resolved = path.resolve(directory);
        if (path.dirname(resolved) !== tempDirectory || !path.basename(resolved).startsWith(TEMP_PREFIX)) return;
        await files.rm(resolved, { recursive: true, force: true });
    }
    /** @param {import('../../pipeline/contracts').Attachment} attachment @param {AbortSignal} signal */
    async function downloadToWorkspace(attachment, signal) {
        check(signal);
        const media = await download(attachment, signal);
        check(signal);
        assertDownloadedMedia(media, maxMediaBytes);
        return media;
    }
    /** @param {string} command @param {string[]} args @param {number} timeoutMs @param {AbortSignal} signal */
    async function execute(command, args, timeoutMs, signal) {
        check(signal);
        const result = await run(command, args, { timeoutMs, signal, maxBuffer: 4 * 1024 * 1024 });
        check(signal);
        return result;
    }

    /** @param {string} text @param {AbortSignal} signal */
    async function create(text, signal) {
        if (typeof text !== 'string' || !text.trim() || text.length > 2048) throw new TypeError('QR text is invalid');
        const directory = await workspace(signal);
        const output = path.join(directory, 'qr.png');
        try {
            await execute('qrencode', ['-s', '10', '-m', '2', '-o', output, text], QR_TIMEOUT_MS, signal);
            const stat = await files.stat(output);
            if (!stat.isFile() || stat.size < 1 || stat.size > maxMediaBytes) throw new Error('QR generator produced invalid output');
            await files.chmod(output, 0o600);
            // Composer has no delivery-complete cleanup hook; cleanupExpired bounds this retained output.
            return { ref: output, mime: 'image/png' };
        } catch (error) {
            await removeWorkspace(directory);
            if (aborted(error)) throw error;
            throw new Error('QR generation failed');
        }
    }

    /** @param {import('../../pipeline/contracts').Attachment} attachment @param {AbortSignal} signal */
    async function read(attachment, signal) {
        if (!attachment || typeof attachment.id !== 'string' || !attachment.id || typeof attachment.chatId !== 'string' || !attachment.chatId) throw new TypeError('QR image attachment identity required');
        if (!/^image\//i.test(attachment.mime) && attachment.kind !== 'image') throw new TypeError('QR reader requires an image');
        const directory = await workspace(signal);
        try {
            const media = await downloadToWorkspace(attachment, signal);
            const input = path.join(directory, `input.${safeExtension(media.extension)}`);
            await writePrivate(input, media.buffer);
            const result = await execute('zbarimg', ['--quiet', '--raw', input], QR_TIMEOUT_MS, signal);
            const text = typeof result.stdout === 'string' ? result.stdout.trim() : Buffer.isBuffer(result.stdout) ? result.stdout.toString('utf8').trim() : '';
            return text ? capText(text, MAX_QR_TEXT_CHARS, '[Lectura QR recortada por límite de tamaño.]') : null;
        } catch (error) {
            if (aborted(error)) throw error;
            const code = error && typeof error === 'object' ? /** @type {{code?:string|number}} */ (error).code : undefined;
            if (code === '4' || code === 4) return null;
            throw new Error('QR reading failed');
        } finally {
            await removeWorkspace(directory);
        }
    }

    /** @param {import('../../pipeline/contracts').Attachment} attachment @param {{language:'spa+eng',signal:AbortSignal}} options */
    async function readText(attachment, { language, signal }) {
        if (!attachment || typeof attachment.id !== 'string' || !attachment.id || typeof attachment.chatId !== 'string' || !attachment.chatId) throw new TypeError('OCR attachment identity required');
        const directory = await workspace(signal);
        try {
            const media = await downloadToWorkspace(attachment, signal);
            const extension = safeExtension(media.extension);
            const input = path.join(directory, `input.${extension}`);
            await writePrivate(input, media.buffer);
            /** @type {string[]} */ let pages;
            let truncated = false;
            let textTruncated = false;
            if (extension === 'pdf' || attachment.mime.toLowerCase() === 'application/pdf') {
                const pagePrefix = path.join(directory, 'page');
                await execute('pdftoppm', ['-f', '1', '-l', String(maxPdfPages + 1), '-r', '200', '-png', input, pagePrefix], OCR_TIMEOUT_MS, signal);
                const names = (await files.readdir(directory)).filter(name => /^page-\d+\.png$/.test(name))
                    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
                truncated = names.length > maxPdfPages;
                pages = names.slice(0, maxPdfPages).map(name => path.join(directory, name));
                if (!pages.length) throw new Error('PDF produced no pages');
            } else if (extension === 'png' || extension === 'jpg' || extension === 'jpeg' || extension === 'webp' || extension === 'tif' || extension === 'tiff' || extension === 'bmp' || extension === 'pnm') {
                pages = [input];
            } else {
                throw new TypeError('OCR supports image files and PDF only');
            }

            /** @type {string[]} */ const recognized = [];
            let remainingChars = MAX_OCR_TEXT_CHARS;
            for (let index = 0; index < pages.length; index++) {
                if (remainingChars <= 0) { textTruncated = true; break; }
                check(signal);
                const outputBase = path.join(directory, `text-${index + 1}`);
                await execute('tesseract', [pages[index], outputBase, '-l', language], OCR_TIMEOUT_MS, signal);
                const textPath = `${outputBase}.txt`;
                const stat = await files.stat(textPath);
                if (!stat.isFile() || stat.size > maxMediaBytes) throw new Error('OCR output is invalid');
                const readBytes = Math.min(stat.size, OCR_READ_MAX_BYTES);
                const handle = await files.open(textPath, 'r');
                let content;
                try { const buffer = Buffer.alloc(readBytes); const { bytesRead } = await handle.read(buffer, 0, readBytes, 0); content = buffer.subarray(0, bytesRead).toString('utf8'); }
                finally { await handle.close(); }
                if (stat.size > OCR_READ_MAX_BYTES) textTruncated = true;
                const text = content.trim();
                if (text) {
                    let used = 0;
                    let visible = '';
                    for (const char of text) { if (used + char.length > remainingChars) break; visible += char; used += char.length; }
                    if (visible.length < text.length) textTruncated = true;
                    recognized.push(visible);
                    remainingChars -= visible.length;
                    if (textTruncated) break;
                }
            }
            let output = recognized.join('\n\n');
            if (textTruncated) output = truncateText(output, MAX_OCR_TEXT_CHARS, '[OCR recortado por límite de tamaño.]');
            if (truncated) output = capText(`${output}\n\n[Se procesaron las primeras ${maxPdfPages} páginas.]`, MAX_OCR_TEXT_CHARS,
                '[OCR truncado: se procesaron sólo las páginas permitidas.]');
            return output;
        } catch (error) {
            if (aborted(error)) throw error;
            throw new Error('OCR failed');
        } finally {
            await removeWorkspace(directory);
        }
    }

    /** Remove only this adapter's expired generated-output workspaces. Must be scheduled by composition. */
    async function cleanupExpired() {
        await ensureTempDirectory();
        const now = clock.now();
        let removed = 0;
        for (const name of await files.readdir(tempDirectory)) {
            if (!name.startsWith(TEMP_PREFIX) || name.includes(path.sep)) continue;
            const directory = path.join(tempDirectory, name);
            try {
                const stat = await files.lstat(directory);
                if (!stat.isDirectory() || stat.isSymbolicLink() || now - stat.mtimeMs < outputTtlMs) continue;
                await files.rm(directory, { recursive: true, force: true });
                removed++;
            } catch { /* A concurrent delivery or cleanup may already have removed this workspace. */ }
        }
        return removed;
    }

    /** Remove only generated QR output under this adapter's private directory. */
    /** @param {unknown} ref */
    async function release(ref) {
        if (typeof ref !== 'string') return false;
        const resolved = path.resolve(ref);
        const directory = path.dirname(resolved);
        if (path.dirname(directory) !== tempDirectory || !path.basename(directory).startsWith(TEMP_PREFIX) || path.basename(resolved) !== 'qr.png') return false;
        await ensureTempDirectory();
        let stat;
        try { stat = await files.lstat(directory); } catch (error) {
            if (error && typeof error === 'object' && /** @type {{code?:string}} */ (error).code === 'ENOENT') return false;
            throw error;
        }
        if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
        await files.rm(directory, { recursive: true, force: true });
        return true;
    }

    return { create, read, readText, release, cleanupExpired };
}

module.exports = { createQrOcrMedia, createExecFileRunner, safeExtension, capText, truncateText, MAX_MEDIA_BYTES, OUTPUT_TTL_MS, MAX_PDF_PAGES,
    MAX_QR_TEXT_CHARS, MAX_OCR_TEXT_CHARS };
