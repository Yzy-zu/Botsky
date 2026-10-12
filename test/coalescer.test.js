'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const c=require('../src/core/coalescer');
const norm=(text, participant='a')=>({from:'g@g.us',participant,text,actualMessageType:'conversation',actualMessageData:{key:{id:text,remoteJid:'g@g.us',participant}}});
const flush=async fn=>{for(const key of [...c._pendingBuffers.keys()]) await c.flushSender(key,fn);};
test.afterEach(()=>c.clearAllBuffers());
test('El debounce no interpreta longitud, palabras, número ni puntuación',()=>{
    const wait=c.calculateAdaptiveDebounce('hola');for(const text of ['y','pero','la segunda','¡hola!','texto '.repeat(20)])assert.equal(c.calculateAdaptiveDebounce(text),wait);
    assert.equal(c.shouldBypassCoalescence(norm('el 2')),false);assert.equal(c.shouldBypassCoalescence({...norm('ayuda'),hasPrefix:true}),true);
});
test('Mensajes del mismo remitente se agrupan con saltos de línea sin perder el orden',async()=>{
    const out=[];const fn=async p=>out.push(p);for(const text of ['oye','resuelve esto','  código\n    sangrado'])await c.coalesceAndDispatch(norm(text),fn);await flush(fn);
    assert.equal(out.length,1);assert.equal(out[0].text,'oye\nresuelve esto\ncódigo\n    sangrado');
});
test('Remitentes diferentes conservan buffers separados',async()=>{
    const out=[];const fn=async p=>out.push(p);await c.coalesceAndDispatch(norm('hola','a'),fn);await c.coalesceAndDispatch(norm('otro','b'),fn);await flush(fn);assert.equal(out.length,2);
});
test('Comando explícito vacía el buffer y se ejecuta después de la conversación pendiente',async()=>{
    const out=[];const fn=async p=>out.push(p.text);await c.coalesceAndDispatch(norm('hola'),fn);await c.coalesceAndDispatch({...norm('ayuda'),hasPrefix:true},fn);assert.deepEqual(out,['hola','ayuda']);
});
test('Texto y archivo adyacentes quedan juntos; Gemini decide si el texto usa el archivo',async()=>{
    const out=[];const fn=async p=>out.push(p);const file={id:'file',source:'current',messageType:'documentMessage',messageData:{key:{id:'file'},message:{documentMessage:{mimetype:'application/pdf'}}}};
    await c.coalesceAndDispatch({...norm(''),attachment:file,actualMessageType:'documentMessage',actualMessageData:file.messageData},fn);await c.coalesceAndDispatch(norm('explícame DNS'),fn);await flush(fn);
    assert.equal(out.length,1);assert.equal(out[0].text,'explícame DNS');assert.equal(out[0].attachment.id,'file');assert.equal(out[0].messageData.key.id,'explícame DNS');
});
test('Archivos distintos mantienen sus identidades y no se sobrescriben al agrupar',async()=>{
    const out=[];const fn=async p=>out.push(p);for(const id of ['one','two']){const file={id,source:'current',messageType:'documentMessage',messageData:{key:{id},message:{documentMessage:{}}}};await c.coalesceAndDispatch({...norm(''),attachment:file,actualMessageType:'documentMessage',actualMessageData:file.messageData},fn);}await flush(fn);
    assert.deepEqual(out.map(p=>p.attachment.id),['one','two']);
});
