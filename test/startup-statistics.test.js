import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startupRunSummary} from '../public/offline.js';

test('startup summary reports median, nearest-rank P90, variation, and robust review candidates',()=>{
 const result=startupRunSummary([100,101,99,102,250].map((totalTimeMs,index)=>({run:index+1,totalTimeMs})));
 assert.equal(result.count,5);assert.equal(result.mean,130.4);assert.equal(result.minimum,99);assert.equal(result.p50,101);assert.equal(result.p90,250);assert.equal(result.maximum,250);assert.equal(result.range,151);assert.equal(result.medianAbsoluteDeviation,1);assert.deepEqual(result.outlierRuns,[5]);
 assert.ok(result.coefficientOfVariationPercent>0);
});

test('startup summary keeps small samples descriptive and rejects missing measurements',()=>{
 const small=startupRunSummary([{run:1,totalTimeMs:100},{run:2,totalTimeMs:300}]);assert.equal(small.p50,200);assert.equal(small.p90,300);assert.equal(small.coefficientOfVariationPercent>0,true);assert.deepEqual(small.outlierRuns,[]);
 const missing=startupRunSummary([{run:1,totalTimeMs:null},{run:2,totalTimeMs:Infinity}]);assert.equal(missing.count,0);assert.equal(missing.p50,null);assert.deepEqual(missing.outlierRuns,[]);
});
