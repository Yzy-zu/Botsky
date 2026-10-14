// @ts-check
'use strict';

const fsPromises = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const os = require('node:os');
const { writeZip } = require('./zip');
const { createContentReader } = require('./contentReader');

const execFileAsync = promisify(execFile);
const PREFIX = 'botsky-documents-';
const DEFAULT_MAX_INPUT_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_OUTPUT_BYTES = 128 * 1024 * 1024;
const DEFAULT_OUTPUT_TTL_MS = 60 * 60 * 1000;
const DEFAULT_MAX_PDF_PAGES = 1000;
const MAX_COLLECTION_BYTES = 256 * 1024 * 1024;
const DOCUMENT_FORMATS = Object.freeze(['pdf','docx','doc','xlsx','xls','pptx','ppt','odt','ods','odp']);
const PROCESS_OPERATIONS = Object.freeze(['convert-media','convert-document','images-to-pdf','compress-pdf','crop-pdf','merge-pdfs','pdf-to-images']);
const TEXT_EXTENSIONS = Object.freeze(['txt','md','csv','json','log']);
const EXTENSION_MIME = Object.freeze({
    mp3:'audio/mpeg',m4a:'audio/mp4',ogg:'audio/ogg',wav:'audio/wav',opus:'audio/opus',
    mp4:'video/mp4',webm:'video/webm',avi:'video/x-msvideo',gif:'image/gif',webp:'image/webp',
    png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',pdf:'application/pdf',zip:'application/zip',
    doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    odt:'application/vnd.oasis.opendocument.text',ods:'application/vnd.oasis.opendocument.spreadsheet',odp:'application/vnd.oasis.opendocument.presentation'
});
const FORMAT_CONFIG = Object.freeze({
    mp3:{ext:'mp3',args:['-c:a','libmp3lame'],type:'audio'}, m4a:{ext:'m4a',args:['-c:a','aac'],type:'audio'},
    ogg:{ext:'ogg',args:['-c:a','libvorbis'],type:'audio'}, wav:{ext:'wav',args:['-c:a','pcm_s16le'],type:'audio'},
    opus:{ext:'opus',args:['-c:a','libopus'],type:'audio'}, mp4:{ext:'mp4',args:['-c:v','libx264','-c:a','aac','-movflags','faststart'],type:'video'},
    webm:{ext:'webm',args:['-c:v','libvpx-vp9','-c:a','libopus'],type:'video'}, avi:{ext:'avi',args:['-c:v','libxvid','-c:a','mp3'],type:'video'},
    gif:{ext:'gif',args:['-vf','fps=10,scale=480:-1:flags=lanczos','-loop','0'],type:'image'},
    webp:{ext:'webp',args:['-c:v','libwebp','-quality','85'],type:'image'}
});
const QUALITY_FLAGS = Object.freeze({ alta:{video:['-crf','18'],audio:['-q:a','0']}, media:{video:['-crf','23'],audio:['-q:a','4']}, baja:{video:['-crf','30'],audio:['-q:a','7']} });

/** @typedef {{attachment:import('../../pipeline/contracts').Attachment&{chatId?:string},raw:object}} DocumentSource */
/** @typedef {{buffer:Buffer,extension:string,originalFileName?:string|null,mime?:string}} Downloaded */
/** @typedef {{timeoutMs:number,signal:AbortSignal,maxBuffer:number}} RunOptions */
/** @typedef {{download:(source:DocumentSource,options:{maxBytes:number,signal:AbortSignal})=>Promise<Downloaded>,downloadUrl?:(url:string,options:{maxBytes:number,signal:AbortSignal})=>Promise<Downloaded>,run?:(command:string,args:string[],options:RunOptions)=>Promise<{stdout?:string|Buffer,stderr?:string|Buffer}>,ocr?:(inputPath:string,options:{mime:string,language:'spa+eng',signal:AbortSignal})=>Promise<string|null|undefined>,tempDirectory:string,files?:typeof fsPromises,clock?:{now:()=>number},maxInputBytes?:number,maxOutputBytes?:number,outputTtlMs?:number,maxPdfPages?:number,onCleanupError?:(error:unknown)=>void}} DocumentsMediaOptions */

/** @param {typeof execFileAsync} [execute] */
function createExecFileRunner(execute = execFileAsync) {
    /** @param {string} command @param {string[]} args @param {RunOptions} options */
    return (command,args,options) => execute(command,args,{timeout:options.timeoutMs,signal:options.signal,maxBuffer:options.maxBuffer,windowsHide:true});
}

/** @param {DocumentsMediaOptions} options */
function createDocumentsMedia({download,downloadUrl,run=createExecFileRunner(),ocr,tempDirectory,files=fsPromises,clock={now:Date.now},
    maxInputBytes=DEFAULT_MAX_INPUT_BYTES,maxOutputBytes=DEFAULT_MAX_OUTPUT_BYTES,outputTtlMs=DEFAULT_OUTPUT_TTL_MS,maxPdfPages=DEFAULT_MAX_PDF_PAGES,onCleanupError=()=>{}}) {
    if (typeof download!=='function') throw new TypeError('Document media download port required');
    if (!path.isAbsolute(tempDirectory)||path.resolve(tempDirectory)!==tempDirectory||path.basename(tempDirectory)!=='botsky-v2-media') throw new TypeError('Dedicated botsky-v2-media directory required');
    if (![maxInputBytes,maxOutputBytes,outputTtlMs,maxPdfPages].every(Number.isSafeInteger)||maxInputBytes<1||maxOutputBytes<1||outputTtlMs<1000||maxPdfPages<1||maxPdfPages>5000) throw new RangeError('Invalid document media resource limits');
    /** @type {Promise<void>|undefined} */ let rootReady;
    /** @type {Set<string>} */ const active = new Set();
    /** @type {Map<string,number>} */ const leases = new Map();
    const contentReader=createContentReader({
        downloadMedia:(source,options)=>download({
            ...source,
            attachment:{...source.attachment,kind:source.attachment.kind||'document'}
        },options),
        run:(command,args,options)=>run(command,args,options),
        ocr,
        tempDirectory,
        files,
        maxInputBytes:Math.min(maxInputBytes,12*1024*1024),
        maxPdfPages:Math.min(maxPdfPages,1000),
        onCleanupError
    });

    async function ensureRoot() {
        if (!rootReady) rootReady=(async()=>{
            await files.mkdir(tempDirectory,{recursive:true,mode:0o700});
            const stat=await files.lstat(tempDirectory);
            if (!stat.isDirectory()||stat.isSymbolicLink()) throw new Error('Unsafe document temp directory');
            if (await files.realpath(tempDirectory)!==tempDirectory) throw new Error('Document temp directory was redirected');
            await files.chmod(tempDirectory,0o700);
        })();
        return rootReady;
    }
    /** @param {AbortSignal} signal */
    async function workspace(signal) {
        check(signal); await ensureRoot(); check(signal);
        const dir=await files.mkdtemp(path.join(tempDirectory,PREFIX));
        await files.chmod(dir,0o700); active.add(dir); return dir;
    }
    /** @param {AbortSignal} signal */
    function check(signal) { signal.throwIfAborted(); }
    /** @param {string} command @param {string[]} args @param {number} timeoutMs @param {AbortSignal} signal @param {number} [maxBuffer] */
    async function execute(command,args,timeoutMs,signal,maxBuffer=4*1024*1024) {
        check(signal);
        let result;
        try { result=await run(command,args,{timeoutMs,signal,maxBuffer}); }
        catch(error) { if (isAborted(error)||signal.aborted) throw error; throw new Error('Document processing command failed'); }
        check(signal); return result;
    }
    /** @param {string} filename @param {Buffer} buffer */
    async function writePrivate(filename,buffer) { await files.writeFile(filename,buffer,{flag:'wx',mode:0o600}); await files.chmod(filename,0o600); }
    /** @param {string} directory */
    async function removeWorkspace(directory) {
        const resolved=path.resolve(directory);
        if (path.dirname(resolved)!==tempDirectory||!path.basename(resolved).startsWith(PREFIX)) return;
        active.delete(resolved); leases.delete(resolved);
        await files.rm(resolved,{recursive:true,force:true});
    }
    /** @param {unknown} value */
    function sourceIsValid(value) {
        if (!value||typeof value!=='object') return false;
        const source=/** @type {DocumentSource} */(value);
        return !!source.attachment&&typeof source.attachment.ref==='string'&&!!source.attachment.ref&&!!source.raw&&typeof source.raw==='object';
    }
    /** @param {DocumentSource} source @param {AbortSignal} signal */
    async function downloadSource(source,signal) {
        check(signal); if (!sourceIsValid(source)) throw new Error('A complete document source is required');
        let media;
        try { media=await download(source,{maxBytes:maxInputBytes,signal}); }
        catch(error) { if (isAborted(error)||signal.aborted) throw error; throw new Error('Could not download the attached document'); }
        check(signal); return validateDownload(media,maxInputBytes);
    }
    /** @param {string} url @param {AbortSignal} signal */
    async function downloadUrlSource(url,signal) {
        check(signal); const parsed=safeHttpUrl(url);
        if (!downloadUrl) throw new Error('URL media download port is unavailable');
        let media;
        try { media=await downloadUrl(parsed.href,{maxBytes:maxInputBytes,signal}); }
        catch(error) { if (isAborted(error)||signal.aborted) throw error; throw new Error('Could not download media URL'); }
        check(signal); return validateDownload(media,maxInputBytes);
    }
    /** @param {Downloaded} media @param {number} limit */
    function validateDownload(media,limit) {
        if (!media||!Buffer.isBuffer(media.buffer)||media.buffer.length<1||media.buffer.length>limit) throw new Error('Downloaded document is invalid or too large');
        const extension=safeExtension(media.extension);
        return {...media,extension,originalFileName:safeName(media.originalFileName||'')};
    }
    /** @param {string} directory @param {string} filename @param {number} [limit] */
    async function assertOutput(directory,filename,limit=maxOutputBytes) {
        const resolved=path.resolve(filename);
        if (path.dirname(resolved)!==path.resolve(directory)) throw new Error('Output escaped its private workspace');
        const stat=await files.lstat(resolved);
        if (!stat.isFile()||stat.isSymbolicLink()||stat.size<1||stat.size>limit) throw new Error('Processor produced an invalid output file');
        await files.chmod(resolved,0o600); return stat;
    }
    /** @param {string} directory @param {string[]} outputPaths */
    async function retainOutputs(directory,outputPaths) {
        const keep=new Set(outputPaths.map(item=>path.resolve(item)));
        for (const name of await files.readdir(directory)) {
            const candidate=path.resolve(directory,name);
            if (keep.has(candidate)) continue;
            const stat=await files.lstat(candidate);
            if (stat.isDirectory()&&!stat.isSymbolicLink()) await files.rm(candidate,{recursive:true,force:true});
            else await files.rm(candidate,{force:true});
        }
        await files.chmod(directory,0o700);
        leases.set(path.resolve(directory),clock.now()+outputTtlMs); active.delete(path.resolve(directory));
    }
    /** @param {string} directory @param {string} pathName @param {string} mime @param {string} caption */
    async function mediaReply(directory,pathName,mime,caption) {
        await assertOutput(directory,pathName);
        await retainOutputs(directory,[pathName]);
        return {parts:[{type:mime.startsWith('audio/')?'audio':mime.startsWith('video/')?'video':mime.startsWith('image/')?'image':'document',ref:pathName,mime,caption}]};
    }
    /** @param {string} inputPath @param {AbortSignal} signal */
    async function pageCount(inputPath,signal) {
        const {stdout}=await execute('pdfinfo',[inputPath],15_000,signal,256*1024);
        const text=asText(stdout);
        if (/^Encrypted:\s+yes/im.test(text)) throw new Error('Protected PDF');
        const count=Number(text.match(/^Pages:\s*(\d+)/im)?.[1]);
        if (!Number.isSafeInteger(count)||count<1||count>maxPdfPages) throw new Error('Invalid or oversized PDF page count');
        return count;
    }
    /** @param {string} inputPath @param {string} extension @param {string} directory @param {AbortSignal} signal */
    async function officeToPdf(inputPath,extension,directory,signal) {
        if (!DOCUMENT_FORMATS.includes(/** @type {never} */(extension))) throw new Error('Unsupported office format');
        const profile=path.join(directory,'lo-profile');
        const {stdout:unused}=await execute('libreoffice',[
            `-env:UserInstallation=${pathToFileURL(profile).href}`,'--headless','--nologo','--nodefault','--nofirststartwizard',
            '--convert-to','pdf','--outdir',directory,inputPath
        ],120_000,signal,4*1024*1024);
        void unused;
        const generated=path.join(directory,`${path.parse(inputPath).name}.pdf`);
        await assertOutput(directory,generated);
        if (!isPdf(await files.readFile(generated))) throw new Error('Office converter returned invalid PDF');
        return generated;
    }
    /** @param {string} extension @param {string} mime @param {Buffer} buffer */
    function validateImage(extension,mime,buffer) {
        const supported=['jpg','jpeg','png','webp','gif','tif','tiff','bmp'];
        if (!supported.includes(extension)&&!mime.startsWith('image/')) throw new Error('Unsupported image format');
        if (extension==='gif'||mime==='image/gif') throw new Error('GIF is not supported for document conversion');
        const signatures={
            jpg:buffer.length>=3&&buffer[0]===255&&buffer[1]===216&&buffer[2]===255,
            jpeg:buffer.length>=3&&buffer[0]===255&&buffer[1]===216&&buffer[2]===255,
            png:buffer.length>=24&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
            webp:buffer.length>=12&&buffer.subarray(0,4).toString('ascii')==='RIFF'&&buffer.subarray(8,12).toString('ascii')==='WEBP',
            gif:/^GIF8[79]a$/.test(buffer.subarray(0,6).toString('ascii')),
            tif:buffer.subarray(0,4).toString('ascii')==='II*\u0000'||buffer.subarray(0,4).toString('ascii')==='MM\u0000*',
            tiff:buffer.subarray(0,4).toString('ascii')==='II*\u0000'||buffer.subarray(0,4).toString('ascii')==='MM\u0000*',
            bmp:buffer.subarray(0,2).toString('ascii')==='BM'
        };
        if (!signatures[/** @type {keyof typeof signatures} */(extension)]) throw new Error('Image signature does not match its metadata');
    }
    /** @param {string} extension @param {string} mime */
    function validateInputSignature(extension,mime) {
        if (extension==='pdf'&&!mime.startsWith('application/pdf')) throw new Error('PDF extension does not match content');
        if (['docx','xlsx','pptx','odt','ods','odp'].includes(extension)&&!mime.includes('zip')) throw new Error('Office archive signature mismatch');
        if (['doc','xls','ppt'].includes(extension)&&mime!=='application/x-ole-storage') throw new Error('Office binary signature mismatch');
    }
    /** @param {DocumentSource} source @param {string} directory @param {AbortSignal} signal @param {string} prefix */
    async function localize(source,directory,signal,prefix='input') {
        const downloaded=await downloadSource(source,signal);
        const extension=detectExtension(downloaded);
        const mime=sniffMime(downloaded.buffer)||mimeFor(extension,source.attachment.mime);
        validateInputSignature(extension,mime);
        const input=path.join(directory,`${prefix}.${extension}`);
        await writePrivate(input,downloaded.buffer);
        return {downloaded,extension,mime,input};
    }
    /** @param {{operation:string,source?:DocumentSource,sources?:DocumentSource[],args:Record<string,unknown>,signal:AbortSignal}} request */
    async function process(request) {
        const {operation,args,signal}=request;
        check(signal);
        if (!PROCESS_OPERATIONS.includes(/** @type {never} */(operation))) throw new TypeError('Unknown document operation');
        const directory=await workspace(signal);
        let retained=false;
        try {
            let reply;
            if (operation==='convert-media') reply=await convertMedia(directory,request,signal);
            else if (operation==='convert-document') reply=await convertDocument(directory,request,signal);
            else if (operation==='images-to-pdf') reply=await imagesToPdf(directory,request,signal);
            else if (operation==='compress-pdf') reply=await compressPdf(directory,request,signal);
            else if (operation==='crop-pdf') reply=await cropPdf(directory,request,signal);
            else if (operation==='merge-pdfs') reply=await mergePdfs(directory,request,signal);
            else reply=await pdfToImages(directory,request,signal);
            retained=leases.has(path.resolve(directory));
            return reply;
        } catch(error) {
            if (isAborted(error)||signal.aborted) throw error;
            const cleanupFailure=await cleanupWorkspace(directory);
            if (cleanupFailure) throw new AggregateError([new Error('Document operation failed'),cleanupFailure],'Document operation and workspace cleanup failed');
            if (error instanceof PageSelectionError) throw error;
            throw new Error('Document operation failed');
        } finally {
            if (!retained&&active.has(path.resolve(directory))) await cleanupWorkspace(directory);
        }
    }
    /** @param {string} directory @param {{operation:string,source?:DocumentSource,sources?:DocumentSource[],args:Record<string,unknown>,signal:AbortSignal}} request @param {AbortSignal} signal */
    async function convertMedia(directory,request,signal) {
        const {args}=request; const format=stringArg(args.format,'mp3'); const cfg=FORMAT_CONFIG[/** @type {keyof typeof FORMAT_CONFIG} */(format)];
        if (format==='pdf') {
            if (typeof args.url==='string') throw new Error('Cannot create PDF from URL');
            if (!request.source) throw new Error('PDF source is missing');
            return convertDocument(directory,{source:request.source,args:{...args,format:'pdf'}},signal);
        }
        if (!cfg) throw new Error('Unsupported conversion format');
        const quality=stringArg(args.quality,'media'); const q=/** @type {keyof typeof QUALITY_FLAGS} */(quality);
        if (!QUALITY_FLAGS[q]) throw new Error('Unsupported media quality');
        const speed=numberArg(args.speed,1); if (speed<0.25||speed>4) throw new Error('Invalid conversion speed');
        if (speed!==1&&!['audio','video'].includes(cfg.type)&&format!=='gif') throw new Error('Speed is unsupported for this output format');
        const bitrate=args.bitrate===undefined?undefined:parseBitrate(args.bitrate);
        if (args.bitrate!==undefined&&bitrate===undefined) throw new Error('Invalid conversion bitrate');
        if (bitrate!==undefined) {
            if (!['audio','video'].includes(cfg.type)||format==='wav') throw new Error('Bitrate is unsupported for this output format');
            const minimum=cfg.type==='audio'?8000:32000, maximum=cfg.type==='audio'?512000:100_000_000;
            if (bitrate<minimum||bitrate>maximum) throw new Error('Bitrate is outside the allowed range');
        }
        const trimStart=parseTime(args.trimStart); const trimEnd=parseTime(args.trimEnd);
        if (args.trimStart!==undefined&&!trimStart||args.trimEnd!==undefined&&!trimEnd) throw new Error('Invalid conversion time');
        let input;
        if (typeof args.url==='string') {
            if (format==='pdf') throw new Error('Cannot create PDF from URL');
            const downloaded=await downloadUrlSource(args.url,signal); const extension=detectExtension(downloaded);
            input=path.join(directory,`input.${extension}`); await writePrivate(input,downloaded.buffer);
        } else if (request.source) input=(await localize(request.source,directory,signal)).input;
        else throw new Error('Conversion source is missing');
        const output=path.join(directory,`output.${cfg.ext}`);
        const ffmpegArgs=['-y']; if (trimStart) ffmpegArgs.push('-ss',trimStart); if (trimEnd) ffmpegArgs.push('-to',trimEnd);
        ffmpegArgs.push('-i',input);
        const codecArgs=[...cfg.args];
        if (speed!==1&&format==='gif') { const i=codecArgs.indexOf('-vf'); codecArgs[i+1]=`setpts=(PTS-STARTPTS)/${speed},${codecArgs[i+1]}`; }
        ffmpegArgs.push(...codecArgs);
        if (cfg.type==='audio'||cfg.type==='video') {
            if (bitrate!==undefined) ffmpegArgs.push(cfg.type==='audio'?'-b:a':'-b:v',String(bitrate));
            else ffmpegArgs.push(...QUALITY_FLAGS[q][/** @type {'audio'|'video'} */(cfg.type)]);
            if (speed!==1) { if (cfg.type==='video') ffmpegArgs.push('-vf',`setpts=(PTS-STARTPTS)/${speed}`); ffmpegArgs.push('-af',audioTempoFilter(speed)); }
        }
        if (cfg.type==='audio') ffmpegArgs.push('-vn');
        ffmpegArgs.push('-threads',String(Math.min(os.cpus()?.length||2,8)),output);
        await execute('ffmpeg',ffmpegArgs,15*60_000,signal,50*1024*1024);
        await assertOutput(directory,output);
        const name=safeOutputName(args.name,cfg.ext);
        if (name) await renameOutput(files,output,path.join(directory,name));
        const finalPath=name?path.join(directory,name):output;
        return mediaReply(directory,finalPath,mimeFor(cfg.ext,'application/octet-stream'),`Listo, aquí tienes tu ${format.toUpperCase()}.`);
    }
    /** @param {string} directory @param {{source?:DocumentSource,args:Record<string,unknown>}} request @param {AbortSignal} signal */
    async function convertDocument(directory,request,signal) {
        if (!request.source) throw new Error('Document source is missing');
        const {downloaded,extension,mime,input}=await localize(request.source,directory,signal);
        const format=stringArg(request.args.format,'pdf');
        if (!DOCUMENT_FORMATS.includes(/** @type {never} */(format))) throw new Error('Unsupported document output format');
        if (extension===format) return {parts:[{type:'text',text:`El archivo ya está en \`${format}\`. Puedes usarlo tal cual.`}]};
        let output;
        if (format==='pdf'&&mime.startsWith('image/')) {
            validateImage(extension,mime,downloaded.buffer); output=path.join(directory,'output.pdf');
            await execute('convert',[input,output],120_000,signal);
        } else if (format==='pdf'&&['docx','doc','pptx','xlsx','odt','ods','odp','xls','ppt'].includes(extension)) {
            output=await officeToPdf(input,extension,directory,signal);
        } else if (mime==='application/pdf'&&['xls','xlsx','ods'].includes(format)) {
            throw new Error('PDF to spreadsheet conversion is unsupported');
        } else if (mime.startsWith('image/')) {
            throw new Error('Images convert to PDF only');
        } else {
            const profile=path.join(directory,'lo-profile');
            const inputFilter=extension==='pdf'&&['docx','doc','odt'].includes(format)?['--infilter=writer_pdf_import']:
                extension==='pdf'&&['pptx','ppt','odp'].includes(format)?['--infilter=impress_pdf_import']:[];
            await execute('libreoffice',[
                `-env:UserInstallation=${pathToFileURL(profile).href}`,'--headless','--nologo','--nodefault','--nofirststartwizard',
                ...inputFilter,'--convert-to',format,'--outdir',directory,input
            ],120_000,signal,4*1024*1024);
            output=path.join(directory,`${path.parse(input).name}.${format}`);
        }
        await assertOutput(directory,output);
        if (format==='pdf'&&!isPdf(await files.readFile(output))) throw new Error('Invalid generated PDF');
        const original=downloaded.originalFileName?path.parse(downloaded.originalFileName).name:'';
        const name=safeOutputName(original,format);
        if (name&&path.basename(output)!==name) { await renameOutput(files,output,path.join(directory,name)); output=path.join(directory,name); }
        return mediaReply(directory,output,mimeFor(format,'application/vnd.openxmlformats-officedocument'),`Listo, aquí está tu ${format.toUpperCase()}.`);
    }
    /** @param {string} directory @param {{sources?:DocumentSource[],args:Record<string,unknown>}} request @param {AbortSignal} signal */
    async function imagesToPdf(directory,request,signal) {
        if (!request.sources?.length||request.sources.length>20) throw new Error('Invalid image collection');
        /** @type {string[]} */ const inputs=[];
        let totalBytes=0;
        for (let i=0;i<request.sources.length;i++) {
            const {downloaded,extension,mime}=await localize(request.sources[i],directory,signal,`image-${String(i+1).padStart(3,'0')}`);
            totalBytes+=downloaded.buffer.length; if (totalBytes>MAX_COLLECTION_BYTES) throw new Error('Image PDF collection exceeds its size limit');
            validateImage(extension,mime,downloaded.buffer); inputs.push(path.join(directory,`image-${String(i+1).padStart(3,'0')}.${extension}`));
        }
        const output=path.join(directory,'images.pdf');
        await execute('convert',[...inputs,output],120_000,signal,16*1024*1024);
        await assertOutput(directory,output);
        if (!isPdf(await files.readFile(output))) throw new Error('Image converter returned invalid PDF');
        return mediaReply(directory,output,'application/pdf','Listo, aquí está tu PDF.');
    }
    /** @param {string} directory @param {{source?:DocumentSource}} request @param {AbortSignal} signal */
    async function compressPdf(directory,request,signal) {
        const {input}=await requirePdf(directory,request.source,signal); const output=path.join(directory,'compressed.pdf');
        await execute('gs',['-sDEVICE=pdfwrite','-dCompatibilityLevel=1.4','-dPDFSETTINGS=/screen','-dNOPAUSE','-dQUIET','-dBATCH',`-sOutputFile=${output}`,input],60_000,signal);
        await assertOutput(directory,output); if (!isPdf(await files.readFile(output))) throw new Error('PDF compressor returned invalid output');
        return mediaReply(directory,output,'application/pdf','Listo, aquí está el PDF comprimido.');
    }
    /** @param {string} directory @param {{source?:DocumentSource,args:Record<string,unknown>}} request @param {AbortSignal} signal */
    async function cropPdf(directory,request,signal) {
        const {input,downloaded}=await requirePdf(directory,request.source,signal); const pages=await pageCount(input,signal);
        const raw=request.args.pages;
        if (typeof raw!=='string'||!raw.trim()) throw new PageSelectionError('required',pages);
        const value=raw.trim().toLowerCase();
        if (value!=='ultima'&&!value.split(',').every(part=>/^\d+(?:-\d*)?$/.test(part))) throw new PageSelectionError('format',pages);
        if(value!=='ultima')for(const part of value.split(',')){
            if(part.endsWith('-')){const start=Number(part.slice(0,-1));if(start<1)throw new PageSelectionError('positive',pages);if(start>pages)throw new PageSelectionError('range',pages);}
            else if(part.includes('-')){let[start,end]=part.split('-').map(Number);if(start>end)[start,end]=[end,start];if(start>pages)throw new PageSelectionError('range',pages);}
            else{const page=Number(part);if(page<1)throw new PageSelectionError('positive',pages);if(page>pages)throw new PageSelectionError('range',pages);}
        }
        const normalized=normalizePages(raw,pages); const output=path.join(directory,'cropped.pdf');
        await execute('gs',['-sDEVICE=pdfwrite','-dCompatibilityLevel=1.4','-dNOPAUSE','-dQUIET','-dBATCH','-dSAFER',`-sPageList=${normalized}`,`-sOutputFile=${output}`,input],60_000,signal);
        await assertOutput(directory,output); const name=safeOutputName(`${path.parse(downloaded.originalFileName||'documento').name}-p${normalized.replace(/,/g,'_')}`,'pdf');
        if (name) await renameOutput(files,output,path.join(directory,name)); const final=name?path.join(directory,name):output;
        return mediaReply(directory,final,'application/pdf',`Páginas extraídas: ${normalized}.`);
    }
    /** @param {string} directory @param {{sources?:DocumentSource[]}} request @param {AbortSignal} signal */
    async function mergePdfs(directory,request,signal) {
        const sources=request.sources||[]; if (!sources.length||sources.length>20) throw new Error('Invalid PDF collection');
        /** @type {string[]} */ const inputs=[];
        let totalBytes=0;
        for (let i=0;i<sources.length;i++) { const value=await requirePdf(directory,sources[i],signal,`part-${String(i+1).padStart(3,'0')}`); totalBytes+=value.downloaded.buffer.length; if(totalBytes>MAX_COLLECTION_BYTES)throw new Error('PDF merge collection exceeds its size limit'); inputs.push(value.input); }
        const output=path.join(directory,'merged.pdf');
        await execute('gs',['-q','-dNOPAUSE','-dBATCH','-dSAFER','-sDEVICE=pdfwrite','-sOutputFile='+output,...inputs],120_000,signal,16*1024*1024);
        await assertOutput(directory,output); if (!isPdf(await files.readFile(output))) throw new Error('PDF merge returned invalid output');
        return mediaReply(directory,output,'application/pdf','Listo, aquí está tu PDF unido.');
    }
    /** @param {string} directory @param {{source?:DocumentSource,args:Record<string,unknown>}} request @param {AbortSignal} signal */
    async function pdfToImages(directory,request,signal) {
        const {input,downloaded}=await requirePdf(directory,request.source,signal); const total=await pageCount(input,signal);
        const raw=typeof request.args.pages==='string'&&request.args.pages.trim()?request.args.pages:'1-';
        const normalized=normalizePages(raw,total); const selected=expandPages(normalized,total);
        if (selected.length>100) throw new Error('At most 100 PDF pages can be extracted in one operation');
        const prefix=path.join(directory,'page');
        for (const [start,end] of toRanges(selected)) await execute('pdftoppm',['-jpeg','-f',String(start),'-l',String(end),input,prefix],120_000,signal,16*1024*1024);
        const names=(await files.readdir(directory)).filter(name=>/^page-\d+\.jpg$/i.test(name));
        // Poppler pads page numbers according to page count; discover those exact names before validating.
        const byPage=new Map(names.map(name=>[Number(name.match(/\d+/)?.[0]),path.join(directory,name)]));
        const outputs=selected.map(page=>byPage.get(page)).filter((item)=>typeof item==='string');
        if (outputs.length!==selected.length) throw new Error('PDF rasterizer omitted requested pages');
        if (request.args.zip===true) {
            const zip=path.join(directory,`${safeOutputName(downloaded.originalFileName?path.parse(downloaded.originalFileName).name:'documento','zip')||'documento.zip'}`);
            await writeZip(outputs.map(file=>({path:file,name:path.basename(file)})),zip,{signal,fs:files,maxBytes:maxOutputBytes});
            await assertOutput(directory,zip); if (!isZip(await files.readFile(zip))) throw new Error('ZIP output signature invalid');
            return mediaReply(directory,zip,'application/zip','Listo, aquí están las imágenes en un ZIP.');
        }
        let totalBytes=0;
        for (const output of outputs) {
            const stat=await assertOutput(directory,output); totalBytes+=stat.size;
            if(totalBytes>maxOutputBytes)throw new Error('PDF raster output exceeds its size limit');
            const signature=await files.readFile(output);
            if (signature[0]!==255||signature[1]!==216||signature[2]!==255) throw new Error('PDF rasterizer returned invalid image');
        }
        await retainOutputs(directory,outputs);
        return {parts:[{type:'text',text:`Extraje ${outputs.length} imágenes.`},...outputs.map(ref=>({type:'image',ref,mime:'image/jpeg'}))]};
    }
    /** @param {string} directory @param {DocumentSource|undefined} source @param {AbortSignal} signal @param {string} [prefix] */
    async function requirePdf(directory,source,signal,prefix='input') {
        if (!source) throw new Error('PDF source is missing');
        const value=await localize(source,directory,signal,prefix);
        if (value.extension!=='pdf'||value.mime!=='application/pdf'||!isPdf(value.downloaded.buffer)) throw new Error('A real PDF file is required');
        return value;
    }
    /** @param {DocumentSource} source @param {{signal:AbortSignal}} options */
    async function readContent(source,{signal}) {
        const attachment=source?.attachment;
        if (!attachment) return contentReader.readContent(source,{signal});
        const mime=String(attachment.mime||'').split(';')[0].trim().toLowerCase();
        const extension=path.extname(String(attachment.ref||'').split(/[?#]/,1)[0]).slice(1).toLowerCase();
        const image=mime.startsWith('image/')||['jpg','jpeg','png','webp','gif','tif','tiff','bmp'].includes(extension);
        const normalized=image&&attachment.kind!=='image'?{...source,attachment:{...attachment,kind:'image'}}:source;
        return contentReader.readContent(normalized,{signal});
    }
    /** Release a retained local output after a delivery adapter confirms it consumed the ref. @param {string} ref */
    async function release(ref) {
        const resolved=path.resolve(ref); const directory=path.dirname(resolved);
        if (path.dirname(directory)!==tempDirectory||!path.basename(directory).startsWith(PREFIX)||!leases.has(directory)) return false;
        await removeWorkspace(directory); return true;
    }
    /** Remove expired retained output leases and old workspaces left by interrupted requests. */
    async function cleanupExpired() {
        await ensureRoot(); const now=clock.now(); let removed=0;
        for (const name of await files.readdir(tempDirectory)) {
            if (!name.startsWith(PREFIX)||name.includes(path.sep)) continue;
            const dir=path.join(tempDirectory,name);
            if (active.has(dir)) continue;
            try {
                const stat=await files.lstat(dir);
                if (!stat.isDirectory()||stat.isSymbolicLink()||path.dirname(path.resolve(dir))!==tempDirectory) continue;
                const expiry=leases.get(dir);
                if (expiry!==undefined?expiry>now:now-stat.mtimeMs<outputTtlMs) continue;
                await removeWorkspace(dir); removed++;
            } catch(error) { try { onCleanupError(error); } catch {} }
        }
        return removed;
    }
    /** @param {string} directory */
    async function cleanupWorkspace(directory) {
        try { await removeWorkspace(directory); return undefined; }
        catch(error) { try { onCleanupError(error); } catch {} return error; }
    }

    return { process,readContent,cleanupExpired,release };
}

/** @param {unknown} value */
function safeExtension(value) { const result=String(value||'').replace(/^\./,'').toLowerCase(); if (!/^[a-z0-9]{1,8}$/.test(result)) throw new TypeError('Invalid media extension'); return result; }
/** @param {Downloaded} media */
function detectExtension(media) {
    let ext=safeExtension(media.extension);
    const name=typeof media.originalFileName==='string'?path.extname(path.basename(media.originalFileName)).slice(1).toLowerCase():'';
    if (['bin',''].includes(ext)&&name) ext=safeExtension(name);
    const mime=sniffMime(media.buffer);
    if (mime==='application/pdf') ext='pdf';
    else if (mime==='image/png') ext='png'; else if (mime==='image/jpeg') ext='jpg'; else if (mime==='image/webp') ext='webp'; else if (mime==='image/gif') ext='gif';
    return ext;
}
/** @param {Buffer} buffer */
function sniffMime(buffer) {
    if (buffer.subarray(0,5).toString('ascii')==='%PDF-') return 'application/pdf';
    if (buffer.length>=24&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
    if (buffer.length>=3&&buffer[0]===255&&buffer[1]===216&&buffer[2]===255) return 'image/jpeg';
    if (buffer.length>=12&&buffer.subarray(0,4).toString('ascii')==='RIFF'&&buffer.subarray(8,12).toString('ascii')==='WEBP') return 'image/webp';
    if (/^GIF8[79]a$/.test(buffer.subarray(0,6).toString('ascii'))) return 'image/gif';
    if (buffer.length>=4&&buffer[0]===80&&buffer[1]===75&&[3,5,7].includes(buffer[2])&&[4,6,8].includes(buffer[3])) return 'application/zip';
    if (buffer.subarray(0,8).equals(Buffer.from([208,207,17,224,161,177,26,225]))) return 'application/x-ole-storage';
    if (buffer.length>=12&&buffer.subarray(4,8).toString('ascii')==='ftyp') return 'video/mp4';
    return null;
}
/** @param {string} extension @param {string} fallback */
function mimeFor(extension,fallback) { const mimes=/** @type {Record<string,string>} */(EXTENSION_MIME); return mimes[extension]||fallback.toLowerCase().split(';')[0]||'application/octet-stream'; }
/** @param {Buffer} buffer */
function isPdf(buffer) { return buffer.subarray(0,5).toString('ascii')==='%PDF-'; }
/** @param {string} extension @param {string} mime */
function isImageFormat(extension,mime) { return mime.startsWith('image/')||['jpg','jpeg','png','webp','gif','tif','tiff','bmp'].includes(extension); }
/** @param {Buffer} buffer */
function isZip(buffer) { return buffer.length>=4&&buffer[0]===80&&buffer[1]===75; }
/** @param {unknown} value */
function safeName(value) { if (typeof value!=='string') return ''; return path.basename(value).replace(/[\u0000-\u001f]/g,'').slice(0,100); }
/** @param {unknown} value @param {string} extension */
function safeOutputName(value,extension) { const base=safeName(value); const stem=path.parse(base).name.replace(/[^a-zA-Z0-9._-]+/g,'_').replace(/^\.+/,'').slice(0,80); return stem?`${stem}.${safeExtension(extension)}`:undefined; }
/** @param {typeof fsPromises} files @param {string} source @param {string} target */
async function renameOutput(files,source,target) { await files.rename(source,target); await files.chmod(target,0o600); }
/** @param {unknown} value @param {string} fallback */
function stringArg(value,fallback) { return typeof value==='string'?value.trim().toLowerCase()||fallback:fallback; }
/** @param {unknown} value @param {number} fallback */
function numberArg(value,fallback) { const parsed=Number(value===undefined?fallback:value); if (!Number.isFinite(parsed)) throw new TypeError('Invalid numeric option'); return parsed; }
/** @param {unknown} value @returns {number|undefined} */
function parseBitrate(value) { const match=String(value).trim().match(/^(\d+(?:\.\d+)?)\s*([km])?(?:b(?:ps|\/s)?)?$/i); if (!match) return undefined; const bits=Number(match[1])*({k:1000,m:1000000}[String(match[2]||'').toLowerCase()]||1); return Number.isSafeInteger(bits)&&bits>0?bits:undefined; }
/** @param {unknown} value @returns {string|undefined} */
function parseTime(value) { if (value===undefined||value===null||value==='') return undefined; const text=String(value); return /^\d+$/.test(text)||/^\d+:\d{2}(?::\d{2})?$/.test(text)?text:undefined; }
/** @param {number} speed */
function audioTempoFilter(speed) { const factors=[]; while(speed>2){factors.push(2);speed/=2;} while(speed<0.5){factors.push(0.5);speed/=0.5;} factors.push(speed); return factors.map(value=>`atempo=${value}`).join(','); }
/** @param {unknown} value */
function safeHttpUrl(value) { if (typeof value!=='string') throw new TypeError('Invalid URL'); let url; try { url=new URL(value); } catch { throw new TypeError('Invalid URL'); } if (!['http:','https:'].includes(url.protocol)||url.username||url.password) throw new TypeError('Invalid URL'); return url; }
/** @param {string} raw @param {number} total */
function normalizePages(raw,total) {
    let value=raw.trim().toLowerCase(); if (value==='ultima') value=String(total);
    if (!value||!value.split(',').every(part=>/^\d+(?:-\d*)?$/.test(part))) throw new TypeError('Invalid PDF page selection');
    const normalized=[];
    for (const part of value.split(',')) {
        if (part.endsWith('-')) { const start=Number(part.slice(0,-1)); if (start<1||start>total) throw new RangeError('PDF page selection outside document'); normalized.push(`${start}-${total}`); }
        else if (part.includes('-')) { let [start,end]=part.split('-').map(Number); if (start>end)[start,end]=[end,start]; if (start>total) throw new RangeError('PDF page selection outside document'); start=Math.max(1,start); end=Math.min(end,total); normalized.push(start===end?String(start):`${start}-${end}`); }
        else { const page=Number(part); if (page<1||page>total) throw new RangeError('PDF page selection outside document'); normalized.push(String(page)); }
    }
    return normalized.join(',');
}
class PageSelectionError extends Error {
    /** @param {'required'|'format'|'positive'|'range'} reason @param {number} totalPages */
    constructor(reason,totalPages) { super('Invalid PDF page selection'); this.name='PageSelectionError'; this.code='INVALID_PDF_PAGES'; this.reason=reason; this.totalPages=totalPages; }
}
/** @param {string} value @param {number} total */
function expandPages(value,total) { /** @type {number[]} */ const output=[]; for(const part of value.split(',')){ if(part.includes('-')){const [start,endRaw]=part.split('-'); const end=endRaw?Number(endRaw):total; for(let page=Number(start);page<=end;page++)output.push(page);} else output.push(Number(part)); } return output; }
/** @param {number[]} pages @returns {Array<[number,number]>} */
function toRanges(pages) { const ranges=/** @type {Array<[number,number]>} */([]); for(const page of pages){const last=/** @type {[number,number]|undefined} */(ranges.at(-1));if(last&&page===last[1]+1)last[1]=page;else ranges.push(/** @type {[number,number]} */([page,page]));}return ranges; }
/** @param {unknown} value */
function asText(value) { return typeof value==='string'?value:Buffer.isBuffer(value)?value.toString('utf8'):''; }
/** @param {unknown} error */
function isAborted(error) { return Boolean(error&&typeof error==='object'&&/** @type {{name?:string}} */(error).name==='AbortError'); }

module.exports={createDocumentsMedia,createExecFileRunner,safeExtension,sniffMime,normalizePages,expandPages,toRanges,parseBitrate,parseTime,audioTempoFilter,
    DOCUMENT_FORMATS,TEXT_EXTENSIONS,DEFAULT_MAX_INPUT_BYTES,DEFAULT_MAX_OUTPUT_BYTES,DEFAULT_OUTPUT_TTL_MS,DEFAULT_MAX_PDF_PAGES,PROCESS_OPERATIONS,MAX_COLLECTION_BYTES};
