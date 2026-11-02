import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, chmod, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMacrobenchmark, validateMacrobenchmarkProject } from '../src/macrobenchmark.js';

async function projectFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'apw-macrobenchmark-'));
  const wrapper = join(root, 'gradle', 'wrapper');
  await mkdir(wrapper, { recursive: true });
  await writeFile(join(wrapper, 'gradle-wrapper.jar'), 'wrapper');
  await writeFile(join(wrapper, 'gradle-wrapper.properties'), 'distributionUrl=https\\://example.invalid/gradle.zip');
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('Macrobenchmark project validation requires an in-project Gradle Wrapper and safe task name', async t => {
  const root = await projectFixture(t);
  assert.deepEqual(await validateMacrobenchmarkProject(root, 'macrobenchmark:connectedBenchmarkReleaseAndroidTest').then(({ task }) => ({ task })), { task: ':macrobenchmark:connectedBenchmarkReleaseAndroidTest' });
  await assert.rejects(validateMacrobenchmarkProject(root, '--version'), /任务名称无效/);
  await assert.rejects(validateMacrobenchmarkProject(join(root, 'missing'), ':macrobenchmark:connectedBenchmarkAndroidTest'));
  await rm(join(root, 'gradle', 'wrapper', 'gradle-wrapper.jar'));
  await assert.rejects(validateMacrobenchmarkProject(root, ':macrobenchmark:connectedBenchmarkAndroidTest'), /Gradle Wrapper/);
});

test('Macrobenchmark runner invokes wrapper without a shell and imports only fresh standard output', async t => {
  const root = await projectFixture(t), canonicalRoot = await realpath(root), outputDir = join(canonicalRoot, 'macrobenchmark', 'build', 'outputs', 'connected_android_test_additional_output', 'connected', 'com.example.macrobenchmark.test', 'androidx.benchmark.junit4.MacrobenchmarkTest');
  await mkdir(outputDir, { recursive: true });
  const reportPath = join(outputDir, 'benchmarkData.json'), tracePath = join(outputDir, 'capture.trace');
  const javaPath = join(root, 'fake-java');
  await writeFile(javaPath, `#!/bin/sh\n[ "$1" = "-classpath" ] || exit 8\nprintf 'gradle-run-ok\\n'\nmkdir -p 'macrobenchmark/build/outputs/connected_android_test_additional_output/connected/com.example.macrobenchmark.test/androidx.benchmark.junit4.MacrobenchmarkTest'\nprintf '%s' '{"benchmarks":[{"name":"startup","className":"com.example.StartupBenchmark","metrics":{"timeNs":{"runs":[[100,200]]}}}]}' > '${reportPath}'\nprintf 'trace' > '${tracePath}'\n`);
  await chmod(javaPath, 0o755);
  const result = await runMacrobenchmark({ javaPath, projectPath: root, task: ':macrobenchmark:connectedBenchmarkReleaseAndroidTest', serial: 'DEVICE-1' });
  assert.equal(result.status, 'completed');
  assert.match(result.output, /gradle-run-ok/);
  assert.equal(result.task, ':macrobenchmark:connectedBenchmarkReleaseAndroidTest');
  assert.equal(result.reportPath, reportPath);
  assert.equal(result.report.benchmarks[0].name, 'startup');
  assert.deepEqual(result.artifacts.map(file => file.kind).sort(), ['benchmark-json', 'trace']);
  assert.equal(await readFile(tracePath, 'utf8'), 'trace');
});
