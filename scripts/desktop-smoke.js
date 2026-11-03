import { spawn, spawnSync } from 'node:child_process';
import { access, appendFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pkg from '../package.json' with { type: 'json' };

const outputDir = resolve(`dist/v${pkg.version}`);
const diagnosticPath = resolve('dist/windows-desktop-smoke.log');
async function publishFailureCode(error) {
  if (!process.env.GITHUB_OUTPUT) return;
  const messages = [error?.message || String(error)];
  if (error instanceof AggregateError) messages.push(...error.errors.map(item => item?.message || String(item)));
  const message = messages.join('\n');
  const code = /Expected one MSI/i.test(message) ? 'windows-msi-artifact-count'
    : /Expected one NSIS/i.test(message) ? 'windows-nsis-artifact-count'
    : /MSI installation failed with exit code (\d+|unknown)/i.test(message) ? `windows-msi-install-${message.match(/MSI installation failed with exit code (\d+|unknown)/i)[1]}`
    : /MSI uninstallation failed with exit code (\d+|unknown)/i.test(message) ? `windows-msi-uninstall-${message.match(/MSI uninstallation failed with exit code (\d+|unknown)/i)[1]}`
    : /NSIS installation failed with exit code (\d+|unknown)/i.test(message) ? `windows-nsis-install-${message.match(/NSIS installation failed with exit code (\d+|unknown)/i)[1]}`
    : /NSIS uninstallation failed with exit code (\d+|unknown)/i.test(message) ? `windows-nsis-uninstall-${message.match(/NSIS uninstallation failed with exit code (\d+|unknown)/i)[1]}`
    : /NSIS uninstaller was not found/i.test(message) ? 'windows-nsis-uninstaller-missing'
    : /temporary files could not be removed|EBUSY|EPERM|ENOTEMPTY.*nsis-installed-app/i.test(message) ? 'windows-temp-cleanup'
    : /desktop route\/CPU stack chart|home is missing quick actions|home artifact section|source workspace|APK analysis UI/i.test(message) ? 'windows-installed-app-ui'
    : /did not start|startup failed|renderer|Unable to start installed desktop app/i.test(message) ? 'windows-installed-app-startup'
    : 'windows-desktop-smoke-unknown';
  try { await appendFile(process.env.GITHUB_OUTPUT, `failure_code=${code}\n`, 'utf8'); } catch {}
}
let files, msiInstaller, nsisInstaller;
try {
  files = await readdir(outputDir);
  const findInstaller = extension => files.filter(name => name.toLowerCase().endsWith(extension));
  const [msiName] = findInstaller('.msi');
  const [nsisName] = findInstaller('.exe');
  if (findInstaller('.msi').length !== 1) throw new Error(`Expected one MSI installer in ${outputDir}, found ${findInstaller('.msi').length}`);
  if (findInstaller('.exe').length !== 1) throw new Error(`Expected one NSIS installer in ${outputDir}, found ${findInstaller('.exe').length}`);
  msiInstaller = join(outputDir, msiName);
  nsisInstaller = join(outputDir, nsisName);
} catch (error) {
  await publishFailureCode(error);
  await mkdir(dirname(diagnosticPath), { recursive: true });
  const detail = error?.stack || error?.message || String(error);
  await writeFile(diagnosticPath, `${detail}\n`, 'utf8');
  console.error(`Windows smoke initialization failed; diagnostic written to ${diagnosticPath}\n${detail}`);
  throw error;
}

function runMsi(args) {
  return spawnSync('msiexec.exe', args, { encoding: 'utf8', timeout: 180_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
}

function runNsis(args) {
  return spawnSync(nsisInstaller, args, { encoding: 'utf8', timeout: 180_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
}

async function commandFailure(label, result, logPath) {
  let log = '';
  if (logPath) try { log = await readFile(logPath, 'utf8'); } catch {}
  const details = [result.error?.message, result.stdout, result.stderr, log.slice(-12_000)].filter(Boolean).join('\n');
  return new Error(`${label} failed with exit code ${result.status ?? 'unknown'}${details ? `\n${details}` : ''}`);
}

async function waitForReady(child, readyFile, getOutput, getError) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (getError()) throw new Error(`Unable to start installed desktop app: ${getError().message}`);
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Installed desktop app exited before ready (code ${child.exitCode}, signal ${child.signalCode})${getOutput() ? `\n${getOutput()}` : ''}`);
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

async function stopChild(processHandle) {
  if (!processHandle) return;
  if (process.platform === 'win32' && processHandle.pid) {
    spawnSync('taskkill.exe', ['/PID', String(processHandle.pid), '/T', '/F'], { encoding: 'utf8', timeout: 10_000, windowsHide: true });
  } else if (processHandle.exitCode !== null || processHandle.signalCode !== null) return;
  else processHandle.kill('SIGTERM');
  if (processHandle.exitCode === null && processHandle.signalCode === null) {
    await Promise.race([new Promise(resolveExit => processHandle.once('exit', resolveExit)), delay(5_000)]);
  }
  if (processHandle.exitCode === null && processHandle.signalCode === null) {
    processHandle.kill('SIGKILL');
    await Promise.race([new Promise(resolveExit => processHandle.once('exit', resolveExit)), delay(5_000)]);
  }
}

async function verifyInstalledApp(label, installDir, tempRoot) {
  const profileDir = join(tempRoot, `${label}-profile`);
  const readyFile = join(tempRoot, `${label}-ready.json`);
  const executable = join(installDir, `${pkg.build.productName}.exe`);
  await access(executable);
  await mkdir(profileDir, { recursive: true });
  await writeFile(join(profileDir, 'settings.json'), JSON.stringify({ language: 'en-US' }), { mode: 0o600 });
  let childError;
  let childOutput = '';
  const child = spawn(executable, ['--no-sandbox', '--disable-gpu'], {
    env: { ...process.env, APW_PROFILE_DIR: profileDir, APW_SMOKE_READY_FILE: readyFile, APW_SMOKE_SOURCE_DIR: join(tempRoot, 'source-fixture') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.once('error', error => { childError = error; childOutput = `${childOutput}${error.message}`.slice(-8000); });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { childOutput = `${childOutput}${chunk}`.slice(-8000); });

  try {
    const { origin, rendererReady, rendererState, menuLabels } = await waitForReady(child, readyFile, () => childError?.message || childOutput, () => childError);
    if (!rendererReady) throw new Error(`${label}: desktop renderer did not build its navigation and main view: ${JSON.stringify(rendererState)}`);
    const requiredQuickActions=['monitor','frames','startup','layout','cpu-profile','heap','battery','gpu','benchmark','source','trace','network','apk'];
    const missingQuickActions=requiredQuickActions.filter(route=>!rendererState.quickActionRoutes?.includes(route));
    if(missingQuickActions.length)throw new Error(`${label}: desktop home is missing quick actions: ${missingQuickActions.join(', ')}`);
    const routeChecks=rendererState.routeChecks;
    const hasBrokenRoutes=results=>!Array.isArray(results)||results.length!==16||results.some((result,index)=>!result.active||!result.heading||!result.hasContent||(index>0&&!result.changed));
    if(!routeChecks?.demoActive||hasBrokenRoutes(routeChecks.empty)||hasBrokenRoutes(routeChecks.demo)||!routeChecks.demo.find(result=>result.route==='#cpu-profile')?.stackTimeline)throw new Error(`${label}: desktop route/CPU stack chart smoke failed: ${JSON.stringify(routeChecks)}`);
    if(!rendererState.sourceWorkspaceSmoke?.ok)throw new Error(`${label}: source workspace smoke failed: ${JSON.stringify(rendererState.sourceWorkspaceSmoke)}`);
    if(!rendererState.homeArtifactChecks?.section||!rendererState.homeArtifactChecks?.emptyState)throw new Error(`${label}: home artifact section/empty state failed: ${JSON.stringify(rendererState.homeArtifactChecks)}`);
    if(process.env.APW_SMOKE_APK_PATH&&!rendererState.apkAnalysisSmoke?.ok)throw new Error(`${label}: APK analysis UI smoke failed: ${JSON.stringify(rendererState.apkAnalysisSmoke)}`);
    if(childOutput.includes('Renderer console error:'))throw new Error(`${label}: renderer logged an error:\n${childOutput}`);
    if (!menuLabels?.includes('File') || !menuLabels.includes('Analyze') || menuLabels.some(item => /[\u3400-\u9fff]/.test(item))) throw new Error(`${label}: desktop menu did not restore English labels: ${JSON.stringify(menuLabels)}`);
    const page = await fetch(origin, { signal: AbortSignal.timeout(10_000) });
    if (!page.ok) throw new Error(`${label}: main page returned HTTP ${page.status}`);
    const html = await page.text();
    if (!html.includes('<main id="main"') || !html.includes('/app.js')) throw new Error(`${label}: main page is missing the application shell`);
    for (const path of ['/app.js', '/demo.js', '/offline.js', '/i18n.js']) {
      const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`${label}: ${path} returned HTTP ${response.status}`);
    }
    await stat(join(profileDir, 'runtime', 'java-runtime', 'bin', 'java.exe'));
    console.log(`${label} installed desktop smoke passed: ${origin}; renderer, Java runtime, local source workspace${rendererState.apkAnalysisSmoke?.ok?', and APK analyzer UI':''} ready`);
  } finally {
    await stopChild(child);
  }
}

async function smokeMsi(tempRoot) {
  const installDir = join(tempRoot, 'msi-installed-app');
  const logDir = join(tempRoot, 'msi-logs');
  const installLog = join(logDir, 'install.log');
  const uninstallLog = join(logDir, 'uninstall.log');
  await mkdir(logDir, { recursive: true });
  let installed = false;
  let failure;
  let uninstallFailure;
  try {
    await access(msiInstaller);
    const install = runMsi(['/i', msiInstaller, '/qn', '/norestart', '/l*v', installLog, `APPLICATIONFOLDER=${installDir}`]);
    if (install.error || ![0, 3010].includes(install.status)) throw await commandFailure('MSI installation', install, installLog);
    installed = true;
    await verifyInstalledApp('MSI', installDir, tempRoot);
  } catch (error) { failure = error; }
  finally {
    if (installed) {
      const uninstall = runMsi(['/x', msiInstaller, '/qn', '/norestart', '/l*v', uninstallLog]);
      if (uninstall.error || ![0, 3010].includes(uninstall.status)) uninstallFailure = await commandFailure('MSI uninstallation', uninstall, uninstallLog);
    }
  }
  if (failure || uninstallFailure) throw failure || uninstallFailure;
}

async function smokeNsis(tempRoot) {
  const installDir = join(tempRoot, 'nsis-installed-app');
  let installed = false;
  let failure;
  let uninstallFailure;
  try {
    await access(nsisInstaller);
    const install = runNsis(['/S', `/D=${installDir}`]);
    if (install.error || install.status !== 0) throw await commandFailure('NSIS installation', install);
    installed = true;
    await verifyInstalledApp('NSIS', installDir, tempRoot);
  } catch (error) { failure = error; }
  finally {
    if (installed) {
      const uninstallerName = (await readdir(installDir)).find(name => /^uninstall .*\.exe$/i.test(name));
      if (!uninstallerName) uninstallFailure = new Error('NSIS uninstaller was not found in the installation directory');
      else {
        const uninstall = spawnSync(join(installDir, uninstallerName), ['/S'], { encoding: 'utf8', timeout: 180_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
        if (uninstall.error || uninstall.status !== 0) uninstallFailure = await commandFailure('NSIS uninstallation', uninstall);
      }
    }
  }
  if (failure || uninstallFailure) throw failure || uninstallFailure;
}

let tempRoot;
let failure;
try {
  tempRoot = await mkdtemp(join(tmpdir(), 'android-performance-smoke-'));
  const sourceFixtureDir = join(tempRoot, 'source-fixture');
  await mkdir(join(sourceFixtureDir, 'src'), { recursive: true });
  await writeFile(join(sourceFixtureDir, 'src', 'SmokeWorkspaceTarget.java'), 'package apw.smoke;\npublic final class SmokeWorkspaceTarget {\n  public String marker() { return "LOCAL_SOURCE_WORKSPACE_SMOKE"; }\n}\n', 'utf8');
  await smokeMsi(tempRoot);
  await smokeNsis(tempRoot);
} catch (error) { failure = error; }
finally {
  if (tempRoot) try { await rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); }
  catch (error) { failure = failure ? new AggregateError([failure, error], 'Windows smoke failed and its temporary files could not be removed') : error; }
}

if (failure) {
  await publishFailureCode(failure);
  const rawDetail = failure instanceof AggregateError
    ? `${failure.message}\n${failure.errors.map(error => error?.stack || error?.message || String(error)).join('\n--- cleanup error ---\n')}`
    : failure.stack || failure.message || String(failure);
  await writeFile(diagnosticPath, `${rawDetail}\n`, 'utf8');
  const detail = rawDetail.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  console.log(`::error title=Windows installer smoke::${detail}`);
  throw failure;
}
