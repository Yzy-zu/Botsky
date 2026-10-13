'use strict';
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const pm2=require('/usr/lib/node_modules/pm2');
const root=path.resolve(__dirname,'../..');const production=process.env.BOTSKY_PRODUCTION_DIR||'/home/petrov/botsky';
const stateFile='/tmp/botsky-phase3-shadow-state.json';
const call=(method,...args)=>new Promise((resolve,reject)=>pm2[method](...args,(error,value)=>error?reject(error):resolve(value)));
const restart=(id,flags,nodeArgs)=>new Promise((resolve,reject)=>pm2.Client.executeRemote('restartProcessId',{id,env:{...flags,current_conf:{node_args:nodeArgs}}},(error,value)=>error?reject(error):resolve(value)));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function files(directory){return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path.join(directory,entry.name)):[path.join(directory,entry.name)]);}
async function identity(){const dotenv=require(path.join(production,'node_modules/dotenv'));const axios=require(path.join(production,'node_modules/axios'));const config=dotenv.parse(fs.readFileSync(path.join(production,'.env')));const response=await axios.get(config.EVOLUTION_API_URL.replace(/\/$/,'')+'/instance/fetchInstances',{params:{instanceName:config.EVOLUTION_INSTANCE},headers:{apikey:config.EVOLUTION_API_KEY},timeout:10000});const instances=Array.isArray(response.data)?response.data:[response.data];const instance=instances.find(value=>value.name===config.EVOLUTION_INSTANCE);if(!instance?.ownerJid)throw Error('Identity unavailable');return instance.ownerJid;}
async function main(){
 const action=process.argv[2];if(!['activate','status','disable'].includes(action))throw Error('Invalid action');await call('connect');const apps=(await call('list')).filter(app=>app.name==='wasa');if(apps.length!==1||apps[0].pm2_env.pm_cwd!==production)throw Error('Unexpected process');const app=apps[0];
 if(action==='status'){const state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile)):undefined;const checkpoint=state&&fs.existsSync(state.output+'.checkpoint.json')?JSON.parse(fs.readFileSync(state.output+'.checkpoint.json')):undefined;console.log(JSON.stringify({name:app.name,status:app.pm2_env.status,pid:app.pid,mode:app.pm2_env.env?.PIPELINE_MODE||'legacy',sameProcess:state?.pid===app.pid,checkpoint}));return;}
 if(action==='disable'){const state=JSON.parse(fs.readFileSync(stateFile));await restart(app.pm_id,state.previousFlags,state.nodeArgs);console.log('Shadow disabled; original mode/Node arguments restored. Business sources were never replaced.');return;}
 if(app.pm2_env.env?.LEGACY_COMMAND_USAGE_ENABLED!=='true')throw Error('Actual command observation must be active for shadow comparison');
 if(app.pm2_env.node_args && !Array.isArray(app.pm2_env.node_args))throw Error('Unsupported Node arguments shape; do not overwrite');
 if(fs.existsSync(stateFile)||fs.existsSync(path.join(production,'src/v2')))throw Error('Existing shadow state or target; do not overwrite');
 const relativeFiles=[...files(path.join(root,'src/v2')).map(file=>path.relative(root,file)),'src/services/phase3ShadowRuntime.js','scripts/refactor/phase3-shadow-hooks.cjs','scripts/refactor/phase3-shadow-preload.cjs'];for(const relative of relativeFiles)if(fs.existsSync(path.join(production,relative)))throw Error('Target already exists');
 const keys=['PIPELINE_MODE','BOTSKY_SHADOW_OUTPUT','REFRACTOR_CAPTURE_BOT_JID'];const previousFlags=Object.fromEntries(keys.map(key=>[key,app.pm2_env.env?.[key]||'']));const nodeArgs=Array.isArray(app.pm2_env.node_args)?app.pm2_env.node_args:[];const output=path.join('/home/petrov/botsky-shadow','run-'+Date.now()+'.jsonl');const botJid=await identity();
 const state={id:app.pm_id,activatedUtc:new Date().toISOString(),previousFlags,nodeArgs,output,files:{}};fs.writeFileSync(stateFile,JSON.stringify(state),{flag:'wx',mode:0o600});
 for(const relative of relativeFiles){const bytes=fs.readFileSync(path.join(root,relative));const target=path.join(production,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);state.files[relative]=hash(bytes);}fs.writeFileSync(stateFile,JSON.stringify(state),{mode:0o600});
 await restart(app.pm_id,{PIPELINE_MODE:'shadow',BOTSKY_SHADOW_OUTPUT:output,REFRACTOR_CAPTURE_BOT_JID:botJid},[...nodeArgs,'--require',path.join(production,'scripts/refactor/phase3-shadow-preload.cjs')]);
 for(let attempt=0;attempt<30&&!fs.existsSync(output+'.checkpoint.json');attempt++)await new Promise(resolve=>setTimeout(resolve,100));
 const initial=fs.existsSync(output+'.checkpoint.json')?JSON.parse(fs.readFileSync(output+'.checkpoint.json')):undefined;
 if(!initial?.enabled||initial.operationalClock!==true){await restart(app.pm_id,previousFlags,nodeArgs);throw Error('Observer failed to initialize; original mode restored');}
 const updated=(await call('list')).find(value=>value.pm_id===app.pm_id);state.pid=updated?.pid;fs.writeFileSync(stateFile,JSON.stringify(state),{mode:0o600});console.log(JSON.stringify({activated:true,pid:state.pid,output,mode:'shadow',businessOwner:'legacy',additionalProviderCalls:0}));
}
main().catch(()=>{console.error('Shadow operation failed; inspect private state and source guards. No credentials printed.');process.exitCode=1;}).finally(()=>pm2.disconnect());
