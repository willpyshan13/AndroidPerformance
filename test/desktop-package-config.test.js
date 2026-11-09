import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('native desktop packages target macOS ARM64 and Windows x64 without publishing builds',async()=>{
 const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8'),locales=await readFile(new URL('../public/i18n.js',import.meta.url),'utf8');
 assert.match(app,/heap-shark-export-txt/);assert.match(app,/heap-shark-export-json/);assert.match(app,/state\.heapSharkReport=null/);
 for(const text of ['导出原始报告 TXT','导出报告 JSON','界面只显示报告前 2 MiB；导出文件保留完整已捕获输出。','Shark 原始报告已导出','Shark 报告 JSON 已导出'])assert.ok(locales.includes(text),`missing Shark localization: ${text}`);
 assert.match(app,/trace-binder-export-csv/);assert.match(app,/trace-binder-export-json/);
 assert.match(app,/trace-binder-breakdown-export-csv/);assert.match(app,/trace-binder-breakdown-export-json/);
 assert.match(app,/export-trace-report/);assert.match(app,/formatTraceAnalysisReport/);
 for(const text of ['导出分析报告 JSON','追踪分析报告已导出'])assert.ok(locales.includes(text),`missing trace report localization: ${text}`);
 for(const text of ['导出 CSV','导出 JSON','Binder 事务 CSV 已导出','Binder 事务 JSON 已导出','Binder 阶段分解 CSV 已导出','Binder 阶段分解 JSON 已导出','界面显示前 100 个时间区间，导出保留最多 1,000 个。'])assert.ok(locales.includes(text),`missing Binder localization: ${text}`);
 const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 assert.equal(pkg.scripts['prepare:native-symbolizer'],'node scripts/prepare-native-symbolizer.js');assert.equal(pkg.scripts['smoke:native-symbolizer'],'node scripts/native-symbolizer-smoke.js');assert.ok(pkg.build.mac.extraResources.some(resource=>resource.from==='tools/native-symbolizer'&&resource.to==='native-symbolizer'));
 assert.ok(pkg.build.files.includes('android-agent/LEAKCANARY_AGENT_README.md'));assert.ok(pkg.build.files.includes('android-agent/optional-androidx/**'));assert.ok(pkg.build.asarUnpack.includes('android-agent/optional-androidx/**'));assert.ok(pkg.build.files.includes('android-agent/optional-jankstats/**'));assert.ok(pkg.build.asarUnpack.includes('android-agent/optional-jankstats/**'));
 assert.equal(pkg.author.name,'Android Performance Workbench');assert.match(pkg.author.email,/^[^@]+@users\.noreply\.github\.com$/);
 assert.ok(pkg.build.win);assert.equal(pkg.build.linux,undefined);assert.deepEqual(pkg.build.win.target,['nsis','msi']);
 assert.deepEqual(Object.keys(pkg.scripts).filter(name=>name.startsWith('package:')),['package:mac','package:win']);assert.match(pkg.scripts['package:mac'],/--publish never/);assert.match(pkg.scripts['package:win'],/--publish never/);assert.equal(pkg.scripts['package:dmg'],undefined);
 assert.equal(pkg.scripts['smoke:apk-tools'],'node scripts/apk-tools-smoke.js');
 assert.equal(pkg.scripts['prepare:inspector-runtime'],'node scripts/prepare-inspector-runtime.js');
 const inspectorSource=JSON.parse(await readFile(new URL('../tools/ui-inspector/source.json',import.meta.url),'utf8'));
 assert.equal(inspectorSource.minimumJavaVersion,25);assert.equal(inspectorSource.classFileVersion,69);
 const inspectorRuntimePrep=await readFile(new URL('../scripts/prepare-inspector-runtime.js',import.meta.url),'utf8');
 assert.match(inspectorRuntimePrep,/Temurin JRE/);assert.match(inspectorRuntimePrep,/createHash\('sha256'\)/);assert.match(inspectorRuntimePrep,/72ebd76b502c849e88dea39afae51baf5f82f2b5b1b6389c28ea707b20451bce/);
 const workflow=await readFile(new URL('../.github/workflows/macos-arm-checks.yml',import.meta.url),'utf8');
 const windowsWorkflow=await readFile(new URL('../.github/workflows/windows-x64-checks.yml',import.meta.url),'utf8');
 assert.equal((workflow.match(/paths-ignore:\n\s+- '\*\*\/\*\.md'/g)||[]).length,2,'Markdown-only updates should skip automated checks');
 assert.match(workflow,/jobs:\n  macos-arm64:\n    runs-on: macos-15/);assert.equal((workflow.match(/^      - run: npm ci$/gm)||[]).length,1);assert.equal((workflow.match(/prepare:trace-processor/g)||[]).length,1);assert.match(workflow,/uses: actions\/cache@v6/);assert.match(workflow,/key: macos-arm64-tools-v2-\$\{\{ hashFiles/);assert.match(workflow,/tools\/java25-runtime/);assert.match(workflow,/run: npm test/);assert.match(workflow,/run: npm run check/);assert.match(workflow,/run: node scripts\/run-npm-task\.js package:mac/);assert.match(workflow,/run: node scripts\/mac-desktop-smoke\.js/);assert.doesNotMatch(workflow,/actions\/upload-artifact|create-release/);
 assert.match(windowsWorkflow,/windows-x64:\n    runs-on: windows-2025/);assert.match(windowsWorkflow,/run: npm run package:win/);assert.match(windowsWorkflow,/run: node scripts\/desktop-smoke\.js/);assert.match(windowsWorkflow,/node scripts\/run-npm-task\.js prepare:inspector-runtime/);assert.doesNotMatch(windowsWorkflow,/actions\/upload-artifact|create-release/);
 const simpleperfPrep=await readFile(new URL('../scripts/prepare-simpleperf.js',import.meta.url),'utf8'),legacySource=JSON.parse(await readFile(new URL('../tools/simpleperf-legacy/source.json',import.meta.url),'utf8'));
 assert.match(simpleperfPrep,/legacyBundle=join\(root,'tools\/simpleperf-legacy'\)/);assert.match(simpleperfPrep,/if\(!legacy\)[\s\S]*source\.json/);assert.equal(legacySource.sdkPackage,'ndk;26.1.10909125');assert.equal(legacySource.license,'Apache-2.0');
 for(const arch of ['arm','arm64','x86','x86_64'])assert.ok((await readFile(new URL(`../tools/simpleperf-legacy/android/${arch}/simpleperf`,import.meta.url))).length>0,`missing versioned legacy simpleperf for ${arch}`);
 assert.ok((await readFile(new URL('../tools/simpleperf-legacy/NOTICE.txt',import.meta.url))).length>0);
 assert.match(workflow,/name: macOS ARM checks/);assert.doesNotMatch(workflow,/actions\/upload-artifact|dist\/v\*\/\*\.dmg|android-performance-macos-arm64/,'CI must not publish build artifacts');
 const smoke=await readFile(new URL('../scripts/desktop-smoke.js',import.meta.url),'utf8');
 assert.match(smoke,/diagnosticPath = resolve\('dist\/windows-desktop-smoke\.log'\)/);assert.match(smoke,/Windows smoke initialization failed/);assert.match(smoke,/new AggregateError\(\[failure, error\]/);assert.match(smoke,/taskkill\.exe', \['\/PID', String\(processHandle\.pid\), '\/T', '\/F'\]/);assert.match(smoke,/maxRetries: 10, retryDelay: 500/);assert.match(smoke,/msiexec\.exe/);assert.match(smoke,/APPLICATIONFOLDER=/);assert.match(smoke,/\['\/x', msiInstaller/);assert.match(smoke,/runNsis\(\['\/S', `\/D=\$\{installDir\}`\]\)/);assert.match(smoke,/uninstallerName\), \['\/S'\]/);assert.match(smoke,/installed desktop smoke passed/);
 assert.match(smoke,/simpleperfDir,'bin','windows','x86_64','libsimpleperf_report\.dll'/);assert.match(smoke,/legacy','android','arm64','simpleperf'/);assert.match(smoke,/python','python\.exe'/);assert.match(smoke,/bundled Python\/simpleperf host parser failed to load/);assert.match(smoke,/windows-simpleperf-resource/);
 const macSmoke=await readFile(new URL('../scripts/mac-desktop-smoke.js',import.meta.url),'utf8');
 assert.match(macSmoke,/Contents', 'MacOS'/);assert.match(macSmoke,/java-runtime', 'bin', 'java'/);assert.match(macSmoke,/java25-runtime/);assert.match(macSmoke,/25\.0\.5/);assert.match(macSmoke,/simpleperfDir,'python','bin','python3\.11'/);assert.match(macSmoke,/Bundled Python\/simpleperf parser failed to load/);assert.match(macSmoke,/trace-processor/);assert.match(macSmoke,/rendererReady/);assert.match(macSmoke,/cpuLargeTimeline/);assert.match(macSmoke,/deepCpuStackSmoke/);assert.match(macSmoke,/50k CPU timeline raster/);assert.match(macSmoke,/heapCsvExport/);assert.match(macSmoke,/HPROF CSV \/ dominator graph/);assert.match(macSmoke,/layoutFindings/);assert.match(macSmoke,/structured layout findings/);assert.match(macSmoke,/networkAgentPackage/);assert.match(macSmoke,/debug-only Network, LeakCanary, JankStats, and Startup Agent ZIPs/);assert.match(macSmoke,/leakCanaryAgentPackage/);assert.match(macSmoke,/jankStatsAgentPackage/);assert.match(macSmoke,/startupAgentPackage/);assert.match(macSmoke,/startupExport/);assert.match(macSmoke,/Startup Debug Agent ZIP smoke/);assert.match(macSmoke,/JankStats Debug Agent ZIP smoke/);assert.match(macSmoke,/LeakCanary Debug Agent ZIP smoke/);assert.match(macSmoke,/apkAnalysisSmoke/);assert.match(macSmoke,/APK analysis UI smoke/);assert.match(macSmoke,/menuLabels/);assert.match(macSmoke,/quickActionRoutes/);assert.match(macSmoke,/routeChecks/);assert.match(macSmoke,/Packaged macOS desktop smoke passed/);
 assert.match(macSmoke,/native-symbolizer','llvm-cxxfilt'/);assert.match(macSmoke,/Bundled LLVM C\+\+ demangler failed/);
 assert.match(macSmoke,/heapMarkdownExport/);assert.match(macSmoke,/HPROF Markdown export smoke/);assert.match(macSmoke,/heapJsonExport/);assert.match(macSmoke,/HPROF JSON export smoke/);assert.match(macSmoke,/heapProfileWindows/);assert.match(macSmoke,/heap allocation window smoke/);assert.match(macSmoke,/networkJsonExport/);assert.match(macSmoke,/filtered Network JSON export smoke/);
 assert.match(macSmoke,/traceAnalysisReportSmoke/);assert.match(macSmoke,/trace analysis report export smoke/);
 assert.match(macSmoke,/startupExportSmoke/);assert.match(macSmoke,/startup JSON \/ CSV export smoke/);
 const startupSmokeMain=await readFile(new URL('../desktop/main.js',import.meta.url),'utf8'),startupAppSource=await readFile(new URL('../public/app.js',import.meta.url),'utf8');assert.match(startupSmokeMain,/smokeHeapProfileWindowsInRenderer/);assert.match(startupSmokeMain,/heapProfileWindows/);assert.match(startupSmokeMain,/milestone capture should be visible and disabled in demo mode/);assert.match(startupSmokeMain,/system milestone capture should be visible and disabled in demo mode/);assert.match(startupSmokeMain,/system_startup_evidence_json/);assert.match(startupAppSource,/captureAgentMilestones:state\.startupCaptureAgentMilestones/);assert.match(startupAppSource,/captureSystemMilestones:state\.startupCaptureSystemMilestones/);assert.match(startupAppSource,/startup-agent-iterations/);assert.match(startupAppSource,/startup-system-iterations/);
 assert.match(macSmoke,/powerUidEnergySmoke/);assert.match(macSmoke,/per-UID power diagnostics smoke/);
 const check=pkg.scripts.check;assert.match(check,/node --check scripts\/mac-desktop-smoke\.js/);assert.match(check,/node --check scripts\/device-smoke\.js/);
 assert.doesNotMatch(workflow,/matrix\.(?:linuxArm64|label|command)|windows-desktop-smoke/);
 const apkSmoke=await readFile(new URL('../scripts/apk-tools-smoke.js',import.meta.url),'utf8');assert.match(apkSmoke,/Using AAPT2: \$\{aapt2Path\}/);
 const linuxArmSmoke=await readFile(new URL('../scripts/linux-arm64-package-smoke.js',import.meta.url),'utf8');assert.match(linuxArmSmoke,/name\.endsWith\('\.rpm'\)/);assert.match(linuxArmSmoke,/rpm', \['-qp', '--qf', '%\{ARCH\}'/);assert.match(linuxArmSmoke,/architecture === 'aarch64'/);assert.match(linuxArmSmoke,/rpmFilesList/);assert.match(linuxArmSmoke,/resources\/apk-tools\/aapt2/);
 const deviceSmoke=await readFile(new URL('../scripts/device-smoke.js',import.meta.url),'utf8');assert.match(deviceSmoke,/target-app-launch/);assert.match(deviceSmoke,/heap-capture-and-analysis/);assert.match(deviceSmoke,/api\/heap\/shark-analysis/);assert.match(deviceSmoke,/heap\/dominators/);assert.match(deviceSmoke,/--only/);assert.match(deviceSmoke,/classes\?\.length/);
 assert.match(smoke,/menuLabels/);assert.match(smoke,/quickActionRoutes/);assert.match(smoke,/routeChecks/);assert.match(smoke,/apkAnalysisSmoke/);assert.match(smoke,/APK analysis UI smoke/);
 const taskRunner=await readFile(new URL('../scripts/run-npm-task.js',import.meta.url),'utf8');assert.match(taskRunner,/APW_TASK_LOG_PATH/);assert.match(taskRunner,/appendFile\(path/);
 const desktopMain=await readFile(new URL('../desktop/main.js',import.meta.url),'utf8');assert.match(desktopMain,/smokeApkAnalyzerInRenderer/);assert.match(desktopMain,/APW_SMOKE_EXPECTED_PACKAGE \|\| 'dev\.apw\.smoke'/);assert.match(desktopMain,/Signing structure/);assert.match(desktopMain,/manifestFileFilter/);assert.match(desktopMain,/jsonReport:true/);assert.match(desktopMain,/localSave:true/);assert.match(desktopMain,/sessionHistory:true/);assert.match(desktopMain,/replay:apkReplay/);assert.match(desktopMain,/heap-dominators/);assert.match(desktopMain,/dominatorGraph\?\.ok/);assert.match(desktopMain,/smokeNetworkAgentDeviceInRenderer/);assert.match(desktopMain,/APW_SMOKE_NETWORK_SERIAL/);assert.match(desktopMain,/networkAgentDeviceSmoke\?\.ok/);assert.match(desktopMain,/smokeTraceAnalysisReportInRenderer/);assert.match(desktopMain,/traceAnalysisReportSmoke/);assert.match(desktopMain,/matchingResult:!!sql\?\.rows/);assert.match(desktopMain,/binderSummaryIncluded/);
 assert.ok(pkg.build.files.includes('desktop/menu.js'),'the localized native menu module must be packaged');
 assert.ok(pkg.build.files.includes('desktop/locale.js'),'the native dialog localization module must be packaged');
 assert.doesNotMatch(pkg.build.extraResources.map(item=>`${item.from}=>${item.to}`).join('\n'),/tools\/java-runtime=>java-runtime/);
 const resources=platform=>pkg.build[platform].extraResources.map(item=>`${item.from}=>${item.to}:${(item.filter||[]).join(',')}`);
 const mac=resources('mac').join('\n');
 assert.ok(pkg.build.win.extraResources.some(resource=>resource.from==='tools/platform-tools'&&resource.to==='platform-tools'));
 assert.ok(pkg.build.win.extraResources.some(resource=>resource.from==='tools/java25-runtime'&&resource.to==='java25-runtime'));
 assert.equal(pkg.build.linux,undefined,'Linux desktop distribution remains out of scope');
 for(const entry of ['tools/platform-tools=>platform-tools','tools/apk-tools=>apk-tools','tools/trace-processor=>trace-processor','tools/simpleperf=>simpleperf'])assert.ok(mac.includes(entry),`macOS app omits ${entry}`);
 const sharedResources=pkg.build.extraResources.map(item=>`${item.from}=>${item.to}`).join('\n');
 for(const entry of ['tools/perfetto-ui=>perfetto-ui','tools/shark-cli=>shark-cli','tools/ui-inspector=>ui-inspector'])assert.ok(sharedResources.includes(entry),`app omits ${entry}`);
 assert.match(mac,/tools\/java-runtime=>java-runtime/);
 assert.match(mac,/tools\/java25-runtime=>java25-runtime/);
 const win=resources('win').join('\n');for(const entry of ['tools/platform-tools=>platform-tools','tools/apk-tools=>apk-tools','tools/trace-processor=>trace-processor','tools/simpleperf=>simpleperf','tools/native-symbolizer=>native-symbolizer','tools/java-runtime.tar.gz=>java-runtime.tar.gz'])assert.ok(win.includes(entry),`Windows app omits ${entry}`);
 const simpleperf=await readFile(new URL('../scripts/prepare-simpleperf.js',import.meta.url),'utf8');assert.match(simpleperf,/process\.platform==='win32'\?'windows'/);assert.match(simpleperf,/libsimpleperf_report\.dll/);assert.match(simpleperf,/libwinpthread-1\.dll/);assert.match(simpleperf,/LOCALAPPDATA/);assert.match(simpleperf,/target,'legacy\/android',arch,'simpleperf'/);assert.match(simpleperf,/manifest\.sdkPackage/);assert.match(simpleperf,/legacyBinary=legacy\.path\?/);assert.match(simpleperf,/source\.json/);
 const pythonPrep=await readFile(new URL('../scripts/prepare-python-runtime.js',import.meta.url),'utf8');assert.match(pythonPrep,/astral-sh\/python-build-standalone/);assert.match(pythonPrep,/createHash\('sha256'\)/);assert.match(pythonPrep,/install_only_stripped/);assert.match(pythonPrep,/python3\.11/);assert.equal(pkg.scripts['prepare:simpleperf'],'node scripts/prepare-simpleperf.js && node scripts/prepare-python-runtime.js');
 const perfUpload=await readFile(new URL('../src/perf-upload.js',import.meta.url),'utf8');assert.match(perfUpload,/pythonPath=process\.env\.APW_PYTHON_PATH/);assert.match(perfUpload,/platform==='win32'\?\['python','py'\]:\['python3','python'\]/);assert.match(perfUpload,/command==='py'\?\['-3'\]:\[\]/);
});

test('large HPROF device fixture remains reproducible without entering desktop packages',async()=>{
 const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 assert.equal(pkg.scripts.test,'node --test --test-concurrency=1');
 const builder=await readFile(new URL('../scripts/build-hprof-load-fixture.js',import.meta.url),'utf8');
 const activity=await readFile(new URL('../test/fixtures/hprof-load/HprofLoadActivity.java',import.meta.url),'utf8');
 const manifest=await readFile(new URL('../test/fixtures/hprof-load/AndroidManifest.xml',import.meta.url),'utf8');
 assert.match(pkg.scripts.check,/node --check scripts\/build-hprof-load-fixture\.js/);
 assert.equal(pkg.scripts['build:hprof-load-fixture'],'node scripts/build-hprof-load-fixture.js');
 assert.match(builder,/build-tools\/35\.0\.0/);assert.match(builder,/\bd8\b/);assert.match(builder,/\baapt\b/);assert.match(builder,/\bapksigner\b/);
 assert.match(activity,/NODE_COUNT = 350_000/);assert.match(activity,/root = previous/);
 assert.match(manifest,/android:debuggable="true"/);assert.match(manifest,/targetSdkVersion="25"/);
 assert.ok(!JSON.stringify(pkg.build).includes('hprof-load'));
});

test('macOS CI package smoke retains local diagnostics without publishing artifacts',async()=>{
 const workflow=await readFile(new URL('../.github/workflows/macos-arm-checks.yml',import.meta.url),'utf8');
 const apkSmoke=await readFile(new URL('../scripts/apk-tools-smoke.js',import.meta.url),'utf8');
 const desktopSmoke=await readFile(new URL('../scripts/desktop-smoke.js',import.meta.url),'utf8');
 assert.match(workflow,/id: apk-smoke-sdk/);assert.match(workflow,/scripts\/mac-desktop-smoke\.js/);assert.doesNotMatch(workflow,/actions\/upload-artifact|android-performance-smoke-diagnostics|create-release/);
 assert.match(apkSmoke,/aapt2-dump-xmltree/);assert.match(apkSmoke,/aapt2-link-fixture/);assert.match(apkSmoke,/aapt2-modern-resource-table/);assert.match(apkSmoke,/aapt2-modern-table\.apk/);assert.match(apkSmoke,/aapt2-manifest-output/);assert.match(apkSmoke,/failure_code=\$\{failureCode\}/);assert.match(apkSmoke,/APK smoke diagnostic/);assert.match(apkSmoke,/replace\(\/\(\?:\[A-Za-z\]:\\\\\|\\\/\)\[\^\\s:\]\+\/g, '<path>'\)/);
 assert.match(desktopSmoke,/windows-msi-install-/);assert.match(desktopSmoke,/windows-nsis-uninstaller-missing/);assert.match(desktopSmoke,/error\.errors\.map/);assert.match(desktopSmoke,/failure_code=\$\{code\}/);
});

test('packaged desktop smoke exercises local source selection, snapshot, search, and file view',async()=>{
 const desktopMain=await readFile(new URL('../desktop/main.js',import.meta.url),'utf8');
 const windowsSmoke=await readFile(new URL('../scripts/desktop-smoke.js',import.meta.url),'utf8');
 const macSmoke=await readFile(new URL('../scripts/mac-desktop-smoke.js',import.meta.url),'utf8');
 for(const source of [desktopMain,windowsSmoke,macSmoke])assert.match(source,/APW_SMOKE_SOURCE_DIR/);
 assert.match(desktopMain,/smokePerfettoUiCsvDownloadBridgeInRenderer/);assert.match(desktopMain,/binderOverviewPanels/);assert.match(desktopMain,/Perfetto UI CSV download bridge/);assert.match(desktopMain,/verify transferred trace/);assert.match(desktopMain,/traceOpened/);assert.match(macSmoke,/automatic embedded Perfetto CSV report import/);assert.match(macSmoke,/perfettoUiCsvBridgeSmoke/);
 assert.match(desktopMain,/smokeSourceWorkspaceInRenderer/);
 assert.match(desktopMain,/LOCAL_SOURCE_WORKSPACE_SMOKE/);
 assert.match(desktopMain,/nativeSymbolResolve:true/);assert.match(desktopMain,/Native function name match/);
 assert.match(desktopMain,/_ZN3apw11SmokeWorker3runEv/);assert.match(windowsSmoke,/native\.cxx/);assert.match(macSmoke,/native\.cxx/);assert.match(macSmoke,/nativeFileOpened/);assert.match(macSmoke,/Bundled LLVM C\+\+ demangler failed/);
 assert.match(windowsSmoke,/source workspace smoke/);
 assert.match(macSmoke,/source workspace smoke/);
 assert.match(macSmoke,/LeakCanary Debug Agent ZIP smoke/);assert.match(desktopMain,/smokeLeakCanaryAgentPackageInRenderer/);assert.match(desktopMain,/optional-androidx\/src\/debug\/java\/dev\/androidperformance\/agent\/ApwAndroidXFragmentLeakAgent\.java/);
 assert.match(desktopMain,/smokeJankStatsAgentPackageInRenderer/);assert.match(desktopMain,/JANKSTATS_AGENT_README\.md[\s\S]*optional-androidx\/src\/debug\/java\/dev\/androidperformance\/agent\/ApwAndroidXFragmentLeakAgent\.java/);
});

test('unpackaged desktop runs resolve the bundled tool directories instead of Electron resources',async()=>{
 // process.resourcesPath points at Electron's own bundle outside a packaged app, so every bundled
 // tool must be resolved from tools/ explicitly or the dev app silently loses the embedded
 // Perfetto UI, Shark reports and the Compose inspector.
 const main=await readFile(new URL('../desktop/main.js',import.meta.url),'utf8');
 assert.match(main,/const bundledTools=app\.isPackaged\?\{\}:\{perfettoUiDir:join\(here,'\.\.','tools','perfetto-ui'\)/);
 for(const tool of ['sharkDir','composeInspectorDir','nativeDemanglerPath'])assert.match(main,new RegExp(`${tool}:join\\(here,'\\.\\.','tools'`));
 assert.match(main,/server = createApp\(\{[^}]*\.\.\.bundledTools[^}]*\}\)/);
 const macSmoke=await readFile(new URL('../scripts/mac-desktop-smoke.js',import.meta.url),'utf8');
 assert.match(macSmoke,/settings\.json'\), JSON\.stringify\(\{ language: 'en-US'/,'the packaged smoke must pin the UI language because its assertions read English labels');
});
