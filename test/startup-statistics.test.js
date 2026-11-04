import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startupRunSummary,compareStartupExperiments} from '../public/offline.js';

test('startup summary reports median, nearest-rank P90, variation, and robust review candidates',()=>{
 const result=startupRunSummary([100,101,99,102,250].map((totalTimeMs,index)=>({run:index+1,totalTimeMs})));
 assert.equal(result.count,5);assert.equal(result.mean,130.4);assert.equal(result.minimum,99);assert.equal(result.p50,101);assert.equal(result.p90,250);assert.equal(result.maximum,250);assert.equal(result.range,151);assert.equal(result.medianAbsoluteDeviation,1);assert.deepEqual(result.outlierRuns,[5]);
 assert.ok(result.coefficientOfVariationPercent>0);
});

test('startup summary keeps small samples descriptive and rejects missing measurements',()=>{
 const small=startupRunSummary([{run:1,totalTimeMs:100},{run:2,totalTimeMs:300}]);assert.equal(small.p50,200);assert.equal(small.p90,300);assert.equal(small.coefficientOfVariationPercent>0,true);assert.deepEqual(small.outlierRuns,[]);
 const missing=startupRunSummary([{run:1,totalTimeMs:null},{run:2,totalTimeMs:Infinity}]);assert.equal(missing.count,0);assert.equal(missing.p50,null);assert.deepEqual(missing.outlierRuns,[]);
});

test('startup comparison reports descriptive P50/P90 deltas and context mismatches',()=>{
 const make=(name,values,serial='device-a')=>({name,timestamp:1700000000000,payload:{kind:'startup',requestedMode:'cold',packageName:'com.example',serial,results:values.map((totalTimeMs,index)=>({run:index+1,totalTimeMs}))}});
 const result=compareStartupExperiments(make('base',[100,101,99]),make('new',[110,111,109],'device-b'));
 assert.equal(result.kind,'startup-experiment-comparison');assert.equal(result.baseline.summary.p50,100);assert.equal(result.current.summary.p50,110);assert.equal(result.deltaPercent.p50,10);assert.deepEqual(result.warnings,['设备序列号不一致']);assert.match(result.note,/不表示独立实验/);
 assert.throws(()=>compareStartupExperiments({},{}),/两份有效实验记录/);
});
