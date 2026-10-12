'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const {createLogger}=require('../../../src/v2/platform/logger');
test('JSON logger excludes user content, JIDs, secrets, error cause and throwing getters', () => {
    const lines=[];const logger=createLogger({clock:{now:()=>42},write:l=>lines.push(l),secrets:['secret-example'],allowedEvents:['pipeline.done']});
    const error=new Error('secret-example 55555555555@s.whatsapp.net'); error.cause={text:'private content'};
    const fields={latencyMs:12,ok:true,text:'private content',userJid:'55555555555@s.whatsapp.net',error,arbitrary:'secret-example'};
    Object.defineProperty(fields,'getter',{enumerable:true,get(){throw Error('must not run');}});
    logger.info('pipeline.done',fields);logger.error('private content',error);
    const parsed=JSON.parse(lines[0]);assert.equal(parsed.timestamp,42);assert.equal(parsed.event,'pipeline.done');assert.equal(parsed.fields.latencyMs,12);
    assert.equal(JSON.parse(lines[1]).event,'redacted');assert.ok(!lines.join('').includes('private content'));assert.ok(!lines.join('').includes('55555555555'));assert.ok(!lines.join('').includes('secret-example'));
});
test('cycles are bounded and failed sink does not fail business operation',()=>{
    const lines=[];const logger=createLogger({clock:{now:()=>0},write:l=>lines.push(l)});const fields={};fields.self=fields;logger.warn('unknown',fields);
    assert.match(lines[0],/CIRCULAR/);assert.doesNotThrow(()=>createLogger({clock:{now:()=>0},write(){throw Error('sink');}}).info('unknown'));
});
test('configured secrets remain redacted inside valid JSON and allowlisted field keys',()=>{
    const lines=[];const logger=createLogger({clock:{now:()=>1},write:l=>lines.push(l),secrets:['done'],allowedEvents:['pipeline.done'],allowedFields:['count']});
    logger.info('pipeline.done',{count:1,untrustedKey:'anything'});const parsed=JSON.parse(lines[0]);assert.equal(parsed.event,'pipeline.[REDACTED]');assert.deepEqual(parsed.fields,{count:1});
});
test('closed decision labels and trusted UUID correlation survive while arbitrary values redact',()=>{
    const lines=[];const allowedValues={reason:['not-addressed','mention'],feature:['help'],via:['explicit','llm'],outcome:['ok','ignored']};
    const logger=createLogger({clock:{now:()=>0},write:l=>lines.push(l),allowedEvents:['pipeline.decision'],allowedValues});
    allowedValues.feature.push('malicious mutated vocabulary');
    logger.info('pipeline.decision',{reason:'not-addressed',feature:'help',via:'llm',outcome:'ignored',correlationId:'12345678-1234-4123-8123-123456789abc'});
    const good=JSON.parse(lines[0]);assert.equal(good.fields.feature,'help');assert.equal(good.fields.reason,'not-addressed');assert.equal(good.fields.via,'llm');assert.equal(good.fields.correlationId,'12345678-1234-4123-8123-123456789abc');
    logger.info('pipeline.decision',{reason:'personal user text',feature:'malicious mutated vocabulary',correlationId:'123456789@s.whatsapp.net'});
    const bad=JSON.parse(lines[1]);assert.equal(bad.fields.reason,'[REDACTED]');assert.equal(bad.fields.feature,'[REDACTED]');assert.equal(bad.fields.correlationId,'[REDACTED]');
});
