// Deterministic sample evidence. Never used for real-device requests.
export const DEMO_PACKAGE = 'com.example.reading';
export const DEMO_DEVICE = { serial: 'demo-pixel-8', model: 'Pixel 8', version: '14', api: '34', abi: 'arm64-v8a', state: 'device' };
export function demoSample(index = 0, timestamp = Date.now()) {
  const cpu = 12 + Math.sin(index * .43) * 4 + (index % 23 === 14 ? 22 : 0) + Math.cos(index * 1.7) * 2;
  const pss = 172 + Math.sin(index * .14) * 8 + (index % 20) * .6;
  return { timestamp, source: 'demo', serial: DEMO_DEVICE.serial, packageName: DEMO_PACKAGE, pid: '18472',
    cpu: { percent: cpu, processes: [{ pid: 18472, name: DEMO_PACKAGE, cpu }], window: '演示用固定波形，不来自设备' },
    memory: { pssMb: pss, rssMb: pss + 83, categories: { 'Java Heap': 45, 'Native Heap': 39, 'Code': 28, 'Stack': 2, 'Graphics': 32, 'Private Other': 15, 'System': 11 } },
    battery: { level: 86, temperatureC: 32.4, voltageMv: 4120, scope: 'device' }, warnings: [] };
}
export function demoHistory() { const now = Date.now(); return Array.from({ length: 90 }, (_, i) => demoSample(i, now - (89 - i) * 2000)); }
export function demoFrames(budgetMs = 16.667) {
  const frames = Array.from({ length: 120 }, (_, i) => {
    const durationMs = i % 27 === 15 ? 38 + i % 7 : i % 19 === 8 ? 23.1 : 7 + Math.abs(Math.sin(i * .78)) * 7;
    return { index: i + 1, durationMs, overBudget: durationMs > budgetMs };
  });
  const sorted = frames.map(f => f.durationMs).sort((a, b) => a - b), slow = frames.filter(f => f.overBudget).length;
  return { source: 'demo', timestamp: Date.now(), frames, count: frames.length, slow, slowPercent: slow / frames.length * 100, budgetMs,
    p50: sorted[59], p90: sorted[107], p95: sorted[113], p99: sorted[118], max: sorted.at(-1), platformJank: null };
}
export function demoStartup(mode = 'cold', runs = 3) {
  const base = { cold: 470, warm: 210, hot: 88 }[mode];
  const results = Array.from({ length: runs }, (_, i) => ({ run: i + 1, status: 'ok', observedMode: mode, totalTimeMs: base + [18, -22, 7, -13, 24][i % 5], thisTimeMs: null, waitTimeMs: base + 40, activity: `${DEMO_PACKAGE}/.MainActivity` }));
  return { source: 'demo', timestamp: Date.now(), requestedMode: mode, results, meanMs: results.reduce((s, r) => s + r.totalTimeMs, 0) / runs };
}
export function demoLayout() {
  return { source: 'demo', timestamp: Date.now(), screenshot: null, note: '演示层级。真实采集使用 UIAutomator，可访问性层级不等同于完整 View/Compose 树。',
    xml: `<?xml version="1.0"?><hierarchy rotation="0"><node class="android.widget.FrameLayout" package="${DEMO_PACKAGE}" bounds="[0,0][1080,2400]" resource-id="android:id/content"><node class="android.widget.LinearLayout" bounds="[0,0][1080,2400]" resource-id="${DEMO_PACKAGE}:id/root"><node class="android.widget.TextView" text="阅读，让生活慢下来" bounds="[64,200][1016,340]" resource-id="${DEMO_PACKAGE}:id/title"/><node class="android.widget.TextView" text="为你精选" bounds="[64,420][700,500]"/><node class="android.widget.ImageView" content-desc="本周书单封面" bounds="[64,560][1016,1250]" resource-id="${DEMO_PACKAGE}:id/cover"/><node class="android.widget.TextView" text="在文字里，找到另一个世界。" bounds="[64,1320][1016,1450]"/><node class="android.widget.Button" text="开始阅读" clickable="true" bounds="[64,1570][1016,1720]" resource-id="${DEMO_PACKAGE}:id/read"/><node class="android.widget.TextView" text="首页　　书架　　我的" bounds="[0,2180][1080,2330]"/></node></node></hierarchy>` };
}
export const DEMO_HAR = { log: { entries: Array.from({ length: 8 }, (_, i) => ({ startedDateTime: new Date(Date.now() - 30000 + i * 1700).toISOString(), time: [128, 64, 312, 95, 153, 824, 82, 167][i],
  request: { method: 'GET', url: `https://api.example.com/v1/${['feed', 'profile', 'books/recommended', 'config', 'books/1024', 'search', 'shelves', 'notifications'][i]}` },
  response: { status: i === 5 ? 503 : 200, content: { size: 1200 + i * 813 }, bodySize: 1200 + i * 813 },
  timings: { blocked: 0, dns: 4, connect: 12, ssl: 7, send: 1, wait: 45, receive: 12 } })) } };
