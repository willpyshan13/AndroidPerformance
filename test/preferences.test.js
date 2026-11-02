import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAppearance} from '../src/preferences.js';

test('appearance preferences accept only supported themes and desktop scales',()=>{
  assert.deepEqual(normalizeAppearance({theme:'dark',scale:'1.2',ignored:'value'}),{theme:'dark',scale:'1.2'});
  assert.deepEqual(normalizeAppearance({theme:'system'}),{theme:'system'});
  assert.throws(()=>normalizeAppearance({theme:'neon'}),/主题选项无效/);
  assert.throws(()=>normalizeAppearance({scale:'2'}),/界面缩放选项无效/);
  assert.throws(()=>normalizeAppearance({}),/没有可保存/);
});
