import test from 'node:test';
import assert from 'node:assert/strict';
import {formatTraceQueryCsv,parsePerfettoUiQueryCsv,createTraceAnalysisReport,formatTraceAnalysisReport} from '../public/trace-export.js';

test('trace SQL CSV exports headers, exact string values and embedded line breaks',()=>{
  const csv=formatTraceQueryCsv(['name','count'],[['render, frame',2],['line one\nline two',0]]);
  assert.ok(csv.startsWith('\uFEFF"name","count"\r\n'));
  assert.match(csv,/"render, frame","2"/);
  assert.match(csv,/"line one\nline two","0"/);
});

test('trace SQL CSV escapes quotes and neutralizes spreadsheet formulas',()=>{
  const csv=formatTraceQueryCsv(['value'],[['=HYPERLINK("https://bad")'],[' @SUM(A1:A2)']]);
  assert.match(csv,/"'=HYPERLINK\(""https:\/\/bad""\)"/);
  assert.match(csv,/"' @SUM\(A1:A2\)"/);
});

test('trace SQL CSV rejects malformed or over-limit results',()=>{
  assert.throws(()=>formatTraceQueryCsv([],[]),/bounds/);
  assert.throws(()=>formatTraceQueryCsv(Array(51).fill('column'),[]),/bounds/);
  assert.throws(()=>formatTraceQueryCsv(['value'],Array(501).fill(['x'])),/bounds/);
  assert.throws(()=>formatTraceQueryCsv(['a','b'],[['only one']]),/do not match/);
});

test('Perfetto UI CSV parser preserves BOM, escaped fields, commas, and multiline values',()=>{
 const parsed=parsePerfettoUiQueryCsv('\uFEFF"name","value"\r\n"frame,draw","line one\nline ""two"""\r\n');
 assert.deepEqual(parsed,{columns:['name','value'],rows:[['frame,draw','line one\nline "two"']],truncated:false});
});

test('Perfetto UI CSV parser enforces structure, field widths, and bounded rows',()=>{
 assert.throws(()=>parsePerfettoUiQueryCsv(''),/empty/);
 assert.throws(()=>parsePerfettoUiQueryCsv('a,b\n1'),/do not match/);
 assert.throws(()=>parsePerfettoUiQueryCsv('"a"x\n1'),/after a quoted field/);
 assert.throws(()=>parsePerfettoUiQueryCsv('a\n"unterminated'),/unterminated/);
 assert.throws(()=>parsePerfettoUiQueryCsv('a\nx',{maxBytes:2}),/file size/);
 assert.throws(()=>parsePerfettoUiQueryCsv('a\nx',{maxRows:0}),/bounds/);
 const parsed=parsePerfettoUiQueryCsv('v\n1\n2\n3\n',{maxRows:2});
 assert.deepEqual(parsed,{columns:['v'],rows:[['1'],['2']],truncated:true});
});

test('trace analysis report includes matching SQL and trace evidence while excluding stale sessions',()=>{
  const trace={sessionId:'trace-a',fileName:'capture.perfetto-trace',fileBytes:123,bounds:{startNs:'9007199254740993',endNs:'9007199254741993'},slices:[{name:'Frame',count:2,totalMs:3}],threads:[],binder:[],errors:[]};
  const report=createTraceAnalysisReport({trace,sql:'SELECT ts FROM slice',sqlResult:{sessionId:'trace-a',columns:['ts'],rows:[['9007199254740993']],truncated:false},frameTimeline:{sessionId:'trace-a',frames:[{tsNs:'9007199254740993'}]},binderResult:{sessionId:'trace-old',transactions:[{id:1}]}});
  assert.equal(report.schema,'android-performance.trace-analysis-report');
  assert.equal(report.trace.bounds.startNs,'9007199254740993');
  assert.deepEqual(report.customSql,{query:'SELECT ts FROM slice',columns:['ts'],rows:[['9007199254740993']],truncated:false});
  assert.equal(report.evidence.frameTimeline.frames[0].tsNs,'9007199254740993');
  assert.equal(report.evidence.binderResult,undefined);
  const parsed=JSON.parse(formatTraceAnalysisReport({trace,sqlResult:{sessionId:'trace-old',columns:['x'],rows:[]}}));
  assert.equal(parsed.customSql,null);
});

test('trace analysis report includes a current Perfetto UI CSV import with honest provenance and excludes stale imports',()=>{
 const trace={sessionId:'trace-current',fileName:'capture.perfetto-trace'};
 const imported={sessionId:'trace-current',fileName:'query.csv',columns:['name','count'],rows:[['render','2']],truncated:false};
 const report=createTraceAnalysisReport({trace,perfettoUiCsv:imported});
 assert.deepEqual(report.perfettoUiCsv,{source:'embedded-perfetto-ui-csv',fileName:'query.csv',query:null,columns:['name','count'],rows:[['render','2']],truncated:false});
 const stale=createTraceAnalysisReport({trace,perfettoUiCsv:{...imported,sessionId:'trace-old'}});
 assert.equal(stale.perfettoUiCsv,null);
 assert.throws(()=>createTraceAnalysisReport({trace,perfettoUiCsv:{...imported,columns:['']}}),/malformed/);
});

test('trace analysis report includes current JankStats attribution and network frame overlaps only for its session',()=>{
  const trace={sessionId:'trace-current'};
  const jankStatsFrames=[{pid:42,startNs:'1000',uiDurationNs:'16000000',activity:'Home',windowId:'main',states:{Screen:'home'},jank:true}];
  const report=createTraceAnalysisReport({trace,jankStatsFrames,
    jankStatsFrameCorrelation:{sessionId:'trace-current',available:true,frames:[{pid:42,startNs:'1000',candidateCount:1,candidates:[{timelineIndex:0,jankType:'App Deadline Missed'}]}]},
    networkTraceCorrelation:{sessionId:'trace-current',requests:[{id:7,frames:[{overlapNs:'5000000'}]}]},
  });
  assert.equal(report.evidence.jankStatsFrameCorrelation.frames.length,1);
  assert.equal(report.evidence.jankStatsFrameAttribution[0].jankPercent,100);
  assert.equal(report.evidence.jankStatsFrameAttribution[0].platformJankCandidates,1);
  assert.equal(report.evidence.networkTraceCorrelation.requests[0].frames[0].overlapNs,'5000000');
  const stale=createTraceAnalysisReport({trace,jankStatsFrames,
    jankStatsFrameCorrelation:{sessionId:'trace-old',frames:[]},networkTraceCorrelation:{sessionId:'trace-old',requests:[]},
  });
  assert.deepEqual(stale.evidence,{});
});

test('trace analysis report rejects missing sessions and malformed SQL bounds',()=>{
  assert.throws(()=>createTraceAnalysisReport({trace:{fileName:'missing-id'}}),/active trace session/);
  const trace={sessionId:'trace-a'};
  assert.throws(()=>createTraceAnalysisReport({trace,sqlResult:{sessionId:'trace-a',columns:['a','b'],rows:[['one']],truncated:false}}),/malformed/);
  assert.throws(()=>formatTraceAnalysisReport({trace,sqlResult:{sessionId:'trace-a',columns:['a'],rows:Array(501).fill(['x']),truncated:true}}),/malformed/);
});

test('trace analysis report enforces its exported JSON size limit',()=>{
  const trace={sessionId:'trace-a'};
  assert.throws(()=>formatTraceAnalysisReport({trace,frameTimeline:{sessionId:'trace-a',payload:'x'.repeat(17*1024*1024)}}),/16 MiB/);
});
