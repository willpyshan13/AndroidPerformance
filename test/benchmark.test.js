import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseBenchmark,compareBenchmarks,benchmarkContextWarnings,benchmarkSampleSummary} from '../public/offline.js';
import {validateRecord} from '../src/records.js';
const benchmark=(params,metrics={time:{runs:[1,3]}})=>({name:'test',className:'Example',params,metrics});
const parse=(benchmarks,context={})=>parseBenchmark({context,benchmarks});
test('official AndroidX macro and micro reports preserve experiment metadata',async t=>{
 const paths=[process.env.APW_ANDROIDX_MACRO,process.env.APW_ANDROIDX_MICRO];if(paths.some(x=>!x)){t.skip('设置 APW_ANDROIDX_MACRO 和 APW_ANDROIDX_MICRO 指向官方样本');return;}
 const [macro,micro]=await Promise.all(paths.map(path=>readFile(path)));
 assert.equal(createHash('sha256').update(macro).digest('hex'),'ba5442ee647beab784ac6bc25d3ffad5a80c3a9d85da9a6671a171397f0113ac');
 assert.equal(createHash('sha256').update(micro).digest('hex'),'e909f10685f4b8d80532cea2c666b3e57d27b73a82250cfb0510cca958696e74');
 const a=parseBenchmark(JSON.parse(macro)),b=parseBenchmark(JSON.parse(micro));assert.equal(a.results.length,4);assert.equal(b.results.length,4);
 assert.equal(a.results.find(x=>x.metric==='timeToInitialDisplayMs').runInfo.repeatIterations,2);
 assert.equal(b.results.find(x=>x.metric==='timeNs').runInfo.warmupIterations,43297946);
 assert.equal(b.context.cpuMaxFreqHz,2000000000);
});
test('Benchmark accepts the sample limit and rejects oversized groups before flattening',()=>{
 const max=benchmark({},{time:{runs:[Array(100000).fill(1)]}});
 assert.equal(parse([max]).results[0].samples.length,100000);
 max.metrics.time.runs.push([2]);assert.throws(()=>parse([max]),/样本超过限制/);
 const sampled=benchmark({},{});sampled.sampledMetrics={frame:{runs:[[1,NaN],[],[2]]}};
 assert.deepEqual(parse([sampled]).results[0].sampleGroups,[[1],[],[2]]);
});
test('Benchmark respects parameters and metric type, computes even-sample median and preserves sampled iteration counts',()=>{
 const input=benchmark({size:1});input.sampledMetrics={time:{runs:[[2,4],[6]]}};
 const a=parse([input]);assert.equal(a.results[0].median,2);assert.equal(a.results[0].medianSource,'computed');assert.equal(a.results[1].median,4);assert.equal(a.results[1].runs,3);assert.equal(a.results[1].iterations,2);
 const b=parse([benchmark({size:2})]);const rows=compareBenchmarks(a,b);assert.equal(rows.length,3);assert.equal(rows[0].missing,'baseline');assert.equal(rows[1].missing,'current');
});
test('Benchmark duplicate identifiers and environment mismatches never silently compare',()=>{
 const a=parse([benchmark({}),benchmark({})],{build:{model:'A',version:{sdk:33}},cpuLocked:false});
 const b=parse([benchmark({})],{build:{model:'B',version:{sdk:34}},cpuLocked:true});
 const row=compareBenchmarks(a,b)[0];assert.equal(row.ambiguous,true);assert.equal(row.delta,null);const warnings=benchmarkContextWarnings(a,b);assert.ok(warnings.includes('设备型号不一致'));assert.ok(warnings.includes('编译模式缺失'));
});
test('saved Benchmark runs validate identity and retain original sample evidence',()=>{
 const payload={...parse([benchmark({mode:'cold'})]),source:'import',fileName:'run.json'};assert.doesNotThrow(()=>validateRecord({kind:'benchmark',source:'import',payload}));
 payload.results[0].params.mode='hot';assert.throws(()=>validateRecord({kind:'benchmark',source:'import',payload}),/标识不一致/);
});
test('Benchmark preserves validated run details and compares device execution context',()=>{
 const b=benchmark({});Object.assign(b,{warmupIterations:4,repeatIterations:9,thermalThrottleSleepSeconds:1,totalRunTimeNs:100});
 const result=parse([b],{cpuCoreCount:8,cpuMaxFreqHz:200,sustainedPerformanceModeEnabled:false,artMainlineVersion:1});
 assert.deepEqual(result.results[0].runInfo,{warmupIterations:4,repeatIterations:9,thermalThrottleSleepSeconds:1,totalRunTimeNs:100});
 const payload={...result,source:'import',fileName:'run.json'};assert.doesNotThrow(()=>validateRecord({kind:'benchmark',source:'import',payload}));
 payload.results[0].runInfo.repeatIterations='<script>';assert.throws(()=>validateRecord({kind:'benchmark',source:'import',payload}),/运行信息/);
 const warnings=benchmarkContextWarnings(result,parse([benchmark({})],{cpuCoreCount:4,cpuMaxFreqHz:200,sustainedPerformanceModeEnabled:true,artMainlineVersion:1}));
 assert.ok(warnings.includes('CPU 核数不一致'));assert.ok(warnings.includes('持续性能模式不一致'));
});

test('sampled metrics preserve iteration boundaries and describe recorded distributions',()=>{
 const input=benchmark({});input.sampledMetrics={frame:{runs:[[1,3,9],[10,20],[]]}};
 const row=parse([input]).results.find(r=>r.metricType==='sampledMetrics');
 assert.deepEqual(row.sampleGroups,[[1,3,9],[10,20],[]]);assert.deepEqual(row.samples,[1,3,9,10,20]);
 assert.deepEqual(benchmarkSampleSummary(row),{count:5,minimum:1,q1:3,median:9,q3:10,maximum:20,groups:{iterations:3,nonempty:2,medianMinimum:3,medianMaximum:15}});
 const payload={...parse([input]),source:'import',fileName:'run.json'};assert.doesNotThrow(()=>validateRecord({kind:'benchmark',source:'import',payload}));
 payload.results.find(r=>r.metricType==='sampledMetrics').sampleGroups[0][0]=99;assert.throws(()=>validateRecord({kind:'benchmark',source:'import',payload}),/分组/);
 const old={...row};delete old.sampleGroups;assert.equal(benchmarkSampleSummary(old).groups,null);
});
