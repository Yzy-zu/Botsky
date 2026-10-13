'use strict';
const { FakeClock } = require('../../src/v2/platform/clock');
const { TtlStore } = require('../../src/v2/platform/ttlStore');
const { TieredQueue } = require('../../src/v2/platform/queue');
const { createPipeline } = require('../../src/v2/pipeline');
const BOT = '19995550000@s.whatsapp.net';
const USER = '19995550101@s.whatsapp.net';
const GROUP = '19995559999@g.us';
function raw(id, text, options = {}) {
    const message = options.media ? { imageMessage: { url: 'https://fixture.invalid/image', mimetype: 'image/png', caption: text } } : { extendedTextMessage: { text } };
    const content = options.media ? message.imageMessage : message.extendedTextMessage;
    content.contextInfo = { ...(options.mentions ? { mentionedJid: options.mentions } : {}), ...(options.quote ? { stanzaId: options.quote.id, participant: options.quote.sender, quotedMessage: { conversation: options.quote.text || 'quoted' } } : {}) };
    return { event: 'messages.upsert', data: { key: { id, remoteJid: options.private ? USER : GROUP, participant: USER, fromMe: options.fromMe || false }, message, pushName: 'Synthetic user' } };
}
function fixture(options = {}) {
    const clock = new FakeClock(1000000);
    const store = new TtlStore({ clock });
    const queue = new TieredQueue({ clock });
    const sent = [], passives = [], executions = [], requests = [], historyReads = [];
    const messenger = Object.fromEntries(['sendText','sendMedia','sendVoice','sendSticker','react','typing','delete','edit','groupInfo'].map(name => [name, async (...args) => { sent.push({ name,args }); return { messageId: 'sent-' + sent.length }; }]));
    const features = options.features || [{ id: 'test', commands: [{ name: 'do', aliases: ['execute'], scope: ['private','group'], access: 'public', tier: 'none', help: {short:'Test',examples:[]}, handler: async (ctx,args) => { executions.push({ctx,args}); return {parts:[{type:'text',text:'Completed'}]}; } }], intents: [{id:'test.do',description:'Execute test action',schema:{type:'object'},command:'do'}] }];
    const llm = { generate: async request => {
        requests.push(request);
        if (options.generate) return options.generate(request);
        return { ok:true,data:{text:request.task==='route'?JSON.stringify(options.plan || {kind:'intent',intent:'test.do',args:{}}):'Chat response',parts:[],toolCalls:[],provider:'gemini'} };
    } };
    const pipeline = createPipeline({ clock,store,queue,messenger,llm,features,botJid:BOT,roles: options.roles || { admins:[],owners:[],members:[USER] },isSentId: (_chat,id) => id==='RESULTS', conversation: {recent:async()=>{historyReads.push('private');return[];},recentThread:async()=>{historyReads.push('group');return[];}}, passive:async event=>passives.push(event.id),...options.pipelineOptions });
    async function handle(event) { const result=pipeline.handle(event); await Promise.resolve(); await clock.advance(1200); return result; }
    return {clock,store,queue,pipeline,handle,sent,passives,executions,requests,historyReads,dispose:()=>{pipeline.dispose();queue.dispose();store.dispose();}};
}
module.exports={fixture,raw,BOT,USER,GROUP};
