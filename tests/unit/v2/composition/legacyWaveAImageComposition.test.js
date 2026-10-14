'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createMediaServices } = require('../../../../src/v2/composition/media');
const { FakeClock } = require('../../../../src/v2/platform/clock');

const execFileAsync = promisify(execFile);

// TR-0716: composition uses the injected bounded URL downloader and shared release lifecycle.
test('TR-0716 composition renders four synthetic thumbnails through its injected URL port', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'botsky-wave-a-image-composition-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'synthetic.png');
  await execFileAsync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
    'color=c=green:s=320x180:d=1', '-frames:v', '1', source], { timeout: 15_000 });
  const image = await fs.readFile(source);
  const calls = [];
  const runtime = createMediaServices({
    config: { TMP_DIR: root }, clock: new FakeClock(10),
    llm: { generate: async () => { throw new Error('LLM not used'); } },
    evolution: { downloadMedia: async () => { throw new Error('Evolution not used'); } },
    http: { post: async () => { throw new Error('HTTP provider not used'); } },
    formData: () => { throw new Error('FormData not used'); },
    urlDownload: { download: async (url, signal) => {
      calls.push(url); signal.throwIfAborted();
      return { buffer: image, extension: 'png', mime: 'image/png' };
    } },
  });
  t.after(() => runtime.dispose());
  const result = await runtime.services.imageTools.render(Array.from({ length: 4 }, (_, index) => ({
    title: `composed ${index}`, thumbnailUrl: `https://synthetic.invalid/${index}.png`,
  })), new AbortController().signal);
  assert.ok(result);
  assert.equal(result.mime, 'image/jpeg');
  assert.deepEqual(calls, Array.from({ length: 4 }, (_, index) => `https://synthetic.invalid/${index}.png`));
  assert.deepEqual([...(await fs.readFile(result.ref)).subarray(0, 3)], [0xff, 0xd8, 0xff]);
  await runtime.services.imageTools.release(result.ref);
  await assert.rejects(fs.stat(result.ref), { code: 'ENOENT' });
});
