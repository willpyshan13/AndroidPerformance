const MAX_RAW_BYTES = 8 * 1024 * 1024;
const LINE = /^\s*(\d{9,}(?:\.\d+)?)\s+(\d+)\s+\d+\s+[VDIWEF]\s+(APWJank|APWJankFrame)\s*:\s*(\{.{1,12000}\})\s*$/;

function boundedString(value, max = 240) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : '';
}
function integer(value, max = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && value >= 0 && value <= max ? value : null;
}
function signedInteger(value) {
  return Number.isSafeInteger(value) ? value : null;
}
function exactLong(value) {
  if (typeof value === 'string' && /^\d{1,19}$/.test(value) && BigInt(value) <= 9223372036854775807n) return value;
  return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
}
function parseAggregate(value, pid, logTimestamp) {
  let row;
  try { row = JSON.parse(value); } catch { return null; }
  if (!row || row.version !== 1 || !Number.isSafeInteger(row.frameCount) || row.frameCount < 1 || row.frameCount > 1000000) return null;
  const jankCount = integer(row.jankCount, row.frameCount), durationTotalNs = integer(row.durationTotalNs), durationMinNs = integer(row.durationMinNs), durationMaxNs = integer(row.durationMaxNs);
  if (jankCount === null || durationTotalNs === null || durationMinNs === null || durationMaxNs === null || durationMinNs > durationMaxNs || typeof row.histogram !== 'object' || row.histogram === null || typeof row.states !== 'object' || row.states === null || Array.isArray(row.states)) return null;
  const histogram = {};
  let histogramCount = 0;
  for (const [bucket, count] of Object.entries(row.histogram).slice(0, 128)) {
    if (!/^\d{1,4}$/.test(bucket) || !Number.isSafeInteger(count) || count < 0 || count > row.frameCount) return null;
    histogram[bucket] = count; histogramCount += count;
  }
  if (histogramCount !== row.frameCount) return null;
  const states = {};
  for (const [key, item] of Object.entries(row.states).slice(0, 20)) {
    const name = boundedString(key, 80), stateValue = boundedString(item, 160);
    if (name && stateValue) states[name] = stateValue;
  }
  const frameStartNs = exactLong(row.frameStartNs), frameEndNs = exactLong(row.frameEndNs);
  if (frameStartNs === null || frameEndNs === null || BigInt(frameEndNs) < BigInt(frameStartNs)) return null;
  const cpuTotalNs = row.cpuTotalNs === null ? null : integer(row.cpuTotalNs), overrunTotalNs = row.overrunTotalNs === null ? null : signedInteger(row.overrunTotalNs);
  if ((row.cpuTotalNs !== null && cpuTotalNs === null) || (row.overrunTotalNs !== null && overrunTotalNs === null)) return null;
  return {
    id: `${pid}:${logTimestamp}:${boundedString(row.activity, 120)}:${boundedString(row.windowId, 32)}:${frameStartNs}`,
    timestamp: Math.floor(Number(logTimestamp) * 1000), pid,
    activity: boundedString(row.activity, 160), windowId: boundedString(row.windowId, 32),
    frameStartNs, frameEndNs, frameCount: row.frameCount, jankCount,
    durationTotalNs, durationMinNs, durationMaxNs, histogram, states,
    cpuTotalNs, cpuCount: integer(row.cpuCount, row.frameCount) ?? (cpuTotalNs === null ? 0 : row.frameCount),
    overrunTotalNs, overrunCount: integer(row.overrunCount, row.frameCount) ?? (overrunTotalNs === null ? 0 : row.frameCount),
  };
}

function parseFrameBatch(value, pid, logTimestamp) {
  let row;
  try { row = JSON.parse(value); } catch { return null; }
  if (!row || row.version !== 1 || !Array.isArray(row.frames) || row.frames.length < 1 || row.frames.length > 20 || !row.states || typeof row.states !== 'object' || Array.isArray(row.states)) return null;
  const states = {};
  for (const [key, item] of Object.entries(row.states).slice(0, 20)) {
    const name = boundedString(key, 80), stateValue = boundedString(item, 160);
    if (name && stateValue) states[name] = stateValue;
  }
  const activity = boundedString(row.activity, 160), windowId = boundedString(row.windowId, 32), dropped = integer(row.dropped, 600) ?? 0;
  const frames = [];
  for (const frame of row.frames) {
    if (!frame || typeof frame.startNs !== 'string' || !/^\d{1,19}$/.test(frame.startNs) || BigInt(frame.startNs) > 9223372036854775807n || typeof frame.uiDurationNs !== 'string' || !/^\d{1,19}$/.test(frame.uiDurationNs) || BigInt(frame.uiDurationNs) < 1n || BigInt(frame.uiDurationNs) > 10000000000n || typeof frame.jank !== 'boolean') return null;
    const optionalLong = item => item === null ? null : typeof item === 'string' && /^-?\d{1,19}$/.test(item) && BigInt(item) >= -9223372036854775808n && BigInt(item) <= 9223372036854775807n ? item : undefined;
    const cpuDurationNs = optionalLong(frame.cpuDurationNs), overrunNs = optionalLong(frame.overrunNs);
    if (cpuDurationNs === undefined || overrunNs === undefined || (cpuDurationNs !== null && BigInt(cpuDurationNs) < 0n)) return null;
    frames.push({ id: `${pid}:${frame.startNs}`, pid, timestamp: Math.floor(Number(logTimestamp) * 1000), activity, windowId, states, startNs: frame.startNs, uiDurationNs: frame.uiDurationNs, jank: frame.jank, cpuDurationNs, overrunNs });
  }
  return { frames, dropped };
}

// Input lines must be epoch-format Logcat from the APWJank tag; app payloads are parsed as bounded JSON.
export function parseJankStatsLog(raw, { limit = 300, frameLimit = 10000 } = {}) {
  const input = String(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 300 || !Number.isInteger(frameLimit) || frameLimit < 1 || frameLimit > 20000) throw new Error('JankStats 读取数量上限无效');
  if (Buffer.byteLength(input, 'utf8') > MAX_RAW_BYTES) throw new Error('JankStats Logcat 超过 8 MiB 限制');
  const items = [], frameItems = []; let ignored = 0, droppedFrameRows = 0;
  for (const line of input.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('---------')) continue;
    const match = line.match(LINE);
    if (!match) { ignored++; continue; }
    if (match[3] === 'APWJankFrame') {
      const batch = parseFrameBatch(match[4], Number(match[2]), match[1]);
      if (!batch) { ignored++; continue; }
      frameItems.push(...batch.frames); droppedFrameRows += batch.dropped;
    } else {
      const item = parseAggregate(match[4], Number(match[2]), match[1]);
      if (!item) { ignored++; continue; }
      items.push(item);
    }
  }
  const capped = items.length > limit, framesCapped = frameItems.length > frameLimit;
  const output = items.slice(-limit).reverse();
  return { items: output, summary: summarizeJankStats(output), frames: frameItems.slice(-frameLimit).reverse(), droppedFrameRows, ignored, truncated: capped, framesTruncated: framesCapped || droppedFrameRows > 0, limit, frameLimit };
}

export function summarizeJankStats(items = []) {
  const groups = new Map();
  for (const item of items) {
    const key = JSON.stringify([item.activity, item.windowId, item.states]);
    const group = groups.get(key) || { activity: item.activity, windowId: item.windowId, states: item.states, frameCount: 0, jankCount: 0, durationTotalNs: 0, durationMaxNs: 0, durationMinNs: Number.MAX_SAFE_INTEGER, cpuTotalNs: 0, cpuCount: 0, overrunTotalNs: 0, overrunCount: 0, histogram: {} };
    group.frameCount += item.frameCount; group.jankCount += item.jankCount;
    group.durationTotalNs += item.durationTotalNs; group.durationMinNs = Math.min(group.durationMinNs, item.durationMinNs); group.durationMaxNs = Math.max(group.durationMaxNs, item.durationMaxNs);
    if (item.cpuTotalNs !== null) { group.cpuTotalNs += item.cpuTotalNs; group.cpuCount += item.cpuCount; }
    if (item.overrunTotalNs !== null) { group.overrunTotalNs += item.overrunTotalNs; group.overrunCount += item.overrunCount; }
    for (const [bucket, count] of Object.entries(item.histogram)) group.histogram[bucket] = (group.histogram[bucket] || 0) + count;
    groups.set(key, group);
  }
  return [...groups.values()].map(group => {
    const target = Math.ceil(group.frameCount * 0.95); let seen = 0, p95Ms = null;
    for (const [bucket, count] of Object.entries(group.histogram).sort((a, b) => Number(a[0]) - Number(b[0]))) {
      seen += count; if (seen >= target) { p95Ms = Number(bucket); break; }
    }
    return { ...group, durationMinMs: group.durationMinNs / 1e6, durationMaxMs: group.durationMaxNs / 1e6, durationMeanMs: group.durationTotalNs / group.frameCount / 1e6, jankPercent: group.jankCount / group.frameCount * 100, p95Ms };
  }).sort((a, b) => b.jankCount - a.jankCount || b.durationMaxNs - a.durationMaxNs);
}
