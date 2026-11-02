import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pkg from '../package.json' with { type: 'json' };

const outputDir = resolve(`dist/v${pkg.version}`);
async function findApps(directory, found = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(directory, entry.name);
    if (entry.name.endsWith('.app')) found.push(path);
    else await findApps(path, found);
  }
  return found;
}

const apps = await findApps(outputDir);
if (apps.length !== 1) throw new Error(`Expected one packaged .app under ${outputDir}, found ${apps.length}`);
const appBundle = apps[0];
const resources = join(appBundle, 'Contents', 'Resources');
const executable = join(appBundle, 'Contents', 'MacOS', pkg.build.productName);
const tempRoot = await mkdtemp(join(tmpdir(), 'android-performance-mac-smoke-'));
const profileDir = join(tempRoot, 'profile');
const readyFile = join(tempRoot, 'ready.json');
let child;
let childError;
let childOutput = '';
let failure;

async function stopChild(processHandle) {
  if (!processHandle || processHandle.exitCode !== null || processHandle.signalCode !== null) return;
  processHandle.kill('SIGTERM');
  await Promise.race([new Promise(resolveExit => processHandle.once('exit', resolveExit)), delay(5_000)]);
  if (processHandle.exitCode === null && processHandle.signalCode === null) {
    processHandle.kill('SIGKILL');
    await Promise.race([new Promise(resolveExit => processHandle.once('exit', resolveExit)), delay(5_000)]);
  }
}

try {
  await access(executable);
  await stat(join(resources, 'java-runtime', 'bin', 'java'));
  await stat(join(resources, 'trace-processor', 'trace_processor_shell'));
  await stat(join(resources, 'perfetto-ui', 'index.html'));
  await mkdir(profileDir, { recursive: true });
  await writeFile(join(profileDir, 'settings.json'), JSON.stringify({ language: 'en-US' }), { mode: 0o600 });
  child = spawn(executable, ['--no-sandbox', '--disable-gpu'], {
    env: { ...process.env, APW_PROFILE_DIR: profileDir, APW_SMOKE_READY_FILE: readyFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.once('error', error => { childError = error; childOutput = `${childOutput}${error.message}`.slice(-8000); });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { childOutput = `${childOutput}${chunk}`.slice(-8000); });

  const deadline = Date.now() + 60_000;
  let ready;
  while (Date.now() < deadline) {
    if (childError) throw new Error(`Unable to start packaged macOS app: ${childError.message}`);
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Packaged macOS app exited before ready (code ${child.exitCode}, signal ${child.signalCode})${childOutput ? `\n${childOutput}` : ''}`);
    try {
      ready = JSON.parse(await readFile(readyFile, 'utf8'));
      if (ready.error) throw new Error(`Packaged app startup failed:\n${ready.error}`);
      break;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await delay(200);
  }
  if (!ready) throw new Error('Packaged macOS app did not start its local service within 60 seconds');
  if (!ready.rendererReady) throw new Error(`Packaged macOS renderer did not build its navigation and main view: ${JSON.stringify(ready.rendererState)}${childOutput ? `\n${childOutput}` : ''}`);
  const requiredQuickActions=['monitor','frames','startup','layout','cpu-profile','heap','battery','gpu','benchmark','source','trace','network','apk'];
  const missingQuickActions=requiredQuickActions.filter(route=>!ready.rendererState.quickActionRoutes?.includes(route));
  if(missingQuickActions.length)throw new Error(`Packaged macOS home is missing quick actions: ${missingQuickActions.join(', ')}`);
  const routeChecks=ready.rendererState.routeChecks;
  const hasBrokenRoutes=results=>!Array.isArray(results)||results.length!==16||results.some((result,index)=>!result.active||!result.heading||!result.hasContent||(index>0&&!result.changed));
  if(!routeChecks?.demoActive||hasBrokenRoutes(routeChecks.empty)||hasBrokenRoutes(routeChecks.demo)||!routeChecks.demo.find(result=>result.route==='#cpu-profile')?.stackTimeline)throw new Error(`Packaged macOS route/CPU stack chart smoke failed: ${JSON.stringify(routeChecks)}`);
  if(!ready.rendererState.homeArtifactChecks?.section||!ready.rendererState.homeArtifactChecks?.emptyState)throw new Error(`Packaged macOS home artifact section/empty state failed: ${JSON.stringify(ready.rendererState.homeArtifactChecks)}`);
  if(childOutput.includes('Renderer console error:'))throw new Error(`Packaged macOS renderer logged an error:\n${childOutput}`);
  if (!ready.menuLabels?.includes('File') || !ready.menuLabels.includes('Analyze') || ready.menuLabels.some(label => /[\u3400-\u9fff]/.test(label))) throw new Error(`Packaged macOS menu did not restore English labels: ${JSON.stringify(ready.menuLabels)}`);
  const page = await fetch(ready.origin, { signal: AbortSignal.timeout(10_000) });
  if (!page.ok) throw new Error(`Packaged macOS main page returned HTTP ${page.status}`);
  const html = await page.text();
  if (!html.includes('<main id="main"') || !html.includes('/app.js')) throw new Error('Packaged macOS main page is missing the application shell');
  for (const path of ['/app.js', '/demo.js', '/offline.js', '/i18n.js']) {
    const response = await fetch(new URL(path, ready.origin), { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  }
  console.log(`Packaged macOS desktop smoke passed: ${appBundle}; renderer, Java runtime, Trace Processor, and Perfetto UI ready`);
} catch (error) { failure = error; }
finally {
  await stopChild(child);
  await rm(tempRoot, { recursive: true, force: true });
}

if (failure) {
  const detail = (failure.stack || failure.message || String(failure)).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  console.log(`::error title=macOS packaged app smoke::${detail}`);
  throw failure;
}
