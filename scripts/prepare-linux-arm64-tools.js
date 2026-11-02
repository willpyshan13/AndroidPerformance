import { access, chmod, copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'linux' || process.arch !== 'arm64') throw new Error('This resource preparation script requires Linux arm64');
const run = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const binaries = [
  { source: process.env.ADB_PATH || '/usr/bin/adb', name: 'adb', target: join(root, 'tools/platform-tools') },
  { source: process.env.AAPT2_PATH || '/usr/bin/aapt2', name: 'aapt2', target: join(root, 'tools/apk-tools') },
];
const excluded = /^(?:linux-vdso|ld-linux|libc\.so|libm\.so|libpthread\.so|libdl\.so|librt\.so|libresolv\.so|libnss_)/;

async function libraryPaths(executable) {
  const { stdout, stderr } = await run('ldd', [executable], { timeout: 10_000 });
  const output = `${stdout}\n${stderr}`;
  if (/not found/.test(output)) throw new Error(`Missing runtime library for ${executable}: ${output}`);
  return [...new Set(output.split(/\r?\n/).flatMap(line => {
    const mapped = line.match(/=>\s+(\/\S+)\s+\(/);
    const direct = line.match(/^\s*(\/\S+)\s+\(/);
    const path = mapped?.[1] || direct?.[1];
    return path && !excluded.test(basename(path)) ? [path] : [];
  }))];
}

async function copyLicense(binary, destination) {
  const providers = await run('dpkg-query', ['-S', binary], { timeout: 10_000 }).then(result => result.stdout).catch(() => '');
  const packageName = providers.split(/\r?\n/, 1)[0]?.split(':', 1)[0]?.trim();
  if (!packageName) return;
  const copyright = `/usr/share/doc/${packageName}/copyright`;
  try {
    await access(copyright);
    const output = join(destination, 'licenses', `${packageName}.copyright`);
    await mkdir(dirname(output), { recursive: true });
    await copyFile(copyright, output);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

for (const entry of binaries) {
  await access(entry.source);
  await mkdir(join(entry.target, 'lib'), { recursive: true });
  const binaryCopy = join(entry.target, `${entry.name}.bin`);
  await copyFile(entry.source, binaryCopy);
  await chmod(binaryCopy, 0o755);
  const wrapper = join(entry.target, entry.name);
  await writeFile(wrapper, `#!/bin/sh\nscript_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexport LD_LIBRARY_PATH="$script_dir/lib${'${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}'}"\nexec "$script_dir/${entry.name}.bin" "$@"\n`, { mode: 0o755 });
  await copyLicense(entry.source, entry.target);
  for (const dependency of await libraryPaths(entry.source)) {
    const destination = join(entry.target, 'lib', basename(dependency));
    try { await access(destination); } catch { await copyFile(dependency, destination); }
    await copyLicense(dependency, entry.target);
  }
  const version = await run(wrapper, [entry.name === 'adb' ? 'version' : 'version'], { timeout: 10_000 });
  console.log(`${entry.name}: ${(version.stdout || version.stderr).split(/\r?\n/)[0]}; ${entry.target}`);
}

const apkTools = join(root, 'tools/apk-tools');
for (const name of ['NOTICE.txt', 'source.properties']) {
  const path = join(apkTools, name);
  try { await access(path); } catch {
    if (name === 'NOTICE.txt') await writeFile(path, 'AAPT2 is provided by the Ubuntu aapt package. See licenses/ for package copyright and dependency notices.\n');
    else await writeFile(path, 'Pkg.Desc=Android Asset Packaging Tool 2\nPkg.Revision=Ubuntu aapt package\n');
  }
}
const packageFiles = await readdir(join(apkTools, 'licenses'));
console.log(`Linux arm64 Android tool licenses: ${packageFiles.length}`);
