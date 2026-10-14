'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {createDocumentsMedia}=require('../../../../src/v2/adapters/media/documents');
const {createDocumentsFeature}=require('../../../../src/v2/features/documents/manifest');
const {FakeClock}=require('../../../../src/v2/platform/clock');
const {TtlStore}=require('../../../../src/v2/platform/ttlStore');
const runFile=promisify(execFile);

async function fivePagePdf(filename){
 await runFile('gs',['-sDEVICE=pdfwrite','-dNOPAUSE','-dBATCH','-dSAFER',`-sOutputFile=${filename}`,'-c','showpage','-c','showpage','-c','showpage','-c','showpage','-c','showpage'],{timeout:30000});
 return fs.readFile(filename);
}
async function pdfPages(filename){
 const {stdout}=await runFile('pdfinfo',[filename],{timeout:10000});
 return Number(stdout.match(/^Pages:\s*(\d+)/m)?.[1]);
}
function source(){return{attachment:{id:'trace-pdf',ownerJid:'19995550101@s.whatsapp.net',chatId:'19995550101@s.whatsapp.net',ref:'media://documento_largo.pdf',mime:'application/pdf',kind:'document'},raw:{}};}
function context(){return{event:{id:'trace-event',chatId:'19995550101@s.whatsapp.net',sender:{jid:'19995550101@s.whatsapp.net',name:'Test'},isGroup:false,text:'',raw:{}},addressing:{respond:true,reason:'explicit-command'},history:[],correlationId:'trace',roles:{admins:[],owners:[]},attachment:source().attachment};}

test('TR-0596: real Ghostscript crop preserves requested page ranges and names/captions the PDF',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'botsky-tr-0596-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const inputPath=path.join(root,'source.pdf'),buffer=await fivePagePdf(inputPath);assert.equal(await pdfPages(inputPath),5);
 const adapter=createDocumentsMedia({tempDirectory:path.join(root,'botsky-v2-media'),download:async()=>({buffer,extension:'pdf',originalFileName:'documento_largo.pdf'})});
 const outputs=[];
 for(const [pages,normalized,count] of [['2-4','2-4',3],['3-','3-5',3],['1,3','1,3',2]]){
  const result=await adapter.process({operation:'crop-pdf',source:source(),args:{pages},signal:new AbortController().signal});
  const output=result.parts[0];outputs.push(output.ref);
  assert.equal(await pdfPages(output.ref),count);
  assert.ok(output.caption.includes(normalized));
  assert.match(path.basename(output.ref),/documento_largo-p/);
 }
 for(const ref of outputs)assert.equal(await adapter.release(ref),true);

 const clock=new FakeClock(),store=new TtlStore({clock});
 const feature=createDocumentsFeature({clock,store,readContent:async()=>'',process:request=>adapter.process(request)});
 try{
  const crop=feature.commands.find(item=>item.name==='recortarpdf');
  const missing=await crop.handler(context(),{},new AbortController().signal);
  assert.match(missing.parts[0].text,/Indica qué páginas recortar/);
  for(const [pages,expected] of [['10','supera el total de páginas (5)'],['0-','mayores a 0'],['desde 3','formato de páginas inválido']]){
   const invalid=await crop.handler(context(),{pages},new AbortController().signal);
  assert.ok(invalid.parts[0].text.toLowerCase().includes(expected.toLowerCase()),invalid.parts[0].text);
  }
  const doc=feature.commands.find(item=>item.name==='doc');
  const shortcutArgs=doc.parseExplicit(['-f','pdf','1,3']);
  const shortcut=await doc.handler(context(),shortcutArgs,new AbortController().signal);
  const shortcutPdf=shortcut.parts[0];
  assert.equal(await pdfPages(shortcutPdf.ref),2,'doc -f pdf with pages must invoke the real crop operation');
  assert.match(shortcutPdf.caption,/1,3/);
  assert.equal(await adapter.release(shortcutPdf.ref),true);
  assert.deepEqual(shortcutArgs,{format:'pdf',pages:'1,3'});
 }finally{store.dispose();}
 await adapter.cleanupExpired();
});

test('TR-0597: the document manifest registers every legacy crop alias on recortarpdf',()=>{
 const clock=new FakeClock(),store=new TtlStore({clock});
 const feature=createDocumentsFeature({clock,store,process:async()=>({parts:[{type:'text',text:'ok'}]}),readContent:async()=>''});
 try{
  const crop=feature.commands.find(item=>item.name==='recortarpdf');
  assert.ok(crop);assert.deepEqual(crop.aliases,['recortar','cortar','cortarpdf','extraerpdf']);
 }finally{store.dispose();}
});
