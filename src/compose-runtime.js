const PREFIX = 'APW1|';
const EXEC_PREFIX = 'APW2|';
const SKIP_PREFIX = 'APW3|';
const MAX_EVENTS = 500;

export function parseComposeRecompositionLog(raw, {serial, packageName, pid, timestamp = Date.now()} = {}) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > 8 * 1024 * 1024) throw new Error('Compose 运行时日志超过 8 MiB 或格式无效');
  const instances = new Map(), automatic = new Map(), invocationEdges = new Map(), events = [];
  let invalid = 0, activeSession = null;
  for (const line of raw.split(/\r?\n/)) {
    const markers = [
      {prefix:PREFIX, measurement:'side-effect'},
      {prefix:EXEC_PREFIX, measurement:'automatic-execution'},
      {prefix:SKIP_PREFIX, measurement:'automatic-skip'}
    ].map(value => {
      const start = line.indexOf(value.prefix);
      return {...value, start};
    }).filter(value => value.start >= 0).sort((a,b) => a.start-b.start);
    const selected = markers[0];
    const marker = selected?.prefix, recordStart = selected?.start ?? -1;
    if (recordStart < 0) continue;
    const fields = line.slice(recordStart + marker.length).trim().split('|');
    if (selected.measurement !== 'side-effect') {
      const legacyExecution = selected.measurement === 'automatic-execution' && fields.length === 3;
      const hierarchical = fields.length === 6 || fields.length === 8, keyedHierarchy = fields.length === 8;
      if ((!legacyExecution && fields.length !== 4 && !hierarchical) || (selected.measurement === 'automatic-skip' && (legacyExecution || fields.length !== 4 && !hierarchical))) { invalid++; continue; }
      const [sessionId, encodedName, rawCount, elapsedNs, encodedParent, rawParentKey, rawEdgeCount, rawGroupKey] = legacyExecution ? [fields[0],fields[1],null,fields[2],null,null,null,null] : [fields[0],fields[1],fields[2],fields[3],hierarchical?fields[4]:null,keyedHierarchy?fields[5]:null,hierarchical?fields[keyedHierarchy?6:5]:null,keyedHierarchy?fields[7]:null];
      if (!/^[a-f0-9]{32}$/.test(sessionId) || !/^[A-Za-z0-9_-]{1,2048}$/.test(encodedName) || (rawCount !== null && !/^\d{1,15}$/.test(rawCount)) || !/^\d{1,19}$/.test(elapsedNs) || (hierarchical && encodedParent !== '-' && !/^[A-Za-z0-9_-]{1,2048}$/.test(encodedParent)) || (hierarchical && !/^\d{1,15}$/.test(rawEdgeCount)) || (keyedHierarchy && ((rawParentKey !== '-' && !/^-?\d{1,12}$/.test(rawParentKey)) || (rawGroupKey !== '-' && !/^-?\d{1,12}$/.test(rawGroupKey))))) { invalid++; continue; }
      const count = rawCount === null ? 1 : Number(rawCount);
      const edgeCount = hierarchical ? Number(rawEdgeCount) : null;
      if (!Number.isSafeInteger(count) || count < 1 || (hierarchical && (!Number.isSafeInteger(edgeCount) || edgeCount < 1))) { invalid++; continue; }
      let name;
      try { name = Buffer.from(encodedName, 'base64url').toString('utf8'); } catch { invalid++; continue; }
      if (!name || name.length > 300 || /[\u0000-\u001f\u007f]/.test(name) || Buffer.from(name, 'utf8').toString('base64url') !== encodedName) { invalid++; continue; }
      let parentName = null;
      if (hierarchical && encodedParent !== '-') {
        try { parentName = Buffer.from(encodedParent, 'base64url').toString('utf8'); } catch { invalid++; continue; }
        if (!parentName || parentName.length > 300 || /[\u0000-\u001f\u007f]/.test(parentName) || Buffer.from(parentName, 'utf8').toString('base64url') !== encodedParent) { invalid++; continue; }
      }
      const parentGroupKey = keyedHierarchy && rawParentKey !== '-' ? Number(rawParentKey) : null;
      const groupKey = keyedHierarchy && rawGroupKey !== '-' ? Number(rawGroupKey) : null;
      activeSession = sessionId;
      const key = `${sessionId}\0${name}`, row = automatic.get(key) || {sessionId, name, executions: 0, skips: 0, elapsedNs: '0'};
      const counter = selected.measurement === 'automatic-skip' ? 'skips' : 'executions';
      row[counter] = legacyExecution ? row[counter] + 1 : Math.max(row[counter], count);
      if (BigInt(elapsedNs) > BigInt(row.elapsedNs)) row.elapsedNs = elapsedNs;
      automatic.set(key, row);
      if (hierarchical) {
        const edgeKey = `${sessionId}\0${parentName ?? ''}\0${parentGroupKey ?? ''}\0${name}\0${groupKey ?? ''}`, edge = invocationEdges.get(edgeKey) || {sessionId, parentName, parentGroupKey, name, groupKey, executions: 0, skips: 0};
        const edgeCounter = selected.measurement === 'automatic-skip' ? 'skips' : 'executions';
        edge[edgeCounter] = Math.max(edge[edgeCounter], edgeCount);
        invocationEdges.set(edgeKey, edge);
      }
      events.push({sessionId, name, parentName, parentGroupKey, groupKey, measurement: selected.measurement, instanceId: null, count, elapsedNs});
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
    events.push({sessionId, name, measurement: selected.measurement, instanceId, count, elapsedNs});
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
    grouped.set(`${value.name}\0automatic-execution`, {
      name: value.name, measurement: 'automatic-execution', executions: value.executions, skips: value.skips,
      instances: null, lastElapsedNs: value.elapsedNs
    });
  }
  const orderedEvents = events.filter(event => event.sessionId === activeSession).slice(-MAX_EVENTS).map(({sessionId:_sessionId,...event})=>event);
  const activeEdges = [...invocationEdges.values()].filter(edge => edge.sessionId === activeSession);
  const childrenByParent = new Map();
  const callParentKey = (name, groupKey) => `${name ?? ''}\0${groupKey ?? ''}`;
  for (const edge of activeEdges) { const key = callParentKey(edge.parentName, edge.parentGroupKey); const children = childrenByParent.get(key) || []; children.push(edge); childrenByParent.set(key, children); }
  const buildCallNode = (edge, ancestry = [], depth = 0) => {
    const recursive = ancestry.includes(edge.name), children = recursive || depth >= 12 ? [] : (childrenByParent.get(callParentKey(edge.name, edge.groupKey)) || []).map(child => buildCallNode(child, [...ancestry, edge.name], depth + 1));
    return {...(edge.groupKey === null ? {} : {composeKey:edge.groupKey}),name:edge.name,executions:edge.executions,skips:edge.skips,recursive,children};
  };
  return {
    source: 'adb-logcat', serial, packageName, pid, timestamp,
    composables: [...grouped.values()].sort((a,b) => {
      const count = value => value.measurement === 'automatic-execution' ? value.executions + value.skips : value.recompositions;
      return count(b)-count(a) || a.name.localeCompare(b.name);
    }),
    callTree: (childrenByParent.get(callParentKey(null, null)) || []).map(edge => buildCallNode(edge)),
    events: orderedEvents, eventCount: events.length, truncated: events.length > MAX_EVENTS, invalidRecords: invalid,
    note: '自动插桩分别统计 Compose 编译器生成的非跳过分支执行次数与 skip 分支次数，执行次数包含首次组合，且无法区分同名多实例；支持新版事件时按函数名聚合父子调用关系（日志环形缓冲区可能使树不完整）。显式 probe 统计 SideEffect 提交次数并可区分实例，但不代表实际重组。State Reads 与 Jank 因果仍不可用。'
  };
}
