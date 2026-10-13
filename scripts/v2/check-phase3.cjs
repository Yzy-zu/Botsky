'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {javascriptFiles}=require('./check-architecture.cjs');
const moduleRoot=path.resolve(__dirname,'../../src/v2');
const coverageModules=['pipeline','policies'].flatMap(directory=>javascriptFiles(path.join(moduleRoot,directory))).filter(file=>!file.endsWith('/contracts.js')).map(file=>path.relative(moduleRoot,file));
const expected=['S01','S02','S03','S04a','S04b','S05','S06','S07a','S07b','S08','S09','S12','S13','S14','S15','S16'];
function evidenceProblems(evidence,now=Date.now()) {
    const problems=[];
    if(evidence.verify?.exitCode!==0)problems.push('Verification must pass for the current snapshot.');
    if(!Array.isArray(evidence.coverage)||coverageModules.some(file=>!evidence.coverage.some(row=>row.file===file&&Number.isFinite(row.lines)&&row.lines>=90)))problems.push('Every runtime pipeline/policy module needs >=90% lines.');
    for(const id of expected)if(evidence.scenarios?.[id]!=='pass')problems.push(`${id}: missing passing evidence.`);
    if(evidence.architectureReview?.status!=='approved')problems.push('Architecture review pending.');
    const shadow=evidence.shadow;
    if(!shadow||shadow.clock!=='SystemClock'||shadow.active!==true||!Number.isFinite(shadow.startedAt)||!Number.isFinite(shadow.observedUntil)||shadow.observedUntil-shadow.startedAt<86400000||shadow.observedUntil>now||now-shadow.observedUntil>120000)problems.push('Need 24 continuous real hours of active shadow, with a recent checkpoint.');
    if(!shadow||shadow.businessEffects!==0||shadow.exceptions!==0||shadow.sinkErrors!==0||shadow.observed<1)problems.push('Shadow must have observed traffic with zero business IO, exceptions and sink errors.');
    if(!shadow?.diffReport||shadow.diffReviewed!==true)problems.push('Categorized shadow diff report must be reviewed.');
    return problems;
}
function main(){const filename=path.resolve(__dirname,'../../docs/refactor/phase3-evidence.json');const evidence=fs.existsSync(filename)?JSON.parse(fs.readFileSync(filename,'utf8')):{};const problems=evidenceProblems(evidence);for(const problem of problems)console.log(problem);console.log(`Gate 3: ${problems.length?'OPEN':'PASS'}`);process.exitCode=problems.length?1:0;}
if(require.main===module)main();
module.exports={evidenceProblems,expected,coverageModules};
