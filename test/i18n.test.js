import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {supportedLanguages,translate,localizeTextNodes} from '../public/i18n.js';

test('language selector supports Chinese and English while preserving user content',()=>{
  assert.deepEqual(supportedLanguages,['zh-CN','en-US']);
  assert.equal(translate('概览','en-US'),'Overview');
  assert.equal(translate('CPU 调用栈采样','en-US'),'CPU call stack sampling');
  assert.equal(translate('导入 HAR，或读取已接入的 OkHttp Agent。','en-US'),'Import a HAR file or read from a configured OkHttp Agent.');
  assert.equal(translate('完整 Compose Inspector','en-US'),'Full Compose Inspector');
  assert.equal(translate('概览','zh-CN'),'概览');
  assert.equal(translate('com.example.app','en-US'),'com.example.app');
});

test('English localization changes static UI labels but skips code, table content, and unknown user text',()=>{
  const entry=(tag,value)=>{
    const parent={tag,closest(){return ['pre','code','textarea','input','td'].includes(tag)?this:null;},matches(selector){return selector.split(',').includes(tag);}};
    return {parentElement:parent,nodeValue:value};
  };
  const nodes=[entry('h2','APK 体积组成'),entry('pre','APK 体积组成'),entry('td','APK 体积组成'),entry('h2','customer label'),entry('dt','CPU 架构'),entry('a','参考项目 ↗')];
  const root={ownerDocument:{createTreeWalker(){let index=-1;return {nextNode(){index++;if(index>=nodes.length)return false;this.currentNode=nodes[index];return true;}};}}};
  localizeTextNodes(root,'en-US');
  assert.equal(nodes[0].nodeValue,'APK size breakdown');
  assert.equal(nodes[1].nodeValue,'APK 体积组成');
  assert.equal(nodes[2].nodeValue,'APK 体积组成');
  assert.equal(nodes[3].nodeValue,'customer label');
  assert.equal(nodes[4].nodeValue,'CPU architecture');
  assert.equal(nodes[5].nodeValue,'Reference project ↗');
  localizeTextNodes(root,'zh-CN');
  assert.equal(nodes[0].nodeValue,'APK 体积组成');
  assert.equal(nodes[4].nodeValue,'CPU 架构');
  assert.equal(nodes[5].nodeValue,'参考项目 ↗');
});

test('every literal action button label used by the application has an English translation',async()=>{
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const labels=[...app.matchAll(/button\(\s*(['"])(.*?)\1\s*,\s*(['"])(.*?)\3/g)].map(match=>match[4]);
  const untranslated=[...new Set(labels)].filter(label=>!['activity','chart','image','layers','play','upload'].includes(label)&&translate(label,'en-US')===label);
  assert.deepEqual(untranslated,[]);
});

test('every static table and definition-list heading with Chinese text has an English translation',async()=>{
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const labels=[...app.matchAll(/<(?:th|dt)>([^<$`]+)</g)].map(match=>match[1].trim());
  const untranslated=[...new Set(labels)].filter(label=>/[\u3400-\u9fff]/.test(label)&&translate(label,'en-US')===label);
  assert.deepEqual(untranslated,[]);
});

test('literal empty states and section headings have English translations',async()=>{
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const emptyLabels=[...app.matchAll(/empty\(\s*'([^']*)'\s*,\s*'([^']*)'/g)].flatMap(match=>[match[1],match[2]]);
  const headings=[...app.matchAll(/<h[1-4]>([^<$`]+)</g)].map(match=>match[1].trim());
  const labels=[...new Set([...emptyLabels,...headings])];
  const untranslated=labels.filter(label=>/[\u3400-\u9fff]/.test(label)&&/[\u3400-\u9fff]/.test(translate(label,'en-US')));
  assert.deepEqual(untranslated,[]);
});

test('all literal capability and evidence notes have English translations',async()=>{
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const notes=[...new Set([...app.matchAll(/note\('([^']*[\u3400-\u9fff][^']*)'\)/g)].map(match=>match[1]))];
  const untranslated=notes.filter(note=>/[\u3400-\u9fff]/.test(translate(note,'en-US')));
  assert.deepEqual(untranslated,[]);
});

test('literal toast messages and dialog titles have English translations',async()=>{
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const messages=[...app.matchAll(/toast\(\s*'([^']*[\u3400-\u9fff][^']*)'/g)].map(match=>match[1]);
  const titles=[...app.matchAll(/showDialog\(\s*'([^']*[\u3400-\u9fff][^']*)'/g)].map(match=>match[1]);
  const untranslated=[...new Set([...messages,...titles])].filter(text=>/[\u3400-\u9fff]/.test(translate(text,'en-US')));
  assert.deepEqual(untranslated,[]);
});
