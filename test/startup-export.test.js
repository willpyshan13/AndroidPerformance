import test from 'node:test';
import assert from 'node:assert/strict';
import { startupExperimentCsv, startupExperimentJson } from '../public/startup-export.js';

const experiment = () => ({
  source: 'adb', timestamp: 1234, serial: 'device-1', packageName: 'com.example.app', requestedMode: 'cold', compilationMode: 'speed-profile',
  compilationAction: { mode: 'speed-profile', applied: true, output: 'Success' },
  results: [
    { run: 1, status: 'ok', observedMode: 'cold', activity: 'com.example.app/.MainActivity', totalTimeMs: 320, thisTimeMs: 280, waitTimeMs: 40, raw: 'Status: ok\nTotalTime: 320' },
    { run: 2, status: 'ok', observedMode: null, activity: null, totalTimeMs: 280, thisTimeMs: 250, waitTimeMs: 30, raw: '=unsafe' },
  ],
  compilationBefore: { available: true, entries: [{ path: '/base.apk', status: 'verify' }] },
  compilationAfter: { available: true, entries: [{ path: '/base.apk', status: 'speed-profile' }] },
});

test('startup JSON report retains per-run raw evidence, context and descriptive summary', () => {
  const report = JSON.parse(startupExperimentJson(experiment()));
  assert.equal(report.schema, 'android-performance.startup-experiment-report');
  assert.equal(report.context.packageName, 'com.example.app');
  assert.equal(report.context.compilationAction.applied, true);
  assert.equal(report.summary.count, 2);
  assert.equal(report.summary.p50, 300);
  assert.equal(report.runs[1].raw, '=unsafe');
  assert.equal(report.compilationBefore.entries[0].status, 'verify');
  assert.match(report.evidenceLimit, /not TTFD/);
});

test('startup CSV has a BOM, quotes raw output and neutralizes spreadsheet formulas', () => {
  const csv = startupExperimentCsv(experiment());
  assert.ok(csv.startsWith('\uFEFF"run","package"'));
  assert.match(csv, /"Status: ok\nTotalTime: 320"/);
  assert.match(csv, /"'=unsafe"/);
});

test('startup exporters enforce run and measurement bounds', () => {
  assert.throws(() => startupExperimentJson({ ...experiment(), results: Array.from({ length: 11 }, (_, i) => ({ run: i + 1, status: 'ok', totalTimeMs: 1 })) }), /10 次/);
  assert.throws(() => startupExperimentCsv({ ...experiment(), requestedMode: 'unknown' }), /包名或请求模式/);
  assert.throws(() => startupExperimentJson({ ...experiment(), results: [{ run: 1, status: 'ok', totalTimeMs: -1 }] }), /轮次数据无效/);
});
