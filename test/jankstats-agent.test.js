import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Adb} from '../src/adb.js';
import {parseJankStatsLog, summarizeJankStats} from '../src/jankstats-agent.js';

function log(timestamp, pid, aggregate, priority='I') {
 return `${timestamp}  ${pid}  44 ${priority} APWJank: ${JSON.stringify(aggregate)}`;
}
function frameLog(timestamp,pid,batch){return `${timestamp}  ${pid}  44 I APWJankFrame: ${JSON.stringify(batch)}`;}
function aggregate({activity='FeedActivity',windowId='a1',states={Activity:'FeedActivity',Fragment:'FeedFragment',Screen:'home'},frameStartNs=1000000000,frameEndNs=1030000000,frameCount=2,jankCount=1,durationTotalNs=30000000,durationMinNs=10000000,durationMaxNs=20000000,histogram={'10':1,'20':1},cpuTotalNs=24000000,overrunTotalNs=3000000}={}) {
 return {version:1,activity,windowId,states,frameStartNs,frameEndNs,frameCount,jankCount,durationTotalNs,durationMinNs,durationMaxNs,histogram,cpuTotalNs,overrunTotalNs};
}

test('JankStats parser validates aggregates and summarizes per Activity, window, and UI state',()=>{
 const first=aggregate(),second=aggregate({frameStartNs:1040000000,frameEndNs:1080000000,frameCount:2,jankCount:2,durationTotalNs:50000000,durationMinNs:20000000,durationMaxNs:30000000,histogram:{'20':1,'30':1},cpuTotalNs:41000000,overrunTotalNs:8000000});
 const parsed=parseJankStatsLog(`${log('1730000000.0',4242,first)}\n${log('1730000002.0',4242,second)}\n1730000002.1 4242 44 I Other: ${JSON.stringify(first)}\n${log('1730000003.0',4242,{...first,frameCount:0})}`);
 assert.equal(parsed.items.length,2);assert.equal(parsed.ignored,2);assert.equal(parsed.items[0].pid,4242);
 const [summary]=parsed.summary;assert.equal(summary.activity,'FeedActivity');assert.equal(summary.windowId,'a1');assert.equal(summary.frameCount,4);assert.equal(summary.jankCount,3);assert.equal(summary.jankPercent,75);assert.equal(summary.durationMeanMs,20);assert.equal(summary.durationMaxMs,30);assert.equal(summary.p95Ms,30);assert.equal(summary.cpuCount,4);assert.equal(summary.overrunCount,4);
 assert.equal(summary.states.Screen,'home');assert.equal(summary.states.Fragment,'FeedFragment');
});

test('JankStats parser caps log size and returned aggregate count',()=>{
 const row=log('1730000000.0',4242,aggregate());assert.throws(()=>parseJankStatsLog(row.repeat(200000)),/8 MiB/);
 const parsed=parseJankStatsLog(Array.from({length:5},(_,index)=>log(`173000000${index}.0`,4242,aggregate({frameStartNs:1e9+index*1e7,frameEndNs:1.02e9+index*1e7}))).join('\n'),{limit:3});
 assert.equal(parsed.items.length,3);assert.equal(parsed.truncated,true);assert.equal(parsed.summary[0].frameCount,6);
});

test('JankStats parser reads bounded exact-timestamp frame batches with UI state',()=>{
 const frame={startNs:'9223372036854775000',uiDurationNs:'12000000',jank:true,cpuDurationNs:'18000000',overrunNs:'3000000'};
 const parsed=parseJankStatsLog(frameLog('1730000000.0',4242,{version:1,activity:'FeedActivity',windowId:'a1',states:{Screen:'home'},frames:[frame],dropped:2}));
 assert.equal(parsed.frames.length,1);assert.equal(parsed.frames[0].startNs,frame.startNs);assert.equal(parsed.frames[0].states.Screen,'home');assert.equal(parsed.frames[0].jank,true);assert.equal(parsed.frames[0].overrunNs,'3000000');assert.equal(parsed.droppedFrameRows,2);assert.equal(parsed.framesTruncated,true);
 assert.equal(parseJankStatsLog(frameLog('1730000000.0',4242,{version:1,activity:'A',windowId:'x',states:{},frames:[{...frame,startNs:'-1'}],dropped:0})).frames.length,0);
});

test('JankStats aggregate frame range preserves long nanosecond strings',()=>{
 const start='9223372036854775000',end='9223372036854775800';
 const parsed=parseJankStatsLog(log('1730000000.0',4242,aggregate({frameStartNs:start,frameEndNs:end}))).items[0];
 assert.equal(parsed.frameStartNs,start);assert.equal(parsed.frameEndNs,end);
});

test('ADB JankStats snapshot filters the target UID and preserves the old-device PID fallback',async()=>{
 const payload=log('1730000000.0',4242,aggregate()),calls=[];
 const adb=new Adb('adb',async(_path,args)=>{calls.push(args);return {stdout:calls.length===1?'package:com.example.app uid:10043\n':`${payload}\n`};});
 const result=await adb.jankStatsSnapshot('device-1','com.example.app');assert.equal(result.processScope,'uid');assert.equal(result.items.length,1);assert.ok(calls[1].includes("'APWJank:I'"));assert.ok(calls[1].includes("'APWJankFrame:I'"));
 const legacyCalls=[];const legacy=new Adb('adb',async(_path,args)=>{legacyCalls.push(args);const command=args.join(' ');if(command.includes("'cmd' 'package'"))throw new Error('Unrecognized Option');if(command.includes("'dumpsys' 'package'"))return {stdout:'userId=10043\n'};if(command.includes("'am' 'get-current-user'"))return {stdout:'0\n'};if(command.includes('--uid='))throw new Error('Unrecognized Option');if(command.includes("'pidof'"))return {stdout:'4242\n'};return {stdout:`${payload}\n`};});
 const fallback=await legacy.jankStatsSnapshot('device-old','com.example.app');assert.equal(fallback.processScope,'main-process');assert.equal(fallback.pid,4242);assert.equal(fallback.summary[0].jankCount,1);
 await assert.rejects(()=>adb.jankStatsSnapshot('device','com.example.app;id'),/包名/);
});

test('JankStats summary handles no optional CPU and overrun evidence',()=>{
 const row=parseJankStatsLog(log('1730000000.0',4242,aggregate({cpuTotalNs:null,overrunTotalNs:null}))).items[0];
 const [summary]=summarizeJankStats([row]);assert.equal(summary.cpuCount,0);assert.equal(summary.overrunCount,0);assert.equal(summary.p95Ms,20);
});

test('JankStats summary preserves negative API 31 overrun as deadline headroom',()=>{
 const row=parseJankStatsLog(log('1730000000.0',4242,aggregate({cpuTotalNs:null,overrunTotalNs:-4000000}))).items[0];
 const [summary]=summarizeJankStats([row]);assert.equal(summary.overrunCount,2);assert.equal(summary.overrunTotalNs,-4000000);assert.equal(summary.overrunTotalNs/summary.overrunCount/1e6,-2);
});

test('protected JankStats snapshot and Agent ZIP routes expose parsed aggregates and optional bridge',async t=>{
 const {createApp}=await import('../src/server.js');const {once}=await import('node:events');const app=createApp({adb:{path:'fake',jankStatsSnapshot:async(serial,packageName)=>({source:'adb-logcat',serial,packageName,summary:[{activity:'FeedActivity',frameCount:2,jankCount:1}]})},token:'test'});
 app.listen(0,'127.0.0.1');await once(app,'listening');t.after(()=>new Promise(resolve=>app.close(resolve)));
 const base=`http://127.0.0.1:${app.address().port}`,snapshot=`${base}/api/frames/jankstats-live`;
 assert.equal((await fetch(snapshot,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({serial:'device',packageName:'com.example.app'})})).status,403);
 const result=await fetch(snapshot,{method:'POST',headers:{'X-Workbench-Token':'test','Content-Type':'application/json'},body:JSON.stringify({serial:'device',packageName:'com.example.app'})});assert.equal(result.status,200);assert.equal((await result.json()).summary[0].jankCount,1);
 const bundle=await fetch(`${base}/api/frames/jankstats-agent-package`,{headers:{'X-Workbench-Token':'test'}});assert.equal(bundle.status,200);assert.equal(bundle.headers.get('content-type'),'application/zip');
 const {default:yauzl}=await import('yauzl'),archive=Buffer.from(await bundle.arrayBuffer());const paths=await new Promise((resolve,reject)=>yauzl.fromBuffer(archive,{lazyEntries:true},(error,zip)=>{if(error)return reject(error);const names=[];zip.on('error',reject);zip.on('end',()=>resolve(names));zip.on('entry',entry=>{names.push(entry.fileName);zip.readEntry();});zip.readEntry();}));
 assert.ok(paths.includes('src/debug/java/dev/androidperformance/agent/ApwJankStatsAgent.java'));
 assert.ok(paths.includes('optional-androidx/src/debug/java/dev/androidperformance/agent/ApwAndroidXFragmentLeakAgent.java'));
 assert.ok(paths.includes('src/debug/java/dev/androidperformance/agent/ApwLifecycleLeakAgent.java'));
 assert.ok(paths.includes('JANKSTATS_AGENT_README.md'));
 assert.ok(!paths.includes('LEAKCANARY_AGENT_README.md'));
});
