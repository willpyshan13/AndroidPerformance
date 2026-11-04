import { spawn, spawnSync } from 'node:child_process';
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
const sourceFixtureDir = join(tempRoot, 'source-fixture');
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
  const inspectorJava=join(resources,'java25-runtime','bin','java');
  await stat(inspectorJava);
  const inspectorJavaVersion=spawnSync(inspectorJava,['-version'],{encoding:'utf8',timeout:15_000});
  if(inspectorJavaVersion.error||inspectorJavaVersion.status!==0||!`${inspectorJavaVersion.stdout}\n${inspectorJavaVersion.stderr}`.includes('25.0.5'))throw new Error(`Bundled Compose Inspector Java 25 runtime failed: ${inspectorJavaVersion.stderr||inspectorJavaVersion.error?.message||`exit code ${inspectorJavaVersion.status}`}`);
  await stat(join(resources, 'trace-processor', 'trace_processor_shell'));
  const nativeSymbolizer=join(resources,'native-symbolizer','llvm-symbolizer'),nativeSymbolizerVersion=spawnSync(nativeSymbolizer,['--version'],{encoding:'utf8',timeout:15_000});
  if(nativeSymbolizerVersion.error||nativeSymbolizerVersion.status!==0||!`${nativeSymbolizerVersion.stdout}\n${nativeSymbolizerVersion.stderr}`.includes('LLVM'))throw new Error(`Bundled LLVM DWARF symbolizer failed to start: ${nativeSymbolizerVersion.stderr||nativeSymbolizerVersion.error?.message||`exit code ${nativeSymbolizerVersion.status}`}`);
  await stat(join(resources, 'perfetto-ui', 'index.html'));
  const simpleperfDir=join(resources,'simpleperf'),pythonPath=join(simpleperfDir,'python','bin','python3.11');
  await access(pythonPath);
  const pythonSmoke=spawnSync(pythonPath,['-c','from simpleperf_report_lib import ReportLib; report = ReportLib(); report.Close()'],{cwd:simpleperfDir,encoding:'utf8',timeout:30_000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  if(pythonSmoke.error||pythonSmoke.status!==0)throw new Error(`Bundled Python/simpleperf parser failed to load: ${pythonSmoke.stderr||pythonSmoke.error?.message||`exit code ${pythonSmoke.status}`}`);
  await mkdir(profileDir, { recursive: true });
  await mkdir(join(sourceFixtureDir, 'src'), { recursive: true });
  await writeFile(join(sourceFixtureDir, 'src', 'SmokeWorkspaceTarget.java'), 'package apw.smoke;\npublic final class SmokeWorkspaceTarget {\n  public String marker() { return "LOCAL_SOURCE_WORKSPACE_SMOKE"; }\n}\n', 'utf8');
  await writeFile(join(sourceFixtureDir, 'src', 'native.cxx'), 'namespace apw {\nclass SmokeWorker {\n public:\n  void run();\n};\n}\nvoid apw::SmokeWorker::\nrun() {}\n', 'utf8');
  await writeFile(join(profileDir, 'settings.json'), JSON.stringify({ language: 'en-US' }), { mode: 0o600 });
  child = spawn(executable, ['--no-sandbox', '--disable-gpu'], {
    env: { ...process.env, APW_PROFILE_DIR: profileDir, APW_SMOKE_READY_FILE: readyFile, APW_SMOKE_SOURCE_DIR: sourceFixtureDir },
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
  if (!ready) throw new Error(`Packaged macOS app did not become ready within 60 seconds${childOutput ? `\n${childOutput}` : ''}`);
  if (!ready.rendererReady) throw new Error(`Packaged macOS renderer did not build its navigation and main view: ${JSON.stringify({initial:{readyState:ready.rendererState.readyState,navItems:ready.rendererState.navItems,quickActionRoutes:ready.rendererState.quickActionRoutes,mainPresent:ready.rendererState.mainPresent,mainText:ready.rendererState.mainText,script:ready.rendererState.script,resources:ready.rendererState.resources,smokeErrors:ready.rendererState.smokeErrors},rendererMessages:ready.rendererState.smokeRendererMessages,failed:ready.rendererState.failedReadinessChecks,routeChecks:ready.rendererState.routeChecks,networkJson:ready.rendererState.networkJsonExport,traceReport:ready.rendererState.traceAnalysisReportSmoke,heapCsv:ready.rendererState.heapCsvExport,heapMarkdown:ready.rendererState.heapMarkdownExport,heapJson:ready.rendererState.heapJsonExport,cpuPng:ready.rendererState.cpuPngExport,cpuTimeline:ready.rendererState.cpuLargeTimeline,layout:ready.rendererState.layoutFindings,source:ready.rendererState.sourceWorkspaceSmoke})}${childOutput ? `\n${childOutput}` : ''}`);
  const requiredQuickActions=['monitor','frames','startup','layout','cpu-profile','heap','battery','gpu','benchmark','source','trace','network','apk'];
  const missingQuickActions=requiredQuickActions.filter(route=>!ready.rendererState.quickActionRoutes?.includes(route));
  if(missingQuickActions.length)throw new Error(`Packaged macOS home is missing quick actions: ${missingQuickActions.join(', ')}`);
  const routeChecks=ready.rendererState.routeChecks;
  const hasBrokenRoutes=results=>!Array.isArray(results)||results.length!==16||results.some((result,index)=>!result.active||!result.heading||!result.hasContent||(index>0&&!result.changed));
  if(!routeChecks?.demoActive||hasBrokenRoutes(routeChecks.empty)||hasBrokenRoutes(routeChecks.demo)||!routeChecks.demo.find(result=>result.route==='#cpu-profile')?.stackTimeline)throw new Error(`Packaged macOS route/CPU stack chart smoke failed: ${JSON.stringify(routeChecks)}`);
  const untranslated=routeChecks.demo.flatMap(result=>result.untranslated.map(text=>({route:result.route,text})));
  if(untranslated.length){const reportPath=join(tmpdir(),'android-performance-untranslated-english.json');await writeFile(reportPath,JSON.stringify(untranslated,null,2));throw new Error(`Packaged macOS English route smoke found ${untranslated.length} untranslated UI strings; details: ${reportPath}`);}
  if(!ready.rendererState.cpuPngExport?.ok||ready.rendererState.cpuPngExport.type!=='image/png')throw new Error(`Packaged macOS CPU PNG export smoke failed: ${JSON.stringify(ready.rendererState.cpuPngExport)}`);
  if(!ready.rendererState.cpuLargeTimeline?.ok||ready.rendererState.cpuLargeTimeline.totalMs>30_000)throw new Error(`Packaged macOS 50k CPU timeline raster smoke failed: ${JSON.stringify(ready.rendererState.cpuLargeTimeline)}`);
  if(!ready.rendererState.heapCsvExport?.ok||!ready.rendererState.heapCsvExport?.dominatorGraph?.ok)throw new Error(`Packaged macOS HPROF CSV / dominator graph smoke failed: ${JSON.stringify(ready.rendererState.heapCsvExport)}`);
  if(!ready.rendererState.heapMarkdownExport?.ok)throw new Error(`Packaged macOS HPROF Markdown export smoke failed: ${JSON.stringify(ready.rendererState.heapMarkdownExport)}`);
  if(!ready.rendererState.heapJsonExport?.ok)throw new Error(`Packaged macOS HPROF JSON export smoke failed: ${JSON.stringify(ready.rendererState.heapJsonExport)}`);
  if(!ready.rendererState.layoutFindings?.ok)throw new Error(`Packaged macOS structured layout findings smoke failed: ${JSON.stringify(ready.rendererState.layoutFindings)}`);
  if(!ready.rendererState.sourceWorkspaceSmoke?.ok||!ready.rendererState.sourceWorkspaceSmoke.nativeSymbolResolve||!ready.rendererState.sourceWorkspaceSmoke.nativeCandidateLocalized||!ready.rendererState.sourceWorkspaceSmoke.nativeFileOpened)throw new Error(`Packaged macOS source workspace smoke failed: ${JSON.stringify(ready.rendererState.sourceWorkspaceSmoke)}`);
  if(!ready.rendererState.networkAgentPackage?.ok)throw new Error(`Packaged macOS Network Agent ZIP smoke failed: ${JSON.stringify(ready.rendererState.networkAgentPackage)}`);
  if(!ready.rendererState.networkJsonExport?.ok)throw new Error(`Packaged macOS filtered Network JSON export smoke failed: ${JSON.stringify(ready.rendererState.networkJsonExport)}`);
  if(!ready.rendererState.leakCanaryAgentPackage?.ok)throw new Error(`Packaged macOS LeakCanary Debug Agent ZIP smoke failed: ${JSON.stringify(ready.rendererState.leakCanaryAgentPackage)}`);
  if(!ready.rendererState.jankStatsAgentPackage?.ok)throw new Error(`Packaged macOS JankStats Debug Agent ZIP smoke failed: ${JSON.stringify(ready.rendererState.jankStatsAgentPackage)}`);
  if(!ready.rendererState.startupComparisonSmoke?.ok)throw new Error(`Packaged macOS startup comparison smoke failed: ${JSON.stringify(ready.rendererState.startupComparisonSmoke)}`);
  if(!ready.rendererState.benchmarkRegressionSmoke?.ok)throw new Error(`Packaged macOS Benchmark regression smoke failed: ${JSON.stringify(ready.rendererState.benchmarkRegressionSmoke)}`);
  if(!ready.rendererState.layoutTraceOnlySmoke?.ok)throw new Error(`Packaged macOS trace-only layout evidence smoke failed: ${JSON.stringify(ready.rendererState.layoutTraceOnlySmoke)}`);
  if(!ready.rendererState.traceAnalysisReportSmoke?.ok)throw new Error(`Packaged macOS trace analysis report export smoke failed: ${JSON.stringify(ready.rendererState.traceAnalysisReportSmoke)}`);
  if(process.env.APW_SMOKE_NETWORK_SERIAL&&(!ready.rendererState.networkAgentDeviceSmoke?.ok||!ready.rendererState.networkAgentDeviceSmoke?.emptyAgentState))throw new Error(`Packaged macOS live Network Agent UI smoke failed: ${JSON.stringify(ready.rendererState.networkAgentDeviceSmoke)}`);
  if(!ready.rendererState.homeArtifactChecks?.section||!ready.rendererState.homeArtifactChecks?.emptyState)throw new Error(`Packaged macOS home artifact section/empty state failed: ${JSON.stringify(ready.rendererState.homeArtifactChecks)}`);
  if(process.env.APW_SMOKE_APK_PATH&&!ready.rendererState.apkAnalysisSmoke?.ok)throw new Error(`Packaged macOS APK analysis UI smoke failed: ${JSON.stringify(ready.rendererState.apkAnalysisSmoke)}`);
  if(childOutput.includes('Renderer console error:'))throw new Error(`Packaged macOS renderer logged an error:\n${childOutput}`);
  if (!ready.menuLabels?.includes('File') || !ready.menuLabels.includes('Analyze') || ready.menuLabels.some(label => /[\u3400-\u9fff]/.test(label))) throw new Error(`Packaged macOS menu did not restore English labels: ${JSON.stringify(ready.menuLabels)}`);
  const page = await fetch(ready.origin, { signal: AbortSignal.timeout(10_000) });
  if (!page.ok) throw new Error(`Packaged macOS main page returned HTTP ${page.status}`);
  const html = await page.text();
  if (!html.includes('<main id="main"') || !html.includes('/app.js')) throw new Error('Packaged macOS main page is missing the application shell');
  for (const path of ['/app.js', '/demo.js', '/offline.js', '/heap-export.js', '/shark-export.js', '/binder-export.js', '/trace-export.js', '/i18n.js']) {
    const response = await fetch(new URL(path, ready.origin), { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  }
  console.log(`Packaged macOS desktop smoke passed: ${appBundle}; renderer, Java runtime, LLVM DWARF symbolizer, Trace Processor, Perfetto UI, trace-only layout evidence without gfxinfo, trace analysis report export, HPROF CSV / Markdown / JSON exports and dominator graph, filtered redacted Network JSON export, structured layout findings, local source workspace, debug-only Network, LeakCanary, and JankStats Agent ZIPs, optional live Network Agent UI, 50k CPU timeline raster, APK analyzer UI${ready.rendererState.apkAnalysisSmoke?.ok?' passed':''}, and 16-route English scan (${JSON.stringify({cpu:ready.rendererState.cpuLargeTimeline,traceReport:ready.rendererState.traceAnalysisReportSmoke,heapCsv:ready.rendererState.heapCsvExport,heapMarkdown:ready.rendererState.heapMarkdownExport,heapJson:ready.rendererState.heapJsonExport,networkJson:ready.rendererState.networkJsonExport,layout:ready.rendererState.layoutFindings,layoutTraceOnly:ready.rendererState.layoutTraceOnlySmoke,source:ready.rendererState.sourceWorkspaceSmoke,networkAgentPackage:ready.rendererState.networkAgentPackage,leakCanaryAgentPackage:ready.rendererState.leakCanaryAgentPackage,jankStatsAgentPackage:ready.rendererState.jankStatsAgentPackage,networkAgentDevice:ready.rendererState.networkAgentDeviceSmoke,apk:ready.rendererState.apkAnalysisSmoke,englishRoutes:routeChecks.demo.length})})`);
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
