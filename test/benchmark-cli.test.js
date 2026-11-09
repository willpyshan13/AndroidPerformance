import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseMacrobenchmarkCliArgs, runMacrobenchmarkCli } from '../src/benchmark-cli.js';

test('Macrobenchmark CLI parses the experiment matrix and rejects unsafe or incomplete arguments', () => {
  const options = parseMacrobenchmarkCliArgs([
    'macro-run', '--project', '/tmp/project with spaces', '--task', ':macrobenchmark:connectedCheck',
    '--serial', 'device-1', '--startup-mode', 'warm', '--compilation-mode', 'speed_profile',
    '--scenario', 'scroll', '--warmups', '2', '--iterations', '7', '--trace-dir', '/tmp/trace output',
  ]);
  assert.equal(options.projectPath, resolve('/tmp/project with spaces'));
  assert.equal(options.task, ':macrobenchmark:connectedCheck');
  assert.deepEqual(options.experiment, {
    startupMode: 'WARM', compilationMode: 'SPEED_PROFILE', scenario: 'SCROLL',
    baselineProfileState: 'UNKNOWN', warmups: 2, iterations: 7,
    baselineProfilePath: '', traceDir: resolve('/tmp/trace output'),
  });
  assert.throws(() => parseMacrobenchmarkCliArgs(['macro-run', '--project', '/tmp/app']), /--task/);
  assert.throws(() => parseMacrobenchmarkCliArgs(['macro-run', '--project', '/tmp/app', '--task', ':benchmark:test', '--iterations', '51']), /iterations/);
  assert.throws(() => parseMacrobenchmarkCliArgs(['macro-run', '--project', '/tmp/app', '--task', ':benchmark:test', '--shell', 'true']), /Unknown option/);
  assert.equal(parseMacrobenchmarkCliArgs(['--help']).help, true);
});

test('Macrobenchmark CLI invokes the runner, streams logs, writes a private report, and returns CI status', async t => {
  const root = await mkdtemp(join(tmpdir(), 'apw-benchmark-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const resultPath = join(root, 'artifacts', 'run.json'), seen = {}, stdout = [], stderr = [];
  const code = await runMacrobenchmarkCli([
    'macro-run', '--project', join(root, 'Android Project'), '--task', ':macrobenchmark:connectedCheck',
    '--serial', 'device-1', '--startup-mode', 'HOT', '--iterations', '4', '--trace-dir', join(root, 'traces'),
    '--result', resultPath,
  ], {
    env: { JAVA_HOME: join(root, 'jdk') },
    javaResolver: async options => { seen.javaResolver = options; return '/test/jdk/bin/java'; },
    runner: async options => {
      seen.options = options;
      options.onOutput('gradle output\n');
      return { status: 'completed', exitCode: 0, task: options.task, projectPath: options.projectPath, experiment: options.experiment, artifacts: [{ kind: 'benchmark-json', path: '/tmp/report.json' }], output: 'gradle output\n' };
    },
    writeStdout: value => stdout.push(value),
    writeStderr: value => stderr.push(value),
  });
  assert.equal(code, 0);
  assert.equal(seen.javaResolver.fallbackJavaPath, join(root, 'jdk', 'bin', process.platform === 'win32' ? 'java.exe' : 'java'));
  assert.equal(seen.options.javaPath, '/test/jdk/bin/java');
  assert.equal(seen.options.experiment.traceDir, join(root, 'traces'));
  assert.deepEqual(stderr, ['gradle output\n']);
  assert.equal(JSON.parse(stdout.join('')).status, 'completed');
  assert.equal(JSON.parse(await readFile(resultPath, 'utf8')).task, ':macrobenchmark:connectedCheck');
  let rerunStarted = false;
  await assert.rejects(runMacrobenchmarkCli([
    'macro-run', '--project', join(root, 'Android Project'), '--task', ':macrobenchmark:connectedCheck', '--result', resultPath,
  ], { runner: async () => { rerunStarted = true; return { status: 'failed', exitCode: 1 }; }, javaResolver: async () => '/java', writeStdout: () => {}, writeStderr: () => {} }), /already exists/);
  assert.equal(rerunStarted, false);
});

test('Macrobenchmark CLI maps failed and timed-out Gradle runs to nonzero exit status', async () => {
  const invoke = status => runMacrobenchmarkCli(['macro-run', '--project', '/tmp/project', '--task', ':macrobenchmark:connectedCheck'], {
    javaResolver: async () => '/java', runner: async () => ({ status, exitCode: status === 'failed' ? 1 : null, task: ':macrobenchmark:connectedCheck', artifacts: [] }),
    writeStdout: () => {}, writeStderr: () => {},
  });
  assert.equal(await invoke('failed'), 1);
  assert.equal(await invoke('timeout'), 124);
});
