import {test} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {once} from 'node:events';
import {Adb} from '../src/adb.js';
import {parseNetworkAgentLog} from '../src/network-agent.js';
import {openNetworkAgentSocket,pollNetworkAgentSocket} from '../src/network-agent-socket.js';
import {summarizeHarHosts,mergeNetworkAgentSnapshot,networkRequestEmptyState} from '../public/offline.js';
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
test('v3 agent path detail is optional, query-free and rejected when malformed',()=>{
 const id='32345678-1234-4234-8234-123456789abc';
 const row=parseNetworkAgentLog(JSON.stringify({...record,v:3,eventId:id,path:'/users/{user}/profile'})).rows[0];
 assert.equal(row.path,'/users/{user}/profile');assert.equal(row.url,'https://example.com/users/{user}/profile');
 const omitted=parseNetworkAgentLog(JSON.stringify({...record,v:3,eventId:id,path:null})).rows[0];assert.equal(omitted.path,'（未采集）');
 for(const path of ['/user/alice?token=secret','/path#fragment','/control\nvalue','x'.repeat(2049),'é'.repeat(1025)])assert.equal(parseNetworkAgentLog(JSON.stringify({...record,v:3,eventId:id,path})).invalid,1);
 assert.equal(parseNetworkAgentLog(JSON.stringify({...record,v:3,eventId:'invalid',path:'/safe'})).invalid,1);
});
test('v4 agent reports explicit protocol and connection reuse without inferring missing phases',()=>{
 const eventId='42345678-1234-4234-8234-123456789abc',v4={...record,v:4,eventId,path:null,protocol:'h2',connectionReused:true};
 const [row]=parseNetworkAgentLog(JSON.stringify(v4)).rows;assert.equal(row.protocol,'h2');assert.equal(row.connectionReused,true);assert.equal(row.path,'（未采集）');
 const unknown=parseNetworkAgentLog(JSON.stringify({...v4,protocol:null,connectionReused:null,connectNs:null}));assert.equal(unknown.rows[0].connectionReused,null);assert.equal(unknown.invalid,0);
 assert.equal(parseNetworkAgentLog(JSON.stringify({...v4,connectionReused:'yes'})).invalid,1);assert.equal(parseNetworkAgentLog(JSON.stringify({...v4,protocol:'secret/1'})).invalid,1);
 const old=parseNetworkAgentLog(JSON.stringify({...record,v:3,eventId,path:null})).rows[0];assert.equal(old.protocol,null);assert.equal(old.connectionReused,null);
});
test('network request empty state distinguishes agent wait, missing events, filters and empty imports',()=>{
 const state=(overrides={})=>networkRequestEmptyState({hasSnapshot:true,source:'adb',agentActive:false,totalRows:0,filteredRows:0,...overrides});
 assert.equal(networkRequestEmptyState({hasSnapshot:false,source:null,agentActive:false,totalRows:0,filteredRows:0}),'import');
 assert.equal(state({agentActive:true}),'agent-waiting');assert.equal(state(),'agent-empty');
 assert.equal(state({totalRows:3,filteredRows:0}),'filtered');assert.equal(state({totalRows:3,filteredRows:1}),null);
 assert.equal(state({source:'import'}),'no-requests');
});
test('ADB agent snapshot scopes logcat to exact current-user UID and never interpolates shell input',async()=>{
 const calls=[];const adb=new Adb('adb',async(_path,args)=>{calls.push(args);return {stdout:calls.length===1?'package:com.example.other uid:10042\npackage:com.example.app uid:10043\n':JSON.stringify(record)+'\n'};});
 const result=await adb.networkAgentSnapshot('device-1','com.example.app');
 assert.equal(result.uid,10043);assert.equal(result.rows.length,1);assert.ok(calls[1].includes("'--uid=10043'"));
 await assert.rejects(()=>adb.networkAgentSnapshot('device-1','com.example.app;id'),/包名/);
 const missing=new Adb('adb',async()=>({stdout:'package:com.example.app2 uid:10043\n'}));await assert.rejects(()=>missing.networkAgentSnapshot('device','com.example.app'),/UID/);
});

test('older Android falls back from unsupported UID Logcat filter to the package main PID',async()=>{
 const calls=[];const adb=new Adb('adb',async(_path,args)=>{calls.push(args);const joined=args.join(' ');if(joined.includes("'cmd' 'package'"))throw new Error('Unrecognized Option');if(joined.includes("'dumpsys' 'package'"))return {stdout:'Packages:\n  userId=10100\n'};if(joined.includes("'am' 'get-current-user'"))return {stdout:'0\n'};if(joined.includes("'logcat'")&&joined.includes('--uid='))throw new Error('Unrecognized Option');if(joined.includes("'pidof'"))return {stdout:'4321\n'};return {stdout:JSON.stringify(record)+'\n'};});
 const result=await adb.networkAgentSnapshot('device-25','com.example.app');
 assert.equal(result.uid,10100);assert.equal(result.pid,4321);assert.equal(result.processScope,'main-process');assert.equal(result.rows.length,1);assert.ok(calls.some(args=>args.includes("'--pid=4321'")));
});

test('network socket protocol validates cursor batches and bounds responses',async t=>{
 const event={...record,v:3,eventId:'12345678-1234-4234-8234-123456789abc',path:null},server=net.createServer(socket=>{let request='';socket.on('data',chunk=>{request+=chunk.toString();if(request.includes('\n')){const parsed=JSON.parse(request);assert.deepEqual(parsed,{v:1,action:'poll',token:'t'.repeat(48),cursor:0,limit:2});const payload=JSON.stringify({v:1,ok:true,cursor:1,latestCursor:1,dropped:0,events:[{cursor:1,event}]})+'\n';socket.write(payload.slice(0,17));socket.end(payload.slice(17));}});});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
 const response=await pollNetworkAgentSocket(server.address().port,'t'.repeat(48),0,2);assert.equal(response.cursor,1);assert.equal(response.events[0].cursor,1);
 await assert.rejects(()=>pollNetworkAgentSocket(server.address().port,'short',0),/令牌/);
 await assert.rejects(()=>pollNetworkAgentSocket(server.address().port,'t'.repeat(48),-1),/游标/);
});

test('network Agent starts an adb abstract-socket forward, reads incremental events, and removes it',async()=>{
 const calls=[],socketName='apw-network-';let server;
 server=net.createServer(socket=>{let request='';socket.on('data',chunk=>{request+=chunk.toString();if(request.includes('\n')){const parsed=JSON.parse(request);assert.equal(parsed.token,'s'.repeat(48));if(parsed.action==='open')socket.end(JSON.stringify({v:1,ok:true,cursor:7,latestCursor:7})+'\n');else{assert.equal(parsed.action,'poll');assert.equal(parsed.cursor,7);socket.end(JSON.stringify({v:1,ok:true,cursor:8,latestCursor:8,dropped:0,events:[{cursor:8,event:{...record,v:3,eventId:'22345678-1234-4234-8234-123456789abc',path:'/items'}}]})+'\n');}}});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 const adb=new Adb('adb',async(_path,args)=>{calls.push(args);if(args.includes('--remove'))return {stdout:''};return {stdout:String(port)};});
 const session=await adb.startNetworkAgent('device-1','com.example.app','s'.repeat(48));assert.equal(session.port,port);assert.equal(session.cursor,7);assert.equal(calls[0][2],'forward');assert.match(calls[0][4],/^localabstract:apw-network-/);assert.ok(calls[0][4].startsWith(`localabstract:${socketName}`));
 const batch=await adb.pollNetworkAgent(session.sessionId,session.cursor);assert.equal(batch.source,'adb-local-socket');assert.equal(batch.cursor,8);assert.equal(batch.rows.length,1);assert.equal(batch.rows[0].path,'/items');
 assert.deepEqual(await adb.stopNetworkAgent(session.sessionId),{stopped:true});assert.ok(calls.at(-1).includes('--remove'));assert.equal(adb.networkAgentSessions.size,0);await new Promise(resolve=>server.close(resolve));
});

test('network Agent removes its ADB forward when the app socket is unavailable',async()=>{
 const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const calls=[],adb=new Adb('adb',async(_path,args)=>{calls.push(args);return {stdout:''+port};});
 await assert.rejects(()=>adb.startNetworkAgent('device-1','com.example.app','s'.repeat(48)),/无法连接网络 Agent/);
 assert.ok(calls.some(args=>args.includes('--remove')));assert.equal(adb.networkAgentSessions.size,0);
});

test('network Agent reports forward cleanup failure and retains the session for retry',async()=>{
 const adb=new Adb('adb',async()=>{throw new Error('device offline');}),sessionId='32345678-1234-4234-8234-123456789abc';
 adb.networkAgentSessions.set(sessionId,{serial:'device-1',packageName:'com.example.app',port:43210,token:'s'.repeat(48)});
 await assert.rejects(()=>adb.stopNetworkAgent(sessionId),/无法移除网络 Agent 的 ADB 转发/);assert.equal(adb.networkAgentSessions.has(sessionId),true);
});

test('network agent HTTP endpoint returns the scoped snapshot',async t=>{
 const {createApp}=await import('../src/server.js');const {once}=await import('node:events');
 const app=createApp({adb:{path:'fake',networkAgentSnapshot:async(serial,packageName)=>({source:'adb',serial,packageName,...parseNetworkAgentLog(JSON.stringify(record))})},token:'test'});
 app.listen(0,'127.0.0.1');await once(app,'listening');t.after(()=>new Promise(resolve=>app.close(resolve)));
 const response=await fetch(`http://127.0.0.1:${app.address().port}/api/network/agent`,{method:'POST',headers:{'X-Workbench-Token':'test','Content-Type':'application/json'},body:JSON.stringify({serial:'abc',packageName:'com.example.app'})});
 assert.equal(response.status,200);const payload=await response.json();assert.equal(payload.packageName,'com.example.app');assert.equal(payload.rows[0].failed,true);
});

test('protected Network Agent session API forwards start, poll and stop lifecycle',async t=>{
 const calls=[],app=(await import('../src/server.js')).createApp({adb:{path:'fake',startNetworkAgent:async(serial,packageName,token)=>{calls.push(['start',serial,packageName,token]);return {sessionId:'12345678-1234-4234-8234-123456789abc',source:'adb-local-socket'};},pollNetworkAgent:async(sessionId,cursor,limit)=>{calls.push(['poll',sessionId,cursor,limit]);return {sessionId,cursor:5,rows:[]};},stopNetworkAgent:async sessionId=>{calls.push(['stop',sessionId]);return {stopped:true};}},token:'test'});
 app.listen(0,'127.0.0.1');await once(app,'listening');t.after(()=>new Promise(resolve=>app.close(resolve)));
 const post=async(path,body)=>fetch(`http://127.0.0.1:${app.address().port}/api/network/agent/${path}`,{method:'POST',headers:{'X-Workbench-Token':'test','Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await post('start',{serial:'device-1',packageName:'com.example.app',token:'s'.repeat(48)})).status,200);
 assert.equal((await post('poll',{sessionId:'12345678-1234-4234-8234-123456789abc',cursor:4,limit:200})).status,200);
 assert.equal((await post('stop',{sessionId:'12345678-1234-4234-8234-123456789abc'})).status,200);assert.deepEqual(calls.map(x=>x[0]),['start','poll','stop']);
 assert.equal((await fetch(`http://127.0.0.1:${app.address().port}/api/network/agent/poll`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
});

test('agent source package is downloadable and contains the actual documented sources',async t=>{
 const {createApp}=await import('../src/server.js');const {once}=await import('node:events');const {readFile}=await import('node:fs/promises');const {default:yauzl}=await import('yauzl');
 const app=createApp({adb:{path:'fake'},token:'test'});app.listen(0,'127.0.0.1');await once(app,'listening');t.after(()=>new Promise(resolve=>app.close(resolve)));
 const url=`http://127.0.0.1:${app.address().port}/api/network/agent-package`;assert.equal((await fetch(url)).status,403);
 const response=await fetch(url,{headers:{'X-Workbench-Token':'test'}});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/zip');const buffer=Buffer.from(await response.arrayBuffer());
 const entries=await new Promise((resolve,reject)=>yauzl.fromBuffer(buffer,{lazyEntries:true},(err,zip)=>{if(err)return reject(err);const files={};zip.on('error',reject);zip.on('end',()=>resolve(files));zip.on('entry',entry=>zip.openReadStream(entry,(error,stream)=>{if(error)return reject(error);const chunks=[];stream.on('data',chunk=>chunks.push(chunk));stream.on('error',reject);stream.on('end',()=>{files[entry.fileName]=Buffer.concat(chunks);zip.readEntry();});}));zip.readEntry();}));
 const sources={
  'README.md':'README.md',
  'src/debug/java/dev/androidperformance/agent/NetworkEvents.java':'src/main/java/dev/androidperformance/agent/NetworkEvents.java',
  'src/debug/java/dev/androidperformance/agent/NetworkAgentServer.java':'src/main/java/dev/androidperformance/agent/NetworkAgentServer.java',
  'src/debug/java/dev/androidperformance/agent/LogcatSink.java':'src/main/java/dev/androidperformance/agent/LogcatSink.java',
 };
 assert.deepEqual(Object.keys(entries).sort(),Object.keys(sources).sort());assert.ok(Object.keys(entries).every(path=>path==='README.md'||path.startsWith('src/debug/java/')),'network agent source must stay in the debug source set');
 for(const [path,source] of Object.entries(sources))assert.deepEqual(entries[path],await readFile(new URL('../android-agent/'+source,import.meta.url)));
});
