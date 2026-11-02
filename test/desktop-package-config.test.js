import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('native desktop package targets stage platform-matched SDK and Trace Processor tools',async()=>{
 const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 assert.equal(pkg.scripts['package:dmg:x64'],'electron-builder --mac dmg --x64');
 assert.equal(pkg.scripts['package:linux:arm64'],'electron-builder --linux AppImage --arm64');
 const resources=platform=>pkg.build[platform].extraResources.map(item=>`${item.from}=>${item.to}:${(item.filter||[]).join(',')}`);
 const win=resources('win').join('\n'),linux=resources('linux').join('\n');
 for(const [name,entries] of [['Windows',win],['Linux',linux]]){
  assert.match(entries,/tools\/platform-tools=>platform-tools/);assert.match(entries,/tools\/apk-tools=>apk-tools/);assert.match(entries,/tools\/trace-processor=>trace-processor/);assert.match(entries,/tools\/java-runtime=>java-runtime/);assert.match(entries,/tools\/shark-cli=>shark-cli/);assert.match(entries,/tools\/ui-inspector=>ui-inspector/);assert.match(entries,/tools\/perfetto-ui=>perfetto-ui/);
 }
 assert.match(win,/trace_processor_shell\.exe/);assert.match(linux,/trace_processor_shell/);
});
