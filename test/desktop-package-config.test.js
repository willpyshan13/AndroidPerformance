import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('native desktop package targets stage platform-matched SDK and Trace Processor tools',async()=>{
 const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 assert.equal(pkg.scripts['package:dmg:x64'],'electron-builder --mac dmg --x64 --publish never');
 assert.equal(pkg.scripts['package:mac:installers'],'electron-builder --mac dmg pkg --arm64 --publish never');
 assert.equal(pkg.scripts['package:mac:installers:x64'],'electron-builder --mac dmg pkg --x64 --publish never');
 assert.equal(pkg.scripts['package:win:installers'],'electron-builder --win nsis msi --x64 --publish never');
 assert.equal(pkg.scripts['package:linux:installers'],'electron-builder --linux AppImage deb rpm --publish never');
 assert.equal(pkg.scripts['package:linux:arm64'],'electron-builder --linux AppImage --arm64 --publish never');
 const workflow=await readFile(new URL('../.github/workflows/desktop-packages.yml',import.meta.url),'utf8');
 for(const target of ['dist/v*/*.pkg','dist/v*/*.msi','dist/v*/*.deb','dist/v*/*.rpm'])assert.ok(workflow.includes(target),`missing CI artifact pattern ${target}`);
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
