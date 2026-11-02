import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Adb} from '../src/adb.js';
import {parseNetworkAgentLog} from '../src/network-agent.js';
import {summarizeHarHosts,mergeNetworkAgentSnapshot} from '../public/offline.js';
const record={v:1,scheme:'https',host:'example.com',port:443,method:'GET',status:200,startedAtMs:10,elapsedNs:2000000,responseBytes:12,dnsNs:0,connectNs:1000000,tlsNs:500000,failed:true};
test('agent records are validated, normalized and cannot leak additional fields',()=>{
 const data=parseNetworkAgentLog(`--------- beginning of main\n${JSON.stringify({...record,secret:'token',path:'/secret'})}\n{broken}\n${JSON.stringify({...record,host:'user:pass@evil.com'})}`);
 assert.equal(data.rows.length,1);assert.equal(data.invalid,2);assert.equal(data.rows[0].timeMs,2);assert.equal(data.rows[0].timings.ssl,.5);assert.equal(data.rows[0].path,'（未采集）');assert.doesNotMatch(JSON.stringify(data),/token|\/secret/);
 assert.equal(summarizeHarHosts(data.rows)[0].failures,1);
});
test('agent phase timings retain missing values and reject invalid values',()=>{
 const data=parseNetworkAgentLog(JSON.stringify({...record,waitNs:1200000,receiveNs:3400000}));
 assert.equal(data.rows[0].timings.wait,1.2);assert.equal(data.rows[0].timings.receive,3.4);
 assert.equal(parseNetworkAgentLog(JSON.stringify(record)).rows[0].timings.wait,null);
 assert.equal(parseNetworkAgentLog(JSON.stringify({...record,waitNs:-1})).invalid,1);
});
test('v2 event identities preserve repeated identical calls across rolling snapshots',()=>{
 const a='12345678-1234-4234-8234-123456789abc',b='12345678-1234-4234-8234-123456789abd',c='12345678-1234-4234-8234-123456789abe';
 const parse=(...ids)=>parseNetworkAgentLog(ids.map(eventId=>JSON.stringify({...record,v:2,eventId})).join('\n')).rows;
 const rows=parse(a,b);assert.equal(rows.length,2);assert.equal(rows[0].eventId,a);
 assert.equal(parseNetworkAgentLog(JSON.stringify({...record,v:2,eventId:'unsafe'})).invalid,1);
 let merged=mergeNetworkAgentSnapshot(null,{rows},2);assert.equal(merged.result.rows.length,2);
 merged=mergeNetworkAgentSnapshot(merged.state,{rows:parse(b,c)},2);assert.deepEqual(merged.result.rows.map(r=>r.eventId),[b,c]);assert.equal(merged.result.dropped,1);
 merged=mergeNetworkAgentSnapshot(merged.state,{rows:parse(a,b,c)},2);assert.deepEqual(merged.result.rows.map(r=>r.eventId),[b,c]);assert.equal(merged.result.dropped,1);
 const legacy=parseNetworkAgentLog(JSON.stringify(record)).rows;merged=mergeNetworkAgentSnapshot(merged.state,{rows:legacy},2);assert.equal(merged.result.legacy,1);assert.equal(merged.result.displayTruncated,true);assert.deepEqual(merged.result.rows.map(r=>r.id),[1,2]);
});
test('ADB agent snapshot scopes logcat to exact current-user UID and never interpolates shell input',async()=>{
 const calls=[];const adb=new Adb('adb',async(_path,args)=>{calls.push(args);return {stdout:calls.length===1?'package:com.example.other uid:10042\npackage:com.example.app uid:10043\n':JSON.stringify(record)+'\n'};});
 const result=await adb.networkAgentSnapshot('device-1','com.example.app');
 assert.equal(result.uid,10043);assert.equal(result.rows.length,1);assert.ok(calls[1].includes("'--uid=10043'"));
 await assert.rejects(()=>adb.networkAgentSnapshot('device-1','com.example.app;id'),/包名/);
 const missing=new Adb('adb',async()=>({stdout:'package:com.example.app2 uid:10043\n'}));await assert.rejects(()=>missing.networkAgentSnapshot('device','com.example.app'),/UID/);
});

test('network agent HTTP endpoint returns the scoped snapshot',async t=>{
 const {createApp}=await import('../src/server.js');const {once}=await import('node:events');
 const app=createApp({adb:{path:'fake',networkAgentSnapshot:async(serial,packageName)=>({source:'adb',serial,packageName,...parseNetworkAgentLog(JSON.stringify(record))})},token:'test'});
 app.listen(0,'127.0.0.1');await once(app,'listening');t.after(()=>new Promise(resolve=>app.close(resolve)));
 const response=await fetch(`http://127.0.0.1:${app.address().port}/api/network/agent`,{method:'POST',headers:{'X-Workbench-Token':'test','Content-Type':'application/json'},body:JSON.stringify({serial:'abc',packageName:'com.example.app'})});
 assert.equal(response.status,200);const payload=await response.json();assert.equal(payload.packageName,'com.example.app');assert.equal(payload.rows[0].failed,true);
});

test('agent source package is downloadable and contains the actual documented sources',async t=>{
 const {createApp}=await import('../src/server.js');const {once}=await import('node:events');const {readFile}=await import('node:fs/promises');const {default:yauzl}=await import('yauzl');
 const app=createApp({adb:{path:'fake'},token:'test'});app.listen(0,'127.0.0.1');await once(app,'listening');t.after(()=>new Promise(resolve=>app.close(resolve)));
 const url=`http://127.0.0.1:${app.address().port}/api/network/agent-package`;assert.equal((await fetch(url)).status,403);
 const response=await fetch(url,{headers:{'X-Workbench-Token':'test'}});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/zip');const buffer=Buffer.from(await response.arrayBuffer());
 const entries=await new Promise((resolve,reject)=>yauzl.fromBuffer(buffer,{lazyEntries:true},(err,zip)=>{if(err)return reject(err);const files={};zip.on('error',reject);zip.on('end',()=>resolve(files));zip.on('entry',entry=>zip.openReadStream(entry,(error,stream)=>{if(error)return reject(error);const chunks=[];stream.on('data',chunk=>chunks.push(chunk));stream.on('error',reject);stream.on('end',()=>{files[entry.fileName]=Buffer.concat(chunks);zip.readEntry();});}));zip.readEntry();}));
 const paths=['README.md','src/main/java/dev/androidperformance/agent/NetworkEvents.java','src/main/java/dev/androidperformance/agent/LogcatSink.java'];assert.deepEqual(Object.keys(entries).sort(),paths.slice().sort());
 for(const path of paths)assert.deepEqual(entries[path],await readFile(new URL('../android-agent/'+path,import.meta.url)));
});
