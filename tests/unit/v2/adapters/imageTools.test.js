'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createImageTools } = require('../../../../src/v2/adapters/media/imageTools');

const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(16)]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]);
const source = { ref: 'provider-image', mime: 'image/png', kind: 'image', id: 'synthetic-image' };

async function fixture(t, overrides = {}) {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'botsky-image-tools-test-'));
    const tempDirectory = path.join(parent, 'botsky-v2-media');
    t.after(() => fs.rm(parent, { recursive: true, force: true }));
    const runs = [], downloads = [], urlDownloads = [];
    let now = Date.now();
    const adapter = createImageTools({
        tempDirectory,
        download: async (item, signal) => { downloads.push(item); signal.throwIfAborted(); return { buffer: png, extension: 'png' }; },
        downloadUrl: async (url, signal) => { urlDownloads.push(url); signal.throwIfAborted(); return { buffer: png, extension: 'png' }; },
        run: async (command, args, options) => {
            runs.push({ command, args, options });
            const out = args.at(-1);
            if (overrides.run) return overrides.run({ command, args, options, out });
            await fs.writeFile(out, jpeg);
            return {};
        },
        clock: { now: () => now },
        ...overrides.options
    });
    return { adapter, tempDirectory, runs, downloads, urlDownloads, now: value => { now = value; } };
}

test('censor applies fixed pixelation and an opaque band; label is isolated in a private text file', async t => {
    const f = await fixture(t);
    const result = await f.adapter.censor(source, { signal: new AbortController().signal, pixelBlock: 36, barStart: 0.38, barHeight: 0.24, label: 'CENSURADO ; [x] %{metadata}' });
    assert.equal(result.mime, 'image/jpeg');
    assert.ok(result.ref.startsWith(f.tempDirectory));
    assert.match(f.runs[0].args[f.runs[0].args.indexOf('-vf') + 1], /pixelize=w=36:h=36/);
    assert.match(f.runs[0].args[f.runs[0].args.indexOf('-vf') + 1], /y=ih\*0\.38:w=iw:h=ih\*0\.24:color=black:t=fill/);
    assert.match(f.runs[0].args[f.runs[0].args.indexOf('-vf') + 1], /textfile=/);
    assert.doesNotMatch(f.runs[0].args[f.runs[0].args.indexOf('-vf') + 1], /CENSURADO ;/);
    assert.equal(await fs.readFile(path.join(path.dirname(result.ref), 'label.txt'), 'utf8'), 'CENSURADO ; [x] %{metadata}');
    assert.equal(await fs.stat(path.join(path.dirname(result.ref), 'label.txt')).then(s => s.mode & 0o077), 0);
    assert.equal(await f.adapter.release('/etc/passwd'), false);
    assert.equal(await f.adapter.release(result.ref), true);
    assert.deepEqual(await fs.readdir(f.tempDirectory), []);
});

test('collage is limited to eight items, uses local title files, and fills failed downloads with a tile', async t => {
    const f = await fixture(t, { options: { maxMediaBytes: 1024 } });
    const items = Array.from({ length: 10 }, (_, i) => ({ title: `title ${i} %{metadata}`, thumbnailUrl: `https://media.invalid/${i}.png` }));
    // The injected downloader fails one item; it is rendered as the neutral lavfi tile.
    const adapter = createImageTools({
        tempDirectory: f.tempDirectory,
        download: async () => ({ buffer: png, extension: 'png' }),
        downloadUrl: async (url, signal) => {
            if (url.endsWith('/1.png')) throw Error('synthetic download failure');
            signal.throwIfAborted(); return { buffer: png, extension: 'png' };
        },
        run: async (command, args) => { f.runs.push({ command, args }); await fs.writeFile(args.at(-1), jpeg); return {}; }
    });
    const result = await adapter.render(items, new AbortController().signal);
    assert.equal(result.mime, 'image/jpeg');
    assert.equal(f.runs.length, 1);
    const args = f.runs[0].args;
    assert.equal(args.filter(arg => arg === '-i').length, 8);
    assert.match(args[args.indexOf('-filter_complex') + 1], /xstack=inputs=8:layout=/);
    assert.match(args[args.indexOf('-filter_complex') + 1], /expansion=none/);
    assert.doesNotMatch(args[args.indexOf('-filter_complex') + 1], /title 0/);
    assert.equal(await fs.readFile(path.join(path.dirname(result.ref), 'title-0.txt'), 'utf8'), 'title 0 %{metadata}');
    assert.equal(await adapter.release(result.ref), true);
});

test('collage rejects local-file URLs, returns null when no URL survives, and bounds labels', async t => {
    const f = await fixture(t);
    assert.equal(await f.adapter.render([{ title: 'x', thumbnailUrl: 'file:///private/image' }], new AbortController().signal), null);
    assert.equal(f.urlDownloads.length, 0);
    assert.equal(await f.adapter.render([{ title: 'x', thumbnailUrl: 'https://user:pass@media.invalid/image' }], new AbortController().signal), null);
    assert.equal(f.urlDownloads.length, 0);
});

test('abort cleans owned workspaces and corrupt media never reaches ffmpeg', async t => {
    const f = await fixture(t);
    const corrupt = createImageTools({ tempDirectory: f.tempDirectory, download: async () => ({ buffer: Buffer.alloc(20, 1), extension: 'png' }), downloadUrl: async () => ({ buffer: png, extension: 'png' }), run: async () => { assert.fail('ffmpeg must not run for invalid image bytes'); } });
    await assert.rejects(corrupt.censor(source, { signal: new AbortController().signal }), /censorship failed/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(f.adapter.censor(source, { signal: controller.signal }), { name: 'AbortError' });
    await assert.rejects(fs.stat(f.tempDirectory), { code: 'ENOENT' });
});

test('TTL janitor removes expired adapter workspaces only', async t => {
    const f = await fixture(t);
    const result = await f.adapter.censor(source, { signal: new AbortController().signal });
    await fs.mkdir(path.join(f.tempDirectory, 'business-data'));
    f.now(Date.now() + 3_600_001);
    assert.equal(await f.adapter.cleanupExpired(), 1);
    assert.equal(await fs.stat(path.join(f.tempDirectory, 'business-data')).then(s => s.isDirectory()), true);
    await assert.rejects(fs.stat(result.ref), { code: 'ENOENT' });
});
