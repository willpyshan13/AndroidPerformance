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

test('CPU and FrameTimeline correlation labels describe the PID and time-overlap boundary',()=>{
 assert.equal(translate('CPU 采样与 FrameTimeline 关联','en-US'),'CPU samples and FrameTimeline correlation');
 assert.match(translate('仅在 perf.data 明确记录 CLOCK_MONOTONIC 时启用。请人工确认两份文件来自同一设备和同一段交互；采样按 PID 与帧进程匹配，落入帧区间只表示时间重合，不代表函数耗时或因果。','en-US'),/CLOCK_MONOTONIC.*PID.*temporal overlap.*causation/);
 assert.equal(translate('没有 CPU 采样点匹配帧进程和区间','en-US'),'No CPU samples match a frame process and interval');
});

test('CPU capture configuration has English names and evidence limits',()=>{
 assert.equal(translate('采样频率','en-US'),'Sampling frequency');
 assert.equal(translate('调用栈展开','en-US'),'Call stack unwinding');
 assert.match(translate('频率越高，采样开销和数据量通常越大；FP 依赖帧指针，ARM 32 位上可能不完整。DWARF 开销更高，原生栈还受调试信息影响。','en-US'),/higher frequencies.*FP.*32-bit ARM.*DWARF.*debug information/i);
});

test('settings capability summary reflects implemented modules and documented limits in English',async()=>{
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const settings=app.slice(app.indexOf('function renderSettings()'),app.indexOf('\nconst $$ =',app.indexOf('function renderSettings()')));
  const summary='已实现：设备与应用监控、CPU 采样、内存与堆分析、布局检查、系统追踪、帧与启动分析、电池统计、OkHttp 网络采集、GPU 工具集成、Benchmark 与 Macrobenchmark、APK 分析和源码工作区。';
  const limits='功能取决于设备权限、Android 版本和外部工具。完整 Compose Inspector 需要 API 29+ 与目标调试接口；实时网络只采集接入 OkHttp Agent 的请求；系统 UID mAh 是估计值，不是实测功耗。';
  assert.ok(settings.includes(`tr('${summary}')`));
  assert.ok(settings.includes(`tr('${limits}')`));
  assert.match(translate(summary,'en-US'),/^Available:/);
  assert.match(translate(limits,'en-US'),/API 29\+.*OkHttp Agent.*estimates/);
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

test('literal user-facing errors have English translations before they reach a dialog or toast',async()=>{
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const messages=[...app.matchAll(/new Error\(\s*(['"])([^'"]*[\u3400-\u9fff][^'"]*)\1/g)].map(match=>match[2]);
  const untranslated=[...new Set(messages)].filter(message=>/[\u3400-\u9fff]/.test(translate(message,'en-US')));
  assert.deepEqual(untranslated,[]);
  assert.match(app,/function showDialog\(title,html\).*localizeTextNodes\(content,state\.language\)/);
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

test('Battery analysis page has English labels, history errors, and sampling guidance',async()=>{
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8'),start=app.indexOf('function batterySeriesControls()'),end=app.indexOf('\nfunction renderGpu()',start),source=app.slice(start,end);
  const literals=[...new Set([...source.matchAll(/(['"])(.*?)\1/g)].map(match=>match[2]).filter(text=>/[\u3400-\u9fff]/.test(text)&&!/[<>]/.test(text)))];
  const guidance=[
    '先采集基线，在设备上重现操作后采集结束快照。也可导入 dumpsys batterystats --checkin 文本。',
    '表中网络计数和 UID 耗电估计是累计读数，不是电池电量消耗；系统窗口重置或设备切换后不可直接对比。',
    '数据来自 Android batterystats 的 since-charged 累计记录，属于 UID；共享 UID 的应用无法单独归因。资源计数差值不是耗电量；系统若提供 UID mAh 则显示累计估计，缺失值和重置后的计数不按零计算。',
    '来自 batterystats 的 pwi UID 项，是系统基于设备数据和模型给出的累计估计；同一统计窗口内可显示两次累计值的区间差，可能包括共享 UID 应用且存在取整。区间差仍是估计值，不是实测电量或精确应用耗电；缺失或下降的读数不按零计算。',
  ];
  assert.deepEqual([...literals,...guidance].filter(text=>/[\u3400-\u9fff]/.test(translate(text.trim(),'en-US'))),[]);
});

test('Frame analysis page has English labels and distinguishes gfxinfo, FrameTimeline, and Compose evidence',async()=>{
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8'),start=app.indexOf('function renderFrames()'),end=app.indexOf('\nfunction renderStartup()',start),source=app.slice(start,end);
  const literals=[...new Set([...source.matchAll(/(['"])(.*?)\1/g)].map(match=>match[2]).filter(text=>/[\u3400-\u9fff]/.test(text)&&!/[<>$]/.test(text)))];
  const guidance=[
    '数据来自 dumpsys gfxinfo framestats 的有限历史缓冲区；仅统计 Flags=0 且时间戳有效的帧。超过所选预算的帧数是参考信号，不等同于平台 Jank、FPS 或刷新率检测。',
    '使用追踪内 CLOCK_MONOTONIC 快照将 Probe uptime 纳秒映射至 Perfetto 时间轴，再按事件是否落入实际帧区间匹配。需要同一设备的 Compose Probe 日志和含 FrameTimeline 的追踪；应用不能验证两个来源的设备身份。时间重合不证明 State 更新导致该帧或 Jank。旧版 elapsedRealtime 时间戳不会参与匹配。',
    '读取当前已导入追踪的实际帧时间线；Android 12 及以上且追踪包含 FrameTimeline 数据时才有结果。这里展示系统原始 Jank 类型和呈现状态，与 gfxinfo 的自选预算分组不是同一指标。多图层或同一帧的多条记录不会自动合并。完成时差是实际结束减预期结束；仅在进程、令牌和图层对应唯一时计算，不代表实际显示时间或平台 Jank 。最多读取最早 2,000 条。',
    '仅按系统报告的 App / SurfaceFlinger CPU / GPU Deadline Missed 分类分组：同一轨道相邻记录、起始时间间隔不超过 100 ms 且连续出现至少两次。不同轨道分开；截断追踪可能遗漏记录，不推断原因。',
    '同一 PROFILEDATA 段中，原始记录相邻、起始时间相差不超过 100 ms 的两个或更多超预算帧归为一组。被跳过的帧和不同段会打断分组；这不是平台 Jank 或因果判断。旧记录或演示数据缺少原始顺序时不分组。',
  ];
  assert.deepEqual([...literals,...guidance].filter(text=>/[\u3400-\u9fff]/.test(translate(text.trim(),'en-US'))),[]);
});

test('Startup page localizes known launch modes and profile-header states while retaining raw system evidence',async()=>{
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8'),start=app.indexOf('function renderStartup()'),end=app.indexOf('\nfunction buildNodes(',start),source=app.slice(start,end);
  const literals=[...new Set([...source.matchAll(/(['"])(.*?)\1/g)].map(match=>match[2]).filter(text=>/[\u3400-\u9fff]/.test(text)&&!/[<>$]/.test(text)))];
  const guidance=[
    '检查已分析单个 APK 的标准路径和文件头；010 版本可读取 DEX 记录和方法标记。不证明内容完整有效、已安装、编译或生效。分片、其他安装来源或生成方式可能不同。',
    '010 Profile 的方法标记可重叠，不能相加；类和方法均为记录数量，不代表设备已编译。仅对名称精确匹配的 APK 内 DEX 比较头部校验值；未重新计算 DEX 校验值或解析方法名称。包名、设备安装和实际编译仍需另行核对。',
    '读取 dumpsys package 中目标包的 Dexopt state，按文件和指令集展示系统报告；状态与原因不能单独证明 Baseline Profile 是否生效。不同 Android 版本或厂商可能不提供可解析数据。',
    '先导入或采集包含 Android 启动和帧事件的系统追踪。数据由 Perfetto 启动标准库计算；TTFD 依赖应用报告 fully drawn 和相关帧证据，缺失不代表零。可能一条启动对应多个进程记录，不与上面的实验自动配对；最多读取最早 1,000 条。',
  ];
  assert.deepEqual([...literals,...guidance].filter(text=>/[\u3400-\u9fff]/.test(translate(text.trim(),'en-US'))),[]);
});

test('Heap page labels preserve HPROF evidence while explaining allocation-profile limits',async()=>{
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8'),start=app.indexOf('function renderHeap()'),end=app.indexOf('\nasync function browseDestroyedActivities()',start),source=app.slice(start,end);
  const literals=[...new Set([...source.matchAll(/(['"])(.*?)\1/g)].map(match=>match[2]).filter(text=>/[\u3400-\u9fff]/.test(text)&&!/[<>$]/.test(text)))];
  const guidance=[
    '采集通常要求应用可调试，可能暂停目标进程。文件可能包含敏感数据。字段 / 元素字节不包含对象头或对齐，不等于浅大小或保留大小；可分页浏览实例、候选根路径和近似支配图，不能据此证明泄漏。最多索引 100 万个对象，近似支配图计算最多支持 25 万个索引对象。',
    '按调用栈采样 malloc/free 分配。Native 要求 Android 10+；ART 分配样本要求 Android 12+，仅显示采集期间分配调用，不是存活对象快照。目标应用还需符合系统 debuggable/profileable 限制；数据源可能增加目标进程开销。采集按应用包名匹配进程，独立命名的子进程可能需要单独配置。',
  ];
  assert.deepEqual([...literals,...guidance].filter(text=>/[\u3400-\u9fff]/.test(translate(text.trim(),'en-US'))),[]);
});

test('Network analysis localizes filter states and explains timing, grouping, and truncation',async()=>{
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8'),start=app.indexOf('function renderNetwork()'),end=app.indexOf('\nfunction renderBenchmark()',start),source=app.slice(start,end);
  const literals=[...new Set([...source.matchAll(/(['"])(.*?)\1/g)].map(match=>match[2]).filter(text=>/[\u3400-\u9fff]/.test(text)&&!/[<>$]/.test(text)))];
  const guidance=[
    '筛选会同步更新汇总、接口统计、时间线和列表；时间按本机时区解释。连接筛选仅对 HAR 中存在连接 ID 的记录可用。',
    '各列为筛选后有数据的请求阶段平均耗时（毫秒），括号内为样本数。TLS 是连接耗时的一部分，不能相加；Agent 的接收阶段包含应用读取间隔，缺失值不代表零耗时。',
    '按方法、域名和路径分组；HAR 查询参数已丢弃，Agent 不记录路径。P50 / P95 使用最近秩，仅统计有效耗时；样本少时百分位可能就是最大值，不能代表总体性能。统计使用当前筛选结果。',
    '展示当前筛选中开始时间和总耗时均可用的最早 200 条请求；重叠仅表示记录的时间重合，不证明因果关系。',
  ];
  assert.deepEqual([...literals,...guidance].filter(text=>/[\u3400-\u9fff]/.test(translate(text.trim(),'en-US'))),[]);
});

test('CPU profiling localizes timeline states and clarifies sampled-weight and symbol evidence',async()=>{
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8'),start=app.indexOf('function cpuFocusNode()'),end=app.indexOf('function renderHeap()',start),source=app.slice(start,end);
  const literals=[...new Set([...source.matchAll(/(['"])(.*?)\1/g)].map(match=>match[2]).filter(text=>/[\u3400-\u9fff]/.test(text)&&!/[<>$]/.test(text)))];
  const guidance=[
    '使用 simpleperf symfs 查找与设备路径及构建 ID 匹配的本机符号文件。更换目录后需重新解析；不保证所有符号均可恢复。',
    '保存原始 perf.data 到本机，载入前校验 SHA-256 并重新分析；采样可能包含敏感信息。',
    '仅统计时间线中有效的已读取样本，不等于丢失采样数或 CPU 时间；没有调用方可能是采集方式或真实栈深度所致。时间线已截断时，统计不覆盖全部样本；被跳过的样本不在时间线中。本统计覆盖全部已读取时间，不随时间筛选变化。',
    '色块只表示采样点，并非线程运行状态；点击线程的时间段按该线程和时间筛选火焰图及调用树。追踪状态按 PID/TID 查询当前 Perfetto 窗口，不自动对齐时间，也不能证明来自同一设备或同一线程生命周期。',
    '每列对应一个时间段，颜色按采样栈最末端的函数（叶函数）汇总事件周期权重；列内显示各函数所占比例。点击时间段可按全部线程筛选下方调用树。图表仅反映已读取样本，不表示 CPU 时间或函数的包含成本。',
    '横向宽度表示当前范围内的事件周期权重；每一层是调用关系，不表示时间顺序。点击或按回车放大，最多绘制 3,000 节点、41 层。',
  ];
  assert.deepEqual([...literals,...guidance].filter(text=>/[\u3400-\u9fff]/.test(translate(text.trim(),'en-US'))),[]);
});

test('System trace page translates trace-window, Binder, SQL, and thread-state guidance',async()=>{
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8'),start=app.indexOf('function traceTable('),end=app.indexOf('\nfunction batterySeriesControls()',start),source=app.slice(start,end);
  const literals=[...new Set([...source.matchAll(/(['"])(.*?)\1/g)].map(match=>match[2]).filter(text=>/[\u3400-\u9fff]/.test(text)&&!/[<>$]/.test(text)))];
  const guidance=[
    '查询针对当前本机追踪运行；支持一个 SELECT / WITH，可选前置 INCLUDE PERFETTO MODULE ...;。注释及写入、外部文件语句会被拒绝。查询结果不会改写原始追踪或工作台汇总。',
    '绿色为切片，橙色为 CPU 调度片段，灰色为 CPU 空闲线程。切片按追踪记录的嵌套深度分行；同深度重叠事件仍可能遮挡，点击事件查看时间。可按轨道、线程或切片名称筛选；切片名称筛选仅影响切片，CPU 调度仍保留。汇总覆盖完整追踪。每类最多载入最早 3,000 条、显示最多 30 条轨道。',
    '事件按窗口裁剪，统计基于已记录线程状态。相同 TID 可能被复用，内部线程标识 UTID 用于区分生命周期；状态由 Perfetto 原样提供，缺失不表示零。',
  ];
  assert.deepEqual([...literals,...guidance].filter(text=>/[\u3400-\u9fff]/.test(translate(text.trim(),'en-US'))),[]);
});

test('Layout inspector localizes capture controls and reports accessibility/Compose evidence limits',async()=>{
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8'),start=app.indexOf('function renderLayout()'),end=app.indexOf('function cpuFocusNode()',start),source=app.slice(start,end);
  const literals=[...new Set([...source.matchAll(/(['"])(.*?)\1/g)].map(match=>match[2]).filter(text=>/[\u3400-\u9fff]/.test(text)&&!/[<>$]/.test(text)))];
  const guidance=[
    '采集设备当前前台窗口的 UIAutomator 可访问性层级，不保证属于所选应用，也不是完整 View/Compose 树。安全窗口可能没有截图；没有可访问性语义的节点可能缺失。',
    'CompositionData 与 State-scope 数量是调试快照关联，不读取 State 值，也不代表完整重组因果关系。',
    '编译器执行计数包括首次组合；跳过计数来自 Composer.skipToGroupEnd，不区分 Composable 多实例。',
  ];
  assert.deepEqual([...literals,...guidance].filter(text=>/[\u3400-\u9fff]/.test(translate(text.trim(),'en-US'))),[]);
});
