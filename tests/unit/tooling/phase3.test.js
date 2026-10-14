'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {evidenceProblems,expected,coverageModules}=require('../../../scripts/v2/check-phase3.cjs');
test('Phase3 gate refuses incomplete verification and fake or stale 24h shadow',()=>{
 const now=200000000;const evidence={verify:{exitCode:0},coverage:coverageModules.map(file=>({file,lines:90})),scenarios:Object.fromEntries(expected.map(id=>[id,'pass'])),architectureReview:{status:'approved'},shadow:{clock:'SystemClock',active:true,startedAt:now-86400000,observedUntil:now,businessEffects:0,exceptions:0,sinkErrors:0,observed:1,diffReport:'report',diffReviewed:true}};
 assert.deepEqual(evidenceProblems(evidence,now),[]);
 for(const change of [{clock:'FakeClock'},{active:false},{startedAt:now-1000},{observedUntil:now-180000},{exceptions:1},{businessEffects:1},{sinkErrors:1},{observed:0},{observed:undefined},{observed:NaN},{observed:Infinity},{observed:1.5},{diffReviewed:false}])assert.ok(evidenceProblems({...evidence,shadow:{...evidence.shadow,...change}},now).length);
 assert.ok(evidenceProblems({...evidence,scenarios:{}},now).length>=expected.length);assert.ok(evidenceProblems({...evidence,coverage:[{lines:89.99}]},now).length);assert.ok(evidenceProblems({},now).length);
});
test('explicit user observer cancellation waives only live shadow, never core verification',()=>{
 const exceptions=[{id:'F3-E001',status:'accepted',authorizedBy:'user',instruction:'ya olvida el observador, el chiste es q el bot quede ya listo',scope:'live-shadow-observer'}];
 const evidence={verify:{exitCode:0},coverage:coverageModules.map(file=>({file,lines:90})),scenarios:Object.fromEntries(expected.map(id=>[id,'pass'])),architectureReview:{status:'approved'},exceptions};
 assert.deepEqual(evidenceProblems(evidence),[]);
 for(const change of [{verify:{exitCode:1}},{coverage:[]},{scenarios:{}},{architectureReview:{status:'pending'}},{exceptions:[]},{exceptions:[{...exceptions[0],authorizedBy:'agent'}]}])assert.ok(evidenceProblems({...evidence,...change}).length);
});
