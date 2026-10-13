'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {createDb,inspectBackup}=require('../../../../src/v2/adapters/store/sqlite');
const {migrate}=require('../../../../src/v2/adapters/store/migrations');
const {legacyMigration}=require('../../../../src/v2/adapters/store/migrations/000-legacy');
const {threadConversationMigration}=require('../../../../src/v2/adapters/store/migrations/001-thread-conversation');
const {createThreadConversationRepo}=require('../../../../src/v2/adapters/store/repos/threadConversation');
function event(id, sender='a@s.whatsapp.net', chat='one@g.us', quoted) { return {id,chatId:chat,sender:{jid:sender},quoted:quoted?{messageId:quoted}:undefined}; }
async function setup(t) {
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'botsky-thread-'));
    const db=createDb({filename:path.join(directory,'test.db')});
    t.after(async()=>{await db.close();await fs.rm(directory,{recursive:true,force:true});});
    await db.open();
    const migrations=[await legacyMigration(),threadConversationMigration()];
    await migrate(db,{backupPath:path.join(directory,'backup.db'),migrations,clock:{now:()=>123}});
    return {db,directory,migrations,repo:createThreadConversationRepo(db,{now:()=>1000})};
}

test('thread migration is additive, tracked and idempotent with backup unchanged and no legacy fallback',async t=>{
    const {db,repo,directory,migrations}=await setup(t);
    const before=await fs.readFile(path.join(directory,'backup.db'));
    await db.run('INSERT INTO chat_history(chat_id,role,content,timestamp) VALUES(?,?,?,?)',['one@g.us','user','unknown legacy sender',1]);
    assert.deepEqual(await repo.recentThread('one@g.us','a@s.whatsapp.net'),[]);
    const second=await migrate(db,{backupPath:path.join(directory,'backup.db'),migrations});assert.deepEqual(second.applied,[]);assert.equal(second.backup,null);
    assert.deepEqual(await fs.readFile(path.join(directory,'backup.db')),before);
    assert.equal((await inspectBackup(path.join(directory,'backup.db'))).integrity,'ok');
    assert.deepEqual((await db.all('SELECT version FROM schema_migrations ORDER BY version')).map(x=>x.version),['000','001']);
    const indexes=await db.all("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='thread_history'");assert.ok(indexes.some(x=>x.name==='idx_thread_history_quote'));
    assert.equal((await db.get('SELECT count(*) AS n FROM chat_history')).n,1);
});

test('thread isolates users/chats, includes direct human quote and own assistant reply with durable metadata',async t=>{
    const {db,repo}=await setup(t);
    await repo.append(event('a1'),'user','own');
    await repo.append(event('b1','b@s.whatsapp.net'),'user','unrelated');
    await repo.append(event('b2','b@s.whatsapp.net','one@g.us','a1'),'user','human quote');
    await repo.append(event('reply-a'),'assistant','answer',{senderJid:'bot@s.whatsapp.net',replyTo:'a1'});
    await repo.append(event('reply-b','b@s.whatsapp.net'),'assistant','other answer',{senderJid:'bot@s.whatsapp.net',replyTo:'b1'});
    await repo.append(event('a1','a@s.whatsapp.net','two@g.us'),'user','different chat');
    const rows=await repo.recentThread('one@g.us','a@s.whatsapp.net');
    assert.deepEqual(rows.map(r=>r.content),['own','human quote','answer']);
    assert.equal(rows[1].senderJid,'b@s.whatsapp.net');assert.equal(rows[1].quotedMessageId,'a1');assert.equal(rows[2].senderJid,'bot@s.whatsapp.net');assert.equal(rows[2].timestamp,1000);
    assert.deepEqual((await repo.recentThread('one@g.us','a@s.whatsapp.net',undefined,2)).map(r=>r.content),['human quote','answer']);
    await db.close();await db.open();assert.deepEqual(await repo.recentThread('one@g.us','a@s.whatsapp.net'),rows);
    assert.deepEqual((await repo.recentThread('two@g.us','a@s.whatsapp.net')).map(r=>r.content),['different chat']);
});

test('explicit quoted ID includes a single same-chat human or assistant reference, never another owner history',async t=>{
    const {repo}=await setup(t);
    await repo.append(event('human','b@s.whatsapp.net'),'user','quoted human');
    await repo.append(event('other-assistant','b@s.whatsapp.net'),'assistant','private other reply');
    await repo.append(event('external','b@s.whatsapp.net','two@g.us'),'user','wrong chat');
    assert.deepEqual((await repo.recentThread('one@g.us','a@s.whatsapp.net','human')).map(r=>r.content),['quoted human']);
    assert.deepEqual((await repo.recentThread('one@g.us','a@s.whatsapp.net','other-assistant')).map(r=>r.content),['private other reply']);
    assert.deepEqual(await repo.recentThread('one@g.us','a@s.whatsapp.net','external'),[]);
    assert.deepEqual(await repo.recentThread('one@g.us','a@s.whatsapp.net','unknown'),[]);
});

test('retention is bounded independently per user instead of flat chat20; duplicate notifications do not rewrite',async t=>{
    const {db,repo}=await setup(t);
    await repo.append(event('anchor'),'user','keep quiet user');
    for(let n=0;n<105;n++) await repo.append(event('b'+n,'b@s.whatsapp.net'),'user','busy'+n);
    assert.equal((await db.get('SELECT count(*) AS n FROM thread_history')).n,101);
    assert.equal((await repo.recentThread('one@g.us','a@s.whatsapp.net'))[0].content,'keep quiet user');
    const busy=await repo.recentThread('one@g.us','b@s.whatsapp.net',undefined,100);assert.equal(busy.length,100);assert.equal(busy[0].content,'busy5');
    const first=await repo.append(event('dup'),'user','original');const second=await repo.append(event('dup'),'user','rewritten');assert.equal(first,second);
    assert.equal((await repo.recentThread('one@g.us','a@s.whatsapp.net')).at(-1).content,'original');
    await repo.append(event("quoted'OR'1=1",'b@s.whatsapp.net'),'user','SQL-safe');
    assert.equal((await repo.recentThread('one@g.us','a@s.whatsapp.net',"quoted'OR'1=1")).at(-1).content,'SQL-safe');
});

test('invalid metadata, author override, time, role/content/query reject without writes',async t=>{
    const {db,repo}=await setup(t);
    for(const ev of [null,{},event(''),event('id',''),event('id','a',''),event('id'.repeat(300)),event(' whitespace ')]) await assert.rejects(repo.append(ev,'user','text'),/Invalid thread/);
    for(const [role,content,options] of [['system','text',{}],['user',null,{}],['user','x'.repeat(65537),{}],['user','text',{senderJid:'other'}],['assistant','text',{replyTo:''}]]) await assert.rejects(repo.append(event('id'),role,content,options));
    for(const limit of [0,-1,101,NaN,1.5]) await assert.rejects(repo.recentThread('one@g.us','a',undefined,limit),/Invalid thread query/);
    await assert.rejects(repo.recentThread('','a'));await assert.rejects(repo.recentThread('one@g.us',''));await assert.rejects(repo.recentThread('one@g.us','a',''));
    await assert.rejects(createThreadConversationRepo(db,{now:()=>NaN}).append(event('id'),'user','text'));
    assert.equal((await db.get('SELECT count(*) AS n FROM thread_history')).n,0);
});
