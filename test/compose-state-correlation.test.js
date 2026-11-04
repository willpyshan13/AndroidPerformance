import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {correlateComposeStateApplyToExecution} from '../public/offline.js';

test('Compose state apply retains apply ranges and all later unique-key execution candidates',()=>{
 const groups=[{key:-10,firstApplyNs:'9007199254740000',lastApplyNs:'9007199254740993',applyCount:3},{key:-20,lastApplyNs:'100'}];
 const events=[
  {measurement:'automatic-execution',clock:'uptime',groupKey:-10,elapsedNs:'9007199254740992',name:'Card'},
  {measurement:'automatic-skip',clock:'uptime',groupKey:-10,elapsedNs:'9007199254740994',name:'Card'},
  {measurement:'automatic-execution',clock:'uptime',groupKey:-10,elapsedNs:'9007199254740999',name:'Card'},
  {measurement:'automatic-execution',clock:'uptime',groupKey:-10,elapsedNs:'9007199254741003',name:'Card'},
  {measurement:'automatic-execution',clock:'elapsed-realtime',groupKey:-20,elapsedNs:'200',name:'Row'}
 ];
 const rows=correlateComposeStateApplyToExecution(groups,events);
 assert.deepEqual(rows[0],{key:'-10',groups:1,firstApplyNs:'9007199254740000',lastApplyNs:'9007199254740993',applyCount:3,executionCount:2,firstExecutionNs:'9007199254740999',lastExecutionNs:'9007199254741003',firstExecutionName:'Card',lastExecutionName:'Card',deltaNs:'6'});
 assert.equal(rows[1].executionNs,undefined);
});

test('Compose state apply refuses duplicate group keys and malformed evidence',()=>{
 const groups=[{key:'1',firstApplyNs:'90',lastApplyNs:'100',applyCount:2},{key:'1',firstApplyNs:'110',lastApplyNs:'120',applyCount:3},{key:'2',lastApplyNs:'200'},{key:'bad',lastApplyNs:'100'},{key:'3',lastApplyNs:'bad'}];
 const events=[{measurement:'automatic-execution',clock:'uptime',groupKey:1,elapsedNs:'120',name:'Card'}];
 assert.deepEqual(correlateComposeStateApplyToExecution(groups,events),[
  {key:'1',groups:2,firstApplyNs:null,lastApplyNs:null,applyCount:null},
  {key:'2',groups:1,firstApplyNs:null,lastApplyNs:'200',applyCount:null}
 ]);
 assert.deepEqual(correlateComposeStateApplyToExecution(null,events),[]);
});

test('layout UI only exposes State-to-execution timing for matching Agent device and package',async()=>{
 const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(app,/composeRuntimePanel\(\)\+\s*composeStateTimelinePanel\(\)\+/);
 assert.match(app,/state\.layout\.serial!==snapshot\.serial\|\|state\.layout\.packageName!==snapshot\.packageName/);
 assert.match(app,/correlateComposeStateApplyToExecution\(groups,snapshot\.events\)/);
 assert.doesNotMatch(app,/correlateComposeStateApplyToExecution\(groups,snapshot\.events\)\.filter\(row=>row\.lastApplyNs\)/);
 assert.match(app,/firstApplyNs:node\.attributes\['compose-changed-state-apply-first-ns'\]/);assert.match(app,/row\.executionCount/);assert.match(app,/候选执行只统计最后一次 apply 之后/);
 assert.match(app,/row\.lastApplyNs\?`\$\{esc\(row\.firstApplyNs\|\|row\.lastApplyNs\)\}/);
 assert.match(app,/时间先后只是候选关联，不证明 State 导致重组、帧变化或 Jank/);
});
