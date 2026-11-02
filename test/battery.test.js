import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseBatteryStats,compareBatteryStats} from '../src/battery.js';
import {Adb} from '../src/adb.js';
import {validateRecord} from '../src/records.js';
const raw=await readFile(new URL('../fixtures/battery-checkin.txt',import.meta.url),'utf8');
test('battery checkin identifies shared UID and parses only UID-scoped evidence',()=>{
 const x=parseBatteryStats(raw,'com.example.demo',{serial:'ABC',batteryRaw:'level: 50\nscale: 100\ntemperature: 320',source:'adb'});
 assert.equal(x.uid,10123);assert.deepEqual(x.packages,['com.example.demo','com.example.shared']);assert.equal(x.sessionStart,1700000000000);assert.equal(x.battery.level,50);assert.equal(x.network.wifiRxBytes,400);assert.equal(x.wakelocks[0].partial.timeMs,100);assert.equal(x.jobs[0].count,3);assert.equal(x.alarms[0].count,7);assert.equal(x.alarms[0].timeMs,null);
});
test('battery comparison returns only evidenced monotonic deltas and detects reset',()=>{
 const a=parseBatteryStats(raw,'com.example.demo',{serial:'ABC'}),b=structuredClone(a);b.timestamp=a.timestamp+100;b.network.wifiRxBytes=450;b.network.mobileRxBytes=20;b.jobs[0].timeMs=280;b.alarms[0].count=9;b.jobs.push({name:'new',timeMs:50,count:1});
 const d=compareBatteryStats(a,b);assert.equal(d.network.wifiRxBytes,50);assert.equal(d.network.mobileRxBytes,null);assert.equal(d.jobs[0].timeMs,30);assert.equal(d.alarms[0].count,2);assert.equal(d.jobs[1].timeMs,null);assert.ok(d.warnings.length);
 b.sessionStart++;assert.throws(()=>compareBatteryStats(a,b),/重置/);
});
test('battery checkin refuses ambiguous UID and never assumes absent network is zero',()=>{
 assert.throws(()=>parseBatteryStats(raw+'9,0,i,uid,20123,com.example.demo\n','com.example.demo'),/多个 UID/);
 const x=parseBatteryStats(raw.replace(/^.*?,nt,.*\n/m,''),'com.example.demo');assert.equal(x.network,null);
});
test('device battery snapshot uses quoted arguments and releases lock',async()=>{
 const calls=[];const adb=new Adb('adb',async(_p,args)=>{calls.push(args.join(' '));return {stdout:args.join(' ').includes('batterystats')?raw:'level: 50\nscale: 100'};});
 const snap=await adb.batterySnapshot('ABC','com.example.demo');assert.equal(snap.uid,10123);assert.ok(calls.some(s=>s.includes("'--checkin'")));assert.equal(adb.busy.size,0);
});

test('battery snapshot archive validates and rejects malformed resource entries',()=>{
 const snapshot=parseBatteryStats(raw,'com.example.demo');
 assert.doesNotThrow(()=>validateRecord({kind:'battery',source:'import',payload:snapshot}));
 snapshot.jobs[0].timeMs=-1;assert.throws(()=>validateRecord({kind:'battery',source:'import',payload:snapshot}),/资源统计/);
});

test('UID power estimate is recognized only from one valid UID pwi row',()=>{
 const record='9,10123,l,pwi,uid,0.00123,0,0,0\n';const parsed=parseBatteryStats(raw+record,'com.example.demo');
 assert.deepEqual(parsed.power,{estimatedMah:0.00123,rawValue:'0.00123',source:'batterystats-pwi'});
 assert.equal(parseBatteryStats(raw+'9,0,l,pwi,uid,3.0\n','com.example.demo').power,null);
 assert.equal(parseBatteryStats(raw+record+record,'com.example.demo').power,null);
 assert.equal(parseBatteryStats(raw+'9,10123,l,pwi,uid,-1\n','com.example.demo').power,null);
 assert.equal(parseBatteryStats(raw+'9,10123,l,pwi,uid,0\n','com.example.demo').power.estimatedMah,0);
 const valid={...parsed,source:'import'};assert.doesNotThrow(()=>validateRecord({kind:'battery',source:'import',payload:valid}));
 valid.power.rawValue='2';assert.throws(()=>validateRecord({kind:'battery',source:'import',payload:valid}),/估计格式/);
});
