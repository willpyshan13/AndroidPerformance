import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {access,readFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {analyzeTraceUpload,buildReadOnlyTraceQuery,parseCsv,parseTraceSummary,queryTraceSql,queryGpuTraceDiagnostics,queryPowerRailDiagnostics,correlateJankFramesToTimeline,queryJankStatsFrameCorrelation,locateTraceProcessor} from '../src/trace-analysis.js';
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
test('JankStats frame matching keeps PID and bounded start-time candidates distinct and ranks interval overlap',()=>{
 const frames=[{pid:1000,traceStartNs:'1015000000',startNs:'515000000',uiDurationNs:'12000000',jank:true,activity:'HomeActivity',windowId:'1',states:{Screen:'home'},overrunNs:'3000000'},null];
 const timeline=[{pid:1000,tsNs:'1016000000',durationNs:'16000000',process:'com.example',layer:'app',jankType:'App Deadline Missed'},{pid:1000,tsNs:'1019000000',durationNs:'16000000',process:'com.example',layer:'surface',jankType:'None'},{pid:2000,tsNs:'1015000000',durationNs:'16000000',process:'other',layer:'other',jankType:'None'}];
 const result=correlateJankFramesToTimeline(frames,timeline);assert.equal(result.available,true);assert.equal(result.mappedFrames,1);assert.equal(result.unmappedFrames,1);assert.equal(result.matchedFrames,1);assert.equal(result.ambiguousFrames,1);assert.equal(result.frames[0].candidateCount,2);assert.equal(result.frames[0].candidates[0].startDeltaNs,'1000000');assert.equal(result.frames[0].candidates[0].overlapNs,'11000000');assert.equal(result.frames[0].candidates[0].matchBasis,'interval-overlap');assert.equal(result.frames[0].candidates[1].overlapNs,'8000000');assert.equal(result.frames[0].pid,1000);
 assert.throws(()=>correlateJankFramesToTimeline([],[],{toleranceNs:'-1'}),/参数/);
});
test('JankStats query maps frame timestamps through trace clock snapshots before matching PID',async()=>{
 const frameHeader='ts,dur,process_hex,layer_hex,jank_hex,present_hex,process_pid,surface_token,display_token,on_time_finish,expected_ts,expected_dur,expected_matches,actual_matches,process_id,track_id';
 const frameCsv=`${frameHeader}\n1015000000,16000000,636F6D2E6578616D706C652E617070,617070,41707020446561646C696E65204D6973736564,,4242,10,11,1,1015000000,16000000,1,1,77,8\n`;
 const clockCsv='machine_id,snapshot_id,clock_name_hex,clock_value,trace_ts\n1,1,4d4f4e4f544f4e4943,500000000,1000000000\n1,2,4d4f4e4f544f4e4943,600000000,1100000000\n';
 const result=await queryJankStatsFrameCorrelation('/tmp/fake.trace',{packageName:'com.example.app',frames:[{pid:4242,startNs:'515000000',uiDurationNs:'12000000',jank:true,activity:'HomeActivity',windowId:'a1',states:{Screen:'home'}}],locator:async()=>'/trace-processor',runner:async(_binary,args)=>({stdout:args[4].includes('clock_snapshot')?clockCsv:frameCsv})});
 assert.equal(result.available,true);assert.equal(result.clockSnapshots,2);assert.equal(result.mappedFrames,1);assert.equal(result.matchedFrames,1);assert.equal(result.frames[0].traceStartNs,'1015000000');assert.equal(result.frames[0].candidates[0].process,'com.example.app');
 await assert.rejects(queryJankStatsFrameCorrelation('/tmp/fake.trace',{packageName:'bad',frames:[]} ),/包名/);
});
test('network request intervals map through trace clock snapshots and match only the same PID',async()=>{
 const {queryNetworkFrameCorrelation}=await import('../src/trace-analysis.js');
 const frameHeader='ts,dur,process_hex,layer_hex,jank_hex,present_hex,process_pid,surface_token,display_token,on_time_finish,expected_ts,expected_dur,expected_matches,actual_matches,process_id,track_id';
 const appHex=Buffer.from('com.example.app').toString('hex').toUpperCase(),frameCsv=`${frameHeader}\n1015000000,16000000,${appHex},617070,41707020446561646c696e65204d6973736564,,4242,10,11,1,1015000000,16000000,1,1,77,8\n1015000000,16000000,${appHex},617070,41707020446561646c696e65204d6973736564,,9999,12,13,1,1015000000,16000000,1,1,78,9\n`;
 const clockCsv='machine_id,snapshot_id,clock_name_hex,clock_value,trace_ts\n1,1,4d4f4e4f544f4e4943,500000000,1000000000\n1,2,4d4f4e4f544f4e4943,600000000,1100000000\n';
 const result=await queryNetworkFrameCorrelation('/tmp/fake.trace',{packageName:'com.example.app',requests:[{id:7,pid:4242,startNs:'515000000',durationNs:'15000000'}],locator:async()=>'/trace-processor',runner:async(_binary,args)=>({stdout:args.at(-1).includes('clock_snapshot')?clockCsv:frameCsv})});
 assert.equal(result.available,true);assert.equal(result.mappedRequests,1);assert.equal(result.unmappedRequests,0);assert.equal(result.frameOverlapPairs,1);assert.equal(result.requests[0].id,7);assert.equal(result.requests[0].traceStartNs,'1015000000');assert.equal(result.requests[0].traceEndNs,'1030000000');assert.equal(result.requests[0].frames[0].overlapNs,'15000000');assert.match(result.note,/不证明请求导致/);
 const outside=await queryNetworkFrameCorrelation('/tmp/fake.trace',{packageName:'com.example.app',requests:[{id:8,pid:4242,startNs:'499999999',durationNs:'1'}],locator:async()=>'/trace-processor',runner:async(_binary,args)=>({stdout:args.at(-1).includes('clock_snapshot')?clockCsv:frameCsv})});assert.equal(outside.unmappedRequests,1);assert.equal(outside.frameOverlapPairs,0);
 await assert.rejects(queryNetworkFrameCorrelation('/tmp/fake.trace',{packageName:'com.example.app',requests:[{id:1,pid:0,startNs:'515000000',durationNs:'1'}],locator:async()=>'/trace-processor',runner:async()=>({stdout:''})}),/请求时间或 PID/);
});
test('GPU trace diagnostics parse render stages, frequency and per-process memory without assuming absent sources',async()=>{
 const result=await queryGpuTraceDiagnostics('/tmp/example.trace',{locator:async()=>'/trace-processor',runner:async(_bin,args)=>{
  const sql=args[4];
  if(sql.includes('gpu_slice'))return {stdout:'ts_ns,dur_ns,name_hex,queue_hex,category,submission_id,process_hex,pid,upid\n100,2500000,64726177,4d616c69207130,1,42,636f6d2e6578616d706c65,123,7\n'};
  if(sql.includes('android_gpu_frequency'))return {stdout:'ts_ns,dur_ns,gpu_id,frequency\n200,500000,0,600000\n'};
  if(sql.includes('android_gpu_memory_per_process'))return {stdout:'ts_ns,dur_ns,upid,process_hex,bytes\n300,1000000,7,636f6d2e6578616d706c65,1048576\n'};
  throw new Error('unexpected query');
 }});
 assert.deepEqual(result.renderStages.rows,[{tsNs:'100',durationNs:'2500000',name:'draw',queue:'Mali q0',category:1,submissionId:'42',process:'com.example',pid:123,upid:'7'}]);
 assert.deepEqual(result.frequencies.rows,[{tsNs:'200',durationNs:'500000',gpuId:'0',frequency:'600000'}]);
 assert.deepEqual(result.memory.rows,[{tsNs:'300',durationNs:'1000000',upid:'7',process:'com.example',bytes:'1048576'}]);
 const missing=await queryGpuTraceDiagnostics('/tmp/example.trace',{locator:async()=>'/trace-processor',runner:async()=>{throw Object.assign(new Error('no data'),{stderr:'table unavailable'});}});
 assert.equal(missing.renderStages.available,false);assert.match(missing.renderStages.reason,/table unavailable/);assert.deepEqual(missing.memory.rows,[]);
});
test('bundled Trace Processor exposes GPU diagnostics tables on traces without GPU data',async()=>{
 const stream=createReadStream(new URL('../fixtures/trace-sample.json',import.meta.url));stream.headers={};
 const {session}=await analyzeTraceUpload(stream,{retain:true});
 try{const result=await queryGpuTraceDiagnostics(session.path);assert.equal(result.renderStages.available,true);assert.equal(result.frequencies.available,true);assert.equal(result.memory.available,true);assert.deepEqual(result.renderStages.rows,[]);assert.deepEqual(result.frequencies.rows,[]);assert.deepEqual(result.memory.rows,[]);}
 finally{await session.cleanup();}
});
test('power diagnostics keep subsystem rails separate and parse per-UID energy estimates',async()=>{
 const railCsv='"ts_ns","dur_ns","rail_hex","subsystem_hex","raw_name_hex","energy_delta_uws","average_power_mw"\n"1000000000","250000000","435055","736f63","534f435f5241494c","1250.5","5.002"\n';
 const batteryCsv='"ts_ns","capacity_percent","charge_uah","current_ua","current_avg_ua","voltage_uv","energy_counter_uwh","power_mw"\n"1000000000","75","2085000","-120000","-118000","4200000","8750000","504"\n';
 const energyCsv='"ts_ns","energy_uws","uid","consumer_id","consumer_name_hex"\n"1000000000","1000","10123","1","435055"\n"1250000000","1450","10123","1","435055"\n',uidCsv='"uid"\n"10123"\n';
 const respond=query=>query.includes('android.battery')?batteryCsv:query.includes('android_energy_estimation_breakdown_per_uid')?energyCsv:query.includes('android.process_metadata')?uidCsv:railCsv;
 const queries=[],result=await queryPowerRailDiagnostics('/trace',{packageName:'com.example.app',locator:async()=>'/tp',runner:async(_bin,args)=>{const query=args.at(-1);queries.push(query);return {stdout:respond(query)};}});
 assert.equal(result.available,true);assert.deepEqual(result.rows,[{tsNs:'1000000000',durationNs:'250000000',rail:'CPU',subsystem:'soc',rawName:'SOC_RAIL',energyDeltaUws:1250.5,averagePowerMw:5.002}]);assert.deepEqual(result.batteryCounters.rows,[{tsNs:'1000000000',capacityPercent:75,chargeUah:2085000,currentUa:-120000,currentAvgUa:-118000,voltageUv:4200000,energyCounterUwh:8750000,powerMw:504}]);assert.deepEqual(result.uidEnergy.rows.map(({uid,consumerName,energyUws,deltaUws})=>({uid,consumerName,energyUws,deltaUws})),[{uid:10123,consumerName:'CPU',energyUws:'1000',deltaUws:null},{uid:10123,consumerName:'CPU',energyUws:'1450',deltaUws:'450'}]);assert.deepEqual(result.uidEnergy.targetUids,[10123]);assert.equal(result.uidEnergy.targetRows.length,2);assert.match(result.note,/UID 可能由多个包共享/);assert.match(queries[0],/android_power_rails_counters/);assert.match(queries[0],/android_power_rails_metadata/);assert.match(queries[1],/android.battery/);assert.match(queries[2],/android_energy_estimation_breakdown_per_uid/);assert.match(queries[3],/android.process_metadata/);
 const absentRail=await queryPowerRailDiagnostics('/trace',{locator:async()=>'/tp',runner:async(_bin,args)=>{if(args.at(-1).includes('android.power_rails'))throw new Error('no power rail data');return {stdout:respond(args.at(-1))};}});assert.equal(absentRail.available,false);assert.equal(absentRail.batteryCounters.available,true);assert.deepEqual(absentRail.rows,[]);assert.match(absentRail.reason,/功耗轨道数据不可用/);
 const absentBattery=await queryPowerRailDiagnostics('/trace',{locator:async()=>'/tp',runner:async(_bin,args)=>{if(args.at(-1).includes('android.battery'))throw new Error('no battery counters');return {stdout:respond(args.at(-1))};}});assert.equal(absentBattery.available,true);assert.equal(absentBattery.batteryCounters.available,false);
 const malformed=await queryPowerRailDiagnostics('/trace',{locator:async()=>'/tp',runner:async(_bin,args)=>({stdout:args.at(-1).includes('android.power_rails')?'"ts_ns","dur_ns","rail_hex","subsystem_hex","raw_name_hex","energy_delta_uws","average_power_mw"\n"1;DROP","0","","","","0","0"\n':respond(args.at(-1))})});assert.equal(malformed.available,false);assert.match(malformed.reason,/时间无效/);assert.equal(malformed.batteryCounters.available,true);
});
test('bundled Trace Processor supports power analysis on traces without power data',async t=>{
 try{await locateTraceProcessor();}catch{t.skip('未准备 Trace Processor');return;}
 const input=await readFile(new URL('../fixtures/trace-sample.json',import.meta.url));const path=`/tmp/apw-power-rail-${process.pid}.pftrace`;const {writeFile,unlink}=await import('node:fs/promises');await writeFile(path,input);
 try{const result=await queryPowerRailDiagnostics(path);assert.equal(result.available,true);assert.equal(result.batteryCounters.available,true);assert.deepEqual(result.rows,[]);assert.deepEqual(result.batteryCounters.rows,[]);assert.match(result.note,/µJ/);}finally{await unlink(path).catch(()=>{});}
});
test('bundled Trace Processor imports ODPM per-UID energy samples and interval deltas',async t=>{
 try{await locateTraceProcessor();}catch{t.skip('未准备 Trace Processor');return;}
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const v=n=>{n=BigInt(n);const bytes=[];do{let byte=Number(n&127n);n>>=7n;if(n)byte|=128;bytes.push(byte);}while(n);return Buffer.from(bytes);};
 const num=(field,n)=>Buffer.concat([v(field*8),v(n)]),msg=(field,bytes)=>Buffer.concat([v(field*8+2),v(bytes.length),bytes]),str=(field,value)=>msg(field,Buffer.from(value));
 const consumer=Buffer.concat([num(1,1),num(2,0),str(3,'CPU'),str(4,'CPU')]),descriptor=msg(1,consumer);
 const descriptorPacket=msg(1,msg(77,msg(1,descriptor)));
 const energyPacket=(timestamp,energyUws)=>{
  const uidBreakdown=msg(4,Buffer.concat([num(1,10123),num(2,energyUws-100)]));
  const energy=Buffer.concat([num(2,1),num(3,energyUws),uidBreakdown]);
  return msg(1,Buffer.concat([num(8,timestamp),num(10,1),msg(77,energy)]));
 };
 const dir=await mkdtemp(join(tmpdir(),'odpm-energy-trace-')),path=join(dir,'sample.trace');
 try{
  await writeFile(path,Buffer.concat([descriptorPacket,energyPacket(1_000_000_000,1000),energyPacket(1_250_000_000,1450)]));
  const result=await queryPowerRailDiagnostics(path,{packageName:'com.example.app'});
  assert.equal(result.uidEnergy.available,true,JSON.stringify(result.uidEnergy));
  assert.deepEqual(result.uidEnergy.rows.map(({tsNs,uid,consumerId,consumerName,energyUws,deltaUws})=>({tsNs,uid,consumerId,consumerName,energyUws,deltaUws})),[
   {tsNs:'1000000000',uid:10123,consumerId:1,consumerName:'CPU',energyUws:'900',deltaUws:null},
   {tsNs:'1250000000',uid:10123,consumerId:1,consumerName:'CPU',energyUws:'1350',deltaUws:'450'}
  ]);
  assert.deepEqual(result.uidEnergy.targetUids,[]);assert.deepEqual(result.uidEnergy.targetRows,[]);
 }finally{await rm(dir,{recursive:true,force:true});}
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
 const csv='"ts","dur","process_hex","layer_hex","jank_hex","present_hex","process_pid","surface_token","display_token","on_time_finish","expected_ts","expected_dur","expected_matches","actual_matches","process_id","track_id"\n"9007199254740993","16666667","617070","6C61796572","41707020446561646C696E65204D6973736564","4C6174652050726573656E74","42","12","13","0","9007199254740990","10000000","1","1","8","12"\n';
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
 const runner=async(_binary,args)=>{sql=args.at(-1);return {stdout:'"ts","dur","process_hex","layer_hex","jank_hex","present_hex","process_pid","surface_token","display_token","on_time_finish","expected_ts","expected_dur","expected_matches","actual_matches","process_id","track_id"\n'};};
 await queryFrameTimeline('/trace',{packageName:'com.example.app',locator:async()=>'/tp',runner});
 assert.match(sql,/hex\(CAST\(p.name AS BLOB\)\)/);assert.match(sql,/636F6D2E6578616D706C652E6170703A/);assert.ok(sql.indexOf('substr(')<sql.indexOf('LIMIT 2001'));assert.match(sql,/e\.n=1 AND ac\.n=1/);assert.match(sql,/p\.pid/);
 await assert.rejects(queryFrameTimeline('/trace',{packageName:"com.example.app' OR 1=1--",locator:async()=>'/tp',runner}),/包名无效/);
});

test('Compose uptime maps through monotonic clock snapshots without extrapolation',async()=>{
 const {parseMonotonicClockSnapshots,mapMonotonicToTraceNs}=await import('../src/trace-analysis.js');
 const csv='"machine_id","snapshot_id","clock_name_hex","clock_value","trace_ts"\n"","0","4d4f4e4f544f4e4943","500000000","1000000000"\n"","1","4d4f4e4f544f4e4943","600000000","1100000000"\n';
 const snapshots=parseMonotonicClockSnapshots(csv);assert.equal(snapshots.length,2);assert.equal(mapMonotonicToTraceNs('515000000',snapshots),'1015000000');assert.equal(mapMonotonicToTraceNs('499999999',snapshots),null);assert.equal(mapMonotonicToTraceNs('600000001',snapshots),null);
 assert.throws(()=>parseMonotonicClockSnapshots(csv.replace('"600000000"','"500000000"')),/严格递增/);
 assert.throws(()=>parseMonotonicClockSnapshots(csv.replace('"","1"','"7","1"')),/多台设备/);
});

test('Trace Processor maps Compose, CPU and network intervals to actual synthetic FrameTimeline frames',async(t)=>{
 const {queryComposeFrameCorrelation,queryCpuFrameCorrelation,queryLayoutFrameCorrelation,queryNetworkFrameCorrelation,queryFrameTimeline}=await import('../src/trace-analysis.js');
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 try{await locateTraceProcessor();}catch{t.skip('未准备 Trace Processor');return;}
 const v=n=>{n=BigInt(n);const b=[];do{let x=Number(n&127n);n>>=7n;if(n)x|=128;b.push(x);}while(n);return Buffer.from(b);};
 const num=(field,n)=>Buffer.concat([v(field*8),v(n)]),msg=(field,b)=>Buffer.concat([v(field*8+2),v(b.length),b]);
 const frameStart=Buffer.concat([num(1,123),num(2,42),num(3,43),num(4,1000),msg(5,Buffer.from('example layer')),num(6,2),num(7,0),num(9,64),num(10,1)]);
 const framePacket=(ts,event)=>msg(1,Buffer.concat([num(8,ts),num(10,1),msg(76,event)]));
 const packageName='com.example.app',processDescriptor=Buffer.concat([num(1,1000),msg(3,Buffer.from(packageName))]),processTree=msg(1,processDescriptor),processPacket=msg(1,Buffer.concat([msg(2,processTree)]));
 const expected=Buffer.concat([num(1,124),num(2,42),num(3,43),num(4,1000),msg(5,Buffer.from('example layer'))]);
 // TracePacket.clock_snapshot: repeated Clock values, with BOOTTIME selected as the primary trace clock.
 const clock=(id,timestamp)=>Buffer.concat([num(1,id),num(2,timestamp)]);
 const snapshot=(mono,boot)=>Buffer.concat([msg(1,clock(3,mono)),msg(1,clock(6,boot)),num(2,6)]);
 const clockPacket=(mono,boot)=>msg(1,Buffer.concat([num(8,boot),msg(6,snapshot(mono,boot))]));
 const data=Buffer.concat([processPacket,
  clockPacket(500000000,1000000000),clockPacket(600000000,1100000000),
  framePacket(1000000000,msg(3,expected)),framePacket(1016000000,msg(5,num(1,124))),framePacket(1000000000,msg(4,frameStart)),framePacket(1030000000,msg(5,num(1,123)))
 ]);
 const dir=await mkdtemp(join(tmpdir(),'compose-frame-correlation-')),path=join(dir,'sample.trace');try{
  await writeFile(path,data);const result=await queryComposeFrameCorrelation(path,{events:[{elapsedNs:'515000000',clock:'uptime',name:'HomeScreen',measurement:'side-effect'}]});assert.equal(result.available,true,JSON.stringify(result));assert.equal(result.clockSnapshots,2);assert.equal(result.mappedEvents,1);assert.equal(result.uniqueMatchedEvents,1);assert.equal(result.matchedEventFramePairs,1);assert.equal(result.frames.length,1);assert.equal(result.frames[0].composeEvents[0].traceNs,'1015000000');
  const layout=await queryLayoutFrameCorrelation(path,{packageName:null,captureStartUptimeNs:'510000000',captureEndUptimeNs:'520000000'});assert.equal(layout.available,true,JSON.stringify(layout));assert.equal(layout.traceStartNs,'1010000000');assert.equal(layout.traceEndNs,'1020000000');assert.equal(layout.matchedFrameCount,1,JSON.stringify(layout));assert.equal(layout.frames[0].overlapNs,'10000000');assert.equal(layout.frames[0].layer,'example layer');
  const outOfRange=await queryLayoutFrameCorrelation(path,{packageName:null,captureStartUptimeNs:'400000000',captureEndUptimeNs:'410000000'});assert.equal(outOfRange.available,false);assert.match(outOfRange.reason,/不能安全外推/);
  const cpu=await queryCpuFrameCorrelation(path,{clockId:'monotonic',samples:[{timeNs:'515000000',pid:1000,tid:43,weight:'123',name:'MainActivity.draw'}]});assert.equal(cpu.available,true,JSON.stringify(cpu));assert.equal(cpu.mappedSamples,1);assert.equal(cpu.matchedSamples,1);assert.equal(cpu.frames.length,1);assert.equal(cpu.frames[0].sampleWeight,'123');assert.deepEqual(cpu.frames[0].functions,[{name:'MainActivity.draw',count:1,weight:'123'}]);
  const filteredTimeline=await queryFrameTimeline(path,{packageName});assert.equal(filteredTimeline.frames.length,1,JSON.stringify(filteredTimeline));
  const network=await queryNetworkFrameCorrelation(path,{packageName,requests:[{id:7,pid:1000,startNs:'515000000',durationNs:'10000000'}]});assert.equal(network.available,true,JSON.stringify(network));assert.equal(network.clockSnapshots,2);assert.equal(network.mappedRequests,1);assert.equal(network.unmappedRequests,0);assert.equal(network.frameOverlapPairs,1,JSON.stringify(network));assert.equal(network.requests[0].traceStartNs,'1015000000');assert.equal(network.requests[0].traceEndNs,'1025000000');assert.equal(network.requests[0].frames[0].overlapNs,'10000000');
  const wrongPid=await queryCpuFrameCorrelation(path,{clockId:'monotonic',samples:[{timeNs:'515000000',pid:99,tid:100,weight:'123',name:'Other.draw'}]});assert.equal(wrongPid.available,true);assert.equal(wrongPid.mappedSamples,1);assert.equal(wrongPid.matchedSamples,0);assert.equal(wrongPid.frames.length,0);
  const unknown=await queryCpuFrameCorrelation(path,{clockId:null,samples:[]});assert.equal(unknown.available,false);assert.match(unknown.reason,/CLOCK_MONOTONIC/);
  await assert.rejects(queryCpuFrameCorrelation(path,{clockId:'monotonic',samples:[{timeNs:'bad'}]}),/CPU 采样关联数据无效/);
 }finally{await rm(dir,{recursive:true,force:true});}
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
test('startup ART attribution clips observed GC, JIT, class loading and dex2oat slices to TTID/TTFD phases',async t=>{
 try{await locateTraceProcessor();}catch{t.skip('未准备 Trace Processor');return;}
 const path=new URL('../fixtures/trace-startup-art.json',import.meta.url).pathname,{queryStartupArtAttribution,parseStartupArtAttribution}=await import('../src/trace-analysis.js');
 const process=await queryTraceSql(path,{sql:'SELECT CAST(upid AS TEXT) AS upid FROM process WHERE pid=101'});assert.equal(process.rows.length,1);
 const startup={tsNs:'2000000',ttidNs:'7000000',ttfdNs:'15000000',upid:process.rows[0][0]},result=await queryStartupArtAttribution(path,{startup});
 assert.deepEqual(result.groups.map(x=>[x.phase,x.category,x.totalOverlapNs,x.count]),[
  ['launch_to_ttid','gc','1000000',1],['launch_to_ttid','jit','2000000',1],
  ['ttid_to_ttfd','class_loading','1000000',1],['ttid_to_ttfd','class_verification','2000000',1],
  ['ttid_to_ttfd','class_initialization','1000000',1],['ttid_to_ttfd','dex2oat','3000000',1],
 ]);
 const hex=value=>Buffer.from(value).toString('hex');const parsed=parseStartupArtAttribution(`"phase_hex","category_hex","ts_ns","dur_ns","name_hex","process_hex"\n"${hex('launch_to_ttid')}","${hex('jit')}","5000000","2000000","${hex('JIT compiling Foo')}","${hex('com.example')}"\n`);
 assert.equal(parsed.groups[0].names[0],'JIT compiling Foo');assert.equal(parsed.groups[0].totalOverlapNs,'2000000');
 await assert.rejects(queryStartupArtAttribution(path,{startup:{...startup,upid:'1 OR 1=1'}}),/参数无效/);
 await assert.rejects(queryStartupArtAttribution(path,{startup:{...startup,ttfdNs:'100'}}),/参数无效/);
});
test('ART runtime diagnostics reads GC metrics and categorized ART slices from a trace',async t=>{
 try{await locateTraceProcessor();}catch{t.skip('未准备 Trace Processor');return;}
 const path=new URL('../fixtures/trace-startup-art.json',import.meta.url).pathname,{queryArtRuntimeDiagnostics,parseArtRuntimeDiagnostics}=await import('../src/trace-analysis.js');
 const result=await queryArtRuntimeDiagnostics(path);
 assert.equal(result.available,true);assert.equal(result.gcCount,0);assert.equal(result.gcReclaimedMb,null);
 assert.deepEqual(result.activities.map(x=>[x.category,x.count,x.totalDurationNs]),[
  ['class_initialization',1,'1000000'],['class_loading',1,'1000000'],['class_verification',1,'2000000'],['dex2oat',1,'3000000'],['jit',1,'2000000'],
 ]);
 const hex=value=>Buffer.from(value).toString('hex'),header='kind,category_hex,name_hex,process_hex,thread_hex,ts_ns,dur_ns,reclaimed_mb,gc_type_hex,min_heap_mb,max_heap_mb,running_ns,runnable_ns,unint_io_ns,unint_non_io_ns,int_ns';
 const parsed=parseArtRuntimeDiagnostics(`${header}\n"gc","${hex('gc')}","${hex('Garbage collection')}","${hex('com.example')}","${hex('main')}","100","200","1.5","${hex('Concurrent')}","4","8","100","20","0","0","10"\n`);
 assert.equal(parsed.gcCount,1);assert.equal(parsed.gcReclaimedMb,1.5);assert.equal(parsed.gcEvents[0].gcType,'Concurrent');assert.equal(parsed.gcEvents[0].runnableNs,'20');
 assert.throws(()=>parseArtRuntimeDiagnostics(`${header}\n"activity","${hex('unknown')}","","","","0","1","","","","","","","","",""\n`),/分类无效/);
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
