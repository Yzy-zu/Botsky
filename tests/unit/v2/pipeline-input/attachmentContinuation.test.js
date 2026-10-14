'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture,raw}=require('../../../helpers/pipeline');

test('invalid arguments or unauthorized continuation cannot wake unaddressed group media',async()=>{
    for(const extra of [{access:'owner',argsSchema:{}},{access:'public',argsSchema:{type:'object',properties:{},additionalProperties:false}}]){
        let attempts=0;
        const f=fixture({features:[{id:'unsafe',attachmentContinuation:()=>({name:'append',args:{unexpected:true}}),commands:[{name:'append',scope:['group'],tier:'none',help:{short:'Append',examples:[]},handler:async()=>{attempts++;return{parts:[]};},...extra}]}]});
        try{const result=await f.handle(raw('invalid-media','',{media:true}));assert.equal(result.kind,'ignore');assert.equal(attempts,0);assert.equal(f.sent.length,0);assert.equal(f.requests.length,0);}
        finally{await f.dispose();}
    }
});

test('active bare-media continuation executes its validated command before attachment suggestion or LLM routing',async()=>{
    let attempts=0,selectors=0;
    const feature={id:'documents',attachmentContinuation:ctx=>{
        selectors++;
        return ctx.attachment?.kind==='image'&&ctx.event.text.trim()===''?{name:'append',args:{format:'pdf'}}:undefined;
    },commands:[{name:'append',aliases:[],scope:['private','group'],access:'public',tier:'none',argsSchema:{type:'object',properties:{format:{type:'string',enum:['pdf']}},required:['format'],additionalProperties:false},help:{short:'Append',examples:[]},handler:async(_ctx,args)=>{attempts++;assert.deepEqual(args,{format:'pdf'});return{parts:[{type:'text',text:'Image added'}]};}}]};
    const f=fixture({features:[feature]});
    try {
        const result=await f.handle(raw('bare-image-1','',{media:true}));
        assert.equal(result.kind,'reply');
        assert.equal(result.decision.name,'append');
        assert.equal(result.decision.via,'session');
        assert.equal(attempts,1);
        assert.equal(selectors,1);
        assert.equal(f.requests.length,0,'continuation must not invoke the router LLM');
        assert.equal(f.sent.length,1);
        assert.match(f.sent[0].args[1],/Image added/);
    } finally { f.dispose(); }
});

test('bare media with no matching continuation follows existing non-command behavior',async()=>{
    let attempts=0;
    const feature={id:'documents',attachmentContinuation:()=>undefined,commands:[{name:'append',scope:['private','group'],access:'public',tier:'none',help:{short:'Append',examples:[]},handler:async()=>{attempts++;return{parts:[]};}}]};
    const f=fixture({features:[feature]});
    try {
        const result=await f.handle(raw('bare-image-2','',{media:true}));
        assert.equal(result.kind,'ignore');
        assert.equal(attempts,0);
        assert.equal(f.requests.length,0);
        assert.equal(f.sent.length,0);
    } finally { f.dispose(); }
});
