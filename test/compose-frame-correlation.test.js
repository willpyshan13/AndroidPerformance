import {test} from 'node:test';
import assert from 'node:assert/strict';
import {correlateComposeEventsToFrames} from '../public/offline.js';

test('Compose uptime events associate only with exact gfxinfo frame intervals',()=>{
 const frames=[
  {index:1,startNsExact:'100',durationMs:0.01,overBudget:false,timestamps:{IntendedVsync:'100',FrameCompleted:'110'}},
  {index:2,startNsExact:'105',durationMs:0.02,overBudget:true,timestamps:{IntendedVsync:'105',FrameCompleted:'131'}},
 ];
 const events=[
  {name:'Screen',measurement:'automatic-execution',count:1,elapsedNs:'107',clock:'uptime'},
  {name:'Card',measurement:'side-effect',count:2,elapsedNs:'131',clock:'uptime'},
  {name:'OldProbe',elapsedNs:'115',clock:'elapsed-realtime'},
  {name:'Outside',elapsedNs:'132',clock:'uptime'},
  {name:'Invalid',elapsedNs:'x',clock:'uptime'},
 ];
 const result=correlateComposeEventsToFrames(events,frames);
 assert.equal(result.available,true);assert.equal(result.matchedEventCount,3);assert.equal(result.uniqueMatchedEventCount,2);assert.equal(result.clockMismatchCount,1);assert.equal(result.invalidCount,1);
 assert.deepEqual(result.frames.map(row=>[row.index,row.events.map(event=>event.name)]),[[1,['Screen']],[2,['Screen','Card']]]);
});

test('Compose correlation reports missing frame timestamps and data explicitly',()=>{
 assert.equal(correlateComposeEventsToFrames([],[]).available,false);
 const result=correlateComposeEventsToFrames([{elapsedNs:'123',clock:'uptime'}],[{index:1,startNsExact:'100',timestamps:{FrameCompleted:'90'}}]);
 assert.equal(result.available,false);assert.match(result.reason,/逐帧起止时间戳/);
});
