import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!sdk) throw new Error('Set ANDROID_HOME or ANDROID_SDK_ROOT to the installed Android SDK.');
const buildTools = resolve(sdk, process.env.APW_ANDROID_BUILD_TOOLS || 'build-tools/35.0.0');
const androidJar = resolve(sdk, 'platforms/android-35/android.jar');
const sourceDir = resolve(root, 'test/fixtures/hprof-load');
const output = resolve(process.argv[2] || join(tmpdir(), 'apw-hprof-load.apk'));
const work = await mkdtemp(join(tmpdir(), 'apw-hprof-load-'));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) throw new Error(`${basename(command)} failed (${result.status}):\n${result.stdout || ''}${result.stderr || ''}`);
}

async function filesBelow(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await filesBelow(path));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

try {
  const classes = join(work, 'classes');
  const dex = join(work, 'dex');
  const baseApk = join(work, 'base.apk');
  const unsigned = join(work, 'unsigned.apk');
  const keystore = join(work, 'debug.keystore');
  await mkdir(classes);
  await mkdir(dex);
  run('javac', ['-source', '8', '-target', '8', '-bootclasspath', androidJar, '-d', classes, join(sourceDir, 'HprofLoadActivity.java')]);
  run(resolve(buildTools, 'd8'), ['--min-api', '21', '--output', dex, ...await filesBelow(classes)]);
  run(resolve(buildTools, 'aapt'), ['package', '-f', '-M', join(sourceDir, 'AndroidManifest.xml'), '-I', androidJar, '-F', baseApk, '--target-sdk-version', '25']);
  run('unzip', ['-q', baseApk, '-d', join(work, 'apk')]);
  await mkdir(join(work, 'apk'), { recursive: true });
  await writeFile(join(work, 'apk', 'classes.dex'), await readFile(join(dex, 'classes.dex')));
  run('zip', ['-q', '-r', unsigned, '.'], { cwd: join(work, 'apk') });
  run('keytool', ['-genkeypair', '-keystore', keystore, '-storepass', 'android', '-keypass', 'android', '-alias', 'apw', '-dname', 'CN=APW Fixture', '-keyalg', 'RSA', '-validity', '3650', '-noprompt']);
  run(resolve(buildTools, 'apksigner'), ['sign', '--ks', keystore, '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--out', output, unsigned]);
  console.log(`Built ${output}`);
} finally {
  await rm(work, { recursive: true, force: true });
}
