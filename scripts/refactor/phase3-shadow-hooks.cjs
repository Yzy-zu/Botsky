'use strict';
const {AsyncLocalStorage}=require('node:async_hooks');
// Optional instrumentation: original branches remain the only business owner.
function installHooks({Module,runtime}) {
    const originalLoad=Module._load;
    const traces=new AsyncLocalStorage();
    const patched=new WeakSet();
    function record(snapshot) {const trace=traces.getStore();if(!trace||trace.recorded)return;trace.recorded=true;try{runtime.recordV1Decision({chatId:trace.chatId,messageId:trace.messageId,...snapshot});}catch{ /* Optional observer never changes a business branch. */ }}
    function loaded(request,parent,isMain) {
        const value=originalLoad.call(this,request,parent,isMain);
        let filename;try{filename=Module._resolveFilename(request,parent,isMain);}catch{return value;}
        if(filename==='express' || request==='express') {
            if(patched.has(value))return value;
            function express(...args) {
                const app=value(...args);const post=app.post;
                app.post=function(route,...handlers) {
                    if(route==='/webhook') handlers=handlers.map(handler=>typeof handler!=='function'?handler:function(req,res,next){
                        const sendStatus=res.sendStatus;let observed=false;
                        res.sendStatus=function(code){const result=sendStatus.call(this,code);if(code===200&&!observed){observed=true;try{runtime.observeWebhook(req.body);}catch{ /* Business ACK already sent. */ }}return result;};
                        return handler(req,res,next);
                    });
                    return post.call(this,route,...handlers);
                };
                return app;
            }
            Object.assign(express,value);return express;
        }
        if(!value||!['object','function'].includes(typeof value)||patched.has(value))return value;
        if(filename.endsWith('/src/core/dispatcher.js')) {
            const dispatch=value.dispatch;
            value.dispatch=function(context){const chatId=context?.from;const messageId=context?.messageData?.key?.id;return traces.run({chatId,messageId,recorded:false},async()=>{try{return await dispatch(context);}finally{record({kind:'unknown',reason:'v1-unavailable'});}});};
            patched.add(value);
        }else if(filename.endsWith('/src/services/commandUsageRuntime.js')) {
            const track=value.track;
            value.track=function(command,from,operation,options){
                const trace=traces.getStore();const feature=['ayuda','help'].includes(command)?'help':['estado','estadobot','status'].includes(command)?'system-info':undefined;
                const proposal=trace?.proposal;
                const allowed=feature==='help'?['command','detail']:['detail'];
                const args=proposal?.args;const hasPlan=feature&&args&&typeof args==='object'&&!Array.isArray(args)&&Object.keys(args).every(key=>allowed.includes(key));
                record({kind:'command',respond:true,feature,via:proposal?'llm':'explicit',...(hasPlan?{plan:{kind:'intent',intent:feature==='help'?'help.show':'system-info.status',args}}:{})});
                return track.call(this,command,from,operation,options);
            };patched.add(value);
        }else if(filename.endsWith('/src/services/ai.js')) {
            const route=value.routeWithAIOutcome;
            if(typeof route==='function')value.routeWithAIOutcome=async function(...args){const outcome=await route.apply(this,args);const trace=traces.getStore();const decision=outcome?.ok?outcome.decision:undefined;if(trace&&decision){trace.proposal=decision;if(decision.action==='ignore'||(args[2]===true&&decision.addressed_to_bot!==true))record({kind:'ignore',respond:false,via:'llm',reason:'group-not-addressed'});}return outcome;};
            patched.add(value);
        }else if(filename.endsWith('/src/services/evolution.js')) {
            const send=value.sendText;
            value.sendText=async function(...args){const result=await send.apply(this,args);record({kind:'reply',respond:true});return result;};patched.add(value);
        }
        return value;
    }
    Module._load=loaded;
    return {stop(){if(Module._load===loaded)Module._load=originalLoad;}};
}
module.exports={installHooks};
