import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, chmod, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMacrobenchmark, validateMacrobenchmarkExperiment, validateMacrobenchmarkProject } from '../src/macrobenchmark.js';

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
  assert.deepEqual(await validateMacrobenchmarkProject(root, 'macrobenchmark:connectedBenchmarkAndroidTest').then(({ task }) => ({ task })), { task: ':macrobenchmark:connectedBenchmarkAndroidTest' });
  await assert.rejects(validateMacrobenchmarkProject(root, '--version'), /任务名称无效/);
  await assert.rejects(validateMacrobenchmarkProject(join(root, 'missing'), ':macrobenchmark:connectedBenchmarkAndroidTest'));
  await rm(join(root, 'gradle', 'wrapper', 'gradle-wrapper.jar'));
  await assert.rejects(validateMacrobenchmarkProject(root, ':macrobenchmark:connectedBenchmarkAndroidTest'), /Gradle Wrapper/);
});

test('Macrobenchmark experiment configuration validates modes, scenario and bounded iteration counts',()=>{
 assert.deepEqual(validateMacrobenchmarkExperiment(),{startupMode:'COLD',compilationMode:'NONE',scenario:'STARTUP',baselineProfileState:'UNKNOWN',warmups:0,iterations:5,baselineProfilePath:'',traceDir:''});
 assert.deepEqual(validateMacrobenchmarkExperiment({startupMode:'WARM',compilationMode:'SPEED_PROFILE',scenario:'SCROLL',baselineProfileState:'PRESENT',warmups:2,iterations:10}),{startupMode:'WARM',compilationMode:'SPEED_PROFILE',scenario:'SCROLL',baselineProfileState:'PRESENT',warmups:2,iterations:10,baselineProfilePath:'',traceDir:''});
 assert.equal(validateMacrobenchmarkExperiment({traceDir:'/tmp/traces'}).traceDir,'/tmp/traces');
 assert.throws(()=>validateMacrobenchmarkExperiment({traceDir:'relative/traces'}),/绝对路径/);
 for(const input of [{startupMode:'invalid'},{compilationMode:'VERIFY'},{scenario:'NETWORK'},{baselineProfileState:'YES'},{warmups:-1},{warmups:21},{iterations:0},{iterations:51},null])assert.throws(()=>validateMacrobenchmarkExperiment(input));
});

test('Macrobenchmark runner invokes wrapper without a shell and imports only fresh standard output', async t => {
  const root = await projectFixture(t), canonicalRoot = await realpath(root), outputDir = join(canonicalRoot, 'macrobenchmark', 'build', 'outputs', 'connected_android_test_additional_output', 'connected', 'com.example.macrobenchmark.test', 'androidx.benchmark.junit4.MacrobenchmarkTest');
  await mkdir(outputDir, { recursive: true });
  const reportPath = join(outputDir, 'com.example.macrobenchmark-benchmarkData.json'), tracePath = join(outputDir, 'capture.trace'), metadataPath=join(root,'macro-args.txt'),profilePath=join(root,'baseline-prof.txt');await writeFile(profilePath,'Lcom/example/Foo;->bar()V\n');
  const javaPath = join(root, 'fake-java');
  await writeFile(javaPath, `#!/bin/sh\n[ "$1" = "-classpath" ] || exit 8\nprintf 'gradle-run-ok\\n'\nprintf '%s\\n' "$APS_MACROBENCHMARK_STARTUP_MODE|$APS_MACROBENCHMARK_COMPILATION_MODE|$APS_MACROBENCHMARK_SCENARIO|$APS_MACROBENCHMARK_WARMUPS|$APS_MACROBENCHMARK_ITERATIONS|$APS_MACROBENCHMARK_BASELINE_PROFILE_STATE|$APS_MACROBENCHMARK_BASELINE_PROFILE_SHA256|$APS_MACROBENCHMARK_TRACE_DIR" > '${metadataPath}'\nprintf '%s\\n' "$@" >> '${metadataPath}'\nmkdir -p 'macrobenchmark/build/outputs/connected_android_test_additional_output/connected/com.example.macrobenchmark.test/androidx.benchmark.junit4.MacrobenchmarkTest'\nprintf '%s' '{"benchmarks":[{"name":"startup","className":"com.example.StartupBenchmark","metrics":{"timeNs":{"runs":[[100,200]]}}}]}' > '${reportPath}'\nprintf 'trace' > '${tracePath}'\n`);
  await chmod(javaPath, 0o755);
  const experiment={startupMode:'WARM',compilationMode:'SPEED_PROFILE',scenario:'SCROLL',baselineProfileState:'PRESENT',warmups:2,iterations:8,baselineProfilePath:profilePath,traceDir:'/tmp/macro-traces'};
  const result = await runMacrobenchmark({ javaPath, projectPath: root, task: ':macrobenchmark:connectedBenchmarkAndroidTest', serial: 'DEVICE-1',experiment });
  assert.equal(result.status, 'completed');
  assert.match(result.output, /gradle-run-ok/);
  assert.equal(result.task, ':macrobenchmark:connectedBenchmarkAndroidTest');
  assert.deepEqual(result.experiment,experiment);
  assert.equal(result.baselineProfile.fileName,'baseline-prof.txt');assert.equal(result.baselineProfile.bytes,Buffer.byteLength('Lcom/example/Foo;->bar()V\n'));assert.match(result.baselineProfile.sha256,/^[a-f0-9]{64}$/);
  const args=await readFile(metadataPath,'utf8');assert.match(args,/WARM\|SPEED_PROFILE\|SCROLL\|2\|8\|PRESENT\|[a-f0-9]{64}\|\/tmp\/macro-traces/);assert.match(args,/-Paps\.macrobenchmark\.startup-mode=WARM/);assert.match(args,/-Paps\.macrobenchmark\.compilation-mode=SPEED_PROFILE/);assert.match(args,/-Paps\.macrobenchmark\.iterations=8/);assert.ok(args.includes(`-Paps.macrobenchmark.baseline-profile-path=${result.baselineProfile.path}`));assert.ok(args.includes('-Paps.macrobenchmark.trace-dir=/tmp/macro-traces'));
  assert.equal(result.reportPath, reportPath);
  assert.equal(result.report.benchmarks[0].name, 'startup');
  assert.deepEqual(result.artifacts.map(file => file.kind).sort(), ['benchmark-json', 'trace']);
  assert.equal(await readFile(tracePath, 'utf8'), 'trace');
});
