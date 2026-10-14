'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, USER, BOT, GROUP } = require('../../../helpers/pipeline');
const { createDocumentsFeature } = require('../../../../src/v2/features/documents/manifest');
const { createTranscriptionFeature } = require('../../../../src/v2/features/transcription/manifest');
const { createContext } = require('../../../../src/v2/pipeline/context');
const { normalize } = require('../../../../src/v2/pipeline/normalize');
const { FakeClock } = require('../../../../src/v2/platform/clock');
const { TtlStore } = require('../../../../src/v2/platform/ttlStore');

function audioUpload(id = 'audio-without-caption') {
  return { event: 'messages.upsert', data: {
    key: { id, remoteJid: USER, fromMe: false },
    message: { audioMessage: { url: 'opaque-audio-ref', mimetype: 'audio/ogg', fileLength: 256 } },
  } };
}

function pdfUpload({ caption = 'Lee este PDF', id = 'pdf-to-read' } = {}) {
  return { event: 'messages.upsert', data: {
    key: { id, remoteJid: USER, fromMe: false },
    message: { documentMessage: { url: 'opaque-provider-ref', mimetype: 'application/pdf', fileLength: 17, fileName: 'synthetic.pdf', caption } },
  } };
}

// TR-0309: an audio upload without a caption gets a transcription suggestion, before any provider call.
test('TR-0309 bare audio suggests transcription without calling LLM or transcription provider', async () => {
  let providerCalls = 0;
  const transcription = createTranscriptionFeature({
    transcribe: async () => { providerCalls++; throw new Error('provider must not run for an unsolicited upload'); },
  });
  const f = fixture({ features: [transcription] });
  try {
    const result = await f.handle(audioUpload());
    assert.equal(result.kind, 'reply');
    assert.equal(f.requests.length, 0);
    assert.equal(providerCalls, 0);
    assert.ok(f.sent.some(item => item.name === 'react' && item.args[1] === '👀'));
    assert.ok(f.sent.some(item => item.name === 'sendText' && /¿Quieres que lo transcriba\?/.test(item.args[1])));
  } finally { f.dispose(); }
});

// TR-0437: a document read is routed before the content port runs; the PDF keeps its full provider identity.
test('TR-0437 PDF classification precedes content access and preserves native PDF attachment identity', async () => {
  const order = [];
  let observedRouteAttachment;
  const documents = createDocumentsFeature({
    process: async () => { throw new Error('not a conversion request'); },
    readContent: async (source, { signal }) => {
      order.push('read-content'); signal.throwIfAborted();
      assert.equal(source.attachment.mime, 'application/pdf');
      assert.equal(source.attachment.ref, 'opaque-provider-ref');
      assert.equal(source.attachment.providerKey.id, 'pdf-to-read');
      assert.equal(source.raw.data.key.id, 'pdf-to-read');
      return 'synthetic complete PDF text';
    },
    clock: new FakeClock(1), store: new TtlStore({ clock: new FakeClock(1) }),
  });
  const f = fixture({ features: [documents], generate: async request => {
    if (request.task === 'route') {
      order.push('classify');
      observedRouteAttachment = JSON.parse(request.messages.at(-1).parts[0].text).attachment;
      return { ok: true, data: { text: JSON.stringify({ kind: 'intent', intent: 'documents.read', args: {} }) } };
    }
    throw new Error(`unexpected task ${request.task}`);
  } });
  try {
    const result = await f.handle(pdfUpload());
    assert.equal(result.kind, 'reply');
    assert.deepEqual(order, ['classify', 'read-content']);
    assert.deepEqual(observedRouteAttachment, { id: 'pdf-to-read', mime: 'application/pdf' });
    assert.match(f.sent.find(item => item.name === 'sendText').args[1], /synthetic complete PDF text/);
  } finally { f.dispose(); }
});

// TR-0446: keep the structured feature/arguments even when caption prose contains competing media keywords.
test('TR-0446 structured media plan keeps its chosen action despite audio/broadcast/video/nuclear words', async () => {
  const calls = [];
  const selected = {
    id: 'messaging',
    commands: [{ name: 'send-media', scope: ['private'], access: 'public', tier: 'none',
      argsSchema: { type: 'object', properties: { destination: { type: 'string' }, caption: { type: 'string' } }, required: ['destination', 'caption'], additionalProperties: false },
      help: { short: 'Send selected media', examples: [] },
      handler: async (ctx, args) => { calls.push(['selected', args, ctx.attachment.kind]); return { parts: [{ type: 'text', text: 'Structured action accepted' }] }; } }],
    intents: [{ id: 'messaging.send-media', description: 'Send the current image to the current chat with a literal caption.', schema: { type: 'object' }, command: 'send-media' }],
  };
  const competing = { id: 'voice', commands: [{ name: 'transcribir', scope: ['private'], access: 'public', tier: 'none',
    help: { short: 'Transcribe', examples: [] }, handler: async () => { calls.push(['wrong-action']); return { parts: [] }; } }],
  intents: [{ id: 'voice.transcribe', description: 'Transcribe audio.', schema: { type: 'object' }, command: 'transcribir' }] };
  const f = fixture({ features: [selected, competing], generate: async request => {
    assert.equal(request.task, 'route');
    return { ok: true, data: { text: JSON.stringify({ kind: 'intent', intent: 'messaging.send-media', args: {
      destination: 'current_chat', caption: 'manda un audio al grupo nuclear',
    } }) } };
  } });
  const image = { event: 'messages.upsert', data: {
    key: { id: 'structured-image', remoteJid: USER, fromMe: false },
    message: { imageMessage: { url: 'opaque-image', mimetype: 'image/png', caption: 'Manda esta imagen y luego manda un audio al grupo nuclear' } },
  } };
  try {
    const result = await f.handle(image);
    assert.equal(result.kind, 'reply');
    assert.deepEqual(calls, [['selected', { destination: 'current_chat', caption: 'manda un audio al grupo nuclear' }, 'image']]);
  } finally { f.dispose(); }
});

// TR-0602: media uploaded inside Evolution wrappers remains addressable when quoted by exact stanza ID.
test('TR-0602 wrapped quoted media preserves the actual provider key and stanza through follow-up context', async () => {
  for (const [type, kind, mime] of [['imageMessage', 'image', 'image/png'], ['videoMessage', 'video', 'video/mp4'], ['documentMessage', 'document', 'application/pdf']]) {
    const clock = new FakeClock(10);
    const store = new TtlStore({ clock });
    const context = createContext({ clock, store, conversation: { recent: async () => [], recentThread: async () => [] } });
    const mediaMessage = { [type]: { url: `opaque-${kind}`, mimetype: mime, fileLength: 4 } };
    const firstRaw = { event: 'messages.upsert', data: {
      key: { id: `wrapped-${kind}`, remoteJid: GROUP, participant: USER, fromMe: false },
      message: { ephemeralMessage: { message: { documentWithCaptionMessage: { message: mediaMessage } } } },
    } };
    const mediaEvent = normalize(firstRaw, { clock });
    assert.ok(mediaEvent);
    assert.equal(mediaEvent.kind, kind);
    assert.equal(context.observe(mediaEvent), true);
    const quotedPayload = { [type]: { caption: `quoted ${kind} caption` } };
    const followupRaw = { event: 'messages.upsert', data: {
      key: { id: `followup-${kind}`, remoteJid: GROUP, participant: USER, fromMe: false },
      message: { extendedTextMessage: { text: 'lee esto', contextInfo: {
        stanzaId: `wrapped-${kind}`, participant: USER,
        quotedMessage: { ephemeralMessage: { message: { documentWithCaptionMessage: { message: quotedPayload } } } },
      } } },
    } };
    const followup = normalize(followupRaw, { clock });
    assert.ok(followup?.quoted);
    assert.equal(followup.quoted.text, `quoted ${kind} caption`);
    const metadata = context.addressingMetadata(followup);
    assert.equal(metadata.attachment?.quotedMatch, true);
    assert.equal(metadata.attachment?.id, `wrapped-${kind}`);
    assert.equal(metadata.attachment?.providerKey.id, `wrapped-${kind}`);
    assert.equal(metadata.attachment?.providerKey.remoteJid, GROUP);
    store.dispose();
  }
});
