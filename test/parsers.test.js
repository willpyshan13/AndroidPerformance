import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseDevices, parseMemory, parseCpu, parseBattery, parseFrames, parseStartup, percentile, parseProcCpu, cpuDelta } from '../src/parsers.js';
import { parseHar, parseBenchmark, compareBenchmarks } from '../public/offline.js';

test('device discovery retains unauthorized/offline status and wireless serials',()=>{
  const devices=parseDevices('List of devices attached\nABC123 device product:husky model:Pixel_8_Pro device:husky transport_id:1\n192.168.1.8:5555 offline\nXYZ unauthorized\n');
  assert.equal(devices.length,3);assert.equal(devices[0].model,'Pixel 8 Pro');assert.equal(devices[1].serial,'192.168.1.8:5555');assert.equal(devices[2].state,'unauthorized');
});
test('PSS parser supports new summary and older TOTAL table without inventing RSS',()=>{
  assert.deepEqual(parseMemory('TOTAL PSS: 184,320 TOTAL RSS: 272,384\n Java Heap: 46080\n Native Heap: 30720'),{pssMb:180,rssMb:266,categories:{'Java Heap':45,'Native Heap':30}});
  assert.equal(parseMemory(' TOTAL 102400 200 90 100').pssMb,100);
  assert.equal(parseMemory('No process found').pssMb,null);
});
test('CPU sums only exact app and child process names, leaves absent evidence unavailable',()=>{
  const result=parseCpu('CPU usage from 800ms to 200ms ago:\n 12.5% 123/com.example.app: 9% user + 3.5% kernel\n 3% 456/com.example.app:worker: 3% user\n 99% 999/com.example.app2: 90% user\n 2% 99/comXexampleXapp: 2% user','com.example.app');
  assert.equal(result.percent,15.5);assert.equal(result.processes.length,2);assert.match(result.window,/800ms/);
  assert.equal(parseCpu('', 'com.example.app').percent,null);
});
test('battery scaling, zero values and missing temperature remain distinct',()=>{
  assert.deepEqual(parseBattery(' level: 0\n scale: 100\n temperature: 0\n voltage: 4000\n status: 3'),{level:0,temperatureC:0,voltageMv:4000,status:3,scope:'device'});
  assert.equal(parseBattery(' level: 86\n scale: 100').temperatureC,null);
});
test('cpuinfo accepts new-process prefix and withholds stale cached utilization',()=>{
  assert.equal(parseCpu('+12% 3/com.app: 12% user', 'com.app').percent,12);
  const stale=parseCpu('CPU usage from 60000ms to 59000ms ago:\n 12% 3/com.app: 12% user','com.app');
  assert.equal(stale.percent,null);assert.equal(stale.stale,true);
});
test('proc CPU handles process names with spaces/parentheses, ignores double-counted guest fields and detects restarts',()=>{
  const fields=Array(22).fill('0');fields[0]='S';fields[11]='30';fields[12]='10';fields[19]='500';
  const parsed=parseProcCpu(`cpu 100 0 100 800 0 0 0 0 10 20\ncpu0 0\ncpu1 0\n123 (name with ) spaces) ${fields.join(' ')}`);
  assert.deepEqual(parsed,{pid:123,ticks:40,startTicks:500,totalTicks:1000,cpuCount:2});
  const next={...parsed,ticks:65,totalTicks:1200};
  assert.equal(cpuDelta(parsed,next),25);assert.equal(cpuDelta(null,next),null);
  assert.equal(cpuDelta(parsed,{...next,startTicks:600}),null);
  assert.equal(cpuDelta(parsed,{...next,cpuCount:1}),null);
  assert.equal(cpuDelta(parsed,{...next,totalTicks:999}),null);
  assert.equal(cpuDelta(parsed,{...next,ticks:39}),null);
  assert.equal(cpuDelta(parsed,{...next,ticks:40}),0);
  assert.throws(()=>parseProcCpu('permission denied'),/无法读取/);
});
test('gfxinfo excludes flagged/incomplete frames, supports multiple windows and budgets',async()=>{
  const raw=await readFile(new URL('../fixtures/gfxinfo.txt',import.meta.url),'utf8');
  const frames=parseFrames(raw);
  assert.deepEqual(frames.frames.map(f=>f.durationMs),[10,25,8,40]);assert.equal(frames.count,4);assert.equal(frames.slowPercent,50);assert.equal(frames.p95,40);assert.equal(frames.p50,10);
  assert.equal(parseFrames(raw,8.333).slow,3);assert.equal(parseFrames('').slowPercent,null);assert.equal(percentile([], .95),null);
});
test('startup reports actual launch mode and missing TTID evidence as null',()=>{
  const launch=parseStartup('Status: ok\nLaunchState: COLD\nActivity: com.example.app/.Main\nThisTime: 310\nTotalTime: 330\nWaitTime: 350');
  assert.equal(launch.totalTimeMs,330);assert.equal(launch.observedMode,'cold');assert.equal(parseStartup('Status: ok\nWaitTime: 4').totalTimeMs,null);
});
test('HAR drops credentials, query parameters, headers and payloads; keeps missing timings unavailable',()=>{
  const rows=parseHar({log:{entries:[{request:{url:'https://user:secret@example.com/data?token=abc',method:'POST',headers:[{name:'Authorization',value:'secret'}],postData:{text:'secret'}},response:{status:201,content:{size:1024,text:'secret'}},time:0,timings:{ssl:-1,dns:0}}]}});
  assert.equal(rows[0].url,'https://example.com/data');assert.equal(rows[0].timeMs,0);assert.equal(rows[0].timings.ssl,null);assert.equal(rows[0].timings.dns,0);assert.doesNotMatch(JSON.stringify(rows),/secret|token|Authorization/);
  assert.throws(()=>parseHar({}),/log.entries/);
});
test('benchmark matches class/test/metric identity, handles absent baseline and zero denominator',()=>{
  const baseline=parseBenchmark({benchmarks:[{className:'Bench',name:'test',metrics:{timeNs:{median:100,runs:[90,100,110]},zero:{median:0}}}]});
  const current=parseBenchmark({benchmarks:[{className:'Bench',name:'test',metrics:{timeNs:{median:120,runs:[100,120,140]},zero:{median:1},newMetric:{median:3}}}]});
  const rows=compareBenchmarks(baseline,current);assert.equal(rows[0].delta,20);assert.equal(rows[1].delta,null);assert.equal(rows[2].baseline,null);
});
