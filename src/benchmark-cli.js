#!/usr/bin/env node
import { lstat, mkdir, open } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runMacrobenchmark } from './macrobenchmark.js';
import { resolveGradleJavaPath } from './java-runtime.js';

const HELP = `Android Performance Macrobenchmark CLI

Usage:
  node src/benchmark-cli.js macro-run --project <android-project> --task <gradle-task> [options]

Options:
  --serial <adb-serial>                 Select a device (or use ANDROID_SERIAL)
  --java <path>                         Java executable (defaults to JAVA_HOME / Android Studio / java)
  --startup-mode <COLD|WARM|HOT>        Default: COLD
  --compilation-mode <mode>             NONE, PARTIAL, FULL, SPEED_PROFILE, SPEED; default: NONE
  --scenario <STARTUP|SCROLL|ANIMATION|PAGE_SWITCH>
  --warmups <0..20>                     Default: 0
  --iterations <1..50>                  Default: 5
  --baseline-profile-state <state>      UNKNOWN, PRESENT, ABSENT; default: UNKNOWN
  --baseline-profile <absolute-path>    Record a .txt, .prof, or .profm file identity
  --trace-dir <path>                    Pass APS trace output directory to the target project
  --timeout-ms <milliseconds>           Default: 1800000
  --result <path>                       Write the full result JSON; refuses to overwrite
  --overwrite                           Allow replacing --result
  --help                                Show this help

Macrobenchmark configuration is passed to the target Gradle project through
aps.macrobenchmark.* project properties and APS_MACROBENCHMARK_* environment
variables. The target benchmark tests must consume those values.
`;

const VALUE_OPTIONS = new Set([
  '--project', '--task', '--serial', '--java', '--startup-mode', '--compilation-mode',
  '--scenario', '--warmups', '--iterations', '--baseline-profile-state',
  '--baseline-profile', '--trace-dir', '--timeout-ms', '--result',
]);

function positiveInteger(value, name, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error(`${name} must be an integer`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return number;
}

export function parseMacrobenchmarkCliArgs(argv) {
  if (!Array.isArray(argv)) throw new Error('Expected the macro-run command');
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === 'help')) return { help: true };
  if (argv.length < 1 || argv[0] !== 'macro-run') throw new Error('Expected the macro-run command');
  const values = {}, flags = new Set();
  for (let index = 1; index < argv.length; index++) {
    const key = argv[index];
    if (key === '--help') { flags.add(key); continue; }
    if (key === '--overwrite') { flags.add(key); continue; }
    if (!VALUE_OPTIONS.has(key)) throw new Error(`Unknown option: ${key}`);
    const value = argv[++index];
    if (typeof value !== 'string' || !value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    if (key in values) throw new Error(`Option repeated: ${key}`);
    values[key] = value;
  }
  if (flags.has('--help')) return { help: true };
  if (!values['--project'] || !values['--task']) throw new Error('--project and --task are required');
  const projectPath = resolve(values['--project']);
  const resultPath = values['--result'] ? resolve(values['--result']) : '';
  const experiment = {
    startupMode: (values['--startup-mode'] || 'COLD').toUpperCase(),
    compilationMode: (values['--compilation-mode'] || 'NONE').toUpperCase(),
    scenario: (values['--scenario'] || 'STARTUP').toUpperCase(),
    baselineProfileState: (values['--baseline-profile-state'] || 'UNKNOWN').toUpperCase(),
    warmups: values['--warmups'] === undefined ? 0 : positiveInteger(values['--warmups'], '--warmups', { min: 0, max: 20 }),
    iterations: values['--iterations'] === undefined ? 5 : positiveInteger(values['--iterations'], '--iterations', { min: 1, max: 50 }),
    baselineProfilePath: values['--baseline-profile'] ? resolve(values['--baseline-profile']) : '',
    traceDir: values['--trace-dir'] ? resolve(values['--trace-dir']) : '',
  };
  const timeoutMs = values['--timeout-ms'] === undefined ? 30 * 60 * 1000 : positiveInteger(values['--timeout-ms'], '--timeout-ms', { min: 1000, max: 2 * 60 * 60 * 1000 });
  return {
    help: false,
    projectPath,
    task: values['--task'],
    serial: values['--serial'] || '',
    javaPath: values['--java'] || '',
    experiment,
    timeoutMs,
    resultPath,
    overwrite: flags.has('--overwrite'),
  };
}

async function writeResult(path, result, overwrite) {
  if (!isAbsolute(path)) throw new Error('Result path must be absolute');
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, overwrite ? 'w' : 'wx', 0o600);
  try { await handle.writeFile(`${JSON.stringify(result, null, 2)}\n`, 'utf8'); }
  finally { await handle.close(); }
}

async function validateResultDestination(path, overwrite) {
  if (!path) return;
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('Result path must name a regular file, not a symlink or directory');
    if (!overwrite) throw Object.assign(new Error(`Result file already exists: ${path} (use --overwrite to replace it)`), { code: 'EEXIST' });
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

function summary(result) {
  return {
    status: result.status,
    exitCode: result.exitCode,
    signal: result.signal,
    task: result.task,
    projectPath: result.projectPath,
    experiment: result.experiment,
    baselineProfile: result.baselineProfile,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    reportPath: result.reportPath,
    reportError: result.reportError,
    artifacts: result.artifacts,
    outputTruncated: result.outputTruncated,
  };
}

export async function runMacrobenchmarkCli(argv, {
  runner = runMacrobenchmark,
  javaResolver = resolveGradleJavaPath,
  env = process.env,
  writeStdout = value => process.stdout.write(value),
  writeStderr = value => process.stderr.write(value),
} = {}) {
  const options = parseMacrobenchmarkCliArgs(argv);
  if (options.help) { writeStdout(HELP); return 0; }
  await validateResultDestination(options.resultPath, options.overwrite);
  const fallbackJavaPath = options.javaPath || (env.JAVA_HOME ? join(env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java');
  const javaPath = options.javaPath || await javaResolver({ fallbackJavaPath, env });
  const result = await runner({
    javaPath,
    projectPath: options.projectPath,
    task: options.task,
    serial: options.serial,
    experiment: options.experiment,
    timeoutMs: options.timeoutMs,
    onOutput: chunk => writeStderr(String(chunk)),
  });
  if (options.resultPath) await writeResult(options.resultPath, result, options.overwrite);
  writeStdout(`${JSON.stringify(summary(result), null, 2)}\n`);
  return result.status === 'completed' && result.exitCode === 0 ? 0 : result.status === 'timeout' ? 124 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runMacrobenchmarkCli(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(`${JSON.stringify({ error: String(error?.message || error) })}\n`);
    process.exitCode = 2;
  });
}

export { HELP as MACROBENCHMARK_CLI_HELP };
