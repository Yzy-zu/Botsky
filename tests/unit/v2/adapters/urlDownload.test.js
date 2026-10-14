'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createUrlDownload, isPublicAddress } = require('../../../../src/v2/adapters/media/urlDownload');
const { FakeClock } = require('../../../../src/v2/platform/clock');

function response(statusCode, headers = {}, chunks = ['data']) {
    return { statusCode, headers, stream: Readable.from(chunks.map(chunk => Buffer.from(chunk))) };
}
function fake(options = {}) {
    const clock = new FakeClock(); const calls = [];
    const adapter = createUrlDownload({
        clock, maxBytes: options.maxBytes ?? 16, timeoutMs: options.timeoutMs ?? 50,
        resolve: options.resolve || (async host => [{ address: host === 'second.invalid' ? '8.8.4.4' : '8.8.8.8', family: 4 }]),
        transport: async request => { calls.push(request); return options.transport ? options.transport(request, calls.length) : response(200, { 'content-type': 'audio/mpeg' }, ['voice']); }
    });
    return { adapter, calls, clock };
}

test('downloads pin connection to the validated DNS result and return media metadata', async () => {
    const h = fake();
    const result = await h.adapter.download('https://media.invalid/a');
    assert.deepEqual(result, { buffer: Buffer.from('voice'), extension: 'mp3', mime: 'audio/mpeg' });
    assert.equal(h.calls[0].address, '8.8.8.8');
    assert.equal(h.calls[0].family, 4);
    assert.equal(h.calls[0].url.hostname, 'media.invalid');
});

test('rejects private and special DNS answers, including IPv6 mapped addresses', async () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '169.254.1.1', '100.64.1.1', '192.0.2.4', '::1', 'fc00::1', 'fe80::1', '::ffff:8.8.8.8', '2001:db8::1']) {
        assert.equal(isPublicAddress(address), false, address);
    }
    const h = fake({ resolve: async () => [{ address: '127.0.0.1', family: 4 }] });
    await assert.rejects(h.adapter.download('https://media.invalid/x'), /non-public/);
    assert.equal(h.calls.length, 0);
});

test('redirects resolve and pin each new public host, but reject private redirect targets', async () => {
    const seen = [];
    const ok = fake({ transport: async (req, call) => {
        seen.push([req.url.hostname, req.address]);
        return call === 1 ? response(302, { location: 'https://second.invalid/file.mp3' }, []) : response(200, { 'content-type': 'audio/mpeg' }, ['x']);
    } });
    assert.equal((await ok.adapter.download('https://media.invalid/start')).buffer.toString(), 'x');
    assert.deepEqual(seen, [['media.invalid', '8.8.8.8'], ['second.invalid', '8.8.4.4']]);
    const bad = fake({ transport: async (req, call) => call === 1 ? response(302, { location: 'https://127.0.0.1/secret' }, []) : response(200) });
    await assert.rejects(bad.adapter.download('https://media.invalid/start'), /non-public/);
    assert.equal(bad.calls.length, 1);
});

test('enforces content-length and streamed byte caps', async () => {
    const declared = fake({ transport: async () => response(200, { 'content-length': '17', 'content-type': 'audio/mpeg' }, []) });
    await assert.rejects(declared.adapter.download('https://media.invalid/a.mp3'), /byte limit/);
    const streamed = fake({ transport: async () => response(200, { 'content-type': 'audio/mpeg' }, ['123456789', 'abcdefgh']) });
    await assert.rejects(streamed.adapter.download('https://media.invalid/a.mp3'), /byte limit/);
});

test('caller abort and overall deadline abort the transport', async () => {
    let gotSignal;
    const h = fake({ transport: req => { gotSignal = req.signal; return new Promise((resolve, reject) => req.signal.addEventListener('abort', () => reject(req.signal.reason), { once: true })); } });
    const controller = new AbortController();
    const pending = h.adapter.download('https://media.invalid/a.mp3', controller.signal);
    await Promise.resolve(); await Promise.resolve();
    controller.abort(new Error('caller stopped'));
    await assert.rejects(pending, /caller stopped/);
    assert.equal(gotSignal.aborted, true);

    const h2 = fake({ transport: req => new Promise((resolve, reject) => req.signal.addEventListener('abort', () => reject(req.signal.reason), { once: true })) });
    const pending2 = h2.adapter.download('https://media.invalid/a.mp3');
    await Promise.resolve(); await Promise.resolve();
    await h2.clock.advance(51);
    await assert.rejects(pending2, /deadline/);
});

test('denies credentials, non-HTTP schemes, downgrade and unsupported payloads', async () => {
    const h = fake();
    await assert.rejects(h.adapter.download('file:///etc/passwd'), /HTTP\(S\)/);
    await assert.rejects(h.adapter.download('https://user:pass@media.invalid/a.mp3'), /credentials/);
    const downgrade = fake({ transport: async () => response(302, { location: 'http://media.invalid/a.mp3' }, []) });
    await assert.rejects(downgrade.adapter.download('https://media.invalid/a.mp3'), /downgrade/);
    const unsupported = fake({ transport: async () => response(200, { 'content-type': 'application/x-executable' }, ['x']) });
    await assert.rejects(unsupported.adapter.download('https://media.invalid/a'), /Unsupported/);
    assert.equal(h.calls.length, 0);
});
