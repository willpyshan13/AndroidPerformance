import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { Adb, locateAdb, validateTarget } from '../src/adb.js';
import { createApp } from '../src/server.js';
import { parseHar, parseBenchmark, compareBenchmarks } from '../public/offline.js';

const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
if (!args.includes('--serial') || !args.includes('--package')) {
  console.error('Usage: npm run test:device -- --serial SERIAL --package PACKAGE [--allow-app-control] [--out DIR]');
  process.exit(2);
}
const serial = option('--serial'), packageName = option('--package');
validateTarget(serial, packageName);
const control = args.includes('--allow-app-control');
const outDir = resolve(args.includes('--out') ? option('--out') : `data/device-test-${Date.now()}`);
await mkdir(outDir, { recursive: true });
const adb = new Adb(await locateAdb());
const token = randomBytes(24).toString('hex');
const server = createApp({ adb, token, dataDir: join(outDir, 'records') });
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const query = new URLSearchParams({ serial, package: packageName });
const report = { startedAt: new Date().toISOString(), serial, packageName, allowAppControl: control, tests: [] };
const evidence = {};
async function request(path, body, binary = false) {
  const response = await fetch(`${origin}/api${path}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-Workbench-Token': token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) throw new Error((await response.json()).error);
  return binary ? Buffer.from(await response.arrayBuffer()) : response.json();
}
async function check(name, work) {
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
    for (const [kind, payload] of Object.entries(evidence)) {
      const record = await request('/sessions', { kind, source: kind === 'network' ? 'import' : 'adb', payload, name: `设备全功能测试 · ${kind}`, packageName });
      const loaded = await request(`/sessions/${record.id}`); assert.deepEqual(loaded.payload, payload);
      saved.push({ kind, id: record.id });
    }
    const list = await request('/sessions'); assert.equal(list.sessions.length, saved.length);
    return { saved };
  });
  await check('temporary-files-cleanup', async () => {
    const files = await adb.shell(serial, ['ls', '/data/local/tmp']);
    assert(!files.split(/\s+/).some(f => /^apw-[\da-f-]+\.xml$/.test(f)));
    assert.equal(adb.busy.size, 0); return { deviceXmlCleaned: true, captureLocksReleased: true };
  });
} finally {
  report.finishedAt = new Date().toISOString();
  report.summary = report.tests.reduce((s, t) => ({ ...s, [t.status]: (s[t.status] || 0) + 1 }), {});
  await writeFile(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`REPORT ${outDir}/report.json ${JSON.stringify(report.summary)}`);
  await new Promise(r => server.close(r));
  process.exitCode = report.tests.some(t => t.status === 'fail') ? 1 : 0;
}
