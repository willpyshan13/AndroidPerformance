import { spawn, spawnSync } from 'node:child_process';
import { access, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pkg from '../package.json' with { type: 'json' };

const outputDir = resolve(`dist/v${pkg.version}`);
const installers = (await readdir(outputDir)).filter(name => name.toLowerCase().endsWith('.msi'));
if (installers.length !== 1) throw new Error(`Expected one MSI installer in ${outputDir}, found ${installers.length}`);
const installer = join(outputDir, installers[0]);
const tempRoot = await mkdtemp(join(tmpdir(), 'android-performance-smoke-'));
const installDir = join(tempRoot, 'installed-app');
const profileDir = join(tempRoot, 'profile');
const readyFile = join(tempRoot, 'ready.json');
const installLog = join(tempRoot, 'install.log');
const uninstallLog = join(tempRoot, 'uninstall.log');
const executable = join(installDir, `${pkg.build.productName}.exe`);
let child;
let childError;
let childOutput = '';
let installed = false;
let failure;
let uninstallFailure;

function runMsi(args) {
  return spawnSync('msiexec.exe', args, { encoding: 'utf8', timeout: 180_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
}

async function msiFailure(label, result, logPath) {
  let log = '';
  try { log = await readFile(logPath, 'utf8'); } catch {}
  const details = [result.error?.message, result.stdout, result.stderr, log.slice(-12_000)].filter(Boolean).join('\n');
  return new Error(`${label} failed with exit code ${result.status ?? 'unknown'}${details ? `\n${details}` : ''}`);
}

async function waitForReady() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (childError) throw new Error(`Unable to start installed desktop app: ${childError.message}`);
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Installed desktop app exited before ready (code ${child.exitCode}, signal ${child.signalCode})${childOutput ? `\n${childOutput}` : ''}`);
    }
    try {
      const result = JSON.parse(await readFile(readyFile, 'utf8'));
      if (result.error) throw new Error(`Desktop app startup failed:\n${result.error}`);
      return result;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await delay(200);
  }
  throw new Error('Installed desktop app did not start its local service within 60 seconds');
}

try {
  await access(installer);
  const install = runMsi(['/i', installer, '/qn', '/norestart', '/l*v', installLog, `APPLICATIONFOLDER=${installDir}`]);
  if (install.error || ![0, 3010].includes(install.status)) throw await msiFailure('MSI installation', install, installLog);
  installed = true;
  await access(executable);

  child = spawn(executable, ['--no-sandbox', '--disable-gpu'], {
    env: { ...process.env, APW_PROFILE_DIR: profileDir, APW_SMOKE_READY_FILE: readyFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.once('error', error => { childError = error; childOutput = `${childOutput}${error.message}`.slice(-8000); });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { childOutput = `${childOutput}${chunk}`.slice(-8000); });

  const { origin, rendererReady, rendererState } = await waitForReady();
  if (!rendererReady) throw new Error(`Desktop renderer did not build its navigation and main view: ${JSON.stringify(rendererState)}`);
  const page = await fetch(origin, { signal: AbortSignal.timeout(10_000) });
  if (!page.ok) throw new Error(`Main page returned HTTP ${page.status}`);
  const html = await page.text();
  if (!html.includes('<main id="main"') || !html.includes('/app.js')) throw new Error('Main page is missing the application shell');
  for (const path of ['/app.js', '/demo.js', '/offline.js', '/i18n.js']) {
    const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  }
  await stat(join(profileDir, 'runtime', 'java-runtime', 'bin', 'java.exe'));
  console.log(`Installed desktop smoke passed: ${origin}; renderer and Java runtime ready`);
} catch (error) {
  failure = error;
} finally {
  if (child && child.exitCode === null && child.signalCode === null) child.kill();
  if (child && child.exitCode === null && child.signalCode === null) {
    await Promise.race([new Promise(resolveExit => child.once('exit', resolveExit)), delay(5_000)]);
  }
  if (installed) {
    const uninstall = runMsi(['/x', installer, '/qn', '/norestart', '/l*v', uninstallLog]);
    if (uninstall.error || ![0, 3010].includes(uninstall.status)) uninstallFailure = await msiFailure('MSI uninstallation', uninstall, uninstallLog);
  }
  await rm(tempRoot, { recursive: true, force: true });
}

if (failure || uninstallFailure) {
  const error = failure || uninstallFailure;
  const detail = (error.stack || error.message || String(error)).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  console.log(`::error title=Windows installer smoke::${detail}`);
  throw error;
}
