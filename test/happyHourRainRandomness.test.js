'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function harness({inventory=['a','b','c'],send}={}){
 const calls=[],sent=[];const photos=inventory.map(id=>({id,path:'/synthetic/'+id+'.jpg'}));
 const module={exports:{}};const timer=()=>({unref(){}});
 const deps={'./db':{saveHappyHourState:async()=>{},resetHappyHourState:async()=>{},getHappyHourState:async()=>null},'./logger':{info(){},warn(){},error(){}},
  './evolution':{sendText:async()=>{},sendMedia:async(_group,file)=>{if(send)await send(file);sent.push(file);}},
  './rikolinoLibrary':{createRikolinoReader:()=>({getImages:async(_category,options)=>{
   calls.push(options);const excluded=new Set(options.excludePhotoIds);const unseen=photos.filter(p=>!excluded.has(p.id));
   return [...unseen,...photos.filter(p=>excluded.has(p.id))].slice(0,options.count);
  }})},'./packImages':{getPackImages:async()=>[]}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/services/happyHour.js'),'utf8'),{module,exports:module.exports,
  require:id=>{assert.ok(id in deps,id);return deps[id];},Math:Object.assign(Object.create(Math),{random:()=>0.75}),Date,Set,
  setTimeout:timer,setInterval:timer,clearTimeout(){},clearInterval(){}});
 return{hh:module.exports,calls,sent,photos};
}
const GROUP='19995559999@g.us';
async function start(h){await h.hh.startHappyHour({groupJid:GROUP,broadcast:false});}
test('rain uses unseen inventory before repeats, includes newly published photos, and does not repeat within a batch',async()=>{
 const h=harness();await start(h);
 assert.equal((await h.hh.triggerRainDrop(GROUP,{force:true})).sent,2);
 assert.equal((await h.hh.triggerRainDrop(GROUP,{force:true})).sent,1);
 assert.deepEqual(h.sent,['/synthetic/a.jpg','/synthetic/b.jpg','/synthetic/c.jpg']);
 h.photos.push({id:'new',path:'/synthetic/new.jpg'});
 assert.equal((await h.hh.triggerRainDrop(GROUP,{force:true})).sent,1);
 assert.equal(h.sent.at(-1),'/synthetic/new.jpg');
 assert.equal((await h.hh.triggerRainDrop(GROUP,{force:true})).sent,2);
 assert.ok(h.calls.every(call=>call.randomize===true));
 assert.deepEqual(Array.from(h.calls[2].excludePhotoIds),['a','b','c']);
 h.hh.resetInMemoryState();
});
test('failed sends remain eligible and concurrent rain requests do not draw the same inventory',async()=>{
 let rejectFirst=true,unblock;const gate=new Promise(resolve=>{unblock=resolve;});
 const h=harness({send:async()=>{if(rejectFirst){rejectFirst=false;throw Error('synthetic failure');}await gate;}});await start(h);
 const first=h.hh.triggerRainDrop(GROUP,{force:true});
 for(let i=0;i<8;i++)await Promise.resolve();
 assert.equal((await h.hh.triggerRainDrop(GROUP,{force:true})).sent,0);
 unblock();assert.equal((await first).sent,1);
 await h.hh.triggerRainDrop(GROUP,{force:true});
 assert.ok(h.sent.includes('/synthetic/a.jpg'));
 assert.deepEqual(Array.from(h.calls[1].excludePhotoIds),['b']);
 h.hh.resetInMemoryState();
});

test('an old in-flight rain cannot lock a new event or send its remaining old batch',async()=>{
 let first=true,release;const gate=new Promise(resolve=>{release=resolve;});
 const h=harness({send:async()=>{if(first){first=false;await gate;}}});await start(h);
 const old=h.hh.triggerRainDrop(GROUP,{force:true});
 for(let i=0;i<8;i++)await Promise.resolve();
 await h.hh.stopHappyHour({groupJid:GROUP,broadcast:false});await start(h);
 assert.equal((await h.hh.triggerRainDrop(GROUP,{force:true})).sent,2);
 release();assert.equal((await old).sent,1,'the old batch stops before sending its second item');
 assert.equal((await h.hh.triggerRainDrop(GROUP,{force:true})).sent,1,'old completion does not clear the new event deck');
 h.hh.resetInMemoryState();
});
