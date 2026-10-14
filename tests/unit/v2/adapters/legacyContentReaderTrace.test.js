'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createContentReader}=require('../../../../src/v2/adapters/media/contentReader');

const PDF=Buffer.from('%PDF-1.4\n%%EOF\n');
const DOCX=Buffer.from([80,75,3,4,20,0,0,0]);
const OFFICE='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const TEXT='Texto extraído del documento.';
function source(ref,mime=OFFICE){return{attachment:{id:'trace-doc',ownerJid:'user@s.whatsapp.net',chatId:'user@s.whatsapp.net',ref,mime,kind:'document'},raw:{}};}
async function makeReader(t,{download,run}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'botsky-content-trace-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const commands=[];
 const reader=createContentReader({tempDirectory:root,
  downloadMedia:download|| (async()=>({buffer:DOCX,extension:'docx',originalFileName:'clase.docx'})),
  run:async(command,args,options)=>{commands.push({command,args,options});if(run)return run(command,args,options);if(command==='pdfinfo')return{stdout:'Pages: 2\nEncrypted: no\n'};if(command==='pdftotext')return{stdout:TEXT};throw Error(`unexpected command ${command}`);}
 });
 return{reader,root,commands};
}

test('TR-0175: PDF byte signature wins over Office filename and MIME',async t=>{
 const {reader,commands}=await makeReader(t,{download:async()=>({buffer:PDF,extension:'docx',originalFileName:'mislabelled.docx'})});
 assert.equal(await reader.readContent(source('media://mislabelled.docx'),{signal:new AbortController().signal}),TEXT);
 assert.deepEqual(commands.map(item=>item.command),['pdfinfo','pdftotext']);
});

test('TR-0185: Office reading converts internally with unique profiles and removes temporary workspaces',async t=>{
 const {reader,root,commands}=await makeReader(t,{run:async(command,args)=>{
  if(command==='libreoffice'){
   const dir=args[args.indexOf('--outdir')+1];await fs.writeFile(path.join(dir,'input.pdf'),PDF);return{stdout:''};
  }
  if(command==='pdfinfo')return{stdout:'Pages: 2\nEncrypted: no\n'};
  if(command==='pdftotext')return{stdout:TEXT};
  throw Error(`unexpected command ${command}`);
 }});
 assert.equal(await reader.readContent(source('media://clase.docx'),{signal:new AbortController().signal}),TEXT);
 assert.equal(await reader.readContent(source('media://clase.docx'),{signal:new AbortController().signal}),TEXT);
 const conversions=commands.filter(item=>item.command==='libreoffice');
 assert.equal(conversions.length,2);
 const profiles=conversions.map(item=>item.args.find(arg=>arg.startsWith('-env:UserInstallation=')));
 assert.ok(profiles.every(Boolean));assert.notEqual(profiles[0],profiles[1]);
 assert.ok(conversions.every(item=>item.options.timeoutMs===45_000));
 assert.deepEqual(await fs.readdir(root),[]);
});

test('TR-0186: failed Office conversion and corrupt PDF clean their temporary workspaces',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'botsky-content-trace-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 let mode='office';
 const reader=createContentReader({tempDirectory:root,
  downloadMedia:async src=>src.attachment.ref.endsWith('.pdf')?{buffer:PDF,extension:'pdf'}:{buffer:DOCX,extension:'docx',originalFileName:'clase.docx'},
  run:async command=>{if(mode==='office'&&command==='libreoffice')throw Error('provider-private-diagnostic');throw Error('corrupt-private-diagnostic');}
 });
 await assert.rejects(reader.readContent(source('media://clase.docx'),{signal:new AbortController().signal}),error=>error.kind==='bad_output'&&!/private-diagnostic/.test(error.message));
 assert.deepEqual(await fs.readdir(root),[]);
 mode='pdf';
 await assert.rejects(reader.readContent(source('media://clase.pdf','application/pdf'),{signal:new AbortController().signal}),error=>error.kind==='bad_output'&&!/private-diagnostic/.test(error.message));
 assert.deepEqual(await fs.readdir(root),[]);
});

test('TR-0187: falsified Office extension is rejected before LibreOffice runs',async t=>{
 const calls=[];
 const {reader,root}=await makeReader(t,{download:async()=>({buffer:Buffer.from('not a zip'),extension:'docx',originalFileName:'fake.docx'}),run:async command=>{calls.push(command);throw Error('must not run');}});
 await assert.rejects(reader.readContent(source('media://fake.docx'),{signal:new AbortController().signal}),error=>error.kind==='bad_output');
 assert.deepEqual(calls,[]);assert.deepEqual(await fs.readdir(root),[]);
});

test('TR-0189: Office MIME plus ZIP signature assigns a safe allowlisted conversion extension',async t=>{
 const calls=[];
 const {reader,commands}=await makeReader(t,{download:async()=>({buffer:DOCX,extension:'bin',originalFileName:'clase.bin'}),run:async(command,args)=>{
  calls.push(command);
  if(command==='libreoffice'){const dir=args[args.indexOf('--outdir')+1];await fs.writeFile(path.join(dir,'input.pdf'),PDF);return{stdout:''};}
  if(command==='pdfinfo')return{stdout:'Pages: 1\nEncrypted: no\n'};
  if(command==='pdftotext')return{stdout:TEXT};
  throw Error(`unexpected command ${command}`);
 }});
 assert.equal(await reader.readContent(source('media://clase.bin'),{signal:new AbortController().signal}),TEXT);
 const office=commands.find(item=>item.command==='libreoffice');
 assert.ok(office.args.at(-1).endsWith('/input.docx'));assert.equal(calls[0],'libreoffice');
});

test('TR-0190: Office MIME mismatch and generic ZIP do not invoke LibreOffice',async t=>{
 const calls=[];
 const {reader,root}=await makeReader(t,{download:async src=>src.attachment.ref.endsWith('.zip')?{buffer:DOCX,extension:'zip',mime:'application/zip'}:{buffer:Buffer.from('ordinary text'),extension:'bin',originalFileName:'clase.bin'},run:async command=>{calls.push(command);throw Error('must not run');}});
 await assert.rejects(reader.readContent(source('media://clase.bin'),{signal:new AbortController().signal}),error=>error.kind==='bad_output');
 await assert.rejects(reader.readContent(source('media://clase.zip','application/zip'),{signal:new AbortController().signal}),error=>error.kind==='unsupported_media');
 assert.deepEqual(calls,[]);assert.deepEqual(await fs.readdir(root),[]);
});
