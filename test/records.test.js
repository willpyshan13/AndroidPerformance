import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRecord } from '../src/records.js';
import { demoHistory, demoFrames, demoStartup, demoLayout, DEMO_HAR } from '../public/demo.js';
import { parseHar } from '../public/offline.js';

test('all supported demo evidence validates for archive and export',()=>{
  for(const [kind,payload] of Object.entries({monitor:{samples:demoHistory()},frames:demoFrames(),startup:demoStartup(),layout:demoLayout(),network:{source:'demo',rows:parseHar(DEMO_HAR)}})){
    assert.doesNotThrow(()=>validateRecord({kind,source:'demo',payload}));
  }
});
test('malformed and mixed-source imported evidence is rejected before persistence',()=>{
  assert.throws(()=>validateRecord({kind:'monitor',source:'adb',payload:{samples:demoHistory()}}),/来源不一致/);
  assert.throws(()=>validateRecord({kind:'frames',source:'import',payload:{frames:[{}]}}),/帧预算/);
  assert.throws(()=>validateRecord({kind:'startup',source:'import',payload:{requestedMode:'cold',results:[{}]}}),/TotalTime/);
  assert.throws(()=>validateRecord({kind:'layout',source:'import',payload:{xml:'<!DOCTYPE hierarchy><hierarchy/>'}}),/XML/);
  assert.throws(()=>validateRecord({kind:'network',source:'import',payload:{rows:[{}]}}),/请求字段/);
});
