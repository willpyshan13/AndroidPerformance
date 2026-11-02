import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import pkg from '../package.json' with { type: 'json' };

const run = promisify(execFile);
const output = resolve(`dist/v${pkg.version}`);
const packages = (await readdir(output)).filter(name => name.endsWith('_arm64.deb'));
if (packages.length !== 1) throw new Error(`Expected one arm64 DEB in ${output}, found ${packages.length}`);
const archive = join(output, packages[0]);
const staging = await mkdtemp(join(tmpdir(), 'android-performance-deb-control-'));
const rebuilt = `${archive}.tmp`;
try {
  await run('dpkg-deb', ['-R', archive, staging], { timeout: 60_000 });
  const controlPath = join(staging, 'DEBIAN/control');
  let control = await readFile(controlPath, 'utf8');
  const depends = control.match(/^Depends: ([^\n]*(?:\n [^\n]*)*)/m);
  if (!depends) throw new Error('DEB control metadata has no Depends field');
  const updated = depends[1].replace(/\n /g, ' ');
  const constrained = /libc6 \(>= [^)]+\)/.test(updated)
    ? updated.replace(/libc6 \(>= [^)]+\)/, 'libc6 (>= 2.38)')
    : `${updated}, libc6 (>= 2.38)`;
  control = control.replace(depends[0], `Depends: ${constrained}`);
  await writeFile(controlPath, control);
  await run('dpkg-deb', ['--build', '--root-owner-group', staging, rebuilt], { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  await rename(rebuilt, archive);
  console.log(`${packages[0]} now declares libc6 >= 2.38 for its Ubuntu 24.04 arm64 AAPT2`);
} finally {
  await rm(staging, { recursive: true, force: true });
  await rm(rebuilt, { force: true });
}
