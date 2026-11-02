import assert from 'node:assert/strict';
import { access, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import pkg from '../package.json' with { type: 'json' };

const run = promisify(execFile);
const output = resolve(`dist/v${pkg.version}`);
const debFiles = (await readdir(output)).filter(name => name.endsWith('_arm64.deb'));
if (debFiles.length !== 1) throw new Error(`Expected one arm64 DEB in ${output}, found ${debFiles.length}`);
const temp = await mkdtemp(join(tmpdir(), 'android-performance-arm64-deb-smoke-'));
try {
  await run('dpkg-deb', ['-x', join(output, debFiles[0]), temp], { timeout: 60_000 });
  async function findResources(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = join(directory, entry.name);
      if (entry.name === 'resources') {
        try { await access(join(candidate, 'apk-tools', 'aapt2')); return candidate; } catch {}
      }
      const nested = await findResources(candidate);
      if (nested) return nested;
    }
  }
  const resources = await findResources(temp);
  if (!resources) throw new Error('Extracted arm64 DEB is missing packaged resources/apk-tools/aapt2');
  const aapt2 = join(resources, 'apk-tools', 'aapt2');
  const adb = join(resources, 'platform-tools', 'adb');
  await access(aapt2); await access(adb);
  assert.ok((await stat(join(resources, 'apk-tools', 'licenses'))).isDirectory());
  const { stdout, stderr } = await run(adb, ['version'], { timeout: 10_000 });
  if (!`${stdout}${stderr}`.includes('Android Debug Bridge')) throw new Error('Packaged arm64 ADB wrapper did not start');
  await run(process.execPath, ['scripts/apk-tools-smoke.js'], { env: { ...process.env, AAPT2_PATH: aapt2 }, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  console.log(`Linux arm64 DEB resource smoke passed: ${debFiles[0]}; ADB and AAPT2 wrappers run from the extracted package`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
