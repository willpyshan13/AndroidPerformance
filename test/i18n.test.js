import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {supportedLanguages,translate,localizeTextNodes} from '../public/i18n.js';
import {CATEGORY_NAMES} from '../src/apk.js';

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

test('APK analysis page and its data-driven file categories have English labels and evidence guidance',async()=>{
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8'),start=app.indexOf('function apkKeyValues'),end=app.indexOf('\nfunction sessionTable',start),source=app.slice(start,end);
  const literals=[...new Set([...source.matchAll(/(['"])(.*?)\1/g)].map(match=>match[2]).filter(text=>/[\u3400-\u9fff]/.test(text)))];
  const guidance=[
    '在本机检查安装包结构、Manifest 和证书，无需连接设备。',
    '导入 APK，定位体积来源，查看应用声明与签名证书。',
    '支持单个 APK，最大 512 MB；分析全程在本机完成。',
    '这是 Manifest 中的权限声明，不代表系统已授予权限；未推断权限保护级别或应用运行时行为。',
    'exported / enabled 显示 Manifest 的显式值，未声明不等于 false。组件名已按包名展开；点击一行查看 actions、categories 和其他声明。',
    '仅分析此 APK 的静态声明；不运行、安装或上传应用，也不会合并其他 split APK。',
  ];
  const untranslated=[...literals,...guidance,...Object.values(CATEGORY_NAMES)].filter(text=>/[\u3400-\u9fff]/.test(translate(text,'en-US')));
  assert.deepEqual(untranslated,[]);
});

test('Source workspace has English labels for local/remote snapshots, search states, and limits',async()=>{
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8'),start=app.indexOf('function renderSource()'),end=app.indexOf('\nasync function refreshSource',start),source=app.slice(start,end);
  const literals=[...new Set([...source.matchAll(/(['"])(.*?)\1/g)].map(match=>match[2]).filter(text=>/[\u3400-\u9fff]/.test(text)))];
  const guidance=[
    '本地快照复制受支持的文本源码并以 SHA-256 校验；读取期间项目可能变化，本地快照不是原子 Git 提交。远程快照通过 GitHub 或 AOSP HTTPS 读取指定版本，保存提交标识，不执行项目脚本。源码搜索是文本匹配，不证明性能事件与结果存在因果关系。',
    '包含 Kotlin、Java、XML、C/C++ 等受支持文本；跳过构建目录、符号链接、单文件超过 512 KiB 的文件。最多 5,000 文件和 32 MiB。',
    '仅支持 GitHub 和 android.googlesource.com 的公开仓库。需要本机 Git 和网络；浅克隆的临时下载量可能大于快照上限，不读取子模块或 Git LFS 对象。',
    '最多显示前 300 文件；可搜索全部快照文件。',
  ];
  assert.deepEqual([...literals,...guidance].filter(text=>/[\u3400-\u9fff]/.test(translate(text.trim(),'en-US'))),[]);
});

test('GPU artifact page has English labels, capability status, and tool limitations',async()=>{
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8'),start=app.indexOf('function renderGpu()'),end=app.indexOf('\nasync function refreshGpu',start),source=app.slice(start,end);
  const literals=[...new Set([...source.matchAll(/(['"])(.*?)\1/g)].map(match=>match[2]).filter(text=>/[\u3400-\u9fff]/.test(text)&&!/[<>]/.test(text)))];
  const guidance=[
    '本模块管理本机产物，不采集 GPU 数据，也不内置 AGI。文件按导入时的 SHA-256 校验；校验相同只表示未发生变化，不证明文件格式有效或来源可信。Perfetto 追踪可交给系统追踪分析；.gfxtrace 可在桌面端交给 AGI，或导出后手动打开。',
    '仅显示系统属性和包管理器报告；缺失不代表设备不支持。AGI 的实际兼容性、GPU 计数器、驱动及应用可采集性需要在 AGI 中验证。',
    '选择设备后读取系统报告。',
  ];
  assert.deepEqual([...literals,...guidance].filter(text=>/[\u3400-\u9fff]/.test(translate(text.trim(),'en-US'))),[]);
});
