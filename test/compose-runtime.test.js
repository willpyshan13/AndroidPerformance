import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseComposeRecompositionLog} from '../src/compose-runtime.js';
import {Adb} from '../src/adb.js';

const name64=Buffer.from('FeedScreen').toString('base64url');
function event(id,count,time,name=name64,session='9'.repeat(32)){return `APW1|${session}|${id}|${name}|${count}|${time}`;}

test('Compose probe parser aggregates per-instance cumulative counts without merging distinct instances',()=>{
 const raw=[event('z'.repeat(32),99,90,name64,'8'.repeat(32)),event('a'.repeat(32),1,100),event('a'.repeat(32),3,300),event('b'.repeat(32),2,200),event('c'.repeat(32),5,400,Buffer.from('Card').toString('base64url'))].join('\n');
 const result=parseComposeRecompositionLog(raw,{serial:'device',packageName:'com.example.app',uid:10001,timestamp:123});
 assert.deepEqual(result.composables,[{name:'Card',measurement:'side-effect',recompositions:5,instances:1,lastElapsedNs:'400'},{name:'FeedScreen',measurement:'side-effect',recompositions:5,instances:2,lastElapsedNs:'300'}]);
 assert.equal(result.eventCount,4);assert.equal(result.events.length,4);assert.equal(result.source,'adb-logcat');assert.match(result.note,/不代表实际重组/);
});

test('automatic Compose execution records aggregate by function without inventing instance identities',()=>{
 const automatic=(time,name=name64,session='9'.repeat(32))=>`APW2|${session}|${name}|${time}`;
 const result=parseComposeRecompositionLog([automatic(100),automatic(200),automatic(300,Buffer.from('Card').toString('base64url'))].join('\n'));
 assert.deepEqual(result.composables,[
  {name:'FeedScreen',measurement:'automatic-execution',executions:2,skips:0,instances:null,lastElapsedNs:'200'},
  {name:'Card',measurement:'automatic-execution',executions:1,skips:0,instances:null,lastElapsedNs:'300'}
 ]);
 assert.equal(result.events[0].measurement,'automatic-execution');assert.equal(result.events[0].instanceId,null);
 assert.match(result.note,/非跳过分支/);
});

test('automatic Compose parser keeps cumulative execution and skip counts distinct',()=>{
 const exec=(count,time)=>`APW2|${'a'.repeat(32)}|${name64}|${count}|${time}`;
 const skip=(count,time)=>`APW3|${'a'.repeat(32)}|${name64}|${count}|${time}`;
 const result=parseComposeRecompositionLog([exec(1,100),skip(1,150),exec(4,300),skip(3,350)].join('\n'));
 assert.deepEqual(result.composables,[{name:'FeedScreen',measurement:'automatic-execution',executions:4,skips:3,instances:null,lastElapsedNs:'350'}]);
 assert.deepEqual(result.events.map(x=>x.measurement),['automatic-execution','automatic-skip','automatic-execution','automatic-skip']);
 assert.equal(result.events[3].count,3);assert.equal(result.invalidRecords,0);
});

test('automatic Compose records preserve parent calls and build a bounded call tree',()=>{
 const enc=value=>Buffer.from(value).toString('base64url'),session='b'.repeat(32);
 const event=(prefix,name,count,edgeCount,parent='-')=>`${prefix}|${session}|${enc(name)}|${count}|${count*100}|${parent==='-'?parent:enc(parent)}|${edgeCount}`;
 const result=parseComposeRecompositionLog([
  event('APW2','Screen',1,1),event('APW2','Card',1,1,'Screen'),event('APW2','Card',2,2,'Screen'),event('APW3','Card',3,1,'Screen')
 ].join('\n'));
 assert.deepEqual(result.callTree,[{name:'Screen',executions:1,skips:0,recursive:false,children:[{name:'Card',executions:2,skips:1,recursive:false,children:[]}]}]);
 assert.equal(result.events[1].parentName,'Screen');assert.equal(result.invalidRecords,0);
});

test('Compose probe parser rejects malformed records and bounds event details',()=>{
 const raw=[event('d'.repeat(32),1,10),'APW1|bad|bad|0|x',...Array.from({length:505},(_,i)=>event('e'.repeat(24)+i.toString(16).padStart(8,'0'),i+1,i+20))].join('\n');
 const result=parseComposeRecompositionLog(raw);
 assert.equal(result.invalidRecords,1);assert.equal(result.eventCount,506);assert.equal(result.events.length,500);assert.equal(result.truncated,true);
 assert.throws(()=>parseComposeRecompositionLog('x'.repeat(8*1024*1024+1)),/8 MiB/);
});

test('ADB Compose observation scopes Logcat to the target main process PID',async()=>{
 const calls=[],raw=event('f'.repeat(32),4,400);
 const adb=new Adb('adb',async(_path,args)=>{calls.push(args);return {stdout:calls.length===1?'12345\n':raw+'\n'};});
 const result=await adb.composeRecompositionSnapshot('device-1','com.example.app');
 assert.equal(result.pid,12345);assert.equal(result.composables[0].recompositions,4);assert.ok(calls[1].includes("'--pid=12345'"));assert.ok(calls[1].includes("'APWCompose:D'"));
 await assert.rejects(()=>adb.composeRecompositionSnapshot('device-1','com.example.app;id'),/包名/);
 const missing=new Adb('adb',async()=>({stdout:''}));await assert.rejects(()=>missing.composeRecompositionSnapshot('device','com.example.app'),/主进程未运行/);
});

test('Compose observation endpoint is protected by the local workbench token',async t=>{
 const {createApp}=await import('../src/server.js');const {once}=await import('node:events');
 const app=createApp({adb:{path:'fake',composeRecompositionSnapshot:async(serial,packageName)=>({source:'adb-logcat',serial,packageName,composables:[]})},token:'workbench'});
 app.listen(0,'127.0.0.1');await once(app,'listening');t.after(()=>new Promise(resolve=>app.close(resolve)));
 const url=`http://127.0.0.1:${app.address().port}/api/compose/recompositions`,body=JSON.stringify({serial:'abc',packageName:'com.example.app'});
 assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body})).status,403);
 const response=await fetch(url,{method:'POST',headers:{'X-Workbench-Token':'workbench','Content-Type':'application/json'},body});assert.equal(response.status,200);assert.equal((await response.json()).packageName,'com.example.app');
});
