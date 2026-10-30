export function parseHar(document) {
  const entries = document?.log?.entries;
  if (!Array.isArray(entries)) throw new Error('不是有效的 HAR 文件，缺少 log.entries');
  if (entries.length > 50000) throw new Error('HAR 请求数超过 50,000 条限制');
  return entries.map((entry, i) => {
    let url;
    try { url = new URL(entry.request?.url); } catch { throw new Error(`HAR 第 ${i + 1} 条请求 URL 无效`); }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`HAR 第 ${i + 1} 条 URL 协议不支持`);
    const timings = {};
    for (const key of ['blocked', 'dns', 'connect', 'ssl', 'send', 'wait', 'receive']) {
      const n = entry.timings?.[key]; timings[key] = typeof n === 'number' && n >= 0 ? n : null;
    }
    return { id: i + 1, method: String(entry.request?.method || 'GET'), host: url.host, path: url.pathname,
      // Discard queries, URL credentials, headers, cookies and bodies on import.
      url: `${url.protocol}//${url.host}${url.pathname}`, status: Number(entry.response?.status || 0),
      timeMs: typeof entry.time === 'number' && entry.time >= 0 ? entry.time : null,
      bytes: typeof entry.response?.content?.size === 'number' && entry.response.content.size >= 0 ? entry.response.content.size : null,
      startedAt: Date.parse(entry.startedDateTime) || null, timings };
  });
}

export function parseBenchmark(document) {
  if (!Array.isArray(document?.benchmarks)) throw new Error('不是 AndroidX Benchmark JSON，缺少 benchmarks');
  const results = [];
  for (const benchmark of document.benchmarks) {
    for (const field of ['metrics', 'sampledMetrics']) {
      for (const [metric, value] of Object.entries(benchmark[field] || {})) {
        const runs = Array.isArray(value.runs) ? value.runs.flat().filter(n => typeof n === 'number' && Number.isFinite(n)) : [];
        const median = typeof value.median === 'number' && Number.isFinite(value.median) ? value.median : runs.length ? [...runs].sort((a,b)=>a-b)[Math.floor(runs.length / 2)] : null;
        if (median !== null) results.push({ key: `${benchmark.className || ''}#${benchmark.name || 'benchmark'}:${metric}`, name: benchmark.name || 'benchmark', className: benchmark.className || '', metric, median, runs: runs.length });
      }
    }
  }
  if (!results.length) throw new Error('文件中没有可读取的 Benchmark 指标');
  return { context: document.context || {}, results };
}

export function compareBenchmarks(baseline, current) {
  const map = new Map(baseline.results.map(r => [r.key, r]));
  return current.results.map(row => {
    const before = map.get(row.key);
    return { ...row, baseline: before?.median ?? null, delta: before && before.median !== 0 ? (row.median - before.median) / Math.abs(before.median) * 100 : null };
  });
}
