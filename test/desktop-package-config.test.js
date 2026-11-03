import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('native desktop package targets stage platform-matched SDK and Trace Processor tools',async()=>{
 const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 assert.equal(pkg.author.name,'Android Performance Workbench');assert.match(pkg.author.email,/^[^@]+@users\.noreply\.github\.com$/);
 assert.equal(pkg.scripts['package:dmg:x64'],'electron-builder --mac dmg --x64 --publish never');
 assert.equal(pkg.scripts['package:mac:installers'],'electron-builder --mac dmg pkg --arm64 --publish never');
 assert.equal(pkg.scripts['package:mac:installers:x64'],'electron-builder --mac dmg pkg --x64 --publish never');
 assert.equal(pkg.scripts['package:win:installers'],'electron-builder --win nsis msi --x64 --publish never');
 assert.equal(pkg.scripts['package:linux:installers'],'electron-builder --linux AppImage deb rpm --publish never');
 assert.equal(pkg.scripts['package:linux:arm64'],'electron-builder --linux AppImage --arm64 --publish never');
 assert.equal(pkg.scripts['package:linux:arm64:deb'],'electron-builder --linux deb --arm64 --publish never');
 assert.equal(pkg.scripts['package:linux:arm64:installers'],'electron-builder --linux deb rpm --arm64 --publish never');
 assert.equal(pkg.scripts['prepare:linux:arm64-tools'],'node scripts/prepare-linux-arm64-tools.js');
 assert.equal(pkg.scripts['smoke:apk-tools'],'node scripts/apk-tools-smoke.js');
 assert.equal(pkg.scripts['smoke:linux:arm64:packages'],'node scripts/linux-arm64-package-smoke.js');
 assert.equal(pkg.scripts['prepare:linux:arm64:deb-metadata'],'node scripts/floor-linux-arm64-deb-glibc.js');
 const workflow=await readFile(new URL('../.github/workflows/desktop-packages.yml',import.meta.url),'utf8');
 assert.match(workflow,/APK_SMOKE_OUTPUT_PATH: \$\{\{ github\.workspace \}\}\/dist\/apw-smoke\.apk/);assert.match(workflow,/APW_SMOKE_APK_PATH: \$\{\{ github\.workspace \}\}\/dist\/apw-smoke\.apk/);
 for(const target of ['dist/v*/*.pkg','dist/v*/*.msi','dist/v*/*.deb','dist/v*/*.rpm'])assert.ok(workflow.includes(target),`missing CI artifact pattern ${target}`);
 const smoke=await readFile(new URL('../scripts/desktop-smoke.js',import.meta.url),'utf8');
 assert.match(smoke,/diagnosticPath = resolve\('dist\/windows-desktop-smoke\.log'\)/);assert.match(smoke,/Windows smoke initialization failed/);assert.match(smoke,/new AggregateError\(\[failure, error\]/);assert.match(smoke,/msiexec\.exe/);assert.match(smoke,/APPLICATIONFOLDER=/);assert.match(smoke,/\['\/x', msiInstaller/);assert.match(smoke,/runNsis\(\['\/S', `\/D=\$\{installDir\}`\]\)/);assert.match(smoke,/uninstallerName\), \['\/S'\]/);assert.match(smoke,/installed desktop smoke passed/);
 const macSmoke=await readFile(new URL('../scripts/mac-desktop-smoke.js',import.meta.url),'utf8');
 assert.match(macSmoke,/Contents', 'MacOS'/);assert.match(macSmoke,/java-runtime', 'bin', 'java'/);assert.match(macSmoke,/trace-processor/);assert.match(macSmoke,/rendererReady/);assert.match(macSmoke,/cpuLargeTimeline/);assert.match(macSmoke,/50k CPU timeline raster/);assert.match(macSmoke,/heapCsvExport/);assert.match(macSmoke,/HPROF CSV export/);assert.match(macSmoke,/layoutFindings/);assert.match(macSmoke,/structured layout findings/);assert.match(macSmoke,/apkAnalysisSmoke/);assert.match(macSmoke,/APK analysis UI smoke/);assert.match(macSmoke,/menuLabels/);assert.match(macSmoke,/quickActionRoutes/);assert.match(macSmoke,/routeChecks/);assert.match(macSmoke,/Packaged macOS desktop smoke passed/);
 const check=pkg.scripts.check;assert.match(check,/node --check scripts\/mac-desktop-smoke\.js/);assert.match(check,/node --check scripts\/device-smoke\.js/);
 assert.match(workflow,/runner: ubuntu-24\.04-arm[\s\S]*?label: linux-arm64[\s\S]*?dist\/v\*\/\*\.rpm[\s\S]*?package:linux:arm64:installers/);assert.match(workflow,/Install Ubuntu arm64 Android command-line tools[\s\S]*?apt-get install -y adb aapt rpm/);assert.match(workflow,/packages: 'build-tools;35\.0\.0 platforms;android-35'/);assert.match(workflow,/name: Analyze a generated APK with staged ARM64 AAPT2\n        (?:id: apk-smoke-arm64\n        )?if: matrix\.linuxArm64\n        env:\n          AAPT2_PATH: \$\{\{ github\.workspace \}\}\/tools\/apk-tools\/aapt2\n          APK_SMOKE_LOG_PATH: \$\{\{ github\.workspace \}\}\/dist\/apw-apk-smoke\.log\n        run: npm run smoke:apk-tools/);assert.match(workflow,/name: Analyze a generated APK with the SDK AAPT2\n        if: \$\{\{ !matrix\.linuxArm64 \}\}\n        env:\n          APK_SMOKE_LOG_PATH:/);assert.match(workflow,/name: Upload failed smoke diagnostics\n        if: failure\(\)[\s\S]*?dist\/apw-apk-smoke\.log[\s\S]*?dist\/windows-desktop-smoke\.log/);assert.match(workflow,/Set Linux arm64 package runtime floor to Ubuntu 24\.04 glibc/);assert.match(workflow,/Inspect extracted Linux arm64 DEB tools and analyze a generated APK[\s\S]*?npm run smoke:linux:arm64:packages/);
 assert.match(workflow,/name: Install Windows MSI and NSIS packages and verify desktop startup\n        (?:id: desktop-installer-smoke\n        )?[\s\S]*?shell: pwsh[\s\S]*?node scripts\/desktop-smoke\.js 2>&1 \| Tee-Object -FilePath dist\/windows-desktop-smoke-console\.log[\s\S]*?if \(\$LASTEXITCODE -ne 0\) \{ exit \$LASTEXITCODE \}/);assert.match(workflow,/name: Upload failed smoke diagnostics\n        if: failure\(\)[\s\S]*?dist\/windows-desktop-smoke-console\.log/);
 const apkSmoke=await readFile(new URL('../scripts/apk-tools-smoke.js',import.meta.url),'utf8');assert.match(apkSmoke,/Using AAPT2: \$\{aapt2Path\}/);
 const linuxArmSmoke=await readFile(new URL('../scripts/linux-arm64-package-smoke.js',import.meta.url),'utf8');assert.match(linuxArmSmoke,/name\.endsWith\('\.rpm'\)/);assert.match(linuxArmSmoke,/rpm', \['-qp', '--qf', '%\{ARCH\}'/);assert.match(linuxArmSmoke,/architecture === 'aarch64'/);assert.match(linuxArmSmoke,/rpmFilesList/);assert.match(linuxArmSmoke,/resources\/apk-tools\/aapt2/);
 const deviceSmoke=await readFile(new URL('../scripts/device-smoke.js',import.meta.url),'utf8');assert.match(deviceSmoke,/target-app-launch/);assert.match(deviceSmoke,/heap-capture-and-analysis/);assert.match(deviceSmoke,/api\/heap\/shark-analysis/);assert.match(deviceSmoke,/classes\?\.length/);
 assert.match(workflow,/Launch packaged macOS app and verify desktop startup/);assert.match(smoke,/menuLabels/);assert.match(smoke,/quickActionRoutes/);assert.match(smoke,/routeChecks/);assert.match(smoke,/apkAnalysisSmoke/);assert.match(smoke,/APK analysis UI smoke/);
 const desktopMain=await readFile(new URL('../desktop/main.js',import.meta.url),'utf8');assert.match(desktopMain,/smokeApkAnalyzerInRenderer/);assert.match(desktopMain,/APW_SMOKE_EXPECTED_PACKAGE \|\| 'dev\.apw\.smoke'/);assert.match(desktopMain,/Signing structure/);assert.match(desktopMain,/manifestFileFilter/);assert.match(desktopMain,/jsonReport:true/);
 assert.ok(pkg.build.files.includes('desktop/menu.js'),'the localized native menu module must be packaged');
 assert.ok(pkg.build.files.includes('desktop/locale.js'),'the native dialog localization module must be packaged');
 assert.doesNotMatch(pkg.build.extraResources.map(item=>`${item.from}=>${item.to}`).join('\n'),/tools\/java-runtime=>java-runtime/);
 const resources=platform=>pkg.build[platform].extraResources.map(item=>`${item.from}=>${item.to}:${(item.filter||[]).join(',')}`);
 const mac=resources('mac').join('\n'),win=resources('win').join('\n'),linux=resources('linux').join('\n');
 for(const entries of [win,linux]){
  assert.match(entries,/tools\/platform-tools=>platform-tools/);assert.match(entries,/tools\/apk-tools=>apk-tools/);assert.match(entries,/tools\/trace-processor=>trace-processor/);assert.match(entries,/tools\/shark-cli=>shark-cli/);assert.match(entries,/tools\/ui-inspector=>ui-inspector/);assert.match(entries,/tools\/perfetto-ui=>perfetto-ui/);
 }
 assert.match(mac,/tools\/java-runtime=>java-runtime/);
 assert.match(win,/tools\/java-runtime\.tar\.gz=>java-runtime\.tar\.gz/);assert.match(linux,/tools\/java-runtime=>java-runtime/);
 assert.match(win,/trace_processor_shell\.exe/);assert.match(linux,/trace_processor_shell/);
});

test('failed package smoke publishes a sanitized failure classification',async()=>{
 const workflow=await readFile(new URL('../.github/workflows/desktop-packages.yml',import.meta.url),'utf8');
 const apkSmoke=await readFile(new URL('../scripts/apk-tools-smoke.js',import.meta.url),'utf8');
 const desktopSmoke=await readFile(new URL('../scripts/desktop-smoke.js',import.meta.url),'utf8');
 assert.match(workflow,/id: apk-smoke-arm64/);assert.match(workflow,/id: apk-smoke-sdk/);assert.match(workflow,/id: desktop-installer-smoke/);
 assert.match(workflow,/android-performance-smoke-diagnostics-\$\{\{ matrix\.label \}\}-\$\{\{ steps\.apk-smoke-arm64\.outputs\.failure_code/);
 assert.match(apkSmoke,/aapt2-dump-xmltree/);assert.match(apkSmoke,/aapt2-manifest-output/);assert.match(apkSmoke,/failure_code=\$\{failureCode\}/);
 assert.match(desktopSmoke,/windows-msi-install-/);assert.match(desktopSmoke,/windows-nsis-uninstaller-missing/);assert.match(desktopSmoke,/error\.errors\.map/);assert.match(desktopSmoke,/failure_code=\$\{code\}/);
});
