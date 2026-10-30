import { DEMO_DEVICE, DEMO_PACKAGE, demoSample, demoHistory, demoFrames, demoStartup, demoLayout, DEMO_HAR } from './demo.js';
import { parseHar, parseBenchmark, compareBenchmarks } from './offline.js';

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
  ['overview', '概览', 'grid'], ['monitor', '实时监控', 'activity'], ['frames', '帧耗时分析', 'frames'], ['startup', '启动测试', 'rocket'],
  ['layout', '布局检查', 'layers'], ['trace', '系统追踪', 'trace'], ['network', '网络分析', 'network', 'HAR'], ['benchmark', '基准对比', 'chart', 'JSON'],
  ['apk', 'APK 分析', 'package', 'APK'],
  ['sessions', '采集记录', 'folder'], ['settings', '设置与帮助', 'settings'],
];
const state = { route: 'overview', demo: false, devices: [], serial: '', packageName: localStorage.getItem('apw-package') || '', info: null, status: null,
  samples: [], monitoring: false, generation: 0, pollTimer: null, interval: 2000, error: '', frames: null, budget: 16.667, startup: null, startupMode: 'cold', runs: 3,
  layout: null, nodes: [], selectedNode: null, network: null, baseline: null, current: null, apk:null, apkTab:'overview',apkFilter:'',apkCategory:'all',apkComponent:'all', sessions: [], busy: new Set(), replay: false, networkFilter: '', deviceGeneration: 0 };
let toastTimer, importHandler;

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
    note('数据来自 dumpsys gfxinfo framestats 的有限历史缓冲区；仅统计 Flags=0 且时间戳有效的帧。超过所选预算的帧数是参考信号，不等同于平台 Jank、FPS 或刷新率检测。') +
    `<div class="grid stats-grid">${statCard('有效帧', fmt(f?.count,0), '帧', '当前 gfxinfo 缓冲区', 'frames', 'green')}${statCard('超预算比例', fmt(f?.slowPercent), '%', `${f?.slow ?? '—'} 帧超过 ${fmt(f?.budgetMs ?? state.budget,2)} ms`, 'activity', 'orange')}${statCard('P95 帧耗时', fmt(f?.p95), 'ms', '95% 的帧耗时不超过此值', 'chart', 'purple')}${statCard('最长帧', fmt(f?.max), 'ms', '缓冲区内最大帧耗时', 'clock')}</div><div style="height:20px"></div>` +
    `<div class="panel"><div class="panel-head"><div><h2>逐帧耗时</h2><p>最近 ${Math.min(f?.count || 0, 150)} 帧 · 鼠标悬停查看耗时</p></div><div class="chart-legend"><span><i style="background:#81b9a9"></i>预算内</span><span><i style="background:#d9b77e"></i>超预算</span></div></div><div class="panel-body">${f?.count ? frameBars(f) : empty('暂无有效帧', '先重置统计，在设备上操作目标应用，再读取帧数据。', 'frames')}</div></div>` +
    (f ? `<div class="hint">P50 ${fmt(f.p50)} ms　·　P90 ${fmt(f.p90)} ms　·　P99 ${fmt(f.p99)} ms　·　平台 Janky frames 计数：${esc(f.platformJank ?? '不可用')}（可能与缓冲区范围不同）</div>` : '');
}
function frameBars(f) {
  const maximum = Math.max(f.max, f.budgetMs * 1.8);
  return `<div class="frame-chart"><div class="budget-line" style="bottom:${25+(f.budgetMs/maximum)*180}px"><span>${fmt(f.budgetMs,2)} ms 预算</span></div>${f.frames.slice(-150).map(row=>`<div class="frame-bar ${row.overBudget?'slow':''}" style="height:${row.durationMs/maximum*180}px" title="第 ${row.index} 帧 · ${fmt(row.durationMs,2)} ms"></div>`).join('')}</div>`;
}
function renderStartup() {
  const result = state.startup, busy = state.busy.has('startup');
  return pageHeader('启动测试', '用重复实验观察启动耗时，区分请求协议与实际启动状态。', button('save-startup','保存记录','download',false,!result)) +
    note('冷启动会 force-stop 目标应用；温启动先按 Back，热启动先按 Home。测试会操作手机当前界面。TotalTime 是 am start -W 的报告值；不提供无证据的 TTFD、阶段耗时或 Baseline Profile 判断。') +
    `<div class="toolbar"><label>请求模式 <select id="startup-mode" ${busy?'disabled':''}>${[['cold','冷启动'],['warm','温启动'],['hot','热启动']].map(([key,label])=>`<option value="${key}" ${state.startupMode===key?'selected':''}>${label}</option>`).join('')}</select></label><label>重复次数 <input id="startup-runs" type="number" min="1" max="10" value="${state.runs}" ${busy?'disabled':''}></label><span class="spacer"></span>${busy?loading(`测试中，最多 ${state.runs} 次…`):button('run-startup','开始测试','play',true)}</div>` +
    `<div class="grid stats-grid">${statCard('平均 TotalTime',fmt(result?.meanMs),'ms','有效运行的算术平均值','rocket','green')}${statCard('最快一次',fmt(result?Math.min(...result.results.map(r=>r.totalTimeMs)):null,0),'ms','TotalTime 最小值','clock')}${statCard('最慢一次',fmt(result?Math.max(...result.results.map(r=>r.totalTimeMs)):null,0),'ms','TotalTime 最大值','activity','orange')}${statCard('有效运行',fmt(result?.results.length,0),'次','保留每次原始报告','chart','purple')}</div><div style="height:20px"></div>` +
    `<div class="panel"><div class="panel-head"><h2>每次启动耗时</h2>${result?sourceTag(result.source):''}</div>${result?`<div class="startup-chart">${result.results.map(r=>`<div class="startup-column" style="height:${r.totalTimeMs / Math.max(...result.results.map(x=>x.totalTimeMs),1)*160}px"><span>${r.totalTimeMs} ms</span><small>第 ${r.run} 次</small></div>`).join('')}</div><div class="table-wrap"><table><thead><tr><th>运行</th><th>请求模式</th><th>观察到的模式</th><th>TotalTime</th><th>ThisTime</th><th>WaitTime</th></tr></thead><tbody>${result.results.map(r=>`<tr><td>#${r.run}</td><td>${esc(result.requestedMode)}</td><td>${esc(r.observedMode||'设备未报告')}</td><td class="mono">${fmt(r.totalTimeMs,0)} ms</td><td class="mono">${fmt(r.thisTimeMs,0)} ms</td><td class="mono">${fmt(r.waitTimeMs,0)} ms</td></tr>`).join('')}</tbody></table></div>`:empty(busy?'正在运行启动实验':'尚未运行启动实验',busy?'请保持设备解锁，并等待实验完成。':'选择设备和应用后开始，建议测试期间避免其他操作。','rocket')}</div>`;
}

function buildNodes(xml) {
  if(typeof xml!=='string'||xml.length>2*1024*1024||/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error('层级 XML 超过 2 MB 或包含不支持的实体定义');
  const doc = new DOMParser().parseFromString(xml,'application/xml');
  if (doc.querySelector('parsererror') || !doc.querySelector('hierarchy')) throw new Error('层级 XML 格式无效');
  const nodes = [];
  function walk(element, depth) {
    if (nodes.length >= 10000 || depth > 100) return;
    if (element.tagName === 'node') {
      const attributes = Object.fromEntries([...element.attributes].map(a=>[a.name,a.value]));
      const bounds = attributes.bounds?.match(/^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/)?.slice(1).map(Number);
      nodes.push({ id: nodes.length, depth, attributes, bounds, className: attributes.class?.split('.').at(-1)||'Node' });
    }
    for (const child of element.children) walk(child, depth + (element.tagName==='node'?1:0));
  }
  walk(doc.documentElement,0); return nodes;
}
function renderLayout() {
  const layout = state.layout;
  return pageHeader('布局检查','从可访问性层级到屏幕，检查可见界面的结构。',button('import-layout','导入 XML','upload')+button('save-layout','保存快照','download',false,!layout)+button('capture-layout','采集当前界面','layers',true,state.busy.has('layout'))) +
    note(layout?.note || '采集设备当前前台窗口的 UIAutomator 可访问性层级，不保证属于所选应用，也不是完整 View/Compose 树。安全窗口可能没有截图；没有可访问性语义的节点可能缺失。') +
    (state.busy.has('layout')?`<div class="toolbar">${loading('正在获取层级与屏幕快照…')}</div>`:'') +
    `<div class="panel inspector"><section><div class="panel-head"><h2>界面层级</h2><span class="tag">${state.nodes.length} 节点</span></div><div class="tree">${state.nodes.length?state.nodes.map(node=>`<button class="tree-node ${node.id===state.selectedNode?'active':''}" data-node="${node.id}" style="padding-left:${8+Math.min(node.depth,12)*13}px" title="${esc(node.attributes['resource-id']||node.className)}"><span style="color:#a8b6bd">${node.depth?'⌞':'◇'}</span><span>${esc(node.className)}</span>${node.attributes.text?`<small>${esc(node.attributes.text)}</small>`:''}</button>`).join(''):empty('等待快照','采集界面或导入层级 XML','layers')}</div></section><section class="canvas-pane"><div class="panel-head"><h2>屏幕快照</h2>${layout?sourceTag(layout.source):'<span class="tag">未采集</span>'}</div>${layout?phonePreview():empty('暂无屏幕快照','采集后可点击屏幕选中节点','phone')}</section><section><div class="panel-head"><h2>节点属性</h2>${icon('info',14)}</div><div id="properties">${properties()}</div></section></div><div class="hint">${esc(layout?.warning || '')}</div>`;
}
function phonePreview() {
  const [width,height]=layoutSize(false);
  return `<div class="phone-preview" id="phone-preview" style="aspect-ratio:${width}/${height}" title="点击选中最深层节点">${state.layout.screenshot?`<img alt="设备屏幕快照" src="data:image/png;base64,${esc(state.layout.screenshot)}">`:state.layout.source==='demo'?'<div class="sample-screen"><small style="font-size:7px">9:41</small><h3 style="margin-top:25px">阅读，让生活<br>慢下来</h3><p>为你精选　 /　 THIS WEEK</p><div class="book-cover">山与海<small>A QUIET PLACE TO READ</small></div><p>在文字里，找到另一个世界。</p><div class="sample-button">开始阅读</div></div>':'<div class="empty">无截图<br>仅显示节点边界</div>'}<svg class="phone-overlay" id="phone-overlay" preserveAspectRatio="none"></svg></div>`;
}
function properties() {
  const node = state.nodes[state.selectedNode];
  return node?`<dl class="property-list">${Object.entries(node.attributes).map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v||'—')}</dd>`).join('')}</dl>`:empty('选择一个节点','点击层级列表或屏幕查看属性','search');
}
function selectNode(id) {
  state.selectedNode=id;
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
function renderTrace() {
  const busy=state.busy.has('trace');
  return pageHeader('系统追踪','捕获调度、频率、图形和 Binder 等系统事件。')+
    note('需要设备内置 Perfetto（通常为 Android 9+）。本工具负责采集原始追踪，不内置 Trace Processor。下载后可在 Perfetto UI 中分析；仅在你手动打开文件后交给外部工具。')+
    `<div class="panel"><div class="trace-hero"><div class="hero-icon">${icon('trace',31)}</div><div class="eyebrow">SYSTEM TRACE / PERFETTO</div><h2>把运行现场，留在时间线上</h2><p>以 32 MB 缓冲区采集 CPU 调度、频率、应用、窗口、图形和 Binder 事件。采集期间，请在设备上重现你想分析的操作。</p><div class="toolbar"><label>采集时长 <select id="trace-seconds" ${busy?'disabled':''}><option value="5">5 秒</option><option value="10" selected>10 秒</option><option value="20">20 秒</option><option value="30">30 秒</option></select></label>${busy?loading('正在采集，完成后将下载追踪文件…'):button('capture-trace','开始录制','play',true,state.demo||state.info?.perfettoAvailable===false)}</div><a class="button" href="https://ui.perfetto.dev" target="_blank" rel="noreferrer">打开 Perfetto UI ↗</a>${state.demo?'<div class="hint">演示模式不生成虚构追踪文件。连接真实设备后可录制。</div>':state.info?.perfettoAvailable===false?'<div class="hint">当前设备未安装 perfetto，无法录制。内置 Perfetto 通常需要 Android 9 或更高版本。</div>':''}</div><div class="steps"><span><b>01</b> 连接并解锁设备</span><span><b>02</b> 录制时重现操作</span><span><b>03</b> 下载并在 Perfetto 分析</span></div></div>`;
}
function renderNetwork() {
  const data=state.network, rows=data?.rows||[];
  return pageHeader('网络分析','导入 HAR，在本机检查请求、状态与时序。',button('save-network','保存分析','download',false,!data)+button('import-har','导入 HAR','upload',true))+
    note('当前支持离线 HAR 分析，不抓取全设备流量。导入时丢弃 URL 查询参数、凭据、Headers、Cookies 与请求/响应正文；路径仍可能含业务标识。耗时字段缺失时显示不可用。')+
    `<div class="grid stats-grid">${statCard('总请求数',fmt(data?rows.length:null,0),'次','HAR entries','network','green')}${statCard('失败请求',fmt(data?rows.filter(r=>r.status===0||r.status>=400).length:null,0),'次','状态码 0 或 ≥ 400','activity','orange')}${statCard('平均耗时',fmt(data&&rows.some(r=>r.timeMs!==null)?rows.filter(r=>r.timeMs!==null).reduce((s,r)=>s+r.timeMs,0)/rows.filter(r=>r.timeMs!==null).length:null),'ms','有效 time 字段的平均值','clock')}${statCard('响应内容大小',fmt(data&&rows.some(r=>r.bytes!==null)?rows.reduce((s,r)=>s+(r.bytes||0),0)/1024:null),'KB','content.size · 非线路传输字节','memory','purple')}</div><div style="height:20px"></div>`+
    `<div class="panel"><div class="panel-head"><h2>请求列表 ${data?sourceTag(data.source):''}</h2><input class="search" id="network-search" placeholder="筛选域名或路径…" value="${esc(state.networkFilter)}" aria-label="筛选网络请求"></div><div id="network-table">${networkTable()}</div></div>`;
}
function networkTable() {
  if(!state.network) return empty('导入你的网络记录','支持浏览器、代理工具导出的标准 HAR 文件。','network',button('import-har','选择 HAR 文件','upload'));
  const rows=state.network.rows.filter(r=>(r.host+r.path).toLowerCase().includes(state.networkFilter.toLowerCase()));
  const max=Math.max(1,...rows.map(r=>r.timeMs||0));
  return `<div class="table-wrap"><table><thead><tr><th>请求路径</th><th>方法</th><th>状态</th><th>域名</th><th>内容大小</th><th>耗时</th><th>相对耗时</th></tr></thead><tbody>${rows.slice(0,1000).map(row=>`<tr class="clickable" data-request="${row.id}"><td><strong>${esc(row.path)}</strong></td><td class="mono">${esc(row.method)}</td><td><span class="tag ${row.status>=400||row.status===0?'red':'green'}">${row.status}</span></td><td class="mono">${esc(row.host)}</td><td class="mono">${fmt(row.bytes===null?null:row.bytes/1024)} KB</td><td class="mono">${fmt(row.timeMs,0)} ms</td><td><div class="waterfall"><i style="width:${Math.max(1,(row.timeMs||0)/max*100)}%"></i></div></td></tr>`).join('')}</tbody></table></div>${!rows.length?empty('没有匹配的请求','试试其他域名或路径。','search'):''}${rows.length>1000?'<div class="hint" style="padding:15px">仅渲染前 1,000 条匹配请求，请使用筛选缩小范围。</div>':''}`;
}
function renderBenchmark() {
  const rows=state.baseline&&state.current?compareBenchmarks(state.baseline,state.current):[];
  return pageHeader('基准对比','对齐 AndroidX Benchmark 的同名指标，查看基线与当前值的变化。')+
    note('读取 AndroidX Benchmark JSON 的 metrics / sampledMetrics。按类名、测试名和指标名匹配中位数；只展示描述性差异，不推断统计显著性，也不自动判定不同指标的优劣方向。请确保设备、编译模式和实验条件可比。')+
    `<div class="grid monitor-grid">${[['baseline','基线运行','BASELINE',state.baseline],['current','当前运行','CURRENT',state.current]].map(([key,title,en,data])=>`<div class="panel"><div class="panel-head"><h2>${title}</h2><span class="tag">${en}</span></div><div class="panel-body"><div class="dropzone">${data?`${icon('file',23)}<br><strong>${esc(data.fileName)}</strong><br>${data.results.length} 个可读指标`:'选择 AndroidX Benchmark 导出的 JSON 文件'}<br>${button(`import-${key}`,data?'重新选择':'导入 JSON','upload')}</div>${data?`<div class="hint">设备：${esc(data.context?.build?.model||'未提供')} · API ${esc(data.context?.build?.version?.sdk||'未提供')}</div>`:''}</div></div>`).join('')}</div><div style="height:20px"></div>`+
    `<div class="panel"><div class="panel-head"><h2>指标变化</h2><span class="subtle">正值为增加，负值为减少 · 保留原始单位</span></div>${rows.length?`<div class="table-wrap"><table><thead><tr><th>测试 / 指标</th><th>基线中位数</th><th>当前中位数</th><th>相对变化</th><th>当前样本数</th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${esc(r.name)}</strong><br><span class="subtle mono">${esc(r.metric)}</span></td><td class="mono">${fmt(r.baseline,2)}</td><td class="mono">${fmt(r.median,2)}</td><td class="mono">${r.delta===null?'不可比':`${r.delta>0?'+':''}${fmt(r.delta,2)}%`}</td><td class="mono">${r.runs||'未提供'}</td></tr>`).join('')}</tbody></table></div>`:empty('等待两份运行结果','先导入基线与当前运行，再比较同名指标。','chart')}</div>`;
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
    `<div class="settings-grid"><div class="panel"><div class="panel-head"><h2>本机运行环境</h2>${icon('settings',16)}</div><div class="panel-body"><div class="evidence-row"><span>版本</span><strong>${esc(state.status?.version||'检测中')}</strong></div><div class="evidence-row"><span>运行模式</span><strong>${state.status?.desktop?'原生桌面应用 · Electron':'本地 HTTP · 127.0.0.1'}</strong></div><p class="hint">ADB 路径</p><code>${esc(state.status?.adbPath||'检测中')}</code><p>自动检测 PATH、ANDROID_HOME、ANDROID_SDK_ROOT 和常见 SDK 安装目录。${state.status?.desktop?'可通过原生菜单「文件 → 选择 ADB 程序…」修改路径。':'指定其他 ADB 后重启服务：'}</p><code>${state.status?.desktop?'文件 → 选择 ADB 程序…':'ADB_PATH=/your/sdk/platform-tools/adb npm start'}</code><p class="hint">记录目录</p><code>${esc(state.status?.dataDir||'检测中')}</code></div></div><div class="panel"><div class="panel-head"><h2>设备连接</h2>${icon('phone',16)}</div><div class="panel-body"><p>1. 在 Android 设备上打开开发者选项和 USB 调试。<br>2. 使用数据线连接电脑，并在设备上允许 USB 调试。<br>3. 点击右上角刷新，选择设备和目标应用。<br>4. 启动目标应用，再开始采集。</p><code>adb devices -l</code><p>unauthorized：在手机确认调试授权。<br>offline：检查连接或重新插拔。<br>无线设备：先在系统终端完成 adb pair / connect。</p></div></div><div class="panel"><div class="panel-head"><h2>首版能力范围</h2>${icon('info',16)}</div><div class="panel-body"><p>已实现：设备与应用发现、资源快照与轮询、gfxinfo 帧分析、重复启动实验、可访问性层级与截图、Perfetto 采集、HAR 离线分析、Benchmark 指标对比、记录导入导出。</p><p class="hint">尚未实现：simpleperf 调用栈/火焰图、HPROF 堆分析、完整 Compose Inspector、应用级能耗归因、网络实时 Agent、内置 Perfetto SQL 分析。</p></div></div><div class="panel"><div class="panel-head"><h2>证据与数据</h2>${icon('folder',16)}</div><div class="panel-body"><p>数据仅保存在当前电脑，不调用 AI 或上传服务。实时数据最多保留 1,800 个样本；图表展示最近 120 个。停止采集后请手动保存记录。</p><p class="hint">启动实验会操作前台应用；帧重置仅清除系统 gfxinfo 统计。UIAutomator 采集的是当前窗口，可能包含敏感内容，请按需保存。演示样例可随时清除并切换到真实设备。</p><div style="margin-top:20px"><a class="button" href="https://github.com/yuchuangu85/AndroidPerformanceStudio" target="_blank" rel="noreferrer">参考项目 ↗</a></div></div></div></div>`;
}

const $$ = selector => [...document.querySelectorAll(selector)];
function render() {
  renderNav(); updateChrome();
  const views={ overview:renderOverview, monitor:renderMonitor, frames:renderFrames, startup:renderStartup, layout:renderLayout, trace:renderTrace, network:renderNetwork, benchmark:renderBenchmark, apk:renderApk, sessions:renderSessions, settings:renderSettings };
  $('#main').innerHTML=(views[state.route]||renderOverview)();
  requestAnimationFrame(()=>{ drawCharts(); if(state.route==='layout'&&state.selectedNode!==null) selectNode(state.selectedNode); });
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
function resetEvidence() {
  stopMonitor();state.samples=[];state.frames=null;state.startup=null;state.layout=null;state.nodes=[];state.selectedNode=null;state.replay=false;
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
  if(state.demo){state.serial=DEMO_DEVICE.serial;state.packageName=DEMO_PACKAGE;state.info=DEMO_DEVICE;state.samples=demoHistory();state.frames=demoFrames(state.budget);state.startup=demoStartup();state.layout=demoLayout();state.nodes=buildNodes(state.layout.xml);state.selectedNode=0;state.network={source:'demo',rows:parseHar(DEMO_HAR)};renderDeviceOptions();render();}
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
  const payload={monitor:{samples:state.samples},frames:state.frames,startup:state.startup,layout:state.layout,network:state.network,apk:state.apk}[kind];
  if(!payload||(kind==='monitor'&&!state.samples.length))throw new Error('尚无可保存的数据');
  const source=kind==='monitor'?state.samples[0].source:payload.source;
  const packageName=kind==='monitor'?payload.samples[0]?.packageName||'':payload.packageName||'';
  await api('/sessions',{kind,source:source||'import',name:`${routes.find(r=>r[0]===kind)?.[1]} · ${packageName||(kind==='layout'?'前台窗口':'离线分析')}`,packageName,payload});
  await refreshSessions();toast('记录已保存在本机');render();
}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);}
function pickFile(handler,accept='.json') {importHandler=handler;$('#file-input').accept=accept;$('#file-input').value='';$('#file-input').click();}
function showDialog(title,html) {$('#dialog-title').textContent=title;$('#dialog-content').innerHTML=html;$('#detail-dialog').showModal();}
function inspectSession(session) {
  showDialog(session.name,`<div class="toolbar">${sourceTag(session.source)}<span class="subtle">${date(session.timestamp)}</span><span class="spacer"></span>${button('replay-session','载入分析','play')}${button('export-session','导出 JSON','download')}</div><div class="hint" style="margin-bottom:15px">类型：${esc(session.kind)}　·　应用：${esc(session.packageName||'—')}　·　数据版本：${session.schemaVersion}</div><pre>${esc(JSON.stringify({...session,payload:session.kind==='monitor'?{sampleCount:session.payload.samples.length,first:session.payload.samples[0],last:session.payload.samples.at(-1)}:session.kind==='layout'?{...session.payload,screenshot:session.payload.screenshot?'[PNG 图像数据]':null}:session.payload},null,2).slice(0,30000))}</pre>`);
  $('#dialog-content [data-action=export-session]').onclick=()=>download(new Blob([JSON.stringify(session,null,2)],{type:'application/json'}),`apw-${session.kind}-${session.id}.json`);
  $('#dialog-content [data-action=replay-session]').onclick=()=>{try{replaySession(session);$('#detail-dialog').close();}catch(error){toast(error.message,true);}};
}
function replaySession(session) {
  if(state.busy.size)throw new Error('请等待当前采集任务完成后载入记录');
  const {kind,payload}=session;
  if(!payload||!['monitor','frames','startup','layout','network','apk'].includes(kind))throw new Error('此记录暂不支持载入');
  if(kind==='monitor'&&(!Array.isArray(payload.samples)||payload.samples.length>1800))throw new Error('监控样本格式无效或超过 1,800 条');
  if(kind==='layout'){state.nodes=buildNodes(payload.xml);state.selectedNode=state.nodes.length?0:null;}
  stopMonitor();state.replay=true;
  if(kind==='monitor')state.samples=payload.samples;else state[kind]=payload;
  if(kind==='frames')state.budget=payload.budgetMs;
  if(kind==='apk'){state.apkTab='overview';state.apkFilter='';state.apkCategory='all';}
  location.hash=kind;state.route=kind;render();toast('已载入保存记录；开始新采集会使用当前所选设备');
}

const actions={
  'choose-apk':()=>{if(state.busy.has('apk'))return;$('#apk-input').value='';$('#apk-input').click();},
  'save-apk':()=>save('apk'),
  'export-apk':()=>{const p=state.apk;if(!p)throw new Error('请先分析 APK');download(new Blob([JSON.stringify({schemaVersion:1,kind:'apk',source:p.source,name:`APK 分析 · ${p.packageName}`,packageName:p.packageName,timestamp:p.timestamp,payload:p},null,2)],{type:'application/json'}),`${p.fileName.replace(/\.apk$/i,'')}.apk-report.json`);},
  'start-monitor':startMonitor,
  'stop-monitor':()=>{stopMonitor();render();toast('采集已停止，可保存当前记录');},
  'sample-once':()=>task('sample',async()=>{if(state.replay){state.samples=[];state.replay=false;}await sampleOnce();toast('已采集一个样本');}),
  'capture-frames':()=>{requireTarget();return task('frames',async()=>{state.frames=state.demo?demoFrames(state.budget):await api(`/frames?${query()}&budget=${state.budget}`);toast(state.frames.count?`读取 ${state.frames.count} 个有效帧`:'缓冲区没有有效帧，请先在设备上操作目标应用');});},
  'reset-frames':()=>{requireTarget();return task('frames',async()=>{if(!state.demo)await api('/frames/reset',{serial:state.serial,packageName:state.packageName});state.frames=null;toast('帧统计已重置，请在目标应用中重现操作后读取');});},
  'run-startup':()=>{requireTarget();const n=Number($('#startup-runs').value);if(!Number.isInteger(n)||n<1||n>10)throw new Error('重复次数须为 1–10 的整数');state.runs=n;state.startupMode=$('#startup-mode').value;return task('startup',async()=>{state.startup=state.demo?demoStartup(state.startupMode,n):await api('/startup',{serial:state.serial,packageName:state.packageName,mode:state.startupMode,runs:n});toast('启动实验已完成');});},
  'capture-layout':()=>{requireTarget(false);return task('layout',async()=>{state.layout=state.demo?demoLayout():await api('/layout',{serial:state.serial});state.nodes=buildNodes(state.layout.xml);state.selectedNode=0;toast(`已读取 ${state.nodes.length} 个可访问性节点`);});},
  'capture-trace':()=>{requireTarget(false);if(state.demo)throw new Error('请连接真实设备后录制追踪');const seconds=Number($('#trace-seconds').value);return task('trace',async()=>{const blob=await api('/trace',{serial:state.serial,seconds},true);download(blob,`capture-${Date.now()}.perfetto-trace`);toast('追踪已完成并下载');});},
  'save-monitor':()=>save('monitor'),'save-frames':()=>save('frames'),'save-startup':()=>save('startup'),'save-layout':()=>save('layout'),'save-network':()=>save('network'),
  'refresh-sessions':async()=>{await refreshSessions();render();toast('记录列表已刷新');},
  'import-har':()=>pickFile(async(text,file)=>{state.network={source:'import',fileName:file.name,rows:parseHar(JSON.parse(text))};state.networkFilter='';state.route='network';location.hash='network';render();toast(`已导入 ${state.network.rows.length} 条请求，敏感字段已丢弃`);},'.har,.json'),
  'import-baseline':()=>importBenchmark('baseline'),'import-current':()=>importBenchmark('current'),
  'import-session':()=>pickFile(async text=>{const doc=JSON.parse(text);if(doc.schemaVersion!==1||!doc.payload)throw new Error('不是受支持的工作台采集记录（schemaVersion: 1）');await api('/sessions',{...doc,source:['demo','adb','import'].includes(doc.source)?doc.source:'import'});await refreshSessions();state.route='sessions';location.hash='sessions';render();toast('采集记录已导入本机档案');}),
  'import-layout':()=>pickFile(async text=>{const nodes=buildNodes(text);state.layout={source:'import',timestamp:Date.now(),xml:text,screenshot:null};state.nodes=nodes;state.selectedNode=0;render();toast('层级 XML 已导入');},'.xml'),
  'import-frames':()=>pickFile(async text=>{const response=await importFramesLocally(text);state.frames=response;render();toast(`导入 ${response.count} 个有效帧`);},'.txt'),
};
function importBenchmark(key){pickFile(async(text,file)=>{state[key]={...parseBenchmark(JSON.parse(text)),fileName:file.name};render();toast(`${key==='baseline'?'基线':'当前运行'}已导入`);});}
// Keep gfxinfo parsing on the server for device and file inputs alike.
async function importFramesLocally(text){return api('/frames/import',{text,budget:state.budget});}

document.addEventListener('click',async event=>{
  const apkTab=event.target.closest('[data-apk-tab]');if(apkTab){state.apkTab=apkTab.dataset.apkTab;render();return;}
  const apkCategory=event.target.closest('[data-apk-category]');if(apkCategory){state.apkCategory=apkCategory.dataset.apkCategory;state.apkTab='files';state.apkFilter='';render();return;}
  const apkFile=event.target.closest('[data-apk-file]');if(apkFile){const file=state.apk.files[Number(apkFile.dataset.apkFile)];showDialog(file.path,`<pre>${esc(JSON.stringify(file,null,2))}</pre>`);return;}
  const apkComponent=event.target.closest('[data-apk-component]');if(apkComponent){const c=state.apk.manifest.components[Number(apkComponent.dataset.apkComponent)];showDialog(c.name,`<pre>${esc(JSON.stringify(c,null,2))}</pre>`);return;}
  const action=event.target.closest('[data-action]');
  if(action&&!action.disabled&&actions[action.dataset.action]){try{await actions[action.dataset.action]();}catch(error){toast(error.message,true);}return;}
  const node=event.target.closest('[data-node]');if(node){selectNode(Number(node.dataset.node));return;}
  const preview=event.target.closest('#phone-preview');if(preview){const rect=preview.getBoundingClientRect(),[width,height]=layoutSize(),x=(event.clientX-rect.left-preview.clientLeft)/preview.clientWidth*width,y=(event.clientY-rect.top-preview.clientTop)/preview.clientHeight*height;const hits=state.nodes.filter(n=>n.bounds&&x>=n.bounds[0]&&x<=n.bounds[2]&&y>=n.bounds[1]&&y<=n.bounds[3]);if(hits.length)selectNode(hits.at(-1).id);return;}
  const session=event.target.closest('[data-session]');if(session){try{inspectSession(await api(`/sessions/${session.dataset.session}`));}catch(error){toast(error.message,true);}return;}
  const request=event.target.closest('[data-request]');if(request){const row=state.network.rows.find(r=>r.id===Number(request.dataset.request));showDialog(`${row.method} ${row.path}`,`<pre>${esc(JSON.stringify(row,null,2))}</pre><p class="hint">timings 的单位为 ms。ssl 是 connect 的子阶段，不应重复相加。</p>`);}
});
document.addEventListener('change',event=>{
  if(event.target.id==='apk-category'){state.apkCategory=event.target.value;$('#apk-file-table').innerHTML=apkFileTable();}
  if(event.target.id==='apk-component-type'){state.apkComponent=event.target.value;$('#apk-component-table').innerHTML=apkComponentTable();}
  if(event.target.id==='interval-select')state.interval=Number(event.target.value);
  if(event.target.id==='startup-mode')state.startupMode=event.target.value;
  if(event.target.id==='startup-runs')state.runs=Number(event.target.value);
  if(event.target.id==='budget-select'){state.budget=Number(event.target.value);if(state.frames){const f=state.frames;f.budgetMs=state.budget;f.frames.forEach(row=>row.overBudget=row.durationMs>state.budget);f.slow=f.frames.filter(r=>r.overBudget).length;f.slowPercent=f.count?f.slow/f.count*100:null;}render();}
});
document.addEventListener('input',event=>{if(event.target.id==='network-search'){state.networkFilter=event.target.value;$('#network-table').innerHTML=networkTable();}if(event.target.id==='apk-search'){state.apkFilter=event.target.value;$('#apk-file-table').innerHTML=apkFileTable();}});
document.addEventListener('load',event=>{if(event.target.matches?.('#phone-preview img')&&state.selectedNode!==null)selectNode(state.selectedNode);},true);
$('#mode-btn').onclick=()=>toggleDemo().catch(error=>toast(error.message,true));
$('#refresh-devices').innerHTML=icon('refresh',16);$('#device-icon').innerHTML=icon('phone',18);
$('#refresh-devices').onclick=()=>{if(state.busy.size){toast('请等待当前采集任务完成',true);return;}if(state.demo){toast('请先退出演示，再刷新真实设备');return;}fetchDevices();};
$('#device-select').onchange=async event=>{if(state.busy.size){event.target.value=state.serial;toast('请等待当前采集任务完成后切换设备',true);return;}resetEvidence();state.serial=event.target.value;state.info=null;$('#package-list').innerHTML='';render();if(state.serial)await loadDevice();};
$('#package-input').onchange=event=>{if(state.busy.size){event.target.value=state.packageName;toast('请等待当前采集任务完成后切换应用',true);return;}const pkg=event.target.value.trim();if(pkg!==state.packageName){resetEvidence();state.packageName=pkg;localStorage.setItem('apw-package',pkg);render();}};
$('#file-input').onchange=async event=>{const file=event.target.files[0];if(!file)return;try{if(file.size>12*1024*1024)throw new Error('文件超过 12 MB 限制');await importHandler(await file.text(),file);}catch(error){toast(error.message,true);}};
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
render();
await Promise.allSettled([api('/status').then(data=>{state.status=data;if(state.route==='settings')render();}),refreshSessions().then(()=>{if(['overview','sessions'].includes(state.route))render();}),fetchDevices()]);
