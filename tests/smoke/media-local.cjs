'use strict';
// Explicit local smoke: synthetic files only, no app imports, network or providers.
const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
const assert=require('node:assert/strict');const {promisify}=require('node:util');
const execute=promisify(require('node:child_process').execFile);
const {createQrOcrMedia}=require('../../src/v2/adapters/media/qrOcr');
const {createDocumentsMedia}=require('../../src/v2/adapters/media/documents');
const {SystemClock}=require('../../src/v2/platform/clock');
async function main(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'botsky-ola-a-smoke-'));await fs.chmod(root,0o700);
 const signal=new AbortController().signal;const clock=new SystemClock();const directory=path.join(root,'botsky-v2-media');
 try{
  const qr=createQrOcrMedia({clock,tempDirectory:directory,download:async source=>({buffer:await fs.readFile(source.ref),extension:'png'})});
  const image=await qr.create('Botsky synthetic smoke',signal);
  const decoded=await qr.read({id:'synthetic',chatId:'19995550101@s.whatsapp.net',ownerJid:'19995550101@s.whatsapp.net',expiresAt:clock.now()+10000,...image},signal);
  assert.equal(decoded,'Botsky synthetic smoke');assert.equal(await qr.release(image.ref),true);
  const wav=path.join(root,'source.wav');await execute('ffmpeg',['-loglevel','error','-f','lavfi','-i','sine=frequency=440:duration=1','-y',wav],{timeout:10000});
  const ps=path.join(root,'source.ps');const pdf=path.join(root,'source.pdf');
  await fs.writeFile(ps,'%!PS\n/Helvetica findfont 16 scalefont setfont\n72 700 moveto (Synthetic first page) show\nshowpage\n72 700 moveto (Synthetic second page) show\nshowpage\n',{mode:0o600});
  await execute('gs',['-q','-dBATCH','-dNOPAUSE','-sDEVICE=pdfwrite',`-sOutputFile=${pdf}`,ps],{timeout:10000});
  const documents=createDocumentsMedia({clock,tempDirectory:directory,download:async source=>({buffer:await fs.readFile(source.attachment.ref),extension:path.extname(source.attachment.ref).slice(1)})});
  const source=ref=>({attachment:{id:'synthetic',chatId:'19995550101@s.whatsapp.net',ownerJid:'19995550101@s.whatsapp.net',expiresAt:clock.now()+10000,ref,mime:ref===wav?'audio/wav':'application/pdf'},raw:{}});
  const converted=await documents.process({operation:'convert-media',source:source(wav),args:{format:'mp3',quality:'media',speed:1},signal});
  const audio=converted.parts.find(part=>part.type==='audio');assert.ok(audio);
  const probe=await execute('ffprobe',['-v','error','-show_entries','format=format_name','-of','default=noprint_wrappers=1',audio.ref],{timeout:10000});assert.match(probe.stdout,/mp3/);
  await documents.release(audio.ref);
  const cropped=await documents.process({operation:'crop-pdf',source:source(pdf),args:{pages:'2'},signal});
  const document=cropped.parts.find(part=>part.type==='document');assert.ok(document);
  const text=await execute('pdftotext',[document.ref,'-'],{timeout:10000});assert.match(text.stdout,/Synthetic second page/);assert.doesNotMatch(text.stdout,/Synthetic first page/);
  await documents.release(document.ref);
  console.log(JSON.stringify({qrRoundTrip:'pass',audioConversion:'pass',pdfPageSelection:'pass',networkCalls:0,syntheticOnly:true}));
 }finally{await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
