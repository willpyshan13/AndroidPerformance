import test from 'node:test';
import assert from 'node:assert/strict';
import { startupExperimentCsv, startupExperimentJson } from '../public/startup-export.js';

const experiment = () => ({
  source: 'adb', timestamp: 1234, serial: 'device-1', packageName: 'com.example.app', requestedMode: 'cold', compilationMode: 'speed-profile',
  compilationAction: { mode: 'speed-profile', applied: true, output: 'Success' },
  results: [
    { run: 1, status: 'ok', observedMode: 'cold', activity: 'com.example.app/.MainActivity', totalTimeMs: 320, thisTimeMs: 280, waitTimeMs: 40, raw: 'Status: ok\nTotalTime: 320' },
    { run: 2, status: 'ok', observedMode: null, activity: null, totalTimeMs: 280, thisTimeMs: 250, waitTimeMs: 30, raw: '=unsafe' },
  ],
  compilationBefore: { available: true, entries: [{ path: '/base.apk', status: 'verify' }] },
  compilationAfter: { available: true, entries: [{ path: '/base.apk', status: 'speed-profile' }] },
});

test('startup JSON report retains per-run raw evidence, context and descriptive summary', () => {
  const report = JSON.parse(startupExperimentJson(experiment()));
  assert.equal(report.schema, 'android-performance.startup-experiment-report');
  assert.equal(report.context.packageName, 'com.example.app');
  assert.equal(report.context.compilationAction.applied, true);
  assert.equal(report.summary.count, 2);
  assert.equal(report.summary.p50, 300);
  assert.equal(report.runs[1].raw, '=unsafe');
  assert.equal(report.compilationBefore.entries[0].status, 'verify');
  assert.match(report.evidenceLimit, /not TTFD/);
});

test('startup CSV has a BOM, quotes raw output and neutralizes spreadsheet formulas', () => {
  const csv = startupExperimentCsv(experiment());
  assert.ok(csv.startsWith('\uFEFF"run","package"'));
  assert.match(csv, /"Status: ok\nTotalTime: 320"/);
  assert.match(csv, /"'=unsafe"/);
});

test('startup JSON and CSV retain bounded per-run Agent milestone evidence',()=>{
  const processSessionId='0123456789abcdef0123456789abcdef',activityId='11111111111111111111111111111111';
  const evidence={available:true,processSessionId,boundary:'monotonic-cursor',truncated:false,reason:null,events:[{processSessionId,activityId,name:'first-draw',activity:'com.example.app.Main',pid:42,monotonicNs:'123456789'}],activitySummaries:[{processSessionId,activityId,activity:'com.example.app.Main',createdToResumedMs:null,resumedToFirstDrawMs:4.5,firstDrawToFullyDrawnMs:null,milestones:['first-draw']}]};
  const input={...experiment(),results:experiment().results.map((row,index)=>index?row:{...row,agentEvidence:evidence})},report=JSON.parse(startupExperimentJson(input)),csv=startupExperimentCsv(input);
  assert.equal(report.runs[0].agentEvidence.activitySummaries[0].resumedToFirstDrawMs,4.5);assert.match(csv,/milestone_evidence_status/);assert.match(csv,/first-draw/);
  assert.throws(()=>startupExperimentJson({...input,results:[{...input.results[0],agentEvidence:{...evidence,events:Array(101).fill(evidence.events[0])}}]}),/超过 100 项/);
  assert.throws(()=>startupExperimentJson({...input,results:[{...input.results[0],agentEvidence:{...evidence,events:[{...evidence.events[0],pid:'9007199254740992'}]}}]}),/事件字段无效/);
});

test('startup exports preserve system TTID/TTFD evidence and unavailable fully-drawn values',()=>{
  const systemEvidence={available:true,source:'android-event-log',reason:null,ttidMs:65,activityDisplayMs:55,ttfdMs:null,activityToken:'101',component:'com.example.app/.MainActivity',truncated:false,events:[{name:'launch-time',userId:0,activityToken:'101',component:'com.example.app/.MainActivity',activityTimeMs:55,totalTimeMs:65}]};
  const input={...experiment(),results:experiment().results.map((row,index)=>index?row:{...row,systemEvidence})},json=JSON.parse(startupExperimentJson(input)),csv=startupExperimentCsv(input);
  assert.equal(json.runs[0].systemEvidence.ttidMs,65);assert.equal(json.runs[0].systemEvidence.ttfdMs,null);assert.match(csv,/system_startup_evidence_json/);assert.match(csv,/""ttidMs"":65/);
  assert.throws(()=>startupExperimentJson({...input,results:[{...input.results[0],systemEvidence:{...systemEvidence,events:Array(101).fill(systemEvidence.events[0])}}]}),/超过 100 项/);
  assert.throws(()=>startupExperimentJson({...input,results:[{...input.results[0],systemEvidence:{...systemEvidence,events:[{...systemEvidence.events[0],totalTimeMs:-1}]}}]}),/事件字段无效/);
  assert.equal(JSON.parse(startupExperimentJson({...input,results:[{...input.results[0],systemEvidence:{available:false,reason:'no event',events:[],ttidMs:null,ttfdMs:null}}]})).runs[0].systemEvidence.available,false);
});

test('startup exporters enforce run and measurement bounds', () => {
  assert.throws(() => startupExperimentJson({ ...experiment(), results: Array.from({ length: 11 }, (_, i) => ({ run: i + 1, status: 'ok', totalTimeMs: 1 })) }), /10 次/);
  assert.throws(() => startupExperimentCsv({ ...experiment(), requestedMode: 'unknown' }), /包名或请求模式/);
  assert.throws(() => startupExperimentJson({ ...experiment(), results: [{ run: 1, status: 'ok', totalTimeMs: -1 }] }), /轮次数据无效/);
});
