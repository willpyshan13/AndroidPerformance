import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {access,readFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {analyzeTraceUpload,buildReadOnlyTraceQuery,parseCsv,parseTraceSummary,queryTraceSql,locateTraceProcessor} from '../src/trace-analysis.js';
const req=(chunks,headers={})=>{const r=Readable.from(chunks);r.headers=headers;return r;};
test('CSV handles escaped quotes and embedded newlines',()=>{
 assert.deepEqual(parseCsv('"a","b"\r\n"x, y","z""q\nq"\n'),[['a','b'],['x, y','z"q\nq']]);
 assert.throws(()=>parseCsv('"unclosed'),/截断/);
});
test('custom trace SQL is read-only, bounded and returns escaped CSV cells',async()=>{
 const query=buildReadOnlyTraceQuery("WITH x AS (SELECT 'DROP; UPDATE' AS label) SELECT label FROM x;");assert.match(query,/LIMIT 501$/);assert.match(buildReadOnlyTraceQuery('INCLUDE PERFETTO MODULE android.startup.time_to_display; SELECT * FROM slice'),/^INCLUDE PERFETTO MODULE .*;\s+SELECT \* FROM/);
 for(const sql of ['DELETE FROM slice','SELECT 1; SELECT 2','PRAGMA table_info(slice)','SELECT * FROM readfile(\'/etc/passwd\')','SELECT 1 -- comment'])assert.throws(()=>buildReadOnlyTraceQuery(sql));
 let called;const result=await queryTraceSql('/tmp/example.trace',{sql:'SELECT 1 AS number',locator:async()=>'/trace-processor',runner:async(binary,args,options)=>{called={binary,args,options};return {stdout:'number,label\n1,"a,b"\n'};}});
 assert.deepEqual(result,{columns:['number','label'],rows:[['1','a,b']],truncated:false});assert.equal(called.args[3],'/tmp/example.trace');assert.match(called.args[4],/LIMIT 501$/);assert.equal(called.options.timeout,120000);
 const many=await queryTraceSql('/tmp/example.trace',{sql:'SELECT 1',locator:async()=>'/trace-processor',runner:async()=>({stdout:'n\n'+Array.from({length:501},(_,i)=>i).join('\n')+'\n'})});assert.equal(many.rows.length,500);assert.equal(many.truncated,true);
 await assert.rejects(queryTraceSql('/tmp/example.trace',{sql:'SELECT 1',locator:async()=>'/trace-processor',runner:async()=>({stdout:Array.from({length:51},(_,i)=>`c${i}`).join(',')+'\n'})}),/列数超过 50/);
});
test('trace summary keeps timestamps as exact strings and missing evidence empty',()=>{
 const r=parseTraceSummary('"kind","label","count","value"\n"bounds","trace","9007199254740993","9007199254741093"\n"slice","776F726B","2","12.5"\n');
 assert.equal(r.bounds.startNs,'9007199254740993');assert.deepEqual(r.slices,[{name:'work',count:2,totalMs:12.5}]);assert.deepEqual(r.threads,[]);
 assert.throws(()=>parseTraceSummary('bad\n'),/列/);
});
test('heap allocation profile parser preserves signed samples and callsite metadata',async()=>{
 const {parseHeapProfileSummary,queryHeapProfile}=await import('../src/trace-analysis.js');
 const csv='"id","parent_id","name_hex","mapping_hex","source_hex","line_number","self_unreleased_bytes","cumulative_unreleased_bytes","self_allocated_bytes","cumulative_allocated_bytes"\n"1","","6D616C6C6F63","6C6962632E736F2E","","","-1024","-100","2048","4096"\n"2","1","6D7946756E63","6170702E736F","7372632F4D61696E2E637070","42","512","924","1024","2048"\n';
 const r=parseHeapProfileSummary(csv,'native');assert.equal(r.available,true);assert.equal(r.sites[0].name,'malloc');assert.equal(r.sites[0].selfUnreleasedBytes,'-1024');assert.equal(r.sites[1].source,'src/Main.cpp');assert.equal(r.sites[1].line,'42');assert.equal(r.totalAllocatedBytes,'4096');assert.equal(r.totalUnreleasedBytes,'-100');
 assert.throws(()=>parseHeapProfileSummary(csv,'other'),/模式无效/);assert.throws(()=>parseHeapProfileSummary(csv.replace('"2048"','"-2"'),'art'),/数值无效/);assert.throws(()=>parseHeapProfileSummary('bad\n'),/列无效/);
 let sql;const queried=await queryHeapProfile('/private/trace',{mode:'art',locator:async()=>'/trusted/trace_processor',runner:async(binary,args)=>{assert.equal(binary,'/trusted/trace_processor');sql=args.at(-1);return {stdout:csv};}});assert.equal(queried.mode,'art');assert.match(sql,/INCLUDE PERFETTO MODULE android\.memory\.heap_profile\.summary_tree/);assert.match(sql,/ORDER BY cumulative_alloc_size DESC LIMIT 501/);
});
test('trace upload uses fixed query and cleans temporary files',async()=>{
 let path;const r=await analyzeTraceUpload(req([Buffer.from('test')]),{locator:async()=>'/trusted/tp',runner:async(binary,args)=>{assert.equal(binary,'/trusted/tp');assert.equal(args[0],'--no-agent');path=args[3];assert.equal((await readFile(path)).toString(),'test');return {stdout:'"kind","label","count","value"\n"bounds","trace","1","2"\n'};}});
 assert.equal(r.fileBytes,4);await assert.rejects(access(path));
 await assert.rejects(analyzeTraceUpload(req([],{ 'content-length':String(256*1024*1024+1) })),/超过/);
});
test('official trace processor analyzes a synthetic Chrome trace',async(t)=>{
 try{await locateTraceProcessor();}catch{t.skip('未准备 Trace Processor');return;}
 const stream=createReadStream(new URL('../fixtures/trace-sample.json',import.meta.url));stream.headers={};const result=await analyzeTraceUpload(stream);
 assert.equal(result.bounds.startNs,'1000000');assert.equal(result.bounds.endNs,'47000000');assert.equal(result.slices.find(x=>x.name==='startup').totalMs,25);assert.deepEqual(result.threads,[]);assert.equal(result.binder[0].totalMs,3);
});
test('Trace Processor heap-profile query reports no samples for an ordinary trace',async(t)=>{
 try{await locateTraceProcessor();}catch{t.skip('未准备 Trace Processor');return;}
 const {queryHeapProfile}=await import('../src/trace-analysis.js'),result=await queryHeapProfile(new URL('../fixtures/trace-sample.json',import.meta.url).pathname,{mode:'native'});
 assert.equal(result.available,false);assert.deepEqual(result.sites,[]);assert.equal(result.mode,'native');
});
test('trace names containing quotes and newlines survive the native CSV exporter',async(t)=>{
 try{await locateTraceProcessor();}catch{t.skip('未准备 Trace Processor');return;}
 const data=Buffer.from(JSON.stringify({traceEvents:[{name:'quoted "name",\nnext',ph:'X',pid:1,tid:1,ts:10,dur:20}]}));
 const r=await analyzeTraceUpload(req([data]));assert.equal(r.slices[0].name,'quoted "name",\nnext');assert.equal(r.sliceEvents[0].name,'quoted "name",\nnext');
});
test('trace slices retain native nesting depth through window queries',async(t)=>{
 try{await locateTraceProcessor();}catch{t.skip('未准备 Trace Processor');return;}
 const data=Buffer.from(JSON.stringify({traceEvents:[{name:'outer',ph:'X',pid:1,tid:1,ts:10,dur:100},{name:'inner',ph:'X',pid:1,tid:1,ts:20,dur:20},{name:'nested',ph:'X',pid:1,tid:1,ts:25,dur:5}]}));
 const {result,session}=await analyzeTraceUpload(req([data]),{retain:true});
 try{assert.deepEqual(result.sliceEvents.map(x=>[x.name,x.depth]),[['outer',0],['inner',1],['nested',2]]);
 const {queryTraceFile}=await import('../src/trace-analysis.js');const filtered=await queryTraceFile(session.path,{startNs:'20000',endNs:'40000',sliceFilter:'nested'});assert.deepEqual(filtered.sliceEvents.map(x=>[x.name,x.depth]),[['nested',2]]);
 }finally{await session.cleanup();}
});
test('slice arguments come from the selected recorded event and preserve text',async(t)=>{
 const {querySliceArguments}=await import('../src/trace-analysis.js');
 await assert.rejects(querySliceArguments('unused',{sliceId:'1;DROP'}),/标识无效/);
 try{await locateTraceProcessor();}catch{t.skip('未准备 Trace Processor');return;}
 const data=Buffer.from(JSON.stringify({traceEvents:[{name:'one',ph:'X',pid:1,tid:1,ts:10,dur:10,args:{message:'hello, 世界',count:42}},{name:'two',ph:'X',pid:1,tid:1,ts:30,dur:10,args:{message:'other'}}]}));
 const {result,session}=await analyzeTraceUpload(req([data]),{retain:true});
 try{const one=await querySliceArguments(session.path,{sliceId:result.sliceEvents[0].sliceId});assert.ok(one.args.some(a=>a.key==='args.message'&&a.value==='hello, 世界'));assert.ok(one.args.some(a=>a.key==='args.count'&&a.value==='42'));const two=await querySliceArguments(session.path,{sliceId:result.sliceEvents[1].sliceId});assert.ok(two.args.some(a=>a.value==='other'));assert.ok(!two.args.some(a=>a.value==='hello, 世界'));}finally{await session.cleanup();}
});
test('synthetic ftrace scheduling preserves running and idle intervals',async(t)=>{
 try{await locateTraceProcessor();}catch{t.skip('未准备 Trace Processor');return;}
 const stream=createReadStream(new URL('../fixtures/trace-sched.txt',import.meta.url));stream.headers={};const r=await analyzeTraceUpload(stream);
 assert.equal(r.schedEvents.length,3);assert.equal(r.schedEvents[0].tid,123);assert.equal(r.schedEvents[0].durationNs,'10000000');assert.equal(r.schedEvents[1].tid,0);assert.equal(r.threads.find(x=>x.name.includes('worker')).totalMs,20);
});
test('trace windows include overlapping events and reject invalid or injected bounds',async(t)=>{
 const {queryTraceFile,traceWindowQuery}=await import('../src/trace-analysis.js');
 assert.throws(()=>traceWindowQuery('1; DROP TABLE slice','9'),/无效/);assert.throws(()=>traceWindowQuery('9','1'),/无效/);
 try{await locateTraceProcessor();}catch{t.skip('未准备 Trace Processor');return;}
 const result=await queryTraceFile(new URL('../fixtures/trace-sample.json',import.meta.url).pathname,{startNs:'32000000',endNs:'46000000'});
 assert.deepEqual(result.sliceEvents.map(e=>e.name),['render','binder transaction']);assert.equal(result.slices.length,3);
});
test('track filtering is applied by Trace Processor before the event limit',async(t)=>{
 const {queryTraceFile,traceWindowQuery}=await import('../src/trace-analysis.js');
 const injected="worker' OR 1=1 --";const sql=traceWindowQuery('1000000000','1030000000',injected);
 assert.ok(!sql.includes(injected));assert.match(sql,/CAST\(X'[0-9a-f]+' AS TEXT\)/);
 assert.throws(()=>traceWindowQuery('1','2','a'.repeat(201)),/筛选词/);
 try{await locateTraceProcessor();}catch{t.skip('未准备 Trace Processor');return;}
 const path=new URL('../fixtures/trace-sched.txt',import.meta.url).pathname;
 const result=await queryTraceFile(path,{startNs:'1000000000',endNs:'1030000000',trackFilter:'WORKER'});
 assert.deepEqual(result.schedEvents.map(e=>e.thread),['worker','worker']);
 assert.equal(result.threads.find(x=>x.name.includes('worker')).count,2);
 const empty=await queryTraceFile(path,{startNs:'1000000000',endNs:'1030000000',trackFilter:injected});assert.equal(empty.schedEvents.length,0);assert.deepEqual(empty.threads,result.threads);
});
test('slice name filter is literal, case insensitive, and leaves aggregate and scheduling evidence intact',async(t)=>{
 const {queryTraceFile,traceWindowQuery}=await import('../src/trace-analysis.js');
 const injection="render' OR 1=1 --";
 assert.ok(!traceWindowQuery('1','2','',injection).includes(injection));
 assert.throws(()=>traceWindowQuery('1','2','','a'.repeat(201)),/切片筛选词/);
 assert.throws(()=>traceWindowQuery('1','2','',42),/切片筛选词/);
 try{await locateTraceProcessor();}catch{t.skip('未准备 Trace Processor');return;}
 const path=new URL('../fixtures/trace-sample.json',import.meta.url).pathname;
 const result=await queryTraceFile(path,{startNs:'1000000',endNs:'47000000',sliceFilter:'RENDER'});
 assert.deepEqual(result.sliceEvents.map(x=>x.name),['render']);assert.equal(result.slices.length,3);
 const empty=await queryTraceFile(path,{startNs:'1000000',endNs:'47000000',sliceFilter:injection});assert.deepEqual(empty.sliceEvents,[]);
});
test('retained trace files stay private until synchronous cleanup',async()=>{
 let path;const {session}=await analyzeTraceUpload(req([Buffer.from('trace')]),{retain:true,locator:async()=>'/tp',runner:async(_binary,args)=>{path=args[3];return {stdout:'"kind","label","count","value"\n"bounds","trace","1","2"\n'};}});
 await access(path);session.cleanupSync();await assert.rejects(access(path));
});
test('FrameTimeline preserves exact timestamps and platform classifications',async()=>{
 const {parseFrameTimeline}=await import('../src/trace-analysis.js');
 const csv='"ts","dur","process_hex","layer_hex","jank_hex","present_hex","surface_token","display_token","on_time_finish","expected_ts","expected_dur","expected_matches","actual_matches","process_id","track_id"\n"9007199254740993","16666667","617070","6C61796572","41707020446561646C696E65204D6973736564","4C6174652050726573656E74","12","13","0","9007199254740990","10000000","1","1","8","12"\n';
 const r=parseFrameTimeline(csv);assert.equal(r.frames[0].tsNs,'9007199254740993');assert.equal(r.frames[0].jankType,'App Deadline Missed');assert.equal(r.frames[0].onTimeFinish,false);assert.equal(r.frames[0].completionDeltaNs,'6666670');assert.equal(r.truncated,false);
 const ambiguous=parseFrameTimeline(csv.replace('"9007199254740990","10000000","1","1"','"","","2","1"'));assert.equal(ambiguous.frames[0].expectedMatches,2);assert.equal(ambiguous.frames[0].completionDeltaNs,null);
 assert.throws(()=>parseFrameTimeline('bad\n'),/列无效/);
});
test('official Trace Processor reads actual synthetic FrameTimeline packets',async(t)=>{
 const {queryFrameTimeline}=await import('../src/trace-analysis.js');
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 try{await locateTraceProcessor();}catch{t.skip('未准备 Trace Processor');return;}
 const v=n=>{n=BigInt(n);const b=[];do{let x=Number(n&127n);n>>=7n;if(n)x|=128;b.push(x);}while(n);return Buffer.from(b);};
 const num=(field,n)=>Buffer.concat([v(field*8),v(n)]),msg=(field,b)=>Buffer.concat([v(field*8+2),v(b.length),b]);
 const start=Buffer.concat([num(1,123),num(2,42),num(3,43),num(4,1000),msg(5,Buffer.from('example layer')),num(6,2),num(7,0),num(9,64),num(10,1)]);
 const packet=(ts,event)=>msg(1,Buffer.concat([num(8,ts),num(10,1),msg(76,event)]));
 const expected=Buffer.concat([num(1,124),num(2,42),num(3,43),num(4,1000),msg(5,Buffer.from('example layer'))]);
 const data=Buffer.concat([packet(1000000000,msg(3,expected)),packet(1016000000,msg(5,num(1,124))),packet(1000000000,msg(4,start)),packet(1030000000,msg(5,num(1,123)))]);
 const dir=await mkdtemp(join(tmpdir(),'frame-timeline-')),path=join(dir,'sample.trace');try{
  await writeFile(path,data);const result=await queryFrameTimeline(path);assert.equal(result.frames.length,1);const frame=result.frames[0];assert.equal(frame.tsNs,'1000000000');assert.equal(frame.durationNs,'30000000');assert.equal(frame.layer,'example layer');assert.match(frame.jankType,/App Deadline Missed/);assert.match(frame.presentType,/Late/);assert.equal(frame.onTimeFinish,false);assert.equal(frame.expectedDurationNs,'16000000');assert.equal(frame.completionDeltaNs,'14000000');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('FrameTimeline process filter is restricted and applied before result limit',async()=>{
 const {queryFrameTimeline}=await import('../src/trace-analysis.js');let sql='';
 const runner=async(_binary,args)=>{sql=args.at(-1);return {stdout:'"ts","dur","process_hex","layer_hex","jank_hex","present_hex","surface_token","display_token","on_time_finish","expected_ts","expected_dur","expected_matches","actual_matches","process_id","track_id"\n'};};
 await queryFrameTimeline('/trace',{packageName:'com.example.app',locator:async()=>'/tp',runner});
 assert.match(sql,/hex\(CAST\(p.name AS BLOB\)\)/);assert.match(sql,/636F6D2E6578616D706C652E6170703A/);assert.ok(sql.indexOf('substr(')<sql.indexOf('LIMIT 2001'));assert.match(sql,/e\.n=1 AND ac\.n=1/);
 await assert.rejects(queryFrameTimeline('/trace',{packageName:"com.example.app' OR 1=1--",locator:async()=>'/tp',runner}),/包名无效/);
});

test('startup trace preserves precise timestamps and missing display times',async()=>{
 const {parseStartupTrace,queryStartupTrace}=await import('../src/trace-analysis.js');
 const csv='"startup_id","ts","dur","package_hex","type_hex","ttid","ttfd","upid"\n"3","9007199254740993","1000000","636F6D2E617070","636F6C64","500000","","12"\n';
 const result=parseStartupTrace(csv);assert.equal(result.startups[0].tsNs,'9007199254740993');assert.equal(result.startups[0].packageName,'com.app');assert.equal(result.startups[0].ttfdNs,null);assert.equal(result.startups[0].ttidNs,'500000');
 assert.throws(()=>parseStartupTrace(csv.replace('"500000"','"-1"')),/无效/);
 let sql;await queryStartupTrace('/trace',{packageName:'com.app',locator:async()=>'/tp',runner:async(_binary,args)=>{sql=args[4];return {stdout:csv};}});assert.match(sql,/636F6D2E617070/);assert.doesNotMatch(sql,/com\.app/);
 await assert.rejects(()=>queryStartupTrace('/trace',{packageName:"com.app' OR 1=1"}),/包名/);
});
test('bundled Trace Processor executes Android startup metric on a non-Android trace',async t=>{
 try{await locateTraceProcessor();}catch{t.skip('未准备 Trace Processor');return;}
 const {queryStartupTrace}=await import('../src/trace-analysis.js');const result=await queryStartupTrace(new URL('../fixtures/trace-sample.json',import.meta.url).pathname);assert.deepEqual(result.startups,[]);
});

test('official Android 12 cold startup fixture yields TTID and TTFD',async t=>{
 const path=process.env.APW_STARTUP_TRACE;if(!path){t.skip('设置 APW_STARTUP_TRACE 指向校验后的 Perfetto 官方样本');return;}
 const {createHash}=await import('node:crypto');const {readFile}=await import('node:fs/promises');const {queryStartupTrace}=await import('../src/trace-analysis.js');
 assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'),'aadf4a141dc0249abd4d7080a7d94bd614949eb0e7398fa6f3c75b503c70dade');
 const result=await queryStartupTrace(path,{packageName:'androidx.benchmark.integration.macrobenchmark.target'});
 assert.equal(result.startups.length,1);assert.equal(result.startups[0].type,'cold');assert.equal(result.startups[0].ttidNs,'143980066');assert.equal(result.startups[0].ttfdNs,'620815843');
 const filtered=await queryStartupTrace(path,{packageName:'com.example.absent'});assert.equal(filtered.startups.length,0);
});

test('startup breakdown preserves exclusive interval evidence and rejects invalid ids',async()=>{
 const {parseStartupBreakdown,queryStartupBreakdown}=await import('../src/trace-analysis.js');
 const csv='"kind","reason_hex","ts","dur","count"\n"summary","62696E646572","","300","2"\n"interval","62696E646572","9007199254740993","100",""\n';
 const result=parseStartupBreakdown(csv);assert.deepEqual(result.summary,[{reason:'binder',durationNs:'300',count:2}]);assert.equal(result.intervals[0].tsNs,'9007199254740993');
 await assert.rejects(()=>queryStartupBreakdown('/trace',{startupId:'0 OR 1=1'}),/标识无效/);await assert.rejects(()=>queryStartupBreakdown('/trace',{startupId:'9223372036854775808'}),/标识无效/);
});
test('real Android startup breakdown exposes observed Perfetto classifications',async t=>{
 const path=process.env.APW_STARTUP_TRACE;if(!path){t.skip('设置 APW_STARTUP_TRACE 指向 Perfetto 官方 Android 样本');return;}
 const {queryStartupBreakdown}=await import('../src/trace-analysis.js');const result=await queryStartupBreakdown(path,{startupId:'0'});
 assert.deepEqual(result.summary.find(x=>x.reason==='binder'),{reason:'binder',durationNs:'22564487',count:200});assert.equal(result.intervals.length,656);assert.equal(result.intervalsTruncated,false);
});

test('official Android trace exposes real app frame deadlines and nearby trace events',async t=>{
 const path=process.env.APW_STARTUP_TRACE;if(!path){t.skip('设置 APW_STARTUP_TRACE 指向 Perfetto 官方 Android 样本');return;}
 const {queryFrameTimeline,queryTraceFile}=await import('../src/trace-analysis.js');const {traceEventWindow}=await import('../public/offline.js');
 const frames=await queryFrameTimeline(path,{packageName:'androidx.benchmark.integration.macrobenchmark.target'});assert.equal(frames.frames.length,2);
 const frame=frames.frames[0];assert.equal(frame.jankType,'App Deadline Missed');assert.equal(frame.completionDeltaNs,'15744025');assert.equal(frame.expectedMatches,1);
 const trace=await queryTraceFile(path),window=traceEventWindow(trace.bounds,frame.tsNs,frame.durationNs),nearby=await queryTraceFile(path,window);
 assert.ok(nearby.sliceEvents.length>0);assert.ok(nearby.schedEvents.length>0);
});

test('thread state parsing preserves identity, precision and rejects invalid input',async()=>{
 const {parseThreadStates,queryThreadStates}=await import('../src/trace-analysis.js');
 const csv='"kind","utid","tid","pid","thread_hex","process_hex","state_hex","ts","dur","count"\n"summary","1","99","7","6D61696E","617070","52","","100","2"\n"interval","1","99","7","6D61696E","617070","52","9007199254740993","50",""\n';
 const result=parseThreadStates(csv);assert.equal(result.summary[0].state,'R');assert.equal(result.intervals[0].tsNs,'9007199254740993');
 await assert.rejects(()=>queryThreadStates('/x',{tid:'1 OR 1=1',startNs:'0',endNs:'1'}),/TID/);await assert.rejects(()=>queryThreadStates('/x',{tid:1,startNs:'0;DROP',endNs:'1'}),/窗口/);
 await assert.rejects(()=>queryThreadStates('/x',{tid:1,pid:'1 OR 1=1',startNs:'0',endNs:'1'}),/PID/);
});
test('official Android trace returns clipped thread state intervals',async t=>{
 const path=process.env.APW_STARTUP_TRACE;if(!path){t.skip('设置 APW_STARTUP_TRACE 指向 Perfetto 官方 Android 样本');return;}
 const {queryThreadStates}=await import('../src/trace-analysis.js');const start='186973623929730',end='186973723929730';
 const result=await queryThreadStates(path,{tid:626,startNs:start,endNs:end});assert.ok(result.summary.length);assert.ok(result.summary.some(x=>x.state==='Running'));assert.ok(result.summary.some(x=>x.state==='S'));
 const matched=await queryThreadStates(path,{tid:626,pid:617,startNs:start,endNs:end});assert.deepEqual(matched.summary,result.summary);
 const wrong=await queryThreadStates(path,{tid:626,pid:618,startNs:start,endNs:end});assert.deepEqual(wrong.summary,[]);
 for(const row of result.intervals){assert.ok(BigInt(row.tsNs)>=BigInt(start));assert.ok(BigInt(row.tsNs)+BigInt(row.durationNs)<=BigInt(end));}
});
