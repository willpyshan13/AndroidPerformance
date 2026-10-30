import http from 'node:http';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Adb, locateAdb } from './adb.js';
import { parseFrames } from './parsers.js';
import { validateRecord } from './records.js';
import { locateAapt2 } from './apk.js';
import { analyzeApkUpload } from './apk-upload.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
export const VERSION = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
async function readBody(req) {
  let bytes = 0; const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 12 * 1024 * 1024) throw Object.assign(new Error('文件超过 12 MB 限制'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); }
  catch { throw Object.assign(new Error('JSON 格式错误'), { status: 400 }); }
}

export function createApp({ adb, dataDir = join(root, 'data'), token = randomBytes(24).toString('hex'), desktop = false, apkAnalyzer }) {
  let apkBusy = false;
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const json = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      const address = server.address();
      const hosts = [`127.0.0.1:${address?.port}`, `localhost:${address?.port}`];
      if (!hosts.includes(req.headers.host)) return json({ error: '无效的本机 Host' }, 403);
      if (req.headers.origin && !hosts.some(host => req.headers.origin === `http://${host}`)) return json({ error: '不允许跨站访问' }, 403);
      const url = new URL(req.url, `http://${req.headers.host}`);
      const path = url.pathname;
      if (!path.startsWith('/api/')) {
        if (req.method !== 'GET') return json({ error: '不支持的请求' }, 405);
        const files = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css', '/demo.js': 'demo.js', '/offline.js': 'offline.js', '/favicon.svg': 'favicon.svg' };
        if (!files[path]) return json({ error: '页面不存在' }, 404);
        let content = await readFile(join(root, 'public', files[path]));
        if (path === '/') content = Buffer.from(content.toString().replace('__API_TOKEN__', token));
        res.writeHead(200, { 'Content-Type': MIME[extname(files[path])] }); return res.end(content);
      }
      const provided = Buffer.from(String(req.headers['x-workbench-token'] || ''));
      const expected = Buffer.from(token);
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return json({ error: '本机访问令牌无效，请刷新页面' }, 403);
      const serial = url.searchParams.get('serial');
      const pkg = url.searchParams.get('package');
      if (req.method === 'GET') {
        if (path === '/api/status') return json({ version: VERSION, adbPath: adb.path, aapt2Path: await locateAapt2(), platform: process.platform, desktop, dataDir });
        if (path === '/api/devices') return json({ devices: await adb.devices() });
        if (path === '/api/device') return json(await adb.info(serial));
        if (path === '/api/packages') return json({ packages: await adb.packages(serial) });
        if (path === '/api/metrics') return json(await adb.metrics(serial, pkg));
        if (path === '/api/frames') {
          const budget = Number(url.searchParams.get('budget') || 16.667);
          if (![16.667, 11.111, 8.333].includes(budget)) throw new Error('帧预算无效');
          return json(await adb.frames(serial, pkg, budget));
        }
        if (path === '/api/sessions') {
          await mkdir(dataDir, { recursive: true });
          const files = (await readdir(dataDir)).filter(f => /^[\da-f-]{36}\.json$/.test(f));
          const sessions = (await Promise.all(files.map(async file => {
            try {
              const s = JSON.parse(await readFile(join(dataDir, file), 'utf8'));
              return { id: s.id, name: s.name, kind: s.kind, timestamp: s.timestamp, source: s.source, packageName: s.packageName,
                sampleCount: Array.isArray(s.payload?.samples) ? s.payload.samples.length : null };
            } catch { return null; }
          }))).filter(Boolean).sort((a, b) => b.timestamp - a.timestamp);
          return json({ sessions });
        }
        const session = path.match(/^\/api\/sessions\/([\da-f-]{36})$/);
        if (session) {
          try { return json(JSON.parse(await readFile(join(dataDir, `${session[1]}.json`), 'utf8'))); }
          catch { return json({ error: '采集记录不存在或已损坏' }, 404); }
        }
      }
      if (req.method === 'POST') {
        if (path === '/api/apk/analyze') {
          if(apkBusy){req.resume();return json({error:'已有 APK 正在分析，请等待完成'},409);}
          apkBusy=true;
          try { return json(await analyzeApkUpload(req,apkAnalyzer)); } finally { apkBusy=false; }
        }
        const body = await readBody(req);
        if (path === '/api/frames/import') {
          if (typeof body.text !== 'string' || ![16.667, 11.111, 8.333].includes(body.budget)) throw new Error('gfxinfo 导入参数无效');
          const parsed = parseFrames(body.text, body.budget);
          if (!parsed.count) throw new Error('文件没有有效的 PROFILEDATA 帧记录，请导出 gfxinfo framestats 文本');
          return json({ ...parsed, raw: body.text, source: 'import', timestamp: Date.now() });
        }
        if (path === '/api/frames/reset') return json({ message: await adb.resetFrames(body.serial, body.packageName) });
        if (path === '/api/startup') return json(await adb.startup(body.serial, body.packageName, body));
        if (path === '/api/layout') return json(await adb.layout(body.serial));
        if (path === '/api/trace') {
          const data = await adb.trace(body.serial, body.seconds ?? 10);
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="capture.perfetto-trace"' });
          return res.end(data);
        }
        if (path === '/api/sessions') {
          validateRecord(body);
          const session = { schemaVersion: 1, id: randomUUID(), name: String(body.name || '未命名采集').slice(0, 120), kind: body.kind,
            source: body.source, packageName: String(body.packageName || '').slice(0, 200), timestamp: Date.now(), payload: body.payload };
          await mkdir(dataDir, { recursive: true });
          await writeFile(join(dataDir, `${session.id}.json`), JSON.stringify(session), { flag: 'wx', mode: 0o600 });
          return json(session, 201);
        }
      }
      json({ error: '接口不存在' }, 404);
    } catch (error) { json({ error: error.message || '请求失败' }, error.status || 400); }
  });
  server.requestTimeout = 180000;
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const adb = new Adb(await locateAdb());
  const server = createApp({ adb });
  const port = Number(process.env.PORT || 4318);
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已占用，可用 PORT=4319 npm start 指定其他端口。` : error.message);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`\n  Android Performance Workbench v${VERSION}\n  http://127.0.0.1:${server.address().port}\n  ADB: ${adb.path}\n\n  按 Ctrl+C 停止服务\n`);
  });
}
