'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createStickerEffectsMedia } = require('../../../../src/v2/adapters/media/stickerEffects');

async function fixture(options = {}) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sticker-effects-test-'));
    const tempDirectory = path.join(root, 'botsky-v2-media');
    const calls = [];
    const downloaded = [];
    const mux = { Image: class {
        async load(filename) { assert.equal((await fs.stat(filename)).isFile(), true); }
        set exif(_value) {}
        async save(filename) { assert.equal((await fs.stat(filename)).isFile(), true); }
    } };
    const run = async (command, args, callOptions) => {
        calls.push({ command, args, options: callOptions });
        if (options.run) return options.run(command, args, callOptions);
        if (command === 'ffprobe') return { stdout: options.frameCount || '1' };
        const output = command === 'gif2webp' ? args[args.indexOf('-o') + 1] : args.at(-1);
        await fs.writeFile(output, Buffer.from('fake media output'));
        return { stdout: '' };
    };
    const adapter = createStickerEffectsMedia({
        tempDirectory, run, webpMux: mux,
        download: async source => { downloaded.push(source); assert.equal(source.ref, 'attachment://media'); return { buffer: Buffer.from('input'), extension: options.extension || 'png' }; },
        downloadUrl: async url => { assert.equal(url, 'https://example.test/a.gif'); return { buffer: Buffer.from('url input'), extension: 'gif' }; },
        ...options.adapter
    });
    return { adapter, calls, downloaded, root, tempDirectory };
}

test('sticker adapter preserves static crop, animation caps, metadata and delivery lease', async t => {
    const f = await fixture(); t.after(() => fs.rm(f.root, { recursive: true, force: true }));
    const result = await f.adapter.createSticker({ ref: 'attachment://media', mime: 'image/png' }, {
        crop: true, forceAnimated: false, maxDurationSeconds: 6, signal: new AbortController().signal
    });
    assert.equal(result.mime, 'image/webp');
    const command = f.calls.find(call => call.command === 'ffmpeg');
    assert.ok(command.args.includes('-vf'));
    assert.ok(command.args[command.args.indexOf('-vf') + 1].includes('crop=512:512'));
    assert.ok((await fs.stat(result.ref)).size > 0);
    assert.equal(await fs.readdir(f.tempDirectory).then(entries => entries.length), 1, 'successful output remains available for composer delivery');
    assert.deepEqual(f.downloaded[0], { ref: 'attachment://media', mime: 'image/png' }, 'download port receives attachment metadata, not only an opaque ref');
    assert.equal(await f.adapter.release(result.ref), true);
    assert.deepEqual(await fs.readdir(f.tempDirectory), []);
});

test('animated video uses six-second GIF pipeline and static images ignore forced animation', async t => {
    const animated = await fixture({ extension: 'mp4' }); t.after(() => fs.rm(animated.root, { recursive: true, force: true }));
    const output = await animated.adapter.createSticker({ ref: 'attachment://media', mime: 'video/mp4' }, {
        crop: false, forceAnimated: false, maxDurationSeconds: 6, signal: new AbortController().signal
    });
    const ffmpeg = animated.calls.find(call => call.command === 'ffmpeg');
    assert.ok(ffmpeg.args.includes('-t'));
    assert.equal(ffmpeg.args[ffmpeg.args.indexOf('-t') + 1], '6');
    assert.ok(animated.calls.some(call => call.command === 'gif2webp'));
    assert.equal(output.mime, 'image/webp');

    const still = await fixture({ extension: 'jpg' }); t.after(() => fs.rm(still.root, { recursive: true, force: true }));
    await still.adapter.createSticker({ ref: 'attachment://media', mime: 'image/jpeg' }, {
        crop: false, forceAnimated: true, maxDurationSeconds: 6, signal: new AbortController().signal
    });
    assert.equal(still.calls.some(call => call.command === 'gif2webp'), false);
});

test('URL download hands a managed local reference into sticker creation without a second provider fetch', async t => {
    const f = await fixture({ extension: 'ogg' }); t.after(() => fs.rm(f.root, { recursive: true, force: true }));
    const media = await f.adapter.downloadUrl('https://example.test/a.gif', new AbortController().signal);
    assert.equal(media.mime, 'image/gif');
    const result = await f.adapter.createSticker(media, {
        crop: false, forceAnimated: false, maxDurationSeconds: 6, signal: new AbortController().signal
    });
    assert.equal(result.mime, 'image/webp');
    assert.equal(f.calls.some(call => call.command === 'ffprobe'), true);
});

test('effects use the legacy filter strings with safe execFile args and retain OGG output', async t => {
    const f = await fixture({ extension: 'ogg' }); t.after(() => fs.rm(f.root, { recursive: true, force: true }));
    for (const [name, filter] of Object.entries({ ardilla: 'rubberband=pitch=1.5', robot: 'afftfilt=', lento: 'rubberband=tempo=0.5',
        rapido: 'rubberband=tempo=2.0', grave: 'rubberband=pitch=0.7', eco: 'aecho=0.8:0.88:60:0.4', reversa: 'areverse' })) {
        const media = await f.adapter.applyEffect({ ref: 'attachment://media', mime: 'audio/ogg' }, name, new AbortController().signal);
        const command = f.calls.filter(call => call.command === 'ffmpeg').at(-1);
        assert.equal(command.args.includes('libopus'), true);
        assert.equal(command.args.join(' ').includes(filter), true, name);
        assert.equal(media.mime, 'audio/ogg');
    }
    assert.ok(f.calls.every(call => Array.isArray(call.args)));
});

test('failed processing and cancellation remove private workspaces; invalid URLs and media are rejected', async t => {
    const failing = await fixture({ extension: 'png', run: async () => { throw new Error('sensitive ffmpeg path'); } });
    t.after(() => fs.rm(failing.root, { recursive: true, force: true }));
    await assert.rejects(failing.adapter.createSticker({ ref: 'attachment://media', mime: 'image/png' }, {
        crop: false, forceAnimated: false, maxDurationSeconds: 6, signal: new AbortController().signal
    }), /Sticker processing failed/);
    assert.deepEqual(await fs.readdir(failing.tempDirectory), []);
    await assert.rejects(failing.adapter.downloadUrl('file:///etc/passwd', new AbortController().signal), /Invalid media URL/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(failing.adapter.applyEffect({ ref: 'attachment://media', mime: 'audio/ogg' }, 'ardilla', controller.signal), { name: 'AbortError' });
    assert.deepEqual(await fs.readdir(failing.tempDirectory), []);
});

test('expired retained files can be removed by explicit TTL janitor', async t => {
    const f = await fixture(); t.after(() => fs.rm(f.root, { recursive: true, force: true }));
    const output = await f.adapter.createSticker({ ref: 'attachment://media', mime: 'image/png' }, {
        crop: false, forceAnimated: false, maxDurationSeconds: 6, signal: new AbortController().signal
    });
    assert.ok(await fs.stat(output.ref));
    // The adapter has a one-hour TTL by default; advancing its injected clock makes this output eligible.
    const janitor = createStickerEffectsMedia({ tempDirectory: f.tempDirectory, run: async () => ({}),
        download: async () => ({ buffer: Buffer.from('unused'), extension: 'png' }), webpMux: { Image: class {} },
        clock: { now: () => Date.now() + 2 * 60 * 60 * 1000 } });
    assert.equal(await janitor.cleanupExpired(), 1);
    assert.deepEqual(await fs.readdir(f.tempDirectory), []);
});
