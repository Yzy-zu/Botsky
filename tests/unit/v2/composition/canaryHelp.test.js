'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createRuntime } = require('../../../../src/v2/composition/runtime');
const { SystemClock } = require('../../../../src/v2/platform/clock');

test('runtime subset for the private canary exposes only QR, help, and status in help', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'botsky-canary-help-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const runtime = await createRuntime({
        config: {
            BOT_NUMBER: '525550000001',
            DATA_DIR: path.join(root, 'data'),
            TMP_DIR: path.join(root, 'tmp'),
            V2_CANARY_FEATURES: ['qr', 'help', 'system-info']
        },
        clock: new SystemClock(),
        evolutionHttp: {
            downloadMedia: async () => { assert.fail('help must not download media'); },
            sendText: async () => { assert.fail('help handler must not send directly'); }
        },
        llm: { generate: async () => { assert.fail('explicit help rendering must not call an LLM'); } },
        http: {
            post: async () => { assert.fail('help must not make HTTP requests'); },
            get: async () => { assert.fail('help must not make HTTP requests'); }
        },
        formData: () => { assert.fail('help must not construct multipart data'); },
        sidecarDbFilename: path.join(root, 'data', 'v2', 'canary.db'),
        backupPath: path.join(root, 'backups', 'canary.db')
    });
    t.after(() => runtime.dispose());

    assert.deepEqual(runtime.app.features.map(feature => feature.id), ['help', 'system-info', 'qr']);
    const help = runtime.app.features.find(feature => feature.id === 'help').commands[0];
    const reply = await help.handler({
        event: { sender: { jid: '525550000001@s.whatsapp.net' }, chatId: '525550000001@s.whatsapp.net', isGroup: false },
        roles: { admins: [], owners: [] }
    }, {}, new AbortController().signal);
    const text = reply.parts[0].text;
    assert.match(text, /ayuda:/);
    assert.match(text, /estado:/);
    assert.match(text, /qr:/);
    for (const excluded of ['leer:', 'convertir:', 'sticker:', 'voz:', 'transcribir:']) {
        assert.doesNotMatch(text, new RegExp(`\\b${excluded}`));
    }
});
