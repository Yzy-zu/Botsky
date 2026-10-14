'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeClock } = require('../../../../src/v2/platform/clock');
const { TtlStore } = require('../../../../src/v2/platform/ttlStore');
const { createDocumentsFeature, parseExplicit } = require('../../../../src/v2/features/documents/manifest');
const { SESSION_NS, SESSION_TTL_MS } = require('../../../../src/v2/features/documents/handler');

const USER = '19995550101@s.whatsapp.net';
const OTHER = '19995550102@s.whatsapp.net';
const CHAT = '19995559999@g.us';
const abort = new AbortController().signal;
const image = { id:'img-1', ownerJid:USER, expiresAt:900000, ref:'media://image-1', mime:'image/jpeg', kind:'image' };
const pdf = { id:'pdf-1', ownerJid:USER, expiresAt:900000, ref:'media://report.pdf', mime:'application/pdf', kind:'document' };
function context(attachment, sender=USER) {
    return { event:{id:'event-1',chatId:CHAT,isGroup:true,sender:{jid:sender,number:sender.split('@')[0],name:'Synthetic'},text:'',kind:'text',mentions:[],isFromMe:false,receivedAt:1000,raw:{}},
        addressing:{respond:true,reason:'explicit-command',addressedBy:'prefix'},history:[],correlationId:'event-1',roles:{admins:[],owners:[]},...(attachment?{attachment}:{}) };
}
function setup(overrides={}) {
    const clock = new FakeClock(1000), store = new TtlStore({clock});
    const calls = [];
    const feature = createDocumentsFeature({ clock,store,
        process:async request=>{calls.push(request);return {parts:[{type:'text',text:`done:${request.operation}`}]}},
        readContent:async()=> 'texto sintético', ...overrides });
    return {clock,store,calls,feature,dispose:()=>store.dispose()};
}

test('document manifest preserves command aliases, explicit flags, action and page arguments',()=>{
    const f=setup();
    try {
        const aliases=Object.fromEntries(f.feature.commands.map(command=>[command.name,command.aliases]));
        assert.deepEqual(aliases.convertir,['cv']); assert.deepEqual(aliases.unirpdf,['unir','unirpdfs']);
        assert.deepEqual(parseExplicit('convertir',['-f','mp4','-q','alta','--velocidad=1.5x','--bitrate','128k','--ss','2','--to=10','--name','clase','https://files.invalid/a.mp4']),
            {format:'mp4',quality:'alta',speed:1.5,bitrate:'128k',trimStart:'2',trimEnd:'10',name:'clase',url:'https://files.invalid/a.mp4'});
        assert.deepEqual(parseExplicit('unirpdf',['terminar']),{action:'finish'});
        assert.deepEqual(parseExplicit('recortarpdf',['1-5']),{pages:'1-5'});
        assert.deepEqual(parseExplicit('pdf2img',['--zip','--pages','1,3']),{zip:true,pages:'1,3'});
        assert.throws(()=>parseExplicit('convertir',['--f','pdf','file:///etc/passwd']),/Invalid/);
    } finally { f.dispose(); }
});

test('convertir validates options and delegates attachment or safe HTTP URL to the operation port',async()=>{
    const f=setup();
    try {
        const command=f.feature.commands.find(item=>item.name==='convertir');
        const ctx=context(image);
        const reply=await command.handler(ctx,{format:'mp4',quality:'alta',speed:1.5,bitrate:'128k',trimStart:'2',trimEnd:'10'},abort);
        assert.match(reply.parts[0].text,/done:convert-media/);
        assert.equal(f.calls[0].source.attachment,image); assert.equal(f.calls[0].source.raw,ctx.event.raw); assert.equal(f.calls[0].args.bitrate,128000);
        const urlReply=await command.handler(context(undefined),{format:'mp3',url:'https://files.invalid/audio'},abort);
        assert.match(urlReply.parts[0].text,/done:convert-media/);
        assert.equal(f.calls[1].args.url,'https://files.invalid/audio');
        const invalid=await command.handler(context(image),{format:'unlisted'},abort);
        assert.match(invalid.parts[0].text,/formato/); assert.equal(f.calls.length,2);
    } finally { f.dispose(); }
});

test('PDF image and merge sessions are TTL scoped to the exact chat and sender',async()=>{
    const f=setup();
    try {
        const doc=f.feature.commands.find(item=>item.name==='doc').handler;
        const merge=f.feature.commands.find(item=>item.name==='unirpdf').handler;
        const key=JSON.stringify([CHAT,USER]);
        const added=await doc(context(image),{},abort);
        assert.match(added.parts[0].text,/imagen 1 agregada/);
        assert.equal(f.store.get(SESSION_NS,key).items.length,1);
        assert.equal(f.store.get(SESSION_NS,JSON.stringify([CHAT,OTHER])),undefined);
        f.clock.advance(SESSION_TTL_MS+1);
        assert.equal(f.store.get(SESSION_NS,key),undefined);

        await merge(context(pdf),{},abort);
        assert.match(f.store.get(SESSION_NS,key).kind,/pdfs/);
        const finished=await merge(context(undefined),{action:'finish'},abort);
        assert.match(finished.parts[0].text,/done:merge-pdfs/);
        assert.equal(f.calls.at(-1).sources[0].attachment,pdf);
        assert.equal(f.store.get(SESSION_NS,key),undefined);
    } finally { f.dispose(); }
});

test('PDF collection cancellation, unsupported merge files and document conversion have explicit results',async()=>{
    const f=setup();
    try {
        const doc=f.feature.commands.find(item=>item.name==='doc').handler;
        const merge=f.feature.commands.find(item=>item.name==='unirpdf').handler;
        const canceled=await doc(context(),{},abort);
        assert.match(canceled.parts[0].text,/armamos un PDF/);
        assert.match((await doc(context(),{action:'cancel'},abort)).parts[0].text,/cancelé el PDF/);
        assert.match((await merge(context(image),{},abort)).parts[0].text,/Solo admite `pdf`/);
        const converted=await doc(context(pdf),{format:'docx'},abort);
        assert.match(converted.parts[0].text,/done:convert-document/);
        assert.equal(f.calls.at(-1).args.format,'docx');
    } finally { f.dispose(); }
});

test('bare matching media continues only the active same-chat, same-owner PDF collection until its TTL expires',async()=>{
    const f=setup();
    try {
        const doc=f.feature.commands.find(item=>item.name==='doc').handler;
        const merge=f.feature.commands.find(item=>item.name==='unirpdf').handler;
        await doc(context(),{format:'pdf'},abort);
        const firstImage={...image,chatId:CHAT};
        assert.deepEqual(f.feature.attachmentContinuation(context(firstImage)),{name:'doc',args:{format:'pdf'}});
        assert.equal(f.feature.attachmentContinuation(context(image)),undefined,'missing chat identity fails closed');
        assert.equal(f.feature.attachmentContinuation(context({...image,ownerJid:OTHER,chatId:CHAT})),undefined);
        const otherChat=context(firstImage);otherChat.event.chatId='19995558888@g.us';
        assert.equal(f.feature.attachmentContinuation(otherChat),undefined);
        assert.equal(f.feature.attachmentContinuation(context({...image,kind:'audio',mime:'audio/ogg',chatId:CHAT})),undefined);
        const captioned=context(firstImage);captioned.event.text='convert this';
        assert.equal(f.feature.attachmentContinuation(captioned),undefined);

        await merge(context(pdf),{},abort);
        assert.deepEqual(f.feature.attachmentContinuation(context({...pdf,chatId:CHAT})),{name:'unirpdf',args:{}});
        assert.equal(f.feature.attachmentContinuation(context(firstImage)),undefined,'image cannot enter an active PDF merge');
        await f.clock.advance(SESSION_TTL_MS);
        assert.equal(f.feature.attachmentContinuation(context({...pdf,chatId:CHAT})),undefined,'expired collection is inert');
    } finally { f.dispose(); }
});

test('PDF tools dispatch named operations and the reader port returns only extracted text',async()=>{
    const f=setup();
    try {
        const get=name=>f.feature.commands.find(item=>item.name===name).handler;
        for (const [name,operation,args] of [['comprimir','compress-pdf',{}],['recortarpdf','crop-pdf',{pages:'1-3'}],['pdf2img','pdf-to-images',{pages:'2',zip:true}]]) {
            const reply=await get(name)(context(pdf),args,abort);
            assert.match(reply.parts[0].text,/done:/); assert.equal(f.calls.at(-1).operation,operation); assert.deepEqual(f.calls.at(-1).args,args);
        }
        const read=await get('leer')(context(image),{},abort);
        assert.equal(read.parts[0].text,'Esto alcancé a leer:\n\ntexto sintético');
        const unavailable=await get('leer')(context(undefined),{},abort);
        assert.match(unavailable.parts[0].text,/Responde al archivo/);
    } finally { f.dispose(); }
});

test('document processing and reading failures are user safe and cancellation stays observable',async()=>{
    let readCalls=0;
    const f=setup({process:async()=>{throw Error('/private/path/API_KEY=hidden');},readContent:async(source,{signal})=>{readCalls++;assert.equal(source.attachment,image);assert.equal(signal,abort);throw Error('secret details');}});
    try {
        const reply=await f.feature.commands.find(item=>item.name==='comprimir').handler(context(pdf),{},abort);
        assert.match(reply.parts[0].text,/No pude procesar el archivo/);
        assert.doesNotMatch(reply.parts[0].text,/private|API_KEY|Error:/);
        const read=await f.feature.commands.find(item=>item.name==='leer').handler(context(image),{},abort);
        assert.match(read.parts[0].text,/No pude leer ese archivo/); assert.equal(readCalls,1);
        const controller=new AbortController();controller.abort();
        await assert.rejects(f.feature.commands.find(item=>item.name==='comprimir').handler(context(pdf),{},controller.signal),{name:'AbortError'});
    } finally { f.dispose(); }
});

test('leer accepts supported text and Office document attachments',async()=>{
    const f=setup();
    try {
        const read=f.feature.commands.find(item=>item.name==='leer').handler;
        const textFile={kind:'document',mime:'text/plain',ref:'media://notes.txt'};
        const officeFile={kind:'document',mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',ref:'media://notes.docx'};
        assert.match((await read(context(textFile),{},abort)).parts[0].text,/texto sintético/);
        assert.match((await read(context(officeFile),{},abort)).parts[0].text,/texto sintético/);
        assert.equal(f.calls.length,0);
    } finally { f.dispose(); }
});
