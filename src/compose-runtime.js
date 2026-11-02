const PREFIX = 'APW1|';
const AUTO_PREFIX = 'APW2|';
const MAX_EVENTS = 500;

export function parseComposeRecompositionLog(raw, {serial, packageName, pid, timestamp = Date.now()} = {}) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > 8 * 1024 * 1024) throw new Error('Compose 运行时日志超过 8 MiB 或格式无效');
  const instances = new Map(), automatic = new Map(), events = [];
  let invalid = 0, activeSession = null;
  for (const line of raw.split(/\r?\n/)) {
    const start = line.indexOf(PREFIX), automaticStart = line.indexOf(AUTO_PREFIX);
    const isAutomatic = automaticStart >= 0 && (start < 0 || automaticStart < start);
    const marker = isAutomatic ? AUTO_PREFIX : PREFIX, recordStart = isAutomatic ? automaticStart : start;
    if (recordStart < 0) continue;
    const fields = line.slice(recordStart + marker.length).trim().split('|');
    if (isAutomatic) {
      if (fields.length !== 3) { invalid++; continue; }
      const [sessionId, encodedName, elapsedNs] = fields;
      if (!/^[a-f0-9]{32}$/.test(sessionId) || !/^[A-Za-z0-9_-]{1,2048}$/.test(encodedName) || !/^\d{1,19}$/.test(elapsedNs)) { invalid++; continue; }
      let name;
      try { name = Buffer.from(encodedName, 'base64url').toString('utf8'); } catch { invalid++; continue; }
      if (!name || name.length > 300 || /[\u0000-\u001f\u007f]/.test(name) || Buffer.from(name, 'utf8').toString('base64url') !== encodedName) { invalid++; continue; }
      activeSession = sessionId;
      const key = `${sessionId}\0${name}`, row = automatic.get(key) || {sessionId, name, count: 0, elapsedNs: '0'};
      row.count++;
      if (BigInt(elapsedNs) > BigInt(row.elapsedNs)) row.elapsedNs = elapsedNs;
      automatic.set(key, row);
      events.push({sessionId, name, measurement: 'automatic-invocation', instanceId: null, count: null, elapsedNs});
      continue;
    }
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
    events.push({sessionId, name, measurement: 'side-effect', instanceId, count, elapsedNs});
  }
  const grouped = new Map();
  for (const value of instances.values()) {
    if (value.sessionId !== activeSession) continue;
    const key = `${value.name}\0side-effect`;
    const row = grouped.get(key) || {name: value.name, measurement: 'side-effect', recompositions: 0, instances: 0, lastElapsedNs: '0'};
    row.recompositions += value.count; row.instances++;
    if (BigInt(value.elapsedNs) > BigInt(row.lastElapsedNs)) row.lastElapsedNs = value.elapsedNs;
    grouped.set(key, row);
  }
  for (const value of automatic.values()) {
    if (value.sessionId !== activeSession) continue;
    grouped.set(`${value.name}\0automatic-invocation`, {
      name: value.name, measurement: 'automatic-invocation', invocations: value.count,
      instances: null, lastElapsedNs: value.elapsedNs
    });
  }
  const orderedEvents = events.filter(event => event.sessionId === activeSession).slice(-MAX_EVENTS).map(({sessionId:_sessionId,...event})=>event);
  return {
    source: 'adb-logcat', serial, packageName, pid, timestamp,
    composables: [...grouped.values()].sort((a,b) => {
      const count = value => value.measurement === 'automatic-invocation' ? value.invocations : value.recompositions;
      return count(b)-count(a) || a.name.localeCompare(b.name);
    }),
    events: orderedEvents, eventCount: events.length, truncated: events.length > MAX_EVENTS, invalidRecords: invalid,
    note: '自动插桩统计目标模块 Composable 函数入口调用次数，可能包含随后被 Composer 跳过的函数，也无法区分同名多实例；显式 probe 统计 SideEffect 提交次数并可区分实例。计数均包含首次组合；Logcat 环形缓冲区可能丢失历史事件，结果不代表实际重组/跳过次数或 Jank。'
  };
}
