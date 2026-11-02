import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSampleTimeline,createCpuAnalysisReport,parseFoldedStacks} from '../public/offline.js';

test('simpleperf CPU report keeps event, sample-quality, top-function and thread evidence',()=>{
 const profile={...parseFoldedStacks('main;render 12\nmain;wait 4\n'),fileName:'capture.perf.data'},timeline=buildSampleTimeline({event:'cpu-clock',clockId:'monotonic',samples:[{timeNs:'1000',period:'12',pid:7,tid:8,thread:'main',frames:['main','render']},{timeNs:'2000',period:'4',pid:7,tid:8,thread:'main',frames:['main','wait']}]});
 const report=createCpuAnalysisReport({profile,timeline,captureDiagnostics:{samplesLost:2},generatedAt:'2026-11-03T00:00:00.000Z'});
 assert.equal(report.profileType,'sampled-call-stacks');assert.equal(report.weightMeaning,'sampling event period; not direct CPU time or CPU percentage');assert.equal(report.summary.event,'cpu-clock');assert.equal(report.summary.timeline.sampleCount,2);assert.equal(report.summary.sampleQuality.samples,2);assert.equal(report.topFunctions[0].name,'render');assert.equal(report.threads[0].tid,8);assert.equal(report.captureDiagnostics.samplesLost,2);
});

test('ART method report keeps method totals and bounds thread, method and interval detail',()=>{
 const methodTrace={format:'ART method trace',version:3,streaming:false,clock:'wall',durationUs:'1000',eventCount:4000,threadCount:1001,methodCount:1001,completedCalls:2000,incompleteCalls:0,unmatchedExits:0,intervalsTruncated:true,threads:Array.from({length:1001},(_,tid)=>({tid,name:`Thread ${tid}`})),methods:Array.from({length:1001},(_,id)=>({id,name:`pkg.Method${id}`,calls:2,inclusiveUs:'5',exclusiveUs:'3'})),intervals:Array.from({length:2501},(_,index)=>({tid:0,methodId:index,name:`pkg.Method${index}`,startUs:String(index),endUs:String(index+1),inclusiveUs:'1',exclusiveUs:'1',depth:0}))};
 const report=createCpuAnalysisReport({methodTrace,fileName:'app.trace',generatedAt:'fixed'});
 assert.equal(report.profileType,'art-method-trace');assert.equal(report.summary.completedCalls,2000);assert.equal(report.methods.length,1000);assert.equal(report.threads.length,1000);assert.equal(report.intervals.length,2000);assert.deepEqual(report.limits,{methodsReported:1000,threadsReported:1000,intervalsReported:2000});
 assert.throws(()=>createCpuAnalysisReport(),/没有可导出的采样数据/);
});
