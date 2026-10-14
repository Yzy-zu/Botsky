'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {createUrlDownload}=require('../../../../src/v2/adapters/media/urlDownload');
const {createWebContent}=require('../../../../src/v2/adapters/media/webContent');
const {AppError}=require('../../../../src/v2/domain/errors');
const {FakeClock}=require('../../../../src/v2/platform/clock');

function response(statusCode,headers={},body='') { return {statusCode,headers,stream:Readable.from([Buffer.isBuffer(body)?body:Buffer.from(body)])}; }
function fixture({resolve,transport,maxBytes=1024,allowedContentTypes=['text/html','application/xhtml+xml']}={}) {
    const requests=[];
    const urls=createUrlDownload({
        maxBytes,timeoutMs:500,allowedContentTypes,clock:new FakeClock(),
        resolve:resolve||(async host=>[{address:host==='next.public.test'?'1.1.1.1':'8.8.8.8',family:4}]),
        transport:async request=>{requests.push(request);return transport?transport(request,requests.length):response(200,{'content-type':'text/html; charset=utf-8'},'<p>Hello</p>');}
    });
    return {reader:createWebContent({downloadUrl:urls.download,maxBytes}),requests};
}
const signal=()=>new AbortController().signal;

test('reads bounded HTML as sanitized text without fetching embedded resources',async()=>{
    const html='<!doctype html><title>Title</title><h1>Hola &amp; mundo</h1><script>secret()</script><style>.hidden{}</style><img src="http://127.0.0.1/pixel"><a href="https://tracker.invalid/x">Texto</a>';
    const h=fixture({transport:async()=>response(200,{'content-type':'text/html'},html)});
    assert.equal(await h.reader.read('https://public.test/article',{signal:signal()}),'Title Hola & mundo\nTexto');
    assert.equal(h.requests.length,1);
    assert.equal(h.requests[0].address,'8.8.8.8');
});

test('supports XHTML and bounded plain text only when the downloader permits those content types',async()=>{
    const xhtml=fixture({transport:async()=>response(200,{'content-type':'application/xhtml+xml'},'<p>XHTML</p>')});
    assert.equal(await xhtml.reader.read('https://public.test/page',{signal:signal()}),'XHTML');
    const plain=fixture({transport:async()=>response(200,{'content-type':'text/plain'},'simple page')});
    assert.equal(await plain.reader.read('https://public.test/page.txt',{signal:signal()}),'simple page');
    const defaultList=createUrlDownload({resolve:async()=>[{address:'8.8.8.8',family:4}],transport:async()=>response(200,{'content-type':'text/html'},'<p>no</p>')});
    await assert.rejects(defaultList.download('https://public.test/page'),/Unsupported/);
});

test('retains private-address denial and revalidates redirect destinations',async()=>{
    const privateHost=fixture({resolve:async()=>[{address:'127.0.0.1',family:4}]});
    await assert.rejects(privateHost.reader.read('https://public.test/page',{signal:signal()}),error=>error instanceof AppError&&error.kind==='unsupported_media');
    assert.equal(privateHost.requests.length,0);
    const redirect=fixture({transport:async(_request,call)=>call===1?response(302,{location:'http://10.0.0.4/private'}):response(200,{'content-type':'text/html'},'<p>no</p>')});
    await assert.rejects(redirect.reader.read('https://public.test/start',{signal:signal()}),error=>error instanceof AppError&&error.kind==='unsupported_media');
    assert.equal(redirect.requests.length,1);
});

test('rejects oversized pages, unexpected mime, malformed UTF-8 and unsafe URL forms',async()=>{
    const oversized=fixture({maxBytes:16,transport:async()=>response(200,{'content-type':'text/html'},'x'.repeat(17))});
    await assert.rejects(oversized.reader.read('https://public.test/page',{signal:signal()}),error=>error instanceof AppError&&error.kind==='too_large');
    const binary=fixture({transport:async()=>response(200,{'content-type':'image/png'},'x')});
    await assert.rejects(binary.reader.read('https://public.test/page',{signal:signal()}),error=>error instanceof AppError&&error.kind==='unsupported_media');
    const malformed=fixture({transport:async()=>response(200,{'content-type':'text/html'},Buffer.from([0xff]))});
    await assert.rejects(malformed.reader.read('https://public.test/page',{signal:signal()}),error=>error instanceof AppError&&error.kind==='bad_output');
    const h=fixture();
    for(const url of ['file:///etc/passwd','https://user:pass@public.test/a'])await assert.rejects(h.reader.read(url,{signal:signal()}),error=>error instanceof AppError&&error.kind==='unsupported_media');
    assert.equal(h.requests.length,0);
});
