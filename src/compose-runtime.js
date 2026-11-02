const PREFIX = 'APW1|';
const MAX_EVENTS = 500;

export function parseComposeRecompositionLog(raw, {serial, packageName, pid, timestamp = Date.now()} = {}) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > 8 * 1024 * 1024) throw new Error('Compose 运行时日志超过 8 MiB 或格式无效');
  const instances = new Map(), events = [];
  let invalid = 0, activeSession = null;
  for (const line of raw.split(/\r?\n/)) {
    const start = line.indexOf(PREFIX);
    if (start < 0) continue;
    const fields = line.slice(start + PREFIX.length).trim().split('|');
    if (fields.length !== 5) { invalid++; continue; }
    const [sessionId, instanceId, encodedName, rawCount, elapsedNs] = fields;
    if (!/^[a-f0-9]{32}$/.test(sessionId) || !/^[a-f0-9]{32}$/.test(instanceId) || !/^[A-Za-z0-9_-]{1,2048}$/.test(encodedName) || !/^\d{1,12}$/.test(rawCount) || !/^\d{1,19}$/.test(elapsedNs)) { invalid++; continue; }
    const count = Number(rawCount);
    if (!Number.isSafeInteger(count) || count < 1) { invalid++; continue; }
    let name;
    try { name = Buffer.from(encodedName, 'base64url').toString('utf8'); } catch { invalid++; continue; }
    if (!name || name.length > 300 || /[\u0000-\u001f\u007f]/.test(name) || Buffer.from(name, 'utf8').toString('base64url') !== encodedName) { invalid++; continue; }
    activeSession = sessionId;
    const key = `${sessionId}\0${name}\0${instanceId}`, previous = instances.get(key);
    if (!previous || count > previous.count) instances.set(key, {sessionId, name, instanceId, count, elapsedNs});
    events.push({sessionId, name, instanceId, count, elapsedNs});
  }
  const grouped = new Map();
  for (const value of instances.values()) {
    if (value.sessionId !== activeSession) continue;
    const row = grouped.get(value.name) || {name: value.name, recompositions: 0, instances: 0, lastElapsedNs: '0'};
    row.recompositions += value.count; row.instances++;
    if (BigInt(value.elapsedNs) > BigInt(row.lastElapsedNs)) row.lastElapsedNs = value.elapsedNs;
    grouped.set(value.name, row);
  }
  const orderedEvents = events.filter(event => event.sessionId === activeSession).slice(-MAX_EVENTS).map(({sessionId:_sessionId,...event})=>event);
  return {
    source: 'adb-logcat', serial, packageName, pid, timestamp,
    composables: [...grouped.values()].sort((a,b) => b.recompositions-a.recompositions || a.name.localeCompare(b.name)),
    events: orderedEvents, eventCount: events.length, truncated: events.length > MAX_EVENTS, invalidRecords: invalid,
    note: '仅统计已显式加入 APW Compose probe 的 Composable；计数为 probe SideEffect 执行次数，包含初次组合。Logcat 环形缓冲区可能丢失历史事件；结果不含跳过次数、未插桩函数或 Jank 因果判断。'
  };
}
