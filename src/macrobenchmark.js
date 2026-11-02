import { spawn } from 'node:child_process';
import { realpath, stat, readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const TASK_PATTERN = /^:?[A-Za-z0-9_][A-Za-z0-9_.:-]{0,179}$/;
const MAX_OUTPUT = 1024 * 1024;
const MAX_REPORT = 8 * 1024 * 1024;
const MAX_FILES = 5000;

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
      if (!entry.isFile() || !/^(benchmarkData.*\.json|.*\.(?:trace|perfetto-trace))$/i.test(entry.name)) continue;
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

export async function runMacrobenchmark({ javaPath, projectPath, task, serial = '', timeoutMs = 30 * 60 * 1000, onOutput = () => {} }) {
  const project = await validateMacrobenchmarkProject(projectPath, task);
  if (typeof javaPath !== 'string' || !javaPath) throw new Error('Java Runtime 不可用');
  if (serial && (typeof serial !== 'string' || !/^[\w.:[\]-]{1,200}$/.test(serial))) throw new Error('设备序列号无效');
  const startedAt = Date.now();
  const args = ['-classpath', project.wrapperJar, 'org.gradle.wrapper.GradleWrapperMain', '--no-daemon', project.task];
  const env = { ...process.env, ...(serial ? { ANDROID_SERIAL: serial } : {}) };
  const output = [];
  let outputBytes = 0, timedOut = false;
  const child = spawn(javaPath, args, { cwd: project.root, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
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
    startedAt, finishedAt, output: output.join(''), outputTruncated: outputBytes >= MAX_OUTPUT,
    artifacts, report, reportPath, reportError,
  };
}
