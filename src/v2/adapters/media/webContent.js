// @ts-check
'use strict';

const {TextDecoder}=require('node:util');
const {AppError}=require('../../domain/errors');
const {htmlToText}=require('./contentReader');

const DEFAULT_MAX_BYTES=1024*1024;
const MAX_ALLOWED_BYTES=4*1024*1024;
const DEFAULT_MAX_CHARACTERS=100_000;

/** @typedef {{buffer:Buffer,mime?:string,extension?:string}} WebPage */
/** @typedef {{downloadUrl:(url:string,signal:AbortSignal)=>Promise<WebPage>,maxBytes?:number,maxCharacters?:number}} WebContentOptions */

/**
 * Reads one bounded HTML or plain-text response through the injected guarded URL downloader.
 * The downloader must be constructed with maxBytes no greater than this adapter's maxBytes,
 * an explicit HTML/XHTML content-type opt-in, and its normal DNS pinning/redirect/deadline checks.
 * This adapter never follows links or fetches page resources.
 * @param {WebContentOptions} options
 */
function createWebContent({downloadUrl,maxBytes=DEFAULT_MAX_BYTES,maxCharacters=DEFAULT_MAX_CHARACTERS}) {
    if(typeof downloadUrl!=='function')throw new TypeError('Web content URL downloader required');
    if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>MAX_ALLOWED_BYTES)throw new RangeError('Invalid web content byte limit');
    if(!Number.isSafeInteger(maxCharacters)||maxCharacters<1||maxCharacters>DEFAULT_MAX_CHARACTERS)throw new RangeError('Invalid web content character limit');

    /** @param {string} input @param {{signal:AbortSignal}} request */
    async function read(input,{signal}) {
        signal.throwIfAborted();
        let url;
        try { url=new URL(input); } catch { throw new AppError('unsupported_media'); }
        if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new AppError('unsupported_media');
        let page;
        try { page=await downloadUrl(url.href,signal); }
        catch(error) { if(signal.aborted)signal.throwIfAborted(); throw mapFailure(error); }
        signal.throwIfAborted();
        if(!page||!Buffer.isBuffer(page.buffer)||page.buffer.length===0)throw new AppError('bad_output');
        if(page.buffer.length>maxBytes)throw new AppError('too_large');
        const mime=String(page.mime||'').split(';',1)[0].trim().toLowerCase();
        if(!['text/html','application/xhtml+xml','text/plain'].includes(mime))throw new AppError('unsupported_media');
        let source;
        try { source=new TextDecoder('utf-8',{fatal:true}).decode(page.buffer); }
        catch { throw new AppError('bad_output'); }
        const text=mime==='text/plain'?source:htmlToText(source);
        if(text.length>maxCharacters)throw new AppError('too_large');
        if(/[\x00-\x08\x0E-\x1F]/.test(text))throw new AppError('bad_output');
        return text.trim()||null;
    }
    return {read};
}

/** @param {unknown} error */
function mapFailure(error) {
    const item=/** @type {{name?:string,code?:string,message?:string,killed?:boolean}} */(error||{});
    if(item.name==='TimeoutError'||item.code==='ETIMEDOUT'||item.killed||/deadline/i.test(item.message||''))return new AppError('timeout',{cause:error});
    if(/byte limit|too large/i.test(item.message||''))return new AppError('too_large',{cause:error});
    if(/unsupported|non-public|private|credentials|redirect|HTTP\(S\)/i.test(item.message||''))return new AppError('unsupported_media',{cause:error});
    return new AppError('network',{cause:error});
}

module.exports={createWebContent,DEFAULT_MAX_BYTES,MAX_ALLOWED_BYTES,DEFAULT_MAX_CHARACTERS};
