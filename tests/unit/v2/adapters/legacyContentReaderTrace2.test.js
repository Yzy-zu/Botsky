'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createContentReader,MAX_INLINE_BYTES,MAX_TEXT_CHARACTERS}=require('../../../../src/v2/adapters/media/contentReader');
const {createDocumentsFeature}=require('../../../../src/v2/features/documents/manifest');

const PNG=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(24)]);
function source(ref,mime,raw={}){return{attachment:{id:'trace-content',ownerJid:'user@s.whatsapp.net',chatId:'user@s.whatsapp.net',ref,mime,kind:mime.startsWith('image/')?'image':'document'},raw};}
async function setup(t,{download,run,ocr,maxInputBytes}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'botsky-content-trace-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const reader=createContentReader({tempDirectory:root,downloadMedia:download|| (async()=>({buffer:Buffer.from('ok'),extension:'txt'})),
  run:run|| (async()=>({stdout:''})),...(ocr?{ocr}:{}),...(maxInputBytes?{maxInputBytes}:{})});
 return{reader,root};
}
function pdfInfo(pages){return async command=>command==='pdfinfo'?{stdout:`Pages: ${pages}\nEncrypted: no\n`}:command==='pdftotext'?{stdout:'contenido PDF'}:{stdout:''};}
function envelope(message,{id='id',remoteJid='user@s.whatsapp.net'}={}){return{event:'messages.upsert',data:{key:{id,remoteJid},message}};}
async function readViaFeature(reader,document){
 const feature=createDocumentsFeature({process:async()=>({parts:[]}),readContent:reader.readContent,clock:{now:()=>0},store:{get:()=>undefined,set(){},delete(){}}});
 const leer=feature.commands.find(command=>command.name==='leer');
 return leer.handler({event:{id:'read',chatId:document.attachment.chatId,sender:{jid:document.attachment.ownerJid,name:'Test'},isGroup:false,text:'leer',raw:document.raw},addressing:{respond:true,reason:'explicit-command'},history:[],correlationId:'read',roles:{admins:[],owners:[]},attachment:document.attachment},{},new AbortController().signal);
}

test('TR-0167: PNG content is detected from bytes and OCR receives the detected MIME',async t=>{
 let ocrCall;
 const {reader}=await setup(t,{download:async()=>({buffer:PNG,extension:'jpg',mime:'image/png'}),ocr:async(file,options)=>{ocrCall={file,options};return'Texto visible.';}});
 assert.equal(await reader.readContent(source('media://photo.jpg','image/jpeg'),{signal:new AbortController().signal}),'Texto visible.');
 assert.equal(ocrCall.options.mime,'image/png');assert.equal(ocrCall.options.language,'spa+eng');assert.ok(ocrCall.file.endsWith('.jpg'));
});

test('TR-0169: UTF-8 document text is returned complete and never as encoded image content',async t=>{
 const text='Resuelve: x + 2 = 8\nExplica por qué.';
 const {reader}=await setup(t,{download:async()=>({buffer:Buffer.from(text),extension:'txt',mime:'text/plain'})});
 const result=await reader.readContent(source('media://problema.txt','text/plain'),{signal:new AbortController().signal});
 assert.equal(result,text);assert.equal(typeof result,'string');assert.doesNotMatch(result,/^data:image\//);
});

test('TR-0171: declared file length above the inline limit is rejected before download',async t=>{
 let downloads=0;
 const {reader}=await setup(t,{download:async()=>{downloads++;return{buffer:Buffer.from('x'),extension:'txt'};}});
 const raw=envelope({documentMessage:{fileLength:MAX_INLINE_BYTES+1}},{id:'trace-content'});
 await assert.rejects(reader.readContent(source('media://large.txt','text/plain',raw),{signal:new AbortController().signal}),error=>error.kind==='too_large');
 assert.equal(downloads,0);
});

test('TR-0172: actual bytes are bounded when provider metadata omits the size',async t=>{
 const {reader}=await setup(t,{download:async()=>({buffer:Buffer.alloc(MAX_INLINE_BYTES+1),extension:'txt'})});
 await assert.rejects(reader.readContent(source('media://large.txt','text/plain'),{signal:new AbortController().signal}),error=>error.kind==='too_large');
});

test('TR-0173: downloader receives the byte limit and oversized transport errors map to too_large',async t=>{
 const {reader}=await setup(t,{download:async(_source,options)=>{assert.equal(options.maxBytes,MAX_INLINE_BYTES);throw Object.assign(Error('provider response SECRET'),{code:'MEDIA_TOO_LARGE'});}});
 await assert.rejects(reader.readContent(source('media://truncated.pdf','application/pdf'),{signal:new AbortController().signal}),error=>error.kind==='too_large'&&!/SECRET|provider response/.test(error.message));
});

test('TR-0174: serialized uint64 fileLength is compared without signed-low overflow',async t=>{
 let downloads=0;
 const {reader}=await setup(t,{download:async()=>{downloads++;throw Error('should not download');}});
 // Low is signed int32 in the serialized Long, but its bits are unsigned.
 const raw=envelope({documentMessage:{fileLength:{low:-1,high:0}}},{id:'trace-content'});
 await assert.rejects(reader.readContent(source('media://huge.pdf','application/pdf',raw),{signal:new AbortController().signal}),error=>error.kind==='too_large');
 assert.equal(downloads,0);
});

test('TR-0174: oversized decimal metadata fails closed for configured limits without parsing arbitrary integers',async t=>{
 let downloads=0;
 const {reader}=await setup(t,{maxInputBytes:1024,download:async()=>{downloads++;throw Error('should not download');}});
 for(const value of ['999999999999999999999999999999999999999999999','18446744073709551616']){
  const raw=envelope({documentMessage:{fileLength:value}},{id:'trace-content'});
  await assert.rejects(reader.readContent(source('media://huge.txt','text/plain',raw),{signal:new AbortController().signal}),error=>error.kind==='too_large');
 }
 assert.equal(downloads,0);
});

test('TR-0174: malformed Long words and unsafe toNumber values are ignored rather than coerced',async t=>{
 let downloads=0;
 const {reader}=await setup(t,{download:async()=>{downloads++;return{buffer:Buffer.from('texto breve'),extension:'txt'};}});
 const malformed=[{low:4294967295,high:0,unsigned:true},{low:1,high:2147483648,unsigned:false},{toNumber(){return Number.MAX_SAFE_INTEGER+1;}}];
 for(const fileLength of malformed){
  const raw=envelope({documentMessage:{fileLength}},{id:'trace-content'});
  assert.equal(await reader.readContent(source('media://small.txt','text/plain',raw),{signal:new AbortController().signal}),'texto breve');
 }
 assert.equal(downloads,malformed.length);
});

test('declared size preflight only applies to the attachment identified by the current or exact quoted stanza',async t=>{
 let downloads=0;
 const {reader}=await setup(t,{download:async()=>{downloads++;return{buffer:Buffer.from('ok'),extension:'txt'};}});
 const attachment=source('media://small.txt','text/plain').attachment;
 const oversized={documentMessage:{fileLength:MAX_INLINE_BYTES+1}};
 const unrelated=envelope(oversized,{id:'different-message'});
 assert.equal(await reader.readContent({...source(attachment.ref,attachment.mime,unrelated),attachment},{signal:new AbortController().signal}),'ok');
 const quoted=envelope({extendedTextMessage:{contextInfo:{stanzaId:attachment.id,participant:attachment.ownerJid,quotedMessage:oversized}}});
 await assert.rejects(reader.readContent({...source(attachment.ref,attachment.mime,quoted),attachment},{signal:new AbortController().signal}),error=>error.kind==='too_large');
 const wrongChat=envelope(oversized,{id:attachment.id,remoteJid:'other@s.whatsapp.net'});
 assert.equal(await reader.readContent({...source(attachment.ref,attachment.mime,wrongChat),attachment},{signal:new AbortController().signal}),'ok');
 assert.equal(downloads,2);
});

test('TR-0170: expired and unknown media downloads ask for a re-send without exposing provider diagnostics',async t=>{
 for(const [code,expected] of [['MEDIA_UNAVAILABLE','WhatsApp ya no tiene disponible'],['unknown','No pude descargar el archivo']]){
  const {reader}=await setup(t,{download:async()=>{throw Object.assign(Error('private provider response SECRET'),{code:code==='unknown'?'EIO':code});}});
  const reply=await readViaFeature(reader,source('media://failed.pdf','application/pdf'));
  assert.match(reply.parts[0].text,new RegExp(expected));assert.doesNotMatch(reply.parts[0].text,/SECRET|provider response/);
 }
});

test('TR-0176: empty and textless files never claim extracted text',async t=>{
 const {reader}=await setup(t,{download:async source=>source.attachment.ref.endsWith('empty.txt')?{buffer:Buffer.alloc(0),extension:'txt'}:{buffer:Buffer.from(' \n\t'),extension:'txt'}});
 for(const ref of ['media://empty.txt','media://blank.txt']){
  const document=source(ref,'text/plain');
  assert.equal(await reader.readContent(document,{signal:new AbortController().signal}),null);
  const feature=createDocumentsFeature({process:async()=>({parts:[]}),readContent:reader.readContent,clock:{now:()=>0},store:{get:()=>undefined,set(){},delete(){}}});
  const leer=feature.commands.find(command=>command.name==='leer');
  const reply=await leer.handler({event:{id:'read',chatId:document.attachment.chatId,sender:{jid:document.attachment.ownerJid,name:'Test'},isGroup:false,text:'leer',raw:document.raw},addressing:{respond:true,reason:'explicit-command'},history:[],correlationId:'read',roles:{admins:[],owners:[]},attachment:document.attachment},{},new AbortController().signal);
  assert.match(reply.parts[0].text,/No alcancé a leer texto/);
 }
});

test('TR-0177: text above the declared character limit is rejected rather than truncated',async t=>{
 const {reader}=await setup(t,{download:async()=>({buffer:Buffer.from('x'.repeat(MAX_TEXT_CHARACTERS+1)),extension:'txt'})});
 await assert.rejects(reader.readContent(source('media://long.txt','text/plain'),{signal:new AbortController().signal}),error=>error.kind==='too_large');
});

test('TR-0178: invalid UTF-8 and binary control bytes are rejected without invented text',async t=>{
 const {reader}=await setup(t,{download:async source=>({buffer:source.attachment.ref.endsWith('binary.txt')?Buffer.from([1,2,3]):Buffer.from([255,254,253]),extension:'txt'})});
 for(const ref of ['media://invalid.txt','media://binary.txt'])await assert.rejects(reader.readContent(source(ref,'text/plain'),{signal:new AbortController().signal}),error=>error.kind==='bad_output');
});

test('TR-0182: PDFs without pages or above the page cap fail with typed bounded outcomes',async t=>{
 const empty=await setup(t,{download:async()=>({buffer:Buffer.from('%PDF-1.4\n%%EOF'),extension:'pdf'}),run:pdfInfo(0)});
 const emptyDoc=source('media://zero.pdf','application/pdf');
 await assert.rejects(empty.reader.readContent(emptyDoc,{signal:new AbortController().signal}),error=>error.kind==='bad_output');
 const emptyReply=await readViaFeature(empty.reader,emptyDoc);
 assert.match(emptyReply.parts[0].text,/No encontré páginas legibles/);assert.match(emptyReply.parts[0].text,/Reenvíame/);
 const tooMany=await setup(t,{download:async()=>({buffer:Buffer.from('%PDF-1.4\n%%EOF'),extension:'pdf'}),run:pdfInfo(1001)});
 const manyDoc=source('media://many.pdf','application/pdf');
 await assert.rejects(tooMany.reader.readContent(manyDoc,{signal:new AbortController().signal}),error=>error.kind==='too_large');
 const reply=await readViaFeature(tooMany.reader,manyDoc);
 assert.match(reply.parts[0].text,/supera el límite de páginas/);assert.match(reply.parts[0].text,/solo las páginas/);
});

test('TR-0183: unknown formats and fake image signatures never fall back to JPEG',async t=>{
 const {reader}=await setup(t,{download:async source=>({buffer:Buffer.from('not an image'),extension:source.attachment.ref.endsWith('.jpg')?'jpg':'bin'})});
 await assert.rejects(reader.readContent(source('media://fake.jpg','image/jpeg'),{signal:new AbortController().signal}),error=>error.kind==='unsupported_media');
 await assert.rejects(reader.readContent(source('media://unknown.bin','application/octet-stream'),{signal:new AbortController().signal}),error=>error.kind==='unsupported_media');
});

test('TR-0184: GIF is rejected as unsupported image input',async t=>{
 const {reader}=await setup(t,{download:async()=>({buffer:Buffer.from('GIF89a...............'),extension:'gif'})});
 const document=source('media://animated.gif','image/gif');
 await assert.rejects(reader.readContent(document,{signal:new AbortController().signal}),error=>error.kind==='unsupported_media');
 const reply=await readViaFeature(reader,document);
 assert.match(reply.parts[0].text,/GIF animado/);assert.match(reply.parts[0].text,/foto fija/);
});
