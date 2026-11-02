import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, readFile, unlink, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { locateDeviceSimpleperf } from './simpleperf.js';
import { parseBatteryStats } from './battery.js';
import { parseNetworkAgentLog } from './network-agent.js';
import { parseGpuCapabilities } from './gpu.js';
import { parseDevices, parseMemory, parseCpu, parseFrames, parseBattery, parseStartup, parseCompilationState, parseProcCpu, cpuDelta } from './parsers.js';

const exec = promisify(execFile);
export function validateTarget(serial, packageName) {
  if (typeof serial !== 'string' || !/^[\w.:[\]-]{1,200}$/.test(serial)) throw new Error('请选择有效的设备');
  if (packageName !== undefined && (typeof packageName !== 'string' || !/^[a-zA-Z][\w]*(?:\.[\w]+)+$/.test(packageName))) throw new Error('应用包名无效');
}

export async function locateAdb() {
  const candidates = [process.env.ADB_PATH,
    process.resourcesPath && join(process.resourcesPath, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb'),
    join(dirname(dirname(fileURLToPath(import.meta.url))), 'tools/platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb'),
    process.env.ANDROID_HOME && join(process.env.ANDROID_HOME, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb'),
    process.env.ANDROID_SDK_ROOT && join(process.env.ANDROID_SDK_ROOT, 'platform-tools', 'adb'),
    join(homedir(), 'Library/Android/sdk/platform-tools/adb'),
    join(homedir(), 'Android/Sdk/platform-tools/adb'),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe')].filter(Boolean);
  for (const candidate of candidates) { try { await access(candidate); return candidate; } catch {} }
  return 'adb';
}

export class Adb {
  constructor(path, runner = exec) { this.path = path; this.runner = runner; this.busy = new Set(); this.cpuSnapshots = new Map(); }
  async run(args, options = {}) {
    try {
      const result = await this.runner(this.path, args, { timeout: 20000, maxBuffer: 24 * 1024 * 1024, encoding: 'utf8', windowsHide: true, ...options });
      return result.stdout;
    } catch (error) {
      if (error.signal === 'SIGKILL') throw new Error('ADB 被系统强制终止（SIGKILL），请检查程序签名或选择新下载的官方 Platform Tools；当前路径：' + this.path);
      const detail = error.stderr?.toString().trim() || error.message;
      throw new Error(error.code === 'ENOENT' ? '未找到 ADB，请设置 ADB_PATH 或安装 Android Platform Tools' : `ADB 执行失败：${detail.slice(0, 1200)}`);
    }
  }
  shell(serial, args, options) {
    validateTarget(serial);
    // adb shell joins arguments into a remote shell command. Quote there as well as using execFile locally.
    const quoted = args.map(arg => `'${String(arg).replaceAll("'", "'\\''")}'`);
    return this.run(['-s', serial, 'shell', ...quoted], options);
  }
  async exclusive(serial, task) {
    if (this.busy.has(serial)) throw new Error('这台设备已有采集任务，请等待完成');
    this.busy.add(serial);
    try { return await task(); } finally { this.busy.delete(serial); }
  }
  async devices() { return parseDevices(await this.run(['devices', '-l'])); }
  async runBenchmark(serial,component,testClass='') {
    validateTarget(serial);
    if(typeof component!=='string'||component.length>400||!/^([a-zA-Z][\w]*(?:\.[\w]+)+)\/(?:\.?[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*)$/.test(component))throw new Error('测试包和 instrumentation runner 格式无效');
    if(typeof testClass!=='string'||testClass.length>300||(testClass&&!/^[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*(?:#[a-zA-Z_$][\w$]*)?$/.test(testClass)))throw new Error('测试类或方法格式无效');
    return this.exclusive(serial,async()=>{
      const testPackage=component.split('/')[0],reportPath=`/sdcard/Android/media/${testPackage}/${testPackage}-benchmarkData.json`;
      const beforeReport=await this.benchmarkReportMetadata(serial,reportPath);
      const startedAt=Date.now(),args=['am','instrument','-w','-r'];
      if(testClass)args.push('-e','class',testClass);
      args.push(component);
      const output=await this.shell(serial,args,{timeout:600000,maxBuffer:4*1024*1024});
      const failed=/^FAILURES!!!|^INSTRUMENTATION_FAILED:|^INSTRUMENTATION_ABORTED:|^INSTRUMENTATION_RESULT:\s*shortMsg=|^Error:/m.test(output);
      const ok=output.match(/^OK \((\d+) tests?\)/m),count=ok?Number(ok[1]):null;
      const finishedAt=Date.now(),afterReport=await this.benchmarkReportMetadata(serial,reportPath),status=failed?'failed':count!==null&&count>0?'completed':'unknown';
      let report=null,reportStatus=status==='failed'?'test-failed':status==='unknown'?'test-unknown':'unavailable';
      if(status==='completed'&&afterReport&&afterReport.modifiedAt>=startedAt-1000&&(!beforeReport||beforeReport.modifiedAt!==afterReport.modifiedAt||beforeReport.size!==afterReport.size)){
        try{report=await this.readBenchmarkReportFile(serial,reportPath);reportStatus='updated';}catch(error){reportStatus='invalid';}
      }else if(status==='completed'&&afterReport)reportStatus='unchanged';
      return {source:'adb',serial,component,testClass,startedAt,finishedAt,status,testCount:count,output,reportPath,report,reportStatus};
    });
  }
  async benchmarkReportMetadata(serial,path){
    try{
      const output=await this.shell(serial,['stat','-c','%Y %s',path],{timeout:10000,maxBuffer:1024});
      const match=output.trim().match(/^(\d{1,12})\s+(\d{1,12})$/);if(!match)return null;
      return {modifiedAt:Number(match[1])*1000,size:Number(match[2])};
    }catch{return null;}
  }
  async readBenchmarkReportFile(serial,path){
    const limit=12*1024*1024,text=await this.shell(serial,['head','-c',String(limit+1),path],{timeout:30000,maxBuffer:limit+1024});
    if(Buffer.byteLength(text,'utf8')>limit)throw new Error('Benchmark 报告超过 12 MiB');
    try{return JSON.parse(text);}catch{throw new Error('设备上的报告不是有效 JSON，或读取不完整');}
  }
  async readBenchmarkReport(serial,path) {
    validateTarget(serial);
    if(typeof path!=='string'||path.length>500||!/^\/(?:sdcard|storage\/emulated\/0)\/Android\/media\/[a-zA-Z][\w]*(?:\.[\w]+)+\/[a-zA-Z0-9_][\w.-]*\.json$/.test(path)||path.split('/').some(part=>part==='..'))throw new Error('报告路径必须是测试包 Android/media 目录下的 JSON 文件');
    return this.exclusive(serial,async()=>{
      const report=await this.readBenchmarkReportFile(serial,path);
      return {report,serial,path,timestamp:Date.now()};
    });
  }
  async packages(serial) {
    const result = await this.shell(serial, ['pm', 'list', 'packages']);
    return result.split(/\r?\n/).filter(s => s.startsWith('package:')).map(s => s.slice(8).trim()).sort();
  }
  async networkAgentSnapshot(serial,packageName) {
    validateTarget(serial,packageName);
    const listing=await this.shell(serial,['cmd','package','list','packages','-U','--user','current',packageName]);
    const entries=listing.split(/\r?\n/).map(line=>line.trim().match(/^package:([^\s]+)\s+uid:(\d+)$/)).filter(Boolean);
    const matches=entries.filter(match=>match[1]===packageName);
    if(matches.length!==1)throw new Error('无法确定目标应用的当前用户 UID，请检查包名和系统权限');
    const uid=matches[0][2];
    const raw=await this.shell(serial,['logcat','-b','main','-t','10000','-v','raw',`--uid=${uid}`,'-s','APWNetwork:I'],{timeout:30000});
    const parsed=parseNetworkAgentLog(raw);
    return {source:'adb',serial,packageName,uid:Number(uid),timestamp:Date.now(),...parsed,limit:10000};
  }
  async info(serial) {
    const [model, version, api, abi] = await Promise.all(['ro.product.model', 'ro.build.version.release', 'ro.build.version.sdk', 'ro.product.cpu.abi']
      .map(key => this.shell(serial, ['getprop', key]).then(s => s.trim())));
    let perfettoAvailable = false;
    try { perfettoAvailable = !!(await this.shell(serial, ['which', 'perfetto'])).trim(); } catch {}
    return { model, version, api, abi, serial, perfettoAvailable };
  }
  async gpuCapabilities(serial){
    validateTarget(serial);
    const [features,gles]=await Promise.allSettled([this.shell(serial,['pm','list','features']),this.shell(serial,['getprop','ro.opengles.version'])]);
    return {source:'adb',serial,timestamp:Date.now(),...parseGpuCapabilities(features.status==='fulfilled'?features.value:null,gles.status==='fulfilled'?gles.value:null),warnings:[features.status==='rejected'?`设备特性读取失败：${features.reason.message}`:null,gles.status==='rejected'?`OpenGL ES 属性读取失败：${gles.reason.message}`:null].filter(Boolean)};
  }
  async cpu(serial, packageName, pid) {
    const key = `${serial}/${packageName}`;
    if (pid) {
      try {
        const counters = parseProcCpu(await this.shell(serial, ['cat', '/proc/stat', `/proc/${pid}/stat`]));
        if (String(counters.pid) !== String(pid)) throw new Error('进程 PID 不一致');
        const current = { ...counters, timestamp: Date.now() }, previous = this.cpuSnapshots.get(key);
        const percent = cpuDelta(previous, current);
        this.cpuSnapshots.delete(key); this.cpuSnapshots.set(key, current);
        if (this.cpuSnapshots.size > 128) this.cpuSnapshots.delete(this.cpuSnapshots.keys().next().value);
        return { percent, method: 'proc-stat', scope: 'main-process', pid, cpuCount: current.cpuCount,
          intervalMs: previous ? current.timestamp - previous.timestamp : null,
          processes: percent === null ? [] : [{ pid: Number(pid), name: packageName, cpu: percent }],
          window: percent === null ? '/proc CPU 计数器基线已建立；等待下一次采样（进程重启或 CPU 核数改变也会重新建立基线）' : `/proc/${pid}/stat · 主进程 · ${((current.timestamp - previous.timestamp) / 1000).toFixed(2)} 秒计数器差值；单核 100%` };
      } catch (error) {
        this.cpuSnapshots.delete(key);
        const fallback = parseCpu(await this.shell(serial, ['dumpsys', 'cpuinfo']), packageName);
        return { ...fallback, fallbackReason: error.message };
      }
    }
    this.cpuSnapshots.delete(key);
    return parseCpu(await this.shell(serial, ['dumpsys', 'cpuinfo']), packageName);
  }
  async metrics(serial, packageName) {
    validateTarget(serial, packageName);
    let pid = null, pidWarning = null;
    try {
      const value = (await this.shell(serial, ['pidof', packageName])).trim();
      pid = value.split(/\s+/).find(v => /^\d+$/.test(v)) || null;
    } catch (error) { pidWarning = error.message; }
    const jobs = [
      ['cpu', null, null],
      // Use an exact PID so memory is not silently taken from an arbitrary package subprocess.
      ['memory', ['dumpsys', 'meminfo', pid || packageName], raw => pid ? { ...parseMemory(raw), pid, scope: 'main-process' } : null],
      ['battery', ['dumpsys', 'battery'], parseBattery],
    ];
    const settled = await Promise.allSettled(jobs.map(async ([key, args, parse]) => [key, key === 'cpu' ? await this.cpu(serial, packageName, pid) : key === 'memory' && !pid ? null : parse(await this.shell(serial, args))]));
    const output = { timestamp: Date.now(), source: 'adb', serial, packageName, pid, warnings: pidWarning ? [pidWarning] : [] };
    settled.forEach((result, i) => {
      if (result.status === 'fulfilled') output[result.value[0]] = result.value[1];
      else { output[jobs[i][0]] = null; output.warnings.push(result.reason.message); }
    });
    if (!output.pid) output.warnings.push('目标主进程未运行或 pidof 不可用，指标可能缺失');
    if (output.cpu?.stale) output.warnings.push('设备 cpuinfo 统计窗口超过 30 秒未更新，CPU 显示不可用');
    else if (output.cpu?.percent === null) output.warnings.push(output.cpu.method === 'proc-stat' ? 'CPU 差值计算需要第二个有效样本，请继续采集' : '设备 cpuinfo 未包含目标应用的 CPU 记录');
    return output;
  }
  async batterySnapshot(serial,packageName) {
    validateTarget(serial,packageName);
    return this.exclusive(serial,async()=>{
      const raw=await this.shell(serial,['dumpsys','batterystats','--checkin'],{timeout:60000});
      let batteryRaw=null;try{batteryRaw=await this.shell(serial,['dumpsys','battery']);}catch{}
      return parseBatteryStats(raw,packageName,{serial,batteryRaw,source:'adb'});
    });
  }
  async batteryCheckin(serial,packageName) {
    validateTarget(serial,packageName);
    return this.exclusive(serial,()=>this.shell(serial,['dumpsys','batterystats','--checkin'],{timeout:60000}));
  }
  async frames(serial, packageName, budgetMs) {
    validateTarget(serial, packageName);
    const raw = await this.shell(serial, ['dumpsys', 'gfxinfo', packageName, 'framestats']);
    return { ...parseFrames(raw, budgetMs), raw, timestamp: Date.now(), source: 'adb', serial, packageName };
  }
  async resetFrames(serial, packageName) {
    validateTarget(serial, packageName);
    return this.shell(serial, ['dumpsys', 'gfxinfo', packageName, 'reset']);
  }
  async compilationSnapshot(serial,packageName){
    validateTarget(serial,packageName);
    try{return {...parseCompilationState(await this.shell(serial,['dumpsys','package',packageName],{timeout:30000}),packageName),timestamp:Date.now(),source:'adb',serial,packageName};}
    catch(error){return {available:false,entries:[],reason:error.message,timestamp:Date.now(),source:'adb',serial,packageName};}
  }
  async startup(serial, packageName, { mode = 'cold', runs = 3 } = {}) {
    validateTarget(serial, packageName);
    if (!['cold', 'warm', 'hot'].includes(mode) || !Number.isInteger(runs) || runs < 1 || runs > 10) throw new Error('启动参数无效');
    return this.exclusive(serial, async () => {
      const resolve = await this.shell(serial, ['cmd', 'package', 'resolve-activity', '--brief', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', packageName]);
      const component = resolve.trim().split(/\r?\n/).find(s => /^[\w.]+\/[\w.$]+$/.test(s));
      if (!component || !component.startsWith(`${packageName}/`)) throw new Error('没有找到目标应用的可启动 Activity');
      const start = () => this.shell(serial, ['am', 'start', '-W', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', '-n', component], { timeout: 45000 });
      const compilationBefore=await this.compilationSnapshot(serial,packageName);
      // Warm/hot experiments establish the Activity first; the device reports the observed mode where supported.
      if (mode !== 'cold') { await start(); await new Promise(r => setTimeout(r, 1000)); }
      const results = [];
      for (let i = 0; i < runs; i++) {
        if (mode === 'cold') await this.shell(serial, ['am', 'force-stop', packageName]);
        if (mode === 'warm') await this.shell(serial, ['input', 'keyevent', '4']);
        if (mode === 'hot') await this.shell(serial, ['input', 'keyevent', '3']);
        await new Promise(r => setTimeout(r, 700));
        const result = parseStartup(await start());
        if (result.status !== 'ok' || result.totalTimeMs === null) throw new Error(`第 ${i + 1} 次启动没有返回有效 TotalTime：${result.raw.slice(0, 600)}`);
        results.push({ run: i + 1, ...result });
        await new Promise(r => setTimeout(r, 700));
      }
      const valid = results.filter(r => r.totalTimeMs !== null && r.status === 'ok');
      const compilationAfter=await this.compilationSnapshot(serial,packageName);
      return { source: 'adb', timestamp: Date.now(), serial, packageName, requestedMode: mode, results, compilationBefore, compilationAfter,
        meanMs: valid.length ? valid.reduce((s, r) => s + r.totalTimeMs, 0) / valid.length : null,
        note: 'TotalTime 来自 am start -W，不等同于 TTFD。warm/hot 是操作协议，实际状态以 LaunchState 为准。' };
    });
  }
  async layout(serial) {
    validateTarget(serial);
    return this.exclusive(serial, async () => {
      const remote = `/data/local/tmp/apw-${randomUUID()}.xml`;
      try {
        await this.shell(serial, ['uiautomator', 'dump', remote], { timeout: 35000 });
        const xml = await this.shell(serial, ['cat', remote]);
        if (!xml.includes('<hierarchy')) throw new Error('设备未返回有效的 UI 层级');
        let screenshot = null, imageSize = null, densityDpi = null, warning = null;const warnings=[];
        try {
          const png = await this.run(['-s', serial, 'exec-out', 'screencap', '-p'], { encoding: 'buffer' });
          if (png.length < 24 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('设备截图不是有效 PNG');
          imageSize = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
          screenshot = png.toString('base64');
        }
        catch (error) { warnings.push(`截图不可用：${error.message}`); }
        try {
          const density=await this.shell(serial,['wm','density']),values=[...density.matchAll(/(?:Physical|Override)\s+density:\s*(\d+)/g)].map(match=>Number(match[1]));
          const candidate=values.at(-1);if(Number.isSafeInteger(candidate)&&candidate>=72&&candidate<=1000)densityDpi=candidate;else warnings.push('设备未报告可识别的显示密度');
        } catch(error) { warnings.push(`显示密度不可用：${error.message}`); }
        warning=warnings.length?warnings.join('；'):null;
        return { xml, screenshot, imageSize, densityDpi, warning, source: 'adb', timestamp: Date.now(), serial,
          note: 'UIAutomator 可访问性层级快照；不是完整 View/Compose 树。截图与层级为顺序采集，动画期间可能不一致。' };
      } finally { await this.shell(serial, ['rm', '-f', remote]).catch(() => {}); }
    });
  }
  async captureCpuProfile(serial, packageName, seconds=10, locator=locateDeviceSimpleperf, events=['cpu-clock:u']) {
    validateTarget(serial,packageName);
    if(!Number.isInteger(seconds)||seconds<3||seconds>30)throw new Error('采样时长须为 3–30 秒');
    if(!Array.isArray(events)||events.length<1||events.length>8||events.some(event=>typeof event!=='string'||event.length>160||!/^[A-Za-z0-9_./:-]+$/.test(event))||new Set(events).size!==events.length)throw new Error('采样事件须为 1–8 个有效且不重复的 simpleperf 事件名');
    return this.exclusive(serial,async()=>{
      const abi=(await this.shell(serial,['getprop','ro.product.cpu.abi'])).trim(),api=(await this.shell(serial,['getprop','ro.build.version.sdk'])).trim(),binary=await locator(abi,api),id=randomUUID();
      const remoteBinary=`/data/local/tmp/apw-simpleperf-${id}`,remoteData=`/data/local/tmp/apw-profile-${id}.data`,local=join(tmpdir(),`apw-profile-${id}.data`);
      try {
        await this.run(['-s',serial,'push',binary,remoteBinary],{timeout:30000});
        await this.shell(serial,['chmod','755',remoteBinary]);
        await this.shell(serial,[remoteBinary,'record','--app',packageName,'-e',events.join(','),'-f','99','--duration',String(seconds),'--call-graph','fp','-o',remoteData],{timeout:(seconds+45)*1000});
        const raw=(await this.shell(serial,['wc','-c',remoteData])).trim(),match=raw.match(/^(\d+)(?:\s|$)/),size=match?Number(match[1]):NaN;
        if(!Number.isSafeInteger(size)||size<8||size>256*1024*1024)throw new Error('采样文件为空或超过 256 MiB 上限');
        await this.run(['-s',serial,'pull',remoteData,local],{timeout:120000});
        const data=await readFile(local);if(data.length!==size||data.subarray(0,8).toString('ascii')!=='PERFILE2')throw new Error('设备未返回有效的 perf.data');
        return data;
      } catch(error) { throw new Error(`CPU 采样失败：${error.message}；目标通常需要可调试或可 profile，设备及内核也必须允许采样。`); }
      finally {await Promise.allSettled([this.shell(serial,['rm','-f',remoteBinary,remoteData]),unlink(local)]);}
    });
  }
  async listCpuEvents(serial, locator=locateDeviceSimpleperf) {
    validateTarget(serial);
    return this.exclusive(serial,async()=>{
      const abi=(await this.shell(serial,['getprop','ro.product.cpu.abi'])).trim(),api=(await this.shell(serial,['getprop','ro.build.version.sdk'])).trim(),binary=await locator(abi,api),remote=`/data/local/tmp/apw-simpleperf-list-${randomUUID()}`;
      try {
        await this.run(['-s',serial,'push',binary,remote],{timeout:30000});
        await this.shell(serial,['chmod','755',remote]);
        const output=await this.shell(serial,[remote,'list'],{timeout:60000,maxBuffer:4*1024*1024});
        const events=[...new Set(output.split(/\r?\n/).map(line=>line.replace(/\s+#.*$/,'').replace(/\s+\(may not supported\)\s*$/,'').trim()).filter(name=>/^[A-Za-z0-9_./:-]{1,160}$/.test(name)))].slice(0,2000);
        if(!events.length)throw new Error('simpleperf 未返回可识别的设备事件');
        return {events,source:'simpleperf list'};
      } finally {await this.shell(serial,['rm','-f',remote]).catch(()=>{});}
    });
  }
  async waitHeapFile(serial, remote, { timeoutMs = 120000, intervalMs = 1000, stableChecks = 3 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let previous = 0, stable = 0;
    while (Date.now() < deadline) {
      const raw = await this.shell(serial, ['wc', '-c', remote]);
      const match = raw.trim().match(/^(\d+)(?:\s|$)/);
      if (!match) throw new Error('无法读取设备堆文件大小');
      const size = Number(match[1]);
      if (!Number.isSafeInteger(size) || size > 256 * 1024 * 1024) throw new Error('堆文件超过 256 MiB 上限');
      stable = size > 0 && size === previous ? stable + 1 : 0;
      if (stable >= stableChecks) return size;
      previous = size;
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    throw new Error('等待堆文件生成超时；请确认应用可调试且设备存储空间充足');
  }
  async heapDump(serial, packageName) {
    validateTarget(serial, packageName);
    return this.exclusive(serial, async () => {
      const id = randomUUID();
      const remote = `/data/local/tmp/apw-${id}.hprof`;
      const local = join(tmpdir(), `apw-${id}.hprof`);
      try {
        const result = await this.shell(serial, ['am', 'dumpheap', packageName, remote], { timeout: 120000 });
        if (/error|exception|not debuggable|permission denied/i.test(result)) throw new Error(`堆转储失败：${result.trim().slice(0, 500)}`);
        const remoteSize = await this.waitHeapFile(serial, remote);
        await this.run(['-s', serial, 'pull', remote, local], { timeout: 120000 });
        const size = (await stat(local)).size;
        if (size !== remoteSize) throw new Error('堆文件在复制过程中发生变化，请重新采集');
        if (!size || size > 256 * 1024 * 1024) throw new Error('堆文件为空或超过 256 MiB 上限');
        const data = await readFile(local);
        if (!data.subarray(0, 32).toString('ascii').startsWith('JAVA PROFILE ')) throw new Error('设备返回的文件不是有效 HPROF');
        return data;
      } finally {
        await Promise.allSettled([this.shell(serial, ['rm', '-f', remote]), unlink(local)]);
      }
    });
  }
  async trace(serial, seconds = 10, mode = 'standard', packageName = null) {
    validateTarget(serial,packageName===null?undefined:packageName);
    if (!Number.isInteger(seconds) || seconds < 3 || seconds > 30) throw new Error('采集时长须为 3–30 秒');
    if (!['standard', 'frame-timeline'].includes(mode)) throw new Error('追踪采集模式无效');
    return this.exclusive(serial, async () => {
      let available = false;
      try { available = !!(await this.shell(serial, ['which', 'perfetto'])).trim(); } catch {}
      if (!available) throw new Error('当前设备没有 perfetto 程序，无法录制系统追踪；内置 Perfetto 通常需要 Android 9 或更高版本');
      const id = randomUUID();
      const remote = `/data/misc/perfetto-traces/apw-${id}.perfetto-trace`;
      const local = join(tmpdir(), `apw-${id}.perfetto-trace`);
      const configRemote = `/data/misc/perfetto-configs/apw-${id}.pbtxt`;
      const configLocal = join(tmpdir(), `apw-${id}.pbtxt`);
      try {
        if (mode === 'frame-timeline') {
          const sdk=(await this.shell(serial,['getprop','ro.build.version.sdk'])).trim();
          if(!/^\d+$/.test(sdk)||Number(sdk)<31)throw new Error('FrameTimeline 录制需要 Android 12（API 31）或更高版本');
          const config=`duration_ms: ${seconds*1000}\nbuffers { size_kb: 32768 }\ndata_sources { config { name: "linux.ftrace" ftrace_config { ftrace_events: "sched/sched_switch" ftrace_events: "sched/sched_waking" ftrace_events: "power/cpu_frequency" ftrace_events: "power/cpu_idle" atrace_categories: "am" atrace_categories: "wm" atrace_categories: "gfx" atrace_categories: "view" atrace_categories: "binder_driver" ${packageName?`atrace_apps: "${packageName}"`:''} } } }\ndata_sources { config { name: "linux.process_stats" process_stats_config { scan_all_processes_on_start: true } } }\ndata_sources { config { name: "android.surfaceflinger.frametimeline" } }\n`;
          await writeFile(configLocal,config,{flag:'wx',mode:0o600});
          await this.run(['-s',serial,'push',configLocal,configRemote],{timeout:30000});
          await this.shell(serial,['perfetto','--txt','-c',configRemote,'-o',remote],{timeout:(seconds+30)*1000});
        } else {
          await this.shell(serial, ['perfetto', '-o', remote, '-t', `${seconds}s`, '-b', '32mb', ...(packageName?['-a',packageName]:[]), 'sched', 'freq', 'idle', 'am', 'wm', 'gfx', 'view', 'binder_driver'], { timeout: (seconds + 30) * 1000 });
        }
        await this.run(['-s', serial, 'pull', remote, local], { timeout: 30000 });
        const data = await readFile(local);
        if (!data.length) throw new Error('Perfetto 返回了空文件');
        return data;
      } finally {
        await Promise.allSettled([this.shell(serial, ['rm', '-f', remote, configRemote]), unlink(local), unlink(configLocal)]);
      }
    });
  }
  async heapProfile(serial,packageName,seconds=10,mode='native',samplingIntervalBytes=4096){
    validateTarget(serial,packageName);
    if(!Number.isInteger(seconds)||seconds<5||seconds>30)throw new Error('内存剖析时长须为 5–30 秒');
    if(!['native','art'].includes(mode))throw new Error('内存剖析模式无效');
    if(!Number.isSafeInteger(samplingIntervalBytes)||samplingIntervalBytes<4096||samplingIntervalBytes>1048576)throw new Error('采样间隔须为 4 KiB–1 MiB');
    return this.exclusive(serial,async()=>{
      const sdk=(await this.shell(serial,['getprop','ro.build.version.sdk'])).trim();
      if(!/^\d+$/.test(sdk))throw new Error('无法读取设备 Android API 级别');
      const api=Number(sdk),minimum=mode==='art'?31:29;
      if(api<minimum)throw new Error(`${mode==='art'?'ART 分配样本':'Native 堆剖析'}需要 Android ${mode==='art'?'12（API 31）':'10（API 29）'}或更高版本`);
      let available=false;try{available=!!(await this.shell(serial,['which','perfetto'])).trim();}catch{}
      if(!available)throw new Error('当前设备没有 perfetto 程序，无法采集内存分配剖析');
      const id=randomUUID(),remote=`/data/misc/perfetto-traces/apw-heap-${id}.perfetto-trace`,local=join(tmpdir(),`apw-heap-${id}.perfetto-trace`),configRemote=`/data/misc/perfetto-configs/apw-heap-${id}.pbtxt`,configLocal=join(tmpdir(),`apw-heap-${id}.pbtxt`);
      try{
        const heaps=api>=31?`heaps: "${mode==='art'?'com.android.art':'libc.malloc'}"`:'';
        const config=`duration_ms: ${seconds*1000}\nbuffers { size_kb: 32768 }\ndata_sources { config { name: "android.heapprofd" target_buffer: 0 heapprofd_config { sampling_interval_bytes: ${samplingIntervalBytes} process_cmdline: "${packageName}" ${heaps} continuous_dump_config { dump_interval_ms: 5000 } } } }\n`;
        await writeFile(configLocal,config,{flag:'wx',mode:0o600});
        await this.run(['-s',serial,'push',configLocal,configRemote],{timeout:30000});
        await this.shell(serial,['perfetto','--txt','-c',configRemote,'-o',remote],{timeout:(seconds+30)*1000,maxBuffer:4*1024*1024});
        await this.run(['-s',serial,'pull',remote,local],{timeout:120000});
        const size=(await stat(local)).size;if(!size||size>256*1024*1024)throw new Error('内存剖析追踪为空或超过 256 MiB 上限');
        return await readFile(local);
      }finally{await Promise.allSettled([this.shell(serial,['rm','-f',remote,configRemote]),unlink(local),unlink(configLocal)]);}
    });
  }
}
