import { startupRunSummary } from './offline.js';

const MAX_STARTUP_RUNS = 10;

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function validExperiment(result) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.results) || result.results.length > MAX_STARTUP_RUNS) throw new Error('启动实验报告格式无效或超过 10 次运行上限');
  if (!['cold', 'warm', 'hot'].includes(result.requestedMode) || typeof result.packageName !== 'string' || !result.packageName) throw new Error('启动实验报告缺少包名或请求模式');
  for (const row of result.results) {
    if (!row || !Number.isInteger(row.run) || row.run < 1 || !['ok', 'unknown'].includes(row.status) || (row.totalTimeMs !== null && (!Number.isFinite(row.totalTimeMs) || row.totalTimeMs < 0))) throw new Error('启动实验轮次数据无效');
  }
  return result;
}

export function startupExperimentCsv(input) {
  const result = validExperiment(input);
  const header = ['run', 'package', 'device_serial', 'requested_mode', 'observed_mode', 'compilation_mode', 'status', 'activity', 'total_time_ms', 'this_time_ms', 'wait_time_ms', 'raw_output'];
  const rows = result.results.map(row => [row.run, result.packageName, result.serial, result.requestedMode, row.observedMode, result.compilationMode, row.status, row.activity, row.totalTimeMs, row.thisTimeMs, row.waitTimeMs, row.raw]);
  return `\uFEFF${[header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}${rows.length ? '\r\n' : ''}`;
}

export function startupExperimentJson(input) {
  const result = validExperiment(input);
  const report = {
    schema: 'android-performance.startup-experiment-report',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    context: {
      source: result.source || null,
      timestamp: Number.isFinite(result.timestamp) ? result.timestamp : null,
      packageName: result.packageName,
      serial: result.serial || null,
      requestedMode: result.requestedMode,
      compilationMode: result.compilationMode || null,
      compilationAction: result.compilationAction || null,
      note: typeof result.note === 'string' ? result.note : null,
    },
    summary: startupRunSummary(result.results),
    runs: result.results.map(row => ({ run: row.run, status: row.status, observedMode: row.observedMode || null, activity: row.activity || null, totalTimeMs: row.totalTimeMs, thisTimeMs: row.thisTimeMs ?? null, waitTimeMs: row.waitTimeMs ?? null, raw: row.raw || '' })),
    compilationBefore: result.compilationBefore || null,
    compilationAfter: result.compilationAfter || null,
    evidenceLimit: 'TotalTime is reported by am start -W and is not TTFD. Compilation state is system output and does not prove a Baseline Profile is installed or effective.',
  };
  const serialized = JSON.stringify(report, null, 2);
  if (new TextEncoder().encode(serialized).byteLength > 4 * 1024 * 1024) throw new Error('启动实验 JSON 报告超过 4 MiB');
  return `${serialized}\n`;
}
