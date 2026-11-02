import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request } from 'node:http';
import { createApp } from '../src/server.js';
import { Adb } from '../src/adb.js';
import { parseBenchmark } from '../public/offline.js';

test('Battery Historian export endpoint returns raw checkin as downloadable text',async t=>{
 const raw='1,0,i,vers,20\n1,0,i,uid,10123,com.example.demo\n';
 const adb={batteryCheckin:async(serial,packageName)=>{assert.equal(serial,'ABC');assert.equal(packageName,'com.example.demo');return raw;}};
 const dir=await mkdtemp(join(tmpdir(),'apw-battery-export-'));const app=createApp({adb,dataDir:dir,token:'battery-export'});app.listen(0,'127.0.0.1');await once(app,'listening');
 t.after(async()=>{await new Promise(resolve=>app.close(resolve));await rm(dir,{recursive:true,force:true});});
 const response=await fetch(`http://127.0.0.1:${app.address().port}/api/battery/checkin`,{method:'POST',headers:{'X-Workbench-Token':'battery-export','Content-Type':'application/json'},body:JSON.stringify({serial:'ABC',packageName:'com.example.demo'})});
 assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'text/csv; charset=utf-8');assert.match(response.headers.get('content-disposition'),/batterystats-checkin\.csv/);assert.equal(await response.text(),raw);
});

test('benchmark API runs instrumentation, auto-loads only a freshly updated report and rejects invalid arguments',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'apw-benchmark-api-'));let calls=0,statCalls=0;const now=Math.floor(Date.now()/1000);
 const adb=new Adb('/fake',async(_path,args)=>{calls++;if(args.includes("'stat'")){statCalls++;return {stdout:statCalls===1?`${now-2} 12\n`:`${now} 20\n`};}return {stdout:args.includes("'head'")?'{"benchmarks":[]}':'OK (1 test)\n'};});
 const app=createApp({adb,dataDir:dir,token:'test'});app.listen(0,'127.0.0.1');await once(app,'listening');t.after(async()=>{await new Promise(resolve=>app.close(resolve));await rm(dir,{recursive:true,force:true});});
 const url=`http://127.0.0.1:${app.address().port}/api/benchmark/run`,headers={'Content-Type':'application/json','X-Workbench-Token':'test'};
 const post=body=>fetch(url,{method:'POST',headers,body:JSON.stringify(body)});
 const response=await post({serial:'ABC',component:'com.example.test/.Runner',testClass:'com.example.Bench#startup'});assert.equal(response.status,200);const run=await response.json();assert.equal(run.status,'completed');assert.equal(run.reportStatus,'updated');assert.deepEqual(run.report,{benchmarks:[]});assert.match(run.reportPath,/com\.example\.test-benchmarkData\.json$/);assert.equal(calls,4);
 const rejected=await post({serial:'ABC',component:'com.example.test/.Runner;reboot'});assert.notEqual(rejected.status,200);assert.equal(calls,4);
 const report=await fetch(`http://127.0.0.1:${app.address().port}/api/benchmark/report`,{method:'POST',headers,body:JSON.stringify({serial:'ABC',path:'/sdcard/Android/media/com.example.test/result.json'})});assert.equal(report.status,200);assert.deepEqual((await report.json()).report,{benchmarks:[]});assert.equal(calls,5);
});

test('benchmark run does not attach an unchanged historic report',async()=>{
 let stats=0,reads=0;const now=Math.floor(Date.now()/1000),adb=new Adb('/fake',async(_path,args)=>{if(args.includes("'stat'")){stats++;return {stdout:`${now-10} 512\n`};}if(args.includes("'head'")){reads++;return {stdout:'{}'};}return {stdout:'OK (1 test)\n'};});
 const result=await adb.runBenchmark('ABC','com.example.test/.Runner');assert.equal(result.status,'completed');assert.equal(result.reportStatus,'unchanged');assert.equal(result.report,null);assert.equal(reads,0);
});

test('local HTTP API, origin protection, frames import and persistent session round-trip',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'apw-test-'));
  const adb={path:'/fake/adb',devices:async()=>[{serial:'ABC',state:'device',model:'Pixel'}]};
  const app=createApp({adb,dataDir:dir,token:'test-token'});app.listen(0,'127.0.0.1');await once(app,'listening');
  t.after(async()=>{await new Promise(r=>app.close(r));await rm(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${app.address().port}`;
  const headers={'X-Workbench-Token':'test-token','Content-Type':'application/json'};
  const html=await (await fetch(base)).text();assert.match(html,/test-token/);assert.doesNotMatch(html,/__API_TOKEN__/);
  assert.equal((await fetch(`${base}/api/devices`)).status,403);
  assert.equal((await fetch(`${base}/api/devices`,{headers:{...headers,Origin:'https://evil.example'}})).status,403);
  const invalidHostStatus=await new Promise((resolve,reject)=>{const req=request(`${base}/api/devices`,{headers:{...headers,Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});
  assert.equal(invalidHostStatus,403);
  assert.equal((await (await fetch(`${base}/api/devices`,{headers})).json()).devices[0].serial,'ABC');
  assert.equal((await fetch(`${base}/api/sessions`,{method:'POST',headers,body:'bad JSON'})).status,400);
  const record={name:'演示监控',kind:'monitor',source:'demo',packageName:'com.example.app',payload:{samples:[{source:'demo',timestamp:1,cpu:{percent:10}}]}};
  const response=await fetch(`${base}/api/sessions`,{method:'POST',headers,body:JSON.stringify(record)});assert.equal(response.status,201);
  const saved=await response.json();assert.equal(saved.schemaVersion,1);
  const list=await (await fetch(`${base}/api/sessions`,{headers})).json();assert.equal(list.sessions[0].id,saved.id);assert.equal(list.sessions[0].source,'demo');
  const loaded=await (await fetch(`${base}/api/sessions/${saved.id}`,{headers})).json();assert.deepEqual(loaded.payload,record.payload);
  const batteryText=await readFile(new URL('../fixtures/battery-checkin.txt',import.meta.url),'utf8');
  const battery=await (await fetch(`${base}/api/battery/import`,{method:'POST',headers,body:JSON.stringify({text:batteryText,packageName:'com.example.demo'})})).json();
  const before={...battery,source:'adb',serial:'ABC'},after=structuredClone(before);after.timestamp++;after.network.wifiRxBytes+=100;
  const comparison=await (await fetch(`${base}/api/battery/compare`,{method:'POST',headers,body:JSON.stringify({before,after})})).json();assert.equal(comparison.network.wifiRxBytes,100);
  const experiment={kind:'battery',source:'adb',name:'电池实验',packageName:after.packageName,payload:{source:'adb',packageName:after.packageName,before,snapshot:after}};
  const batteryResponse=await fetch(`${base}/api/sessions`,{method:'POST',headers,body:JSON.stringify(experiment)});assert.equal(batteryResponse.status,201);
  const stored=await batteryResponse.json();const restored=await (await fetch(`${base}/api/sessions/${stored.id}`,{headers})).json();assert.deepEqual(restored.payload,experiment.payload);
  restored.payload.before.jobs[0].count=-1;assert.equal((await fetch(`${base}/api/sessions`,{method:'POST',headers,body:JSON.stringify(restored)})).status,400);
  const benchJson=JSON.parse(await readFile(new URL('../fixtures/benchmark-baseline.json',import.meta.url),'utf8'));
  const bench={...parseBenchmark(benchJson),source:'import',fileName:'baseline.json'};
  const benchResponse=await fetch(`${base}/api/sessions`,{method:'POST',headers,body:JSON.stringify({kind:'benchmark',source:'import',payload:bench})});assert.equal(benchResponse.status,201);
  const benchSaved=await benchResponse.json();const benchLoaded=await (await fetch(`${base}/api/sessions/${benchSaved.id}`,{headers})).json();assert.deepEqual(benchLoaded.payload,bench);
  assert.equal((await fetch(`${base}/api/sessions/00000000-0000-0000-0000-000000000000`,{headers})).status,404);
  const text=await readFile(new URL('../fixtures/gfxinfo.txt',import.meta.url),'utf8');
  const frames=await (await fetch(`${base}/api/frames/import`,{method:'POST',headers,body:JSON.stringify({text,budget:16.667})})).json();assert.equal(frames.source,'import');assert.equal(frames.count,4);
  assert.equal((await fetch(`${base}/api/frames/import`,{method:'POST',headers,body:JSON.stringify({text:'invalid',budget:16.667})})).status,400);
});
