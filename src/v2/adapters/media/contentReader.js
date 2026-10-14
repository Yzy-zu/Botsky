// @ts-check
'use strict';

const fsPromises=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {TextDecoder}=require('node:util');
const {AppError}=require('../../domain/errors');
const {normalizeJid}=require('../../domain/jid');

const MAX_INLINE_BYTES=12*1024*1024;
const MAX_TEXT_CHARACTERS=100_000;
const MAX_PDF_PAGES=1000;
const MAX_COMMAND_OUTPUT=2*1024*1024;
const PDFINFO_TIMEOUT_MS=15_000;
const PDFTEXT_TIMEOUT_MS=30_000;
const OFFICE_TIMEOUT_MS=45_000;
const OFFICE_EXTENSIONS=Object.freeze(['docx','xlsx','pptx','odt','ods','odp','doc','xls','ppt']);
const TEXT_EXTENSIONS=Object.freeze(['txt','md','csv','json','log','text','html','htm']);
const OFFICE_MIMES=Object.freeze({
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'xlsx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation':'pptx',
    'application/vnd.oasis.opendocument.text':'odt','application/vnd.oasis.opendocument.spreadsheet':'ods',
    'application/vnd.oasis.opendocument.presentation':'odp','application/msword':'doc',
    'application/vnd.ms-excel':'xls','application/vnd.ms-powerpoint':'ppt'
});
const OFFICE_BY_MIME=/** @type {Readonly<Record<string,string>>} */(OFFICE_MIMES);

/** @typedef {{attachment:Omit<import('../../pipeline/contracts').Attachment,'kind'>&{kind?:string,chatId?:string},raw:object}} ReaderSource */
/** @typedef {{buffer:Buffer,extension:string,mime?:string,originalFileName?:string|null}} DownloadedContent */
/** @typedef {{inlineData:{mimeType:'application/pdf'|'image/jpeg'|'image/png'|'image/webp',data:string},attachmentId:string,pageCount?:number,text?:string|null}} PreparedContent */
/** @typedef {{downloadMedia:(source:ReaderSource,options:{maxBytes:number,signal:AbortSignal})=>Promise<DownloadedContent>,run:(command:string,args:string[],options:{timeoutMs:number,signal:AbortSignal,maxBuffer:number})=>Promise<{stdout?:string|Buffer,stderr?:string|Buffer}>,ocr?:(inputPath:string,options:{mime:string,language:'spa+eng',signal:AbortSignal})=>Promise<string|null|undefined>,tempDirectory:string,files?:typeof fsPromises,maxInputBytes?:number,maxTextCharacters?:number,maxPdfPages?:number,onCleanupError?:(error:unknown)=>void}} ContentReaderOptions */

/**
 * Bounded document-to-text adapter. It accepts only injected media, process, file and OCR ports.
 * @param {ContentReaderOptions} options
 */
function createContentReader({downloadMedia,run,ocr,tempDirectory,files=fsPromises,maxInputBytes=MAX_INLINE_BYTES,maxTextCharacters=MAX_TEXT_CHARACTERS,maxPdfPages=MAX_PDF_PAGES,onCleanupError=()=>{}}) {
    if(typeof downloadMedia!=='function'||typeof run!=='function')throw new TypeError('Content reader download and process ports are required');
    if(!path.isAbsolute(tempDirectory)||path.resolve(tempDirectory)!==tempDirectory)throw new TypeError('Content reader temp directory must be absolute');
    if(![maxInputBytes,maxTextCharacters,maxPdfPages].every(Number.isSafeInteger)||maxInputBytes<1||maxInputBytes>MAX_INLINE_BYTES||maxTextCharacters<1||maxTextCharacters>MAX_TEXT_CHARACTERS||maxPdfPages<1||maxPdfPages>MAX_PDF_PAGES)throw new RangeError('Invalid content reader bounds');

    /** @param {ReaderSource} source @param {{signal:AbortSignal}} request @returns {Promise<string|null>} */
    async function readContent(source,{signal}) { return /** @type {Promise<string|null>} */(processContent(source,signal,false)); }
    /** Prepares verified PDFs/images as bounded provider-native inline data. @param {ReaderSource} source @param {{signal:AbortSignal}} request @returns {Promise<PreparedContent>} */
    async function prepareContent(source,{signal}) {
        signal.throwIfAborted();
        validateSourceIdentity(source);
        return /** @type {Promise<PreparedContent>} */(processContent(source,signal,true));
    }
    /** @param {ReaderSource} source @param {AbortSignal} signal @param {boolean} native */
    async function processContent(source,signal,native) {
        signal.throwIfAborted();
        if(!source?.attachment||typeof source.attachment.ref!=='string'||!source.attachment.ref)throw new AppError('bad_output');
        const sourceMime=String(source.attachment.mime||'').split(';')[0].trim().toLowerCase();
        const sourceExtension=path.extname(source.attachment.ref.split(/[?#]/,1)[0]).slice(1).toLowerCase();
        const inferredKind=sourceMime.startsWith('image/')||['jpg','jpeg','png','webp','gif','tif','tiff','bmp'].includes(sourceExtension)?'image':'document';
        if(!['image','document'].includes(source.attachment.kind||inferredKind))throw new AppError('unsupported_media');
        const declaredSize=declaredAttachmentSize(source.raw,source.attachment);
        if(declaredSize!==undefined&&declaredSize>BigInt(maxInputBytes))throw new AppError('too_large',{reason:'media_too_large'});
        /** @type {string|undefined} */ let workspace;
        let readSucceeded=false;
        try {
            let downloaded;
            try{downloaded=await downloadMedia(source,{maxBytes:maxInputBytes,signal});}
            catch(error){if(signal.aborted)signal.throwIfAborted();throw mapDownloadFailure(error);}
            signal.throwIfAborted();
            if(!downloaded||!Buffer.isBuffer(downloaded.buffer))throw new AppError('bad_output');
            if(downloaded.buffer.length===0)return null;
            if(downloaded.buffer.length>maxInputBytes)throw new AppError('too_large',{reason:'media_too_large'});
            const buffer=downloaded.buffer;
            const fileName=path.basename(String(downloaded.originalFileName||''));
            let extension=path.extname(fileName).slice(1).toLowerCase()||String(downloaded.extension||'').replace(/^\./,'').toLowerCase();
            const declaredMime=String(downloaded.mime||source.attachment.mime||'').split(';')[0].trim().toLowerCase();
            const signature=sniffMime(buffer);
            if(signature==='application/pdf')extension='pdf';
            if(OFFICE_BY_MIME[declaredMime]&&!extension)extension=OFFICE_BY_MIME[declaredMime];

            const officeExtension=signature==='application/pdf'?undefined:OFFICE_EXTENSIONS.includes(extension)?extension:OFFICE_BY_MIME[declaredMime];
            if(officeExtension) {
                const legacy=['doc','xls','ppt'].includes(officeExtension);
                if(signature!==(legacy?'application/x-ole-storage':'application/zip'))throw new AppError('bad_output');
                workspace=await createWorkspace();
                const input=path.join(workspace,`input.${officeExtension}`);
                await writePrivate(input,buffer);
                const pdf=await officeToPdf(input,officeExtension,workspace,signal);
                const pdfResult=await readPdf(pdf,signal,!native);
                if(native) { const prepared=await readNativePdf(pdf,source.attachment.id,pdfResult,signal);readSucceeded=true;return prepared; }
                readSucceeded=true;return pdfResult.text;
            }
            if(signature==='application/pdf'||extension==='pdf'||declaredMime==='application/pdf') {
                if(signature!=='application/pdf')throw new AppError('bad_output');
                workspace=await createWorkspace();
                const input=path.join(workspace,'input.pdf');
                await writePrivate(input,buffer);
                const pdfResult=await readPdf(input,signal,!native);
                if(native) { const prepared=await readNativePdf(input,source.attachment.id,pdfResult,signal);readSucceeded=true;return prepared; }
                readSucceeded=true;return pdfResult.text;
            }
            const mime=signature||declaredMime;
            if(isImage(extension,mime)) {
                if(extension==='gif'||mime==='image/gif')throw new AppError('unsupported_media',{reason:'gif_requires_still_image'});
                validateImage(extension,mime,buffer);
                if(native) {
                    if(!['image/jpeg','image/png','image/webp'].includes(mime)||!source.attachment.id)throw new AppError('unsupported_media');
                    readSucceeded=true;
                    return {inlineData:{mimeType:/** @type {'image/jpeg'|'image/png'|'image/webp'} */(mime),data:buffer.toString('base64')},attachmentId:source.attachment.id};
                }
                if(!ocr)throw new AppError('unsupported_media');
                workspace=await createWorkspace();
                const input=path.join(workspace,`input.${safeExtension(extension)}`);
                await writePrivate(input,buffer);
                const result=await ocr(input,{mime,language:'spa+eng',signal});
                signal.throwIfAborted();
                const text=validateContentText(typeof result==='string'?result:'');readSucceeded=true;return text;
            }
            if(TEXT_EXTENSIONS.includes(extension)||mime.startsWith('text/')||mime==='application/json'||mime==='application/xhtml+xml') {
                if(native)throw new AppError('unsupported_media');
                const text=decodeText(buffer);
                const extracted=(extension==='html'||extension==='htm'||mime==='text/html'||mime==='application/xhtml+xml')?htmlToText(text):text;
                return validateContentText(extracted);
            }
            throw new AppError('unsupported_media');
        } catch(error) {
            if(signal.aborted)signal.throwIfAborted();
            if(error instanceof AppError)throw error;
            throw mapFailure(error);
        } finally {
            if(workspace) {
                try { await files.rm(workspace,{recursive:true,force:true}); }
                catch(error) { try { onCleanupError(error); } catch {} if(readSucceeded)throw new AppError('bad_output',{reason:'temp_cleanup_failed',cause:error}); }
            }
        }
    }

    async function createWorkspace() {
        try {
            await files.mkdir(tempDirectory,{recursive:true,mode:0o700});
            const rootStat=await files.lstat(tempDirectory);
            if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||await files.realpath(tempDirectory)!==tempDirectory)throw new AppError('unsupported_media');
            await files.chmod(tempDirectory,0o700);
            const directory=await files.mkdtemp(path.join(tempDirectory,'botsky-v2-reader-'));
            await files.chmod(directory,0o700);
            return directory;
        } catch(error) { if(error instanceof AppError)throw error; throw new AppError('bad_output',{reason:'temp_prepare_failed',cause:error}); }
    }
    /** @param {string} target @param {Buffer} buffer */
    async function writePrivate(target,buffer) { try{await files.writeFile(target,buffer,{flag:'wx',mode:0o600});await files.chmod(target,0o600);}catch(error){throw new AppError('bad_output',{reason:'temp_prepare_failed',cause:error});} }
    /** @param {string} input @param {string} extension @param {string} directory @param {AbortSignal} signal */
    async function officeToPdf(input,extension,directory,signal) {
        if(!OFFICE_EXTENSIONS.includes(extension))throw new AppError('unsupported_media');
        try {
            await run('libreoffice',[`-env:UserInstallation=${pathToFileURL(path.join(directory,'profile')).href}`,'--headless','--nologo','--nodefault','--nofirststartwizard','--convert-to','pdf','--outdir',directory,input],{timeoutMs:OFFICE_TIMEOUT_MS,signal,maxBuffer:MAX_COMMAND_OUTPUT});
            signal.throwIfAborted();
            const output=path.join(directory,`${path.parse(input).name}.pdf`);
            const stat=await files.lstat(output);
            if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maxInputBytes)throw new AppError(stat.size>maxInputBytes?'too_large':'bad_output');
            const pdf=await files.readFile(output);
            if(sniffMime(pdf)!=='application/pdf')throw new AppError('bad_output');
            return output;
        } catch(error) { if(signal.aborted)signal.throwIfAborted(); if(error instanceof AppError)throw error; throw mapFailure(error); }
    }
    /** @param {string} input @param {AbortSignal} signal */
    async function readPdf(input,signal,extractText=true) {
        try {
            const info=await run('pdfinfo',[input],{timeoutMs:PDFINFO_TIMEOUT_MS,signal,maxBuffer:256*1024});
            signal.throwIfAborted();
            const meta=asText(info.stdout);
            if(/^Encrypted:\s+yes/im.test(meta))throw new AppError('unsupported_media',{reason:'pdf_encrypted'});
            const pages=Number(meta.match(/^Pages:\s+(\d+)/im)?.[1]);
            if(Number.isSafeInteger(pages)&&pages===0)throw new AppError('bad_output',{reason:'pdf_no_pages'});
            if(!Number.isSafeInteger(pages)||pages<1)throw new AppError('bad_output',{reason:'pdf_corrupt'});
            if(pages>maxPdfPages)throw new AppError('too_large',{reason:'pdf_page_limit'});
            if(!extractText)return {text:null,pageCount:pages};
            const output=await run('pdftotext',['-layout',input,'-'],{timeoutMs:PDFTEXT_TIMEOUT_MS,signal,maxBuffer:MAX_COMMAND_OUTPUT});
            signal.throwIfAborted();
            return {text:validateContentText(asText(output.stdout)),pageCount:pages};
        } catch(error) { if(signal.aborted)signal.throwIfAborted(); if(error instanceof AppError)throw error; throw mapPdfFailure(error); }
    }
    /** @param {string} text */
    function validateContentText(text) { return validateText(text,maxTextCharacters); }
    /** @param {string} input @param {string} attachmentId @param {{text:string|null,pageCount:number}} result @param {AbortSignal} signal @returns {Promise<PreparedContent>} */
    async function readNativePdf(input,attachmentId,result,signal) {
        if(!attachmentId)throw new AppError('unsupported_media');
        const stat=await files.lstat(input);
        if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1||stat.size>maxInputBytes)throw new AppError(stat.size>maxInputBytes?'too_large':'bad_output');
        const buffer=await files.readFile(input);
        signal.throwIfAborted();
        if(sniffMime(buffer)!=='application/pdf')throw new AppError('bad_output');
        return {inlineData:{mimeType:'application/pdf',data:buffer.toString('base64')},attachmentId,pageCount:result.pageCount,text:result.text};
    }
    return {readContent,prepareContent};
}

/** @param {Buffer} buffer */
function sniffMime(buffer) {
    if(buffer.subarray(0,5).toString('ascii')==='%PDF-')return 'application/pdf';
    if(buffer.length>=8&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
    if(buffer.length>=3&&buffer[0]===255&&buffer[1]===216&&buffer[2]===255)return 'image/jpeg';
    if(buffer.length>=12&&buffer.subarray(0,4).toString('ascii')==='RIFF'&&buffer.subarray(8,12).toString('ascii')==='WEBP')return 'image/webp';
    if(/^GIF8[79]a$/.test(buffer.subarray(0,6).toString('ascii')))return 'image/gif';
    if(buffer.length>=2&&buffer.subarray(0,2).toString('ascii')==='BM')return 'image/bmp';
    if(buffer.length>=4&&((buffer[0]===0x49&&buffer[1]===0x49&&buffer[2]===0x2a&&buffer[3]===0)||(buffer[0]===0x4d&&buffer[1]===0x4d&&buffer[2]===0&&buffer[3]===0x2a)))return 'image/tiff';
    if(buffer.length>=4&&buffer[0]===80&&buffer[1]===75&&[3,5,7].includes(buffer[2])&&[4,6,8].includes(buffer[3]))return 'application/zip';
    if(buffer.subarray(0,8).equals(Buffer.from([208,207,17,224,161,177,26,225])))return 'application/x-ole-storage';
    return null;
}
/** Reject stale or cross-chat references before preparing provider-native media. @param {ReaderSource} source */
function validateSourceIdentity(source) {
    if(!source?.attachment||typeof source.attachment.id!=='string'||!source.attachment.id||
        typeof source.attachment.chatId!=='string'||!source.attachment.chatId||
        typeof source.attachment.ownerJid!=='string'||!source.attachment.ownerJid||!source.raw||typeof source.raw!=='object')throw new AppError('unsupported_media');
    const envelope=/** @type {Record<string,unknown>} */(source.raw);
    const data=record(envelope.data||envelope),key=record(data.key);
    if(normalizeJid(String(key.remoteJid||''))!==normalizeJid(source.attachment.chatId))throw new AppError('unsupported_media');
    const providerKey=source.attachment.providerKey;
    if(providerKey&&(providerKey.id!==source.attachment.id||normalizeJid(providerKey.remoteJid||'')!==normalizeJid(source.attachment.chatId)))throw new AppError('unsupported_media');

    if(key.id===source.attachment.id) {
        const group=normalizeJid(String(key.remoteJid||'')).endsWith('@g.us');
        const rawOwner=String(group?(key.participantAlt||key.participant||''):(key.remoteJidAlt||key.remoteJid||''));
        if(normalizeJid(rawOwner)!==normalizeJid(source.attachment.ownerJid))throw new AppError('unsupported_media');
        if(providerKey?.participant&&key.participant&&providerKey.participant!==key.participant)throw new AppError('unsupported_media');
        return;
    }

    if(typeof key.id!=='string'||!key.id)throw new AppError('unsupported_media');
    const message=unwrapMessage(record(data.message));
    const contexts=[record(message.messageContextInfo),record(data.contextInfo),...Object.values(message).map(value=>record(record(value).contextInfo))];
    const quote=contexts.find(context=>context.stanzaId===source.attachment.id&&context.quotedMessage);
    if(!quote||normalizeJid(String(quote.participant||''))!==normalizeJid(source.attachment.ownerJid))throw new AppError('unsupported_media');
    if(providerKey?.participant&&providerKey.participant!==quote.participant)throw new AppError('unsupported_media');
}
/** @param {unknown} value @returns {Record<string,unknown>} */
function record(value) { return value&&typeof value==='object'&&!Array.isArray(value)?/** @type {Record<string,unknown>} */(value):{}; }
/** @param {Record<string,unknown>} input */
function unwrapMessage(input) {
    let value=input;
    for(let i=0;i<8;i++) {
        const wrapper=record(value.ephemeralMessage||value.viewOnceMessage||value.viewOnceMessageV2||value.viewOnceMessageV2Extension||value.documentWithCaptionMessage);
        if(!wrapper.message)break;
        value=record(wrapper.message);
    }
    return value;
}
/** @param {Buffer} buffer */
function decodeText(buffer) {
    let text;
    try { text=new TextDecoder('utf-8',{fatal:true}).decode(buffer); } catch { throw new AppError('bad_output'); }
    if(/[\x00-\x08\x0E-\x1F]/.test(text))throw new AppError('bad_output');
    return text;
}
/** @param {string} html */
function htmlToText(html) {
    return html.replace(/<!--[\s\S]*?-->/g,' ').replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ')
        .replace(/<(?:br|hr)\b[^>]*>/gi,'\n').replace(/<\/(?:p|div|li|tr|h[1-6]|section|article|table|ul|ol)\s*>/gi,'\n')
        .replace(/<[^>]*>/g,' ').replace(/&(#(?:x[\da-f]+|\d+)|amp|lt|gt|quot|apos|nbsp);/gi,(_match,entity)=>decodeEntity(entity))
        .replace(/[\t\r ]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
/** @param {string} entity */
function decodeEntity(entity) {
    const named=/** @type {Record<string,string>} */({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '});
    if(entity[0]!=='#')return named[entity.toLowerCase()]||'';
    const hex=entity[1]?.toLowerCase()==='x';
    const code=Number.parseInt(entity.slice(hex?2:1),hex?16:10);
    try { return Number.isFinite(code)&&code>=0&&code<=0x10ffff?String.fromCodePoint(code):''; } catch { return ''; }
}
/** @param {string} text @param {number} maxCharacters */
function validateText(text,maxCharacters=MAX_TEXT_CHARACTERS) {
    if(text.length>maxCharacters)throw new AppError('too_large');
    if(/[\x00-\x08\x0E-\x1F]/.test(text))throw new AppError('bad_output');
    const trimmed=text.trim();
    return trimmed||null;
}
/** @param {string} extension @param {string} mime */
function isImage(extension,mime) { return mime.startsWith('image/')||['jpg','jpeg','png','webp','gif','tif','tiff','bmp'].includes(extension); }
/** @param {string} extension @param {string} mime @param {Buffer} buffer */
function validateImage(extension,mime,buffer) {
    const actual=sniffMime(buffer);
    if(extension==='gif'||mime==='image/gif'||!actual||!actual.startsWith('image/'))throw new AppError('unsupported_media');
    if(mime.startsWith('image/')&&actual!==mime)throw new AppError('bad_output');
}
/** @param {string} extension */
function safeExtension(extension) { return /^[a-z0-9]{1,8}$/.test(extension)?extension:'bin'; }
/** @param {unknown} value */
function asText(value) { return typeof value==='string'?value:Buffer.isBuffer(value)?value.toString('utf8'):''; }
/** @param {unknown} error */
function mapFailure(error) {
    const item=/** @type {{name?:string,code?:string,killed?:boolean,message?:string}} */(error||{});
    if(item.code==='MEDIA_TOO_LARGE'||/maxContentLength|larger than|max.*size.*exceed/i.test(String(item.message||'')))return new AppError('too_large',{cause:error});
    if(item.name==='TimeoutError'||item.code==='ETIMEDOUT'||item.killed)return new AppError('timeout',{cause:error});
    if(item.code==='ENOENT')return new AppError('unsupported_media',{cause:error});
    return new AppError('bad_output',{cause:error});
}

/** @param {unknown} error */
function mapDownloadFailure(error) {
    if(error instanceof AppError)return error;
    const value=/** @type {{code?:unknown,message?:unknown}} */(error&&typeof error==='object'?error:{});
    if(value.code==='MEDIA_TOO_LARGE')return new AppError('too_large',{cause:error,reason:'media_too_large'});
    if(value.code==='MEDIA_UNAVAILABLE')return new AppError('network',{cause:error,reason:'media_unavailable'});
    return new AppError('network',{cause:error,reason:'media_download_failed'});
}

/** @param {unknown} error */
function mapPdfFailure(error) {
    const item=/** @type {{code?:string,killed?:boolean,name?:string,message?:string}} */(error||{});
    if(item.code==='ENOENT')return new AppError('unsupported_media',{cause:error,reason:'pdf_reader_unavailable'});
    if(item.name==='TimeoutError'||item.code==='ETIMEDOUT'||item.killed)return new AppError('timeout',{cause:error,reason:'pdf_reader_timeout'});
    if(/password|encrypt/i.test(String(item.message||'')))return new AppError('unsupported_media',{cause:error,reason:'pdf_encrypted'});
    return new AppError('bad_output',{cause:error,reason:'pdf_corrupt'});
}

/** Read provider-declared image/document length only when raw identifies this attachment.
 * @param {object} raw @param {ReaderSource['attachment']} attachment @returns {bigint|undefined} */
function declaredAttachmentSize(raw,attachment) {
    /** @param {unknown} value */ const record=value=>value&&typeof value==='object'&&!Array.isArray(value)?/** @type {Record<string,unknown>} */(value):{};
    const envelope=record(raw),data=record(envelope.data||envelope),key=record(data.key);
    if(key.remoteJid!==attachment.chatId)return undefined;
    let message;
    if(key.id===attachment.id)message=record(data.message);
    else {
        const current=record(data.message);
        const contexts=[current.contextInfo,record(current.extendedTextMessage).contextInfo,record(current.imageMessage).contextInfo,record(current.documentMessage).contextInfo].map(record);
        const quote=contexts.find(context=>context.stanzaId===attachment.id&&context.quotedMessage&&
            (!attachment.ownerJid||!context.participant||context.participant===attachment.ownerJid));
        if(!quote)return undefined;
        message=record(quote.quotedMessage);
    }
    for(let depth=0;depth<8;depth++){
        const wrapper=record(message.ephemeralMessage||message.viewOnceMessage||message.viewOnceMessageV2||message.viewOnceMessageV2Extension||message.documentWithCaptionMessage);
        if(!wrapper.message)break;message=record(wrapper.message);
    }
    const payload=record(message.documentMessage||message.imageMessage),size=payload.fileLength;
    if(typeof size==='bigint')return size>=0n?size:undefined;
    if(typeof size==='number')return Number.isFinite(size)&&size>=0?BigInt(Math.trunc(size)):undefined;
    if(typeof size==='string'){
        // Metadata is a uint64. Any all-decimal value wider than uint64 is
        // malformed, but fail closed without constructing a huge BigInt.
        if(size.length>20)return /^\d+$/.test(size)?BigInt(MAX_INLINE_BYTES+1):undefined;
        if(/^\d+$/.test(size)){try{return BigInt(size);}catch{return undefined;}}
        return undefined;
    }
    if(!size||typeof size!=='object')return undefined;
    const value=record(size);
    if(Number.isInteger(value.low)&&Number.isInteger(value.high)){
        const lowNumber=/** @type {number} */(value.low),highNumber=/** @type {number} */(value.high);
        if(lowNumber< -0x80000000||lowNumber>0x7fffffff||highNumber< -0x80000000||highNumber>0x7fffffff)return undefined;
        if(value.unsigned===true){
            const low=BigInt(lowNumber>>>0),high=BigInt(highNumber>>>0);
            return (high<<32n)|low;
        }
        // Protobuf Longs commonly expose low as a signed int32 even when the
        // value is unsigned. With a nonnegative high word, preserve low's bits.
        if(highNumber<0)return undefined;
        return (BigInt(highNumber)<<32n)|BigInt(lowNumber>>>0);
    }
    if(typeof value.toNumber==='function'){
        try{const number=Reflect.apply(/** @type {(...args:unknown[])=>unknown} */(value.toNumber),size,[]);if(typeof number==='number'&&Number.isSafeInteger(number)&&number>=0)return BigInt(number);}catch{}
    }
    return undefined;
}

module.exports={createContentReader,sniffMime,htmlToText,MAX_INLINE_BYTES,MAX_TEXT_CHARACTERS,MAX_PDF_PAGES,declaredAttachmentSize,mapDownloadFailure};
