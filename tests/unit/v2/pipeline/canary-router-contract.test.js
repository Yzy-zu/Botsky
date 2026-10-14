'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWaveAFeatures } = require('../../../../src/v2/features');
const { createRouter, resolveCommand } = require('../../../../src/v2/pipeline/router');

function makeFeatures() {
    return createWaveAFeatures({
        qr: { create: async () => ({ ref: 'synthetic-qr' }), read: async () => 'synthetic QR' },
        voice: {
            prepareScript: async () => ({ success: true, text: 'Buenos días', voice: 'mujer' }),
            synthesize: async () => ({ ref: 'synthetic-audio', mime: 'audio/mpeg' }),
            fitDuration: async media => media
        }
    });
}

function context(text) {
    return { event: { text, receivedAt: 1, isGroup: false, id: 'synthetic-event', sender: { jid: '525550000001@s.whatsapp.net', name: 'Test' } },
        addressing: { respond: true, reason: 'private' }, history: [], correlationId: 'synthetic-correlation', roles: { admins: [], owners: [] } };
}

test('natural QR and voice requests expose declared schemas and resolve to valid Wave A decisions', async () => {
    const features = makeFeatures();
    const proposals = [
        { text: 'Hazme un QR con este enlace https://example.test', intent: 'qr.create', args: { text: 'https://example.test' }, feature: 'qr', name: 'qr' },
        { text: 'Mándame una nota de voz que diga Buenos días', intent: 'voice.create', args: { mode: 'verbatim', literalText: 'Buenos días', voice: 'mujer' }, feature: 'voice', name: 'voz' }
    ];
    for (const proposal of proposals) {
        let observed;
        const router = createRouter({ features, llm: { generate: async request => {
            assert.equal(request.task, 'route');
            observed = JSON.parse(request.messages[1].parts[0].text);
            return { ok: true, data: { text: JSON.stringify({ kind: 'intent', intent: proposal.intent, args: proposal.args }) } };
        } } });
        const decision = await router.route(context(proposal.text));
        const declaration = observed.intents.find(item => item.id === proposal.intent);
        assert.ok(declaration, `router supplied ${proposal.intent} to the model`);
        assert.equal(declaration.schema.additionalProperties, false);
        assert.deepEqual(decision, { kind: 'intent', feature: proposal.feature, name: proposal.name,
            args: proposal.args, confidence: 1, via: 'llm' });
        assert.equal(resolveCommand(features, decision).command.name, proposal.name);
    }
});

test('plain command names and Botsky addressing need no prefix or model call',async()=>{
    const features=makeFeatures();
    const router=createRouter({features,llm:{generate:async()=>assert.fail('Literal command must not require a model')}});
    for(const text of ['qr hola','Botsky qr hola','Botsito: qr hola']){
        const result=await router.route(context(text));assert.equal(result.name,'qr');assert.deepEqual(result.args,{text:'hola'});
    }
    const literal='a'.repeat(20000);
    const result=await router.route(context(`Botsky voz ${literal}`));
    assert.equal(result.name,'voz');assert.equal(result.args.literalText.length,20000);
});
