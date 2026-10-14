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

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'botsky-wave-a-image-trace-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'synthetic.png');
  await execFileAsync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
    'color=c=blue:s=320x180:d=1', '-frames:v', '1', source], { timeout: 15_000 });
  const png = await fs.readFile(source);
  const adapter = createImageTools({
    tempDirectory: path.join(root, 'botsky-v2-media'),
    download: async (_source, signal) => { signal.throwIfAborted(); return { buffer: png, extension: 'png' }; },
    downloadUrl: async (_url, signal) => { signal.throwIfAborted(); return { buffer: png, extension: 'png' }; },
  });
  return { root, adapter, png, signal: new AbortController().signal };
}

async function assertJpeg(ref) {
  const output = await fs.readFile(ref);
  assert.deepEqual([...output.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  assert.ok(output.length > 1000, 'real FFmpeg produced a nontrivial JPEG');
}

// TR-0714: missing or malformed item lists return no collage without a download or subprocess.
test('TR-0714 empty and invalid collage input returns null without doing work', async t => {
  const f = await fixture(t);
  assert.equal(await f.adapter.render([], f.signal), null);
  assert.equal(await f.adapter.render([null, {}, { title: 4 }], f.signal), null);
  assert.equal(await fs.stat(path.join(f.root, 'botsky-v2-media')).then(() => true, () => false), false);
});

// TR-0715: unsupported and failed thumbnail downloads return no result, never fetch local/credential URLs.
test('TR-0715 invalid or unavailable thumbnail URLs return null and stay within the injected downloader', async t => {
  const f = await fixture(t);
  const calls = [];
  const adapter = createImageTools({
    tempDirectory: path.join(f.root, 'botsky-v2-media'),
    download: async () => ({ buffer: f.png, extension: 'png' }),
    downloadUrl: async url => { calls.push(url); throw new Error('synthetic not found'); },
  });
  assert.equal(await adapter.render([{ title: 'local', thumbnailUrl: 'file:///etc/passwd' }], f.signal), null);
  assert.equal(await adapter.render([{ title: 'credentialed', thumbnailUrl: 'https://user:pass@media.invalid/a.png' }], f.signal), null);
  assert.equal(await adapter.render([{ title: 'unavailable', thumbnailUrl: 'https://synthetic.invalid/missing.png' }], f.signal), null);
  assert.deepEqual(calls, ['https://synthetic.invalid/missing.png']);
});

// TR-0716: four synthetic thumbnails render as an actual JPEG and release removes the workspace.
test('TR-0716 four local synthetic thumbnails produce a valid JPEG and cleanup their workspace', async t => {
  const f = await fixture(t);
  const result = await f.adapter.render(Array.from({ length: 4 }, (_, index) => ({
    title: `synthetic item ${index + 1}`, thumbnailUrl: `https://synthetic.invalid/${index + 1}.png`,
  })), f.signal);
  assert.ok(result);
  assert.equal(result.mime, 'image/jpeg');
  await assertJpeg(result.ref);
  assert.equal(await f.adapter.release(result.ref), true);
  assert.deepEqual(await fs.readdir(path.join(f.root, 'botsky-v2-media')), []);
});

// TR-0717: a failed thumbnail gets a neutral tile while successful images still produce a valid result.
test('TR-0717 a failed thumbnail is replaced by a neutral tile without failing the collage', async t => {
  const f = await fixture(t);
  const calls = [];
  const adapter = createImageTools({
    tempDirectory: path.join(f.root, 'botsky-v2-media'),
    download: async () => ({ buffer: f.png, extension: 'png' }),
    downloadUrl: async (url, signal) => {
      calls.push(url);
      signal.throwIfAborted();
      if (url.endsWith('/missing.png')) throw new Error('synthetic timeout');
      return { buffer: f.png, extension: 'png' };
    },
  });
  const result = await adapter.render([
    { title: 'successful item', thumbnailUrl: 'https://synthetic.invalid/ok.png' },
    { title: 'failed item', thumbnailUrl: 'https://synthetic.invalid/missing.png' },
  ], f.signal);
  assert.ok(result);
  await assertJpeg(result.ref);
  const filter = await fs.readFile(path.join(path.dirname(result.ref), 'title-1.txt'), 'utf8');
  assert.equal(filter, 'failed item');
  assert.deepEqual(calls, ['https://synthetic.invalid/ok.png', 'https://synthetic.invalid/missing.png']);
  assert.equal(await adapter.release(result.ref), true);
});
