'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHelpFeature } = require('../../../../src/v2/features/help/manifest');
const { createSystemInfoFeature } = require('../../../../src/v2/features/system-info/manifest');
const { isReply } = require('../../../../src/v2/domain/types');
const signal = () => new AbortController().signal;
function ctx(group = false, role = 'public') {
    const jid = '19995550001@s.whatsapp.net';
    return { event: { id: 'in-1', chatId: group ? '199955500000000@g.us' : jid, isGroup: group, sender: {jid} },
        roles: {owners: role==='owner'?[jid]:[],admins:role==='admin'?[jid]:[],members:role==='member'?[jid]:[]} };
}
const command = (name, access = 'public', scope = ['private','group']) => ({name, access,scope,help:{short:'acción '+name,examples:['pide '+name]},handler:async()=>({parts:[]}),tier:'none'});

test('help reads injected registry dynamically and exposes current manifest descriptions/examples', async () => {
    const features = [{id:'one',commands:[command('zeta'), {...command('alfa'),aliases:['alias']}]}];
    const help = createHelpFeature({features:()=>features});
    const h = help.commands[0].handler;
    const reply = await h(ctx(),{},signal());
    assert.equal(isReply(reply),true); assert.equal(reply.replyTo,'in-1');
    assert.match(reply.parts[0].text,/acciones de forma natural/);
    assert.ok(reply.parts[0].text.indexOf('alfa:')<reply.parts[0].text.indexOf('zeta:'));
    assert.doesNotMatch(reply.parts[0].text,/pide alfa/);
    const detail = await h(ctx(),{command:' ALIAS '},signal());
    assert.match(detail.parts[0].text,/pide alfa/); assert.doesNotMatch(detail.parts[0].text,/zeta:/);
    features.push({id:'two',commands:[command('nuevo')]});
    assert.match((await h(ctx(),{detail:true},signal())).parts[0].text,/pide nuevo/);
});

test('help shares access policy: scope, enabled features and role hierarchy hide unavailable capabilities', async () => {
    const features = [{id:'all',commands:[command('publico'),command('miembro','member'),command('admin','admin'),command('owner','owner'),command('privado','public',['private'])]}, {id:'disabled',enabled:false,commands:[command('oculto')]}];
    const h = createHelpFeature({features}).commands[0].handler;
    const publicReply=(await h(ctx(true),{},signal())).parts[0].text;
    for(const hidden of ['miembro:','admin:','owner:','privado:','oculto:']) assert.ok(!publicReply.includes(hidden));
    assert.match(publicReply,/publico:/);
    const adminReply=(await h(ctx(true,'admin'),{},signal())).parts[0].text;
    assert.match(adminReply,/admin:/);assert.match(adminReply,/miembro:/);assert.doesNotMatch(adminReply,/owner:/);
    assert.match((await h(ctx(false,'owner'),{},signal())).parts[0].text,/owner:/);
    assert.match((await h(ctx(),{command:'oculto'},signal())).parts[0].text,/No encuentro/);
    assert.match((await createHelpFeature({features:[]}).commands[0].handler(ctx(),{},signal())).parts[0].text,/No hay acciones/);
});

test('help cancellation prevents registry reads and manifest is declarative', async () => {
    let calls=0;const feature=createHelpFeature({features:()=>{calls++;return [];}});
    const controller=new AbortController();controller.abort();
    await assert.rejects(feature.commands[0].handler(ctx(),{},controller.signal), {name:'AbortError'});
    assert.equal(calls,0);assert.equal(feature.id,'help');assert.equal(feature.commands[0].access,'public');
    assert.equal(feature.commands[0].argsSchema.additionalProperties,false);
});

test('system-info obtains one injected snapshot without mutation and defaults to six lines', async () => {
    let calls=0;const snapshot=Object.freeze({version:'abc123',uptimeMs:125000,queue:Object.freeze({pending:2,running:1}),sessions:3,ai:'ready',memoryMb:45.8,details:Object.freeze(['extra','second'])});
    const feature=createSystemInfoFeature({getStatus: s=>{assert.equal(s.aborted,false);calls++;return snapshot;}});
    const h=feature.commands[0].handler;
    const reply=await h(ctx(),{},signal());assert.equal(calls,1);assert.equal(isReply(reply),true);
    assert.equal(reply.parts[0].text.split('\n').length,6);assert.match(reply.parts[0].text,/45 MB/);assert.match(reply.parts[0].text,/Activo: 2 min/);
    const detail=await h(ctx(),{detail:true},signal());assert.equal(detail.parts[0].text.split('\n').length,8);
    assert.equal(snapshot.details.length,2);assert.equal(feature.id,'system-info');assert.deepEqual(feature.commands[0].aliases,['estadobot','status']);
});

test('system-info whitelists status values, handles unknowns and only boolean true expands detail', async () => {
    for(const ai of ['degraded','unavailable',undefined,'secret']) {
        const h=createSystemInfoFeature({getStatus:()=>({version:'token\nsecret',uptimeMs:-1,queue:{pending:NaN,running:Infinity},sessions:-3,memoryMb:NaN,ai,details:Array(40).fill('trusted snapshot detail'),other:'do not dump'})}).commands[0].handler;
        const reply=await h(ctx(),{detail:'true'},signal());assert.equal(reply.parts[0].text.split('\n').length,6);
        assert.doesNotMatch(reply.parts[0].text,/token|secret|do not dump|NaN|Infinity/);
        assert.match(reply.parts[0].text,/desconocid/);
        assert.equal((await h(ctx(),{detail:true},signal())).parts[0].text.split('\n').length,36);
    }
    const text=(await createSystemInfoFeature({getStatus:()=>({})}).commands[0].handler(ctx(),{},signal())).parts[0].text;
    assert.equal(text.split('\n').length,6);
});

test('system-info abort before/after snapshot and port failures propagate instead of inventing success', async () => {
    const controller=new AbortController();controller.abort();let calls=0;
    await assert.rejects(createSystemInfoFeature({getStatus:()=>{calls++;return {};}}).commands[0].handler(ctx(),{},controller.signal),{name:'AbortError'});assert.equal(calls,0);
    const later=new AbortController();await assert.rejects(createSystemInfoFeature({getStatus:()=>{later.abort();return {};}}).commands[0].handler(ctx(),{},later.signal),{name:'AbortError'});
    await assert.rejects(createSystemInfoFeature({getStatus:()=>{throw Error('snapshot down');}}).commands[0].handler(ctx(),{},signal()),/snapshot down/);
});

test('minimal manifests expose constrained canonical intents and explicit parsers', () => {
    const help=createHelpFeature({features:[]});const status=createSystemInfoFeature({getStatus:()=>({})});
    assert.equal(help.intents[0].id,'help.show');assert.equal(status.intents[0].id,'system-info.status');
    for(const feature of [help,status]) {
        assert.equal(feature.intents[0].command,feature.commands[0].name);
        assert.equal(feature.intents[0].schema,feature.commands[0].argsSchema);
        assert.equal(feature.intents[0].schema.additionalProperties,false);
        assert.deepEqual(feature.commands[0].parseExplicit([]),{});
        assert.deepEqual(feature.commands[0].parseExplicit(['--detail']),{detail:true});
        assert.deepEqual(feature.commands[0].parseExplicit(['detallado']),{detail:true});
        assert.throws(()=>feature.commands[0].parseExplicit(['--secret']),/Invalid explicit/);
    }
    assert.deepEqual(help.commands[0].parseExplicit(['ESTADO','--detail']),{command:'estado',detail:true});
    assert.throws(()=>help.commands[0].parseExplicit(['estado','unknown']),/Invalid explicit/);
    assert.throws(()=>help.commands[0].parseExplicit(['x'.repeat(81)]),/Invalid explicit/);
    assert.throws(()=>status.commands[0].parseExplicit(['estado']),/Invalid explicit/);
    assert.equal(status.commands[0].allowLong,false);
});

test('actual router selects natural help/status via declared intent IDs without prefix or literal heuristic',async()=>{
    const {createRouter,resolveCommand}=require('../../../../src/v2/pipeline/router');
    const help=createHelpFeature({features:[]});const status=createSystemInfoFeature({getStatus:()=>({})});const features=[help,status];
    for(const [text,intent,args,feature,name] of [
        ['Muéstrame las acciones que tienes','help.show',{detail:true},'help','ayuda'],
        ['Cuéntame cómo va todo','system-info.status',{},'system-info','estado']
    ]) {
        let calls=0;
        const router=createRouter({features,llm:{generate:async request=>{
            calls++;assert.equal(request.task,'route');
            const body=JSON.parse(request.messages[1].parts[0].text);
            assert.equal(body.text,text);assert.ok(body.intents.some(item=>item.id===intent));
            return {ok:true,data:{text:JSON.stringify({kind:'intent',intent,args})}};
        }}});
        const context=ctx();context.event.text=text;context.event.receivedAt=100;context.addressing={respond:true,reason:'private'};
        const result=await router.route(context);assert.equal(calls,1);
        assert.equal(result.feature,feature);assert.equal(result.name,name);assert.equal(result.via,'llm');assert.deepEqual(result.args,args);
        assert.equal(resolveCommand(features,result).command.name,name);
    }
});

test('actual explicit router produces manifest-schema-compatible canonical options without calling LLM',async()=>{
    const {createRouter}=require('../../../../src/v2/pipeline/router');
    const {validArgs}=require('../../../../src/v2/pipeline/executor');
    const help=createHelpFeature({features:[]});const status=createSystemInfoFeature({getStatus:()=>({})});
    const router=createRouter({features:[help,status],llm:{generate:async()=>{throw Error('unexpected inference');}}});
    for(const [text,args,command] of [['!ayuda',{},help.commands[0]],['/help estado --detail',{command:'estado',detail:true},help.commands[0]],['!estado',{},status.commands[0]],['!status detallado',{detail:true},status.commands[0]]]) {
        const context=ctx();context.event.text=text;
        const decision=await router.route(context);assert.equal(decision.via,'explicit');assert.deepEqual(decision.args,args);
        assert.equal(validArgs(decision.args,command.argsSchema),true);
    }
    assert.equal(validArgs({tokens:[]},help.commands[0].argsSchema),false);
    assert.equal(validArgs({detail:'true'},status.commands[0].argsSchema),false);
});

test('status manifest keeps default composer budget; explicit detail opts into full response',()=>{
    const {responsePolicy}=require('../../../../src/v2/policies/response.policy');
    const command=createSystemInfoFeature({getStatus:()=>({})}).commands[0];
    const reply={parts:[{type:'text',text:'x'.repeat(1000)+'\n'.repeat(10)}]};
    const compact=responsePolicy(reply,{isGroup:true,status:true,allowLong:command.allowLong});
    assert.ok(compact.parts[0].text.length<=350);assert.ok(compact.parts[0].text.split('\n').length<=6);
    const full=responsePolicy(reply,{isGroup:true,status:true,allowLong:command.allowLong,detailRequested:true});
    assert.equal(full.parts[0].text,reply.parts[0].text);
});
