'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createDocumentsMedia, normalizePages, toRanges } = require('../../../../src/v2/adapters/media/documents');

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');
const PNG = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(24)]);
const ZIP = Buffer.from([80,75,3,4,1,2,3,4]);
const USER='19995550101@s.whatsapp.net', CHAT='19995559999@g.us';
function source(ref,mime,kind='document',chatId=CHAT) {
    return {attachment:{id:`id-${ref}`,ref,mime,kind,ownerJid:USER,chatId},raw:{event:'messages.upsert',data:{key:{id:`id-${ref}`,remoteJid:chatId}}}};
}
async function harness(options={}) {
    const parent=await fs.mkdtemp(path.join(os.tmpdir(),'botsky-documents-test-'));
    const tempDirectory=path.join(parent,'botsky-v2-media'); const commands=[]; let now=1000;
    const buffers=new Map([
        ['media://clip',{buffer:Buffer.from('mp4 data'),extension:'mp4',originalFileName:'clip.mp4'}],
        ['media://office',{buffer:ZIP,extension:'docx',originalFileName:'lesson.docx'}],
        ['media://fake-office',{buffer:Buffer.from('not a zip container'),extension:'docx',originalFileName:'fake.docx'}],
        ['media://pdf-a',{buffer:PDF,extension:'pdf',originalFileName:'a.pdf'}],
        ['media://pdf-b',{buffer:PDF,extension:'pdf',originalFileName:'b.pdf'}],
        ['media://image',{buffer:PNG,extension:'png',originalFileName:'image.png'}],
        ['media://text',{buffer:Buffer.from('Línea uno\nLínea dos'),extension:'txt',originalFileName:'notes.txt'}],
        ['media://html',{buffer:Buffer.from('<p>Hola <b>mundo</b></p><script>secreto</script>'),extension:'html',originalFileName:'page.html'}]
    ]);
    const run=async(command,args,options)=>{
        commands.push({command,args:[...args],options});
        if (options.signal.aborted) throw Object.assign(Error('aborted'),{name:'AbortError'});
        if (options.onCommand) await options.onCommand(command,args);
        if (command==='pdfinfo') return {stdout:'Pages: 3\nEncrypted: no\n'};
        if (command==='pdftotext') return {stdout:'Extraído del PDF\n'};
        let output;
        if (command==='ffmpeg') output=args.at(-1);
        else if (command==='convert') output=args.at(-1);
        else if (command==='libreoffice') {
            const outdir=args[args.indexOf('--outdir')+1], input=args.at(-1), format=args[args.indexOf('--convert-to')+1];
            output=path.join(outdir,`${path.parse(input).name}.${format}`);
        } else if (command==='gs') output=args.find(arg=>arg.startsWith('-sOutputFile='))?.slice('-sOutputFile='.length);
        else if (command==='pdftoppm') {
            const prefix=args.at(-1), first=Number(args[args.indexOf('-f')+1]), last=Number(args[args.indexOf('-l')+1]);
            for(let page=first;page<=last;page++) await fs.writeFile(`${prefix}-${String(page).padStart(2,'0')}.jpg`,Buffer.from([255,216,255,0]));
            return {stdout:''};
        } else throw Error(`Unexpected command ${command}`);
        await fs.writeFile(output,output.endsWith('.pdf')?PDF:output.endsWith('.zip')?Buffer.from([80,75,3,4,0]):Buffer.from('rendered media'));
        return {stdout:''};
    };
    const adapter=createDocumentsMedia({download:async(src,{maxBytes,signal})=>{
        assert.ok(src.raw);assert.ok(src.attachment.chatId);assert.ok(maxBytes>0);signal.throwIfAborted();
        const media=buffers.get(src.attachment.ref);if(!media)throw Error('missing fixture');return media;
    },downloadUrl:options.downloadUrl|| (async(url,{signal})=>{signal.throwIfAborted();assert.equal(url,'https://media.invalid/file.mp4');return {buffer:Buffer.from('video'),extension:'mp4'};}),
        run:options.run||run,tempDirectory,clock:{now:()=>now},ocr:options.ocr,
        ...(options.files?{files:options.files}:{}),...(options.maxInputBytes?{maxInputBytes:options.maxInputBytes}:{}),...(options.outputTtlMs?{outputTtlMs:options.outputTtlMs}:{}),
        ...(options.maxPdfPages?{maxPdfPages:options.maxPdfPages}:{}),onCleanupError:options.onCleanupError||(()=>{})});
    return {adapter,commands,tempDirectory,parent,advance:ms=>{now+=ms;},dispose:async()=>fs.rm(parent,{recursive:true,force:true})};
}
function request(operation,signal,extra={}) { return {operation,args:{},signal,...extra}; }

test('media conversions preserve FFmpeg flags and return a leased private output',async()=>{
    const h=await harness();
    try {
        const reply=await h.adapter.process(request('convert-media',new AbortController().signal,{source:source('media://clip','video/mp4'),args:{format:'mp3',quality:'alta',speed:1.5,trimStart:'2',trimEnd:'8',bitrate:128000,name:'voz lista'}}));
        assert.equal(reply.parts.length,1);assert.equal(reply.parts[0].type,'audio');assert.equal(reply.parts[0].mime,'audio/mpeg');
        assert.match(reply.parts[0].ref,/botsky-v2-media\/botsky-documents-.*\/voz_lista\.mp3$/);
        const ffmpeg=h.commands.find(command=>command.command==='ffmpeg');
        assert.ok(ffmpeg.args.includes('-ss'));assert.ok(ffmpeg.args.includes('2'));assert.ok(ffmpeg.args.includes('-to'));assert.ok(ffmpeg.args.includes('128000'));
        assert.equal((await fs.stat(reply.parts[0].ref)).mode&0o777,0o600);
        const dir=path.dirname(reply.parts[0].ref);assert.deepEqual(await fs.readdir(dir),['voz_lista.mp3']);
        assert.equal(await h.adapter.release(reply.parts[0].ref),true);assert.deepEqual(await fs.readdir(h.tempDirectory),[]);
    } finally { await h.dispose(); }
});

test('URL conversion uses its injected downloader and output PDF conversion validates source signatures',async()=>{
    const h=await harness();
    try {
        const urlReply=await h.adapter.process(request('convert-media',new AbortController().signal,{args:{url:'https://media.invalid/file.mp4',format:'mp4'}}));
        assert.equal(urlReply.parts[0].type,'video');
        const pdfReply=await h.adapter.process(request('convert-media',new AbortController().signal,{source:source('media://office','application/vnd.openxmlformats-officedocument.wordprocessingml.document'),args:{format:'pdf'}}));
        assert.equal(pdfReply.parts[0].mime,'application/pdf');
        const officeCommand=h.commands.find(item=>item.command==='libreoffice');
        assert.ok(officeCommand.args.some(arg=>arg.startsWith('-env:UserInstallation=file:')));
        assert.ok(officeCommand.args.includes('--convert-to'));assert.ok(officeCommand.options.timeoutMs>=45_000);
    } finally { await h.dispose(); }
});

test('image PDF creation and PDF operations preserve source order and validate page ranges',async()=>{
    const h=await harness();
    try {
        const mergedImages=await h.adapter.process(request('images-to-pdf',new AbortController().signal,{sources:[source('media://image','image/png','image'),source('media://image','image/png','image')]}));
        assert.equal(mergedImages.parts[0].mime,'application/pdf');
        assert.ok(h.commands.find(item=>item.command==='convert').args.at(-1).endsWith('images.pdf'));
        const merge=await h.adapter.process(request('merge-pdfs',new AbortController().signal,{sources:[source('media://pdf-a','application/pdf'),source('media://pdf-b','application/pdf')]}));
        assert.equal(merge.parts[0].mime,'application/pdf');
        const gsMerge=h.commands.filter(item=>item.command==='gs').at(-1);
        assert.ok(gsMerge.args.indexOf(gsMerge.args.find(arg=>arg.includes('part-001.pdf')))<gsMerge.args.indexOf(gsMerge.args.find(arg=>arg.includes('part-002.pdf'))));
        const crop=await h.adapter.process(request('crop-pdf',new AbortController().signal,{source:source('media://pdf-a','application/pdf'),args:{pages:'3-1'}}));
        assert.ok(h.commands.filter(item=>item.command==='gs').at(-1).args.includes('-sPageList=1-3'));
        assert.equal(crop.parts[0].mime,'application/pdf');
        await assert.rejects(h.adapter.process(request('crop-pdf',new AbortController().signal,{source:source('media://pdf-a','application/pdf'),args:{pages:'1;rm -rf /'}})),/Document operation failed/);
        assert.deepEqual(normalizePages('2,3-',3),'2,3-3');assert.deepEqual(toRanges([1,2,4]),[[1,2],[4,4]]);
    } finally { await h.dispose(); }
});

test('PDF raster extraction supports ordered pages and ZIP while keeping only deliverables',async()=>{
    const h=await harness();
    try {
        const extracted=await h.adapter.process(request('pdf-to-images',new AbortController().signal,{source:source('media://pdf-a','application/pdf'),args:{pages:'3,1'}}));
        assert.equal(extracted.parts[0].text,'Extraje 2 imágenes.');
        assert.match(extracted.parts[1].ref,/page-03\.jpg$/);assert.match(extracted.parts[2].ref,/page-01\.jpg$/);
        for(const part of extracted.parts.slice(1))assert.equal((await fs.stat(part.ref)).mode&0o777,0o600);
        const zipped=await h.adapter.process(request('pdf-to-images',new AbortController().signal,{source:source('media://pdf-a','application/pdf'),args:{pages:'2',zip:true}}));
        assert.equal(zipped.parts[0].mime,'application/zip');assert.ok(zipped.parts[0].ref.endsWith('.zip'));
    } finally { await h.dispose(); }
});

test('readContent delegates PDF, text, Office, HTML and OCR through injected reader ports',async()=>{
    const h=await harness({ocr:async(file,{mime,language,signal})=>{assert.equal(mime,'image/png');assert.equal(language,'spa+eng');signal.throwIfAborted();assert.ok(file.endsWith('.png'));return '  texto OCR  ';}});
    try {
        assert.equal(await h.adapter.readContent(source('media://pdf-a','application/pdf'),{signal:new AbortController().signal}),'Extraído del PDF');
        assert.equal(await h.adapter.readContent(source('media://text','text/plain'),{signal:new AbortController().signal}),'Línea uno\nLínea dos');
        const optionalKind=source('media://text','text/plain');delete optionalKind.attachment.kind;
        assert.equal(await h.adapter.readContent(optionalKind,{signal:new AbortController().signal}),'Línea uno\nLínea dos');
        assert.equal(await h.adapter.readContent(source('media://html','text/html'),{signal:new AbortController().signal}),'Hola mundo');
        assert.equal(await h.adapter.readContent(source('media://office','application/vnd.openxmlformats-officedocument.wordprocessingml.document'),{signal:new AbortController().signal}),'Extraído del PDF');
        assert.equal(await h.adapter.readContent(source('media://image','image/png','image'),{signal:new AbortController().signal}),'texto OCR');
        assert.ok(h.commands.some(item=>item.command==='libreoffice'));
        assert.ok(h.commands.some(item=>item.command==='pdftotext'&&item.args.includes('-layout')));
    } finally { await h.dispose(); }
});

test('invalid pages, fake signatures, command failure and abort never retain output or leak diagnostics',async()=>{
    const errors=[];const h=await harness({onCleanupError:error=>errors.push(error)});
    try {
        await assert.rejects(h.adapter.process(request('crop-pdf',new AbortController().signal,{source:source('media://pdf-a','application/pdf'),args:{pages:'999-'}})),/Document operation failed/);
        await assert.rejects(h.adapter.process(request('convert-document',new AbortController().signal,{source:source('media://fake-office','application/vnd.openxmlformats-officedocument.wordprocessingml.document'),args:{format:'pdf'}})),/Document operation failed/);
        const controller=new AbortController();controller.abort();await assert.rejects(h.adapter.process(request('convert-media',controller.signal,{source:source('media://clip','video/mp4'),args:{format:'mp3'}})),{name:'AbortError'});
        assert.deepEqual(await fs.readdir(h.tempDirectory),[]);assert.equal(errors.length,0);
    } finally { await h.dispose(); }
});

test('cleanupExpired honors output leases, release is scoped, and expired workspaces are removed',async()=>{
    const h=await harness({outputTtlMs:5000});
    try {
        const reply=await h.adapter.process(request('compress-pdf',new AbortController().signal,{source:source('media://pdf-a','application/pdf')}));
        assert.equal(await h.adapter.cleanupExpired(),0);
        h.advance(4999);assert.equal(await h.adapter.cleanupExpired(),0);
        h.advance(2);assert.equal(await h.adapter.cleanupExpired(),1);
        await assert.rejects(fs.stat(reply.parts[0].ref),{code:'ENOENT'});
        assert.equal(await h.adapter.release(path.join(h.tempDirectory,'foreign','file.pdf')),false);
    } finally { await h.dispose(); }
});

test('workspace cleanup failures are reported while provider diagnostics stay hidden',async()=>{
    const reports=[];let failRemoval=false;
    const files=new Proxy(fs,{get(target,key){if(key==='rm')return async(...args)=>{if(failRemoval)throw Error('private /tmp/path SECRET');return fs.rm(...args);};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
    const h=await harness({files,run:async()=>{failRemoval=true;throw Error('provider /tmp/path SECRET');},onCleanupError:error=>reports.push(error)});
    try {
        await assert.rejects(h.adapter.process(request('convert-media',new AbortController().signal,{source:source('media://clip','video/mp4'),args:{format:'mp3'}})),error=>{
            assert.doesNotMatch(error.message,/SECRET|private|tmp/);return true;
        });
        assert.equal(reports.length,1);assert.match(reports[0].message,/SECRET/);
    } finally { await h.dispose(); }
});
