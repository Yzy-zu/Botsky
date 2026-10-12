'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateNativeTableRequest, createNativeTableHandler } = require('../src/integrations/evolutionNativeTables');
const { patchEvolutionBundle } = require('../scripts/patch-evolution-native-tables.cjs');

const body = () => ({ number: '5215555550175', table: { headers: ['Producto', 'Cantidad'], rows: [['Pan', '2']] } });
function response() {
    return { statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
}
const bundle = 'prefix.post(this.routerPath("sendText"),...guards,async(request,response)=>{let result=await this.dataValidate({request:request,schema:Schema,ClassRef:Dto,execute:(instance,data)=>controller.sendText(instance,data)});return response.status(201).json(result)}).post(this.routerPath("sendMedia"),...guards,mediaHandler);async sendMessage(e,t,o,i,n,r,a,c){r&&(l.messageId=r),t.viewOnceMessage){let u=generate(e,t),m=await this.client.relayMessage(e,t,{messageId:r});return u}return this.client.sendMessage(e,t)}async nextMethod(){return 1}';

test('native-table validation accepts bounded tables and normalizes mentions', () => {
    const input = validateNativeTableRequest({ ...body(), delay: 20000, mentions: ['5215555550100'] });
    assert.equal(input.delay, 20000);
    assert.deepEqual(input.mentions, ['5215555550100@s.whatsapp.net']);
    assert.equal(validateNativeTableRequest({ ...body(), number: '123456789-123456789@g.us' }).number, '123456789-123456789@g.us');
});

test('native-table validation rejects malformed, arbitrary and excessive payloads', () => {
    const invalid = [
        { ...body(), number: 'status@broadcast' },
        { ...body(), number: 'someone@example.org' },
        { ...body(), delay: -1 },
        { ...body(), delay: Infinity },
        { ...body(), delay: 20001 },
        { ...body(), message: { conversation: 'arbitrary' } },
        { ...body(), mentions: ['status@broadcast'] },
        { ...body(), table: { headers: [], rows: [[]] } },
        { ...body(), table: { headers: ['x'], rows: [] } },
        { ...body(), table: { headers: ['x'], rows: [['a', 'b']] } },
        { ...body(), table: { headers: ['x'], rows: [[3]] } },
        { ...body(), table: { headers: ['x'], rows: [['x'.repeat(3501)]] } },
        { ...body(), table: { headers: Array(21).fill('x'), rows: [Array(21).fill('x')] } },
        { ...body(), table: { headers: ['x'], rows: Array.from({ length: 101 }, () => ['x']) } },
        { ...body(), table: { headers: ['x'], rows: Array.from({ length: 20 }, () => ['x'.repeat(3500)]) } }
    ];
    for (const input of invalid) assert.throws(() => validateNativeTableRequest(input), TypeError);
});

test('handler rejects invalid requests before accessing any service', async () => {
    const res = response();
    await createNativeTableHandler(() => { throw new Error('Must not access monitor'); })({ body: { ...body(), number: 'bad' } }, res, assert.fail);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'NATIVE_TABLE_INVALID');
});

test('handler reports absent and disconnected instances without transmission', async () => {
    for (const [instances, status, code] of [
        [{}, 404, 'INSTANCE_NOT_FOUND'],
        [{ main: { connectionStatus: { state: 'close' } } }, 409, 'INSTANCE_DISCONNECTED']
    ]) {
        const res = response();
        await createNativeTableHandler(() => ({ waInstances: instances }))({ body: body(), params: { instanceName: 'main' } }, res, assert.fail);
        assert.equal(res.statusCode, status);
        assert.equal(res.body.code, code);
    }
});

test('handler resolves only Evolution routerPath instanceName parameter', async () => {
    let sends = 0;
    const service = {
        connectionStatus: 'open', client: { relayMessage() {} },
        async sendMessageWithTyping() { sends++; return { key: { id: 'sent' } }; }
    };
    const handler = createNativeTableHandler(() => ({ waInstances: { main: service } }));
    const wrongParam = response();
    await handler({ body: body(), params: { instance: 'main' } }, wrongParam, assert.fail);
    assert.equal(wrongParam.statusCode, 404);
    assert.equal(sends, 0);
    const correctParam = response();
    await handler({ body: body(), params: { instanceName: 'main' } }, correctParam, assert.fail);
    assert.equal(correctParam.statusCode, 201);
    assert.equal(sends, 1);
});

test('handler builds only the table message and uses existing typing and persistence service', async () => {
    const calls = [];
    const service = {
        connectionStatus: { state: 'open' }, client: { relayMessage() {} },
        async sendMessageWithTyping(...args) { calls.push(args); return { key: { id: 'sent' } }; }
    };
    const res = response();
    await createNativeTableHandler(() => ({ waInstances: { main: service } }))({ body: { ...body(), delay: 100, mentions: ['5215555550100'] }, params: { instanceName: 'main' } }, res, assert.fail);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.key.id, 'sent');
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], body().number);
    assert.ok(calls[0][1].botForwardedMessage.message.richResponseMessage);
    assert.deepEqual(calls[0][2], { delay: 100, presence: 'composing', mentioned: ['5215555550100@s.whatsapp.net'] });
});

test('handler passes send failures onward without a retry marker or second send', async () => {
    let calls = 0;
    const failure = new Error('Persistence failed after relay');
    const service = {
        connectionStatus: 'open', client: { relayMessage() {} },
        async sendMessageWithTyping() { calls++; throw failure; }
    };
    const res = response();
    let forwarded;
    await createNativeTableHandler(() => ({ waInstances: { main: service } }))({ body: body(), params: { instanceName: 'main' } }, res, error => { forwarded = error; });
    assert.equal(forwarded, failure);
    assert.equal(calls, 1);
    assert.equal(res.statusCode, null);
});

test('bundle patch preserves authenticated guards and original endpoints and is idempotent', () => {
    const patched = patchEvolutionBundle(bundle);
    assert.ok(patched.includes('.post(this.routerPath("sendNativeTable"),...guards,'));
    assert.ok(patched.includes('createNativeTableHandler(()=>controller.waMonitor)'));
    assert.ok(patched.includes('(t.viewOnceMessage||t.botForwardedMessage?.message?.richResponseMessage)'));
    assert.ok(patched.includes(bundle.slice(bundle.indexOf('.post(this.routerPath("sendText")'), bundle.indexOf(';async sendMessage'))));
    assert.equal(patchEvolutionBundle(patched), patched);
});

test('bundle patch fails closed on changed or partial integration', () => {
    assert.throws(() => patchEvolutionBundle(bundle.replace('...guards,async', 'async')), /guarded sendText/);
    assert.throws(() => patchEvolutionBundle(bundle.replace('this.client.relayMessage', 'this.client.changedRelay')), /raw relay/);
    assert.throws(() => patchEvolutionBundle(bundle.replace('t.viewOnceMessage', 't.changedMessage')), /raw relay/);
    const patched = patchEvolutionBundle(bundle);
    assert.throws(() => patchEvolutionBundle(patched.replace('...guards,require', '...otherGuards,require')), /conflicting/);
    assert.throws(() => patchEvolutionBundle(patched.replace('(t.viewOnceMessage||t.botForwardedMessage?.message?.richResponseMessage)', 't.viewOnceMessage')), /conflicting/);
});
