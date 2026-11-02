import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseFrames} from '../src/parsers.js';
import {clusterFrames} from '../public/offline.js';

test('clusters only consecutive valid slow frames in one section and preserves exact timestamps',()=>{
 const raw=`---PROFILEDATA---
Flags,IntendedVsync,Vsync,FrameCompleted,
0,9007199254740993,9007199254740994,9007199279740993,
0,9007199270000000,9007199270000000,9007199295000000,
1,9007199290000000,9007199290000000,9007199315000000,
0,9007199310000000,9007199310000000,9007199335000000,
0,9007199500000000,9007199500000000,9007199525000000,
---PROFILEDATA---
---PROFILEDATA---
Flags,IntendedVsync,Vsync,FrameCompleted,
0,9007199520000000,9007199520000000,9007199545000000,
0,9007199540000000,9007199540000000,9007199565000000,
---PROFILEDATA---`;
 const parsed=parseFrames(raw),clusters=clusterFrames(parsed.frames,16.667);
 assert.equal(parsed.frames[0].startNsExact,'9007199254740993');assert.equal(parsed.frames[0].durationMs,25);
 assert.equal(parsed.frames[0].timestamps.Vsync,'9007199254740994');
 assert.deepEqual(parsed.frames.map(f=>f.rawIndex),[1,2,4,5,1,2]);
 assert.deepEqual(clusters.map(c=>[c.first,c.last,c.count,c.section]),[[1,2,2,1],[5,6,2,2]]);
 assert.equal(clusterFrames(parsed.frames,30).length,0);
 assert.equal(clusterFrames([{index:1,durationMs:30},{index:2,durationMs:40}],16.667).length,0);
});
test('FrameTimeline deadline clusters isolate tracks and exclude non-deadline classifications',async()=>{
 const {clusterFrameTimeline}=await import('../public/offline.js');const f=(track,ts,jankType)=>({trackId:track,tsNs:String(ts),jankType,process:'app',layer:'layer'});
 const frames=[f('1',0,'App Deadline Missed'),f('2',10,'Buffer Stuffing'),f('1',20,'App Deadline Missed, Prediction Error'),f('1',30,'None'),f('1',40,'SurfaceFlinger CPU Deadline Missed'),f('1',200000000,'App Deadline Missed'),f('2',200000001,'App Deadline Missed'),f('2',200000002,'SurfaceFlinger GPU Deadline Missed')];
 const clusters=clusterFrameTimeline(frames);assert.deepEqual(clusters.map(c=>c.indices),[[0,2],[6,7]]);assert.equal(clusterFrameTimeline([f(null,1,'App Deadline Missed'),f(null,2,'App Deadline Missed')]).length,0);
});
