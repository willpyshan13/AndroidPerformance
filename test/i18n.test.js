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

test('English localization translates accessible labels and placeholders and restores them in Chinese',()=>{
  const makeElement=values=>{const attributes=new Map(Object.entries(values));return {hasAttribute:key=>attributes.has(key),getAttribute:key=>attributes.get(key),setAttribute:(key,value)=>attributes.set(key,value),closest:()=>null,attributes};};
  const input=makeElement({'aria-label':'Gradle 工程目录','placeholder':'输入 Gradle 项目的绝对路径'}),unknown=makeElement({placeholder:'customer value'});
  const root={ownerDocument:{createTreeWalker(){return {nextNode(){return false;}}; }},querySelectorAll(){return [input,unknown];}};
  localizeTextNodes(root,'en-US');assert.equal(input.getAttribute('aria-label'),'Gradle project directory');assert.equal(input.getAttribute('placeholder'),'Enter the absolute path to the Gradle project');assert.equal(unknown.getAttribute('placeholder'),'customer value');
  localizeTextNodes(root,'zh-CN');assert.equal(input.getAttribute('aria-label'),'Gradle 工程目录');assert.equal(input.getAttribute('placeholder'),'输入 Gradle 项目的绝对路径');
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

test('English translations cover literal state-dependent UI labels without rewriting embedded HTML samples',async()=>{
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const branches=[...app.matchAll(/\?\s*'([^'`]*[\u3400-\u9fff][^'`]*)'\s*:\s*'([^'`]*[\u3400-\u9fff][^'`]*)'/g)].flatMap(match=>[match[1],match[2]]);
  const labels=[...new Set(branches)].filter(label=>!/[<>]/.test(label)&&/[\u3400-\u9fff]/.test(label));
  const untranslated=labels.filter(label=>/[\u3400-\u9fff]/.test(translate(label,'en-US')));
  assert.deepEqual(untranslated,[]);
});

test('Benchmark page has English translations for every literal Chinese label and its full capability guidance',async()=>{
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8'),start=app.indexOf('function renderBenchmark()'),end=app.indexOf('\nconst bytes =',start),source=app.slice(start,end);
  const literals=[...new Set([...source.matchAll(/(['"])(.*?)\1/g)].map(match=>match[2]).filter(text=>/[\u3400-\u9fff]/.test(text)))];
  const guidance=[
    '选择包含 Gradle Wrapper 的 Android 工程，执行连接设备的 Android 测试任务。常见任务为 :macrobenchmark:connectedBenchmarkReleaseAndroidTest；任务会构建并安装测试 APK、启动目标应用，可能运行数分钟。Gradle 可能按项目配置下载依赖。结果只从本次运行更新的 connected_android_test_additional_output 中读取。',
    '需要先在设备安装 benchmark 测试 APK。运行 instrumentation 会启动目标应用并操作手机，可能持续数分钟。完成后会检查标准 AndroidX Benchmark 报告是否在本次运行期间更新；无法确认新鲜度时不会自动载入。工具不会安装 APK 或配置测试。超时或断线时设备上的测试可能仍在运行。',
    '输入测试包 Android/media 目录中的 JSON 完整路径，读取后作为当前运行。设备文件可能来自较早的测试；请自行核对生成时间、测试参数和设备，工具不自动认定它属于刚才的运行。其他位置的报告请手动导入。',
  ];
  const untranslated=[...literals,...guidance].filter(text=>/[\u3400-\u9fff]/.test(translate(text,'en-US')));
  assert.deepEqual(untranslated,[]);
});
