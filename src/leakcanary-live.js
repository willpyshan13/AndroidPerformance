const EVENT_PATTERNS = [
  ['watching', /watching instance|watching object/i],
  ['retained', /retained object|object was retained|retained instances?/i],
  ['heap-dump', /dumping the heap|heap dump/i],
  ['analysis', /analysis (?:in progress|result|completed)|leak trace|leak found/i],
  ['cleared', /no longer retained|was cleared|not retained|object was collected|object collected/i],
];

// Logcat epoch lines are: seconds.nanoseconds pid tid priority tag: message.
// Keep only known LeakCanary lifecycle events; arbitrary app log messages are discarded.
export function parseLeakCanaryLog(raw, { limit = 300 } = {}) {
  const items = [];
  let ignored = 0;
  for (const line of String(raw).split(/\r?\n/)) {
    const match = line.match(/^\s*(\d{9,}(?:\.\d+)?)\s+(\d+)\s+\d+\s+[VDIWEF]\s+(LeakCanary|APWLeakCanary)\s*:\s*(.{1,2000})$/i);
    if (!match) { if (line.trim() && !line.startsWith('---------')) ignored++; continue; }
    const message = match[4].trim();
    const category = EVENT_PATTERNS.find(([, pattern]) => pattern.test(message))?.[0];
    if (!category) { ignored++; continue; }
    items.push({
      id: `${match[2]}:${match[1]}:${category}:${message.slice(0, 160)}`,
      timestamp: Math.floor(Number(match[1]) * 1000),
      pid: Number(match[2]),
      source: match[3].toLowerCase()==='apwleakcanary'?'apw-debug-agent':'leakcanary',
      category,
      message: message.slice(0, 500),
    });
  }
  const capped = items.length > limit;
  return { items: items.slice(-limit).reverse(), ignored, truncated: capped, limit };
}
