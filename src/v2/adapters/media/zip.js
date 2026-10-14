// @ts-check
'use strict';

const fsPromises = require('node:fs/promises');
const path = require('node:path');

const MAX_FILES = 100;
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

/** @typedef {{path:string,name:string}} ZipFile */
/** @param {ZipFile[]} files @param {string} output @param {{signal:AbortSignal,maxBytes?:number,fs?:typeof fsPromises}} options */
async function writeZip(files, output, { signal, maxBytes = DEFAULT_MAX_BYTES, fs = fsPromises }) {
    if (!Array.isArray(files) || files.length < 1 || files.length > MAX_FILES) throw new Error('Invalid ZIP file count');
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > DEFAULT_MAX_BYTES) throw new Error('Invalid ZIP byte limit');
    if (!path.isAbsolute(output) || path.resolve(output) !== output) throw new Error('Invalid ZIP output path');
    const root = path.dirname(output);
    const rootStat = await fs.lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || await fs.realpath(root) !== root) throw new Error('ZIP output directory is not owned');
    const names = new Set();
    const contents = [];
    let total = 0;
    for (const file of files) {
        signal.throwIfAborted();
        if (!file || typeof file.path !== 'string' || !path.isAbsolute(file.path) || path.dirname(path.resolve(file.path)) !== root) throw new Error('ZIP input is outside output directory');
        if (!validName(file.name) || names.has(file.name)) throw new Error('Invalid or duplicate ZIP entry name');
        names.add(file.name);
        const stat = await fs.lstat(file.path);
        if (!stat.isFile() || stat.isSymbolicLink() || await fs.realpath(file.path) !== file.path) throw new Error('ZIP input is not an owned regular file');
        if (!Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > maxBytes - total) throw new Error('ZIP inputs exceed byte limit');
        const data = await fs.readFile(file.path);
        total += data.length;
        if (total > maxBytes) throw new Error('ZIP inputs exceed byte limit');
        contents.push({ name: Buffer.from(file.name, 'utf8'), data });
    }
    signal.throwIfAborted();
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    for (const item of contents) {
        const crc = crc32(item.data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8);
        local.writeUInt16LE(0, 10); local.writeUInt16LE(33, 12);
        local.writeUInt32LE(crc, 14); local.writeUInt32LE(item.data.length, 18); local.writeUInt32LE(item.data.length, 22);
        local.writeUInt16LE(item.name.length, 26); local.writeUInt16LE(0, 28);
        localParts.push(local, item.name, item.data);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(0, 10); central.writeUInt16LE(0, 12); central.writeUInt16LE(33, 14);
        central.writeUInt32LE(crc, 16); central.writeUInt32LE(item.data.length, 20); central.writeUInt32LE(item.data.length, 24);
        central.writeUInt16LE(item.name.length, 28); central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32);
        central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36); central.writeUInt32LE(0, 38); central.writeUInt32LE(offset, 42);
        centralParts.push(central, item.name);
        offset += local.length + item.name.length + item.data.length;
    }
    const centralDirectory = Buffer.concat(centralParts);
    const localDirectory = Buffer.concat(localParts);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(contents.length, 8); end.writeUInt16LE(contents.length, 10);
    end.writeUInt32LE(centralDirectory.length, 12); end.writeUInt32LE(localDirectory.length, 16); end.writeUInt16LE(0, 20);
    const archive = Buffer.concat([localDirectory, centralDirectory, end]);
    let created = false;
    /** @type {import('node:fs/promises').FileHandle|undefined} */
    let handle;
    try {
        signal.throwIfAborted();
        handle = await fs.open(output, 'wx', 0o600);
        created = true;
        signal.throwIfAborted();
        await handle.writeFile(archive);
        await handle.close();
        handle = undefined;
        signal.throwIfAborted();
    } catch (error) {
        if (handle) await handle.close().catch(() => {});
        if (created) await fs.unlink(output).catch(() => {});
        throw error;
    }
    return { bytes: archive.length, files: contents.length };
}

/** @param {string} name */
function validName(name) {
    return typeof name === 'string' && name.length > 0 && Buffer.byteLength(name, 'utf8') <= 255 && name !== '.' && name !== '..' && !/[\\/\0]/.test(name) && !/^[a-zA-Z]:/.test(name);
}

/** @param {Buffer} buffer */
function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc ^= byte;
        for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

module.exports = { writeZip };
