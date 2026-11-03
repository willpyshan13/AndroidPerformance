import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Adb} from '../src/adb.js';
import {parseLeakCanaryLog} from '../src/leakcanary-live.js';

const watching='1730000000.123456789  4242  4243 D LeakCanary: Watching instance of com.example.MainActivity with key abc';
const retained='1730000001.500000000  4242  4243 W LeakCanary: Retained object found: com.example.MainActivity';

test('LeakCanary log parser keeps recognized lifecycle events and discards unrelated log contents',()=>{
 const result=parseLeakCanaryLog(`--------- beginning of main\n${watching}\n1730000000.2 4242 4243 D LeakCanary: arbitrary secret-token\n1730000000.3 4242 4243 D OtherTag: Watching instance\n${retained}`);
 assert.equal(result.items.length,2);assert.equal(result.items[0].category,'retained');assert.equal(result.items[1].category,'watching');
 assert.equal(result.items[1].timestamp,1730000000123);assert.equal(result.items[0].pid,4242);assert.equal(result.ignored,2);
 assert.doesNotMatch(JSON.stringify(result),/secret-token|OtherTag/);
});

test('LeakCanary parser caps returned events and validates timestamp/PID from epoch rows',()=>{
 const rows=Array.from({length:5},(_,i)=>`173000000${i}.0  4242  4243 I LeakCanary: Watching object ${i}`).join('\n');
 const result=parseLeakCanaryLog(rows,{limit:3});assert.equal(result.items.length,3);assert.equal(result.truncated,true);assert.equal(result.items[0].message,'Watching object 4');
 assert.equal(parseLeakCanaryLog('not a log line').items.length,0);
});

test('LeakCanary live parser recognizes the optional Debug Agent and lifecycle candidates',()=>{
 const rows='1730000002.0  4242  4243 I APWLeakCanary: Watching object id=abc class=com.example.MainActivity\n1730000007.0  4242  4243 W APWLeakCanary: Retained object candidate id=abc class=com.example.MainActivity elapsedMs=5000\n1730000008.0  4242  4243 I APWLeakCanary: Object was collected id=abc class=com.example.MainActivity';
 const result=parseLeakCanaryLog(rows);assert.equal(result.items.length,3);assert.deepEqual(result.items.map(item=>item.category),['cleared','retained','watching']);assert.ok(result.items.every(item=>item.source==='apw-debug-agent'));
 assert.match(result.items[1].message,/candidate/);
});

test('ADB LeakCanary snapshot filters by app UID and falls back to the app PID on older Logcat',async()=>{
 const calls=[];const adb=new Adb('adb',async(_path,args)=>{calls.push(args);return {stdout:calls.length===1?'package:com.example.app uid:10043\n':`${watching}\n`};});
 const result=await adb.leakCanarySnapshot('device-1','com.example.app');
 assert.equal(result.uid,10043);assert.equal(result.processScope,'uid');assert.equal(result.items[0].category,'watching');assert.ok(calls[1].includes("'--uid=10043'"));assert.ok(calls[1].includes("'APWLeakCanary:I'"));
 const legacyCalls=[];const legacy=new Adb('adb',async(_path,args)=>{legacyCalls.push(args);const command=args.join(' ');if(command.includes("'cmd' 'package'"))throw new Error('Unrecognized Option');if(command.includes("'dumpsys' 'package'"))return {stdout:'userId=10100\n'};if(command.includes("'am' 'get-current-user'"))return {stdout:'0\n'};if(command.includes('--uid='))throw new Error('Unrecognized Option');if(command.includes("'pidof'"))return {stdout:'4242\n'};return {stdout:`${watching}\n`};});
 const fallback=await legacy.leakCanarySnapshot('device-old','com.example.app');assert.equal(fallback.processScope,'main-process');assert.equal(fallback.pid,4242);assert.ok(legacyCalls.some(args=>args.includes("'--pid=4242'")));
 await assert.rejects(()=>adb.leakCanarySnapshot('device','com.example.app;id'),/包名/);
});

test('LeakCanary Debug Agent source package and protected download route are available',async t=>{
 const {buildLeakCanaryAgentPackage}=await import('../src/agent-package.js');const {default:yauzl}=await import('yauzl');const archive=await buildLeakCanaryAgentPackage();
 const entries=await new Promise((resolve,reject)=>yauzl.fromBuffer(archive,{lazyEntries:true},(error,zip)=>{if(error)return reject(error);const names=[];zip.on('error',reject);zip.on('end',()=>resolve(names));zip.on('entry',entry=>{names.push(entry.fileName);zip.readEntry();});zip.readEntry();}));
 assert.ok(entries.includes('src/debug/java/dev/androidperformance/agent/ApwLifecycleLeakAgent.java'));assert.ok(entries.includes('src/debug/AndroidManifest.xml'));assert.ok(entries.includes('LEAKCANARY_AGENT_README.md'));
 const {createApp}=await import('../src/server.js');const {once}=await import('node:events');const app=createApp({adb:{path:'fake'},token:'test'});app.listen(0,'127.0.0.1');await once(app,'listening');t.after(()=>new Promise(resolve=>app.close(resolve)));
 const url=`http://127.0.0.1:${app.address().port}/api/heap/leakcanary-agent-package`;assert.equal((await fetch(url)).status,403);
 const response=await fetch(url,{headers:{'X-Workbench-Token':'test'}});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/zip');
});

test('LeakCanary live snapshot endpoint is protected and returns only parsed events',async t=>{
 const {createApp}=await import('../src/server.js');const {once}=await import('node:events');
 const app=createApp({adb:{path:'fake',leakCanarySnapshot:async(serial,packageName)=>({source:'adb-logcat',serial,packageName,...parseLeakCanaryLog(watching)})},token:'test'});
 app.listen(0,'127.0.0.1');await once(app,'listening');t.after(()=>new Promise(resolve=>app.close(resolve)));
 const url=`http://127.0.0.1:${app.address().port}/api/heap/leakcanary-live`;
 assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
 const response=await fetch(url,{method:'POST',headers:{'X-Workbench-Token':'test','Content-Type':'application/json'},body:JSON.stringify({serial:'device',packageName:'com.example.app'})});
 assert.equal(response.status,200);const payload=await response.json();assert.equal(payload.items[0].category,'watching');assert.equal(payload.packageName,'com.example.app');
});
