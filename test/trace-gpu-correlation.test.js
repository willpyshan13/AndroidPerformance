import {test} from 'node:test';
import assert from 'node:assert/strict';
import {correlateGpuStagesToFrames} from '../public/offline.js';

test('GPU RenderStage overlaps are matched to frame intervals by UPID and exact nanosecond bounds',()=>{
 const base=9007199254740000n;
 const frames=[
  {processId:'7',process:'app',layer:'surface',tsNs:String(base+5n),durationNs:'10',jankType:'MissedDeadline'},
  {processId:'8',process:'other',layer:'surface',tsNs:String(base+5n),durationNs:'10',jankType:'None'}
 ];
 const stages=[
  {upid:'7',tsNs:String(base),durationNs:'10',name:'draw',queue:'GPU 0',submissionId:'42'},
  {upid:'7',tsNs:String(base+20n),durationNs:'5',name:'outside'},
  {upid:'9',tsNs:String(base+5n),durationNs:'8',name:'other process'},
  {upid:'7',tsNs:String(base+14n),durationNs:'4',name:'second overlap'}
 ];
 const result=correlateGpuStagesToFrames(stages,frames);
 assert.equal(result.available,true);assert.equal(result.matchedFrameCount,1);assert.equal(result.stageFramePairs,2);
 assert.equal(result.frames[0].process,'app');assert.equal(result.frames[0].jankType,'MissedDeadline');
 assert.deepEqual(result.frames[0].stages.map(x=>x.overlapNs),['5','1']);
 assert.match(result.note,/不能证明 GPU 工作导致该帧卡顿/);
});

test('GPU RenderStage correlation reports missing timing evidence and enforces bounds',()=>{
 assert.equal(correlateGpuStagesToFrames([],[]).available,false);
 assert.equal(correlateGpuStagesToFrames([{upid:'1',tsNs:'1',durationNs:'1',name:'x'}],[{processId:'1',tsNs:'x',durationNs:'1'}]).available,false);
 assert.throws(()=>correlateGpuStagesToFrames(Array(1001).fill({}),[]),/超出限制/);
});
