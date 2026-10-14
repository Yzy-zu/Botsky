'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createDocumentsFeature } = require('../../../../src/v2/features/documents/manifest');
const { createHelpFeature } = require('../../../../src/v2/features/help/manifest');
const { createQrFeature } = require('../../../../src/v2/features/qr/manifest');
const { createSystemInfoFeature } = require('../../../../src/v2/features/system-info/manifest');
const { createRouter } = require('../../../../src/v2/pipeline/router');
const { FakeClock } = require('../../../../src/v2/platform/clock');
const { TtlStore } = require('../../../../src/v2/platform/ttlStore');

const signal = () => new AbortController().signal;
const privateCtx = overrides => ({
  event: {
    id: 'synthetic-inbound', chatId: '15551230000@s.whatsapp.net', isGroup: false,
    sender: { jid: '15551230000@s.whatsapp.net', number: '15551230000', name: 'Fixture' },
    text: '', kind: 'text', receivedAt: 1,
    ...overrides,
  },
  roles: { admins: [], owners: [] },
});
const llmNever = { generate: async () => { throw new Error('unexpected LLM call in explicit route'); } };

// TR-0147: the real Wave A document manifest owns the recortar aliases as a light CLI grammar.
test('TR-0147 document manifest registers every crop alias and parses a range', () => {
  const feature = createDocumentsFeature({
    process: async () => { throw new Error('not used'); }, readContent: async () => null,
    clock: new FakeClock(1), store: new TtlStore({ clock: new FakeClock(1) }),
  });
  const crop = feature.commands.find(command => command.name === 'recortarpdf');
  assert.ok(crop);
  assert.deepEqual(crop.aliases, ['recortar', 'cortar', 'cortarpdf', 'extraerpdf']);
  assert.deepEqual(crop.parseExplicit(['1-3']), { pages: '1-3' });
});

// TR-0283: both public help command names stay available through explicit routing.
test('TR-0283 help aliases resolve through the explicit router without invoking the model', async () => {
  const help = createHelpFeature({ features: () => [help, qrFeature, statusFeature] });
  const qrFeature = createQrFeature({ create: async () => ({ ref: 'unused' }), read: async () => null });
  const statusFeature = createSystemInfoFeature({ getStatus: async () => ({}) });
  const router = createRouter({ features: [help, qrFeature, statusFeature], llm: llmNever });
  assert.deepEqual(await router.route({ ...privateCtx(), event: { ...privateCtx().event, text: '/@ayuda' } }), {
    kind: 'command', feature: 'help', name: 'ayuda', args: {}, confidence: 1, via: 'explicit',
  });
  assert.equal((await router.route({ ...privateCtx(), event: { ...privateCtx().event, text: 'help' } })).name, 'ayuda');
});

// TR-0305: the legacy help fast path now produces an actual readable feature-specific guide.
// TR-0314: its examples and one-action-per-line format stay scan-friendly.
test('TR-0305/TR-0314 help fast path renders a readable guide with concrete examples', async () => {
  const qrFeature = createQrFeature({ create: async () => ({ ref: 'unused' }), read: async () => null });
  const statusFeature = createSystemInfoFeature({ getStatus: async () => ({}) });
  const help = createHelpFeature({ features: () => [help, qrFeature, statusFeature] });
  const reply = await help.commands[0].handler(privateCtx(), { command: 'estado' }, signal());
  const text = reply.parts[0].text;
  assert.match(text, /^Puedes pedirme estas acciones de forma natural:/);
  assert.match(text, /estado: Estado actual del bot\./);
  assert.match(text, /Dame el estado detallado/);
  assert.equal(text.split('\n').filter(line => line.startsWith('estado:')).length, 1);
});

// TR-0443: an explicit QR payload must win even when old attachment context exists.
test('TR-0443 QR creation uses only the requested text and never reads a previous attachment', async () => {
  const calls = [];
  const qr = createQrFeature({
    create: async text => { calls.push(['create', text]); return { ref: 'synthetic-qr', mime: 'image/png' }; },
    read: async () => { calls.push(['read']); throw new Error('old attachment must not be decoded'); },
  });
  const ctx = { ...privateCtx({ text: 'qr synthetic payload' }), attachment: {
    id: 'older-media', ownerJid: '15551230000@s.whatsapp.net', chatId: '15551230000@s.whatsapp.net',
    expiresAt: 9999, ref: 'old-image-ref', mime: 'image/png', kind: 'image',
  } };
  const reply = await qr.commands[0].handler(ctx, { text: 'synthetic payload' }, signal());
  assert.deepEqual(calls, [['create', 'synthetic payload']]);
  assert.equal(reply.parts[0].ref, 'synthetic-qr');
});

// TR-0487: system status depends on a read-only local snapshot, not a URL or media extractor.
test('TR-0487 local status reports process and queue fields through its injected snapshot only', async () => {
  const calls = [];
  const status = createSystemInfoFeature({ getStatus: async abort => {
    calls.push(['snapshot', abort.aborted]);
    return { version: 'test.1', uptimeMs: 3_600_000, queue: { pending: 2, running: 1 }, sessions: 0,
      ai: 'configured', memoryMb: 42 };
  } });
  const reply = await status.commands[0].handler(privateCtx({ text: 'estado' }), {}, signal());
  assert.deepEqual(calls, [['snapshot', false]]);
  assert.match(reply.parts[0].text, /Cola: 2 pendientes, 1 en curso/);
  assert.match(reply.parts[0].text, /IA: configurada; conectividad sin comprobar/);
  assert.doesNotMatch(reply.parts[0].text, /https?:|yt-dlp|undefined/);
});
