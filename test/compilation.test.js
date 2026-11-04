import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCompilationState} from '../src/parsers.js';
import {Adb} from '../src/adb.js';
import {validateRecord} from '../src/records.js';
import {apkBaselineEvidence} from '../public/offline.js';
const raw=`Packages:
  Package [com.example.app]
Dexopt state:
  [com.example.app]
    path: /data/app/example/base.apk
      arm64: [status=speed-profile] [reason=install]
      arm: [status=verify] [reason=unknown]
    /data/app/example/split_feature.apk
      arm64: [status=speed] [reason=cmdline] [primary-abi]
  [com.example.other]
    path: /data/app/other/base.apk
      arm64: [status=speed] [reason=install]
Other state:
  [com.example.app]
    path: /data/app/wrong/base.apk
      arm64: [status=wrong] [reason=wrong]
`;
test('Dexopt parser matches exact package, paths and architectures within the section',()=>{
 const r=parseCompilationState(raw,'com.example.app');assert.equal(r.available,true);assert.equal(r.entries.length,3);assert.deepEqual(r.entries[0],{path:'/data/app/example/base.apk',isa:'arm64',status:'speed-profile',reason:'install'});assert.equal(r.entries[2].path,'/data/app/example/split_feature.apk');
 assert.equal(parseCompilationState(raw,'com.example.ap').available,false);assert.equal(parseCompilationState('Permission denied','com.example.app').available,false);
});
test('compilation snapshots preserve unavailable evidence and are safely tied to startup records',async()=>{
 const adb=new Adb('adb',async(_p,args)=>{assert.ok(args.join(' ').includes("'dumpsys' 'package' 'com.example.app'"));return {stdout:raw};});
 const snapshot=await adb.compilationSnapshot('ABC','com.example.app');assert.equal(snapshot.entries.length,3);assert.equal(snapshot.source,'adb');
 const p={source:'adb',serial:'ABC',packageName:'com.example.app',requestedMode:'cold',results:[{run:1,totalTimeMs:1}],meanMs:1,compilationBefore:snapshot,compilationAfter:snapshot};
 assert.doesNotThrow(()=>validateRecord({kind:'startup',source:'adb',payload:p}));p.compilationBefore={...snapshot,packageName:'com.example.other'};assert.throws(()=>validateRecord({kind:'startup',source:'adb',payload:p}),/来源不一致/);
 const denied=new Adb('adb',async()=>{throw new Error('permission denied');});const failure=await denied.compilationSnapshot('ABC','com.example.app');assert.equal(failure.available,false);assert.match(failure.reason,/permission denied/);
});
test('startup keeps successful measurements when compilation evidence is unavailable',async()=>{
 let statsCalls=0,agentCalls=0,eventReads=0;const calls=[];const adb=new Adb('adb',async(_p,args)=>{const s=args.join(' ');calls.push(s);if(s.includes("'resolve-activity'"))return {stdout:'com.example.app/.Main\n'};if(s.includes("'dumpsys' 'package'")){statsCalls++;throw new Error('unsupported');}if(s.includes("'logcat' '-b' 'events'")){eventReads++;const old='I/am_activity_launch_time( 0): [0, 100, com.example.app/.Main, 30, 40]\n';return {stdout:eventReads===1?old:old+'I/am_activity_launch_time( 0): [0, 101, com.example.app/.Main, 55, 65]\n'};}if(s.includes("'start' '-W'"))return {stdout:'Status: ok\nLaunchState: COLD\nTotalTime: 120\n'};return {stdout:''};});adb.startupAgentSnapshot=async()=>{agentCalls++;return {processSessionId:'0123456789abcdef0123456789abcdef',eventCount:1,events:[{processSessionId:'0123456789abcdef0123456789abcdef',activityId:'11111111111111111111111111111111',name:agentCalls===1?'activity-created':'first-draw',activity:'com.example.app.Main',pid:42,monotonicNs:String(agentCalls*1000000)}]};};
 const result=await adb.startup('ABC','com.example.app',{mode:'cold',runs:1});assert.equal(result.meanMs,120);assert.equal(statsCalls,2);assert.equal(result.compilationBefore.available,false);assert.equal(result.compilationAfter.available,false);assert.equal(result.compilationMode,'unchanged');assert.equal(result.compilationAction.applied,false);assert.equal(calls.some(s=>s.includes("'compile'")),false);assert.equal(adb.busy.size,0);
 assert.equal(agentCalls,0);
 const paired=await adb.startup('ABC','com.example.app',{mode:'cold',runs:1,captureAgentMilestones:true});assert.equal(paired.results[0].agentEvidence.available,true);assert.deepEqual(paired.results[0].agentEvidence.events.map(event=>event.name),['first-draw']);assert.equal(agentCalls,2);assert.doesNotThrow(()=>validateRecord({kind:'startup',source:'adb',payload:paired}));
 const system=await adb.startup('ABC','com.example.app',{mode:'cold',runs:1,captureSystemMilestones:true});assert.equal(eventReads,2);assert.equal(system.results[0].systemEvidence.ttidMs,65);assert.equal(system.results[0].systemEvidence.ttfdMs,null);assert.doesNotThrow(()=>validateRecord({kind:'startup',source:'adb',payload:system}));
});
test('startup applies only the selected ART compilation mode before measuring and records the command output',async()=>{
 const calls=[];const adb=new Adb('adb',async(_p,args)=>{const s=args.join(' ');calls.push(s);if(s.includes("'resolve-activity'"))return {stdout:'com.example.app/.Main\n'};if(s.includes("'cmd' 'package' 'compile'"))return {stdout:'Success\n'};if(s.includes("'dumpsys' 'package'"))return {stdout:raw};if(s.includes("'start' '-W'"))return {stdout:'Status: ok\nLaunchState: COLD\nTotalTime: 120\n'};return {stdout:''};});
 const result=await adb.startup('ABC','com.example.app',{mode:'cold',runs:1,compilationMode:'speed-profile'});const compile=calls.findIndex(s=>s.includes("'cmd' 'package' 'compile'")),firstStart=calls.findIndex(s=>s.includes("'start' '-W'"));assert.ok(compile>=0&&compile<firstStart);assert.match(calls[compile],/'-f'.*'-m'.*'speed-profile'.*'com\.example\.app'/);assert.equal(result.compilationMode,'speed-profile');assert.deepEqual(result.compilationAction,{mode:'speed-profile',applied:true,output:'Success\n'});assert.doesNotThrow(()=>validateRecord({kind:'startup',source:'adb',payload:result}));assert.equal(adb.busy.size,0);
 for(const invalid of ['verify','',null])await assert.rejects(adb.startup('ABC','com.example.app',{compilationMode:invalid}),/启动参数无效/);
});
test('baseline profile evidence reports exact APK file paths without inferring installation',()=>{
 assert.equal(apkBaselineEvidence(null),null);
 const r=apkBaselineEvidence({files:[{path:'assets/dexopt/baseline.prof',uncompressedBytes:123},{path:'assets/dexopt/baseline.profm',uncompressedBytes:0},{path:'other/baseline.prof',uncompressedBytes:9}]});
 assert.deepEqual(r.files.map(x=>[x.status,x.bytes]),[['present',123],['present',0]]);
 assert.equal(apkBaselineEvidence({files:[]}).files[0].status,'absent');
 assert.equal(apkBaselineEvidence({files:[{path:'assets/dexopt/baseline.prof',uncompressedBytes:3},{path:'assets/dexopt/baseline.prof',uncompressedBytes:4}]}).files[0].status,'unknown');
 assert.equal(apkBaselineEvidence({files:[{path:'assets/dexopt/baseline.prof',uncompressedBytes:-1}]}).files[0].status,'unknown');
});
