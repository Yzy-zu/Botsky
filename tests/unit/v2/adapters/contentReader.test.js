'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {AppError}=require('../../../../src/v2/domain/errors');
const {createContentReader,htmlToText,MAX_INLINE_BYTES}=require('../../../../src/v2/adapters/media/contentReader');

const PDF=Buffer.from('%PDF-1.7\nsynthetic\n%%EOF');
const DOCX=Buffer.from([0x50,0x4b,0x03,0x04,1,2,3]);
const PNG=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(16)]);
const USER='19995550101@s.whatsapp.net',CHAT='19995559999@g.us';
function source(ref,mime,kind='document') { return {attachment:{id:`id-${ref}`,ownerJid:USER,chatId:CHAT,ref,mime,kind},raw:{key:{id:`id-${ref}`,remoteJid:CHAT}}}; }
async function fixture(options={}) {
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'botsky-content-reader-test-'));
    const buffers=new Map(Object.entries(options.buffers||{}));
    const calls=[];
    const run=async(command,args,request)=>{
        calls.push({command,args,request});
        request.signal.throwIfAborted();
        if(options.run) return options.run(command,args,request,root);
        if(command==='pdfinfo')return{stdout:options.pdfInfo||'Pages: 2\nEncrypted: no\n'};
        if(command==='pdftotext')return{stdout:options.pdfText||'Texto del PDF\n'};
        if(command==='libreoffice'){
            const outdir=args[args.indexOf('--outdir')+1];
            await fs.writeFile(path.join(outdir,`${path.parse(args.at(-1)).name}.pdf`),PDF);
            return{stdout:''};
        }
        throw Error(`Unexpected ${command}`);
    };
    const reader=createContentReader({tempDirectory:path.join(root,'reader-tmp'),run,clock:undefined,
        downloadMedia:async(src,{maxBytes,signal})=>{
            signal.throwIfAborted();assert.ok(maxBytes<=MAX_INLINE_BYTES);
            const data=buffers.get(src.attachment.ref);if(!data)throw Error('missing synthetic file');
            return {buffer:data.buffer,extension:data.extension,mime:data.mime,originalFileName:data.name};
        },ocr:options.ocr,...(options.maxInputBytes?{maxInputBytes:options.maxInputBytes}:{}),
        ...(options.maxTextCharacters?{maxTextCharacters:options.maxTextCharacters}:{}),...(options.maxPdfPages?{maxPdfPages:options.maxPdfPages}:{})});
    return {reader,calls,root,dispose:()=>fs.rm(root,{recursive:true,force:true})};
}
function file(buffer,extension,mime,name=`file.${extension}`) { return {buffer,extension,mime,name}; }

test('reads bounded UTF-8 TXT, Markdown, CSV and JSON directly without subprocesses',async()=>{
    const f=await fixture({buffers:{
        'media://txt':file(Buffer.from('Línea uno\nLínea dos'),'txt','text/plain'),
        'media://md':file(Buffer.from('# Título\ncontenido'),'md','text/markdown'),
        'media://csv':file(Buffer.from('nombre,valor\nAna,2'),'csv','text/csv'),
        'media://json':file(Buffer.from('{"ok":true}'),'json','application/json')
    }});
    try {
        assert.equal(await f.reader.readContent(source('media://txt','text/plain'),{signal:new AbortController().signal}),'Línea uno\nLínea dos');
        assert.equal(await f.reader.readContent(source('media://md','text/markdown'),{signal:new AbortController().signal}),'# Título\ncontenido');
        assert.equal(await f.reader.readContent(source('media://csv','text/csv'),{signal:new AbortController().signal}),'nombre,valor\nAna,2');
        assert.equal(await f.reader.readContent(source('media://json','application/json'),{signal:new AbortController().signal}),'{"ok":true}');
        assert.equal(f.calls.length,0);
    } finally { await f.dispose(); }
});

test('extracts HTML as bounded plain text and removes scripts, styles, comments and tags',async()=>{
    const html='<h1>Hola&nbsp;mundo</h1><!-- hidden --><script>alert("secret")</script><p>A &amp; B<br>fin</p><style>.x{}</style>';
    const f=await fixture({buffers:{'media://html':file(Buffer.from(html),'html','text/html')}});
    try {
        assert.equal(await f.reader.readContent(source('media://html','text/html'),{signal:new AbortController().signal}),'Hola mundo\nA & B\nfin');
        assert.equal(htmlToText('<p>uno</p><p>dos</p>'),'uno\ndos');
    } finally { await f.dispose(); }
});

test('reads PDF through bounded pdfinfo and pdftotext and converts supported office files first',async()=>{
    const f=await fixture({buffers:{
        'media://pdf':file(PDF,'pdf','application/pdf'),
        'media://docx':file(DOCX,'docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document','lesson.docx'),
        'media://doc':file(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]),'doc','application/msword','legacy.doc')
    }});
    try {
        assert.equal(await f.reader.readContent(source('media://pdf','application/pdf'),{signal:new AbortController().signal}),'Texto del PDF');
        assert.equal(await f.reader.readContent(source('media://docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'),{signal:new AbortController().signal}),'Texto del PDF');
        assert.equal(await f.reader.readContent(source('media://doc','application/msword'),{signal:new AbortController().signal}),'Texto del PDF');
        assert.equal(f.calls.filter(c=>c.command==='libreoffice').length,2);
        assert.ok(f.calls.filter(c=>c.command==='pdfinfo').every(c=>c.request.timeoutMs===15_000));
        assert.ok(f.calls.filter(c=>c.command==='pdftotext').every(c=>c.request.maxBuffer===2*1024*1024));
        assert.deepEqual(await fs.readdir(path.join(f.root,'reader-tmp')),[],'all converted and source workspaces are removed');
    } finally { await f.dispose(); }
});

test('uses only the injected OCR engine for image files and cleans its workspace',async()=>{
    const f=await fixture({buffers:{'media://image':file(PNG,'png','image/png')},ocr:async(input,{mime,language,signal})=>{
        assert.equal(mime,'image/png');assert.equal(language,'spa+eng');signal.throwIfAborted();assert.ok(input.endsWith('input.png'));return ' texto de imagen ';
    }});
    try {
        assert.equal(await f.reader.readContent(source('media://image','image/png','image'),{signal:new AbortController().signal}),'texto de imagen');
        assert.deepEqual(await fs.readdir(path.join(f.root,'reader-tmp')),[]);
    } finally { await f.dispose(); }
});

test('rejects malformed, unsupported and oversized inputs with typed errors and enforces page/text caps',async()=>{
    const f=await fixture({buffers:{
        'media://bad-utf8':file(Buffer.from([0xff,0xfe]),'txt','text/plain'),
        'media://bin':file(Buffer.from([0,1,2]),'txt','text/plain'),
        'media://large':file(Buffer.alloc(10),'txt','text/plain'),
        'media://gif':file(Buffer.from('GIF89a'),'gif','image/gif'),
        'media://pdf':file(PDF,'pdf','application/pdf'),
        'media://long':file(Buffer.from('123456'),'txt','text/plain')
    },maxInputBytes:8,maxTextCharacters:5,maxPdfPages:1,pdfInfo:'Pages: 2\nEncrypted: no'});
    try {
        await assert.rejects(f.reader.readContent(source('media://bad-utf8','text/plain'),{signal:new AbortController().signal}),e=>e instanceof AppError&&e.kind==='bad_output');
        await assert.rejects(f.reader.readContent(source('media://bin','text/plain'),{signal:new AbortController().signal}),e=>e instanceof AppError&&e.kind==='bad_output');
        await assert.rejects(f.reader.readContent(source('media://large','text/plain'),{signal:new AbortController().signal}),e=>e instanceof AppError&&e.kind==='too_large');
        await assert.rejects(f.reader.readContent(source('media://gif','image/gif','image'),{signal:new AbortController().signal}),e=>e instanceof AppError&&e.kind==='unsupported_media');
        await assert.rejects(f.reader.readContent(source('media://pdf','application/pdf'),{signal:new AbortController().signal}),e=>e instanceof AppError&&e.kind==='too_large');
        await assert.rejects(f.reader.readContent(source('media://long','text/plain'),{signal:new AbortController().signal}),e=>e instanceof AppError&&e.kind==='too_large');
        await assert.rejects(f.reader.readContent(source('media://txt','text/plain','audio'),{signal:new AbortController().signal}),e=>e instanceof AppError&&e.kind==='unsupported_media');
    } finally { await f.dispose(); }
});

test('maps process failures, preserves cancellation and limits abortable operation resources',async()=>{
    const f=await fixture({buffers:{'media://pdf':file(PDF,'pdf','application/pdf')},run:async(command,args,request)=>{
        request.signal.throwIfAborted();
        if(command==='pdfinfo')throw Object.assign(Error('private detail'),{code:'ETIMEDOUT'});
        return{stdout:''};
    }});
    try {
        await assert.rejects(f.reader.readContent(source('media://pdf','application/pdf'),{signal:new AbortController().signal}),e=>e instanceof AppError&&e.kind==='timeout');
        const controller=new AbortController();controller.abort();
        await assert.rejects(f.reader.readContent(source('media://pdf','application/pdf'),{signal:controller.signal}),{name:'AbortError'});
        assert.deepEqual(await fs.readdir(path.join(f.root,'reader-tmp')),[]);
    } finally { await f.dispose(); }
});
