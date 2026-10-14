'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createImageTools } = require('../../../../src/v2/adapters/media/imageTools');

const execFileAsync = promisify(execFile);

test('local FFmpeg smoke: censored image and thumbnail collage are valid JPEGs', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'botsky-image-tools-smoke-'));
    const tempDirectory = path.join(root, 'botsky-v2-media');
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const sourcePng = path.join(root, 'synthetic.png');
    await execFileAsync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:d=1', '-frames:v', '1', sourcePng], { timeout: 15_000 });
    const buffer = await fs.readFile(sourcePng);
    const media = createImageTools({
        tempDirectory,
        download: async (_source, signal) => { signal.throwIfAborted(); return { buffer, extension: 'png' }; },
        downloadUrl: async (_url, signal) => { signal.throwIfAborted(); return { buffer, extension: 'png' }; }
    });
    const signal = new AbortController().signal;
    const censored = await media.censor({ ref: 'synthetic', mime: 'image/png' }, { signal, pixelBlock: 36, barStart: 0.38, barHeight: 0.24, label: 'Synthetic safety label' });
    const collage = await media.render([
        { title: 'Synthetic blue one', thumbnailUrl: 'https://synthetic.invalid/one' },
        { title: 'Synthetic blue two', thumbnailUrl: 'https://synthetic.invalid/two' }
    ], signal);
    assert.ok(collage);
    for (const image of [censored, collage]) {
        const bytes = await fs.readFile(image.ref);
        assert.equal(bytes[0], 0xff);
        assert.equal(bytes[1], 0xd8);
        assert.equal(bytes[2], 0xff);
        assert.ok(bytes.length > 1000);
        assert.equal(await media.release(image.ref), true);
    }
});
