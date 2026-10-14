'use strict';
// Test-only VM harness: source code is read, but app modules are never imported.
// Each VM has its own synthetic configuration, clock and dependency allowlist.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function loadModule(relative, dependencies, { env = {}, now = Date.parse('2026-10-12T18:00:00Z') } = {}) {
    class Clock extends Date {
        constructor(value) { super(value === undefined ? now : value); }
        static now() { return now; }
    }
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src', relative), 'utf8'), {
        module, exports: module.exports, __dirname:path.dirname(path.join(__dirname,'../src',relative)),process: { env }, Date: Clock, Intl, Map, Set, Buffer,
        setTimeout: callback => { queueMicrotask(callback); return 0; }, clearTimeout() {},
        require(name) { if (!Object.hasOwn(dependencies, name)) throw Error('Unmocked dependency: ' + name); return dependencies[name]; }
    }, { filename: relative });
    return module.exports;
}
function harness({ env = { GEMINI_API_KEY: 'offline-gemini-key', GROQ_API_KEY: 'offline-groq-key' }, post, config = {}, now } = {}) {
    const calls = [], logs = [];
    const logger = Object.fromEntries(['info','warn','error','cmd'].map(name => [name, line => logs.push(line)]));
    const http = { post: post || (async () => { throw Error('Missing fake HTTP response'); }) };
    const style = loadModule('services/conversationStyle.js', { '../utils/whatsappText': { WHATSAPP_FORMAT_INSTRUCTIONS: 'Para WhatsApp usa tablas nativas fuera de bloques de código.' } });
    const failures = loadModule('services/aiFailure.js', {});
    const dependencies = {
        https: { Agent: class {} }, axios: { post: async (...args) => { calls.push(args); return http.post(...args); } },
        './logger': logger, './aiConfig': { getAiConfig: () => config }, './conversationStyle': style,
        './generationSettings': loadModule('services/generationSettings.js', {}),
        './semanticRouting': loadModule('services/semanticRouting.js', {}), './aiFailure': failures
    };
    return { ai: loadModule('services/ai.js', dependencies, { env, now }), calls, logs, logger, http, env, style, failures, now: now === undefined ? Date.parse('2026-10-12T18:00:00Z') : now };
}
function proactiveHarness({history=[],decision={should_act:false},now,env={ALLOWED_GROUPS_NORMAL:'offline@g.us',PROACTIVE_ENABLED:'true'}}={}) {
    const plans=[],sent=[],events=[];
    const db={db:{all:(_sql,done)=>done(null,[])},canSendProactiveMessage:async()=>true,recordProactiveMessage:async()=>{},getPersonalityState:async()=>({objective_until:Infinity,mood:'atento'}),updatePersonalityState:async()=>{},addSocialEvent:async(...args)=>events.push(args),getRecentSocialEvents:async()=>[]};
    const deps={'./logger':{info(){},warn(){},error(){}},'./evolution':{sendText:async(...args)=>sent.push(args),sendTyping:async()=>{}},'./history':{getHistory:()=>history,addMessage(){}},'./scheduler':{registerTask(){}},'./ai':{evaluateProactiveAction:async plan=>{plans.push(plan);return decision;}},'./db':db,'../commands/cooperacha':{maybeTriggerAutonomousCooperacha:async()=>({triggered:false})}};
    return{api:loadModule('services/proactive.js',deps,{env,now}),plans,sent,events};
}
const gemini = text => ({ data: { candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text }] } }] } });
const groq = text => ({ data: { choices: [{ finish_reason: 'stop', message: { content: text } }] } });
module.exports = { loadModule, harness, proactiveHarness, gemini, groq };
if (require.main === module) {
    const test = require('node:test'); const assert = require('node:assert/strict');
    test('Offline AI harness denies undeclared imports and uses only fake HTTP', async () => {
        const h = harness({ post: async () => gemini('fake answer') });
        assert.equal(await h.ai.callGemini({ userMessage: 'test' }), 'fake answer');
        assert.equal(h.calls.length, 1);
        assert.throws(() => loadModule('services/ai.js', {}), /Unmocked dependency/);
    });
}
