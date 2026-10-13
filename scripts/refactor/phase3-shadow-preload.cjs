'use strict';
// Runs only in the explicitly selected production process, before legacy imports.
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
require(path.join(root,'node_modules/dotenv')).config({path:path.join(root,'.env')});
try {
    const config=require(path.join(root,'src/v2/config')).readConfigFromProcessEnv();
    if(config.PIPELINE_MODE==='shadow') {
        const runtime=require(path.join(root,'src/services/phase3ShadowRuntime'));
        runtime.initialize({config,filename:String(config.BOTSKY_SHADOW_OUTPUT),botJid:String(config.REFRACTOR_CAPTURE_BOT_JID||config.BOT_NUMBER||'').includes('@')?String(config.REFRACTOR_CAPTURE_BOT_JID||config.BOT_NUMBER):`${config.BOT_NUMBER}@s.whatsapp.net`});
        require('./phase3-shadow-hooks.cjs').installHooks({Module:require('node:module'),runtime});
        process.once('SIGINT',()=>{runtime.stop();void runtime.flush().catch(()=>{});});
    }
}catch {console.error('[SHADOW] Optional observer failed to initialize; legacy continues.');}
