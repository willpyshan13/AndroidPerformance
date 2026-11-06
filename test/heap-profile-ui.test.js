import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('heap allocation profiles can be imported from a trace file and switched per dump window',async()=>{
 const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8'),html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 assert.match(html,/id="heap-profile-input" type="file"[^>]*hidden/,'the heap page needs its own trace input so imported traces can be analysed without a device');
 assert.match(app,/'import-heap-profile':\(\)=>\{[^}]*#heap-profile-input/,'the heap toolbar must open the trace input');
 assert.match(app,/\$\('#heap-profile-input'\)\.onchange=/,'the heap trace input must handle selected files');
 assert.match(app,/async function importHeapProfileTrace\(file\)\{[\s\S]*?\n\}/,'importing a trace must run the heap analysis path');
 const importBody=app.slice(app.indexOf('async function importHeapProfileTrace'),app.indexOf('async function loadHeapProfileSnapshot'));
 assert.match(importBody,/fetch\('\/api\/heap-profile\/analyze',\{method:'POST',headers:\{'X-Workbench-Token':token,'X-Heap-Profile-Mode':mode\},body:file\}\)/,'imported traces must be analysed with the selected heap mode');
 assert.match(app,/\$\('#heap-profile-input'\)\.onchange=async event=>\{[\s\S]*?256\*1024\*1024[\s\S]*?importHeapProfileTrace\(file\)/,'imported heap traces must keep the trace size limit before analysis');
 assert.match(app,/function applyHeapProfileResult\(result,\{fileName,fileBytes\}\)\{/,'capture and import must share one result handler');
 const capture=app.slice(app.indexOf("'capture-heap-profile':"),app.indexOf("'import-trace':"));
 assert.match(capture,/applyHeapProfileResult\(result,\{fileName,fileBytes:blob\.size\}\)/,'device captures must use the shared result handler');
 assert.match(app,/async function loadHeapProfileSnapshot\(snapshotId\)\{[\s\S]*?'\/heap-profile\/snapshot'/,'switching windows must query the per-dump endpoint');
 assert.match(app,/event\.target\.id==='heap-profile-snapshot'\)\{try\{await loadHeapProfileSnapshot\(event\.target\.value\)/,'the window selector must reload the selected dump');
 assert.match(app,/该区间分配 \$\{human\(profile\.totalAllocatedBytes\)\}/,'the header must describe the number as the selected window');
 assert.match(app,/数值只统计所选采样区间内记录的分配增量，不是从采集开始的累计值。/,'the panel must state that the value is not a running total');
});
