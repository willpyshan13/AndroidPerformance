import test from 'node:test';
import assert from 'node:assert/strict';
import {correlateGfxFramesToTimeline,findRelatedLayoutCaptures,layoutFrameCorrelationContext} from '../public/offline.js';

const pkg='com.example.app';
const gfx=(index,start,end)=>({index,durationMs:Number(BigInt(end)-BigInt(start))/1e6,overBudget:false,timestamps:{IntendedVsync:start,FrameCompleted:end}});
const timeline=(tsNs,durationNs,process=pkg,layer='SurfaceView')=>({tsNs,durationNs,process,layer,jankType:'App Deadline Missed'});
const provenance={sameDevice:true,api:35,packageName:pkg};

test('layout correlation context is available from a trace without prior gfxinfo capture',()=>{
 const trace={sessionId:'trace-1',frames:[]},source={sessionId:'trace-1',serial:'device-1',packageName:pkg,api:35};
 const directTrace=layoutFrameCorrelationContext({frameTimeline:trace,traceResult:{timestamp:100},traceSource:source});
 assert.deepEqual(directTrace,{visible:true,serial:'device-1',packageName:pkg,timestamp:100,canMap:true});
 assert.equal(layoutFrameCorrelationContext({frameTimeline:trace,traceResult:{},traceSource:null}).canMap,false);
 assert.equal(layoutFrameCorrelationContext({frames:{source:'import'},frameSource:{serial:'device-1',packageName:pkg}}).visible,true);
 assert.equal(layoutFrameCorrelationContext({frames:{source:'import'},frameSource:{serial:'device-1',packageName:pkg}}).canMap,false);
 assert.equal(layoutFrameCorrelationContext({frameTimeline:trace,traceSource:{...source,sessionId:'stale'}}).canMap,false);
 assert.equal(layoutFrameCorrelationContext({frameTimeline:trace,traceSource:{...source,api:30}}).canMap,false);
});

test('matches exact nanosecond overlaps for target process and child processes',()=>{
 const base=9007199254741000n;
 const result=correlateGfxFramesToTimeline(
  [gfx(7,String(base),String(base+20_000_000n)),gfx(8,String(base+30_000_000n),String(base+40_000_000n))],
  [timeline(String(base+5_000_000n),'10000000'),timeline(String(base+10_000_000n),'15000000',`${pkg}:renderer`),timeline(String(base),'20000000','com.other.app')],
  provenance,
 );
 assert.equal(result.available,true);
 assert.equal(result.matchedFrameCount,1);
 assert.equal(result.overlapPairs,2);
 assert.equal(result.ambiguousFrameCount,1);
 assert.equal(result.unmatchedFrameCount,1);
 assert.deepEqual(result.frames[0].candidates.map(row=>row.overlapNs),['10000000','10000000']);
 assert.equal(result.frames[0].candidates[1].process,`${pkg}:renderer`);
});

test('requires known same-device provenance and Android 12 or newer',()=>{
 const data=[[gfx(1,'100','200')],[timeline('100','100')]];
 assert.match(correlateGfxFramesToTimeline(...data,{...provenance,sameDevice:false}).reason,/同一台已知设备/);
 assert.match(correlateGfxFramesToTimeline(...data,{...provenance,api:30}).reason,/API 31/);
 assert.match(correlateGfxFramesToTimeline(...data,{...provenance,packageName:'bad'}).reason,/包名/);
});

test('does not treat touching interval boundaries as overlap and skips invalid timestamps',()=>{
 const result=correlateGfxFramesToTimeline(
  [gfx(1,'100','200'),{index:2,timestamps:{IntendedVsync:'bad',FrameCompleted:'300'}}],
  [timeline('200','100'),timeline('x','10')],provenance,
 );
 assert.equal(result.available,true);
 assert.equal(result.validGfxFrameCount,1);
 assert.equal(result.matchedFrameCount,0);
 assert.equal(result.unmatchedFrameCount,1);
});

test('reports absent or unusable source data without attempting a match',()=>{
 assert.match(correlateGfxFramesToTimeline([],[],provenance).reason,/同时读取/);
 assert.match(correlateGfxFramesToTimeline([gfx(1,'100','200')],[timeline('100','0')],provenance).reason,/没有该应用进程/);
});

test('related layout evidence is limited to declared same-device Agent captures and sorted by capture proximity',()=>{
 const capture=(timestamp,serial='device-1',packageName=pkg)=>({source:'agent',timestamp,serial,packageName});
 const result=findRelatedLayoutCaptures({serial:'device-1',packageName:pkg,timestamp:5000,
  currentLayout:capture(5001),records:[
   {id:'near',kind:'layout',source:'agent',name:'near',timestamp:4900,payload:capture(4900)},
   {id:'other-device',kind:'layout',source:'agent',payload:capture(5000,'device-2')},
   {id:'wrong-package',kind:'layout',source:'agent',payload:capture(5000,'device-1','com.other.app')},
   {id:'imported',kind:'layout',source:'import',payload:capture(5000)},
   {id:'ui-automator',kind:'layout',source:'adb',payload:{...capture(5000),source:'adb'}},
  ],
 });
 assert.equal(result.available,true);
 assert.deepEqual(result.captures.map(row=>row.id),['current','near']);
 assert.deepEqual(result.captures.map(row=>row.deltaMs),[1,-100]);
 assert.match(result.note,/不能由此确定布局快照对应哪一帧/);
});

test('related layout evidence refuses imported frame data without device identity',()=>{
 const result=findRelatedLayoutCaptures({packageName:pkg,records:[]});
 assert.equal(result.available,false);
 assert.match(result.reason,/设备序列号/);
});
