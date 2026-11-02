import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pkg from '../package.json' with { type: 'json' };

const executable = resolve(process.argv[2] || `dist/v${pkg.version}/win-unpacked/${pkg.build.productName}.exe`);
const tempRoot = await mkdtemp(join(tmpdir(), 'android-performance-smoke-'));
const readyFile = join(tempRoot, 'ready.json');
const profileDir = join(tempRoot, 'profile');
await access(executable);
let childOutput = '';
const child = spawn(executable, ['--no-sandbox', '--disable-gpu'], {
  env: { ...process.env, APW_PROFILE_DIR: profileDir, APW_SMOKE_READY_FILE: readyFile },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let exitInfo;
child.once('error', error => { exitInfo = { error }; });
child.once('exit', (code, signal) => { exitInfo = { code, signal }; });
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { childOutput = `${childOutput}${chunk}`.slice(-8000); });

async function waitForReady() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (exitInfo) throw new Error(`Desktop app exited before ready (${exitInfo.error?.message || `code ${exitInfo.code}, signal ${exitInfo.signal}`})${childOutput ? `\n${childOutput}` : ''}`);
    try {
      const result = JSON.parse(await readFile(readyFile, 'utf8'));
      if (result.error) throw new Error(`Desktop app startup failed:\n${result.error}`);
      return result;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await delay(200);
  }
  throw new Error('Desktop app did not start its local service within 60 seconds');
}

try {
  const { origin, rendererReady, rendererState } = await waitForReady();
  if (!rendererReady) throw new Error(`Desktop renderer did not build its navigation and main view: ${JSON.stringify(rendererState)}`);
  const page = await fetch(origin, { signal: AbortSignal.timeout(10_000) });
  if (!page.ok) throw new Error(`Main page returned HTTP ${page.status}`);
  const html = await page.text();
  if (!html.includes('<main id="main"') || !html.includes('/app.js')) throw new Error('Main page is missing the application shell');
  const appJs = await fetch(new URL('/app.js', origin), { signal: AbortSignal.timeout(10_000) });
  const script = await appJs.text();
  if (!appJs.ok || !script.includes("from './i18n.js'") || !script.includes('render();')) throw new Error(`Application script failed to load (HTTP ${appJs.status})`);
  const java = join(profileDir, 'runtime', 'java-runtime', 'bin', 'java.exe');
  await stat(java);
  console.log(`Desktop smoke passed: ${origin}, app shell and Java runtime ready`);
} catch (error) {
  const detail = (error.stack || error.message || String(error)).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  console.log(`::error title=Desktop startup smoke::${detail}`);
  throw error;
} finally {
  if (child.exitCode === null && child.signalCode === null) child.kill();
  if (child.exitCode === null && child.signalCode === null) {
    await Promise.race([new Promise(resolveExit => child.once('exit', resolveExit)), delay(5_000)]);
  }
  await rm(tempRoot, { recursive: true, force: true });
}
