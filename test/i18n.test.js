import {test} from 'node:test';
import assert from 'node:assert/strict';
import {supportedLanguages,translate} from '../public/i18n.js';

test('language selector supports Chinese and English while preserving user content',()=>{
  assert.deepEqual(supportedLanguages,['zh-CN','en-US']);
  assert.equal(translate('概览','en-US'),'Overview');
  assert.equal(translate('概览','zh-CN'),'概览');
  assert.equal(translate('com.example.app','en-US'),'com.example.app');
});
