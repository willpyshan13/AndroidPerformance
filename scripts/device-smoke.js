import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { Adb, locateAdb, validateTarget } from '../src/adb.js';
import { createApp } from '../src/server.js';
import { parseHar, parseBenchmark, compareBenchmarks, parseFoldedStacks, buildSampleTimeline, sampleStackTimeline, parseArtMethodTrace } from '../public/offline.js';

const args = process.argv.slice(2);
const option = name => { const index=args.indexOf(name);return index<0?undefined:args[index+1]; };
if (!args.includes('--serial') || !args.includes('--package')) {
  console.error('Usage: npm run test:device -- --serial SERIAL --package PACKAGE [--allow-app-control] [--exercise-ui] [--only heap-capture-and-analysis|profiling] [--out DIR]');
  process.exit(2);
}
const serial = option('--serial'), packageName = option('--package');
validateTarget(serial, packageName);
const control = args.includes('--allow-app-control');
const exerciseUi=control&&args.includes('--exercise-ui');
const only = option('--only');
const profilingChecks=new Set(['target-app-launch','cpu-profile-capture','cpu-profile-analysis','art-method-trace-capture-and-analysis','frames-read','frames-text-import','cpu-profile-archive-persistence','temporary-files-cleanup']);
if (only && !['heap-capture-and-analysis','profiling'].includes(only)) throw new Error(`Unsupported --only check: ${only}`);
const outDir = resolve(args.includes('--out') ? option('--out') : `data/device-test-${Date.now()}`);
await mkdir(outDir, { recursive: true });
const adb = new Adb(await locateAdb());
const token = randomBytes(24).toString('hex');
const server = createApp({ adb, token, dataDir: join(outDir, 'records') });
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const query = new URLSearchParams({ serial, package: packageName });
const report = { startedAt: new Date().toISOString(), serial, packageName, allowAppControl: control, exerciseUi, only:only||null, tests: [] };
const evidence = {};
let capturedPerfData = null;
async function request(path, body, binary = false) {
  const response = await fetch(`${origin}/api${path}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-Workbench-Token': token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) throw new Error((await response.json()).error);
  return binary ? Buffer.from(await response.arrayBuffer()) : response.json();
}
async function check(name, work) {
  if (only && (only==='profiling'?!profilingChecks.has(name):name!==only)) { report.tests.push({ name, status: 'skipped', reason: `--only ${only}` }); return; }
  const start = Date.now();
  try {
    const detail = await work();
    const result = { name, status: detail?.status || 'pass', elapsedMs: Date.now() - start, ...detail };
    report.tests.push(result); console.log(`${result.status.toUpperCase()} ${name}: ${JSON.stringify(detail || {})}`);
  } catch (error) {
    report.tests.push({ name, status: 'fail', elapsedMs: Date.now() - start, error: error.message });
    console.log(`FAIL ${name}: ${error.message}`);
  }
  await writeFile(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
}
try {
  await check('device-discovery', async () => {
    const { devices } = await request('/devices'); assert(devices.some(d => d.serial === serial && d.state === 'device'));
    report.device = await request(`/device?${query}`); return report.device;
  });
  await check('package-discovery', async () => {
    const { packages } = await request(`/packages?${query}`); assert(packages.includes(packageName)); return { count: packages.length, targetFound: true };
  });
  if (control) {
    await check('target-app-launch', async () => {
      const startup = await request('/startup', { serial, packageName, mode: 'warm', runs: 1 });
      assert.equal(startup.source, 'adb'); assert.equal(startup.results.length, 1);
      assert.equal(startup.results[0].status, 'ok'); assert(startup.results[0].totalTimeMs !== null);
      return { componentLaunchSucceeded: true, totalTimeMs: startup.results[0].totalTimeMs, observedMode: startup.results[0].observedMode };
    });
  }
  await check('battery-snapshot', async () => {
    const snapshot = await request('/battery/snapshot', { serial, packageName });
    assert.equal(snapshot.source, 'adb'); assert.equal(snapshot.serial, serial);
    evidence.battery=snapshot;await writeFile(join(outDir,'battery.json'),JSON.stringify(snapshot,null,2));
    return { uid: snapshot.uid, packages: snapshot.packages, power: snapshot.power, network: snapshot.network, wakelocks: snapshot.wakelocks?.length || 0, deviceBattery: snapshot.battery, sessionStartAvailable: snapshot.sessionStart !== null };
  });
  await check('compilation-state', async () => {
    const state = await request(`/compilation?${query}`);
    assert.equal(state.source, 'adb'); assert.equal(state.serial, serial); assert.equal(state.packageName, packageName);
    return { available: state.available, entries: state.entries?.length || 0, reason: state.reason || null };
  });
  await check('battery-checkin-export',async()=>{
    const raw=await request('/battery/checkin',{serial,packageName},true);assert(raw.length>0);
    await writeFile(join(outDir,'batterystats-checkin.csv'),raw);return {bytes:raw.length};
  });
  await check('cpu-event-discovery', async () => {
    const result = await request('/cpu-events', { serial });
    assert.equal(result.source, 'simpleperf list'); assert(Array.isArray(result.events) && result.events.length > 0);
    return { count: result.events.length, sample: result.events.slice(0, 8), traceOffCpuAvailable: result.traceOffCpuAvailable };
  });
  await check('cpu-profile-capture', async () => {
    let data;
    const seconds=exerciseUi?8:3;let cycles=0;
    try {
      let component=null;if(exerciseUi){const resolved=await adb.shell(serial,['cmd','package','resolve-activity','--brief',packageName]);component=resolved.trim().split(/\r?\n/).find(s=>/^[\w.]+\/[\w.$]+$/.test(s));assert(component,'无法解析用于页面活动测试的启动组件');}
      let done=false,workloadError=null;const capture=request('/cpu-profile', { serial, packageName, captureId: randomUUID(), seconds, events: ['cpu-clock:u'], frequencyHz: 99, callGraph: 'fp' }, true).finally(()=>{done=true;});
      const workload=exerciseUi?(async()=>{while(!done){await adb.shell(serial,['input','keyevent','3']);await new Promise(r=>setTimeout(r,300));await adb.shell(serial,['am','start','-W','-n',component]);cycles++;await new Promise(r=>setTimeout(r,300));}})().catch(error=>{workloadError=error;}):Promise.resolve();
      try{data=await capture;}finally{done=true;await workload;}
      if(workloadError)throw workloadError;
    }
    catch (error) {
      if (/doesn't exist or isn't debuggable\/profileable/i.test(error.message)) return { status: 'unsupported', reason: error.message };
      throw error;
    }
    assert(data.length > 256); assert.equal(data.subarray(0, 8).toString('ascii'), 'PERFILE2');
    capturedPerfData = data;
    await writeFile(join(outDir, 'cpu.perf.data'), data);
    return { bytes: data.length, signature: data.subarray(0, 8).toString('ascii'), sampleEvent: 'cpu-clock:u', durationSeconds: seconds,uiResumeCycles:cycles };
  });
  await check('cpu-profile-analysis', async () => {
    assert(capturedPerfData, 'CPU 采样没有生成可分析的 perf.data');
    const response = await fetch(`${origin}/api/cpu-profile/analyze`, { method: 'POST', headers: { 'X-Workbench-Token': token, 'X-Perf-Event': encodeURIComponent('cpu-clock:u') }, body: capturedPerfData });
    const result = await response.json();
    if (!response.ok && /没有可用调用栈|没有可用样本/.test(result.error || '')) {
      await writeFile(join(outDir, 'cpu-analysis.json'), JSON.stringify({ status: 'unsupported', reason: '设备采样文件有效，但目标应用在本次短采样窗口内没有可解析的 CPU 样本', analyzerMessage: result.error }, null, 2));
      return { status: 'unsupported', reason: '设备采样文件有效，但目标应用在本次短采样窗口内没有可解析的 CPU 样本', analyzerMessage: result.error };
    }
    if (!response.ok) throw new Error(result.error || 'simpleperf 解析失败');
    const profile = parseFoldedStacks(result.folded);
    assert(profile.root.weight > 0, '折叠调用栈没有有效采样权重');
    const timeline = result.timeline ? buildSampleTimeline(result.timeline) : null;
    if (!timeline?.available || !timeline.samples.length) return { status: 'unsupported', reason: '折叠调用栈可读，但真实样本不足以构建时间线' };
    const projection = sampleStackTimeline(timeline);
    assert(projection.renderedSamples > 0);
    evidence.cpuProfile = { stacks: profile.stacks, weight: profile.root.weight, symbols: profile.symbols.length, samples: timeline.samples.length, renderedSamples: projection.renderedSamples, event: timeline.event, clockId: timeline.clockId, warning: result.warning };
    await writeFile(join(outDir, 'cpu-analysis.json'), JSON.stringify(evidence.cpuProfile, null, 2));
    return evidence.cpuProfile;
  });
  await check('gpu-capabilities', async () => {
    const result = await request('/gpu/capabilities', { serial });
    assert.equal(result.source, 'adb'); assert.equal(result.serial, serial);
    return { vulkanVersion: result.vulkanVersion, glesVersion: result.glesVersion, featureListAvailable: result.featureListAvailable, warnings: result.warnings };
  });
  if(control)await check('art-method-trace-capture-and-analysis',async()=>{
    const data=await request('/cpu-profile/art-trace',{serial,packageName,captureId:randomUUID(),seconds:3,samplingIntervalUs:1000},true);
    await writeFile(join(outDir,'art-method.trace'),data);const parsed=parseArtMethodTrace(data);
    const {intervals,methods,...summary}=parsed;await writeFile(join(outDir,'art-method-analysis.json'),JSON.stringify({...summary,methods:methods.slice(0,1000),intervals:intervals.slice(0,2000)},null,2));
    return {bytes:data.length,version:parsed.version,events:parsed.eventCount,methods:parsed.methodCount,threads:parsed.threadCount,completedCalls:parsed.completedCalls};
  });
  await check('live-monitor', async () => {
    const samples = [];
    for (let i = 0; i < 3; i++) { samples.push(await request(`/metrics?${query}`)); if (i < 2) await new Promise(r => setTimeout(r, 2000)); }
    assert(samples.every(s => s.source === 'adb' && s.pid && s.memory?.pssMb > 0));
    assert(samples[2].timestamp > samples[0].timestamp);
    evidence.monitor = { samples };
    await writeFile(join(outDir, 'monitor.json'), JSON.stringify(evidence.monitor, null, 2));
    return { samples: samples.length, pssMb: samples.map(s => s.memory.pssMb), cpu: samples.map(s => s.cpu?.percent ?? null), cpuSource: samples.map(s => s.cpu?.method ?? 'dumpsys'), battery: samples.at(-1).battery, warnings: samples.at(-1).warnings };
  });
  await check('cpu-live-values', async () => {
    const samples = evidence.monitor?.samples || [];
    const valid = samples.filter(s => typeof s.cpu?.percent === 'number' && Number.isFinite(s.cpu.percent));
    assert(valid.length >= 2, '连续 3 次采样中应至少有 2 个有效 CPU 值');
    return { values: valid.map(s => s.cpu.percent), method: valid.at(-1).cpu.method, scope: valid.at(-1).cpu.scope };
  });
  await check('frames-read', async () => {
    const frames = await request(`/frames?${query}`); assert(frames.count > 0); assert(frames.frames.every(r => r.durationMs > 0));
    evidence.frames = frames;
    await writeFile(join(outDir, 'gfxinfo.txt'), frames.raw);
    return { count: frames.count, p95: frames.p95, slowPercent: frames.slowPercent };
  });
  await check('frames-text-import', async () => {
    const text = evidence.frames?.raw || await readFile(new URL('../fixtures/gfxinfo.txt', import.meta.url), 'utf8');
    const parsed = await request('/frames/import', { text, budget: 16.667 });
    if (evidence.frames) assert.equal(parsed.count, evidence.frames.count);
    assert.equal(parsed.source, 'import'); return { count: parsed.count };
  });
  await check('layout-and-screenshot', async () => {
    const layout = await request('/layout', { serial });
    assert(layout.xml.includes('<hierarchy')); assert(layout.screenshot, layout.warning || '没有截图');
    const png = Buffer.from(layout.screenshot, 'base64'); assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    const nodes = (layout.xml.match(/<node\b/g) || []).length; assert(nodes > 0);
    await writeFile(join(outDir, 'layout.xml'), layout.xml); await writeFile(join(outDir, 'screen.png'), png);
    evidence.layout = layout; return { nodes, screenshotBytes: png.length, warning: layout.warning };
  });
  if (control) {
    await check('heap-capture-and-analysis', async () => {
      const data = await request('/heap', { serial, packageName }, true);
      assert(data.subarray(0, 32).toString('ascii').startsWith('JAVA PROFILE 1.0.'));
      await writeFile(join(outDir,'heap.hprof'),data);
      const response = await fetch(`${origin}/api/heap/analyze`, { method: 'POST', headers: { 'X-Workbench-Token': token, 'X-Heap-Role': 'current' }, body: data });
      const analysis = await response.json();
      if (!response.ok) throw new Error(analysis.error || 'HPROF 分析失败');
      await writeFile(join(outDir,'heap-analysis.json'),JSON.stringify(analysis,null,2));
      assert(analysis.objects > 0); assert(analysis.sessionId);
      const dominators = await request('/heap/dominators', { sessionId: analysis.sessionId, limit: 25 });
      assert(dominators.indexed > 0); assert(dominators.reachable > 0); assert(Array.isArray(dominators.items));
      let shark = null;
      if (analysis.sharkAvailable) {
        const sharkResponse = await fetch(`${origin}/api/heap/shark-analysis`, { method: 'POST', headers: { 'X-Workbench-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: analysis.sessionId }) });
        shark = await sharkResponse.json();
        await writeFile(join(outDir,'heap-shark.json'),JSON.stringify(shark,null,2));
        if (!sharkResponse.ok) throw new Error(shark.error || 'Shark 分析失败');
        assert.equal(shark.success, true);
      }
      evidence.heap = { bytes: data.length, objects: analysis.objects, classes: analysis.classes?.length, dominators: { indexed: dominators.indexed, reachable: dominators.reachable, edges: dominators.edgeCount, rootItems: dominators.items.length, incomplete: dominators.incomplete, edgeLimitReached: dominators.edgeLimitReached } };
      return { ...evidence.heap, sharkAvailable: analysis.sharkAvailable, shark: shark && { success: shark.success, version: shark.version, durationMs: shark.durationMs } };
    });
  }
  await check('perfetto-capture', async () => {
    let available = false;
    try { available = !!(await adb.shell(serial, ['which', 'perfetto'])).trim(); } catch {}
    if (!available) {
      await assert.rejects(request('/trace', { serial, seconds: 3 }));
      return { status: 'unsupported', api: report.device?.api, reason: '设备没有 perfetto 可执行程序；采集请求正确返回错误' };
    }
    const data = await request('/trace', { serial, seconds: 3 }, true); assert(data.length > 0);
    await writeFile(join(outDir, 'capture.perfetto-trace'), data); return { bytes: data.length };
  });
  if (control) {
    await check('frames-reset', async () => { await request('/frames/reset', { serial, packageName }); const frames = await request(`/frames?${query}`); return { remainingFrames: frames.count, message: '重置调用成功；新产生的渲染帧可能已进入缓冲区' }; });
    for (const mode of ['cold', 'warm', 'hot']) {
      await check(`startup-${mode}`, async () => {
        const startup = await request('/startup', { serial, packageName, mode, runs: 2 });
        assert.equal(startup.results.length, 2); assert(startup.results.every(r => r.status === 'ok' && r.totalTimeMs !== null));
        evidence.startup = startup;
        await writeFile(join(outDir, `startup-${mode}.json`), JSON.stringify(startup, null, 2));
        return { requestedMode: mode, timesMs: startup.results.map(r => r.totalTimeMs), observedModes: startup.results.map(r => r.observedMode), meanMs: startup.meanMs };
      });
    }
  } else report.tests.push({ name: 'startup-and-reset', status: 'skipped', reason: '--allow-app-control 未指定' });
  await check('har-import-and-redaction', async () => {
    const document = JSON.parse(await readFile(new URL('../fixtures/network.har', import.meta.url), 'utf8'));
    const rows = parseHar(document); assert.equal(rows.length, 2); assert(!JSON.stringify(rows).includes('fixture-secret'));
    evidence.network = { source: 'import', rows }; return { count: rows.length, secretsDiscarded: true };
  });
  await check('benchmark-comparison', async () => {
    const [baseline, current] = await Promise.all(['baseline', 'current'].map(async name => parseBenchmark(JSON.parse(await readFile(new URL(`../fixtures/benchmark-${name}.json`, import.meta.url), 'utf8')))));
    const rows = compareBenchmarks(baseline, current); assert.equal(rows.length, 2); assert.equal(rows[0].delta, -15); assert(Math.abs(rows[1].delta - 5) < 1e-10);
    return { deltas: rows.map(r => ({ metric: r.metric, percent: r.delta })) };
  });
  await check('all-record-kinds-persistence', async () => {
    const saved = [];
    const recordKinds = new Set(['monitor', 'frames', 'startup', 'layout', 'network', 'apk', 'battery', 'benchmark']);
    for (const [kind, payload] of Object.entries(evidence).filter(([kind]) => recordKinds.has(kind))) {
      const record = await request('/sessions', { kind, source: kind === 'network' ? 'import' : 'adb', payload, name: `设备全功能测试 · ${kind}`, packageName });
      const loaded = await request(`/sessions/${record.id}`); assert.deepEqual(loaded.payload, payload);
      saved.push({ kind, id: record.id });
    }
    const list = await request('/sessions'); assert.equal(list.sessions.length, saved.length);
    return { saved };
  });
  await check('cpu-profile-archive-persistence', async () => {
    assert(capturedPerfData, 'CPU 采样没有生成可保存的 perf.data');
    const upload = await fetch(`${origin}/api/cpu-profile/archive`, { method: 'POST', headers: { 'X-Workbench-Token': token, 'X-File-Name': 'device-smoke.trace' }, body: capturedPerfData });
    const archive = await upload.json(); assert.equal(upload.status, 201, archive.error);
    const archives = await request('/cpu-profile/archives'); assert(archives.archives.some(item => item.id === archive.id));
    const loaded = await fetch(`${origin}/api/cpu-profile/archive/load`, { method: 'POST', headers: { 'X-Workbench-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: archive.id }) });
    assert.equal(loaded.status, 200); assert.deepEqual(Buffer.from(await loaded.arrayBuffer()), capturedPerfData);
    return { archiveId: archive.id, bytes: capturedPerfData.length, integrityVerified: true };
  });
  await check('temporary-files-cleanup', async () => {
    const files = await adb.shell(serial, ['ls', '/data/local/tmp']);
    assert(!files.split(/\s+/).some(f => /^apw-[\da-f-]+\.xml$/.test(f)));
    assert.equal(adb.busy.size, 0); return { deviceXmlCleaned: true, captureLocksReleased: true };
  });
} finally {
  report.finishedAt = new Date().toISOString();
  report.summary = report.tests.reduce((s, t) => ({ ...s, [t.status]: (s[t.status] || 0) + 1 }), {});
  if (only && !report.tests.some(t => (only==='profiling'?profilingChecks.has(t.name):t.name===only) && ['pass','fail','unsupported'].includes(t.status))) {
    report.tests.push({ name: only, status: 'fail', error: 'Selected device smoke check did not run; pass --allow-app-control.' });
    report.summary.fail = (report.summary.fail || 0) + 1;
  }
  await writeFile(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`REPORT ${outDir}/report.json ${JSON.stringify(report.summary)}`);
  await new Promise(r => server.close(r));
  process.exitCode = report.tests.some(t => t.status === 'fail') ? 1 : 0;
}
