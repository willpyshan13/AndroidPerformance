import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, readFile, unlink } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { parseDevices, parseMemory, parseCpu, parseFrames, parseBattery, parseStartup, parseProcCpu, cpuDelta } from './parsers.js';

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
  async packages(serial) {
    const result = await this.shell(serial, ['pm', 'list', 'packages']);
    return result.split(/\r?\n/).filter(s => s.startsWith('package:')).map(s => s.slice(8).trim()).sort();
  }
  async info(serial) {
    const [model, version, api, abi] = await Promise.all(['ro.product.model', 'ro.build.version.release', 'ro.build.version.sdk', 'ro.product.cpu.abi']
      .map(key => this.shell(serial, ['getprop', key]).then(s => s.trim())));
    let perfettoAvailable = false;
    try { perfettoAvailable = !!(await this.shell(serial, ['which', 'perfetto'])).trim(); } catch {}
    return { model, version, api, abi, serial, perfettoAvailable };
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
  async frames(serial, packageName, budgetMs) {
    validateTarget(serial, packageName);
    const raw = await this.shell(serial, ['dumpsys', 'gfxinfo', packageName, 'framestats']);
    return { ...parseFrames(raw, budgetMs), raw, timestamp: Date.now(), source: 'adb', serial, packageName };
  }
  async resetFrames(serial, packageName) {
    validateTarget(serial, packageName);
    return this.shell(serial, ['dumpsys', 'gfxinfo', packageName, 'reset']);
  }
  async startup(serial, packageName, { mode = 'cold', runs = 3 } = {}) {
    validateTarget(serial, packageName);
    if (!['cold', 'warm', 'hot'].includes(mode) || !Number.isInteger(runs) || runs < 1 || runs > 10) throw new Error('启动参数无效');
    return this.exclusive(serial, async () => {
      const resolve = await this.shell(serial, ['cmd', 'package', 'resolve-activity', '--brief', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', packageName]);
      const component = resolve.trim().split(/\r?\n/).find(s => /^[\w.]+\/[\w.$]+$/.test(s));
      if (!component || !component.startsWith(`${packageName}/`)) throw new Error('没有找到目标应用的可启动 Activity');
      const start = () => this.shell(serial, ['am', 'start', '-W', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', '-n', component], { timeout: 45000 });
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
      return { source: 'adb', timestamp: Date.now(), serial, packageName, requestedMode: mode, results,
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
        let screenshot = null, imageSize = null, warning = null;
        try {
          const png = await this.run(['-s', serial, 'exec-out', 'screencap', '-p'], { encoding: 'buffer' });
          if (png.length < 24 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('设备截图不是有效 PNG');
          imageSize = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
          screenshot = png.toString('base64');
        }
        catch (error) { warning = error.message; }
        return { xml, screenshot, imageSize, warning, source: 'adb', timestamp: Date.now(), serial,
          note: 'UIAutomator 可访问性层级快照；不是完整 View/Compose 树。截图与层级为顺序采集，动画期间可能不一致。' };
      } finally { await this.shell(serial, ['rm', '-f', remote]).catch(() => {}); }
    });
  }
  async trace(serial, seconds = 10) {
    validateTarget(serial);
    if (!Number.isInteger(seconds) || seconds < 3 || seconds > 30) throw new Error('采集时长须为 3–30 秒');
    return this.exclusive(serial, async () => {
      let available = false;
      try { available = !!(await this.shell(serial, ['which', 'perfetto'])).trim(); } catch {}
      if (!available) throw new Error('当前设备没有 perfetto 程序，无法录制系统追踪；内置 Perfetto 通常需要 Android 9 或更高版本');
      const id = randomUUID();
      const remote = `/data/misc/perfetto-traces/apw-${id}.perfetto-trace`;
      const local = join(tmpdir(), `apw-${id}.perfetto-trace`);
      try {
        await this.shell(serial, ['perfetto', '-o', remote, '-t', `${seconds}s`, '-b', '32mb', 'sched', 'freq', 'idle', 'am', 'wm', 'gfx', 'view', 'binder_driver'], { timeout: (seconds + 30) * 1000 });
        await this.run(['-s', serial, 'pull', remote, local], { timeout: 30000 });
        const data = await readFile(local);
        if (!data.length) throw new Error('Perfetto 返回了空文件');
        return data;
      } finally {
        await Promise.allSettled([this.shell(serial, ['rm', '-f', remote]), unlink(local)]);
      }
    });
  }
}
