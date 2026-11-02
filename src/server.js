import http from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, mkdir, readdir, access, stat, open, rename, rm } from 'node:fs/promises';
import { join, dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Adb, locateAdb } from './adb.js';
import { parseFrames } from './parsers.js';
import { validateRecord } from './records.js';
import { locateAapt2 } from './apk.js';
import { analyzeApkUpload } from './apk-upload.js';
import { analyzeHprofUpload, queryHeapWorker } from './hprof-upload.js';
import { analyzeWithShark, resolveSharkResources } from './shark.js';
import { analyzePerfUpload } from './perf-upload.js';
import { analyzeTraceUpload, locateTraceProcessor, queryTraceFile, queryTraceSql, queryFrameTimeline, queryStartupTrace, queryStartupBreakdown, queryStartupArtAttribution, queryThreadStates, queryBinderTransactions, queryBinderBreakdown, querySliceArguments, queryHeapProfile } from './trace-analysis.js';
import { importGpuArtifact, listGpuArtifacts, getGpuArtifact, verifyGpuArtifact } from './gpu.js';
import { parseBatteryStats, compareBatteryStats } from './battery.js';
import {createSourceSnapshot,listSourceSnapshots,getSourceSnapshot,readSourceFile,searchSource,resolveSourceSymbol} from './source-workspace.js';
import {createRemoteSourceSnapshot} from './source-git.js';
import {buildAgentPackage,buildLayoutAgentPackage} from './agent-package.js';

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

export function createApp({ adb, dataDir = join(root, 'data'), token = randomBytes(24).toString('hex'), desktop = false, apkAnalyzer, perfettoUiDir, sharkDir, sharkJavaPath }) {
  const gpuDir=join(dataDir,'gpu-artifacts');
  const traceDir=join(dataDir,'trace-archives');
  const perfDir=join(dataDir,'cpu-archives');
  const perfettoUiRoot=perfettoUiDir||(desktop&&process.resourcesPath?join(process.resourcesPath,'perfetto-ui'):join(root,'tools','perfetto-ui'));
  const sourceDir=join(dataDir,'source-workspaces');
  let sourceBusy=false;
  let gpuBusy=false;
  let apkBusy = false, heapBusy = false, mappingBusy=false, sharkBusy = false, perfBusy = false, traceBusy = false, heapSession = null, traceSession = null, closed = false;
  const sharkResources=resolveSharkResources({sharkDir:sharkDir||(desktop&&process.resourcesPath?join(process.resourcesPath,'shark-cli'):join(root,'tools','shark-cli')),javaPath:sharkJavaPath||(desktop&&process.resourcesPath?join(process.resourcesPath,'java-runtime','bin',process.platform==='win32'?'java.exe':'java'):join(root,'tools','java-runtime','bin',process.platform==='win32'?'java.exe':'java'))});
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    const perfettoAssetRequest=(()=>{try{return new URL(req.url,'http://localhost').pathname.startsWith('/perfetto-ui/');}catch{return false;}})();
    res.setHeader('Content-Security-Policy', perfettoAssetRequest
      ? "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'self' blob:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-src 'self'; frame-ancestors 'self'"
      : "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
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
        if(path.startsWith('/perfetto-ui/')){
          let relativePath;try{relativePath=decodeURIComponent(path.slice('/perfetto-ui/'.length));}catch{return json({error:'Perfetto UI 路径无效'},400);}
          if(!relativePath||relativePath.includes('\\')||relativePath.split('/').some(part=>!part||part==='.'||part==='..'))return json({error:'Perfetto UI 路径无效'},400);
          const file=resolve(perfettoUiRoot,relativePath),relativeFile=relative(perfettoUiRoot,file);
          if(relativeFile==='..'||relativeFile.startsWith(`..${process.platform==='win32'?'\\':'/'}`))return json({error:'Perfetto UI 路径无效'},400);
          try{
            const size=(await stat(file)).size,mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.map':'application/json; charset=utf-8','.wasm':'application/wasm','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.svg':'image/svg+xml'}[extname(file)]||'application/octet-stream';
            res.writeHead(200,{'Content-Type':mime,'Content-Length':size,'Cache-Control':'public, max-age=31536000, immutable'});const stream=createReadStream(file);stream.on('error',()=>res.destroy());return stream.pipe(res);
          }catch{return json({error:'Perfetto UI 尚未准备，请运行 npm run prepare:perfetto-ui'},404);}
        }
        if(path==='/perfetto-ui'||path==='/perfetto-ui/') {res.writeHead(302,{Location:'/perfetto-ui/index.html#!/?mode=embedded'});return res.end();}
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
        if(path==='/api/network/agent-package'){const data=await buildAgentPackage();res.writeHead(200,{'Content-Type':'application/zip','Content-Length':data.length,'Content-Disposition':'attachment; filename="android-performance-agent.zip"'});return res.end(data);}
        if(path==='/api/layout/agent-package'){const data=await buildLayoutAgentPackage();res.writeHead(200,{'Content-Type':'application/zip','Content-Length':data.length,'Content-Disposition':'attachment; filename="android-performance-layout-agent.zip"'});return res.end(data);}
        if (path === '/api/status') return json({ version: VERSION, adbPath: adb.path, aapt2Path: await locateAapt2(), traceProcessorPath: await locateTraceProcessor().catch(()=>null), perfettoUiAvailable: await access(join(perfettoUiRoot,'index.html')).then(()=>true,()=>false), sharkAvailable:(await sharkResources).available, platform: process.platform, desktop, dataDir });
        if(path==='/api/trace/current'){
          if(!traceSession)return json({error:'当前没有可查看的追踪'},404);
          const size=(await stat(traceSession.path)).size;res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':size,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});const stream=createReadStream(traceSession.path);stream.on('error',()=>res.destroy());return stream.pipe(res);
        }
        if (path === '/api/devices') return json({ devices: await adb.devices() });
        if (path === '/api/device') return json(await adb.info(serial));
        if (path === '/api/packages') return json({ packages: await adb.packages(serial) });
        if (path === '/api/metrics') return json(await adb.metrics(serial, pkg));
        if (path === '/api/compilation') return json(await adb.compilationSnapshot(serial,pkg));
        if (path === '/api/frames') {
          const budget = Number(url.searchParams.get('budget') || 16.667);
          if (![16.667, 11.111, 8.333].includes(budget)) throw new Error('帧预算无效');
          return json(await adb.frames(serial, pkg, budget));
        }
        if (path === '/api/gpu/artifacts') return json({artifacts:await listGpuArtifacts(gpuDir)});
        if (path === '/api/trace/archives') return json({archives:await listGpuArtifacts(traceDir)});
        if (path === '/api/cpu-profile/archives') return json({archives:await listGpuArtifacts(perfDir)});
        if (path === '/api/source/snapshots') return json({snapshots:await listSourceSnapshots(sourceDir)});
        const gpuFile=path.match(/^\/api\/gpu\/artifacts\/([a-f0-9-]+)\/file$/);
        if(gpuFile){const checked=await verifyGpuArtifact(gpuDir,gpuFile[1]);if(!checked.ok)throw new Error(`产物校验失败：${checked.reason}`);const {path:file}=await getGpuArtifact(gpuDir,gpuFile[1]);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':checked.actualSize});const stream=createReadStream(file);stream.on('error',()=>res.destroy());return stream.pipe(res);}
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
        const layoutHistory = path.match(/^\/api\/sessions\/([\da-f-]{36})\/layout$/);
        if (layoutHistory) {
          try {
            const session = JSON.parse(await readFile(join(dataDir, `${layoutHistory[1]}.json`), 'utf8'));
            if (session.kind !== 'layout' || typeof session.payload?.xml !== 'string') return json({ error: '布局记录不存在或已损坏' }, 404);
            return json({ id: session.id, name: session.name, kind: session.kind, source: session.source,
              timestamp: session.timestamp, packageName: session.packageName,
              payload: { source: session.payload.source, timestamp: session.payload.timestamp, xml: session.payload.xml } });
          } catch { return json({ error: '布局记录不存在或已损坏' }, 404); }
        }
        const session = path.match(/^\/api\/sessions\/([\da-f-]{36})$/);
        if (session) {
          try { return json(JSON.parse(await readFile(join(dataDir, `${session[1]}.json`), 'utf8'))); }
          catch { return json({ error: '采集记录不存在或已损坏' }, 404); }
        }
      }
      if (req.method === 'POST') {
        if(path==='/api/cpu-profile/archive'){
          if(perfBusy){req.resume();return json({error:'已有 CPU 文件正在处理'},409);}
          const declared=req.headers['content-length'];if(declared!==undefined&&(!/^\d+$/.test(declared)||Number(declared)>256*1024*1024)){req.resume();return json({error:'perf.data 不能超过 256 MiB'},413);}
          perfBusy=true;try{
            // Reuse the private, checksummed artifact store under a separate root.
            const archive=await importGpuArtifact(req,perfDir,{maxBytes:256*1024*1024,magic:Buffer.from('PERFILE2')});return json(archive,201);
          }finally{perfBusy=false;}
        }
        if(path==='/api/gpu/import'){
          if(gpuBusy){req.resume();return json({error:'已有 GPU 产物正在导入'},409);}gpuBusy=true;try{return json(await importGpuArtifact(req,gpuDir),201);}finally{gpuBusy=false;}
        }
        if (path === '/api/trace/analyze') {
          if(traceBusy){req.resume();return json({error:'已有追踪文件正在分析，请等待完成'},409);}
          traceBusy=true;try{
            const {result,session}=await analyzeTraceUpload(req,{retain:true});
            if(closed){await session.cleanup();throw new Error('服务已关闭');}
            const previous=traceSession,sessionId=randomUUID();traceSession={...session,sessionId,bounds:result.bounds,fileBytes:result.fileBytes};
            if(previous)await previous.cleanup();return json({...result,sessionId,viewBounds:result.bounds});
          }finally{traceBusy=false;}
        }
        if(path==='/api/heap-profile/analyze'){
          if(traceBusy){req.resume();return json({error:'已有追踪任务正在处理，请等待完成'},409);}
          const mode=req.headers['x-heap-profile-mode']||'native';if(!['native','art'].includes(mode)){req.resume();throw new Error('内存剖析模式无效');}
          traceBusy=true;let session;
          try{
            const analyzed=await analyzeTraceUpload(req,{retain:true});session=analyzed.session;
            const profile=await queryHeapProfile(session.path,{mode});if(closed){await session.cleanup();throw new Error('服务已关闭');}
            const previous=traceSession,sessionId=randomUUID();traceSession={...session,sessionId,bounds:analyzed.result.bounds,fileBytes:analyzed.result.fileBytes};session=undefined;
            if(previous)await previous.cleanup();return json({...analyzed.result,heapProfile:profile,sessionId,viewBounds:analyzed.result.bounds});
          }finally{if(session)await session.cleanup();traceBusy=false;}
        }
        if (path === '/api/cpu-profile/analyze') {
          if(perfBusy){req.resume();return json({error:'已有 CPU 文件正在分析，请等待完成'},409);}
          perfBusy=true;try{return json(await analyzePerfUpload(req));}finally{perfBusy=false;}
        }
        if (path === '/api/heap/analyze') {
          if(heapBusy||mappingBusy||sharkBusy){req.resume();return json({error:'已有堆文件或 Shark 分析正在运行，请等待完成'},409);}
          const role=req.headers['x-heap-role']||'current';
          if(!['current','baseline'].includes(role)){req.resume();throw new Error('堆快照用途无效');}
          heapBusy=true;try{
            const parsed=await analyzeHprofUpload(req,{summaryOnly:role==='baseline',retainFile:role==='current'});const {result,worker}=parsed;if(closed){worker.terminate();await parsed.cleanup?.();throw new Error('服务已关闭');}
            if(role==='baseline'){await worker.terminate();return json(result);}
            const previous=heapSession;
            const sessionId=randomUUID();heapSession={worker,sessionId,filePath:parsed.filePath,cleanup:parsed.cleanup,sharkResources:await sharkResources};
            worker.on('error',()=>{if(heapSession?.worker===worker){const expired=heapSession;heapSession=null;expired.cleanup?.();}});
            worker.on('exit',()=>{if(heapSession?.worker===worker){const expired=heapSession;heapSession=null;expired.cleanup?.();}});
            if(previous){await previous.worker.terminate();await previous.cleanup?.();}
            return json({...result,sessionId,sharkAvailable:heapSession.sharkResources.available});
          }finally{heapBusy=false;}
        }
        if(path==='/api/heap/mapping'){
          const declared=req.headers['content-length'];
          if(heapBusy||mappingBusy||sharkBusy){req.resume();return json({error:'堆文件或 Shark 分析正在运行，请等待完成'},409);}
          if(!heapSession||req.headers['x-heap-session']!==heapSession.sessionId){req.resume();throw new Error('堆快照已关闭或已替换，请重新导入');}
          if(declared!==undefined&&(!/^\d+$/.test(declared)||Number(declared)>128*1024*1024)){req.resume();throw Object.assign(new Error('混淆映射文件不能超过 128 MiB'),{status:413});}
          let fileName='';try{fileName=decodeURIComponent(String(req.headers['x-heap-mapping-name']||''));}catch{req.resume();throw new Error('混淆映射文件名无效');}
          if(!fileName||fileName.length>240||/[\x00-\x1f\x7f/\\]/.test(fileName)||!/(\.map|\.txt)$/i.test(fileName)){req.resume();throw new Error('请选择 .map 或 .txt 混淆映射文件');}
          mappingBusy=true;const folder=dirname(heapSession.filePath),temp=join(folder,`mapping-${randomUUID()}.tmp`),mappingPath=join(folder,`mapping-${randomUUID()}.txt`);let size=0,decoder=new TextDecoder('utf-8',{fatal:true}),file;
          try{
            file=await open(temp,'wx',0o600);
            for await(const chunk of req.iterator({destroyOnReturn:false})){
              size+=chunk.length;if(size>128*1024*1024)throw Object.assign(new Error('混淆映射文件不能超过 128 MiB'),{status:413});
              if(decoder.decode(chunk,{stream:true}).includes('\0'))throw new Error('混淆映射必须是 UTF-8 文本');
              let offset=0;while(offset<chunk.length){const {bytesWritten}=await file.write(chunk,offset,chunk.length-offset);if(!bytesWritten)throw new Error('混淆映射文件写入失败');offset+=bytesWritten;}
            }
            if(decoder.decode().includes('\0'))throw new Error('混淆映射必须是 UTF-8 文本');
            if(!size)throw new Error('混淆映射文件为空');await file.close();file=null;await rename(temp,mappingPath);
            const previous=heapSession.mappingPath;heapSession.mappingPath=mappingPath;heapSession.mappingName=fileName;heapSession.mappingBytes=size;if(previous)await rm(previous,{force:true});
            return json({fileName,size});
          }catch(error){if(file)await file.close().catch(()=>{});await rm(temp,{force:true});throw error;}finally{mappingBusy=false;}
        }
        if(path==='/api/heap/mapping/clear'){
          const body=await readBody(req);if(heapBusy||mappingBusy||sharkBusy)return json({error:'堆文件或 Shark 分析正在运行，请等待完成'},409);
          if(!heapSession||body.sessionId!==heapSession.sessionId)throw new Error('堆快照已关闭或已替换，请重新导入');
          mappingBusy=true;try{if(heapSession.mappingPath)await rm(heapSession.mappingPath,{force:true});heapSession.mappingPath=null;heapSession.mappingName=null;heapSession.mappingBytes=null;return json({cleared:true});}finally{mappingBusy=false;}
        }
        if(path==='/api/heap/shark-analysis'){
          const body=await readBody(req);
          if(heapBusy||mappingBusy||sharkBusy)return json({error:'堆文件或 Shark 分析正在运行，请等待完成'},409);
          if(!heapSession||body.sessionId!==heapSession.sessionId)throw new Error('堆快照已关闭或已替换，请重新导入');
          sharkBusy=true;try{return json(await analyzeWithShark(heapSession.filePath,heapSession.sharkResources,{mappingPath:heapSession.mappingPath??null}));}finally{sharkBusy=false;}
        }
        if (path === '/api/apk/analyze') {
          if(apkBusy){req.resume();return json({error:'已有 APK 正在分析，请等待完成'},409);}
          apkBusy=true;
          try { return json(await analyzeApkUpload(req,apkAnalyzer)); } finally { apkBusy=false; }
        }
        const body = await readBody(req);
        if(path==='/api/cpu-profile/archive/load'){
          if(perfBusy)return json({error:'已有 CPU 文件正在处理'},409);
          perfBusy=true;let handedOff=false;try{
            const checked=await verifyGpuArtifact(perfDir,body.id);if(!checked.ok)throw new Error(`采样档案完整性校验失败：${checked.reason}`);
            if(checked.meta.size>256*1024*1024)throw new Error('perf.data 不能超过 256 MiB');
            const {path:file}=await getGpuArtifact(perfDir,body.id),stream=createReadStream(file);
            stream.once('error',()=>{perfBusy=false;res.destroy();});res.once('close',()=>{perfBusy=false;stream.destroy();});
            res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':checked.meta.size});handedOff=true;return stream.pipe(res);
          }finally{if(!handedOff)perfBusy=false;}
        }
        if(path==='/api/trace/archive'){
          if(traceBusy)return json({error:'已有追踪任务正在处理，请等待完成'},409);
          if(!traceSession||body.sessionId!==traceSession.sessionId)throw new Error('追踪会话已关闭或已替换，请重新导入');
          if(typeof body.name!=='string'||body.name.length>240||/[\x00-\x1f\x7f]/.test(body.name))throw new Error('追踪名称无效');
          const base=body.name.replaceAll('\\','/').split('/').at(-1)||'capture';
          const name=/\.(?:trace|pftrace|perfetto-trace)$/i.test(base)?base:`${base}.trace`;
          traceBusy=true;try{const stream=createReadStream(traceSession.path);stream.headers={'content-length':String(traceSession.fileBytes),'x-file-name':encodeURIComponent(name)};return json(await importGpuArtifact(stream,traceDir),201);}finally{traceBusy=false;}
        }
        if(path==='/api/trace/archive/load'){
          if(traceBusy)return json({error:'已有追踪任务正在处理，请等待完成'},409);
          traceBusy=true;try{
            const checked=await verifyGpuArtifact(traceDir,body.id);if(!checked.ok)throw new Error(`追踪完整性校验失败：${checked.reason}`);
            if(checked.meta.size>256*1024*1024)throw new Error('追踪分析上限为 256 MiB');
            const {path:file}=await getGpuArtifact(traceDir,body.id);const stream=createReadStream(file);stream.headers={'content-length':String(checked.meta.size)};
            const {result,session}=await analyzeTraceUpload(stream,{retain:true});if(closed){await session.cleanup();throw new Error('服务已关闭');}
            const previous=traceSession,sessionId=randomUUID();traceSession={...session,sessionId,bounds:result.bounds,fileBytes:result.fileBytes};if(previous)await previous.cleanup();
            return json({...result,sessionId,viewBounds:result.bounds,fileName:checked.meta.name});
          }finally{traceBusy=false;}
        }
        if(path==='/api/trace/export'){
          if(traceBusy)return json({error:'已有追踪任务正在处理，请等待完成'},409);
          if(!traceSession||body.sessionId!==traceSession.sessionId)throw new Error('追踪会话已关闭或已替换，请重新导入');
          traceBusy=true;
          const stream=createReadStream(traceSession.path);
          stream.once('error',()=>{traceBusy=false;res.destroy();});
          res.once('close',()=>{traceBusy=false;stream.destroy();});
          res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':traceSession.fileBytes,'Content-Disposition':'attachment; filename="capture.trace"'});
          return stream.pipe(res);
        }
        if(path==='/api/source/snapshot'){
          if(sourceBusy)return json({error:'已有源码快照任务正在进行'},409);
          sourceBusy=true;try{return json(await createSourceSnapshot(body.path,sourceDir),201);}finally{sourceBusy=false;}
        }
        if(path==='/api/source/remote'){
          if(sourceBusy)return json({error:'已有源码快照任务正在进行'},409);
          sourceBusy=true;try{return json(await createRemoteSourceSnapshot({url:body.url,ref:body.ref??''},sourceDir),201);}finally{sourceBusy=false;}
        }
        if(path==='/api/source/files')return json(await getSourceSnapshot(sourceDir,body.id));
        if(path==='/api/source/file')return json(await readSourceFile(sourceDir,body.id,body.path));
        if(path==='/api/source/search')return json(await searchSource(sourceDir,body.id,body.query));
        if(path==='/api/source/resolve')return json(await resolveSourceSymbol(sourceDir,body.id,body.symbol));
        if(path==='/api/trace/slice-arguments'){
          if(traceBusy)return json({error:'已有追踪任务正在处理，请等待完成'},409);
          if(!traceSession||body.sessionId!==traceSession.sessionId)throw new Error('追踪会话已关闭或已替换，请重新导入');
          traceBusy=true;try{return json(await querySliceArguments(traceSession.path,{sliceId:body.sliceId}));}finally{traceBusy=false;}
        }
        if(path==='/api/trace/query'){
          if(traceBusy)return json({error:'已有追踪任务正在处理，请等待完成'},409);
          if(!traceSession||body.sessionId!==traceSession.sessionId)throw new Error('追踪会话已关闭或已替换，请重新导入');
          traceBusy=true;try{return json({...await queryTraceSql(traceSession.path,{sql:body.sql}),sessionId:traceSession.sessionId});}finally{traceBusy=false;}
        }
        if(path==='/api/trace/binder-breakdown'){
          if(traceBusy)return json({error:'已有追踪任务正在处理，请等待完成'},409);
          if(!traceSession||body.sessionId!==traceSession.sessionId)throw new Error('追踪会话已关闭或已替换，请重新导入');
          traceBusy=true;try{return json(await queryBinderBreakdown(traceSession.path,{id:body.id}));}finally{traceBusy=false;}
        }
        if(path==='/api/trace/binder'){
          if(traceBusy)return json({error:'已有追踪任务正在处理，请等待完成'},409);
          if(!traceSession||body.sessionId!==traceSession.sessionId)throw new Error('追踪会话已关闭或已替换，请重新导入');
          traceBusy=true;try{return json(await queryBinderTransactions(traceSession.path,{packageName:body.packageName??null,direction:body.direction??'both'}));}finally{traceBusy=false;}
        }
        if(path==='/api/trace/thread-states'){
          if(traceBusy)return json({error:'已有追踪任务正在处理，请等待完成'},409);
          if(!traceSession||body.sessionId!==traceSession.sessionId)throw new Error('追踪会话已关闭或已替换，请重新导入');
          const {startNs,endNs}=body;if(typeof startNs!=='string'||typeof endNs!=='string'||! /^-?\d{1,19}$/.test(startNs)||! /^-?\d{1,19}$/.test(endNs)||BigInt(startNs)<BigInt(traceSession.bounds.startNs)||BigInt(endNs)>BigInt(traceSession.bounds.endNs)||BigInt(endNs)<=BigInt(startNs))throw new Error('追踪时间窗口超出范围');
          traceBusy=true;try{return json(await queryThreadStates(traceSession.path,{tid:body.tid,pid:body.pid??null,startNs,endNs}));}finally{traceBusy=false;}
        }
        if(path==='/api/trace/frame-thread-states'){
          if(traceBusy)return json({error:'已有追踪任务正在处理，请等待完成'},409);
          if(!traceSession||body.sessionId!==traceSession.sessionId)throw new Error('追踪会话已关闭或已替换，请重新导入');
          const {startNs,endNs}=body;if(typeof startNs!=='string'||typeof endNs!=='string'||! /^-?\d{1,19}$/.test(startNs)||! /^-?\d{1,19}$/.test(endNs)||BigInt(startNs)<BigInt(traceSession.bounds.startNs)||BigInt(endNs)>BigInt(traceSession.bounds.endNs)||BigInt(endNs)<=BigInt(startNs))throw new Error('追踪时间窗口超出范围');
          traceBusy=true;try{return json(await queryThreadStates(traceSession.path,{upid:body.upid,utid:body.utid??null,state:body.state??null,startNs,endNs}));}finally{traceBusy=false;}
        }
        if(path==='/api/trace/startup-breakdown'){
          if(traceBusy)return json({error:'已有追踪任务正在处理，请等待完成'},409);
          if(!traceSession||body.sessionId!==traceSession.sessionId)throw new Error('追踪会话已关闭或已替换，请重新导入');
          traceBusy=true;try{return json(await queryStartupBreakdown(traceSession.path,{startupId:body.startupId}));}finally{traceBusy=false;}
        }
        if(path==='/api/trace/startup-art-attribution'){
          if(traceBusy)return json({error:'已有追踪任务正在处理，请等待完成'},409);
          if(!traceSession||body.sessionId!==traceSession.sessionId)throw new Error('追踪会话已关闭或已替换，请重新导入');
          const startup=body.startup,start=startup?.tsNs,ttfd=startup?.ttfdNs;
          if(typeof start!=='string'||!/^-?\d{1,19}$/.test(start)||typeof ttfd!=='string'||!/^\d{1,19}$/.test(ttfd)||BigInt(start)<BigInt(traceSession.bounds.startNs)||BigInt(start)+BigInt(ttfd)>BigInt(traceSession.bounds.endNs))throw new Error('启动里程碑超出追踪范围');
          traceBusy=true;try{return json(await queryStartupArtAttribution(traceSession.path,{startup}));}finally{traceBusy=false;}
        }
        if(path==='/api/trace/startups'){
          if(traceBusy)return json({error:'已有追踪任务正在处理，请等待完成'},409);
          if(!traceSession||body.sessionId!==traceSession.sessionId)throw new Error('追踪会话已关闭或已替换，请重新导入');
          traceBusy=true;try{return json(await queryStartupTrace(traceSession.path,{packageName:body.packageName??null}));}finally{traceBusy=false;}
        }
        if(path==='/api/trace/frame-timeline'){
          if(traceBusy)return json({error:'已有追踪任务正在处理，请等待完成'},409);
          if(!traceSession||body.sessionId!==traceSession.sessionId)throw new Error('追踪会话已关闭或已替换，请重新导入');
          traceBusy=true;try{return json(await queryFrameTimeline(traceSession.path,{packageName:body.packageName??null}));}finally{traceBusy=false;}
        }
        if (path === '/api/trace/window') {
          if(traceBusy)return json({error:'已有追踪任务正在处理，请等待完成'},409);
          if(!traceSession||body.sessionId!==traceSession.sessionId)throw new Error('追踪会话已关闭或已替换，请重新导入');
          const {startNs,endNs}=body;if(typeof startNs!=='string'||typeof endNs!=='string'||! /^-?\d{1,19}$/.test(startNs)||! /^-?\d{1,19}$/.test(endNs))throw new Error('追踪时间窗口无效');
          if(BigInt(startNs)<BigInt(traceSession.bounds.startNs)||BigInt(endNs)>BigInt(traceSession.bounds.endNs)||BigInt(endNs)<=BigInt(startNs))throw new Error('追踪时间窗口超出范围');
          const trackFilter=body.trackFilter??'',sliceFilter=body.sliceFilter??'';
          traceBusy=true;try{const result=await queryTraceFile(traceSession.path,{startNs,endNs,trackFilter,sliceFilter});return json({...result,fileBytes:traceSession.fileBytes,sessionId:traceSession.sessionId,viewBounds:{startNs,endNs},trackFilter,sliceFilter});}finally{traceBusy=false;}
        }
        if (path === '/api/heap/instances' || path === '/api/heap/bitmaps' || path === '/api/heap/bitmap-duplicates' || path === '/api/heap/string-duplicates' || path === '/api/heap/string-search' || path === '/api/heap/destroyed-activities' || path === '/api/heap/leakcanary-retained' || path === '/api/heap/object' || path === '/api/heap/root-path' || path === '/api/heap/root-paths' || path === '/api/heap/incoming' || path === '/api/heap/dominators') {
          if(!heapSession || body.sessionId !== heapSession.sessionId)throw new Error('堆快照已关闭或已替换，请重新导入');
          return json(await queryHeapWorker(heapSession.worker,path.endsWith('instances')?'instances':path.endsWith('bitmap-duplicates')?'duplicateBitmaps':path.endsWith('string-duplicates')?'duplicateStrings':path.endsWith('string-search')?'searchStrings':path.endsWith('destroyed-activities')?'destroyedActivities':path.endsWith('leakcanary-retained')?'leakCanaryRetainedObjects':path.endsWith('bitmaps')?'bitmaps':path.endsWith('root-paths')?'rootPaths':path.endsWith('root-path')?'rootPath':path.endsWith('incoming')?'incoming':path.endsWith('dominators')?'dominators':'object',body));
        }
        if(path==='/api/gpu/verify') return json(await verifyGpuArtifact(gpuDir,body.id));
        if(path==='/api/gpu/trace') {
          if(traceBusy)return json({error:'已有追踪任务正在处理，请等待完成'},409);
          traceBusy=true;try{
            const checked=await verifyGpuArtifact(gpuDir,body.id);if(!checked.ok)throw new Error(`产物校验失败：${checked.reason}`);
            if(checked.meta.type==='agi-frame')throw new Error('AGI 帧捕获不能作为 Perfetto 追踪解析');
            if(checked.meta.size>256*1024*1024)throw new Error('追踪分析上限为 256 MiB');
            const {path:file}=await getGpuArtifact(gpuDir,body.id);const stream=createReadStream(file);stream.headers={'content-length':String(checked.meta.size)};
            const {result,session}=await analyzeTraceUpload(stream,{retain:true});if(closed){await session.cleanup();throw new Error('服务已关闭');}
            const previous=traceSession,sessionId=randomUUID();traceSession={...session,sessionId,bounds:result.bounds,fileBytes:result.fileBytes};if(previous)await previous.cleanup();
            return json({...result,sessionId,viewBounds:result.bounds,fileName:checked.meta.name});
          }finally{traceBusy=false;}
        }
        if(path==='/api/battery/snapshot')return json(await adb.batterySnapshot(body.serial,body.packageName));
        if(path==='/api/battery/checkin'){
          const raw=await adb.batteryCheckin(body.serial,body.packageName);
          res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="batterystats-checkin.csv"'});
          return res.end(raw);
        }
        if(path==='/api/battery/import')return json(parseBatteryStats(body.text,body.packageName));
        if(path==='/api/battery/compare')return json(compareBatteryStats(body.before,body.after));
        if(path==='/api/network/agent')return json(await adb.networkAgentSnapshot(body.serial,body.packageName));
        if(path==='/api/gpu/capabilities')return json(await adb.gpuCapabilities(body.serial));
        if (path === '/api/frames/import') {
          if (typeof body.text !== 'string' || ![16.667, 11.111, 8.333].includes(body.budget)) throw new Error('gfxinfo 导入参数无效');
          const parsed = parseFrames(body.text, body.budget);
          if (!parsed.count) throw new Error('文件没有有效的 PROFILEDATA 帧记录，请导出 gfxinfo framestats 文本');
          return json({ ...parsed, raw: body.text, source: 'import', timestamp: Date.now() });
        }
        if (path === '/api/frames/reset') return json({ message: await adb.resetFrames(body.serial, body.packageName) });
        if (path === '/api/startup') return json(await adb.startup(body.serial, body.packageName, body));
        if (path === '/api/benchmark/run') return json(await adb.runBenchmark(body.serial,body.component,body.testClass??''));
        if (path === '/api/benchmark/report') return json(await adb.readBenchmarkReport(body.serial,body.path));
        if (path === '/api/layout') return json(await adb.layout(body.serial));
        if (path === '/api/layout/agent') return json(await adb.layoutAgent(body.serial,body.packageName,body.token));
        if (path === '/api/cpu-profile') {
          const data=await adb.captureCpuProfile(body.serial,body.packageName,body.seconds,undefined,body.events??['cpu-clock:u']);
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="perf.data"' });
          return res.end(data);
        }
        if (path === '/api/cpu-events') return json(await adb.listCpuEvents(body.serial));
        if (path === '/api/heap') {
          const data = await adb.heapDump(body.serial, body.packageName);
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="heap.hprof"' });
          return res.end(data);
        }
        if (path === '/api/trace') {
          const data = await adb.trace(body.serial, body.seconds ?? 10, body.mode ?? 'standard',body.packageName??null);
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="capture.perfetto-trace"' });
          return res.end(data);
        }
        if(path==='/api/heap-profile'){
          const mode=body.mode??'native',data=await adb.heapProfile(body.serial,body.packageName,body.seconds??10,mode,body.samplingIntervalBytes??4096);
          res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="capture-${mode==='art'?'art':'native'}-heap.perfetto-trace"`});return res.end(data);
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
  server.on('close',()=>{closed=true;if(heapSession){const expired=heapSession;heapSession=null;expired.worker.terminate();expired.cleanup?.();}if(traceSession){try{traceSession.cleanupSync();}catch{}traceSession=null;}});
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
