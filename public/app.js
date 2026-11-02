import { DEMO_DEVICE, DEMO_PACKAGE, demoSample, demoHistory, demoFrames, demoStartup, demoLayout, DEMO_HAR } from './demo.js';
import { parseHar, apkBaselineEvidence, mergeNetworkAgentSnapshot, summarizeHarHosts, summarizeNetworkEndpoints, buildNetworkTimeline, parseBenchmark, compareBenchmarks, benchmarkSampleSummary, benchmarkContextWarnings, compareHeaps, parseFoldedStacks, reverseCallTree, layoutFlame, buildSampleTimeline, sampleQuality, profileForTimeBin, profileForTimeRange, layoutScope, extractLayoutNodes, compareLayouts, layoutComparisonReport, inspectLayout, clusterFrames, clusterFrameTimeline, traceEventWindow } from './offline.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, decimals = 1) => n === null || n === undefined || !Number.isFinite(Number(n)) ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const date = timestamp => new Date(timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const token = $('meta[name=api-token]').content;
const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>', cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 3v3m6-3v3M9 18v3m6-3v3M3 9h3m-3 6h3m12-6h3m-3 6h3"/>',
  memory: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10v4m5-4v4m5-4v4M7 18v3m5-3v3m5-3v3"/>',
  frames: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 4v16m8-16v16M3 9h5m-5 6h5m8-6h5m-5 6h5"/>',
  rocket: '<path d="m14 5 5-2 2 5-5 9-9-9zM7 8l-4 4 5 1m8 4-4 4-1-5M5 17l-2 4 4-2"/><circle cx="16" cy="8" r="2"/>',
  layers: '<path d="m12 3 10 6-10 6L2 9zm-9 11 9 5 9-5M3 18l9 5 9-5"/>',
  trace: '<path d="M3 7h7v4h7v4h4M3 17h5m-1-14v18m5-18v18m5-18v18"/>',
  network: '<circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 7v6H5v4m7-4h7v4m-7-4v7"/>',
  folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  settings: '<path d="m9 3-.7 3-3 .8-2.1 3.7L5.5 13l-.3 3.1 3.6 2.1L12 17l3.2 1.2 3.6-2.1-.3-3.1 2.3-2.5-2.1-3.7-3-.8L15 3z"/><circle cx="12" cy="11" r="3"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 6a8 8 0 0 1 13 2m-1 10A8 8 0 0 1 5 16"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 5h4m-3 14h2"/>',
  play: '<path d="m8 4 12 8-12 8z"/>', stop: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/>', upload: '<path d="M12 16V4m-4 4 4-4 4 4M4 16v4h16v-4"/>',
  arrow: '<path d="M4 12h16m-5-5 5 5-5 5"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  battery: '<rect x="2" y="6" width="18" height="12" rx="2"/><path d="M23 10v4M6 10v4m4-4v4m4-4v4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-11v1"/>', file: '<path d="M14 2H5v20h14V7zM14 2v6h5M8 13h8m-8 4h6"/>',
  chart: '<path d="M4 3v18h17M8 17v-5m5 5V7m5 10v-8"/>', search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  package: '<path d="m12 3 9 5v9l-9 5-9-5V8zm-9 5 9 5 9-5m-9 5v9M7.5 5.5l9 5v4"/>',
};
const icon = (name, size = 17) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.activity}</svg>`;
const routes = [
  ['overview', '概览', 'grid'], ['monitor', '实时监控', 'activity'], ['cpu-profile', 'CPU 采样', 'cpu'], ['frames', '帧耗时分析', 'frames'], ['startup', '启动测试', 'rocket'],
  ['battery', '电池与资源', 'battery'], ['gpu', 'GPU 产物', 'chart'], ['heap', '堆转储', 'memory'], ['layout', '布局检查', 'layers'], ['trace', '系统追踪', 'trace'], ['network', '网络分析', 'network', 'HAR'], ['benchmark', '基准对比', 'chart', 'JSON'],
  ['apk', 'APK 分析', 'package', 'APK'], ['source', '源码工作区', 'folder'],
  ['sessions', '采集记录', 'folder'], ['settings', '设置与帮助', 'settings'],
];
const state = { route: 'overview', demo: false, theme: ['system','light','dark'].includes(localStorage.getItem('apw-theme'))?localStorage.getItem('apw-theme'):'system', uiScale: ['0.9','1','1.1','1.2'].includes(localStorage.getItem('apw-scale'))?localStorage.getItem('apw-scale'):'1', devices: [], serial: '', packageName: localStorage.getItem('apw-package') || '', info: null, status: null,
  samples: [], monitoring: false, generation: 0, pollTimer: null, interval: 2000, error: '', frames: null, budget: 16.667, startup: null, startupTrace:null, compilation:null, startupMode: 'cold', runs: 3,
  sourceSnapshots:[], sourceSnapshot:null, sourceQuery:'', sourceMatches:null, sourceFile:null, sourceLine:null, gpuArtifacts:[], gpuChecks:{}, gpuCapabilities:null, agiPath:null, battery:null, batteryBefore:null, batteryDelta:null, batteryEndCaptured:false, traceResult:null, traceArchives:[], traceIncludeApp:false, frameTimeline:null, frameTimelineScope:'all', binderScope:'all', binderDirection:'both', cpuProfile:null, cpuOriginal:null, cpuTimeline:null, cpuPerfFile:null, cpuArchives:[], cpuSymfs:'', cpuEvents:[], cpuEvent:null, cpuEventsTruncated:false, cpuBin:null, cpuRange:null, cpuThreadFilter:null, cpuFilter:'', cpuFocus:[], layout: null, nodes: [], selectedNode: null, layoutFilter: '', layoutRoot: null, layoutBaseline: null, heap: null, heapBaseline: null, heapRole: 'current', heapView: 'classes', heapFilter: '', heapBrowse: null, network: null, networkAgentActive:false, networkAgentTimer:null, networkAgentGeneration:0, baseline: null, current: null, apk:null, apkTab:'overview',apkFilter:'',apkCategory:'all',apkComponent:'all', sessions: [], busy: new Set(), replay: false, networkFilter: '', deviceGeneration: 0 };
let toastTimer, importHandler;
function applyAppearance(){
  const dark=state.theme==='dark'||(state.theme==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme=dark?'dark':'light';
  document.documentElement.style.zoom=state.uiScale;
}
function persistAppearance(){
  localStorage.setItem('apw-theme',state.theme);localStorage.setItem('apw-scale',state.uiScale);
  return window.desktop?.saveAppearance?window.desktop.saveAppearance({theme:state.theme,scale:state.uiScale}):Promise.resolve();
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(state.theme==='system')applyAppearance();});
applyAppearance();
window.desktop?.getAppearance().then(preferences=>{
  if(['system','light','dark'].includes(preferences.theme))state.theme=preferences.theme;
  if(['0.9','1','1.1','1.2'].includes(preferences.scale))state.uiScale=preferences.scale;
  localStorage.setItem('apw-theme',state.theme);localStorage.setItem('apw-scale',state.uiScale);applyAppearance();
  if(state.route==='settings')render();
}).catch(error=>toast(`无法读取桌面外观设置：${error.message}`,true));

async function api(path, body, binary = false) {
  const response = await fetch(`/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'X-Workbench-Token': token, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) { const value = await response.json(); throw new Error(value.error || '请求失败'); }
  return binary ? response.blob() : response.json();
}
const query = () => `serial=${encodeURIComponent(state.serial)}&package=${encodeURIComponent(state.packageName)}`;
function toast(message, error = false) {
  $('#toast').textContent = message; $('#toast').className = `visible${error ? ' error' : ''}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').className = '', error ? 6500 : 3500);
}
function sourceTag(source = state.demo ? 'demo' : 'adb') {
  return `<span class="tag source-chip ${source === 'demo' ? 'orange' : source === 'adb' ? 'green' : ''}">${{ demo: '演示数据', adb: 'ADB 采集', import: '离线导入' }[source] || '离线记录'}</span>`;
}
const button = (action, label, symbol, primary = false, disabled = false) => `<button class="button${primary ? ' primary' : ''}" data-action="${action}" ${disabled ? 'disabled' : ''}>${symbol ? icon(symbol, 14) : ''}${label}</button>`;
function pageHeader(title, subtitle, actions = '', eyebrow = 'ANDROID PERFORMANCE WORKBENCH') {
  return `<div class="page-header"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${subtitle}</p></div><div class="header-actions">${actions}</div></div>`;
}
function statCard(label, value, unit, note, symbol, color = '', key = '') {
  return `<div class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon ${color}">${icon(symbol, 15)}</span></div><div class="stat-value"><span ${key ? `data-live="${key}"` : ''}>${value}</span><small>${unit}</small></div><div class="stat-foot"><span ${key==='cpu'?'data-cpu-label':''}>${note}</span></div></div>`;
}
function empty(title, text, symbol = 'activity', action = '') { return `<div class="empty">${icon(symbol, 28)}<strong>${title}</strong>${text}${action ? `<div>${action}</div>` : ''}</div>`; }
const note = text => `<div class="metric-note">${icon('info', 15)}<span>${text}</span></div>`;
const loading = label => `<span class="busy"><i class="spinner"></i>${label}</span>`;
const last = () => state.samples.at(-1);
const cpuLabel = () => last()?.source==='demo'?'演示 CPU':last()?.cpu?.method==='proc-stat'?'/proc 差值 · 主进程 · 单核 100%':'dumpsys cpuinfo · 应用进程合计';
const liveValue = key => ({ cpu: fmt(last()?.cpu?.percent), memory: fmt(last()?.memory?.pssMb), battery: fmt(last()?.battery?.level, 0), temperature: fmt(last()?.battery?.temperatureC) }[key]);

function renderNav() {
  $('#nav').innerHTML = routes.map(([route, label, symbol, badge]) => `${route==='sessions' ? '<div class="nav-separator"></div>' : ''}<a href="#${route}" aria-label="${label}" title="${label}" class="nav-item${state.route === route ? ' active' : ''}" ${state.route === route ? 'aria-current="page"' : ''}>${icon(symbol, 17)}<span>${label}</span>${badge ? `<small class="nav-count">${badge}</small>` : ''}</a>`).join('');
  $('#breadcrumb').textContent = routes.find(r => r[0] === state.route)?.[1] || '概览';
}
function updateChrome() {
  $$('[data-version]').forEach(node=>node.textContent=state.status?.version?`v${state.status.version}`:'');
  $('#mode-btn').textContent = state.demo ? '退出演示' : '进入演示';
  $('#connection-status').textContent = state.demo ? '演示模式' : state.serial ? 'ADB 已连接' : '未连接设备';
  $('#connection-status').className = `connection-status ${state.demo ? 'demo' : state.serial ? 'connected' : ''}`;
  const message = state.demo ? '当前为演示模式：图表和设备信息来自内置示例。退出演示并连接 Android 设备，即可采集真实数据。' : state.error;
  $('#notice').textContent = message; $('#notice').hidden = !message;
  $('#footer-status').textContent = state.monitoring ? `正在采集 · 每 ${state.interval / 1000} 秒 · ${state.samples.length} 个样本` : state.replay ? '正在查看已保存的采集记录' : state.demo ? '演示模式 · 示例数据' : state.serial ? '设备已连接 · 准备就绪' : '等待设备连接';
}
function renderDeviceOptions() {
  $('#device-select').innerHTML = state.demo ? `<option value="${DEMO_DEVICE.serial}">Pixel 8 · 演示设备</option>` : `<option value="">${state.devices.length ? '选择连接的设备' : '未发现 Android 设备'}</option>` + state.devices.map(d => `<option value="${esc(d.serial)}" ${d.state !== 'device' ? 'disabled' : ''}>${esc(d.model)}${d.state !== 'device' ? ` · ${esc(d.state)}` : ''}</option>`).join('');
  $('#device-select').value = state.serial;
  $('#package-input').value = state.packageName;
  $('#package-input').disabled = state.demo;
}
function panelChart(title, subtitle, canvasId, extra = '', large = false) {
  return `<div class="panel"><div class="panel-head"><div><h2>${title}</h2><p ${canvasId==='cpu-chart'||canvasId==='overview-chart'?'data-cpu-label':''}>${subtitle}</p></div>${extra}</div><div class="panel-body"><div class="chart-box${large ? ' large' : ''}"><canvas id="${canvasId}" aria-label="${title}" role="img"></canvas>${!state.samples.length ? '<div class="empty-chart">开始采集后显示性能曲线</div>' : ''}</div><div class="chart-bottom"><span data-chart-start>${state.samples.length ? new Date(state.samples[0].timestamp).toLocaleTimeString('zh-CN', { hour12: false }) : '—'}</span><span data-chart-end>${state.samples.length ? new Date(last().timestamp).toLocaleTimeString('zh-CN', { hour12: false }) : '—'}</span></div></div></div>`;
}
function renderOverview() {
  const info = state.info;
  const modules = [
    ['monitor', '实时监控', '持续观察 CPU、PSS 内存与设备电池', 'cpu', ''], ['frames', '帧耗时分析', '定位慢帧，查看耗时分布与分位数', 'frames', 'blue'],
    ['startup', '启动测试', '重复测量冷、温、热启动耗时', 'rocket', 'orange'], ['layout', '布局检查', '层级、屏幕快照与节点属性联动', 'layers', 'purple'],
    ['trace', '系统追踪', '采集 Perfetto 追踪，保留原始证据', 'trace', 'blue'], ['network', '网络分析', '导入 HAR，检查请求与耗时', 'network', ''],
    ['apk','APK 分析','包信息、签名证书与包体积分析','package','orange'],
  ];
  return pageHeader('性能，尽在掌握', '连接设备，采集证据，从每一次运行中发现优化空间。', button('import-session', '导入记录', 'upload') + button(state.monitoring ? 'stop-monitor' : 'start-monitor', state.monitoring ? '停止采集' : '开始采集', state.monitoring ? 'stop' : 'play', true)) +
    `<div class="grid stats-grid">${statCard('应用 CPU 使用率', liveValue('cpu'), '%', cpuLabel(), 'cpu', 'green', 'cpu')}${statCard('应用内存 · PSS', liveValue('memory'), 'MB', '按比例分摊的物理内存', 'memory', 'purple', 'memory')}${statCard('设备电量', liveValue('battery'), '%', '设备级快照 · 非应用耗电量', 'battery', 'orange', 'battery')}${statCard('电池温度', liveValue('temperature'), '°C', '设备电池传感器', 'activity', '', 'temperature')}</div>` +
    `<div class="section-heading"><h2>运行状态 <span>让每个指标都有迹可循</span></h2>${last()?sourceTag(last().source):'<span class="tag">尚未采集</span>'}</div><div class="grid chart-layout">` +
    panelChart('CPU 使用率', cpuLabel(), 'overview-chart', `<div class="chart-legend"><span><i style="background:#68a996"></i>CPU</span><span class="tag">${state.monitoring ? '采集中' : state.samples.length ? '已载入' : '待采集'}</span></div>`) +
    `<div class="panel"><div class="panel-head"><h2>当前设备</h2>${icon('phone', 15)}</div><div class="panel-body"><div class="device-summary"><div class="phone-icon"></div><div><h3>${esc(info?.model || '等待连接')}</h3><p>${info ? `Android ${esc(info.version)} · API ${esc(info.api)}` : '通过 USB 或已配置的无线 ADB'}</p></div></div><dl class="key-values"><dt>设备序列号</dt><dd>${esc(info?.serial || '—')}</dd><dt>CPU 架构</dt><dd>${esc(info?.abi || '—')}</dd><dt>目标进程</dt><dd data-pid>${esc(last()?.pid || '—')}</dd><dt>采样间隔</dt><dd>${state.interval / 1000} s</dd></dl><div class="device-capability">${icon('info', 12)}${state.demo ? '内置示例 · 可体验全部页面' : info ? '无需 Root · 能力取决于设备权限' : '开启 USB 调试，并在设备上授权'}</div></div></div></div>` +
    `<div class="section-heading"><h2>分析工具</h2><span class="subtle">从采集到定位，专注每一个细节</span></div><div class="grid module-grid">${modules.map(([route, title, subtitle, symbol, color]) => `<a href="#${route}" class="module-card"><span class="module-icon ${color}">${icon(symbol, 19)}</span><div><h3>${title}</h3><p>${subtitle}</p></div><span class="arrow">${icon('arrow', 13)}</span></a>`).join('')}</div>` +
    `<div class="section-heading"><h2>最近采集 <span>${state.sessions.length} 份本地记录</span></h2><a class="subtle" href="#sessions">查看全部 →</a></div><div class="panel">${sessionTable(state.sessions.slice(0, 4))}</div>`;
}
function renderMonitor() {
  const sample = last();
  return pageHeader('实时监控', '持续采集应用资源快照，保留原始统计口径。', button('save-monitor', '保存记录', 'download', false, !state.samples.length) + button(state.monitoring ? 'stop-monitor' : 'start-monitor', state.monitoring ? '停止采集' : '开始采集', state.monitoring ? 'stop' : 'play', true)) +
    note('CPU 优先读取 /proc 计数器差值（主进程，单核 100%，需两次采样）；权限不足时回退 cpuinfo 的应用进程统计窗口，超过 30 秒未更新则不可用。内存来自 dumpsys meminfo，电池信息属于整台设备。') +
    `<div class="toolbar"><label>采样间隔 <select id="interval-select" ${state.monitoring ? 'disabled' : ''}>${[2000,5000,10000].map(n => `<option value="${n}" ${n === state.interval ? 'selected' : ''}>${n / 1000} 秒</option>`).join('')}</select></label><span class="tag" data-sample-count>${state.samples.length} 个样本</span><span class="spacer"></span>${sourceTag(sample?.source)}${button('sample-once', '采集一次', 'refresh', false, state.monitoring || state.busy.has('sample'))}</div>` +
    `<div class="grid stats-grid">${statCard('CPU 使用率', liveValue('cpu'), '%', cpuLabel(), 'cpu', 'green', 'cpu')}${statCard('PSS 内存', liveValue('memory'), 'MB', '主进程内存快照', 'memory', 'purple', 'memory')}${statCard('设备电量', liveValue('battery'), '%', '设备级指标', 'battery', 'orange', 'battery')}${statCard('电池温度', liveValue('temperature'), '°C', '设备级指标', 'activity', '', 'temperature')}</div><div style="height:20px"></div>` +
    `<div class="grid monitor-grid">${panelChart('CPU 使用率', cpuLabel(), 'cpu-chart')}${panelChart('PSS 内存', 'dumpsys meminfo · MB', 'memory-chart')}</div>` +
    `<div style="height:20px"></div><div class="panel"><div class="panel-head"><h2>内存组成 <span class="tag">App Summary</span></h2><span class="subtle">MB · 最近一次采样</span></div><div id="memory-breakdown">${memoryBreakdown()}</div></div><div id="sample-warning" class="hint">${esc(sample?.warnings?.join('；') || '')}</div><div class="hint" data-cpu-window>${esc(sample?.cpu?.window || '')}</div>`;
}
function memoryBreakdown() {
  const categories = last()?.memory?.categories;
  if (!categories || !Object.keys(categories).length) return empty('暂无内存组成', '运行目标应用后开始采集。', 'memory');
  const max = Math.max(...Object.values(categories), 1);
  return `<div class="memory-bars">${Object.entries(categories).map(([name, value]) => `<div class="memory-row"><span>${esc(name)}</span><div class="bar-track"><div class="bar-fill" style="width:${value / max * 100}%"></div></div><span class="mono">${fmt(value)} MB</span></div>`).join('')}</div>`;
}
function renderFrames() {
  const f = state.frames;
  return pageHeader('帧耗时分析', '查看实际渲染帧耗时，找到偏离流畅体验的瞬间。', button('save-frames', '保存记录', 'download', false, !f) + button('capture-frames', '读取帧数据', 'refresh', true, state.busy.has('frames'))) +
    `<div class="toolbar"><label>参考刷新率 <select id="budget-select">${[[16.667,'60 Hz · 16.67 ms'],[11.111,'90 Hz · 11.11 ms'],[8.333,'120 Hz · 8.33 ms']].map(([n,s])=>`<option value="${n}" ${n===state.budget?'selected':''}>${s}</option>`).join('')}</select></label>${button('reset-frames', '重置设备统计', 'refresh', false, state.busy.has('frames'))}<span class="spacer"></span>${f ? sourceTag(f.source) : ''}${button('import-frames', '导入 gfxinfo 文本', 'upload')}</div>` +
    note(f?.sourceFormat==='histogram'?`${f.note} 平台 Janky frames 是系统单独报告的计数；不等同于按当前预算计算的比例。`:'数据来自 dumpsys gfxinfo framestats 的有限历史缓冲区；仅统计 Flags=0 且时间戳有效的帧。超过所选预算的帧数是参考信号，不等同于平台 Jank、FPS 或刷新率检测。') +
    `<div class="grid stats-grid">${statCard(f?.sourceFormat==='histogram'?'直方图样本':'有效帧', fmt(f?.count,0), '帧', '当前 gfxinfo 缓冲区', 'frames', 'green')}${statCard('超预算比例', fmt(f?.slowPercent), '%', f?.sourceFormat==='histogram'?'直方图无法精确确定逐帧超预算数':`${f?.slow ?? '—'} 帧超过 ${fmt(f?.budgetMs ?? state.budget,2)} ms`, 'activity', 'orange')}${statCard('P95 帧耗时', fmt(f?.p95), 'ms', f?.sourceFormat==='histogram'?(f.percentileSource==='platform'?'设备报告值':'直方图桶上界估算'):'95% 的帧耗时不超过此值', 'chart', 'purple')}${statCard(f?.sourceFormat==='histogram'?'最慢桶上界':'最长帧', fmt(f?.max), 'ms', f?.sourceFormat==='histogram'?'最慢直方图桶的上界':'缓冲区内最大帧耗时', 'clock')}</div><div style="height:20px"></div>` +
    `<div class="panel"><div class="panel-head"><div><h2>${f?.sourceFormat==='histogram'?'帧耗时直方图':'逐帧耗时'}</h2><p>${f?.sourceFormat==='histogram'?`${f.histogramBuckets?.length||0} 个耗时桶 · 无逐帧时间戳`:`最近 ${Math.min(f?.count || 0, 150)} 帧 · 鼠标悬停查看耗时`}</p></div>${f?.sourceFormat==='histogram'?'':`<div class="chart-legend"><span><i style="background:#81b9a9"></i>预算内</span><span><i style="background:#d9b77e"></i>超预算</span></div>`}</div><div class="panel-body">${f?.sourceFormat==='histogram'?`<div class="table-wrap"><table><thead><tr><th>桶上界</th><th>帧数</th></tr></thead><tbody>${f.histogramBuckets.map(bucket=>`<tr><td>${fmt(bucket.upperMs,2)} ms</td><td>${fmt(bucket.count,0)}</td></tr>`).join('')}</tbody></table></div>`:f?.count ? frameBars(f) : empty('暂无有效帧', '先重置统计，在设备上操作目标应用，再读取帧数据。', 'frames')}</div></div>` +
    (f ? `<div class="hint">P50 ${fmt(f.p50)} ms　·　P90 ${fmt(f.p90)} ms　·　P99 ${fmt(f.p99)} ms　·　平台 Janky frames 计数：${esc(f.platformJank ?? '不可用')}（可能与缓冲区范围不同）</div>${f.sourceFormat==='histogram'?'':frameClusters(f)}` : '')+renderFrameTimeline()+renderDeadlineClusters(state.frameTimeline);
}
function renderFrameTimeline(){
  const data=state.frameTimeline,rows=data?.frames||[];
  return `<div style="height:20px"></div><div class="panel"><div class="panel-head"><h2>Perfetto FrameTimeline</h2>${button('load-frame-timeline','读取当前追踪','refresh',false,!state.traceResult?.sessionId||state.busy.has('trace'))}</div><div class="panel-body"><label>查询范围 <select id="frame-timeline-scope"><option value="all" ${state.frameTimelineScope==='all'?'selected':''}>全部进程</option><option value="target" ${state.frameTimelineScope==='target'&&state.packageName?'selected':''} ${state.packageName?'':'disabled'}>当前应用及子进程</option></select></label><p class="hint">读取当前已导入追踪的实际帧时间线；Android 12 及以上且追踪包含 FrameTimeline 数据时才有结果。这里展示系统原始 Jank 类型和呈现状态，与 gfxinfo 的自选预算分组不是同一指标。多图层或同一帧的多条记录不会自动合并。完成时差是实际结束减预期结束；仅在进程、令牌和图层对应唯一时计算，不代表实际显示时间或平台 Jank 。最多读取最早 2,000 条。</p>${data?`<p class="hint">来源 ${esc(data.fileName)} · ${esc(data.packageName||'\u5168\u90e8\u8fdb\u7a0b')} · ${rows.length} 条${data.truncated?' · 已截断':''}</p>${rows.length?`<div class="table-wrap"><table><thead><tr><th>进程 / 图层</th><th>实际持续时间</th><th>较预期完成</th><th>Jank 类型</th><th>呈现状态</th><th></th></tr></thead><tbody>${rows.slice(0,300).map((r,i)=>`<tr><td>${esc(r.process||'未知进程')}<br><span class="subtle">${esc(r.layer||'未知图层')}</span></td><td>${fmt(Number(r.durationNs)/1e6,2)} ms</td><td>${r.completionDeltaNs===null?'不可用':`${Number(r.completionDeltaNs)>0?'+':''}${fmt(Number(r.completionDeltaNs)/1e6,2)} ms`}</td><td>${esc(r.jankType||'未提供')}</td><td>${esc(r.presentType||'未提供')}</td><td><button class="button small" data-frame-timeline="${i}">详情</button> <button class="button small" data-frame-trace="${i}">查看追踪</button>${r.processId&&r.durationNs!=='0'?` <button class="button small" data-frame-threads="${i}">同期线程状态</button>`:''}</td></tr>`).join('')}</tbody></table></div><p class="hint">最多显示 300 条。</p>`:empty('追踪没有实际帧时间线记录','请使用包含 FrameTimeline 数据的追踪。','frames')}`:'<p class="hint">先在系统追踪中导入追踪文件，再读取帧时间线。</p>'}</div></div>`;
}
function renderDeadlineClusters(data){
  if(!data)return '';
  const clusters=clusterFrameTimeline(data.frames);
  return `<div style="height:20px"></div><div class="panel"><div class="panel-head"><h2>平台 Deadline Missed 分组</h2><span class="subtle">${clusters.length} 组</span></div><div class="panel-body"><p class="hint">仅按系统报告的 App / SurfaceFlinger CPU / GPU Deadline Missed 分类分组：同一轨道相邻记录、起始时间间隔不超过 100 ms 且连续出现至少两次。不同轨道分开；截断追踪可能遗漏记录，不推断原因。</p>${clusters.length?`<div class="table-wrap"><table><thead><tr><th>进程 / 图层</th><th>记录数</th><th>起始时间 ns</th><th></th></tr></thead><tbody>${clusters.slice(0,200).map((c,i)=>`<tr><td>${esc(c.process||'未知进程')} · ${esc(c.layer||'未知图层')}</td><td>${c.indices.length}</td><td class="mono">${esc(c.startNs)}</td><td><button class="button small" data-deadline-cluster="${i}">查看记录</button></td></tr>`).join('')}</tbody></table></div>`:'<p class="hint">没有符合规则的连续超期记录。</p>'}</div></div>`;
}
function frameClusters(f) {
  const clusters=clusterFrames(f.frames,f.budgetMs),slow=f.frames.filter(row=>row.durationMs>f.budgetMs);
  return `<div style="height:20px"></div><div class="panel"><div class="panel-head"><h2>连续超预算帧</h2><span class="subtle">${clusters.length} 组 · ${slow.length} 个超预算帧</span></div><div class="panel-body"><p class="hint">同一 PROFILEDATA 段中，原始记录相邻、起始时间相差不超过 100 ms 的两个或更多超预算帧归为一组。被跳过的帧和不同段会打断分组；这不是平台 Jank 或因果判断。旧记录或演示数据缺少原始顺序时不分组。</p>${clusters.length?`<div class="table-wrap"><table><thead><tr><th>分组</th><th>连续帧数</th><th>最长帧</th><th></th></tr></thead><tbody>${clusters.slice(0,200).map(c=>`<tr><td>第 ${c.first}–${c.last} 帧 · 段 ${c.section}</td><td>${c.count}</td><td>${fmt(c.maxMs,2)} ms</td><td><button class="button small" data-frame-cluster="${c.first}">查看逐帧</button></td></tr>`).join('')}</tbody></table></div>`:'<p class="hint">没有符合规则的连续超预算帧组。</p>'}<p class="hint">超预算帧（最多显示 200 项）：</p><div class="toolbar">${slow.slice(0,200).map(row=>`<button class="button small" data-frame="${row.index}">#${row.index} · ${fmt(row.durationMs,2)} ms</button>`).join('')||'无'}</div></div></div>`;
}
function frameBars(f) {
  const maximum = Math.max(f.max, f.budgetMs * 1.8);
  return `<div class="frame-chart"><div class="budget-line" style="bottom:${25+(f.budgetMs/maximum)*180}px"><span>${fmt(f.budgetMs,2)} ms 预算</span></div>${f.frames.slice(-150).map(row=>`<div class="frame-bar ${row.overBudget?'slow':''}" style="height:${row.durationMs/maximum*180}px" title="第 ${row.index} 帧 · ${fmt(row.durationMs,2)} ms" data-frame="${row.index}" role="button" tabindex="0" aria-label="第 ${row.index} 帧，${fmt(row.durationMs,2)} 毫秒"></div>`).join('')}</div>`;
}
function renderStartup() {
  const result = state.startup, busy = state.busy.has('startup');
  return pageHeader('启动测试', '用重复实验观察启动耗时，区分请求协议与实际启动状态。', button('save-startup','保存记录','download',false,!result)) +
    note('冷启动会 force-stop 目标应用；温启动先按 Back，热启动先按 Home。测试会操作手机当前界面。TotalTime 是 am start -W 的报告值；编译状态来自系统输出，不能证明 Baseline Profile 已安装或生效。') +
    `<div class="toolbar"><label>请求模式 <select id="startup-mode" ${busy?'disabled':''}>${[['cold','冷启动'],['warm','温启动'],['hot','热启动']].map(([key,label])=>`<option value="${key}" ${state.startupMode===key?'selected':''}>${label}</option>`).join('')}</select></label><label>重复次数 <input id="startup-runs" type="number" min="1" max="10" value="${state.runs}" ${busy?'disabled':''}></label><span class="spacer"></span>${busy?loading(`测试中，最多 ${state.runs} 次…`):button('run-startup','开始测试','play',true)}</div>` +
    `<div class="grid stats-grid">${statCard('平均 TotalTime',fmt(result?.meanMs),'ms','有效运行的算术平均值','rocket','green')}${statCard('最快一次',fmt(result?Math.min(...result.results.map(r=>r.totalTimeMs)):null,0),'ms','TotalTime 最小值','clock')}${statCard('最慢一次',fmt(result?Math.max(...result.results.map(r=>r.totalTimeMs)):null,0),'ms','TotalTime 最大值','activity','orange')}${statCard('有效运行',fmt(result?.results.length,0),'次','保留每次原始报告','chart','purple')}</div><div style="height:20px"></div>` +
    `<div class="panel"><div class="panel-head"><h2>每次启动耗时</h2>${result?sourceTag(result.source):''}</div>${result?`<div class="startup-chart">${result.results.map(r=>`<div class="startup-column" style="height:${r.totalTimeMs / Math.max(...result.results.map(x=>x.totalTimeMs),1)*160}px"><span>${r.totalTimeMs} ms</span><small>第 ${r.run} 次</small></div>`).join('')}</div><div class="table-wrap"><table><thead><tr><th>运行</th><th>请求模式</th><th>观察到的模式</th><th>TotalTime</th><th>ThisTime</th><th>WaitTime</th></tr></thead><tbody>${result.results.map(r=>`<tr><td>#${r.run}</td><td>${esc(result.requestedMode)}</td><td>${esc(r.observedMode||'设备未报告')}</td><td class="mono">${fmt(r.totalTimeMs,0)} ms</td><td class="mono">${fmt(r.thisTimeMs,0)} ms</td><td class="mono">${fmt(r.waitTimeMs,0)} ms</td></tr>`).join('')}</tbody></table></div>`:empty(busy?'正在运行启动实验':'尚未运行启动实验',busy?'请保持设备解锁，并等待实验完成。':'选择设备和应用后开始，建议测试期间避免其他操作。','rocket')}</div>${renderCompilation(result)}${renderBaselineEvidence(result)}${renderStartupTrace()}`;
}
function renderBaselineEvidence(result){
 const apk=state.apk,evidence=apkBaselineEvidence(apk),target=result?.packageName||state.packageName;
 const labels={recognized:'已识别文件头', 'unknown-version':'未知版本',truncated:'文件头不足 8 字节','invalid-magic':'文件标识不匹配','invalid-version':'版本字段格式无效',unreadable:'文件头读取失败'};
 const body=evidence?.files[0]?.header?.body,matchLabels={'checksum-equal':'文件头校验值相同','checksum-different':'文件头校验值不同',unmatched:'无法对应单个 DEX'};
 const details=body?.status==='headers-parsed'&&Array.isArray(body.entries)?`<p class="hint">010 Profile 的方法标记可重叠，不能相加；类和方法均为记录数量，不代表设备已编译。仅对名称精确匹配的 APK 内 DEX 比较头部校验值；未重新计算 DEX 校验值或解析方法名称。包名、设备安装和实际编译仍需另行核对。</p><table><thead><tr><th>Profile DEX 名称</th><th>记录校验值</th><th>类 / 方法 ID</th><th>热 / 启动 / 启动后方法</th><th>对照</th></tr></thead><tbody>${body.entries.map(e=>`<tr><td>${esc(e.name)}</td><td class="mono">${Number.isInteger(e.checksum)?e.checksum.toString(16).padStart(8,'0'):'—'}</td><td>${esc(e.classes??'—')} / ${esc(e.methodIds??'—')}</td><td>${esc(e.hotMethods??'—')} / ${esc(e.startupMethods??'—')} / ${esc(e.postStartupMethods??'—')}</td><td>${esc(matchLabels[e.match]||'未知')}</td></tr>`).join('')}</tbody></table>`:body?.status==='unavailable'?`<p class="hint">010 内容检查不可用：${esc(body.reason)}。</p>`:'';
 return `<div style="height:20px"></div><div class="panel"><div class="panel-head"><h2>Baseline Profile 构建证据</h2><a class="button small" href="#apk">${apk?'查看 APK 分析':'分析 APK'}</a></div><div class="panel-body"><p class="hint">检查已分析单个 APK 的标准路径和文件头；010 版本可读取 DEX 记录和方法标记。不证明内容完整有效、已安装、编译或生效。分片、其他安装来源或生成方式可能不同。</p>${evidence?`<p>APK：${esc(apk.fileName)} · ${esc(apk.packageName||'包名未知')} · ${apk.packageName&&target?(apk.packageName===target?'与当前目标包名相同，版本和实际安装文件尚未核对':'与当前目标包名不同'):'目标包名不可用'}</p><table><thead><tr><th>路径</th><th>文件状态</th><th>文件头</th></tr></thead><tbody>${evidence.files.map(f=>`<tr><td class="mono">${esc(f.path)}</td><td>${f.status==='present'?`存在 · ${f.bytes} 字节${f.bytes===0?'（空文件）':''}`:f.status==='absent'?'当前 APK 未包含':'无法确定'}</td><td>${f.status==='present'?`${esc(labels[f.header?.status]||'未检查')}${f.header?.version?` · ${esc(f.header.version)}`:''}`:'—'}</td></tr>`).join('')}</tbody></table>${details}`:'<p class="hint">先在 APK 分析中载入目标构建的 APK；当前没有可用文件清单。</p>'}</div></div>`;
}
function renderStartupTrace(){
  const trace=state.startupTrace?.sessionId===state.traceResult?.sessionId?state.startupTrace:null,rows=trace?.startups||[];
  const ms=value=>value===null?'不可用':`${fmt(Number(value)/1e6,2)} ms`;
  return `<div style="height:20px"></div><div class="panel"><div class="panel-head"><h2>Perfetto 启动与显示时间</h2>${button('load-startup-trace','读取当前追踪','refresh',false,!state.traceResult?.sessionId||state.busy.has('trace'))}</div><div class="panel-body"><label>查询范围 <select id="startup-trace-scope"><option value="all">全部应用</option><option value="target" ${state.packageName?'':'disabled'}>当前应用</option></select></label><p class="hint">先导入或采集包含 Android 启动和帧事件的系统追踪。数据由 Perfetto 启动标准库计算；TTFD 依赖应用报告 fully drawn 和相关帧证据，缺失不代表零。可能一条启动对应多个进程记录，不与上面的实验自动配对；最多读取最早 1,000 条。</p>${trace?`<p class="hint">${esc(trace.fileName||'追踪文件')} · ${esc(trace.packageName||'全部应用')} · ${rows.length} 条${trace.truncated?' · 已截断':''}</p>${rows.length?`<div class="table-wrap"><table><thead><tr><th>应用 / 启动类型</th><th>启动区间</th><th>TTID</th><th>TTFD</th><th>进程标识</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.packageName||'未报告')}<br><span class="hint">${esc(r.type||'未报告')} · #${esc(r.id)}</span></td><td>${ms(r.durationNs)}</td><td>${ms(r.ttidNs)}</td><td>${ms(r.ttfdNs)}</td><td>${esc(r.upid||'未报告')}</td><td><button class="button small" data-startup-breakdown="${esc(r.id)}">阶段分解</button> <button class="button small" data-startup-trace="${esc(r.id)}">查看追踪</button></td></tr>`).join('')}</tbody></table></div>`:empty('追踪中没有可用启动记录','确认追踪覆盖启动过程并包含必要系统事件。','rocket')}`:'<p class="hint">尚未读取当前追踪。</p>'}</div></div>`;
}
function renderCompilation(result){
  const views=[['实验前',result?.compilationBefore],['实验后',result?.compilationAfter],['单独读取',state.compilation]].filter(([,snapshot])=>snapshot);
  return `<div style="height:20px"></div><div class="panel"><div class="panel-head"><h2>应用编译状态</h2>${button('read-compilation','读取当前状态','refresh',false,state.demo||state.busy.has('startup'))}</div><div class="panel-body"><p class="hint">读取 dumpsys package 中目标包的 Dexopt state，按文件和指令集展示系统报告；状态与原因不能单独证明 Baseline Profile 是否生效。不同 Android 版本或厂商可能不提供可解析数据。</p>${views.length?views.map(([label,snapshot])=>`<h3>${label} · ${date(snapshot.timestamp)}</h3>${snapshot.available?`<div class="table-wrap"><table><thead><tr><th>文件</th><th>指令集</th><th>编译状态</th><th>原因</th></tr></thead><tbody>${snapshot.entries.map(row=>`<tr><td>${esc(row.path)}</td><td>${esc(row.isa)}</td><td>${esc(row.status)}</td><td>${esc(row.reason||'未提供')}</td></tr>`).join('')}</tbody></table></div>`:`<p class="hint">不可用：${esc(snapshot.reason||'系统未提供')}</p>`}`).join(''):empty('尚无编译状态','运行启动实验或读取当前状态。','info')}</div></div>`;
}

function buildNodes(xml) {
  if(typeof xml!=='string'||xml.length>2*1024*1024||/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error('层级 XML 超过 2 MB 或包含不支持的实体定义');
  const doc = new DOMParser().parseFromString(xml,'application/xml');
  if (doc.querySelector('parsererror') || !doc.querySelector('hierarchy')) throw new Error('层级 XML 格式无效');
  return extractLayoutNodes(doc.documentElement);
}
function layoutTree() {
  const query = state.layoutFilter.trim().toLocaleLowerCase();
  const nodes = layoutScope(state.nodes,state.layoutRoot).filter(node => !query || Object.values(node.attributes).some(value => value.toLocaleLowerCase().includes(query)));
  if (!state.nodes.length) return empty('等待快照','采集界面或导入层级 XML','layers');
  if (!nodes.length) return empty('没有匹配的节点','尝试其他类名、文本或属性','search');
  return nodes.map(node=>`<button class="tree-node ${node.id===state.selectedNode?'active':''}" data-node="${node.id}" style="padding-left:${8+Math.min(node.depth-(state.layoutRoot===null?0:state.nodes[state.layoutRoot]?.depth||0),12)*13}px" title="${esc(node.attributes['resource-id']||node.className)}"><span style="color:#a8b6bd">${node.depth?'⌞':'◇'}</span><span>${esc(node.className)}</span>${node.attributes.text?`<small>${esc(node.attributes.text)}</small>`:''}</button>`).join('');
}
function renderLayout() {
  const layout = state.layout,history=state.sessions.filter(s=>s.kind==='layout').sort((a,b)=>a.timestamp-b.timestamp);
  return pageHeader('布局检查','从可访问性层级到屏幕，检查可见界面的结构。',button('layout-baseline','设为对比基线','layers',false,!layout)+button('import-layout','导入 XML','upload')+button('save-layout','保存快照','download',false,!layout)+button('capture-layout','采集当前界面','layers',true,state.busy.has('layout'))) +
    note(layout?.note || '采集设备当前前台窗口的 UIAutomator 可访问性层级，不保证属于所选应用，也不是完整 View/Compose 树。安全窗口可能没有截图；没有可访问性语义的节点可能缺失。') +
    (state.busy.has('layout')?`<div class="toolbar">${loading('正在获取层级与屏幕快照…')}</div>`:'') +
    `<div class="panel"><div class="panel-head"><h2>历史快照</h2>${button('refresh-sessions','刷新','refresh')}</div><div class="panel-body"><div class="toolbar"><label>保存的层级 <select id="layout-history"><option value="">选择快照</option>${history.map(s=>`<option value="${esc(s.id)}">${esc(s.name)} · ${date(s.timestamp)} · ${esc(s.source)}</option>`).join('')}</select></label>${button('layout-load-current','载入当前快照','folder',false,!history.length||state.busy.has('layout'))}${button('layout-load-baseline','载入为基线','layers',false,!history.length||state.busy.has('layout'))}</div><p class="hint">按保存时间从早到晚排列。选择“与上一版比较”会将相邻两份记录载入差异视图；也可以分别载入任意快照作为当前版本或基线。</p>${history.length>1?`<div class="table-wrap"><table><thead><tr><th>时间</th><th>快照</th><th>来源</th><th>时间线</th></tr></thead><tbody>${history.map((s,i)=>`<tr><td>${date(s.timestamp)}</td><td>${esc(s.name)}</td><td>${esc(s.source)}</td><td>${i?`<button class="button small" data-layout-timeline-compare="${esc(s.id)}">与上一版比较</button>`:'— 起点'}</td></tr>`).join('')}</tbody></table></div>`:''}</div></div><div style="height:20px"></div>`+
    `<div class="panel inspector"><section><div class="panel-head"><h2>界面层级</h2><span class="tag">${state.nodes.length} 节点</span></div><div style="padding:10px"><div class="toolbar">${button('layout-isolate','隔离选中节点','search',false,state.selectedNode===null)}${button('layout-reset','显示全部','refresh',false,state.layoutRoot===null)}</div><p class="hint">${state.layoutRoot===null?'显示完整层级':`已隔离 ${esc(state.nodes[state.layoutRoot]?.className||'节点')} 及其子节点`}</p><input id="layout-search" class="search" style="width:100%;min-width:0" placeholder="搜索类名、文本或属性" aria-label="搜索布局节点" value="${esc(state.layoutFilter)}"></div><div class="tree" id="layout-tree">${layoutTree()}</div></section><section class="canvas-pane"><div class="panel-head"><h2>屏幕快照</h2>${layout?sourceTag(layout.source):'<span class="tag">未采集</span>'}</div>${layout?phonePreview():empty('暂无屏幕快照','采集后可点击屏幕选中节点','phone')}</section><section><div class="panel-head"><h2>节点属性</h2>${icon('info',14)}</div><div id="properties">${properties()}</div></section></div><div class="hint">${esc(layout?.warning || '')}</div>`+layoutFindings()+layoutDiff();
}
function layoutFindings(){
  if(!state.layout)return '';
  const findings=inspectLayout(state.nodes),labels={unlabelled:'可点击节点及已读取子树无文本或内容描述',emptyBounds:'可点击节点边界宽或高为零'};
  return `<div style="height:20px"></div><div class="panel"><div class="panel-head"><h2>节点检查线索</h2><span class="tag">${findings.length} 项</span></div><div class="panel-body"><p class="hint">仅检查当前已读取的 UIAutomator 节点。文本或内容描述字段缺失时不判断标签；图标、合并语义、屏幕外节点或采集截断可能影响结果，请人工核对。边界单位为像素，不代表实际触控区域。</p>${findings.length?`<div class="table-wrap"><table><thead><tr><th>线索</th><th>节点</th><th></th></tr></thead><tbody>${findings.slice(0,500).map(f=>{const n=state.nodes[f.id];return `<tr><td>${labels[f.kind]}</td><td>${esc(n?.className||'节点')}<br><span class="subtle">${esc(n?.attributes?.['resource-id']||'无资源 ID')}</span></td><td><button class="button small" data-layout-finding="${f.id}">定位节点</button></td></tr>`;}).join('')}</tbody></table></div><p class="hint">共 ${findings.length} 项，最多显示 500 项。</p>`:empty('未发现检查线索','这不代表界面不存在问题。','info')}</div></div>`;
}
function layoutDiff(){
  if(!state.layoutBaseline||!state.layout)return '';
  const diff=compareLayouts(state.layoutBaseline.nodes,state.nodes),labels={added:'新增',removed:'移除',changed:'变化'};
  return `<div style="height:20px"></div><div class="panel"><div class="panel-head"><h2>层级快照对比</h2><div class="toolbar">${button('layout-export-diff','导出对比','download')}${button('layout-clear-baseline','清除基线','stop')}</div></div><div class="panel-body"><p class="hint">基线 ${esc(state.layoutBaseline.name||'当前设置')} · ${date(state.layoutBaseline.timestamp)} · 当前 ${date(state.layout.timestamp)}。按包名和 resource-id 匹配；重复 ID 在最近的共同唯一祖先内各只有一个节点时按位置范围候选匹配，无法确认控件身份。无 ID 节点（基线 ${diff.unkeyedBefore} / 当前 ${diff.unkeyedAfter}）及其余重复 ID（${diff.ambiguous.length} 项）不参与匹配。位置变化比较最近的可匹配祖先，不能发现无 ID 或重复容器之间的移动。同级顺序只比较共同唯一父节点的直接唯一子节点，重排涉及的节点都会标记。不同界面或采集时机不保证可比。</p>${diff.changes.length?`<div class="table-wrap"><table><thead><tr><th>资源 ID</th><th>变化</th><th>属性 / 层级</th><th></th></tr></thead><tbody>${diff.changes.slice(0,500).map((c,i)=>`<tr><td>${esc(c.id)}${c.matchScope?`<br><span class="subtle">祖先范围候选：${esc(c.matchScope)}</span>`:''}</td><td>${labels[c.kind]}</td><td>${esc([...c.fields,...(c.moved?[`祖先：${c.oldParent||'无'} → ${c.newParent||'无'}`]:[]),...(c.orderChanged?['同级相对顺序变化']:[])].join('、')||'—')}</td><td><button class="button small" data-layout-diff="${i}">详情</button>${c.after?` <button class="button small" data-layout-diff-select="${i}">选中当前节点</button>`:''}</td></tr>`).join('')}</tbody></table></div><p class="hint">共 ${diff.changes.length} 项，最多显示 500 项。</p>`:empty('没有可匹配的变化','唯一资源 ID 的属性没有变化，或没有可匹配的节点。','layers')}</div></div>`;
}
function phonePreview() {
  const [width,height]=layoutSize(false);
  return `<div class="phone-preview" id="phone-preview" style="aspect-ratio:${width}/${height}" title="点击选中最深层节点">${state.layout.screenshot?`<img alt="设备屏幕快照" src="data:image/png;base64,${esc(state.layout.screenshot)}">`:state.layout.source==='demo'?'<div class="sample-screen"><small style="font-size:7px">9:41</small><h3 style="margin-top:25px">阅读，让生活<br>慢下来</h3><p>为你精选　 /　 THIS WEEK</p><div class="book-cover">山与海<small>A QUIET PLACE TO READ</small></div><p>在文字里，找到另一个世界。</p><div class="sample-button">开始阅读</div></div>':'<div class="empty">无截图<br>仅显示节点边界</div>'}<svg class="phone-overlay" id="phone-overlay" preserveAspectRatio="none"></svg></div>`;
}
function properties() {
  const node = state.nodes[state.selectedNode];
  return node?`<dl class="property-list">${Object.entries(node.attributes).map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v||'—')}${k==='class'&&v?` <button class="button small" data-source-symbol="${esc(v)}">定位类候选</button>`:''}</dd>`).join('')}</dl>`:empty('选择一个节点','点击层级列表或屏幕查看属性','search');
}
function selectNode(id) {
  state.selectedNode=id;
  const isolate=$('[data-action=layout-isolate]');if(isolate)isolate.disabled=false;
  $$('.tree-node').forEach(node=>node.classList.toggle('active',Number(node.dataset.node)===id));
  if ($('#properties')) $('#properties').innerHTML=properties();
  const overlay=$('#phone-overlay'), bounds=state.nodes[id]?.bounds;
  if (!overlay) return;
  const [width,height]=layoutSize();
  const preview=$('#phone-preview');if(preview)preview.style.aspectRatio=`${width}/${height}`;
  overlay.setAttribute('viewBox',`0 0 ${width} ${height}`);
  overlay.innerHTML=bounds?`<rect x="${bounds[0]}" y="${bounds[1]}" width="${Math.max(0,bounds[2]-bounds[0])}" height="${Math.max(0,bounds[3]-bounds[1])}"/>`:'';
}
function layoutSize(useImage=true) {
  const image=useImage?$('#phone-preview img'):null;
  if(image?.naturalWidth) return [image.naturalWidth,image.naturalHeight];
  if(state.layout?.imageSize?.width>0&&state.layout?.imageSize?.height>0)return [state.layout.imageSize.width,state.layout.imageSize.height];
  return [Math.max(1,...state.nodes.map(n=>n.bounds?.[2]||0)),Math.max(1,...state.nodes.map(n=>n.bounds?.[3]||0))];
}
function cpuFocusNode(){
  let node=state.cpuProfile?.root;
  for(const n of state.cpuFocus){if(!node?.children[n]){state.cpuFocus=[];return state.cpuProfile.root;}node=node.children[n];}
  return node;
}
function cpuFlame(node){
  const plot=layoutFlame(node),height=(plot.depth+1)*24;
  const frames=plot.frames.map(({node:frame,x,width,depth,path},i)=>{
    const left=x*1000,w=width*1000,y=height-(depth+1)*24,fullPath=[...state.cpuFocus,...path].join(',');
    const hue=20+((frame.name.split('').reduce((sum,ch)=>(sum*31+ch.charCodeAt(0))%1000,0))%35);
    const label=w>=50?`<text x="${(left+5).toFixed(3)}" y="${y+16}" clip-path="url(#flame-clip-${i})">${esc(frame.name)}</text>`:'';
    return `<g class="flame-frame" role="button" tabindex="0" data-cpu-path="${fullPath}" aria-label="${esc(frame.name)}，权重 ${frame.weight}，占当前范围 ${fmt(frame.weight/node.weight*100,2)}%"><title>${esc(frame.name)} · ${frame.weight.toLocaleString()} · ${fmt(frame.weight/node.weight*100,2)}%</title><clipPath id="flame-clip-${i}"><rect x="${left.toFixed(3)}" y="${y}" width="${Math.max(0,w-2).toFixed(3)}" height="23"/></clipPath><rect x="${left.toFixed(3)}" y="${y}" width="${Math.max(0,w-0.3).toFixed(3)}" height="23" fill="hsl(${hue} 65% 72%)"/>${label}</g>`;
  }).join('');
  return `<div class="panel"><div class="panel-head"><h2>CPU 火焰图</h2><div class="toolbar"><span class="hint">当前范围：${esc(node.name)}</span>${button('cpu-flame-back','上一级','arrow',false,!state.cpuFocus.length)}${button('cpu-flame-reset','全部','refresh',false,!state.cpuFocus.length)}</div></div><div class="panel-body"><p class="hint">横向宽度表示当前范围内的事件周期权重；每一层是调用关系，不表示时间顺序。点击或按回车放大，最多绘制 3,000 节点、41 层。${plot.truncated?' 当前图已截断。':''}</p><div class="flame-scroll"><svg class="flame-graph" viewBox="0 0 1000 ${height}" role="group" aria-label="CPU 火焰图">${frames}</svg></div></div></div>`;
}
function renderCpuTimeline(timeline){
  if(!timeline?.available)return `<div class="panel"><div class="panel-head"><h2>线程采样时间线</h2></div><div class="panel-body"><p class="hint">${timeline?'文件缺少可用时间戳':'folded stacks 不包含样本时间；导入 perf.data 可查看时间线。'}</p></div></div>`;
  const selected=state.cpuRange?`${fmt(state.cpuRange.start,3)}–${fmt(state.cpuRange.end,3)} ms`:'全部时间';const selectedThread=state.cpuThreadFilter||'全部线程';
  const rows=timeline.groups.slice(0,40).map((g,index)=>`<div class="timeline-row"><span title="${esc(g.thread)}">${esc(g.thread)} <button class="button small" data-cpu-trace-thread="${index}" ${!state.traceResult?.sessionId||g.pid<0||g.tid<0?'disabled':''}>追踪状态</button></span><div class="timeline-track">${g.counts.map((count,i)=>count?`<button class="timeline-bin ${state.cpuBin===i&&state.cpuThreadFilter===g.thread?'active':''}" style="left:${i/timeline.bins*100}%;width:${100/timeline.bins}%" data-cpu-bin="${i}" data-cpu-group="${index}" title="${esc(g.thread)} · ${count} 个采样点 · 权重 ${g.weights[i]}" aria-label="${esc(g.thread)}，第 ${i+1} 个时间段，${count} 个采样点"></button>`:'').join('')}</div></div>`).join('');
  return `<div class="panel"><div class="panel-head"><h2>线程采样时间线</h2>${button('cpu-time-reset','全部线程与时间','refresh',false,state.cpuRange===null)}</div><div class="panel-body"><p class="hint">事件：${esc(timeline.event)} · 范围 ${fmt(timeline.durationMs,1)} ms · ${timeline.samples.length.toLocaleString()} 个采样点 · 当前：${selected} · ${esc(selectedThread)}。色块只表示采样点，并非线程运行状态；点击线程的时间段按该线程和时间筛选火焰图及调用树。追踪状态按 PID/TID 查询当前 Perfetto 窗口，不自动对齐时间，也不能证明来自同一设备或同一线程生命周期。${timeline.truncated?' 采样点达到上限，筛选仅覆盖已读取部分。':''}${timeline.skipped?` 跳过 ${timeline.skipped} 个无效样本。`:''}</p><div class="toolbar"><label>起始 ms <input id="cpu-time-start" type="number" min="0" max="${timeline.durationMs}" step="0.001" value="${state.cpuRange?.start??0}" aria-label="起始毫秒"></label><label>结束 ms <input id="cpu-time-end" type="number" min="0" max="${timeline.durationMs}" step="0.001" value="${state.cpuRange?.end??timeline.durationMs}" aria-label="结束毫秒"></label>${button('cpu-time-apply','筛选时间','search')}</div><div class="timeline-list">${rows}</div><p class="hint">仅显示权重最高的 40 个线程；线程按记录名称、PID 和 TID 分组，不能区分标识复用的不同生命周期。</p></div></div>`;
}
function renderCpuProfile() {
  const data=state.cpuProfile,busy=state.busy.has('cpu-profile'),focus=data?cpuFocusNode():null;
  const quality=sampleQuality(state.cpuTimeline);
  const treeRows=[];
  function walk(node,depth){if(depth>12||treeRows.length>=500)return;for(const child of node.children){if(treeRows.length>=500)break;treeRows.push({node:child,depth});walk(child,depth+1);}}
  if(focus)walk(focus,0);
  const query=state.cpuFilter.toLocaleLowerCase();const symbols=data?.symbols.filter(x=>x.name.toLocaleLowerCase().includes(query))||[];
  const threads=data?`<label>首层分组 / 线程 <select id="cpu-thread"><option value="all">全部</option>${data.root.children.map((n,i)=>`<option value="${i}" ${state.cpuFocus[0]===i?'selected':''}>${esc(n.name)}</option>`).join('')}</select></label>`:'';
  return pageHeader('CPU 调用栈采样','使用 simpleperf 采集，或导入 folded stacks 查看调用树。',button('save-cpu-archive','保存采样','folder',false,busy||!state.cpuPerfFile)+button('import-perf','导入 perf.data','upload',false,busy)+button('import-cpu-stacks','导入 folded stacks','upload',false,busy)+button('capture-cpu-profile','采集 perf.data','play',true,busy||state.demo))+
    note('采集使用 simpleperf（macOS 包内置，也可来自 Android NDK）；应用需可调试或可 profile，设备需允许采样。导入 perf.data 需要本机 Python 3；权重为采样周期，不直接等于 CPU 百分比。符号质量取决于采集和符号文件；为保留调用栈边界，名称中的 %、分号和换行会显示为百分号编码。')+
    `<div class="toolbar"><label>采集时长 <select id="cpu-profile-seconds"><option value="5">5 秒</option><option value="10" selected>10 秒</option><option value="20">20 秒</option><option value="30">30 秒</option></select></label>${threads}${state.cpuPerfFile&&state.cpuEvents.length?`<label>采样事件 <select id="cpu-event" ${busy?'disabled':''}>${state.cpuEvents.map(e=>`<option value="${esc(e.name)}" ${e.name===state.cpuEvent?'selected':''}>${esc(e.name)} · ${e.count} 样本</option>`).join('')}</select></label>${button('cpu-event-apply','切换事件','refresh',false,busy||state.cpuEvents.length<2)}`:''}${busy?loading('正在处理…'):''}</div>${state.cpuEventsTruncated?'<p class="hint">事件种类超过 128 项，列表已截断。</p>':''}`+
    `<div class="toolbar"><label>符号目录 <input id="cpu-symfs" type="text" placeholder="可选：symfs 绝对路径" value="${esc(state.cpuSymfs)}" aria-label="符号目录"></label>${window.desktop?.selectSourceDir?button('cpu-symfs-choose','选择目录','folder',false,busy):''}${button('cpu-symfs-apply','重新解析符号','refresh',false,busy||!state.cpuPerfFile)}</div><p class="hint">使用 simpleperf symfs 查找与设备路径及构建 ID 匹配的本机符号文件。更换目录后需重新解析；不保证所有符号均可恢复。</p>`+
    `<div class="panel"><div class="panel-head"><h2>本机采样档案</h2>${button('refresh-cpu-archives','刷新','refresh',false,busy)}</div><div class="panel-body"><div class="toolbar"><label>历史采样 <select id="cpu-archive"><option value="">选择本机采样</option>${state.cpuArchives.map(x=>`<option value="${esc(x.id)}">${esc(x.name.replace(/\.trace$/i,''))} · ${date(x.timestamp)}</option>`).join('')}</select></label>${button('load-cpu-archive','载入采样','folder',false,busy||!state.cpuArchives.length)}</div><p class="hint">保存原始 perf.data 到本机，载入前校验 SHA-256 并重新分析；采样可能包含敏感信息。</p></div></div><div style="height:20px"></div>`+
    (data?.warning?note(`转换工具提示：${esc(data.warning)}`):'')+
    (quality?`<div class="panel"><div class="panel-head"><h2>采样质量</h2><span class="hint">已读取样本</span></div><div class="panel-body"><p>当前函数为 unknown：${quality.unknownLeaf.toLocaleString()} / ${quality.samples.toLocaleString()} 个采样点（权重 ${quality.unknownLeafWeight===null?'超出安全范围':quality.unknownLeafWeight.toLocaleString()}）；没有调用方记录：${quality.noCallers.toLocaleString()} 个采样点。</p><p class="hint">仅统计时间线中有效的已读取样本，不等于丢失采样数或 CPU 时间；没有调用方可能是采集方式或真实栈深度所致。${quality.truncated?'时间线已截断，统计不覆盖全部样本。':''}${quality.skipped?`另有 ${quality.skipped} 个样本未纳入时间线。`:''}本统计覆盖全部已读取时间，不随时间筛选变化。</p></div></div><div style="height:20px"></div>`:'')+
    (data?`<div class="grid stats-grid">${statCard('调用栈记录',data.stacks.toLocaleString(),'条','folded stacks','cpu','green')}${statCard('总权重',data.root.weight.toLocaleString(),'','采样事件周期','activity')}${statCard('符号数',data.symbols.length.toLocaleString(),'个','按名称汇总','chart')}</div><div style="height:20px"></div>${renderCpuTimeline(state.cpuTimeline)}<div style="height:20px"></div>${cpuFlame(focus)}<div style="height:20px"></div><div class="panel"><div class="panel-head"><h2>调用树 · ${esc(focus.name)}</h2><span class="hint">最多显示 500 个节点、13 层</span></div><div class="panel-body"><table><thead><tr><th>调用栈</th><th>包含权重</th><th>占当前范围</th></tr></thead><tbody>${treeRows.map(({node,depth})=>`<tr><td style="padding-left:${12+depth*15}px">${esc(node.name)}</td><td>${node.weight.toLocaleString()}</td><td>${fmt(node.weight/focus.weight*100,2)}%</td></tr>`).join('')}</tbody></table></div></div><div style="height:20px"></div><div class="panel"><div class="panel-head"><h2>函数汇总 · ${state.cpuRange===null?'全部时间':'当前时间段'}（${state.cpuThreadFilter?'所选线程':'所有线程'}）</h2><input id="cpu-profile-search" class="search" placeholder="搜索函数" value="${esc(state.cpuFilter)}"></div><div class="panel-body" id="cpu-profile-symbols">${cpuSymbols(symbols)}</div></div>`:`<div class="panel"><div class="trace-hero"><h2>等待采样数据</h2><p>采集或导入 perf.data；也可导入 folded stacks 文本。</p></div></div>`);
}
function cpuSourceSymbol(name){if(!state.cpuPerfFile)return name;try{return decodeURIComponent(name);}catch{return name;}}
function cpuSymbols(rows){return `<table><thead><tr><th>函数</th><th>自身权重</th><th>包含权重</th><th></th></tr></thead><tbody>${rows.slice(0,500).map(x=>`<tr><td>${esc(x.name)}</td><td>${x.self.toLocaleString()}</td><td>${x.inclusive.toLocaleString()}</td><td><button class="button small" data-cpu-symbol="${esc(x.name)}">查看调用方</button> <button class="button small" data-source-symbol="${esc(cpuSourceSymbol(x.name))}">定位源码候选</button></td></tr>`).join('')}</tbody></table><p class="hint">最多显示 500 项；递归调用的包含权重可能重复计入。调用方分析使用当前火焰图范围；源码定位是声明候选，需人工核对。</p>`;}
function showCpuCallers(symbol){
  const scope=cpuFocusNode(),tree=reverseCallTree(scope,symbol),rows=[];
  const walk=(node,depth)=>{if(depth>12||rows.length>=500)return;for(const child of node.children){if(rows.length>=500)break;rows.push({node:child,depth});walk(child,depth+1);}};walk(tree.root,0);
  showDialog(`调用方 · ${symbol}`,`<p class="hint">当前火焰图范围：${esc(scope.name)}。匹配 ${tree.matches} 个调用树节点，累计包含权重 ${tree.root.weight.toLocaleString()}；递归函数的不同出现位置会重复计权，符号同名也可能合并。向下是调用方，最多显示 500 行、13 层。</p>${rows.length?`<div class="table-wrap"><table><thead><tr><th>调用方</th><th>包含权重</th><th>占匹配权重</th></tr></thead><tbody>${rows.map(({node,depth})=>`<tr><td style="padding-left:${12+depth*15}px">${esc(node.name)}</td><td>${node.weight.toLocaleString()}</td><td>${fmt(node.weight/tree.root.weight*100,2)}%</td></tr>`).join('')}</tbody></table></div>`:empty(tree.matches?'没有上级调用方':'当前范围内没有该函数','可调整火焰图范围或选择其他函数。','cpu')}`);
}
function heapTable() {
  const query=state.heapFilter.trim().toLocaleLowerCase();
  if(state.heapView==='compare' && state.heapBaseline && state.heap){
    const rows=compareHeaps(state.heapBaseline,state.heap).filter(c=>c.name.toLocaleLowerCase().includes(query));
    return `<p class="hint">按类名比较；同名多类或未知类不可匹配。类加载器、进程和运行条件可能不同，变化不等同于泄漏。ID 宽度不同时不比较字节数。</p><div class="table-wrap"><table><thead><tr><th>类</th><th>基线对象数</th><th>当前对象数</th><th>对象数变化</th><th>字段 / 元素字节变化</th><th>当前实例</th></tr></thead><tbody>${rows.slice(0,1000).map(c=>`<tr><td>${esc(c.name)}</td><td>${c.ambiguous?'不可比':c.baseline.toLocaleString()}</td><td>${c.ambiguous?'不可比':c.current.toLocaleString()}</td><td>${c.ambiguous?'—':c.countDelta.toLocaleString()}</td><td>${c.bytesDelta===null?'不可比':c.bytesDelta.toLocaleString()}</td><td>${c.currentId?`<button class="button small" data-heap-class="${esc(c.currentId)}">浏览实例</button>`:'—'}</td></tr>`).join('')}</tbody></table></div><p class="hint">匹配 ${rows.length} 类，最多显示 1,000 类。</p>`;
  }
  const rows=state.heap?.classes.filter(c=>c.name.toLocaleLowerCase().includes(query))||[];
  return rows.length?`<table><thead><tr><th>类</th><th>对象数</th><th>字段 / 元素字节</th><th>实例</th></tr></thead><tbody>${rows.slice(0,1000).map(c=>`<tr><td>${esc(c.name)}</td><td>${c.count.toLocaleString()}</td><td>${c.payloadBytes.toLocaleString()}</td><td><button class="button small" data-heap-class="${esc(c.id)}">浏览实例</button></td></tr>`).join('')}</tbody></table><p class="hint">匹配 ${rows.length} 类，最多显示 1,000 类。</p>`:empty('没有匹配的类','尝试其他名称','search');
}
function renderHeap() {
  const busy=state.busy.has('heap'), h=state.heap;
  return pageHeader('内存堆分析','采集或导入 HPROF，查看快照中的类和对象。',button('choose-heap','导入当前快照','upload',false,busy)+button('choose-heap-baseline','导入基线快照','upload',false,busy)+button('capture-heap','采集 HPROF','download',true,busy||state.demo)) +
    note('采集通常要求应用可调试，可能暂停目标进程。文件可能包含敏感数据。字段 / 元素字节不包含对象头或对齐，不等于浅大小或保留大小；可分页浏览实例、候选根路径和近似支配图，不能据此证明泄漏。最多索引 100 万个对象。') +
    (busy?`<div class="toolbar">${loading('正在处理堆文件…')}</div>`:'') +
    `<p class="hint">当前快照：${esc(h?.fileName||'未导入')} · 基线快照：${esc(state.heapBaseline?.fileName||'未导入')}</p>` +
    (h?`<div class="grid stats-grid">${statCard('对象与数组',h.objects.toLocaleString(),'个','HPROF 记录','memory','green')}${statCard('数组',h.arrays.toLocaleString(),'个','包含在对象总数中','activity')}${statCard('GC 根记录',h.roots.toLocaleString(),'条','可能有重复对象','layers')}${statCard('文件大小',fmt(h.fileBytes/1024/1024),'MiB',h.format,'folder')}</div><div style="height:20px"></div><div class="toolbar">${button('heap-dominators','查看近似支配图','layers',false,busy)}${button('heap-bitmaps','查看 Bitmap','memory',false,busy)}${button('heap-bitmap-duplicates','重复 Bitmap 缓冲区','search',false,busy)}${button('heap-string-duplicates','重复字符串','search',false,busy)}${button('heap-string-search','搜索字符串','search',false,busy)}${button('heap-destroyed-activities','已销毁 Activity','search',false,busy)}</div><div class="panel"><div class="panel-head"><h2>${state.heapView==='compare'?'快照对比':'类统计'}</h2><div class="toolbar">${button('heap-view-classes','当前快照','layers',state.heapView==='classes')}${button('heap-view-compare','对比基线','chart',state.heapView==='compare',!state.heapBaseline)}</div><input id="heap-search" class="search" placeholder="搜索类名" aria-label="搜索堆中的类" value="${esc(state.heapFilter)}"></div><div class="panel-body" id="heap-table">${heapTable()}</div></div>`:`<div class="panel"><div class="trace-hero"><div class="hero-icon">${icon('memory',31)}</div><h2>查看应用内存快照</h2><p>采集目标应用，或导入已有的 Android / Java HPROF 文件进行分析。</p></div></div>`);
}
async function browseDestroyedActivities(){
 const r=await api('/heap/destroyed-activities',{sessionId:state.heap.sessionId});state.heapDominator=null;state.heapBitmapOffset=null;state.heapActivityCandidates=true;state.heapStringDuplicates=false;state.heapStringSearch=null;
 showDialog('已销毁 Activity 候选',`<p class="hint">仅筛选继承 android.app.Activity 且 mDestroyed 为 true 的已索引对象；已销毁并不等于泄漏，对象可能尚待回收。可继续查看候选根路径，但当前引用图不区分强弱引用，也可能缺少运行时引用。已扫描 ${r.scanned} 个 Activity，发现 ${r.destroyed} 个，${r.unavailable} 个状态不可用，${r.incompleteClasses} 个类继承信息不完整${r.truncated?'；结果已截断':''}。最多扫描 20,000 个并显示 500 个。</p>${r.items.length?`<div class="table-wrap"><table><thead><tr><th>类</th><th>对象</th><th></th></tr></thead><tbody>${r.items.map(x=>`<tr><td>${esc(x.className)}${x.extraBytes?' · 存在未解释数据':''}</td><td><button class="button small" data-heap-object="${esc(x.id)}">${esc(x.id)}</button></td><td><button class="button small" data-heap-root="${esc(x.id)}">候选根路径</button></td></tr>`).join('')}</tbody></table></div>`:empty('没有已确认销毁的 Activity','字段或继承信息可能缺失；不能证明没有泄漏。','memory')}`);
}
async function browseDuplicateBitmaps(){
 const r=await api('/heap/bitmap-duplicates',{sessionId:state.heap.sessionId});state.heapDominator=null;state.heapBitmapOffset=0;state.heapActivityCandidates=false;state.heapStringDuplicates=false;state.heapStringSearch=null;
 showDialog('重复 Bitmap 缓冲区',`<p class="hint">仅比较 android.graphics.Bitmap 的 mBuffer 指向的、已记录字节内容的 Java byte[]；按 SHA-256 分组后逐字节核对。共享同一数组不算多个副本。扫描 ${r.scanned} 个 Bitmap，读取 ${bytes(r.hashedBytes)}，${r.unavailable} 个没有可比较数据${r.truncated?'；结果不完整或已截断':''}。最多扫描 10,000 个 Bitmap、64 MiB 数组内容和显示 100 组。原生及硬件像素、对象头和引用关系不在统计范围；重复字节不等于可释放内存，也不能证明图片相同或泄漏。</p>${r.groups.length?`<div class="table-wrap"><table><thead><tr><th>数组长度</th><th>不同数组 / Bitmap</th><th>重复记录字节</th><th>示例对象</th></tr></thead><tbody>${r.groups.map(g=>`<tr><td>${bytes(g.byteLength)}</td><td>${g.arrayCount} / ${g.bitmapCount}</td><td>${bytes(g.duplicateBytes)}</td><td>${g.bitmapIds.slice(0,5).map(id=>`<button class="button small" data-heap-object="${esc(id)}">${esc(id)}</button>`).join(' ')}</td></tr>`).join('')}</tbody></table></div>`:empty('没有可确认的重复缓冲区','快照可能没有 Java 缓冲区，或数据受扫描范围限制。','memory')}`);
}
async function browseBitmaps(offset=0){
  const result=await api('/heap/bitmaps',{sessionId:state.heap.sessionId,offset,limit:100});state.heapDominator=null;state.heapBitmapOffset=offset;state.heapActivityCandidates=false;state.heapStringDuplicates=false;state.heapStringSearch=null;
  const previous=offset>0?`<button class="button small" data-bitmap-page="${Math.max(0,offset-100)}">上一页</button>`:'',next=offset+100<result.total?`<button class="button small" data-bitmap-page="${offset+100}">下一页</button>`:'';
  showDialog('Bitmap 对象',`<p class="hint">只识别精确类名 android.graphics.Bitmap。已索引 ${result.total} / 快照记录 ${result.recordedTotal} 个实例，${result.classCount} 个类定义${result.indexTruncated?'；对象索引已截断':''}。字段依赖系统版本，缺失显示为不可用。byte[] 是已记录的数组长度，不等于像素大小或保留大小；原生或硬件像素内存无法由此计算。</p><div class="toolbar">${previous}<span>${result.total?offset+1:0}–${Math.min(offset+100,result.total)}</span>${next}</div>${result.items.length?`<div class="table-wrap"><table><thead><tr><th>对象</th><th>宽 × 高</th><th>密度</th><th>已回收</th><th>Java 缓冲区</th></tr></thead><tbody>${result.items.map(item=>`<tr><td><button class="button small" data-heap-object="${esc(item.id)}">${esc(item.id)}</button>${item.warning?`<br><span class="hint">${esc(item.warning)}</span>`:''}</td><td>${item.width??'—'} × ${item.height??'—'}</td><td>${item.density??'—'}</td><td>${item.recycled===null?'—':item.recycled?'是':'否'}</td><td>${item.bufferLength===null?'不可用':`${item.bufferLength} 字节${item.bufferDataPresent?'':'（无数据）'}`} ${item.bufferId?`<button class="button small" data-heap-object="${esc(item.bufferId)}">查看引用</button>`:''}</td></tr>`).join('')}</tbody></table></div>`:empty('没有已索引 Bitmap','快照可能没有 Bitmap 或类名、索引不完整。','memory')}`);
}
async function loadLayoutHistory(asBaseline){
  const id=$('#layout-history').value;if(!id)throw new Error('请选择历史快照');
  return task('layout',async()=>{const record=await api(`/sessions/${id}`);if(record.kind!=='layout'||!record.payload)throw new Error('记录不是布局快照');
    const nodes=buildNodes(record.payload.xml),timestamp=record.payload.timestamp??record.timestamp;
    if(asBaseline)state.layoutBaseline={timestamp,nodes,name:record.name,source:record.payload.source};
    else {state.layout=record.payload;state.nodes=nodes;state.selectedNode=nodes.length?0:null;state.layoutRoot=null;state.replay=true;}
    toast(asBaseline?'历史快照已设为基线':'历史快照已载入');
  });
}
async function compareLayoutTimeline(id){
  const history=state.sessions.filter(s=>s.kind==='layout').sort((a,b)=>a.timestamp-b.timestamp),index=history.findIndex(s=>s.id===id);
  if(index<1)throw new Error('时间线需要至少两份相邻布局快照');
  return task('layout',async()=>{
    const [before,after]=await Promise.all([api(`/sessions/${history[index-1].id}`),api(`/sessions/${history[index].id}`)]);
    if(before.kind!=='layout'||after.kind!=='layout'||!before.payload?.xml||!after.payload?.xml)throw new Error('历史记录缺少可比较的布局 XML');
    const beforeNodes=buildNodes(before.payload.xml),afterNodes=buildNodes(after.payload.xml);
    state.layoutBaseline={timestamp:before.payload.timestamp??before.timestamp,source:before.payload.source,name:before.name,nodes:beforeNodes};
    state.layout=after.payload;state.nodes=afterNodes;state.selectedNode=afterNodes.length?0:null;state.layoutRoot=null;state.layoutFilter='';state.replay=true;
    toast('已载入相邻快照差异');
  });
}
async function browseHeapClass(classId,offset) {
  const result=await api('/heap/instances',{sessionId:state.heap.sessionId,classId,offset,limit:100});
  state.heapBrowse={classId,offset};state.heapDominator=null;state.heapBitmapOffset=null;state.heapActivityCandidates=false;state.heapStringDuplicates=false;state.heapStringSearch=null;const cls=state.heap.classes.find(c=>c.id===classId);
  const prev=offset>0?`<button class="button small" data-heap-page="${Math.max(0,offset-100)}">上一页</button>`:'';
  const next=offset+100<result.total?`<button class="button small" data-heap-page="${offset+100}">下一页</button>`:'';
  showDialog(cls?.name||'实例列表',`<p class="hint">已索引 ${result.total.toLocaleString()} 个实例${result.indexTruncated?'；整个快照已达到 100 万对象索引上限':''}。</p><div class="toolbar">${prev}<span>${offset+1}–${Math.min(offset+100,result.total)}</span>${next}</div><div class="table-wrap"><table><thead><tr><th>对象 ID</th><th>类型</th><th>记录长度</th></tr></thead><tbody>${result.items.map(item=>`<tr><td><button class="button small" data-heap-object="${esc(item.id)}">${esc(item.id)}</button></td><td>${esc(item.kind)}</td><td>${item.length.toLocaleString()}</td></tr>`).join('')}</tbody></table></div>`);
}
async function browseHeapStringSearch(query='',offset=0,caseSensitive=false,history=[]){
  let result=null;if(query){showDialog('搜索字符串','<p class="hint">正在扫描已索引字符串，请稍候…</p>');result=await api('/heap/string-search',{sessionId:state.heap.sessionId,query,offset,caseSensitive});}
  state.heapDominator=null;state.heapBitmapOffset=null;state.heapActivityCandidates=false;state.heapStringDuplicates=false;state.heapStringSearch={query,offset,caseSensitive,history};
  showDialog('搜索字符串',`<div class="toolbar"><input id="heap-string-query" class="search" maxlength="256" placeholder="输入字符串内容" aria-label="字符串搜索词" value="${esc(query)}"><label><input id="heap-string-case" type="checkbox" ${caseSensitive?'checked':''}> 区分大小写</label><button class="button small" data-heap-string-search-run>搜索</button></div><p class="hint">只搜索完整可解码且不超过 512 个 UTF-16 代码单元的字符串，结果可能受布局、索引和内容长度限制。每页最多扫描 5,000 个实例或返回 100 条；没有匹配时仍可继续搜索下一批。</p>${result?`<p class="hint">本批扫描 ${result.scanned} 个，${result.unavailable} 个无法解码、${result.tooLong} 个过长；已索引 ${result.indexedTotal} 个${result.indexTruncated?'，对象索引已截断':''}。</p><div class="toolbar">${history.length?'<button class="button small" data-heap-string-search-prev>上一批</button>':''}${result.nextOffset!==null?`<button class="button small" data-heap-string-search-next="${result.nextOffset}">下一批</button>`:''}</div>${result.items.length?`<div class="table-wrap"><table><thead><tr><th>内容</th><th>对象</th></tr></thead><tbody>${result.items.map(item=>`<tr><td><pre>${esc(item.text)}</pre></td><td><button class="button small" data-heap-object="${esc(item.id)}">${esc(item.id)}</button></td></tr>`).join('')}</tbody></table></div>`:empty('本批没有匹配','可继续搜索下一批或调整搜索词。','search')}`:''}`);
}
async function browseDuplicateStrings(){
  showDialog('重复字符串','<p class="hint">正在扫描已索引字符串，请稍候…</p>');
  const r=await api('/heap/string-duplicates',{sessionId:state.heap.sessionId});state.heapDominator=null;state.heapBitmapOffset=null;state.heapActivityCandidates=false;state.heapStringDuplicates=true;state.heapStringSearch=null;
  showDialog('重复字符串',`<p class="hint">按完整、可解码的字符串内容分组；超过 512 个 UTF-16 代码单元的字符串不参与比较。已扫描 ${r.scanned} / 已索引 ${r.indexedTotal} 个，${r.unavailable} 个无法解码，${r.tooLong} 个过长${r.indexTruncated?'；索引已截断':''}${r.scanLimitReached?'；已达到 20,000 个扫描上限':''}。显示最多 100 组和每组 5 个实例。不同底层数组数不代表可释放内存，不能据此判断泄漏。</p>${r.groups.length?`<div class="table-wrap"><table><thead><tr><th>内容</th><th>实例数</th><th>不同底层数组</th><th>示例对象</th></tr></thead><tbody>${r.groups.map(g=>`<tr><td><pre>${esc(g.text||'（空字符串）')}</pre></td><td>${g.instances}</td><td>${g.storageCount}</td><td>${g.ids.map(id=>`<button class="button small" data-heap-object="${esc(id)}">${esc(id)}</button>`).join(' ')}</td></tr>`).join('')}</tbody></table></div><p class="hint">共 ${r.totalGroups} 组。</p>`:empty('没有可确认的重复字符串','结果受快照、索引和可解码布局限制。','memory')}`);
}
async function browseHeapObject(id,offset=0) {
  const object=await api('/heap/object',{sessionId:state.heap.sessionId,id,offset,limit:100});
  const types={2:'引用',4:'boolean',5:'char',6:'float',7:'double',8:'byte',9:'short',10:'int',11:'long'};
  const ref=value=>value===null?'null':`<button class="button small" data-heap-object="${esc(value)}">${esc(value)}</button>`;
  const fields=object.fields?.map(f=>`<tr><td>${esc(f.declaringClass)}</td><td>${esc(f.name)}</td><td>${esc(types[f.type]||String(f.type))}</td><td>${f.type===2?ref(f.value):esc(String(f.value))}</td></tr>`).join('')||'';
  const values=object.values?.map((v,i)=>`<tr><td>${object.valueOffset+i}</td><td>${object.kind==='objectArray'?ref(v):esc(String(v))}</td></tr>`).join('')||'';
  const total=object.kind==='instance'?object.totalFields:['objectArray','primitiveArray'].includes(object.kind)?object.length:null;
  const stringPreview=object.className==='java.lang.String'?object.stringPreview?`<p class="hint">字符串预览：${object.stringPreview.length} 个 UTF-16 代码单元${object.stringPreview.truncated?'；仅显示前 512 个':''}。</p><pre>${esc(object.stringPreview.text)}</pre>`:'<p class="hint">字符串内容不可用：存储布局或数据不完整。</p>':'';
  const page=total===null||total===undefined?'':`<div class="toolbar">${offset>0?`<button class="button small" data-heap-object-page="${esc(id)}" data-offset="${Math.max(0,offset-100)}">上一页</button>`:''}<span>${total?offset+1:0}–${Math.min(offset+100,total)} / ${total}</span>${offset+100<total?`<button class="button small" data-heap-object-page="${esc(id)}" data-offset="${offset+100}">下一页</button>`:''}</div>`;
  showDialog(object.className,`<div class="toolbar">${state.heapStringSearch?'<button class="button small" data-heap-string-search-return>返回字符串搜索</button>':state.heapStringDuplicates?'<button class="button small" data-heap-strings-return>返回重复字符串</button>':state.heapDominator?'<button class="button small" data-heap-dom-return>返回支配图</button>':state.heapActivityCandidates?'<button class="button small" data-heap-activities-return>返回 Activity 列表</button>':state.heapBitmapOffset!=null?`<button class="button small" data-bitmap-page="${state.heapBitmapOffset}">返回 Bitmap 列表</button>`:'<button class="button small" data-heap-back>返回实例列表</button>'}<button class="button small" data-heap-root="${esc(object.id)}">查找候选根路径</button><button class="button small" data-heap-incoming="${esc(object.id)}">查看引用来源</button><span class="inline-code">${esc(object.id)}</span></div>${object.warning?`<p class="hint">${esc(object.warning)}</p>`:''}${stringPreview}${page}${(object.kind==='instance'||object.kind==='class')?`<table><thead><tr><th>声明类</th><th>字段</th><th>类型</th><th>值</th></tr></thead><tbody>${fields}</tbody></table>`:['objectArray','primitiveArray'].includes(object.kind)?`<p class="hint">数组长度 ${object.length}，每页最多显示 100 个元素。${object.kind==='primitiveArray'&&object.elementType===5?' char 值为 UTF-16 代码单元。':''}</p><table><tbody>${values}</tbody></table>`:`<p class="hint">数组长度 ${object.length}；快照未保存数组元素数据。</p>`}`);
}
async function browseHeapIncoming(id,offset=0,excludeNonStrong=false){
  showDialog('引用来源','<p class="hint">正在构建引用图，请稍候…</p>');
  const result=await api('/heap/incoming',{sessionId:state.heap.sessionId,id,offset,limit:100,excludeNonStrong});
  const page=position=>`<button class="button small" data-heap-incoming="${esc(id)}" data-offset="${position}" data-exclude-non-strong="${excludeNonStrong}">${position<offset?'上一页':'下一页'}</button>`;
  showDialog('引用来源',`<div class="toolbar"><button class="button small" data-heap-object="${esc(id)}">返回对象</button><button class="button small" data-heap-incoming="${esc(id)}" data-exclude-non-strong="${!excludeNonStrong}">${excludeNonStrong?'显示所有引用':'排除已识别弱、软、虚引用'}</button>${offset>0?page(Math.max(0,offset-100)):''}<span>${result.total?offset+1:0}–${Math.min(offset+100,result.total)} / ${result.total}</span>${offset+100<result.total?page(offset+100):''}</div><p class="hint">列出已索引图中直接指向该对象的引用边；同一对象可能通过多个字段引用。已识别的弱、软、虚引用会标注，其他引用语义和运行时关系可能缺失，不能据此证明泄漏。${result.rootTags.length?` 目标本身也是已记录的 GC 根（${result.rootTags.map(t=>'0x'+t.toString(16)).join('、')}）。`:''}${result.indexOrGraphIncomplete?` 图不完整：跳过 ${result.skipped} 个字段布局，缺失 ${result.missingTargets} 个引用目标${result.edgeLimitReached?'，达到引用边数上限':''}。`:''}</p>${result.items.length?`<div class="table-wrap"><table><thead><tr><th>来源类 / 对象</th><th>引用字段</th><th>引用类型</th></tr></thead><tbody>${result.items.map(item=>`<tr><td>${esc(item.className)}<br><button class="button small" data-heap-object="${esc(item.id)}">${esc(item.id)}</button></td><td>${esc(item.label)}</td><td>${esc(item.referenceKind||'未分类')}</td></tr>`).join('')}</tbody></table></div>`:empty('没有已记录的引用来源','引用图可能不完整，也可能存在未识别的运行时引用。','memory')}`);
}
async function browseHeapDominators(path=[],offset=0,excludeNonStrong=state.heapDominator?.excludeNonStrong??false){
  const parentId=path.at(-1)||null;state.heapStringDuplicates=false;state.heapStringSearch=null;state.heapDominator={path,offset,excludeNonStrong};
  showDialog('近似支配图','<p class="hint">正在构建引用图并计算，请稍候…</p>');
  let result;try{result=await api('/heap/dominators',{sessionId:state.heap.sessionId,parentId,offset,limit:100,excludeNonStrong});}catch(error){showDialog('近似支配图',`<p class="hint">计算失败：${esc(error.message)}</p>`);throw error;}
  const prev=offset>0?`<button class="button small" data-heap-dom-page="${Math.max(0,offset-100)}">上一页</button>`:'',next=offset+100<result.total?`<button class="button small" data-heap-dom-page="${offset+100}">下一页</button>`:'';
  showDialog('近似支配图',`<p class="hint">${esc(result.note)}</p><p class="hint">可达 ${result.reachable.toLocaleString()} / 已索引 ${result.indexed.toLocaleString()} 对象 · 引用 ${result.edgeCount.toLocaleString()} 条 · 排除 ${result.excludedEdges.toLocaleString()} 条${result.incomplete?` · 图不完整：跳过字段布局 ${result.skipped}、缺失引用目标 ${result.missingTargets}、缺失根 ${result.missingRoots}${result.edgeLimitReached?'、达到边数上限':''}`:''}</p><div class="toolbar"><button class="button small" data-heap-dom-filter>${excludeNonStrong?'显示所有引用':'排除已识别弱、软、虚引用'}</button>${path.length?'<button class="button small" data-heap-dom-up>返回上级</button>':''}<span>当前：${esc(parentId||'所有 GC 根')}</span>${prev}${next}</div>${result.items.length?`<div class="table-wrap"><table><thead><tr><th>对象 / 类</th><th>支配对象数</th><th>记录数据字节</th><th>未知数据对象</th><th></th></tr></thead><tbody>${result.items.map(item=>`<tr><td>${esc(item.className)}<br><button class="button small" data-heap-dom-object="${esc(item.id)}">${esc(item.id)}</button></td><td>${item.dominatedObjects.toLocaleString()}</td><td>${item.recordedPayloadBytes.toLocaleString()}</td><td>${item.unknownPayloadObjects.toLocaleString()}</td><td>${item.children?`<button class="button small" data-heap-dom-child="${esc(item.id)}">展开 ${item.children}</button>`:'—'}</td></tr>`).join('')}</tbody></table></div>`:empty('没有下级对象','当前支配节点没有直接下级。','memory')}`);
}
async function browseHeapRootPath(id,excludeNonStrong=false) {
  showDialog('查找候选根路径',`<p class="hint">正在构建引用图并查找路径，请稍候…</p>`);
  const result=await api('/heap/root-path',{sessionId:state.heap.sessionId,id,excludeNonStrong});
  const rows=result.path.map((node,i)=>`<tr><td>${i+1}</td><td>${esc(node.className)}</td><td><button class="button small" data-heap-object="${esc(node.id)}">${esc(node.id)}</button></td><td>${node.via?esc(node.via):'目标对象'}${node.referenceKind?` · ${esc(node.referenceKind)}`:''}</td></tr>`).join('');
  showDialog('候选根路径',`<div class="toolbar"><button class="button small" data-heap-object="${esc(id)}">返回对象</button><button class="button small" data-heap-root="${esc(id)}" data-exclude-non-strong="${!excludeNonStrong}">${excludeNonStrong?'显示所有引用':'排除已识别弱、软、虚引用'}</button></div><p class="hint">${esc(result.note)}</p>${result.indexOrGraphIncomplete?`<p class="hint">索引或引用图不完整（跳过 ${result.skipped} 个字段布局，${result.edgeLimitReached?'达到引用边数上限':'未达到引用边数上限'}）。</p>`:''}${result.searchLimitReached?'<p class="hint">搜索达到节点数上限。</p>':''}${result.found?`<p class="hint">找到候选路径，根类型：${result.rootTags.map(t=>'0x'+t.toString(16)).join('、')}；不能据此判断泄漏。</p><table><thead><tr><th>序号</th><th>类</th><th>对象</th><th>指向下一对象的字段</th></tr></thead><tbody>${rows}</tbody></table>`:'<p class="hint">未在已分析的引用中找到路径；由于覆盖不完整，不代表不存在其他路径。</p>'}`);
}
function traceTable(title,rows,description,canLocate=false){
  return `<div class="panel"><div class="panel-head"><h2>${esc(title)}</h2><span class="hint">${esc(description)}</span></div><div class="panel-body">${rows.length?`<div class="table-wrap"><table><thead><tr><th>名称</th><th>记录数</th><th>累计时长 ms</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${esc(r.name)}${canLocate&&new TextEncoder().encode(r.name).length<=200&&!r.name.includes('\0')?` <button class="button small" data-trace-slice-summary="${i}">查找事件</button>`:''}</td><td>${r.count.toLocaleString()}</td><td>${fmt(r.totalMs,3)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="hint">追踪中没有可用记录，或该数据源未开启。</p>'}</div></div>`;
}
function traceMsToNs(value){
  const match=String(value).trim().match(/^(\d{1,15})(?:\.(\d{1,6}))?$/);if(!match)throw new Error('请输入非负毫秒，最多保留 6 位小数');
  return BigInt(match[1])*1000000n+BigInt((match[2]||'').padEnd(6,'0'));
}
function traceNsToMs(value){const n=BigInt(value),whole=n/1000000n,fraction=(n%1000000n).toString().padStart(6,'0').replace(/0+$/,'');return `${whole}${fraction?'.'+fraction:''}`;}
async function changeTraceWindow(reset=false){
  const result=state.traceResult;if(!result?.sessionId)throw new Error('追踪会话已失效，请重新导入');
  const base=BigInt(result.bounds.startNs),total=BigInt(result.bounds.endNs)-base;
  const start=reset?0n:traceMsToNs($('#trace-window-start').value),end=reset?total:traceMsToNs($('#trace-window-end').value);
  if(start<0n||end>total||end<=start)throw new Error('时间窗口必须位于追踪范围内且结束晚于开始');
  const trackFilter=reset?'':$('#trace-track-filter').value.trim(),sliceFilter=reset?'':$('#trace-slice-filter').value.trim();
  await task('trace',async()=>{const next=await api('/trace/window',{sessionId:result.sessionId,startNs:String(base+start),endNs:String(base+end),trackFilter,sliceFilter});state.traceResult={...next,fileName:result.fileName};});
}
async function focusTraceEvent(event,sessionId){
  const trace=state.traceResult;if(!trace?.sessionId||trace.sessionId!==sessionId)throw new Error('追踪会话已更换，请重新读取记录');
  const window=traceEventWindow(trace.bounds,event.tsNs,event.durationNs);
  await task('trace',async()=>{const result=await api('/trace/window',{sessionId,...window,trackFilter:''});state.traceResult={...result,fileName:trace.fileName};state.route='trace';location.hash='trace';toast('已打开事件附近的追踪时间范围');});
}
async function readTraceThreadStates(tid,pid=null){
  const trace=state.traceResult;if(!trace?.sessionId)throw new Error('请先导入追踪');
  if(!Number.isSafeInteger(tid)||tid<0||tid>2147483647)throw new Error('请输入有效线程 TID');
  const startNs=trace.viewBounds?.startNs||trace.bounds.startNs,endNs=trace.viewBounds?.endNs||trace.bounds.endNs;
  await task('trace',async()=>{const r=await api('/trace/thread-states',{sessionId:trace.sessionId,tid,pid,startNs,endNs});const ms=v=>`${fmt(Number(v)/1e6,3)} ms`;if($('#detail-dialog').open)$('#detail-dialog').close();showDialog(`线程 ${tid} 状态`,`<p class="hint">${pid===null?'':`按 PID ${pid} 和 TID ${tid} 查询；需要自行确认采样与追踪属于同一设备、时间和线程生命周期。`}窗口 ${esc(startNs)}–${esc(endNs)} ns；事件按窗口裁剪，统计基于已记录线程状态。相同 TID 可能被复用，内部线程标识 UTID 用于区分生命周期；状态由 Perfetto 原样提供，缺失不表示零。${r.summaryTruncated||r.intervalsTruncated?' 数据已截断。':''}</p>${r.summary.length?`<table><thead><tr><th>进程 / 线程</th><th>UTID</th><th>状态</th><th>累计时长</th><th>区间数</th></tr></thead><tbody>${r.summary.map(x=>`<tr><td>${esc(x.process||'未知进程')} / ${esc(x.thread||'未知线程')} · PID ${esc(x.pid||'—')}</td><td>${esc(x.utid)}</td><td>${esc(x.state||'未知')}</td><td>${ms(x.durationNs)}</td><td>${x.count}</td></tr>`).join('')}</tbody></table><h3>时间区间（最多显示 100 条）</h3><table><thead><tr><th>UTID</th><th>状态</th><th>起始纳秒</th><th>时长</th></tr></thead><tbody>${r.intervals.slice(0,100).map(x=>`<tr><td>${esc(x.utid)}</td><td>${esc(x.state||'未知')}</td><td class="mono">${esc(x.tsNs)}</td><td>${ms(x.durationNs)}</td></tr>`).join('')}</tbody></table>`:empty('没有线程状态','该时间段可能没有采集到状态或 TID 不存在。','cpu')}`);});
}
function traceTimeline(result) {
  const start=BigInt(result.viewBounds?.startNs||result.bounds.startNs),end=BigInt(result.viewBounds?.endNs||result.bounds.endNs),span=end-start;
  const base=BigInt(result.bounds.startNs),total=BigInt(result.bounds.endNs)-base;
  if(span<=0n)return `<div class="panel"><div class="panel-head"><h2>追踪时间线</h2></div><div class="panel-body"><p class="hint">追踪范围为空，无法绘制时间线。</p></div></div>`;
  const groups=new Map();let hidden=0,depthClipped=false;
  const add=(event,kind,index)=>{
    const ts=BigInt(event.tsNs),finish=ts+BigInt(event.durationNs);if(ts>end||finish<start)return;
    const key=kind==='slice'?`slice:${event.trackId}`:`cpu:${event.cpu}`,label=kind==='slice'?`${event.track}${event.tid!==null?' · TID '+event.tid:''}`:`CPU ${event.cpu}`;
    let group=groups.get(key);if(!group){if(groups.size>=30){hidden++;return;}group={label,items:[]};groups.set(key,group);}
    const left=ts<start?start:ts,right=finish>end?end:finish;
    const x=Number((left-start)*1000000n/span)/10000,w=Number((right-left)*1000000n/span)/10000;
    const depth=kind==='slice'?Math.min(event.depth||0,31):0;if(kind==='slice'&&event.depth>31)depthClipped=true;
    group.depth=Math.max(group.depth||0,depth);group.items.push({kind,index,event,x,w,depth});
  };
  if(result.sliceFilter){result.sliceEvents.forEach((e,i)=>add(e,'slice',i));result.schedEvents.forEach((e,i)=>add(e,'sched',i));}else{result.schedEvents.forEach((e,i)=>add(e,'sched',i));result.sliceEvents.forEach((e,i)=>add(e,'slice',i));}
  const lanes=[...groups.values()].map(group=>`<div class="timeline-row"><span title="${esc(group.label)}">${esc(group.label)}</span><div class="timeline-track trace-track" style="height:${18*(group.depth+1)}px">${group.items.map(item=>`<button class="trace-event ${item.kind}${item.kind==='sched'&&item.event.tid===0?' idle':''}" style="left:${item.x}%;width:${item.w}%;top:${2+18*item.depth}px" data-trace-event="${item.kind}:${item.index}" title="${esc(item.kind==='slice'?item.event.name:item.event.thread)}" aria-label="${esc(item.kind==='slice'?item.event.name:item.event.thread)}，查看事件详情"></button>`).join('')}</div></div>`).join('');
  const truncated=result.truncated.slices||result.truncated.sched;
  return `<div class="panel"><div class="panel-head"><h2>追踪时间线</h2></div><div class="panel-body"><p class="hint">当前窗口相对追踪起点 ${traceNsToMs(start-base)}–${traceNsToMs(end-base)} ms；绿色为切片，橙色为 CPU 调度片段，灰色为 CPU 空闲线程。切片按追踪记录的嵌套深度分行；同深度重叠事件仍可能遮挡，点击事件查看时间。可按轨道、线程或切片名称筛选；切片名称筛选仅影响切片，CPU 调度仍保留。汇总覆盖完整追踪。每类最多载入最早 3,000 条、显示最多 30 条轨道。${truncated?' 事件已截断。':''}${hidden?' 部分轨道未显示。':''}${depthClipped?' 超过 31 层的切片合并显示在第 32 行。':''}</p><div class="toolbar"><label>起始 ms <input id="trace-window-start" type="text" inputmode="decimal" value="${traceNsToMs(start-base)}" aria-label="追踪起始毫秒"></label><label>结束 ms <input id="trace-window-end" type="text" inputmode="decimal" value="${traceNsToMs(end-base)}" aria-label="追踪结束毫秒"></label><label>轨道 / 线程 <input id="trace-track-filter" type="text" maxlength="100" placeholder="名称或 CPU 号" value="${esc(result.trackFilter||'')}" aria-label="筛选追踪轨道"></label><label>切片名称 <input id="trace-slice-filter" type="text" maxlength="100" placeholder="名称包含" value="${esc(result.sliceFilter||'')}" aria-label="筛选追踪切片"></label><label>线程 TID <input id="trace-tid" type="number" min="0" max="2147483647" placeholder="输入 TID" aria-label="线程 TID"></label>${button('trace-thread-states','查看线程状态','cpu',false,state.busy.has('trace'))}${button('trace-window-apply','查看时间范围','search',false,state.busy.has('trace'))}${button('trace-window-reset','整个追踪','refresh',false,state.busy.has('trace')||(start===base&&end===base+total&&!result.trackFilter&&!result.sliceFilter))}</div>${lanes?`<div class="timeline-list">${lanes}</div>`:'<p class="hint">没有可绘制的切片或调度事件。</p>'}</div></div>`;
}
function renderTrace() {
  const busy=state.busy.has('trace'),result=state.traceResult;
  const duration=result?Number(BigInt(result.bounds.endNs)-BigInt(result.bounds.startNs))/1e6:null;
  return pageHeader('系统追踪','采集或导入系统追踪，检查调度和事件证据。',button('save-trace-archive','保存到本机','folder',false,busy||!result?.sessionId)+button('export-trace','导出原始追踪','download',false,busy||!result?.sessionId)+button('import-trace','导入追踪','upload',false,busy))+
    note('录制需要设备内置 Perfetto（通常为 Android 9+）。导入由本机 Trace Processor 处理，临时文件保留至替换或退出；切换窗口会重新解析追踪。Slice 累计时长可能包含嵌套或并发，不等于真实经过时间。')+
    `<div class="panel"><div class="trace-hero"><div class="hero-icon">${icon('trace',31)}</div><div class="eyebrow">SYSTEM TRACE / PERFETTO</div><h2>把运行现场，留在时间线上</h2><p>以 32 MB 缓冲区采集 CPU 调度、频率、应用、窗口、图形和 Binder 事件。采集期间，请在设备上重现你想分析的操作。</p><div class="toolbar"><label>采集模式 <select id="trace-mode" ${busy?'disabled':''}><option value="standard">普通追踪</option><option value="frame-timeline">包含 FrameTimeline（Android 12+）</option></select></label><label>采集时长 <select id="trace-seconds" ${busy?'disabled':''}><option value="5">5 秒</option><option value="10" selected>10 秒</option><option value="20">20 秒</option><option value="30">30 秒</option></select></label><label><input id="trace-include-app" type="checkbox" ${state.traceIncludeApp?'checked':''} ${busy?'disabled':''}> 包含所选应用的 ATrace</label>${busy?loading('正在处理追踪文件…'):button('capture-trace','开始录制','play',true,state.demo||state.info?.perfettoAvailable===false)}</div><p class="hint">FrameTimeline 模式会请求系统帧数据源；勾选应用 ATrace 会记录所选应用提供的追踪标记。实际结果取决于系统、应用和采集期间产生的事件。</p><a class="button" href="https://ui.perfetto.dev" target="_blank" rel="noreferrer">打开 Perfetto UI ↗</a>${state.demo?'<div class="hint">演示模式不生成虚构追踪文件。连接真实设备后可录制。</div>':state.info?.perfettoAvailable===false?'<div class="hint">当前设备未安装 perfetto，无法录制。内置 Perfetto 通常需要 Android 9 或更高版本。</div>':''}${state.status?.traceProcessorPath?'':'<div class="hint">未找到 Trace Processor；macOS 请准备工具或设置 TRACE_PROCESSOR_PATH。</div>'}</div></div>`+
    `<div class="panel"><div class="panel-head"><h2>本机追踪档案</h2>${button('refresh-trace-archives','刷新','refresh',false,busy)}</div><div class="panel-body"><div class="toolbar"><label>历史追踪 <select id="trace-archive"><option value="">选择本机追踪</option>${state.traceArchives.map(x=>`<option value="${esc(x.id)}">${esc(x.name)} · ${date(x.timestamp)}</option>`).join('')}</select></label>${button('load-trace-archive','载入追踪','folder',false,busy||!state.traceArchives.length)}</div><p class="hint">档案保存在本机，载入前校验 SHA-256；追踪可能包含敏感信息。</p></div></div>`+
    (result?`<div style="height:20px"></div><div class="grid stats-grid">${statCard('追踪范围',fmt(duration,2),'ms','trace_bounds','trace','green')}${statCard('切片名称',result.slices.length.toLocaleString(),'项','最多 100 项','layers')}${statCard('调度线程',result.threads.length.toLocaleString(),'项','最多 100 项','cpu')}${statCard('解析错误',result.errors.length.toLocaleString(),'项','stats 中非零错误','info','orange')}</div><p class="hint">来源：${esc(result.fileName)} · 起始 ${esc(result.bounds.startNs)} ns · 结束 ${esc(result.bounds.endNs)} ns</p><div style="height:20px"></div>${traceTimeline(result)}<div style="height:20px"></div>${traceTable('耗时切片',result.slices,'整个追踪按名称累计，含嵌套',true) }<div style="height:20px"></div>${traceTable('线程调度',result.threads,'整个追踪 CPU 调度片段累计，含空闲线程') }<div style="height:20px"></div><div class="toolbar"><label>Binder 范围 <select id="binder-scope"><option value="all" ${state.binderScope==='all'?'selected':''}>全部进程</option><option value="target" ${state.binderScope==='target'&&state.packageName?'selected':''} ${state.packageName?'':'disabled'}>当前应用及其子进程</option></select></label><label>方向 <select id="binder-direction"><option value="both" ${state.binderDirection==='both'?'selected':''}>客户端或服务端</option><option value="client" ${state.binderDirection==='client'?'selected':''}>仅客户端</option><option value="server" ${state.binderDirection==='server'?'selected':''}>仅服务端</option></select></label>${button('trace-binder','分析 Binder 事务','search',false,busy||!result.sessionId)}</div>${traceTable('Binder 名称匹配',result.binder,'按名称匹配，仅供概览')}${result.errors.length?`<div class="panel"><div class="panel-head"><h2>解析诊断</h2></div><div class="panel-body"><pre>${esc(JSON.stringify(result.errors,null,2))}</pre></div></div>`:''}`:'');
}
function renderBattery() {
  const s=state.battery, d=state.batteryDelta, busy=state.busy.has('battery'), n=d?d.network:s?.network, history=state.sessions.filter(x=>x.kind==='battery');
  const table=(title,rows,partial=false)=>`<div class="panel"><div class="panel-head"><h2>${title}</h2><span class="subtle">${d?'两次快照差值':'当前累计值'}</span></div>${rows?.length?`<div class="table-wrap"><table><thead><tr><th>名称</th><th>时间 ms</th><th>次数</th></tr></thead><tbody>${rows.slice(0,500).map(r=>{const v=partial?r.partial:r;return `<tr><td>${esc(r.name)}</td><td class="mono">${fmt(v?.timeMs,0)}</td><td class="mono">${fmt(v?.count,0)}</td></tr>`;}).join('')}</tbody></table></div>${rows.length>500?'<p class="hint">仅显示前 500 条。</p>':''}`:empty('没有可用记录','设备未提供此类统计。','battery')}</div>`;
  return pageHeader('电池与资源','查看应用 UID 的系统累计资源使用，或比较两次快照。',button('save-battery','保存实验','download',false,!s)+button('import-battery','导入 checkin','upload',false,busy))+note('数据来自 Android batterystats 的 since-charged 累计记录，属于 UID；共享 UID 的应用无法单独归因。资源计数差值不是耗电量；系统若提供 UID mAh 则显示累计估计，缺失值和重置后的计数不按零计算。')+
  `<div class="panel"><div class="panel-body"><div class="toolbar">${button('battery-baseline','采集基线','play',true,busy||state.demo)}${button('battery-current','采集结束快照','refresh',false,busy||state.demo||!state.batteryBefore)}${busy?loading('正在读取设备统计…'):''}</div><p class="hint">${state.batteryBefore?`基线：${date(state.batteryBefore.timestamp)} · ${esc(state.batteryBefore.packageName)}`:'先采集基线，在设备上重现操作后采集结束快照。也可导入 dumpsys batterystats --checkin 文本。'}</p>${s?`<p class="hint">当前快照：${date(s.timestamp)} ${sourceTag(s.source)} · UID ${s.uid} · 应用 ${esc(s.packages.join('、'))} · checkin 版本 ${esc(s.version)}${d?` · 间隔 ${fmt(d.elapsedMs/1000,1)} 秒`:''}</p>`:''}${d?.warnings.length?`<p class="hint">${esc(d.warnings.join('；'))}</p>`:''}</div></div><div style="height:20px"></div>`+
  `<div class="panel"><div class="panel-head"><h2>历史电池快照</h2>${button('refresh-sessions','刷新','refresh',false,busy)}</div><div class="panel-body"><div class="toolbar"><label>记录 <select id="battery-history"><option value="">选择记录</option>${history.map(x=>`<option value="${esc(x.id)}">${esc(x.name)} · ${date(x.timestamp)} · ${esc(x.source)}</option>`).join('')}</select></label><label>使用记录内的 <select id="battery-history-snapshot"><option value="snapshot">当前 / 结束快照</option><option value="before">基线快照</option></select></label>${button('battery-history-before','设为基线','layers',false,busy||!history.length)}${button('battery-history-after','设为结束快照','refresh',false,busy||!history.length)}${button('battery-clear-before','清除基线','stop',false,busy||!state.batteryBefore)}</div><p class="hint">历史记录可能包含结束快照和基线。仅相同设备、应用、UID 与系统统计窗口的快照可以计算资源计数差值；离线导入的快照可能缺少设备标识。</p></div></div><div style="height:20px"></div>`+
  (s?`<div class="panel"><div class="panel-head"><h2>系统报告的 UID 耗电估计</h2></div><div class="panel-body"><p>当前累计：<strong>${s.power?`${esc(s.power.rawValue)} mAh`:'不可用'}</strong>${state.batteryBefore?` · 基线累计：<strong>${state.batteryBefore.power?`${esc(state.batteryBefore.power.rawValue)} mAh`:'不可用'}</strong>`:''}</p><p class="hint">来自 batterystats 的 pwi UID 项，是系统基于设备数据和模型给出的累计估计，可能包括共享 UID 应用且存在取整；不是实测电量或当前实验的精确消耗，不自动对两个估计值做差。</p></div></div><div style="height:20px"></div><div class="grid stats-grid">${statCard('移动接收',n?.mobileRxBytes==null?'—':bytes(n.mobileRxBytes),'',d?'快照差值':'UID 累计','network','green')}${statCard('移动发送',n?.mobileTxBytes==null?'—':bytes(n.mobileTxBytes),'',d?'快照差值':'UID 累计','network')}${statCard('Wi-Fi 接收',n?.wifiRxBytes==null?'—':bytes(n.wifiRxBytes),'',d?'快照差值':'UID 累计','network')}${statCard('Wi-Fi 发送',n?.wifiTxBytes==null?'—':bytes(n.wifiTxBytes),'',d?'快照差值':'UID 累计','network')}</div><div style="height:20px"></div>${table('部分唤醒锁',d?d.wakelocks:s.wakelocks,!d)}<div style="height:20px"></div>${table('唤醒闹钟',d?d.alarms:s.alarms)}<div style="height:20px"></div>${table('作业',d?d.jobs:s.jobs)}<div style="height:20px"></div>${table('同步',d?d.syncs:s.syncs)}<div style="height:20px"></div>${table('传感器',d?d.sensors:s.sensors)}`:empty('尚无电池统计','连接设备采集，或导入 checkin 文件。','battery'));
}
async function loadBatteryHistory(asBaseline){
 const id=$('#battery-history').value,which=$('#battery-history-snapshot').value;if(!id)throw new Error('请选择历史记录');
 return task('battery',async()=>{const record=await api(`/sessions/${id}`);if(record.kind!=='battery'||!record.payload)throw new Error('记录不是电池快照');
  const payload=record.payload,snapshot=which==='before'?payload.before:(payload.snapshot||payload);if(!snapshot)throw new Error('该记录没有所选快照');
  if(asBaseline){state.batteryBefore=snapshot;state.battery=snapshot;state.batteryEndCaptured=false;state.batteryDelta=null;toast('历史快照已设为基线');}
  else {state.battery=snapshot;state.batteryEndCaptured=true;state.batteryDelta=null;if(state.batteryBefore){try{state.batteryDelta=await api('/battery/compare',{before:state.batteryBefore,after:snapshot});toast('历史快照已载入并比较');}catch(error){toast(`快照已载入，无法比较：${error.message}`,true);}}else toast('历史结束快照已载入；可选择基线后重新载入结束快照');}
 });
}
function renderGpu(){
 const rows=state.gpuArtifacts,busy=state.busy.has('gpu');
 return pageHeader('GPU 产物','整理 AGI 帧捕获和系统追踪文件，验证完整性并交给相应工具。',button('refresh-gpu','刷新列表','refresh',false,busy)+button('import-gpu','导入产物','upload',true,busy))+note('本模块管理本机产物，不采集 GPU 数据，也不内置 AGI。文件按导入时的 SHA-256 校验；校验相同只表示未发生变化，不证明文件格式有效或来源可信。Perfetto 追踪可交给系统追踪分析；.gfxtrace 可在桌面端交给 AGI，或导出后手动打开。')+
 `<div class="panel"><div class="panel-head"><h2>设备图形能力</h2>${button('gpu-capabilities','读取设备能力','refresh',false,busy||state.demo||!state.serial)}</div><div class="panel-body"><p class="hint">仅显示系统属性和包管理器报告；缺失不代表设备不支持。AGI 的实际兼容性、GPU 计数器、驱动及应用可采集性需要在 AGI 中验证。</p>${state.gpuCapabilities?`<p>OpenGL ES：${esc(state.gpuCapabilities.glesVersion||'未报告')} · Vulkan：${esc(state.gpuCapabilities.vulkanVersion||'未报告')}</p><p class="hint">${esc([state.gpuCapabilities.vulkanRaw,state.gpuCapabilities.vulkanLevel,state.gpuCapabilities.vulkanCompute,state.gpuCapabilities.openglAep].filter(Boolean).join(' · ')||'未报告 Vulkan / OpenGL AEP 特性')}${state.gpuCapabilities.warnings.length?` · ${esc(state.gpuCapabilities.warnings.join('；'))}`:''}${!state.gpuCapabilities.featureListAvailable?' · 特性列表不可用':''}</p>`:'<p class="hint">选择设备后读取系统报告。</p>'}</div></div><div style="height:20px"></div>`+
 `<div class="panel"><div class="panel-head"><h2>Android GPU Inspector</h2></div><div class="panel-body"><p class="hint">${window.desktop?`已配置或发现：${esc(state.agiPath||'未找到')}。直接打开会先创建校验过的本机副本；副本保存在应用数据目录的 gpu-open 中。`:'桌面应用支持选择并启动本机 AGI；浏览器模式请手动启动。'}</p><div class="toolbar">${window.desktop?button('select-agi','选择 AGI','folder')+button('launch-agi','启动 AGI','play',false,!state.agiPath):''}</div></div></div><div style="height:20px"></div><div class="panel"><div class="panel-head"><h2>GPU 产物索引</h2><span class="subtle">${rows.length} 项 · 单个文件最多 512 MiB</span></div>${rows.length?`<div class="table-wrap"><table><thead><tr><th>文件</th><th>类型</th><th>大小</th><th>导入时间</th><th>完整性</th><th>操作</th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${esc(r.name)}</strong><br><span class="subtle mono">SHA-256 ${esc(r.sha256)}</span></td><td>${r.type==='agi-frame'?'AGI 帧捕获':r.type==='perfetto'?'Perfetto 追踪':'追踪文件'}</td><td>${bytes(r.size)}</td><td>${date(r.timestamp)}</td><td>${state.gpuChecks[r.id]===undefined?'未校验':state.gpuChecks[r.id]?'上次校验一致':'上次校验不一致'}</td><td><div class="toolbar"><button class="button small" data-gpu-verify="${r.id}" ${busy?'disabled':''}>校验</button><button class="button small" data-gpu-export="${r.id}" ${busy?'disabled':''}>导出</button>${r.type==='agi-frame'&&window.desktop?.openAgiArtifact?`<button class="button small" data-gpu-open-agi="${r.id}" ${busy||!state.agiPath?'disabled':''}>用 AGI 打开</button>`:''}${r.type!=='agi-frame'?`<button class="button small" data-gpu-trace="${r.id}" ${busy||state.busy.has('trace')?'disabled':''}>系统追踪中打开</button>`:''}</div></td></tr>`).join('')}</tbody></table></div>`:empty('暂无 GPU 产物','导入 AGI 或 Perfetto 文件以建立本机索引。','chart')}</div>`;
}
async function refreshGpu(){state.gpuArtifacts=(await api('/gpu/artifacts')).artifacts;}
function renderSource(){
  const snapshot=state.sourceSnapshot,file=state.sourceFile,search=state.sourceMatches,busy=state.busy.has('source');
  const options=state.sourceSnapshots.map(s=>`<option value="${esc(s.id)}" ${s.id===snapshot?.id?'selected':''}>${esc(s.name)} · ${date(s.timestamp)} · ${s.fileCount} 文件</option>`).join('');
  const lines=file?.text.split(/\r?\n/)||[],start=file?Math.max(0,Math.min((state.sourceLine||1)-1,Math.max(0,lines.length-1))):0;
  return pageHeader('源码工作区','保存只读本地源码快照，搜索和查看采集时的代码。')+
    note('本地快照复制受支持的文本源码并以 SHA-256 校验；读取期间项目可能变化，本地快照不是原子 Git 提交。远程快照通过 GitHub 或 AOSP HTTPS 读取指定版本，保存提交标识，不执行项目脚本。源码搜索是文本匹配，不证明性能事件与结果存在因果关系。')+
    `<div class="panel"><div class="panel-body"><div class="toolbar"><label>本地目录 <input id="source-path" type="text" placeholder="输入源码目录的绝对路径" aria-label="源码目录"></label>${window.desktop?.selectSourceDir?button('source-choose','选择目录','folder',false,busy):''}${button('source-create','创建快照','download',true,busy)}${busy?loading('正在处理源码…'):''}</div><p class="hint">包含 Kotlin、Java、XML、C/C++ 等受支持文本；跳过构建目录、符号链接、单文件超过 512 KiB 的文件。最多 5,000 文件和 32 MiB。</p><div class="toolbar"><label>已保存快照 <select id="source-snapshot"><option value="">选择快照</option>${options}</select></label>${button('source-refresh','刷新','refresh',false,busy)}</div>${snapshot?`<p class="hint">${esc(snapshot.origin||snapshot.sourceRoot)}${snapshot.commit?` · ${esc(snapshot.commit)}`:''} · ${snapshot.files.length} 文件 · ${bytes(snapshot.totalBytes)} · 跳过 ${snapshot.skipped} 项${snapshot.truncated?` · 已截断：${esc(snapshot.reasons.join('、'))}`:''}</p>`:''}</div></div><div style="height:20px"></div>`+
    `<div class="panel"><div class="panel-head"><h2>远程仓库快照</h2></div><div class="panel-body"><div class="toolbar"><label>HTTPS 仓库地址 <input id="source-url" type="url" placeholder="https://github.com/组织/仓库" aria-label="远程仓库地址"></label><label>分支、标签或完整提交 ID <input id="source-ref" type="text" placeholder="留空使用默认分支" aria-label="源码版本"></label>${button('source-remote','获取远程快照','download',false,busy)}</div><p class="hint">仅支持 GitHub 和 android.googlesource.com 的公开仓库。需要本机 Git 和网络；浅克隆的临时下载量可能大于快照上限，不读取子模块或 Git LFS 对象。</p></div></div><div style="height:20px"></div>`+
    (snapshot?`<div class="panel"><div class="panel-head"><h2>搜索快照</h2></div><div class="panel-body"><div class="toolbar"><input id="source-query" class="search" placeholder="输入函数、类名或文本" value="${esc(state.sourceQuery)}" aria-label="搜索源码">${button('source-search','文本搜索','search',true,busy)}${button('source-resolve','定位声明候选','search',false,busy)}</div>${search?`<p class="hint">${search.matches.length} 条${search.mode==='resolve'?'声明候选（按名称、类和包名排序；需核对版本、重载及归属）':'匹配'}${search.truncated?' · 已截断':''}</p>${search.matches.length?`<div class="table-wrap"><table><thead><tr><th>文件 / 行</th><th>匹配内容</th></tr></thead><tbody>${search.matches.map((m,i)=>`<tr><td><button class="button small" data-source-match="${i}">${esc(m.path)}${m.line?`:${m.line}`:''}</button></td><td>${esc(m.preview)}${m.reasons?`<br><span class="hint">${esc(m.reasons.join(' · '))}</span>`:''}</td></tr>`).join('')}</tbody></table></div>`:empty('没有匹配','可尝试类名、函数名或文件名。','search')}`:`<div class="table-wrap"><table><thead><tr><th>快照文件</th><th>大小</th></tr></thead><tbody>${snapshot.files.slice(0,300).map((entry,i)=>`<tr><td><button class="button small" data-source-file="${i}">${esc(entry.path)}</button></td><td>${bytes(entry.size)}</td></tr>`).join('')}</tbody></table></div><p class="hint">最多显示前 300 文件；可搜索全部快照文件。</p>`}</div></div>`:'')+
    (file?`<div style="height:20px"></div><div class="panel"><div class="panel-head"><h2>${esc(file.path)}</h2><span class="subtle">SHA-256 ${esc(file.sha256)}</span></div><div class="panel-body"><div class="toolbar">${button('source-prev','上一页','arrow',false,start===0)}<span>第 ${start+1}–${Math.min(start+200,lines.length)} 行 / ${lines.length}</span>${button('source-next','下一页','arrow',false,start+200>=lines.length)}</div><pre>${lines.slice(start,start+200).map((line,i)=>`${String(start+i+1).padStart(6)}  ${esc(line)}`).join('\n')}</pre></div></div>`:'');
}
async function refreshSource(){state.sourceSnapshots=(await api('/source/snapshots')).snapshots;}
async function openSourceSnapshot(id){state.sourceSnapshot=id?await api('/source/files',{id}):null;state.sourceMatches=null;state.sourceFile=null;state.sourceLine=null;render();}
async function doSourceSearch(query){if(!state.sourceSnapshot)throw new Error('请先选择源码快照');state.sourceQuery=query;state.sourceMatches=await api('/source/search',{id:state.sourceSnapshot.id,query});state.sourceFile=null;state.sourceLine=null;render();}
async function doSourceResolve(symbol){if(!state.sourceSnapshot)throw new Error('请先选择源码快照');state.sourceQuery=symbol;state.sourceMatches=await api('/source/resolve',{id:state.sourceSnapshot.id,symbol});state.sourceFile=null;state.sourceLine=null;render();}
async function openSourceFile(path,line=1){state.sourceFile=await api('/source/file',{id:state.sourceSnapshot.id,path});state.sourceLine=Math.max(1,(line||1)-20);render();}
function renderNetwork() {
  const data=state.network, rows=data?.rows||[], hosts=data?summarizeHarHosts(rows):[];
  return pageHeader('网络分析','导入 HAR，或读取已接入的 OkHttp Agent。',button('network-agent-package','下载 Agent 源码','download')+button(state.networkAgentActive?'network-agent-stop':'network-agent-start',state.networkAgentActive?'停止 Agent 读取':'开始 Agent 读取',state.networkAgentActive?'stop':'play',false,state.demo)+button('save-network','保存分析','download',false,!data)+button('import-har','导入 HAR','upload',true))+
    note('Agent 需要目标应用主动接入，每 3 秒按当前应用 UID 读取 logcat 最近记录；新版 Agent 的请求按标识累积去重，旧版仅显示最新快照。共享 UID 的应用可能混入，日志可能丢失或包含启动前记录。Agent 不记录路径、查询参数、请求头和正文，域名仍属敏感信息。HAR 导入会丢弃查询参数、凭据、Headers、Cookies 与正文，路径仍可能含业务标识。')+
    `<div class="grid stats-grid">${statCard('总请求数',fmt(data?rows.length:null,0),'次',data?.source==='adb'?'当前保留记录':'HAR entries','network','green')}${statCard('失败请求',fmt(data?rows.filter(r=>r.failed===true||r.status===0||r.status>=400).length:null,0),'次','状态码 0 或 ≥ 400','activity','orange')}${statCard('平均耗时',fmt(data&&rows.some(r=>r.timeMs!==null)?rows.filter(r=>r.timeMs!==null).reduce((s,r)=>s+r.timeMs,0)/rows.filter(r=>r.timeMs!==null).length:null),'ms','有效 time 字段的平均值','clock')}${statCard('响应内容大小',fmt(data&&rows.some(r=>r.bytes!==null)?rows.reduce((s,r)=>s+(r.bytes||0),0)/1024:null),'KB','content.size · 非线路传输字节','memory','purple')}</div><div style="height:20px"></div>`+
    (data?`<div class="panel"><div class="panel-head"><h2>域名与连接阶段</h2></div><div class="panel-body">${data.source==='adb'?`<p class="hint">UID ${esc(data.uid)} · 当前显示 ${rows.length} 条 · 新版累积 ${data.accumulated??0} 条 · 旧版快照 ${data.legacy??0} 条 · 已丢弃最早 ${data.dropped??0} 条 · 最近快照忽略 ${data.invalid} 条无法解析的日志${data.displayTruncated?' · 显示已截断':''}；未读到的日志无法补回。</p>`:''}<p class="hint">各列为该阶段有数据的请求平均耗时（毫秒），括号内为样本数。TLS 是连接耗时的一部分，不能相加；Agent 的接收阶段包含应用读取间隔，缺失值不代表零耗时。</p><div class="table-wrap"><table><thead><tr><th>域名</th><th>请求 / 失败</th><th>DNS</th><th>连接</th><th>TLS</th><th>等待</th><th>接收</th></tr></thead><tbody>${hosts.slice(0,500).map(h=>`<tr><td>${esc(h.host)}</td><td>${h.count} / ${h.failures}</td>${['dns','connect','ssl','wait','receive'].map(k=>`<td class="mono">${h.phases[k].mean===null?'—':`${fmt(h.phases[k].mean,1)} (${h.phases[k].count})`}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${hosts.length>500?'<p class="hint">仅显示请求数最多的 500 个域名。</p>':''}</div></div><div style="height:20px"></div>`:'')+
    (data?networkEndpoints(rows)+networkTimeline(rows):'')+`<div class="panel"><div class="panel-head"><h2>请求列表 ${data?sourceTag(data.source):''}</h2><input class="search" id="network-search" placeholder="筛选域名或路径…" value="${esc(state.networkFilter)}" aria-label="筛选网络请求"></div><div id="network-table">${networkTable()}</div></div>`;
}
function networkEndpoints(rows){
 const endpoints=summarizeNetworkEndpoints(rows).sort((a,b)=>(b.p95??-1)-(a.p95??-1)||b.count-a.count);
 return `<div class="panel"><div class="panel-head"><h2>接口耗时分布</h2><span class="hint">按 P95 降序</span></div><div class="panel-body"><p class="hint">按方法、域名和路径分组；HAR 查询参数已丢弃，Agent 不记录路径。P50 / P95 使用最近秩，仅统计有有效耗时的已保留请求；样本少时百分位可能就是最大值，不能代表总体性能。列表搜索不影响此表。</p>${endpoints.length?`<div class="table-wrap"><table><thead><tr><th>接口</th><th>请求 / 失败</th><th>有效耗时</th><th>P50</th><th>P95</th><th>最大</th></tr></thead><tbody>${endpoints.slice(0,500).map(e=>`<tr><td><strong>${esc(e.method)} ${esc(e.host)}</strong><br><span class="mono">${esc(e.path)}</span></td><td>${e.count} / ${e.failures}</td><td>${e.timed}</td><td>${fmt(e.p50,1)} ms</td><td>${fmt(e.p95,1)} ms</td><td>${fmt(e.max,1)} ms</td></tr>`).join('')}</tbody></table></div><p class="hint">共 ${endpoints.length} 组，最多显示 500 组。</p>`:empty('没有请求','导入包含请求的网络记录。','network')}</div></div><div style="height:20px"></div>`;
}
function networkTimeline(rows){
 const timeline=buildNetworkTimeline(rows);
 return `<div class="panel"><div class="panel-head"><h2>请求活动时间线</h2><span class="hint">按开始时间排列</span></div><div class="panel-body"><p class="hint">展示开始时间和总耗时均可用的最早 200 条请求；重叠仅表示记录的时间重合，不证明因果关系。${timeline.unavailable} 条缺少可用时间，${timeline.truncated?'其余记录未显示。':''}列表搜索不影响此图。</p>${timeline.items.length?`<p class="hint">起点 ${esc(date(timeline.startMs))} · 显示区间 ${fmt(timeline.endMs-timeline.startMs,1)} ms</p><div class="timeline-list">${timeline.items.map(r=>`<div class="timeline-row"><span title="${esc(r.host+r.path)}">${esc(r.method)} ${esc(r.host)}</span><div class="timeline-track"><button class="timeline-bin" data-request="${r.id}" style="left:${r.left*100}%;width:${r.width*100}%" title="${esc(r.host+r.path)} · ${fmt(r.timeMs,1)} ms" aria-label="${esc(r.method+' '+r.host+r.path)}，耗时 ${fmt(r.timeMs,1)} 毫秒"></button></div></div>`).join('')}</div>`:empty('没有可绘制的请求','请求缺少开始时间或总耗时。','network')}</div></div><div style="height:20px"></div>`;
}
async function startNetworkAgent(){
  requireTarget();if(state.demo)throw new Error('请连接真实设备');
  stopNetworkAgent();state.networkAgentActive=true;let accumulator=null;const generation=state.networkAgentGeneration,serial=state.serial,packageName=state.packageName;render();
  const poll=async()=>{try{const result=await api('/network/agent',{serial,packageName});if(!state.networkAgentActive||generation!==state.networkAgentGeneration)return;const merged=mergeNetworkAgentSnapshot(accumulator,result);accumulator=merged.state;state.network=merged.result;if(state.route==='network')render();}catch(error){if(generation===state.networkAgentGeneration){stopNetworkAgent();toast(`Agent 读取失败：${error.message}`,true);render();}return;}if(state.networkAgentActive&&generation===state.networkAgentGeneration)state.networkAgentTimer=setTimeout(poll,3000);};
  await poll();
}
function networkTable() {
  if(!state.network) return empty('导入你的网络记录','支持浏览器、代理工具导出的标准 HAR 文件。','network',button('import-har','选择 HAR 文件','upload'));
  const rows=state.network.rows.filter(r=>(r.host+r.path).toLowerCase().includes(state.networkFilter.toLowerCase()));
  const max=Math.max(1,...rows.map(r=>r.timeMs||0));
  return `<div class="table-wrap"><table><thead><tr><th>请求路径</th><th>方法</th><th>状态</th><th>域名</th><th>内容大小</th><th>耗时</th><th>相对耗时</th></tr></thead><tbody>${rows.slice(0,1000).map(row=>`<tr class="clickable" data-request="${row.id}"><td><strong>${esc(row.path)}</strong></td><td class="mono">${esc(row.method)}</td><td><span class="tag ${row.failed===true||row.status>=400||row.status===0?'red':'green'}">${row.status}${row.failed?' · 调用失败':''}</span></td><td class="mono">${esc(row.host)}</td><td class="mono">${fmt(row.bytes===null?null:row.bytes/1024)} KB</td><td class="mono">${fmt(row.timeMs,0)} ms</td><td><div class="waterfall"><i style="width:${Math.max(1,(row.timeMs||0)/max*100)}%"></i></div></td></tr>`).join('')}</tbody></table></div>${!rows.length?empty('没有匹配的请求','试试其他域名或路径。','search'):''}${rows.length>1000?'<div class="hint" style="padding:15px">仅渲染前 1,000 条匹配请求，请使用筛选缩小范围。</div>':''}`;
}
function renderBenchmark() {
  const rows=state.baseline&&state.current?compareBenchmarks(state.baseline,state.current):[];
  const warnings=state.baseline&&state.current?benchmarkContextWarnings(state.baseline,state.current):[],history=state.sessions.filter(s=>s.kind==='benchmark');
  return pageHeader('基准对比','对齐 AndroidX Benchmark 运行，查看指标变化。',button('export-benchmark','导出对比报告','download',false,!rows.length))+
    note('按类、测试名、参数、指标类型和指标名匹配；重复标识不计算差值。只展示描述性差异，不推断统计显著性或优劣方向；sampledMetrics 的样本可能来自同一次迭代，不能当作独立实验。')+
    (warnings.length?note(`运行环境需要核对：${esc(warnings.join('、'))}。未列出的条件也可能不同。`):'')+
    `<div class="panel"><div class="panel-head"><h2>运行已安装的 Benchmark</h2></div><div class="panel-body"><p class="hint">需要先在设备安装 benchmark 测试 APK。运行 instrumentation 会启动目标应用并操作手机，可能持续数分钟；工具不会安装 APK、配置测试或自动取得 JSON。请从测试应用的输出目录取回报告后导入。超时或断线时设备上的测试可能仍在运行。</p><div class="toolbar"><label>测试包 / Runner <input id="benchmark-component" aria-label="测试包和 Runner" placeholder="com.example.benchmark/androidx.test.runner.AndroidJUnitRunner" value="${esc(state.benchmarkComponent||'')}"></label><label>测试类或方法（可选） <input id="benchmark-class" aria-label="测试类或方法" placeholder="com.example.StartupBenchmark#startup" value="${esc(state.benchmarkClass||'')}"></label>${button('benchmark-run','运行测试','play',true,state.busy.has('benchmark-run')||state.demo||!state.serial)}${state.busy.has('benchmark-run')?loading('设备正在运行测试…'):''}</div>${state.benchmarkRun?`<p>状态：${{completed:'测试运行完成',failed:'测试运行失败',unknown:'未能确认测试结果'}[state.benchmarkRun.status]} · 测试数 ${state.benchmarkRun.testCount??'未知'}</p><pre>${esc(state.benchmarkRun.output)}</pre>`:''}</div></div><div style="height:20px"></div>`+
    `<div class="panel"><div class="panel-head"><h2>从设备读取报告</h2></div><div class="panel-body"><p class="hint">输入测试包 Android/media 目录中的 JSON 完整路径，读取后作为当前运行。设备文件可能来自较早的测试；请自行核对生成时间、测试参数和设备，工具不自动认定它属于刚才的运行。其他位置的报告请手动导入。</p><div class="toolbar"><label>设备报告路径 <input id="benchmark-report-path" aria-label="设备报告路径" placeholder="/sdcard/Android/media/com.example.benchmark/com.example.benchmark-benchmarkData.json" value="${esc(state.benchmarkReportPath||'')}"></label>${button('benchmark-read-report','读取设备报告','download',false,state.busy.has('benchmark-report')||state.demo||!state.serial)}</div></div></div><div style="height:20px"></div>`+
    `<div class="grid monitor-grid">${[['baseline','基线运行','BASELINE',state.baseline],['current','当前运行','CURRENT',state.current]].map(([key,title,en,data])=>`<div class="panel"><div class="panel-head"><h2>${title}</h2><span class="tag">${en}</span></div><div class="panel-body"><div class="dropzone">${data?`${icon('file',23)}<br><strong>${esc(data.fileName)}</strong><br>${data.results.length} 个可读指标`:'选择 AndroidX Benchmark 导出的 JSON 文件'}<br>${button(`import-${key}`,data?'重新选择':'导入 JSON','upload')}${button(`save-benchmark-${key}`,'保存运行','download',false,!data)}</div>${data?`<div class="hint">设备：${esc(data.context?.build?.model||'未提供')} · API ${esc(data.context?.build?.version?.sdk||'未提供')}${data.origin?.kind==='device'?`<br>设备读取：${esc(data.origin.path)} · ${date(data.origin.readAt)}；不保证来自最近一次运行`:''}</div>`:''}<div class="toolbar"><label>历史记录 <select id="benchmark-history-${key}"><option value="">选择已保存运行</option>${history.map(s=>`<option value="${esc(s.id)}">${esc(s.name)} · ${date(s.timestamp)}</option>`).join('')}</select></label>${button(`load-benchmark-${key}`,'载入','folder',false,!history.length)}</div></div></div>`).join('')}</div><div style="height:20px"></div>`+
    `<div class="panel"><div class="panel-head"><h2>指标变化</h2><span class="subtle">正值为增加，负值为减少 · 保留原始单位</span></div>${rows.length?`<div class="table-wrap"><table><thead><tr><th>测试 / 指标</th><th>基线中位数</th><th>当前中位数</th><th>相对变化</th><th>样本数（基线 / 当前）</th><th></th></tr></thead><tbody>${rows.slice(0,1000).map((r,i)=>`<tr><td><strong>${esc(r.className)} · ${esc(r.name)}</strong><br><span class="subtle mono">${esc(r.metricType)} · ${esc(r.metric)} · ${esc(JSON.stringify(r.params))}</span></td><td class="mono">${fmt(r.baseline,2)}</td><td class="mono">${fmt(r.median,2)}</td><td class="mono">${r.ambiguous?'重复指标':r.delta===null?'不可比':`${r.delta>0?'+':''}${fmt(r.delta,2)}%`}</td><td class="mono">${r.baselineRuns??'—'} / ${r.missing==='current'?'—':r.runs}</td><td><button class="button small" data-benchmark-row="${i}">详情</button></td></tr>`).join('')}</tbody></table></div><p class="hint">共 ${rows.length} 项，最多显示 1,000 项。</p>`:empty('等待两份运行结果','先导入或载入基线与当前运行。','chart')}</div>`;
}
const bytes = value => !Number.isFinite(value)?'—':value>=1024**2?`${fmt(value/1024**2,2)} MiB`:value>=1024?`${fmt(value/1024,1)} KiB`:`${value} B`;
const apkFlag = value => value===null||value===undefined?'<span class="tag">未声明</span>':typeof value==='boolean'?`<span class="tag ${value?'orange':''}">${value?'true':'false'}</span>`:esc(value);
const APK_COLORS=['#69a995','#88a9d1','#b39bc9','#d2b37a','#9db8b6','#ba9b94','#a7b1bc','#c7c7b2','#d9dee4'];
function apkKeyValues(values) { return `<dl class="apk-key-values">${values.map(([label,value])=>`<dt>${esc(label)}</dt><dd>${value}</dd>`).join('')}</dl>`; }
function renderApk() {
  const p=state.apk,busy=state.busy.has('apk');
  const actions=button('export-apk','导出报告','download',false,!p||busy)+button('save-apk','保存分析','folder',false,!p||busy)+button('choose-apk',busy?'正在分析…':'选择 APK','upload',true,busy);
  const heading=pageHeader('APK 分析','在本机检查安装包结构、Manifest 和证书，无需连接设备。',actions,'PACKAGE INSPECTOR / LOCAL ANALYSIS');
  if(!p)return heading+`<div class="panel"><div class="apk-empty"><div class="hero-icon">${icon('package',38)}</div><h2>看清每一份安装包</h2><p>导入 APK，定位体积来源，查看应用声明与签名证书。<br>支持单个 APK，最大 512 MB；分析全程在本机完成。</p>${busy?loading('正在读取 APK 并解析资源…'):button('choose-apk','选择本地 APK','upload',true)}<div class="apk-feature-list"><span>${icon('file',16)}包信息与 Manifest</span><span>${icon('chart',16)}体积与大文件</span><span>${icon('cpu',16)}DEX / ABI</span><span>${icon('info',16)}签名证书</span></div></div></div>`;
  const m=p.manifest,so=p.abis.reduce((sum,a)=>sum+a.count,0);
  return heading+(busy?`<div class="toolbar">${loading('正在分析新 APK；完成后更新结果…')}</div>`:'')+
    `<div class="apk-identity"><div class="apk-app-icon">${p.icon?`<img alt="APK 应用图标" src="${esc(p.icon)}">`:icon('package',30)}</div><div class="apk-app-title"><h2>${esc(m.label||m.packageName)}</h2><p class="mono">${esc(m.packageName)}</p><div><span class="tag">v${esc(m.versionName??'—')} (${esc(m.versionCode??'—')})</span><span class="tag">min SDK ${esc(m.minSdk??'—')} → target ${esc(m.targetSdk??'—')}</span>${sourceTag(p.source)}</div></div><div class="apk-file-meta"><strong>${esc(p.fileName)}</strong><span>${p.sizeBytes.toLocaleString('en-US')} bytes · ${date(p.timestamp)}</span><span class="mono">SHA-256 ${esc(p.sha256)}</span></div></div>`+
    `<div class="grid stats-grid">${statCard('APK 文件体积',fmt(p.sizeBytes/1024**2,2),'MiB','原始 APK 大小，含容器开销','package','green')}${statCard('文件条目',fmt(p.fileCount,0),'个',`${bytes(p.uncompressedBytes)} 展开量 · 非安装占用`,'folder','purple')}${statCard('DEX 文件',fmt(p.dex.length,0),'个','支持多 DEX 文件头统计','cpu')}${statCard('Native 库',fmt(so,0),'个',p.abis.map(a=>a.name).join(' / ')||'没有 lib/ ABI 库','layers','orange')}</div>`+
    `<div class="apk-tabs" role="tablist" aria-label="APK 分析视图">${[['overview','概览'],['files','文件体积'],['permissions',`权限 ${m.permissions.length}`],['components',`组件 ${m.components.length}`],['dex','DEX / ABI'],['signing','签名证书'],['manifest','Manifest']].map(([key,label])=>`<button role="tab" aria-selected="${state.apkTab===key}" data-apk-tab="${key}" class="${state.apkTab===key?'active':''}">${label}</button>`).join('')}</div>`+
    `<div id="apk-content">${apkContent()}</div>`+(p.warnings.length?`<div class="notice" style="margin:18px 0 0">${p.warnings.map(w=>esc(w)).join('<br>')}</div>`:'');
}
function apkContent() {
  const p=state.apk,m=p.manifest;
  if(state.apkTab==='files')return `<div class="panel"><div class="panel-head"><h2>文件清单</h2><div class="import-actions"><select id="apk-category" aria-label="APK 文件分类"><option value="all">全部分类</option>${p.categories.filter(c=>c.count).map(c=>`<option value="${esc(c.key)}" ${state.apkCategory===c.key?'selected':''}>${esc(c.label)}</option>`).join('')}</select><input id="apk-search" class="search" aria-label="筛选 APK 文件" placeholder="搜索路径、后缀或文件名…" value="${esc(state.apkFilter)}"></div></div><div id="apk-file-table">${apkFileTable()}</div></div><p class="hint">压缩体积是 ZIP 条目中的存储字节，展开体积是条目声明的原始字节；容器开销不属于任何单个文件。没有将 APK 内容解压到目录。</p>`;
  if(state.apkTab==='permissions')return `<div class="panel"><div class="panel-head"><h2>请求的权限</h2><span class="tag">${m.permissions.length} 项</span></div><div class="table-wrap"><table><thead><tr><th>权限名称</th><th>声明方式</th><th>maxSdkVersion</th></tr></thead><tbody>${m.permissions.map(row=>`<tr><td class="mono">${esc(row.name)}</td><td>${esc(row.tag)}</td><td>${esc(row.maxSdk??'未声明')}</td></tr>`).join('')}</tbody></table></div>${m.permissions.length?'':empty('未声明请求权限','当前 Manifest 没有 uses-permission。','info')}</div>`+
    note('这是 Manifest 中的权限声明，不代表系统已授予权限；未推断权限保护级别或应用运行时行为。')+
    `<div class="panel"><div class="panel-head"><h2>自定义权限声明</h2></div><div class="table-wrap"><table><thead><tr><th>权限名称</th><th>protectionLevel 原始值</th></tr></thead><tbody>${(m.declaredPermissions||[]).map(row=>`<tr><td class="mono">${esc(row.name)}</td><td>${esc(row.protectionLevel??'未声明')}</td></tr>`).join('')}</tbody></table></div>${m.declaredPermissions?.length?'':empty('无自定义权限','当前 Manifest 没有 permission 声明。','info')}</div>`;
  if(state.apkTab==='components')return `<div class="panel"><div class="panel-head"><h2>应用组件</h2><select id="apk-component-type" aria-label="APK 组件类型">${[['all','全部组件'],['activity','Activity'],['activity-alias','Activity alias'],['service','Service'],['receiver','Receiver'],['provider','Provider']].map(([key,label])=>`<option value="${key}" ${state.apkComponent===key?'selected':''}>${label}</option>`).join('')}</select></div><div id="apk-component-table">${apkComponentTable()}</div></div><div class="hint">exported / enabled 显示 Manifest 的显式值，未声明不等于 false。组件名已按包名展开；点击一行查看 actions、categories 和其他声明。</div>`;
  if(state.apkTab==='manifest')return `<div class="panel"><div class="panel-head"><h2>AndroidManifest.xml</h2><span class="tag">AAPT2 解析视图</span></div><div class="apk-manifest"><pre>${esc(m.xml)}</pre></div></div><p class="hint">由二进制 Manifest 生成的可读 XML。资源引用可能保留为资源 ID；不等同于原始源码中的 XML、注释或格式。</p>`;
  if(state.apkTab==='dex')return `<div class="panel"><div class="panel-head"><h2>DEX 文件头统计</h2><span class="tag">${p.dex.length} 文件</span></div><div class="table-wrap"><table><thead><tr><th>文件</th><th>版本</th><th>文件头大小</th><th>method_ids</th><th>class_defs</th><th>type_ids</th><th>string_ids</th></tr></thead><tbody>${p.dex.map(d=>`<tr><td class="mono">${esc(d.path)}</td>${d.error?`<td colspan="6" class="text-red">${esc(d.error)}</td>`:`<td>${esc(d.version)}</td><td>${bytes(d.declaredBytes)}</td><td class="mono">${fmt(d.methodIds,0)}</td><td class="mono">${fmt(d.classDefs,0)}</td><td class="mono">${fmt(d.typeIds,0)}</td><td class="mono">${fmt(d.stringIds,0)}</td>`}</tr>`).join('')}</tbody></table></div>${p.dex.length?'':empty('没有 classes*.dex','当前 APK 可能是资源分片。','cpu')}</div>`+
    note('method_ids 是方法 ID 引用数，跨 DEX 可以重复；不是去重后的方法数，也不是应用自行定义的方法数。这里读取文件头，不做反编译或 DEX 完整性校验。')+
    `<div class="panel"><div class="panel-head"><h2>Native ABI 分布</h2></div><div class="table-wrap"><table><thead><tr><th>ABI</th><th>.so 数量</th><th>压缩体积</th><th>展开体积</th></tr></thead><tbody>${p.abis.map(a=>`<tr><td class="mono">${esc(a.name)}</td><td>${a.count}</td><td>${bytes(a.compressedBytes)}</td><td>${bytes(a.uncompressedBytes)}</td></tr>`).join('')}</tbody></table></div>${p.abis.length?'':empty('没有 lib/ 下的 .so','不推断 assets 或其他位置文件的 ABI。','layers')}</div>`;
  if(state.apkTab==='signing')return note('检测范围为 v1 / v2 / v3 / v3.1，仅识别签名结构并提取证书。未验证 APK 内容签名、证书信任链或可安装性；“检测到 v2”等标记不表示签名验证通过。v4 的独立 .idsig 文件不包含在单个 APK 中。')+
    `<div class="panel"><div class="panel-head"><h2>签名结构</h2><span class="tag orange">完整验证未执行</span></div><div class="panel-body">${apkKeyValues([['检测到的方案',p.signatures.detectedSchemes.map(s=>`<span class="tag green">${esc(s)}</span>`).join(' ')||'未检测到'],['APK Signing Block 大小',bytes(p.signatures.blockBytes)],['证书记录',String(p.signatures.certificates.length)]])}</div></div>`+
    p.signatures.certificates.map((cert,i)=>`<div class="panel" style="margin-top:18px"><div class="panel-head"><h2>证书 ${i+1} <span class="tag">${esc(cert.scheme)} · signer ${cert.signer} · certificate ${cert.chainIndex+1}</span></h2></div><div class="panel-body">${apkKeyValues([['Subject',`<pre>${esc(cert.subject)}</pre>`],['Issuer',`<pre>${esc(cert.issuer)}</pre>`],['公钥',`${esc(cert.keyType)} ${cert.keyBits?`${cert.keyBits} bit`:esc(cert.curve||'')}`],['有效期',`${esc(cert.validFrom)} → ${esc(cert.validTo)}`],['序列号',`<span class="mono">${esc(cert.serialNumber)}</span>`],['SHA-256',`<span class="mono">${esc(cert.sha256)}</span>`],['SHA-1',`<span class="mono">${esc(cert.sha1)}</span>`]])}</div></div>`).join('');
  const max=Math.max(...p.categories.map(c=>c.compressedBytes),1);
  return `<div class="grid chart-layout"><div class="panel"><div class="panel-head"><h2>APK 体积组成</h2><span class="subtle">按压缩后存储字节</span></div><div class="panel-body"><div class="apk-stack">${p.categories.map((c,i)=>`<span style="width:${c.compressedBytes/p.sizeBytes*100}%;background:${APK_COLORS[i%APK_COLORS.length]}" title="${esc(c.label)} ${bytes(c.compressedBytes)}"></span>`).join('')}</div><div class="apk-size-list">${p.categories.map((c,i)=>`<${c.key==='overhead'?'div':'button'} class="apk-size-row" ${c.key==='overhead'?'':`data-apk-category="${esc(c.key)}"`}><span><i style="background:${APK_COLORS[i%APK_COLORS.length]}"></i>${esc(c.label)}</span><span class="apk-size-track"><i style="width:${c.compressedBytes/max*100}%;background:${APK_COLORS[i%APK_COLORS.length]}"></i></span><span class="mono">${bytes(c.compressedBytes)}</span><small>${fmt(c.compressedBytes/p.sizeBytes*100)}%</small></${c.key==='overhead'?'div':'button'}>`).join('')}</div><p class="hint">点击分类定位大文件。容器开销包括 ZIP 结构、APK 签名块与填充。展开量不等于安装占用。</p></div></div>`+
    `<div class="panel"><div class="panel-head"><h2>应用声明</h2></div><div class="panel-body">${apkKeyValues([['包名',esc(m.packageName)],['版本',`${esc(m.versionName??'—')} / ${esc(m.versionCode??'—')}`],['min / target SDK',`${esc(m.minSdk??'—')} / ${esc(m.targetSdk??'—')}`],['compile SDK',esc(m.compileSdk??'—')],['debuggable',apkFlag(m.debuggable)],['allowBackup',apkFlag(m.allowBackup)],['usesCleartextTraffic',apkFlag(m.usesCleartextTraffic)],['extractNativeLibs',apkFlag(m.extractNativeLibs)],['分片名称',esc(m.split??'基础 APK / 未声明')],['sharedUserId',esc(m.sharedUserId??'未声明')]])}</div></div></div><div class="hint">仅分析此 APK 的静态声明；不运行、安装或上传应用，也不会合并其他 split APK。</div>`;
}
function apkFileTable() {
  const p=state.apk,filter=state.apkFilter.toLowerCase();
  const files=p.files.filter(f=>(state.apkCategory==='all'||f.category===state.apkCategory)&&f.path.toLowerCase().includes(filter));
  return `<div class="table-wrap"><table><thead><tr><th>文件路径</th><th>分类</th><th>压缩体积 ↓</th><th>展开体积</th><th>压缩方式</th><th>CRC32</th></tr></thead><tbody>${files.slice(0,500).map((f)=>`<tr class="clickable" data-apk-file="${p.files.indexOf(f)}"><td class="mono apk-path" title="${esc(f.path)}">${esc(f.path)}</td><td>${esc(p.categories.find(c=>c.key===f.category)?.label||f.category)}</td><td class="mono">${bytes(f.compressedBytes)}</td><td class="mono">${bytes(f.uncompressedBytes)}</td><td>${f.method===0?'Stored':f.method===8?'Deflate':esc(f.method)}</td><td class="mono">${esc(f.crc32)}</td></tr>`).join('')}</tbody></table></div>${files.length?'':empty('没有匹配的文件','调整分类或文件名筛选。','search')}<div class="hint" style="padding:12px 20px">匹配 ${files.length} / ${p.fileCount} 个文件；显示前 ${Math.min(files.length,500)} 个，按压缩体积从大到小排列。</div>`;
}
function apkComponentTable() {
  const all=state.apk.manifest.components,rows=all.map((c,i)=>({...c,index:i})).filter(c=>state.apkComponent==='all'||c.type===state.apkComponent);
  return `<div class="table-wrap"><table><thead><tr><th>组件名称</th><th>类型</th><th>exported 显式值</th><th>enabled 显式值</th><th>action 数</th></tr></thead><tbody>${rows.map(c=>`<tr class="clickable" data-apk-component="${c.index}"><td class="mono">${esc(c.name)}</td><td><span class="tag">${esc(c.type)}</span></td><td>${apkFlag(c.exported)}</td><td>${apkFlag(c.enabled)}</td><td>${c.actions.length}</td></tr>`).join('')}</tbody></table></div>${rows.length?'':empty('没有此类组件','请选择其他类型。','package')}`;
}
function sessionTable(sessions) {
  if(!sessions.length) return empty('还没有采集记录','完成采集后点击“保存记录”，在这里随时回看。','folder');
  return `<div class="table-wrap"><table><thead><tr><th>记录名称</th><th>分析类型</th><th>来源</th><th>保存时间</th><th></th></tr></thead><tbody>${sessions.map(s=>`<tr class="clickable" data-session="${esc(s.id)}"><td><div class="table-title"><span class="file-icon">${icon('file',17)}</span><strong>${esc(s.name)}</strong></div></td><td>${esc(routes.find(r=>r[0]===s.kind)?.[1]||s.kind)}</td><td>${sourceTag(s.source)}</td><td class="mono">${date(s.timestamp)}</td><td style="color:#a8b7af">查看 →</td></tr>`).join('')}</tbody></table></div>`;
}
function renderSessions() {
  return pageHeader('采集记录','保存在本机的性能证据，随时回看与导出。',button('import-session','导入记录','upload')+button('refresh-sessions','刷新列表','refresh'))+
    `<div class="panel"><div class="panel-head"><h2>本地档案</h2><span class="tag">${state.sessions.length} 份记录</span></div>${sessionTable(state.sessions)}</div><div class="hint">记录目录：${esc(state.status?.dataDir||'本机 data/')}。演示记录保留演示来源；导入记录保留文件声明的来源元数据。可在详情窗口导出 JSON。</div>`;
}
function renderSettings() {
  return pageHeader('设置与帮助','准备好设备，让采集从一次连接开始。')+
    `<div class="settings-grid"><div class="panel"><div class="panel-head"><h2>主题与显示</h2>${icon('settings',16)}</div><div class="panel-body appearance-controls"><label for="appearance-theme">颜色主题<select id="appearance-theme"><option value="system" ${state.theme==='system'?'selected':''}>跟随系统</option><option value="light" ${state.theme==='light'?'selected':''}>浅色</option><option value="dark" ${state.theme==='dark'?'selected':''}>深色</option></select></label><label for="appearance-scale">界面缩放<select id="appearance-scale">${[['0.9','90%'],['1','100%'],['1.1','110%'],['1.2','120%']].map(([value,label])=>`<option value="${value}" ${state.uiScale===value?'selected':''}>${label}</option>`).join('')}</select></label><p class="hint">设置保存在本机，并应用于桌面端和本地工作台。</p></div></div><div class="panel"><div class="panel-head"><h2>本机运行环境</h2>${icon('settings',16)}</div><div class="panel-body"><div class="evidence-row"><span>版本</span><strong>${esc(state.status?.version||'检测中')}</strong></div><div class="evidence-row"><span>运行模式</span><strong>${state.status?.desktop?'原生桌面应用 · Electron':'本地 HTTP · 127.0.0.1'}</strong></div><p class="hint">ADB 路径</p><code>${esc(state.status?.adbPath||'检测中')}</code><p>自动检测 PATH、ANDROID_HOME、ANDROID_SDK_ROOT 和常见 SDK 安装目录。${state.status?.desktop?'可通过原生菜单「文件 → 选择 ADB 程序…」修改路径。':'指定其他 ADB 后重启服务：'}</p><code>${state.status?.desktop?'文件 → 选择 ADB 程序…':'ADB_PATH=/your/sdk/platform-tools/adb npm start'}</code><p class="hint">记录目录</p><code>${esc(state.status?.dataDir||'检测中')}</code></div></div><div class="panel"><div class="panel-head"><h2>设备连接</h2>${icon('phone',16)}</div><div class="panel-body"><p>1. 在 Android 设备上打开开发者选项和 USB 调试。<br>2. 使用数据线连接电脑，并在设备上允许 USB 调试。<br>3. 点击右上角刷新，选择设备和目标应用。<br>4. 启动目标应用，再开始采集。</p><code>adb devices -l</code><p>unauthorized：在手机确认调试授权。<br>offline：检查连接或重新插拔。<br>无线设备：先在系统终端完成 adb pair / connect。</p></div></div><div class="panel"><div class="panel-head"><h2>功能与限制</h2>${icon('info',16)}</div><div class="panel-body"><p>已实现：设备指标、帧与启动分析、CPU 采样、堆分析、布局检查、系统追踪、资源统计、HAR 与 Benchmark 分析、APK 分析和源码快照。</p><p class="hint">功能受设备权限、系统版本及工具安装情况限制；完整 Compose 检查、应用级能耗归因和网络实时采集仍在开发。</p></div></div><div class="panel"><div class="panel-head"><h2>证据与数据</h2>${icon('folder',16)}</div><div class="panel-body"><p>数据仅保存在当前电脑，不调用 AI 或上传服务。实时数据最多保留 1,800 个样本；图表展示最近 120 个。停止采集后请手动保存记录。</p><p class="hint">启动实验会操作前台应用；帧重置仅清除系统 gfxinfo 统计。UIAutomator 采集的是当前窗口，可能包含敏感内容，请按需保存。演示样例可随时清除并切换到真实设备。</p></div></div></div>`;
}

const $$ = selector => [...document.querySelectorAll(selector)];
function render() {
  renderNav(); updateChrome();
  const views={ overview:renderOverview, monitor:renderMonitor, 'cpu-profile':renderCpuProfile, frames:renderFrames, startup:renderStartup, layout:renderLayout, heap:renderHeap, battery:renderBattery, gpu:renderGpu, trace:renderTrace, network:renderNetwork, benchmark:renderBenchmark, apk:renderApk, source:renderSource, sessions:renderSessions, settings:renderSettings };
  $('#main').innerHTML=(views[state.route]||renderOverview)();
  requestAnimationFrame(()=>{ drawCharts(); if(state.route==='layout'&&state.selectedNode!==null) selectNode(state.selectedNode); const flame=$('.flame-scroll');if(state.route==='cpu-profile'&&flame)flame.scrollTop=flame.scrollHeight; });
}

function drawChart(id, key, color, unit, minimum) {
  const canvas=$(`#${id}`); if(!canvas) return;
  const bounds=canvas.getBoundingClientRect(), dpr=window.devicePixelRatio||1;
  canvas.width=Math.max(1,bounds.width*dpr); canvas.height=Math.max(1,bounds.height*dpr);
  const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);
  const width=bounds.width,height=bounds.height,pad={left:37,right:10,top:13,bottom:15};
  const rows=state.samples.slice(-120), numbers=rows.map(key), valid=numbers.filter(n=>n!==null&&n!==undefined&&Number.isFinite(n));
  const maximum=Math.max(minimum,...valid)*1.15;
  ctx.font='9px -apple-system, sans-serif';ctx.textAlign='right';ctx.textBaseline='middle';
  for(let i=0;i<=4;i++) {
    const y=pad.top+(height-pad.top-pad.bottom)*i/4;
    ctx.beginPath();ctx.strokeStyle='#eef1f4';ctx.lineWidth=1;ctx.moveTo(pad.left,y);ctx.lineTo(width-pad.right,y);ctx.stroke();
    ctx.fillStyle='#a2acb6';ctx.fillText(`${Math.round(maximum*(4-i)/4)}${unit}`,pad.left-9,y);
  }
  if(!rows.length) return;
  const x=i=>pad.left+i/Math.max(rows.length-1,1)*(width-pad.left-pad.right);
  const y=n=>pad.top+(1-n/maximum)*(height-pad.top-pad.bottom);
  // Separate segments at unavailable samples; never interpolate missing evidence.
  const segments=[];let segment=[];
  numbers.forEach((n,i)=>{if(n===null||n===undefined||!Number.isFinite(n)){if(segment.length)segments.push(segment);segment=[];}else segment.push([x(i),y(n)]);});
  if(segment.length)segments.push(segment);
  for(const points of segments){
    const gradient=ctx.createLinearGradient(0,pad.top,0,height);gradient.addColorStop(0,`${color}32`);gradient.addColorStop(1,`${color}02`);
    ctx.beginPath();ctx.moveTo(points[0][0],height-pad.bottom);points.forEach(p=>ctx.lineTo(...p));ctx.lineTo(points.at(-1)[0],height-pad.bottom);ctx.closePath();ctx.fillStyle=gradient;ctx.fill();
    ctx.beginPath();ctx.moveTo(...points[0]);points.slice(1).forEach(p=>ctx.lineTo(...p));ctx.strokeStyle=color;ctx.lineWidth=1.8;ctx.lineJoin='round';ctx.stroke();
    if(points.length===1){ctx.beginPath();ctx.arc(...points[0],2,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();}
  }
}
function drawCharts() {
  drawChart('overview-chart',row=>row.cpu?.percent,'#65a993','%',25);
  drawChart('cpu-chart',row=>row.cpu?.percent,'#65a993','%',25);
  drawChart('memory-chart',row=>row.memory?.pssMb,'#9a8bbd','',50);
}
function updateLive() {
  $$('[data-cpu-label]').forEach(node=>node.textContent=cpuLabel());
  $$('[data-action=save-monitor]').forEach(node=>node.disabled=!state.samples.length);
  $$('[data-live]').forEach(node=>node.textContent=liveValue(node.dataset.live));
  $$('[data-sample-count]').forEach(node=>node.textContent=`${state.samples.length} 个样本`);
  $$('[data-pid]').forEach(node=>node.textContent=last()?.pid||'—');
  $$('[data-chart-start]').forEach(node=>node.textContent=new Date(state.samples.slice(-120)[0]?.timestamp||Date.now()).toLocaleTimeString('zh-CN',{hour12:false}));
  $$('[data-chart-end]').forEach(node=>node.textContent=new Date(last()?.timestamp||Date.now()).toLocaleTimeString('zh-CN',{hour12:false}));
  $$('.empty-chart').forEach(node=>node.remove());
  if($('#memory-breakdown')) $('#memory-breakdown').innerHTML=memoryBreakdown();
  if($('#sample-warning')) $('#sample-warning').textContent=last()?.warnings?.join('；')||'';
  if($('[data-cpu-window]')) $('[data-cpu-window]').textContent=last()?.cpu?.window||'';
  updateChrome();drawCharts();
}

function requireTarget(packageRequired=true) {
  if(!state.serial) throw new Error('请先连接并选择 Android 设备，也可进入演示模式体验');
  if(packageRequired&&!/^[a-zA-Z][\w]*(?:\.[\w]+)+$/.test(state.packageName)) throw new Error('请选择目标应用或输入有效包名');
}
function stopMonitor() { state.monitoring=false;clearTimeout(state.pollTimer);state.generation++;updateChrome(); }
function stopNetworkAgent(){state.networkAgentActive=false;state.networkAgentGeneration++;clearTimeout(state.networkAgentTimer);}
function resetEvidence() {
  stopNetworkAgent();stopMonitor();state.gpuCapabilities=null;state.samples=[];state.frames=null;state.startup=null;state.compilation=null;state.benchmarkRun=null;state.layout=null;state.nodes=[];state.selectedNode=null;state.replay=false;
}
async function fetchDevices() {
  if(state.demo) return;
  const version=++state.deviceGeneration;
  try {
    const data=await api('/devices'); if(state.demo||version!==state.deviceGeneration)return;
    state.devices=data.devices;state.error='';
    const available=data.devices.filter(d=>d.state==='device');
    if(!available.some(d=>d.serial===state.serial)) { resetEvidence();state.serial=available[0]?.serial||'';state.info=null; }
    if(!available.length) state.error=data.devices.some(d=>d.state==='unauthorized')?'设备尚未授权：请在手机上允许 USB 调试，然后刷新。':'未发现已授权设备。请连接手机并开启 USB 调试；也可点击“进入演示”体验。';
    renderDeviceOptions();render();if(state.serial)await loadDevice();
  } catch(error) { if(version!==state.deviceGeneration||state.demo)return;state.error=error.message;state.devices=[];state.serial='';state.info=null;stopMonitor();renderDeviceOptions();render(); }
}
async function loadDevice() {
  const serial=state.serial;
  const results=await Promise.allSettled([api(`/device?serial=${encodeURIComponent(serial)}`),api(`/packages?serial=${encodeURIComponent(serial)}`)]);
  if(serial!==state.serial||state.demo)return;
  if(results[0].status==='fulfilled')state.info=results[0].value;else toast(results[0].reason.message,true);
  if(results[1].status==='fulfilled')$('#package-list').innerHTML=results[1].value.packages.map(pkg=>`<option value="${esc(pkg)}"></option>`).join('');else toast(results[1].reason.message,true);
  render();
}
async function toggleDemo() {
  if(state.busy.size)throw new Error('请等待当前采集任务完成后切换模式');
  resetEvidence();state.deviceGeneration++;state.demo=!state.demo;state.error='';
  state.network=null;state.networkFilter='';
  if(state.demo){state.serial=DEMO_DEVICE.serial;state.packageName=DEMO_PACKAGE;state.info=DEMO_DEVICE;state.samples=demoHistory();state.frames=demoFrames(state.budget);state.startup=demoStartup();state.layout=demoLayout();state.nodes=buildNodes(state.layout.xml);state.selectedNode=0;state.layoutRoot=null;state.network={source:'demo',rows:parseHar(DEMO_HAR)};renderDeviceOptions();render();}
  else {state.serial='';state.packageName=localStorage.getItem('apw-package')||'';state.info=null;renderDeviceOptions();render();await fetchDevices();}
}
async function sampleOnce(generation=state.generation) {
  requireTarget();
  const sample=state.demo?demoSample(state.samples.length):await api(`/metrics?${query()}`);
  if(generation!==state.generation)return;
  if(!state.demo&&!sample.cpu&&!sample.memory&&!sample.battery)throw new Error(sample.warnings.join('；')||'无法读取设备指标');
  state.samples.push(sample);if(state.samples.length>1800)state.samples.shift();updateLive();
}
async function startMonitor() {
  if(state.monitoring)return;requireTarget();
  if(state.replay){state.samples=[];state.replay=false;}
  state.monitoring=true;const generation=++state.generation;render();
  const poll=async()=>{try{await sampleOnce(generation);}catch(error){if(generation!==state.generation)return;stopMonitor();state.error=error.message;toast(error.message,true);render();return;}
    if(state.monitoring&&generation===state.generation)state.pollTimer=setTimeout(poll,state.interval);
  };await poll();
}
async function task(key,work) {
  if(state.busy.has(key))return;state.busy.add(key);render();
  try{return await work();}finally{state.busy.delete(key);render();}
}
async function refreshSessions(){state.sessions=(await api('/sessions')).sessions;}
async function save(kind) {
  const payload={monitor:{samples:state.samples},frames:state.frames,startup:state.startup,layout:state.layout,network:state.network,apk:state.apk,battery:state.battery?{source:state.battery.source,packageName:state.battery.packageName,snapshot:state.battery,before:state.batteryEndCaptured?state.batteryBefore:null}:null}[kind];
  if(!payload||(kind==='monitor'&&!state.samples.length))throw new Error('尚无可保存的数据');
  const source=kind==='monitor'?state.samples[0].source:payload.source;
  const packageName=kind==='monitor'?payload.samples[0]?.packageName||'':payload.packageName||'';
  await api('/sessions',{kind,source:source||'import',name:`${routes.find(r=>r[0]===kind)?.[1]} · ${packageName||(kind==='layout'?'前台窗口':'离线分析')}`,packageName,payload});
  await refreshSessions();toast('记录已保存在本机');render();
}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);}
function pickFile(handler,accept='.json') {importHandler=handler;$('#file-input').accept=accept;$('#file-input').value='';$('#file-input').click();}
function showDialog(title,html) {$('#dialog-title').textContent=title;$('#dialog-content').innerHTML=html;$('#detail-dialog').showModal();}
function showFrameThreadSummary(){
 const r=state.frameThreadResult;if(!r||r.sessionId!==state.traceResult?.sessionId)throw new Error('追踪会话已更换，请重新读取帧记录');
 if($('#detail-dialog').open)$('#detail-dialog').close();
 showDialog('帧期间的进程线程状态',`<p class="hint">仅查询帧所属 UPID 的已记录线程状态，并按帧时间区间裁剪。线程可能并行，累计时长不能相加为帧耗时；时间重叠不证明导致卡顿。${r.summaryTruncated||r.intervalsTruncated?'结果已截断。':''}</p>${r.summary.length?`<div class="table-wrap"><table><thead><tr><th>线程 / TID</th><th>UTID</th><th>状态</th><th>累计耗时</th><th>区间数</th><th></th></tr></thead><tbody>${r.summary.map((x,i)=>`<tr><td>${esc(x.thread||'未知')} / ${esc(x.tid)}</td><td>${esc(x.utid)}</td><td>${esc(x.state||'未知')}</td><td>${fmt(Number(x.durationNs)/1e6,3)} ms</td><td>${x.count}</td><td><button class="button small" data-frame-state="${i}">查看区间</button></td></tr>`).join('')}</tbody></table></div>`:empty('没有可用线程状态','追踪可能缺少调度数据或进程关联。','cpu')}`);
}
async function showFrameStateIntervals(index){
 const r=state.frameThreadResult;if(!r||r.sessionId!==state.traceResult?.sessionId)throw new Error('追踪会话已更换，请重新读取帧记录');
 const selected=r.summary[index];if(!selected)throw new Error('线程状态不存在');
 const detail=await api('/trace/frame-thread-states',{sessionId:r.sessionId,upid:r.upid,utid:selected.utid,state:selected.state,startNs:r.startNs,endNs:r.endNs});if(r.sessionId!==state.traceResult?.sessionId)throw new Error('追踪会话已更换，请重新读取帧记录');state.frameStateIntervals=detail.intervals;const matches=detail.intervals.map((row,i)=>({row,i}));
 if($('#detail-dialog').open)$('#detail-dialog').close();
 showDialog('线程状态区间',`<div class="toolbar"><button class="button small" data-frame-state-return>返回线程状态</button></div><p class="hint">${esc(selected.thread||'未知线程')} · TID ${esc(selected.tid)} · UTID ${esc(selected.utid)} · 状态 ${esc(selected.state||'未知')}。区间已裁剪至帧范围；按所选线程和状态查询最早的 1,000 个区间${detail.intervalsTruncated?'，结果已截断':''}。</p>${matches.length?`<table><thead><tr><th>起始纳秒</th><th>耗时</th><th></th></tr></thead><tbody>${matches.map(({row,i})=>`<tr><td class="mono">${esc(row.tsNs)}</td><td>${fmt(Number(row.durationNs)/1e6,3)} ms</td><td><button class="button small" data-frame-state-trace="${i}">查看追踪</button></td></tr>`).join('')}</tbody></table>`:empty('没有已读取的区间','区间可能已截断或追踪数据不完整。','trace')}`);
}
function inspectSession(session) {
  showDialog(session.name,`<div class="toolbar">${sourceTag(session.source)}<span class="subtle">${date(session.timestamp)}</span><span class="spacer"></span>${button('replay-session','载入分析','play')}${button('export-session','导出 JSON','download')}</div><div class="hint" style="margin-bottom:15px">类型：${esc(session.kind)}　·　应用：${esc(session.packageName||'—')}　·　数据版本：${session.schemaVersion}</div><pre>${esc(JSON.stringify({...session,payload:session.kind==='monitor'?{sampleCount:session.payload.samples.length,first:session.payload.samples[0],last:session.payload.samples.at(-1)}:session.kind==='layout'?{...session.payload,screenshot:session.payload.screenshot?'[PNG 图像数据]':null}:session.payload},null,2).slice(0,30000))}</pre>`);
  $('#dialog-content [data-action=export-session]').onclick=()=>download(new Blob([JSON.stringify(session,null,2)],{type:'application/json'}),`apw-${session.kind}-${session.id}.json`);
  $('#dialog-content [data-action=replay-session]').onclick=async()=>{try{await replaySession(session);$('#detail-dialog').close();}catch(error){toast(error.message,true);}};
}
async function replaySession(session) {
  stopNetworkAgent();
  if(state.busy.size)throw new Error('请等待当前采集任务完成后载入记录');
  const {kind,payload}=session;
  if(!payload||!['monitor','frames','startup','layout','network','apk','battery','benchmark'].includes(kind))throw new Error('此记录暂不支持载入');
  if(kind==='monitor'&&(!Array.isArray(payload.samples)||payload.samples.length>1800))throw new Error('监控样本格式无效或超过 1,800 条');
  if(kind==='layout'){state.nodes=buildNodes(payload.xml);state.selectedNode=state.nodes.length?0:null;state.layoutRoot=null;}
  stopMonitor();state.replay=true;let replayWarning='';
  if(kind==='monitor')state.samples=payload.samples;else if(kind==='benchmark')state.current=payload;else state[kind]=payload;
  if(kind==='battery'){
    state.battery=payload.snapshot||payload;state.batteryBefore=payload.snapshot?payload.before||null:null;state.batteryEndCaptured=!!state.batteryBefore;state.batteryDelta=null;
    if(state.batteryBefore)try{state.batteryDelta=await api('/battery/compare',{before:state.batteryBefore,after:state.battery});}catch(error){replayWarning=`实验已载入，但快照不可比较：${error.message}`;}
  }
  if(kind==='frames')state.budget=payload.budgetMs;
  if(kind==='startup')state.compilation=null;
  if(kind==='apk'){state.apkTab='overview';state.apkFilter='';state.apkCategory='all';}
  location.hash=kind;state.route=kind;render();toast(replayWarning||'已载入保存记录；开始新采集会使用当前所选设备',!!replayWarning);
}

function showBinderResults(){const r=state.binderResult,ms=v=>`${fmt(Number(v)/1e6,3)} ms`;showDialog('Binder 事务',`<p class="hint">${r.packageName?`进程范围：${esc(r.packageName)}（${r.direction==='client'?'客户端':r.direction==='server'?'服务端':'任一端'}）；`:''}Perfetto 从追踪中识别的 Binder 事务，按客户端耗时排序，最多 500 条${r.truncated?'（已截断）':''}。异步事务的客户端时间不是服务端执行时间；缺少事件或 AIDL 名称时结果不完整，不能据此断定根因。</p>${r.transactions.length?`<div class="table-wrap"><table><thead><tr><th>客户端 / TID</th><th>服务端 / TID</th><th>接口</th><th>类型</th><th>客户端 / 服务端耗时</th><th></th></tr></thead><tbody>${r.transactions.map((x,i)=>`<tr><td>${esc(x.client||'未知')} / ${esc(x.clientTid||'—')}</td><td>${esc(x.server||'未知')} / ${esc(x.serverTid||'—')}</td><td>${esc(x.aidl||'未报告')}</td><td>${x.sync===null?'未知':x.sync?'同步':'异步'}</td><td>${ms(x.durationNs)} / ${x.serverDurationNs===null?'—':ms(x.serverDurationNs)}</td><td><button class="button small" data-binder-trace="${i}">查看追踪</button>${x.sync&&x.id?` <button class="button small" data-binder-breakdown="${i}">阶段分解</button>`:''}</td></tr>`).join('')}</tbody></table></div>`:empty('没有可识别的 Binder 事务','追踪可能不包含 Binder 事件。','trace')}`);}

const actions={
  'trace-binder':()=>{const sessionId=state.traceResult?.sessionId;if(!sessionId)throw new Error('请先导入追踪');state.binderScope=$('#binder-scope').value;state.binderDirection=$('#binder-direction').value;const packageName=state.binderScope==='target'?state.packageName:null,direction=state.binderDirection;return task('trace',async()=>{const r=await api('/trace/binder',{sessionId,packageName,direction});state.binderResult={...r,sessionId,packageName,direction};showBinderResults();});},
  'source-choose':async()=>{const path=await window.desktop.selectSourceDir();if(path)$('#source-path').value=path;},
  'source-create':()=>{const path=$('#source-path').value.trim();return task('source',async()=>{const snapshot=await api('/source/snapshot',{path});await refreshSource();state.sourceSnapshot=snapshot;state.sourceMatches=null;state.sourceFile=null;state.sourceLine=null;toast(`快照已创建，包含 ${snapshot.files.length} 个源码文件`);});},
  'source-remote':()=>{const url=$('#source-url').value.trim(),ref=$('#source-ref').value.trim();return task('source',async()=>{const snapshot=await api('/source/remote',{url,ref});await refreshSource();state.sourceSnapshot=snapshot;state.sourceMatches=null;state.sourceFile=null;state.sourceLine=null;toast(`远程快照已创建，提交 ${snapshot.commit.slice(0,12)}`);});},
  'source-refresh':()=>task('source',async()=>{await refreshSource();toast('源码快照列表已刷新');}),
  'source-search':()=>{const query=$('#source-query').value;return task('source',()=>doSourceSearch(query));},
  'source-resolve':()=>{const query=$('#source-query').value;return task('source',()=>doSourceResolve(query));},
  'source-prev':()=>{state.sourceLine=Math.max(1,(state.sourceLine||1)-200);render();},
  'source-next':()=>{state.sourceLine=(state.sourceLine||1)+200;render();},
  'read-compilation':()=>{requireTarget();if(state.demo)throw new Error('请连接真实设备后读取');return task('startup',async()=>{state.compilation=await api(`/compilation?${query()}`);toast(state.compilation.available?'已读取编译状态':`编译状态不可用：${state.compilation.reason}`,!state.compilation.available);});},
  'heap-destroyed-activities':()=>task('heap',browseDestroyedActivities),
  'heap-bitmaps':()=>browseBitmaps(),
  'heap-bitmap-duplicates':()=>task('heap',browseDuplicateBitmaps),
  'heap-string-duplicates':()=>task('heap',browseDuplicateStrings),
  'heap-string-search':()=>browseHeapStringSearch(),
  'heap-dominators':()=>browseHeapDominators(),
  'save-benchmark-baseline':()=>saveBenchmark('baseline'),
  'benchmark-run':()=>{requireTarget(false);const component=$('#benchmark-component').value.trim(),testClass=$('#benchmark-class').value.trim(),serial=state.serial;state.benchmarkComponent=component;state.benchmarkClass=testClass;const testPackage=component.split('/')[0];if(/^[a-zA-Z][\w]*(?:\.[\w]+)+$/.test(testPackage))state.benchmarkReportPath=`/sdcard/Android/media/${testPackage}/${testPackage}-benchmarkData.json`;return task('benchmark-run',async()=>{const result=await api('/benchmark/run',{serial,component,testClass});if(state.serial!==serial){toast('测试已结束；设备选择已更改，结果未载入当前界面');return;}state.benchmarkRun=result;toast(result.status==='completed'?'测试运行完成；请核对设备报告':'运行结束，请检查 instrumentation 输出',result.status!=='completed');});},
  'benchmark-read-report':()=>{requireTarget(false);const path=$('#benchmark-report-path').value.trim(),serial=state.serial;state.benchmarkReportPath=path;return task('benchmark-report',async()=>{const result=await api('/benchmark/report',{serial,path});const parsed=parseBenchmark(result.report);if(state.serial!==serial){toast('设备选择已更改，报告未载入当前界面');return;}state.current={...parsed,source:'import',fileName:path.split('/').at(-1),timestamp:result.timestamp,origin:{kind:'device',serial,path,readAt:result.timestamp}};toast('设备报告已读取，请核对是否为本次测试');});},
  'save-benchmark-current':()=>saveBenchmark('current'),
  'load-benchmark-baseline':()=>loadBenchmark('baseline'),
  'load-benchmark-current':()=>loadBenchmark('current'),
  'export-benchmark':()=>{if(!state.baseline||!state.current)throw new Error('请先载入两份运行');const report={schemaVersion:1,kind:'benchmark-comparison',timestamp:Date.now(),baseline:state.baseline,current:state.current,contextWarnings:benchmarkContextWarnings(state.baseline,state.current),rows:compareBenchmarks(state.baseline,state.current),note:'描述性差异，不推断统计显著性或优劣。'};download(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),`benchmark-comparison-${Date.now()}.json`);},
  'load-startup-trace':()=>{const trace=state.traceResult,packageName=$('#startup-trace-scope').value==='target'?state.packageName:null;if(!trace?.sessionId)throw new Error('请先导入追踪');return task('trace',async()=>{const result=await api('/trace/startups',{sessionId:trace.sessionId,packageName});state.startupTrace={...result,sessionId:trace.sessionId,fileName:trace.fileName,packageName};toast(result.startups.length?`读取 ${result.startups.length} 条启动记录`:'追踪中没有启动记录');});},
  'load-frame-timeline':()=>{const trace=state.traceResult,packageName=$('#frame-timeline-scope').value==='target'?state.packageName:null;if(!trace?.sessionId)throw new Error('请先导入追踪');return task('trace',async()=>{const result=await api('/trace/frame-timeline',{sessionId:trace.sessionId,packageName});state.frameTimeline={...result,sessionId:trace.sessionId,fileName:trace.fileName,packageName};toast(result.frames.length?`读取 ${result.frames.length} 条 FrameTimeline 记录`:'追踪中没有 FrameTimeline 记录');});},
  'gpu-capabilities':()=>{requireTarget(false);if(state.demo)throw new Error('请连接真实设备');const serial=state.serial;return task('gpu',async()=>{const result=await api('/gpu/capabilities',{serial});if(serial===state.serial){state.gpuCapabilities=result;toast('设备报告已读取');}});},
  'select-agi':async()=>{const path=await window.desktop.selectAgi();if(path){state.agiPath=path;render();toast('已设置 AGI 程序');}},
  'launch-agi':async()=>{await window.desktop.launchAgi();toast('已请求启动 AGI');},
  'import-gpu':()=>{if(state.busy.has('gpu'))return;$('#gpu-input').value='';$('#gpu-input').click();},
  'refresh-gpu':()=>task('gpu',async()=>{await refreshGpu();toast('GPU 产物列表已刷新');}),
  'save-battery':()=>save('battery'),
  'battery-history-before':()=>loadBatteryHistory(true),
  'battery-history-after':()=>loadBatteryHistory(false),
  'battery-clear-before':()=>{state.batteryBefore=null;state.batteryDelta=null;state.batteryEndCaptured=false;render();},
  'battery-baseline':()=>{requireTarget();if(state.demo)throw new Error('请连接真实设备后采集');return task('battery',async()=>{const snapshot=await api('/battery/snapshot',{serial:state.serial,packageName:state.packageName});state.batteryBefore=snapshot;state.battery=snapshot;state.batteryDelta=null;state.batteryEndCaptured=false;toast('基线快照已采集');});},
  'battery-current':()=>{requireTarget();if(state.demo)throw new Error('请连接真实设备后采集');return task('battery',async()=>{const snapshot=await api('/battery/snapshot',{serial:state.serial,packageName:state.packageName});state.battery=snapshot;state.batteryDelta=null;state.batteryEndCaptured=true;try{state.batteryDelta=await api('/battery/compare',{before:state.batteryBefore,after:snapshot});toast('结束快照已采集并比较');}catch(error){toast(`快照已采集，无法比较：${error.message}`,true);}});},
  'import-battery':()=>{if(!state.packageName)throw new Error('请先填写目标应用包名');pickFile(async text=>task('battery',async()=>{state.battery=await api('/battery/import',{text,packageName:state.packageName});state.batteryBefore=null;state.batteryDelta=null;state.batteryEndCaptured=false;toast('电池统计已导入');}),'.txt,.csv');},

  'choose-apk':()=>{if(state.busy.has('apk'))return;$('#apk-input').value='';$('#apk-input').click();},
  'save-apk':()=>save('apk'),
  'export-apk':()=>{const p=state.apk;if(!p)throw new Error('请先分析 APK');download(new Blob([JSON.stringify({schemaVersion:1,kind:'apk',source:p.source,name:`APK 分析 · ${p.packageName}`,packageName:p.packageName,timestamp:p.timestamp,payload:p},null,2)],{type:'application/json'}),`${p.fileName.replace(/\.apk$/i,'')}.apk-report.json`);},
  'start-monitor':startMonitor,
  'stop-monitor':()=>{stopMonitor();render();toast('采集已停止，可保存当前记录');},
  'sample-once':()=>task('sample',async()=>{if(state.replay){state.samples=[];state.replay=false;}await sampleOnce();toast('已采集一个样本');}),
  'capture-frames':()=>{requireTarget();return task('frames',async()=>{state.frames=state.demo?demoFrames(state.budget):await api(`/frames?${query()}&budget=${state.budget}`);toast(state.frames.count?`读取 ${state.frames.count} 个有效帧`:'缓冲区没有有效帧，请先在设备上操作目标应用');});},
  'reset-frames':()=>{requireTarget();return task('frames',async()=>{if(!state.demo)await api('/frames/reset',{serial:state.serial,packageName:state.packageName});state.frames=null;toast('帧统计已重置，请在目标应用中重现操作后读取');});},
  'run-startup':()=>{requireTarget();const n=Number($('#startup-runs').value);if(!Number.isInteger(n)||n<1||n>10)throw new Error('重复次数须为 1–10 的整数');state.runs=n;state.startupMode=$('#startup-mode').value;return task('startup',async()=>{state.startup=state.demo?demoStartup(state.startupMode,n):await api('/startup',{serial:state.serial,packageName:state.packageName,mode:state.startupMode,runs:n});toast('启动实验已完成');});},
  'layout-load-current':()=>loadLayoutHistory(false),
  'layout-load-baseline':()=>loadLayoutHistory(true),
  'layout-baseline':()=>{if(!state.layout)throw new Error('请先采集或导入快照');state.layoutBaseline={timestamp:state.layout.timestamp,source:state.layout.source,nodes:structuredClone(state.nodes)};render();toast('当前层级已设为基线；采集或导入另一快照后可比较');},
  'layout-clear-baseline':()=>{state.layoutBaseline=null;render();},
  'layout-export-diff':()=>{if(!state.layoutBaseline||!state.layout)throw new Error('请先选择两份布局快照');const report=layoutComparisonReport(state.layoutBaseline,{...state.layout,nodes:state.nodes});download(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),`layout-comparison-${Date.now()}.json`);},
  'layout-isolate':()=>{if(state.selectedNode===null)throw new Error('请先选择节点');state.layoutRoot=state.selectedNode;render();},
  'layout-reset':()=>{state.layoutRoot=null;render();},
  'capture-layout':()=>{requireTarget(false);return task('layout',async()=>{const layout=state.demo?demoLayout():await api('/layout',{serial:state.serial}),nodes=buildNodes(layout.xml);state.layout=layout;state.nodes=nodes;state.selectedNode=nodes.length?0:null;state.layoutRoot=null;toast(`已读取 ${state.nodes.length} 个可访问性节点`);});},
  'cpu-time-reset':()=>{state.cpuProfile=state.cpuOriginal;state.cpuBin=null;state.cpuRange=null;state.cpuThreadFilter=null;state.cpuFocus=[];render();},
  'cpu-time-apply':()=>{if(!$('#cpu-time-start').value||!$('#cpu-time-end').value)throw new Error('请输入起始和结束时间');const start=Number($('#cpu-time-start').value),end=Number($('#cpu-time-end').value);const profile=profileForTimeRange(state.cpuTimeline,start,end,state.cpuThreadFilter);state.cpuProfile={...profile,fileName:state.cpuOriginal.fileName};state.cpuBin=null;state.cpuRange={start,end};state.cpuFocus=[];render();},
  'cpu-flame-back':()=>{state.cpuFocus.pop();render();},
  'cpu-flame-reset':()=>{state.cpuFocus=[];render();},
  'refresh-cpu-archives':()=>task('cpu-profile',async()=>{state.cpuArchives=(await api('/cpu-profile/archives')).archives;toast('采样档案已刷新');}),
  'save-cpu-archive':()=>{const file=state.cpuPerfFile;if(!file)throw new Error('请先导入采样');return task('cpu-profile',async()=>{const name=(file.name||'capture.perf.data').slice(0,230)+'.trace';const response=await fetch('/api/cpu-profile/archive',{method:'POST',headers:{'X-Workbench-Token':token,'X-File-Name':encodeURIComponent(name)},body:file});const result=await response.json();if(!response.ok)throw new Error(result.error||'保存失败');state.cpuArchives=(await api('/cpu-profile/archives')).archives;toast('采样已保存到本机');});},
  'load-cpu-archive':()=>{const id=$('#cpu-archive').value,meta=state.cpuArchives.find(x=>x.id===id),symfs=state.cpuSymfs.trim();if(!meta)throw new Error('请选择本机采样');return task('cpu-profile',async()=>{const blob=await api('/cpu-profile/archive/load',{id},true);await applyPerfEvent(new File([blob],meta.name.replace(/\.trace$/i,'')),null,symfs);toast('采样已校验并载入');});},
  'import-perf':()=>{if(state.busy.has('cpu-profile'))return;$('#perf-input').value='';$('#perf-input').click();},
  'cpu-symfs-choose':async()=>{const path=await window.desktop.selectSourceDir();if(path){state.cpuSymfs=path;render();}},
  'cpu-symfs-apply':()=>{if(!state.cpuPerfFile)throw new Error('请先导入 perf.data');return loadPerfEvent(state.cpuPerfFile,state.cpuEvent);},
  'cpu-event-apply':()=>{const name=$('#cpu-event').value;if(!state.cpuPerfFile||!state.cpuEvents.some(e=>e.name===name))throw new Error('请选择有效采样事件');return loadPerfEvent(state.cpuPerfFile,name);},
  'import-cpu-stacks':()=>pickFile(async(text,file)=>{state.cpuPerfFile=null;state.cpuEvents=[];state.cpuEvent=null;state.cpuEventsTruncated=false;state.cpuProfile={...parseFoldedStacks(text),fileName:file.name};state.cpuOriginal=state.cpuProfile;state.cpuTimeline=null;state.cpuBin=null;state.cpuRange=null;state.cpuThreadFilter=null;state.cpuFilter='';state.cpuFocus=[];render();toast('调用栈已导入');}),
  'capture-cpu-profile':()=>{requireTarget();if(state.demo)throw new Error('请连接真实设备后采集');const seconds=Number($('#cpu-profile-seconds').value),symfs=state.cpuSymfs.trim();return task('cpu-profile',async()=>{const blob=await api('/cpu-profile',{serial:state.serial,packageName:state.packageName,seconds},true),fileName=`cpu-${Date.now()}.perf.data`;download(blob,fileName);try{await applyPerfEvent(new File([blob],fileName),null,symfs);toast('CPU 采样已下载并载入分析');}catch(error){toast(`CPU 采样已下载，但载入失败：${error.message}`,true);}});},
  'choose-heap':()=>{if(state.busy.has('heap'))return;state.heapRole='current';$('#heap-input').value='';$('#heap-input').click();},
  'choose-heap-baseline':()=>{if(state.busy.has('heap'))return;state.heapRole='baseline';$('#heap-input').value='';$('#heap-input').click();},
  'heap-view-classes':()=>{state.heapView='classes';render();},
  'heap-view-compare':()=>{if(state.heapBaseline){state.heapView='compare';render();}},
  'capture-heap':()=>{requireTarget();if(state.demo)throw new Error('请连接真实设备后采集');return task('heap',async()=>{const blob=await api('/heap',{serial:state.serial,packageName:state.packageName},true);download(blob,`heap-${Date.now()}.hprof`);toast('堆快照已下载');});},
  'trace-thread-states':()=>{const raw=$('#trace-tid').value;if(!/^\d+$/.test(raw))throw new Error('请输入线程 TID');return readTraceThreadStates(Number(raw));},
  'trace-window-apply':()=>changeTraceWindow(),
  'trace-window-reset':()=>changeTraceWindow(true),
  'refresh-trace-archives':()=>task('trace',async()=>{state.traceArchives=(await api('/trace/archives')).archives;toast('追踪档案已刷新');}),
  'save-trace-archive':()=>{const trace=state.traceResult;if(!trace?.sessionId)throw new Error('请先导入追踪');return task('trace',async()=>{await api('/trace/archive',{sessionId:trace.sessionId,name:(trace.fileName||'capture').slice(0,240)});state.traceArchives=(await api('/trace/archives')).archives;toast('追踪已保存到本机');});},
  'load-trace-archive':()=>{const id=$('#trace-archive').value;if(!id)throw new Error('请选择本机追踪');return task('trace',async()=>{state.traceResult=await api('/trace/archive/load',{id});state.frameTimeline=null;toast('已校验并载入追踪');});},
  'import-trace':()=>{if(state.busy.has('trace'))return;$('#trace-input').value='';$('#trace-input').click();},
  'export-trace':()=>{const trace=state.traceResult;if(!trace?.sessionId)throw new Error('请先导入追踪');return task('trace',async()=>{const blob=await api('/trace/export',{sessionId:trace.sessionId},true);const name=(trace.fileName||'capture.trace').replace(/[\\/\x00-\x1f\x7f]/g,'_');download(blob,name);toast('已导出原始追踪');});},
  'capture-trace':()=>{requireTarget(false);if(state.demo)throw new Error('请连接真实设备后录制追踪');const seconds=Number($('#trace-seconds').value),mode=$('#trace-mode').value,packageName=state.traceIncludeApp?state.packageName:null;if(packageName!==null)requireTarget();return task('trace',async()=>{const blob=await api('/trace',{serial:state.serial,seconds,mode,packageName},true),fileName=`capture-${Date.now()}.perfetto-trace`;download(blob,fileName);try{const response=await fetch('/api/trace/analyze',{method:'POST',headers:{'X-Workbench-Token':token},body:blob});const result=await response.json();if(!response.ok)throw new Error(result.error||'追踪分析失败');state.traceResult={...result,fileName};state.frameTimeline=null;toast('追踪已下载并载入分析');}catch(error){toast(`追踪已下载，但无法载入分析：${error.message}`,true);}});},
  'save-monitor':()=>save('monitor'),'save-frames':()=>save('frames'),'save-startup':()=>save('startup'),'save-layout':()=>save('layout'),'save-network':()=>save('network'),
  'refresh-sessions':async()=>{await refreshSessions();render();toast('记录列表已刷新');},
  'network-agent-package':async()=>{const blob=await api('/network/agent-package',undefined,true);download(blob,'android-performance-agent.zip');toast('Agent 源码包已准备下载');},
  'network-agent-start':()=>startNetworkAgent(),
  'network-agent-stop':()=>{stopNetworkAgent();render();},
  'import-har':()=>pickFile(async(text,file)=>{stopNetworkAgent();state.network={source:'import',fileName:file.name,rows:parseHar(JSON.parse(text))};state.networkFilter='';state.route='network';location.hash='network';render();toast(`已导入 ${state.network.rows.length} 条请求，敏感字段已丢弃`);},'.har,.json'),
  'import-baseline':()=>importBenchmark('baseline'),'import-current':()=>importBenchmark('current'),
  'import-session':()=>pickFile(async text=>{const doc=JSON.parse(text);if(doc.schemaVersion!==1||!doc.payload)throw new Error('不是受支持的工作台采集记录（schemaVersion: 1）');await api('/sessions',{...doc,source:['demo','adb','import'].includes(doc.source)?doc.source:'import'});await refreshSessions();state.route='sessions';location.hash='sessions';render();toast('采集记录已导入本机档案');}),
  'import-layout':()=>pickFile(async text=>{const nodes=buildNodes(text);state.layout={source:'import',timestamp:Date.now(),xml:text,screenshot:null};state.nodes=nodes;state.selectedNode=0;state.layoutRoot=null;render();toast('层级 XML 已导入');},'.xml'),
  'import-frames':()=>pickFile(async text=>{const response=await importFramesLocally(text);state.frames=response;render();toast(`导入 ${response.count} 个有效帧`);},'.txt'),
};
function importBenchmark(key){pickFile(async(text,file)=>{state[key]={...parseBenchmark(JSON.parse(text)),source:'import',fileName:file.name,timestamp:Date.now()};render();toast(`${key==='baseline'?'基线':'当前运行'}已导入`);});}
async function saveBenchmark(key){const payload=state[key];if(!payload)throw new Error('请先导入运行');await api('/sessions',{kind:'benchmark',source:'import',name:`基准运行 · ${payload.fileName}`,payload});await refreshSessions();render();toast('基准运行已保存');}
async function loadBenchmark(key){const id=$(`#benchmark-history-${key}`).value;if(!id)throw new Error('请选择历史记录');const saved=await api(`/sessions/${id}`);if(saved.kind!=='benchmark')throw new Error('记录类型不正确');state[key]=saved.payload;render();toast('已载入基准运行');}
// Keep gfxinfo parsing on the server for device and file inputs alike.
async function importFramesLocally(text){return api('/frames/import',{text,budget:state.budget});}

document.addEventListener('click',async event=>{
  const sourceSymbol=event.target.closest('[data-source-symbol]');if(sourceSymbol){try{await task('source',async()=>{if(!state.sourceSnapshot){await refreshSource();if(!state.sourceSnapshots.length)throw new Error('请先在源码工作区创建快照');state.sourceSnapshot=await api('/source/files',{id:state.sourceSnapshots[0].id});}const symbol=sourceSymbol.dataset.sourceSymbol;if(symbol.includes('::'))await doSourceSearch(symbol);else await doSourceResolve(symbol);state.route='source';location.hash='source';toast(symbol.includes('::')?'已按原生符号文本搜索':'已生成声明候选，请核对源码');});}catch(error){toast(error.message,true);}return;}
  const sourceMatch=event.target.closest('[data-source-match]');if(sourceMatch){try{const m=state.sourceMatches.matches[Number(sourceMatch.dataset.sourceMatch)];await openSourceFile(m.path,m.line);}catch(error){toast(error.message,true);}return;}
  const sourceFile=event.target.closest('[data-source-file]');if(sourceFile){try{const item=state.sourceSnapshot.files[Number(sourceFile.dataset.sourceFile)];await openSourceFile(item.path);}catch(error){toast(error.message,true);}return;}
  const deadlineCluster=event.target.closest('[data-deadline-cluster]');if(deadlineCluster&&state.frameTimeline){const cluster=clusterFrameTimeline(state.frameTimeline.frames)[Number(deadlineCluster.dataset.deadlineCluster)];if(cluster)showDialog('Deadline Missed 记录',`<p class="hint">同一轨道的系统报告记录；不代表问题根因。</p><pre>${esc(JSON.stringify(cluster.indices.map(i=>state.frameTimeline.frames[i]),null,2))}</pre>`);return;}
  const domFilter=event.target.closest('[data-heap-dom-filter]');if(domFilter){try{await browseHeapDominators([],0,!state.heapDominator.excludeNonStrong);}catch(error){toast(error.message,true);}return;}
  const domChild=event.target.closest('[data-heap-dom-child]');if(domChild){try{await browseHeapDominators([...state.heapDominator.path,domChild.dataset.heapDomChild]);}catch(error){toast(error.message,true);}return;}
  const domUp=event.target.closest('[data-heap-dom-up]');if(domUp){try{await browseHeapDominators(state.heapDominator.path.slice(0,-1));}catch(error){toast(error.message,true);}return;}
  const domPage=event.target.closest('[data-heap-dom-page]');if(domPage){try{await browseHeapDominators(state.heapDominator.path,Number(domPage.dataset.heapDomPage));}catch(error){toast(error.message,true);}return;}
  const domReturn=event.target.closest('[data-heap-dom-return]');if(domReturn){try{await browseHeapDominators(state.heapDominator.path,state.heapDominator.offset);}catch(error){toast(error.message,true);}return;}
  const domObject=event.target.closest('[data-heap-dom-object]');if(domObject){try{await browseHeapObject(domObject.dataset.heapDomObject);}catch(error){toast(error.message,true);}return;}
  const cpuSymbol=event.target.closest('[data-cpu-symbol]');if(cpuSymbol){try{showCpuCallers(cpuSymbol.dataset.cpuSymbol);}catch(error){toast(error.message,true);}return;}
  const benchmarkRow=event.target.closest('[data-benchmark-row]');if(benchmarkRow&&state.baseline&&state.current){const row=compareBenchmarks(state.baseline,state.current)[Number(benchmarkRow.dataset.benchmarkRow)];if(row){const before=state.baseline.results.filter(r=>r.key===row.key),after=state.current.results.filter(r=>r.key===row.key),summary=(label,items)=>items.map((r,i)=>{const s=benchmarkSampleSummary(r),g=s?.groups;return `<tr><td>${label}${items.length>1?' #'+(i+1):''}</td><td>${s?.count??0}</td><td>${fmt(s?.minimum,3)} / ${fmt(s?.q1,3)} / ${fmt(s?.median,3)} / ${fmt(s?.q3,3)} / ${fmt(s?.maximum,3)}</td><td>${g?`${g.nonempty} / ${g.iterations} · ${fmt(g.medianMinimum,3)}–${fmt(g.medianMaximum,3)}`:r.metricType==='sampledMetrics'?'旧记录未保留分组':'不适用'}</td><td>${r.runInfo?.warmupIterations??'—'} / ${r.runInfo?.repeatIterations??'—'} / ${r.runInfo?.thermalThrottleSleepSeconds??'—'}</td></tr>`;}).join('');const raw=JSON.stringify({baseline:before,current:after},null,2);showDialog(`${row.name} · ${row.metric}`,`<p class="hint">样本分布采用最近秩四分位数，中位数为样本中位数；与报告中位数可能不同。迭代列显示非空 / 总迭代及各迭代中位数的范围；最后一列来自报告中的预热次数、重复次数和热降频等待秒数，缺失显示为横线。样本可能相关，不能推断独立实验或统计显著性。</p><table><thead><tr><th>运行</th><th>样本数</th><th>最小 / Q1 / 中位 / Q3 / 最大</th><th>迭代 / 迭代中位数范围</th><th>预热 / 重复 / 降频等待秒</th></tr></thead><tbody>${summary('基线',before)}${summary('当前',after)}</tbody></table><p class="hint">原始数据预览${raw.length>30000?'已截断':''}。</p><pre>${esc(raw.slice(0,30000))}</pre>`);}return;}
  const frameStateReturn=event.target.closest('[data-frame-state-return]');if(frameStateReturn){try{showFrameThreadSummary();}catch(error){toast(error.message,true);}return;}
  const frameState=event.target.closest('[data-frame-state]');if(frameState){try{await showFrameStateIntervals(Number(frameState.dataset.frameState));}catch(error){toast(error.message,true);}return;}
  const frameStateTrace=event.target.closest('[data-frame-state-trace]');if(frameStateTrace){try{const r=state.frameThreadResult,row=state.frameStateIntervals?.[Number(frameStateTrace.dataset.frameStateTrace)];if(!row)throw new Error('线程状态区间不存在');$('#detail-dialog').close();await focusTraceEvent(row,r.sessionId);}catch(error){toast(error.message,true);}return;}
  const frameThreads=event.target.closest('[data-frame-threads]');if(frameThreads){try{const trace=state.traceResult,source=state.frameTimeline,frame=source?.frames[Number(frameThreads.dataset.frameThreads)];if(!frame?.processId||!trace||trace.sessionId!==source.sessionId)throw new Error('追踪会话已更换，请重新读取帧记录');const start=BigInt(frame.tsNs)>BigInt(trace.bounds.startNs)?BigInt(frame.tsNs):BigInt(trace.bounds.startNs),finish=BigInt(frame.tsNs)+BigInt(frame.durationNs),end=finish<BigInt(trace.bounds.endNs)?finish:BigInt(trace.bounds.endNs);if(end<=start)throw new Error('帧时间不在追踪范围内');await task('trace',async()=>{const r=await api('/trace/frame-thread-states',{sessionId:source.sessionId,upid:frame.processId,startNs:String(start),endNs:String(end)});state.frameThreadResult={...r,sessionId:source.sessionId,upid:frame.processId,startNs:String(start),endNs:String(end)};showFrameThreadSummary();});}catch(error){toast(error.message,true);}return;}
  const frameTrace=event.target.closest('[data-frame-trace]');if(frameTrace){try{const frame=state.frameTimeline?.frames[Number(frameTrace.dataset.frameTrace)];if(frame)await focusTraceEvent(frame,state.frameTimeline.sessionId);}catch(error){toast(error.message,true);}return;}
  const binderReturn=event.target.closest('[data-binder-return]');if(binderReturn){if(state.binderResult?.sessionId===state.traceResult?.sessionId){$('#detail-dialog').close();showBinderResults();}else toast('追踪会话已更换，请重新读取事务',true);return;}
  const binderBreakdown=event.target.closest('[data-binder-breakdown]');if(binderBreakdown){try{const result=state.binderResult,row=result?.transactions[Number(binderBreakdown.dataset.binderBreakdown)];if(!row||!row.id||result.sessionId!==state.traceResult?.sessionId)throw new Error('追踪会话已更换，请重新读取事务');await task('trace',async()=>{const r=await api('/trace/binder-breakdown',{sessionId:result.sessionId,id:row.id}),duration=v=>`${fmt(Number(v)/1e6,3)} ms`;$('#detail-dialog').close();showDialog('Binder 同步事务阶段',`<div class="toolbar"><button class="button small" data-binder-return>返回事务列表</button></div><p class="hint">Perfetto 根据追踪中的客户端和服务端线程状态对同步事务做区间分类；缺失事件可能导致结果不完整，分类不能单独证明根因。${r.summaryTruncated||r.intervalsTruncated?'结果已截断。':''}</p>${r.summary.length?`<table><thead><tr><th>侧</th><th>分类</th><th>累计耗时</th><th>区间数</th></tr></thead><tbody>${r.summary.map(x=>`<tr><td>${esc(x.side)}</td><td>${esc(x.reason||'未知')}</td><td>${duration(x.durationNs)}</td><td>${x.count}</td></tr>`).join('')}</tbody></table><h3>时间区间（前 100 条）</h3><table><thead><tr><th>侧</th><th>分类</th><th>起始纳秒</th><th>耗时</th></tr></thead><tbody>${r.intervals.slice(0,100).map(x=>`<tr><td>${esc(x.side)}</td><td>${esc(x.reason||'未知')}</td><td>${esc(x.tsNs)}</td><td>${duration(x.durationNs)}</td></tr>`).join('')}</tbody></table>`:empty('没有可用的阶段数据','追踪可能缺少线程状态或 Binder 配对信息。','trace')}`);});}catch(error){toast(error.message,true);}return;}
  const binderTrace=event.target.closest('[data-binder-trace]');if(binderTrace){try{const row=state.binderResult?.transactions[Number(binderTrace.dataset.binderTrace)];if(row){$('#detail-dialog').close();await focusTraceEvent(row,state.binderResult.sessionId);}}catch(error){toast(error.message,true);}return;}
  const startupTrace=event.target.closest('[data-startup-trace]');if(startupTrace){try{const frame=state.startupTrace?.startups.find(x=>x.id===startupTrace.dataset.startupTrace);if(frame)await focusTraceEvent(frame,state.startupTrace.sessionId);}catch(error){toast(error.message,true);}return;}
  const timelineFrame=event.target.closest('[data-frame-timeline]');if(timelineFrame){const frame=state.frameTimeline?.frames[Number(timelineFrame.dataset.frameTimeline)];if(frame)showDialog('FrameTimeline 记录',`<p class="hint">时间与持续时间单位为纳秒，内容来自实际帧时间线。</p><pre>${esc(JSON.stringify(frame,null,2))}</pre>`);return;}
  const frameButton=event.target.closest('[data-frame]');if(frameButton){const frame=state.frames?.frames.find(row=>row.index===Number(frameButton.dataset.frame));if(frame)showDialog(`第 ${frame.index} 帧`,`<p class="hint">耗时 ${fmt(frame.durationMs,2)} ms；原始时间戳为设备单调时钟纳秒，不能直接作为墙上时间。</p><pre>${esc(JSON.stringify(frame,null,2))}</pre>`);return;}
  const frameCluster=event.target.closest('[data-frame-cluster]');if(frameCluster){const c=clusterFrames(state.frames.frames,state.frames.budgetMs).find(x=>x.first===Number(frameCluster.dataset.frameCluster));if(c)showDialog(`第 ${c.first}–${c.last} 帧`,`<p class="hint">同一 PROFILEDATA 段的连续超预算记录。</p><div class="toolbar">${state.frames.frames.filter(f=>f.index>=c.first&&f.index<=c.last).map(f=>`<button class="button small" data-frame="${f.index}">#${f.index} · ${fmt(f.durationMs,2)} ms</button>`).join('')}</div>`);return;}
  const traceThread=event.target.closest('[data-trace-thread]');if(traceThread){try{await readTraceThreadStates(Number(traceThread.dataset.traceThread));}catch(error){toast(error.message,true);}return;}
  const traceSliceArgs=event.target.closest('[data-trace-slice-args]');if(traceSliceArgs){try{const trace=state.traceResult;if(!trace?.sessionId)throw new Error('追踪会话已失效');await task('trace',async()=>{const result=await api('/trace/slice-arguments',{sessionId:trace.sessionId,sliceId:traceSliceArgs.dataset.traceSliceArgs});if($('#detail-dialog').open)$('#detail-dialog').close();showDialog('切片事件参数',`<p class="hint">值由 Trace Processor 格式化，参数来自追踪记录；最多显示 200 条。${result.truncated?' 已截断。':''}</p>${result.args.length?`<div class="table-wrap"><table><thead><tr><th>名称</th><th>类型</th><th>值</th></tr></thead><tbody>${result.args.map(a=>`<tr><td>${esc(a.key)}</td><td>${esc(a.type)}</td><td>${esc(a.value)}</td></tr>`).join('')}</tbody></table></div>`:empty('没有记录参数','该切片没有可用参数。','info')}`);});}catch(error){toast(error.message,true);}return;}
  const traceEvent=event.target.closest('[data-trace-event]');if(traceEvent){const [kind,id]=traceEvent.dataset.traceEvent.split(':');const item=(kind==='slice'?state.traceResult?.sliceEvents:state.traceResult?.schedEvents)?.[Number(id)];if(item)showDialog(kind==='slice'?item.name:`CPU ${item.cpu} · ${item.thread}`,`${item.tid!==null?`<button class="button small" data-trace-thread="${item.tid}">查看当前窗口线程状态</button>`:''}${kind==='slice'?` <button class="button small" data-trace-slice-args="${esc(item.sliceId)}">读取事件参数</button>`:''}<pre>${esc(JSON.stringify(item,null,2))}</pre><p class="hint">时间和持续时间为纳秒；调度片段为采集到的 CPU 调度记录；TID 0 为 CPU 空闲线程。</p>`);return;}
  const cpuTraceThread=event.target.closest('[data-cpu-trace-thread]');if(cpuTraceThread){try{const group=state.cpuTimeline?.groups[Number(cpuTraceThread.dataset.cpuTraceThread)];if(group)await readTraceThreadStates(group.tid,group.pid);}catch(error){toast(error.message,true);}return;}
  const cpuBin=event.target.closest('[data-cpu-bin]');if(cpuBin){try{const bin=Number(cpuBin.dataset.cpuBin),group=state.cpuTimeline.groups[Number(cpuBin.dataset.cpuGroup)];if(!group)throw new Error('线程记录不存在');const profile=profileForTimeBin(state.cpuTimeline,bin,group.thread);state.cpuBin=bin;state.cpuThreadFilter=group.thread;state.cpuRange={start:state.cpuTimeline.durationMs*bin/state.cpuTimeline.bins,end:state.cpuTimeline.durationMs*(bin+1)/state.cpuTimeline.bins};state.cpuProfile={...profile,fileName:state.cpuOriginal.fileName};state.cpuFocus=[];render();}catch(error){toast(error.message,true);}return;}
  const flame=event.target.closest('[data-cpu-path]');if(flame){state.cpuFocus=flame.dataset.cpuPath?flame.dataset.cpuPath.split(',').map(Number):[];render();return;}
  const heapClass=event.target.closest('[data-heap-class]');if(heapClass){try{await browseHeapClass(heapClass.dataset.heapClass,0);}catch(error){toast(error.message,true);}return;}
  const heapPage=event.target.closest('[data-heap-page]');if(heapPage){try{await browseHeapClass(state.heapBrowse.classId,Number(heapPage.dataset.heapPage));}catch(error){toast(error.message,true);}return;}
  const searchRun=event.target.closest('[data-heap-string-search-run]');if(searchRun){try{const query=$('#heap-string-query').value,caseSensitive=$('#heap-string-case').checked;await browseHeapStringSearch(query,0,caseSensitive,[]);}catch(error){toast(error.message,true);}return;}
  const searchNext=event.target.closest('[data-heap-string-search-next]');if(searchNext){try{const s=state.heapStringSearch;await browseHeapStringSearch(s.query,Number(searchNext.dataset.heapStringSearchNext),s.caseSensitive,[...s.history,s.offset]);}catch(error){toast(error.message,true);}return;}
  const searchPrev=event.target.closest('[data-heap-string-search-prev]');if(searchPrev){try{const s=state.heapStringSearch;await browseHeapStringSearch(s.query,s.history.at(-1),s.caseSensitive,s.history.slice(0,-1));}catch(error){toast(error.message,true);}return;}
  const searchReturn=event.target.closest('[data-heap-string-search-return]');if(searchReturn){try{const s=state.heapStringSearch;await browseHeapStringSearch(s.query,s.offset,s.caseSensitive,s.history);}catch(error){toast(error.message,true);}return;}
  const stringsReturn=event.target.closest('[data-heap-strings-return]');if(stringsReturn){try{await browseDuplicateStrings();}catch(error){toast(error.message,true);}return;}
  const heapBack=event.target.closest('[data-heap-back]');if(heapBack){try{await browseHeapClass(state.heapBrowse.classId,state.heapBrowse.offset);}catch(error){toast(error.message,true);}return;}
  const heapObjectPage=event.target.closest('[data-heap-object-page]');if(heapObjectPage){try{await browseHeapObject(heapObjectPage.dataset.heapObjectPage,Number(heapObjectPage.dataset.offset));}catch(error){toast(error.message,true);}return;}
  const heapIncoming=event.target.closest('[data-heap-incoming]');if(heapIncoming){try{await browseHeapIncoming(heapIncoming.dataset.heapIncoming,Number(heapIncoming.dataset.offset||0),heapIncoming.dataset.excludeNonStrong==='true');}catch(error){toast(error.message,true);}return;}
  const heapRoot=event.target.closest('[data-heap-root]');if(heapRoot){try{await browseHeapRootPath(heapRoot.dataset.heapRoot,heapRoot.dataset.excludeNonStrong==='true');}catch(error){toast(error.message,true);}return;}
  const bitmapPage=event.target.closest('[data-bitmap-page]');if(bitmapPage){try{await browseBitmaps(Number(bitmapPage.dataset.bitmapPage));}catch(error){toast(error.message,true);}return;}
  const activityReturn=event.target.closest('[data-heap-activities-return]');if(activityReturn){try{await browseDestroyedActivities();}catch(error){toast(error.message,true);}return;}
  const heapObject=event.target.closest('[data-heap-object]');if(heapObject){try{await browseHeapObject(heapObject.dataset.heapObject);}catch(error){toast(error.message,true);}return;}
  const apkTab=event.target.closest('[data-apk-tab]');if(apkTab){state.apkTab=apkTab.dataset.apkTab;render();return;}
  const apkCategory=event.target.closest('[data-apk-category]');if(apkCategory){state.apkCategory=apkCategory.dataset.apkCategory;state.apkTab='files';state.apkFilter='';render();return;}
  const apkFile=event.target.closest('[data-apk-file]');if(apkFile){const file=state.apk.files[Number(apkFile.dataset.apkFile)];showDialog(file.path,`<pre>${esc(JSON.stringify(file,null,2))}</pre>`);return;}
  const layoutTimeline=event.target.closest('[data-layout-timeline-compare]');if(layoutTimeline){try{await compareLayoutTimeline(layoutTimeline.dataset.layoutTimelineCompare);}catch(error){toast(error.message,true);}return;}
  const apkComponent=event.target.closest('[data-apk-component]');if(apkComponent){const c=state.apk.manifest.components[Number(apkComponent.dataset.apkComponent)];showDialog(c.name,`<pre>${esc(JSON.stringify(c,null,2))}</pre>`);return;}
  const gpuOpenAgi=event.target.closest('[data-gpu-open-agi]');if(gpuOpenAgi){try{await task('gpu',async()=>{await window.desktop.openAgiArtifact(gpuOpenAgi.dataset.gpuOpenAgi);toast('已请求 AGI 打开校验后的副本；请在 AGI 中确认');});}catch(error){toast(error.message,true);}return;}
  const gpuVerify=event.target.closest('[data-gpu-verify]');if(gpuVerify){try{await task('gpu',async()=>{const r=await api('/gpu/verify',{id:gpuVerify.dataset.gpuVerify});state.gpuChecks[r.meta.id]=r.ok;toast(r.ok?'文件与导入时的 SHA-256 一致':`校验失败：${r.reason}`,!r.ok);});}catch(error){toast(error.message,true);}return;}
  const gpuExport=event.target.closest('[data-gpu-export]');if(gpuExport){try{await task('gpu',async()=>{const entry=state.gpuArtifacts.find(r=>r.id===gpuExport.dataset.gpuExport);const blob=await api(`/gpu/artifacts/${entry.id}/file`,undefined,true);download(blob,entry.name);toast('文件校验通过，已准备导出');});}catch(error){toast(error.message,true);}return;}
  const gpuTrace=event.target.closest('[data-gpu-trace]');if(gpuTrace){try{await task('trace',async()=>{const result=await api('/gpu/trace',{id:gpuTrace.dataset.gpuTrace});state.traceResult=result;state.frameTimeline=null;state.route='trace';location.hash='trace';toast('已载入系统追踪');});}catch(error){toast(error.message,true);}return;}
  const startupBreakdown=event.target.closest('[data-startup-breakdown]');if(startupBreakdown){try{const id=startupBreakdown.dataset.startupBreakdown,sessionId=state.startupTrace?.sessionId;if(!sessionId||sessionId!==state.traceResult?.sessionId)throw new Error('追踪已更换，请重新读取启动记录');await task('trace',async()=>{const r=await api('/trace/startup-breakdown',{sessionId,startupId:id});const duration=v=>`${fmt(Number(v)/1e6,3)} ms`;showDialog(`启动 #${id} 阶段分解`,`<p class="hint">Perfetto 根据主线程调度状态和切片对启动区间分类；分类依赖追踪事件，不证明根因，不含未被记录的时间。摘要最多 100 类，时间区间最多 1,000 条；列表展示前 100 条。${r.summaryTruncated||r.intervalsTruncated?' 数据已截断。':''}</p>${r.summary.length?`<table><thead><tr><th>分类</th><th>累计时间</th><th>区间数</th></tr></thead><tbody>${r.summary.map(x=>`<tr><td>${esc(x.reason||'未命名')}</td><td>${duration(x.durationNs)}</td><td>${x.count}</td></tr>`).join('')}</tbody></table><h3>时间区间</h3><table><thead><tr><th>分类</th><th>起始纳秒</th><th>持续时间</th></tr></thead><tbody>${r.intervals.slice(0,100).map(x=>`<tr><td>${esc(x.reason||'未命名')}</td><td class="mono">${esc(x.tsNs)}</td><td>${duration(x.durationNs)}</td></tr>`).join('')}</tbody></table>`:empty('没有阶段分解','追踪可能缺少必要的事件。','info')}`);});}catch(error){toast(error.message,true);}return;}
  const traceSliceSummary=event.target.closest('[data-trace-slice-summary]');if(traceSliceSummary){try{const trace=state.traceResult,row=trace?.slices[Number(traceSliceSummary.dataset.traceSliceSummary)];if(!row||!trace.sessionId)throw new Error('追踪会话已失效');await task('trace',async()=>{const result=await api('/trace/window',{sessionId:trace.sessionId,startNs:trace.bounds.startNs,endNs:trace.bounds.endNs,trackFilter:'',sliceFilter:row.name});state.traceResult={...result,fileName:trace.fileName};toast('已按名称查找切片；匹配包含相同文本的名称');});}catch(error){toast(error.message,true);}return;}
  const layoutFinding=event.target.closest('[data-layout-finding]');if(layoutFinding){const id=Number(layoutFinding.dataset.layoutFinding);if(state.nodes[id]){state.layoutRoot=null;state.layoutFilter='';selectNode(id);render();$('#phone-preview')?.scrollIntoView({behavior:'smooth',block:'center'});}return;}
  const layoutDiffSelect=event.target.closest('[data-layout-diff-select]');if(layoutDiffSelect){const change=compareLayouts(state.layoutBaseline.nodes,state.nodes).changes[Number(layoutDiffSelect.dataset.layoutDiffSelect)];if(change?.after){state.layoutRoot=null;state.layoutFilter='';selectNode(change.after.id);render();$('#phone-preview')?.scrollIntoView({behavior:'smooth',block:'center'});}return;}
  const layoutDiffRow=event.target.closest('[data-layout-diff]');if(layoutDiffRow){const change=compareLayouts(state.layoutBaseline.nodes,state.nodes).changes[Number(layoutDiffRow.dataset.layoutDiff)];if(change)showDialog(change.id,`<p class="hint">匹配依据为包名与 resource-id；重复 ID 使用共同唯一祖先范围进行候选匹配，身份无法确认。下方为两次采集的原始节点属性。</p><pre>${esc(JSON.stringify({before:change.before?.attributes||null,after:change.after?.attributes||null},null,2))}</pre>`);return;}
  const action=event.target.closest('[data-action]');
  if(action&&!action.disabled&&actions[action.dataset.action]){try{await actions[action.dataset.action]();}catch(error){toast(error.message,true);}return;}
  const node=event.target.closest('[data-node]');if(node){selectNode(Number(node.dataset.node));return;}
  const preview=event.target.closest('#phone-preview');if(preview){const rect=preview.getBoundingClientRect(),[width,height]=layoutSize(),x=(event.clientX-rect.left-preview.clientLeft)/preview.clientWidth*width,y=(event.clientY-rect.top-preview.clientTop)/preview.clientHeight*height;const hits=layoutScope(state.nodes,state.layoutRoot).filter(n=>n.bounds&&x>=n.bounds[0]&&x<=n.bounds[2]&&y>=n.bounds[1]&&y<=n.bounds[3]);if(hits.length)selectNode(hits.at(-1).id);return;}
  const session=event.target.closest('[data-session]');if(session){try{inspectSession(await api(`/sessions/${session.dataset.session}`));}catch(error){toast(error.message,true);}return;}
  const request=event.target.closest('[data-request]');if(request){const row=state.network.rows.find(r=>r.id===Number(request.dataset.request));showDialog(`${row.method} ${row.path}`,`<pre>${esc(JSON.stringify(row,null,2))}</pre><p class="hint">timings 的单位为 ms。ssl 是 connect 的子阶段，不应重复相加。</p>`);}
});
document.addEventListener('change',event=>{
  if(event.target.id==='appearance-theme'){state.theme=event.target.value;applyAppearance();persistAppearance().catch(error=>toast(`无法保存外观设置：${error.message}`,true));}
  if(event.target.id==='appearance-scale'){state.uiScale=event.target.value;applyAppearance();persistAppearance().catch(error=>toast(`无法保存外观设置：${error.message}`,true));}
  if(event.target.id==='source-snapshot')openSourceSnapshot(event.target.value).catch(error=>toast(error.message,true));
  if(event.target.id==='frame-timeline-scope')state.frameTimelineScope=event.target.value;
  if(event.target.id==='cpu-thread'){state.cpuFocus=event.target.value==='all'?[]:[Number(event.target.value)];render();}
  if(event.target.id==='apk-category'){state.apkCategory=event.target.value;$('#apk-file-table').innerHTML=apkFileTable();}
  if(event.target.id==='apk-component-type'){state.apkComponent=event.target.value;$('#apk-component-table').innerHTML=apkComponentTable();}
  if(event.target.id==='interval-select')state.interval=Number(event.target.value);
  if(event.target.id==='trace-include-app')state.traceIncludeApp=event.target.checked;
  if(event.target.id==='startup-mode')state.startupMode=event.target.value;
  if(event.target.id==='startup-runs')state.runs=Number(event.target.value);
  if(event.target.id==='budget-select'){state.budget=Number(event.target.value);if(state.frames){const f=state.frames;f.budgetMs=state.budget;if(f.sourceFormat!=='histogram'){f.frames.forEach(row=>row.overBudget=row.durationMs>state.budget);f.slow=f.frames.filter(r=>r.overBudget).length;f.slowPercent=f.count?f.slow/f.count*100:null;}}render();}
});
document.addEventListener('input',event=>{if(event.target.id==='cpu-symfs')state.cpuSymfs=event.target.value;if(event.target.id==='cpu-profile-search'){state.cpuFilter=event.target.value;$('#cpu-profile-symbols').innerHTML=cpuSymbols(state.cpuProfile.symbols.filter(x=>x.name.toLocaleLowerCase().includes(state.cpuFilter.toLocaleLowerCase())));}if(event.target.id==='heap-search'){state.heapFilter=event.target.value;$('#heap-table').innerHTML=heapTable();}if(event.target.id==='layout-search'){state.layoutFilter=event.target.value;$('#layout-tree').innerHTML=layoutTree();}if(event.target.id==='network-search'){state.networkFilter=event.target.value;$('#network-table').innerHTML=networkTable();}if(event.target.id==='apk-search'){state.apkFilter=event.target.value;$('#apk-file-table').innerHTML=apkFileTable();}});
document.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&event.target.matches?.('[data-cpu-path], [data-frame]')){event.preventDefault();event.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
document.addEventListener('load',event=>{if(event.target.matches?.('#phone-preview img')&&state.selectedNode!==null)selectNode(state.selectedNode);},true);
$('#mode-btn').onclick=()=>toggleDemo().catch(error=>toast(error.message,true));
$('#refresh-devices').innerHTML=icon('refresh',16);$('#device-icon').innerHTML=icon('phone',18);
$('#refresh-devices').onclick=()=>{if(state.busy.size){toast('请等待当前采集任务完成',true);return;}if(state.demo){toast('请先退出演示，再刷新真实设备');return;}fetchDevices();};
$('#device-select').onchange=async event=>{if(state.busy.size){event.target.value=state.serial;toast('请等待当前采集任务完成后切换设备',true);return;}resetEvidence();state.serial=event.target.value;state.info=null;$('#package-list').innerHTML='';render();if(state.serial)await loadDevice();};
$('#package-input').onchange=event=>{if(state.busy.size){event.target.value=state.packageName;toast('请等待当前采集任务完成后切换应用',true);return;}const pkg=event.target.value.trim();if(pkg!==state.packageName){resetEvidence();state.packageName=pkg;localStorage.setItem('apw-package',pkg);render();}};
$('#file-input').onchange=async event=>{const file=event.target.files[0];if(!file)return;try{if(file.size>12*1024*1024)throw new Error('文件超过 12 MB 限制');await importHandler(await file.text(),file);}catch(error){toast(error.message,true);}};
$('#gpu-input').onchange=async event=>{const file=event.target.files[0];if(!file)return;try{if(file.size>512*1024*1024)throw new Error('GPU 产物不能超过 512 MiB');await task('gpu',async()=>{const response=await fetch('/api/gpu/import',{method:'POST',headers:{'X-Workbench-Token':token,'X-File-Name':encodeURIComponent(file.name)},body:file});const result=await response.json();if(!response.ok)throw new Error(result.error||'导入失败');await refreshGpu();toast('产物已导入并计算 SHA-256');});}catch(error){toast(error.message,true);}};
$('#trace-input').onchange=async event=>{
  const file=event.target.files[0];if(!file)return;
  try {if(file.size>256*1024*1024)throw new Error('追踪文件不能超过 256 MiB');
    await task('trace',async()=>{const response=await fetch('/api/trace/analyze',{method:'POST',headers:{'X-Workbench-Token':token},body:file});const result=await response.json();if(!response.ok)throw new Error(result.error||'追踪分析失败');state.traceResult={...result,fileName:file.name};state.frameTimeline=null;toast('追踪文件已分析');});
  }catch(error){toast(error.message,true);}
};
async function loadPerfEvent(file,eventName=null){
  const symfs=state.cpuSymfs.trim();
  return task('cpu-profile',()=>applyPerfEvent(file,eventName,symfs));
}
async function applyPerfEvent(file,eventName,symfs){
    const headers={'X-Workbench-Token':token};if(eventName!==null)headers['X-Perf-Event']=encodeURIComponent(eventName);if(symfs)headers['X-Perf-Symfs']=encodeURIComponent(symfs);const response=await fetch('/api/cpu-profile/analyze',{method:'POST',headers,body:file});const result=await response.json();if(!response.ok)throw new Error(result.error||'分析失败');
    const profile={...parseFoldedStacks(result.folded),fileName:file.name,warning:result.warning};let timeline=null;try{timeline=result.timeline?buildSampleTimeline(result.timeline):null;}catch(error){profile.warning=[profile.warning,error.message].filter(Boolean).join('；');}
    state.cpuPerfFile=file;state.cpuEvents=(result.timeline?.events||[]).filter(e=>e&&typeof e.name==='string'&&e.name.length>0&&e.name.length<=256&&!/[\x00-\x1f\x7f]/.test(e.name)&&Number.isSafeInteger(e.count)&&e.count>0);state.cpuEvent=result.timeline?.event||eventName;state.cpuEventsTruncated=!!result.timeline?.eventsTruncated;
    state.cpuProfile=profile;state.cpuOriginal=profile;state.cpuTimeline=timeline;state.cpuBin=null;state.cpuRange=null;state.cpuThreadFilter=null;state.cpuFilter='';state.cpuFocus=[];toast(profile.warning?'调用栈已导入；请查看工具提示':'采样事件已载入');
}
$('#perf-input').onchange=async event=>{
  const file=event.target.files[0];if(!file)return;
  try{if(file.size>256*1024*1024)throw new Error('perf.data 不能超过 256 MiB');await loadPerfEvent(file);}catch(error){toast(error.message,true);}
};
$('#heap-input').onchange=async event=>{
  const file=event.target.files[0];if(!file)return;
  try {if(!file.name.toLowerCase().endsWith('.hprof'))throw new Error('请选择 .hprof 文件');if(file.size>256*1024*1024)throw new Error('HPROF 文件不能超过 256 MiB');
    await task('heap',async()=>{const response=await fetch('/api/heap/analyze',{method:'POST',headers:{'X-Workbench-Token':token,'X-Heap-Role':state.heapRole},body:file});const result=await response.json();if(!response.ok)throw new Error(result.error||'分析失败');if(state.heapRole==='baseline'){state.heapBaseline={...result,fileName:file.name};if(state.heap)state.heapView='compare';}else {state.heap={...result,fileName:file.name};state.heapView=state.heapBaseline?'compare':'classes';}state.heapFilter='';toast(state.heapRole==='baseline'?'基线快照已导入':'当前快照分析完成');});
  } catch(error){toast(error.message,true);}
};
$('#apk-input').onchange=async event=>{
  const file=event.target.files[0];if(!file)return;
  try{
    if(!file.name.toLowerCase().endsWith('.apk'))throw new Error('请选择 .apk 文件');
    if(file.size>512*1024*1024)throw new Error('APK 文件不能超过 512 MB');
    await task('apk',async()=>{
      const response=await fetch('/api/apk/analyze',{method:'POST',headers:{'X-Workbench-Token':token,'X-APK-Name':encodeURIComponent(file.name),'Content-Type':'application/vnd.android.package-archive'},body:file});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'APK 分析失败');
      state.apk=result;state.apkTab='overview';state.apkFilter='';state.apkCategory='all';state.apkComponent='all';state.replay=false;window.scrollTo(0,0);toast(`已分析 ${result.fileCount} 个文件、${result.dex.length} 个 DEX`);
    });
  }catch(error){toast(error.message,true);}
};
$('#dialog-close').onclick=()=>$('#detail-dialog').close();
window.addEventListener('hashchange',()=>{const route=location.hash.slice(1);state.route=routes.some(r=>r[0]===route)?route:'overview';render();window.scrollTo(0,0);});
window.addEventListener('resize',drawCharts);
window.addEventListener('beforeunload',event=>{if(state.monitoring||state.busy.size){event.preventDefault();event.returnValue='';}});
window.desktop?.onNavigate(route=>{location.hash=route;});
window.desktop?.onAdbUpdated(async()=>{stopMonitor();state.demo=false;resetEvidence();state.status=await api('/status');await fetchDevices();toast('ADB 路径已更新');});
state.route=routes.some(r=>r[0]===location.hash.slice(1))?location.hash.slice(1):'overview';
refreshGpu().then(()=>{if(state.route==='gpu')render();}).catch(error=>toast(error.message,true));
api('/cpu-profile/archives').then(x=>{state.cpuArchives=x.archives;if(state.route==='cpu-profile')render();}).catch(error=>toast(error.message,true));
api('/trace/archives').then(x=>{state.traceArchives=x.archives;if(state.route==='trace')render();}).catch(error=>toast(error.message,true));
refreshSource().then(()=>{if(state.route==='source')render();}).catch(error=>toast(error.message,true));
if(window.desktop?.agiStatus)window.desktop.agiStatus().then(path=>{state.agiPath=path;if(state.route==='gpu')render();}).catch(error=>toast(error.message,true));
render();
await Promise.allSettled([api('/status').then(data=>{state.status=data;if(state.route==='settings')render();}),refreshSessions().then(()=>{if(['overview','sessions','layout','battery'].includes(state.route))render();}),fetchDevices()]);
