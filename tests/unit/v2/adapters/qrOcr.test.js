'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const nativeFs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setImmediate: waitImmediate } = require('node:timers/promises');
const { createQrOcrMedia } = require('../../../../src/v2/adapters/media/qrOcr');

function hasUnpairedSurrogate(text) {
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code >= 0xD800 && code <= 0xDBFF) {
            const next = text.charCodeAt(i + 1);
            if (!(next >= 0xDC00 && next <= 0xDFFF)) return true;
            i++;
        } else if (code >= 0xDC00 && code <= 0xDFFF) return true;
    }
    return false;
}

async function fixture(t, options = {}) {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'botsky-qr-ocr-test-'));
    const tempDirectory = path.join(parent, 'botsky-v2-media');
    t.after(() => fs.rm(parent, { recursive: true, force: true }));
    const runs = [];
    const downloads = [];
    let now = Date.now();
    const storageCalls = [];
    const files = Object.create(fs);
    for (const method of ['mkdir', 'mkdtemp', 'writeFile', 'readFile', 'readdir', 'stat', 'lstat', 'chmod', 'rm', 'realpath']) {
        files[method] = (...args) => { storageCalls.push(method); return fs[method](...args); };
    }
    const adapter = createQrOcrMedia({
        tempDirectory,
        files,
        clock: { now: () => now },
        download: async (source, signal) => { downloads.push(source.id); signal.throwIfAborted(); return { buffer: Buffer.from('media-bytes'), extension: options.extension || 'png' }; },
        run: async (command, args, runOptions) => {
            runs.push({ command, args, options: runOptions });
            if (options.run) return options.run(command, args, runOptions);
            if (command === 'qrencode') await fs.writeFile(args[args.indexOf('-o') + 1], Buffer.from('png-output'));
            if (command === 'tesseract') await fs.writeFile(`${args[1]}.txt`, options.ocrText || 'recognized words');
            if (command === 'pdftoppm') {
                const prefix = args.at(-1);
                const last = Number(args[args.indexOf('-l') + 1]);
                for (let page = 1; page <= last; page++) await fs.writeFile(`${prefix}-${page}.png`, Buffer.from(`page${page}`));
            }
            return { stdout: options.stdout || '' };
        },
        ...options.adapterOptions
    });
    return { adapter, tempDirectory, runs, downloads, storageCalls, now: value => { now = value; } };
}

const attachment = (overrides = {}) => ({ id: 'message-1', ownerJid: 'user', expiresAt: 1_800_000_100_000,
    chatId: 'chat-1', ref: 'provider-media-ref', mime: 'image/png', kind: 'image', ...overrides });

test('QR encoder uses execFile arguments, private temp storage, and keeps output until TTL cleanup', async t => {
    const f = await fixture(t);
    const payload = '--read-from=/synthetic/private';
    const output = await f.adapter.create(payload, new AbortController().signal);
    assert.equal(output.mime, 'image/png');
    assert.ok(output.ref.startsWith(path.join(f.tempDirectory, 'botsky-media-')));
    assert.equal(await fs.readFile(output.ref, 'utf8'), 'png-output');
    assert.equal((await fs.stat(output.ref)).mode & 0o077, 0);
    assert.deepEqual(f.runs[0].command, 'qrencode');
    assert.deepEqual(f.runs[0].args, ['-s', '10', '-m', '2', '-o', output.ref, '--', payload]);
    assert.equal(f.runs[0].options.timeoutMs, 30_000);
    assert.deepEqual(f.downloads, []);
    assert.ok(f.storageCalls.includes('mkdtemp'), 'the injected storage port owns temporary files');
    assert.equal(await f.adapter.cleanupExpired(), 0);
    f.now(Date.now() + 3_600_001);
    assert.equal(await f.adapter.cleanupExpired(), 1);
    await assert.rejects(fs.stat(output.ref), { code: 'ENOENT' });
});

test('QR release removes only an owned generated output workspace', async t => {
    const f = await fixture(t);
    const output = await f.adapter.create('release me', new AbortController().signal);
    assert.equal(await f.adapter.release(output.ref), true);
    assert.equal(await f.adapter.release(output.ref), false);
    assert.equal(await f.adapter.release(path.join(f.tempDirectory, 'business-data', 'qr.png')), false);
});

test('QR reader downloads the provider ref, runs zbarimg without a shell, and removes input workspace', async t => {
    const f = await fixture(t, { stdout: '  https://example.test/path\n' });
    const result = await f.adapter.read(attachment(), new AbortController().signal);
    assert.equal(result, 'https://example.test/path');
    assert.deepEqual(f.downloads, ['message-1']);
    assert.equal(f.runs[0].command, 'zbarimg');
    assert.deepEqual(f.runs[0].args.slice(0, 2), ['--quiet', '--raw']);
    assert.equal(await fs.readdir(f.tempDirectory).then(entries => entries.length), 0);
});

test('QR and OCR decoded text is capped with a visible notice on Unicode boundaries', async t => {
    const qr = await fixture(t, { stdout: '😀'.repeat(5000) });
    const qrText = await qr.adapter.read(attachment(), new AbortController().signal);
    assert.ok(qrText.length <= 8 * 1024);
    assert.match(qrText, /Lectura QR recortada/);
    assert.equal(hasUnpairedSurrogate(qrText), false);

    const ocr = await fixture(t, { ocrText: '漢'.repeat(40_000) });
    const ocrText = await ocr.adapter.readText(attachment(), { language: 'spa+eng', signal: new AbortController().signal });
    assert.ok(ocrText.length <= 32 * 1024);
    assert.match(ocrText, /OCR recortado/);
    assert.equal(hasUnpairedSurrogate(ocrText), false);
    assert.equal(await fs.readdir(ocr.tempDirectory).then(entries => entries.length), 0);
});

test('QR no-code exit maps to an empty result and rejects non-image attachments before download', async t => {
    const f = await fixture(t, { run: async () => { const error = Error('no symbol'); error.code = 4; throw error; } });
    assert.equal(await f.adapter.read(attachment(), new AbortController().signal), null);
    assert.equal(f.downloads.length, 1);
    await assert.rejects(f.adapter.read(attachment({ mime: 'application/pdf', kind: 'document' }), new AbortController().signal), /requires an image/);
    assert.equal(f.downloads.length, 1);
});

test('OCR image calls tesseract with the fixed language and cleans all temporary files', async t => {
    const f = await fixture(t, { ocrText: '  OCR result  ' });
    const result = await f.adapter.readText(attachment(), { language: 'spa+eng', signal: new AbortController().signal });
    assert.equal(result, 'OCR result');
    assert.deepEqual(f.downloads, ['message-1']);
    assert.equal(f.runs[0].command, 'tesseract');
    assert.deepEqual(f.runs[0].args.slice(1), [f.runs[0].args[1], '-l', 'spa+eng']);
    assert.equal(f.runs[0].options.timeoutMs, 60_000);
    assert.equal(await fs.readdir(f.tempDirectory).then(entries => entries.length), 0);
});

test('PDF OCR rasterizes only a bounded number of pages and identifies truncation', async t => {
    const f = await fixture(t, { extension: 'pdf', adapterOptions: { maxPdfPages: 3 } });
    const text = await f.adapter.readText(attachment({ mime: 'application/pdf', kind: 'document' }), {
        language: 'spa+eng', signal: new AbortController().signal
    });
    assert.equal(f.runs[0].command, 'pdftoppm');
    assert.equal(f.runs[0].args[f.runs[0].args.indexOf('-l') + 1], '4');
    assert.deepEqual(f.runs.slice(1).map(entry => entry.command), ['tesseract', 'tesseract', 'tesseract']);
    assert.match(text, /recognized words/);
    assert.match(text, /primeras 3 páginas/);
    assert.doesNotMatch(text, /page4/);
    assert.equal(await fs.readdir(f.tempDirectory).then(entries => entries.length), 0);
});

test('unsupported OCR formats and overlarge media fail safely and still clean the workspace', async t => {
    const f = await fixture(t, { extension: 'exe' });
    await assert.rejects(f.adapter.readText(attachment({ mime: 'application/octet-stream', kind: 'document' }), {
        language: 'spa+eng', signal: new AbortController().signal
    }), /OCR failed/);
    assert.equal(f.runs.length, 0);
    assert.equal(await fs.readdir(f.tempDirectory).then(entries => entries.length), 0);
    const large = await fixture(t, { adapterOptions: { maxMediaBytes: 2 } });
    await assert.rejects(large.adapter.read(attachment(), new AbortController().signal), /QR reading failed/);
    assert.equal(large.runs.length, 0);
    assert.equal(await fs.readdir(large.tempDirectory).then(entries => entries.length), 0);
});

test('cancelled subprocess receives the abort signal and temporary workspace is removed', async t => {
    let sawSignal;
    const f = await fixture(t, { run: (_command, _args, options) => new Promise((resolve, reject) => {
        sawSignal = options.signal;
        options.signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })), { once: true });
    }) });
    const controller = new AbortController();
    const work = f.adapter.readText(attachment(), { language: 'spa+eng', signal: controller.signal });
    while (!sawSignal) await waitImmediate();
    controller.abort();
    await assert.rejects(work, { name: 'AbortError' });
    assert.equal(sawSignal.aborted, true);
    assert.equal(await fs.readdir(f.tempDirectory).then(entries => entries.length), 0);
});

test('adapter refuses arbitrary temp directories and cleans only its own prefixed workspaces', async t => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'botsky-media-safety-'));
    t.after(() => fs.rm(parent, { recursive: true, force: true }));
    await assert.rejects(async () => createQrOcrMedia({ tempDirectory: path.join(parent, 'business-data'), download: async () => ({ buffer: Buffer.from('x'), extension: 'png' }) }), /Dedicated botsky-v2-media/);
    const f = await fixture(t);
    await fs.mkdir(f.tempDirectory, { recursive: true });
    await fs.writeFile(path.join(f.tempDirectory, 'business-data.txt'), 'keep');
    f.now(Date.now() + 3_600_001);
    assert.equal(await f.adapter.cleanupExpired(), 0);
    assert.equal(await fs.readFile(path.join(f.tempDirectory, 'business-data.txt'), 'utf8'), 'keep');
});
