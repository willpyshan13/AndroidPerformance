import { spawn } from 'node:child_process';
import { realpath, stat, readdir, readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

const TASK_PATTERN = /^:?[A-Za-z0-9_][A-Za-z0-9_.:-]{0,179}$/;
const MAX_OUTPUT = 1024 * 1024;
const MAX_REPORT = 8 * 1024 * 1024;
const MAX_FILES = 5000;
const EXPERIMENT_OPTIONS = {
  startupMode: ['COLD', 'WARM', 'HOT'],
  compilationMode: ['NONE', 'PARTIAL', 'FULL', 'SPEED_PROFILE', 'SPEED'],
  scenario: ['STARTUP', 'SCROLL', 'ANIMATION', 'PAGE_SWITCH'],
  baselineProfileState: ['UNKNOWN', 'PRESENT', 'ABSENT'],
};

export function validateMacrobenchmarkExperiment(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Macrobenchmark 实验配置无效');
  const result = {};
  for (const [key, choices] of Object.entries(EXPERIMENT_OPTIONS)) {
    const selected = value[key] ?? (key === 'startupMode' ? 'COLD' : key === 'compilationMode' ? 'NONE' : key === 'scenario' ? 'STARTUP' : 'UNKNOWN');
    if (!choices.includes(selected)) throw new Error(`Macrobenchmark ${key} 参数无效`);
    result[key] = selected;
  }
  for (const [key, fallback, min, max] of [['warmups', 0, 0, 20], ['iterations', 5, 1, 50]]) {
    const count = value[key] ?? fallback;
    if (!Number.isInteger(count) || count < min || count > max) throw new Error(`Macrobenchmark ${key} 必须为 ${min}–${max} 的整数`);
    result[key] = count;
  }
  const profilePath=value.baselineProfilePath??'';
  if(typeof profilePath!=='string'||profilePath.length>4096||(profilePath&&!isAbsolute(profilePath)))throw new Error('Baseline Profile 路径必须为空或绝对路径');
  result.baselineProfilePath=profilePath;
  const traceDir=value.traceDir??'';
  if(typeof traceDir!=='string'||traceDir.length>4096||(traceDir&&!isAbsolute(traceDir)))throw new Error('Macrobenchmark trace 输出目录必须为空或绝对路径');
  result.traceDir=traceDir;
  return result;
}

function inside(root, path) {
  const rel = relative(root, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`));
}

export async function validateMacrobenchmarkProject(projectPath, task) {
  if (typeof projectPath !== 'string' || !projectPath.trim() || projectPath.length > 4096) throw new Error('请选择有效的 Gradle 项目目录');
  if (typeof task !== 'string' || !TASK_PATTERN.test(task)) throw new Error('Gradle 任务名称无效');
  const root = await realpath(projectPath);
  if (!(await stat(root)).isDirectory()) throw new Error('Gradle 项目路径不是目录');
  const wrapperDir = await realpath(join(root, 'gradle', 'wrapper')).catch(() => null);
  if (!wrapperDir || !inside(root, wrapperDir)) throw new Error('项目缺少 Gradle Wrapper');
  for (const name of ['gradle-wrapper.jar', 'gradle-wrapper.properties']) {
    const file = await realpath(join(wrapperDir, name)).catch(() => null);
    if (!file || !inside(wrapperDir, file) || !(await stat(file)).isFile()) throw new Error(`项目缺少有效的 Gradle Wrapper 文件：${name}`);
  }
  return { root, wrapperJar: join(wrapperDir, 'gradle-wrapper.jar'), task: task.startsWith(':') ? task : `:${task}` };
}

async function findFreshOutputs(projectRoot, startedAt) {
  const outputs = [], stack = [{ dir: projectRoot, depth: 0 }];
  let visited = 0;
  while (stack.length && visited < MAX_FILES) {
    const { dir, depth } = stack.pop();
    if (depth > 8) continue;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { continue; }
    visited += entries.length;
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === '.gradle' || entry.name === 'node_modules') continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { stack.push({ dir: path, depth: depth + 1 }); continue; }
      const benchmarkReport = /(?:^|[-.])benchmarkData[^/]*\.json$/i.test(entry.name);
      const traceFile = /\.(?:trace|perfetto-trace)$/i.test(entry.name);
      if (!entry.isFile() || (!benchmarkReport && !traceFile)) continue;
      const rel = relative(projectRoot, path).split(sep);
      if (!rel.includes('connected_android_test_additional_output')) continue;
      try {
        const info = await stat(path);
        if (info.mtimeMs + 2000 < startedAt || info.size > (entry.name.endsWith('.json') ? MAX_REPORT : 256 * 1024 * 1024)) continue;
        outputs.push({ path, name: entry.name, size: info.size, modifiedAt: info.mtimeMs, kind: entry.name.endsWith('.json') ? 'benchmark-json' : 'trace' });
      } catch {}
    }
  }
  return outputs.sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, 200);
}

export async function runMacrobenchmark({ javaPath, projectPath, task, serial = '', experiment = {}, timeoutMs = 30 * 60 * 1000, onOutput = () => {} }, { spawnProcess = spawn } = {}) {
  const project = await validateMacrobenchmarkProject(projectPath, task);
  const selectedExperiment = validateMacrobenchmarkExperiment(experiment);
  let baselineProfile = null;
  if(selectedExperiment.baselineProfilePath){
    const profilePath=await realpath(selectedExperiment.baselineProfilePath).catch(()=>null);
    if(!profilePath)throw new Error('Baseline Profile 文件不存在或不可读取');
    const info=await stat(profilePath);
    if(!info.isFile()||info.size<1||info.size>10*1024*1024||![/\.txt$/i,/\.prof$/i,/\.profm$/i].some(pattern=>pattern.test(profilePath)))throw new Error('Baseline Profile 须为 1 字节至 10 MiB 的 .txt / .prof / .profm 文件');
    const profileBytes=await readFile(profilePath);
    baselineProfile={path:profilePath,fileName:basename(profilePath),bytes:profileBytes.length,sha256:createHash('sha256').update(profileBytes).digest('hex')};
  }
  if (typeof javaPath !== 'string' || !javaPath) throw new Error('Java Runtime 不可用');
  if (serial && (typeof serial !== 'string' || !/^[\w.:[\]-]{1,200}$/.test(serial))) throw new Error('设备序列号无效');
  const startedAt = Date.now();
  const properties = [
    ['startup-mode', selectedExperiment.startupMode], ['compilation-mode', selectedExperiment.compilationMode],
    ['scenario', selectedExperiment.scenario], ['warmups', selectedExperiment.warmups],
    ['iterations', selectedExperiment.iterations], ['baseline-profile-state', selectedExperiment.baselineProfileState],
  ];
  if(baselineProfile)properties.push(['baseline-profile-path',baselineProfile.path],['baseline-profile-sha256',baselineProfile.sha256]);
  if(selectedExperiment.traceDir)properties.push(['trace-dir',selectedExperiment.traceDir]);
  const args = ['-classpath', project.wrapperJar, 'org.gradle.wrapper.GradleWrapperMain', '--no-daemon', ...properties.map(([key, value]) => `-Paps.macrobenchmark.${key}=${value}`), project.task];
  const realJavaPath = await realpath(javaPath).catch(() => javaPath);
  const javaHome = basename(dirname(realJavaPath)) === 'bin' ? dirname(dirname(realJavaPath)) : null;
  const env = { ...process.env, ...(javaHome ? { JAVA_HOME: javaHome } : {}), ...(serial ? { ANDROID_SERIAL: serial } : {}),
    APS_MACROBENCHMARK_STARTUP_MODE: selectedExperiment.startupMode,
    APS_MACROBENCHMARK_COMPILATION_MODE: selectedExperiment.compilationMode,
    APS_MACROBENCHMARK_SCENARIO: selectedExperiment.scenario,
    APS_MACROBENCHMARK_WARMUPS: String(selectedExperiment.warmups),
    APS_MACROBENCHMARK_ITERATIONS: String(selectedExperiment.iterations),
    APS_MACROBENCHMARK_BASELINE_PROFILE_STATE: selectedExperiment.baselineProfileState,
    ...(selectedExperiment.traceDir?{APS_MACROBENCHMARK_TRACE_DIR:selectedExperiment.traceDir}:{}),
    ...(baselineProfile?{APS_MACROBENCHMARK_BASELINE_PROFILE_PATH:baselineProfile.path,APS_MACROBENCHMARK_BASELINE_PROFILE_SHA256:baselineProfile.sha256}:{}),
  };
  const output = [];
  let outputBytes = 0, timedOut = false;
  const child = spawnProcess(javaPath, args, { cwd: project.root, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const append = (stream, chunk) => {
    const value = chunk.toString();
    const remaining = Math.max(0, MAX_OUTPUT - outputBytes);
    const kept = value.slice(0, remaining);
    if (kept) { output.push(`[${stream}] ${kept}`); outputBytes += Buffer.byteLength(kept); onOutput(kept); }
  };
  child.stdout.on('data', chunk => append('stdout', chunk));
  child.stderr.on('data', chunk => append('stderr', chunk));
  let timer;
  const exit = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolveExit({ code, signal }));
    timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 5000).unref(); }, timeoutMs);
  }).finally(() => clearTimeout(timer));
  const finishedAt = Date.now();
  const artifacts = await findFreshOutputs(project.root, startedAt);
  let report = null, reportPath = null, reportError = null;
  const jsonArtifact = artifacts.find(file => file.kind === 'benchmark-json');
  if (jsonArtifact) {
    try { report = JSON.parse(await readFile(jsonArtifact.path, 'utf8')); reportPath = jsonArtifact.path; }
    catch { reportError = '新生成的 Benchmark JSON 无法解析'; }
  }
  return {
    status: timedOut ? 'timeout' : exit.code === 0 ? 'completed' : 'failed',
    exitCode: exit.code, signal: exit.signal, task: project.task, projectPath: project.root,
    experiment: selectedExperiment, baselineProfile,
    startedAt, finishedAt, output: output.join(''), outputTruncated: outputBytes >= MAX_OUTPUT,
    artifacts, report, reportPath, reportError,
  };
}
