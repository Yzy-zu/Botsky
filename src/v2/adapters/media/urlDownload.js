// @ts-check
'use strict';

const dns = require('node:dns').promises;
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { SystemClock } = require('../../platform/clock');

const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
/** @type {Readonly<Record<string,string>>} */
const TYPES = Object.freeze(Object.fromEntries([
    ['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/gif', 'gif'], ['image/webp', 'webp'], ['image/avif', 'avif'],
    ['audio/mpeg', 'mp3'], ['audio/mp3', 'mp3'], ['audio/mp4', 'm4a'], ['audio/aac', 'aac'], ['audio/ogg', 'ogg'], ['audio/opus', 'opus'], ['audio/wav', 'wav'], ['audio/x-wav', 'wav'], ['audio/flac', 'flac'],
    ['video/mp4', 'mp4'], ['video/webm', 'webm'], ['video/quicktime', 'mov'], ['video/x-msvideo', 'avi'], ['video/x-matroska', 'mkv'],
    ['application/pdf', 'pdf'], ['text/plain', 'txt'], ['text/markdown', 'md'], ['text/csv', 'csv'], ['application/json', 'json'],
]));
const OPT_IN_TEXT_TYPES = Object.freeze({'text/html':'html','application/xhtml+xml':'xhtml'});
const ALL_TYPES = /** @type {Readonly<Record<string,string>>} */(Object.freeze({...TYPES,...OPT_IN_TEXT_TYPES}));

/** @typedef {{address:string,family:4|6}} Address */
/** @typedef {{statusCode:number,headers:Record<string,string|string[]|undefined>,stream:import('node:stream').Readable}} HttpResponse */
/**
 * Build a direct URL downloader. `transport` must connect to the supplied resolved address,
 * rather than resolving the hostname again.
 * @param {{resolve?:(hostname:string,signal:AbortSignal)=>Promise<Address[]>,transport?:(request:{url:URL,address:string,family:4|6,signal:AbortSignal,timeoutMs:number})=>Promise<HttpResponse>,clock?:import('../../platform/clock').Clock,maxBytes?:number,timeoutMs?:number,maxRedirects?:number,allowedContentTypes?:string[]}} [options]
 */
function createUrlDownload(options = {}) {
    const resolve = options.resolve || defaultResolve;
    const transport = options.transport || defaultTransport;
    const clock = options.clock || new SystemClock();
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxRedirects = options.maxRedirects ?? 3;
    const allowedTypes=new Set(Object.keys(TYPES));
    if(options.allowedContentTypes!==undefined) {
        if(!Array.isArray(options.allowedContentTypes)||options.allowedContentTypes.some(type=>typeof type!=='string'||!Object.hasOwn(ALL_TYPES,type)))throw new TypeError('Unsupported opt-in content type');
        for(const type of options.allowedContentTypes)allowedTypes.add(type);
    }
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new RangeError('maxBytes must be a positive safe integer');
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('timeoutMs must be positive');
    if (!Number.isInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 3) throw new RangeError('maxRedirects must be between zero and three');

    /** @param {string|URL} input @param {AbortSignal} [externalSignal] */
    async function download(input, externalSignal) {
        let url;
        try { url = new URL(input); } catch { throw new Error('Invalid download URL'); }
        const controller = new AbortController();
        const abortFromCaller = () => controller.abort(externalSignal?.reason || new Error('Download aborted'));
        if (externalSignal?.aborted) abortFromCaller();
        else externalSignal?.addEventListener('abort', abortFromCaller, { once: true });
        const timer = clock.setTimeout(() => controller.abort(new Error('Download deadline exceeded')), timeoutMs);
        try {
            for (let redirects = 0; ; redirects++) {
                checkUrl(url);
                throwIfAborted(controller.signal);
                const address = await resolvePinned(url.hostname, controller.signal, resolve);
                throwIfAborted(controller.signal);
                const response = await transport({ url, address: address.address, family: address.family, signal: controller.signal, timeoutMs });
                const status = response.statusCode;
                if ([301, 302, 303, 307, 308].includes(status)) {
                    const location = header(response.headers, 'location');
                    response.stream.destroy();
                    if (!location) throw new Error('Redirect missing Location');
                    if (redirects >= maxRedirects) throw new Error('Too many redirects');
                    /** @type {URL} */
                    const nextUrl = new URL(location, url);
                    if (url.protocol === 'https:' && nextUrl.protocol === 'http:') throw new Error('HTTPS downgrade redirect denied');
                    url = nextUrl;
                    continue;
                }
                if (status < 200 || status >= 300) {
                    response.stream.destroy();
                    throw new Error(`Download failed with HTTP ${status}`);
                }
                const declaredLength = header(response.headers, 'content-length');
                if (declaredLength !== undefined) {
                    if (!/^\d+$/.test(declaredLength)) { response.stream.destroy(); throw new Error('Invalid Content-Length'); }
                    if (Number(declaredLength) > maxBytes) { response.stream.destroy(); throw new Error('Download exceeds byte limit'); }
                }
                const chunks = [];
                let size = 0;
                const stopStream = () => response.stream.destroy(controller.signal.reason instanceof Error ? controller.signal.reason : new Error('Download aborted'));
                controller.signal.addEventListener('abort', stopStream, { once: true });
                try {
                    for await (const chunk of response.stream) {
                        throwIfAborted(controller.signal);
                        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                        size += buffer.length;
                        if (size > maxBytes) throw new Error('Download exceeds byte limit');
                        chunks.push(buffer);
                    }
                } catch (error) {
                    response.stream.destroy();
                    throw error;
                } finally {
                    controller.signal.removeEventListener('abort', stopStream);
                }
                throwIfAborted(controller.signal);
                const mime = normalizeMime(header(response.headers, 'content-type'),allowedTypes);
                const extension = extensionFor(mime, url,allowedTypes);
                return { buffer: Buffer.concat(chunks, size), extension, mime };
            }
        } finally {
            clock.clearTimeout(timer);
            externalSignal?.removeEventListener('abort', abortFromCaller);
        }
    }
    return { download };
}

/** @param {string} hostname @param {AbortSignal} signal @param {(hostname:string,signal:AbortSignal)=>Promise<Address[]>} resolver */
async function resolvePinned(hostname, signal, resolver) {
    const literalFamily = net.isIP(hostname);
    const answers = literalFamily ? [{ address: hostname, family: /** @type {4|6} */(literalFamily) }] : await resolver(hostname, signal);
    if (!Array.isArray(answers) || answers.length === 0) throw new Error('Host did not resolve');
    for (const answer of answers) {
        const family = net.isIP(answer.address);
        if (!family || family !== answer.family || !isPublicAddress(answer.address)) throw new Error('URL host resolves to a non-public address');
    }
    return answers[0];
}

/** @param {string|URL} input */
function checkUrl(input) {
    const url = input instanceof URL ? input : new URL(input);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only HTTP(S) URLs are supported');
    if (url.username || url.password) throw new Error('URL credentials are not allowed');
    if (!url.hostname || url.hostname.endsWith('.localhost') || url.hostname === 'localhost') throw new Error('Local hosts are not allowed');
    if (url.port && (!/^\d+$/.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65535)) throw new Error('Invalid URL port');
}

/** Conservative public-address filter. IPv6 is limited to global unicast and excludes special-purpose ranges. @param {string} address */
function isPublicAddress(address) {
    const family = net.isIP(address);
    if (family === 4) {
        const p = address.split('.').map(Number);
        const [a, b] = p;
        const c = p[2];
        return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168) ) || (a === 192 && b === 88 && c === 99) || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0));
    }
    if (family !== 6 || address.includes('%')) return false;
    const value = ipv6BigInt(address);
    if (value === null) return false;
    // Global unicast 2000::/3 only; reject documentation, protocol assignments, 6to4 and benchmarking ranges.
    const top3 = value >> 125n;
    if (top3 !== 1n) return false;
    /** @param {bigint} prefix @param {number} bits */
    const inPrefix = (prefix, bits) => (value >> BigInt(128 - bits)) === prefix;
    return !(inPrefix(0x20010db8n, 32) || inPrefix(0x20010000n, 23) || inPrefix(0x2002n, 16) || inPrefix(0x3fffn, 20));
}

/** Parse an IPv6 literal to a 128-bit integer, including embedded dotted quads. @param {string} input */
function ipv6BigInt(input) {
    let value = input.toLowerCase();
    if (value.includes('.')) {
        const at = value.lastIndexOf(':');
        const ipv4 = value.slice(at + 1).split('.').map(Number);
        if (ipv4.length !== 4 || ipv4.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return null;
        value = `${value.slice(0, at)}:${((ipv4[0] << 8) | ipv4[1]).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`;
    }
    const halves = value.split('::');
    if (halves.length > 2) return null;
    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    const fill = halves.length === 2 ? 8 - left.length - right.length : 0;
    const words = [...left, ...Array(fill).fill('0'), ...right];
    if (words.length !== 8 || words.some(word => !/^[0-9a-f]{1,4}$/.test(word))) return null;
    return words.reduce((sum, word) => (sum << 16n) | BigInt(`0x${word}`), 0n);
}

/** @param {Record<string,string|string[]|undefined>} headers @param {string} name */
function header(headers, name) {
    const value = Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
    return Array.isArray(value) ? value[0] : value;
}

/** @param {string|undefined} input */
function normalizeMime(input,allowedTypes=new Set(Object.keys(TYPES))) {
    const mime = (input || '').split(';', 1)[0].trim().toLowerCase();
    if (Object.hasOwn(ALL_TYPES,mime)&&allowedTypes.has(mime)) return mime;
    if (!mime || mime === 'application/octet-stream' || mime === 'binary/octet-stream') return '';
    throw new Error('Unsupported download content type');
}

/** @param {string} mime @param {URL} url */
function extensionFor(mime, url,allowedTypes=new Set(Object.keys(TYPES))) {
    if (mime) return ALL_TYPES[mime];
    const candidate = url.pathname.split('/').pop()?.split('.').pop()?.toLowerCase() || '';
    const match = Object.entries(ALL_TYPES).find(([type,extension]) => allowedTypes.has(type)&&extension === candidate);
    if (!match) throw new Error('Unsupported download content type');
    return match[1];
}

/** @param {string} hostname @param {AbortSignal} signal @returns {Promise<Address[]>} */
async function defaultResolve(hostname, signal) {
    throwIfAborted(signal);
    const found = await dns.lookup(hostname, { all: true, verbatim: true });
    throwIfAborted(signal);
    return found.map(({ address, family }) => ({ address, family: /** @type {4|6} */(family) }));
}

/** Pinned Node HTTP(S) transport. TLS SNI and Host continue to use the original URL hostname. */
/** @param {{url:URL,address:string,family:4|6,signal:AbortSignal,timeoutMs:number}} request @returns {Promise<HttpResponse>} */
function defaultTransport(request) {
    return new Promise((resolve, reject) => {
        const client = request.url.protocol === 'https:' ? https : http;
        const hostname = request.url.hostname.replace(/^\[|\]$/g, '');
        const req = client.request({
            protocol: request.url.protocol, hostname, port: request.url.port || undefined,
            method: 'GET', path: `${request.url.pathname}${request.url.search}`,
            headers: { Host: request.url.host, 'User-Agent': 'botsky-v2-url-download' }, agent: false,
            lookup: (_host, _options, callback) => callback(null, request.address, request.family),
            signal: request.signal,
        }, response => resolve({ statusCode: response.statusCode || 0, headers: response.headers, stream: response }));
        req.setTimeout(request.timeoutMs, () => req.destroy(new Error('Download socket timeout')));
        req.on('error', reject);
        req.end();
    });
}

/** @param {AbortSignal} signal */
function throwIfAborted(signal) {
    if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Download aborted');
}

module.exports = { createUrlDownload, isPublicAddress };
