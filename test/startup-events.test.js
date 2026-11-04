import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStartupSystemEvents,startupSystemIterationEvidence} from '../src/startup-events.js';

const component='com.example.app/.MainActivity';
const row=(name,token,activityTime,totalTime,activity=component)=>`I/am_activity_${name}( 0): [0, ${token}, ${activity}, ${activityTime}, ${totalTime}]`;

test('system startup event parser accepts Android launch and fully-drawn event records with bounds',()=>{
 const parsed=parseStartupSystemEvents([row('launch_time','1234','72','84'),row('fully_drawn_time','1234','210','220'),row('launch_time','1235','1','2','com.other/.Activity')].join('\n'),{packageName:'com.example.app',component});
 assert.equal(parsed.events.length,2);assert.equal(parsed.events[0].name,'launch-time');assert.equal(parsed.events[0].activityTimeMs,72);assert.equal(parsed.events[0].totalTimeMs,84);assert.equal(parsed.events[1].name,'fully-drawn-time');assert.equal(parsed.ignored,1);
 assert.throws(()=>parseStartupSystemEvents('x'.repeat(2*1024*1024+1)),/2 MiB/);
 assert.throws(()=>parseStartupSystemEvents('',{packageName:'../bad'}),/包名无效/);
});

test('system startup evidence diffs event snapshots and leaves missing TTFD unavailable',()=>{
 const previous=row('launch_time','100','30','40'),current=[previous,row('launch_time','101','55','65'),row('fully_drawn_time','101','120','130')].join('\n');
 const before=parseStartupSystemEvents(previous,{packageName:'com.example.app',component}),after=parseStartupSystemEvents(current,{packageName:'com.example.app',component});
 const evidence=startupSystemIterationEvidence(before,after,{packageName:'com.example.app',component});
 assert.equal(evidence.available,true);assert.equal(evidence.ttidMs,65);assert.equal(evidence.activityDisplayMs,55);assert.equal(evidence.ttfdMs,130);assert.equal(evidence.events.length,2);
 const noDraw=startupSystemIterationEvidence(before,parseStartupSystemEvents([previous,row('launch_time','101','55','65')].join('\n'),{packageName:'com.example.app',component}),{packageName:'com.example.app',component});
 assert.equal(noDraw.ttidMs,65);assert.equal(noDraw.ttfdMs,null);
 assert.equal(startupSystemIterationEvidence({error:'denied'},after,{packageName:'com.example.app',component}).available,false);
});
