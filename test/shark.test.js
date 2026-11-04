import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,chmod,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
import {createApp} from '../src/server.js';
import {resolveSharkResources,analyzeWithShark} from '../src/shark.js';
import {sharkReportJson} from '../public/shark-export.js';

const jars=['shark-cli-2.14.jar','shark-android-2.14.jar','clikt-2.3.0.jar','jline-2.14.6.jar','shark-2.14.jar','shark-graph-2.14.jar','okio-2.2.2.jar','shark-hprof-2.14.jar','shark-log-2.14.jar','kotlin-stdlib-1.3.72.jar'];
const n4=n=>{const b=Buffer.alloc(4);b.writeUInt32BE(n);return b;};
const record=(tag,bytes)=>Buffer.concat([Buffer.from([tag]),n4(0),n4(bytes.length),bytes]);
const heap=Buffer.concat([Buffer.from('JAVA PROFILE 1.0.3\0'),n4(4),Buffer.alloc(8),record(0x1c,Buffer.concat([Buffer.from([0x23]),n4(4),n4(0),n4(3),Buffer.from([8,1,2,3])])),record(0x2c,Buffer.alloc(0))]);
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'apw-shark-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const lib=join(root,'shark-cli','lib');await mkdir(lib,{recursive:true});for(const name of jars)await writeFile(join(lib,name),'');
 const java=join(root,process.platform==='win32'?'java.cmd':'java');
 if(process.platform==='win32')await writeFile(java,'@echo HEAP ANALYSIS RESULT\r\n');
 else{await writeFile(java,'#!/bin/sh\nprintf "HEAP ANALYSIS RESULT\\n"\nprintf "%s\\n" "$@"\n');await chmod(java,0o700);}
 const resources=await resolveSharkResources({sharkDir:join(root,'shark-cli'),javaPath:java});
 return {root,resources,java};
}

test('Shark resource detection rejects missing jars and accepts the pinned dependency set',async t=>{
 const f=await fixture(t);assert.equal(f.resources.available,true);assert.equal(f.resources.version,'2.14');
 await rm(join(f.root,'shark-cli','lib',jars[0]));assert.equal((await resolveSharkResources({sharkDir:join(f.root,'shark-cli')})).available,false);
});

test('Shark invocation passes HPROF and mapping paths as separate arguments',async t=>{
 if(process.platform==='win32'){t.skip('POSIX fake Java executable is used by this test');return;}
 const f=await fixture(t),hprof=join(f.root,'sample with spaces.hprof'),mapping=join(f.root,'mapping file.txt');await writeFile(hprof,heap);await writeFile(mapping,'');
 const result=await analyzeWithShark(hprof,f.resources,{mappingPath:mapping});
 assert.equal(result.success,true);assert.match(result.report,/HEAP ANALYSIS RESULT/);assert.match(result.report,new RegExp(hprof.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));assert.match(result.report,new RegExp(mapping.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
 await assert.rejects(()=>analyzeWithShark(hprof,f.resources,{mappingPath:'x'.repeat(4097)}),/映射路径无效/);
});

test('Shark retains the full report for export while limiting the on-screen excerpt',async t=>{
 if(process.platform==='win32'){t.skip('POSIX fake Java executable is used by this test');return;}
 const f=await fixture(t),hprof=join(f.root,'large report.hprof');await writeFile(hprof,heap);
 await writeFile(f.java,"#!/usr/bin/env node\nprocess.stdout.write('HEAP ANALYSIS RESULT\\n');process.stdout.write('x'.repeat(2*1024*1024+64));process.stdout.write('\\nEND OF REPORT\\n');\n");await chmod(f.java,0o700);
 const result=await analyzeWithShark(hprof,f.resources);assert.equal(result.success,true);assert.ok(result.reportTruncated);assert.equal(result.reportComplete,true);assert.ok(result.report.length>result.displayLimit);assert.ok(result.report.endsWith('END OF REPORT\n'));
 const json=JSON.parse(sharkReportJson(result,{sourceFileName:'sample.hprof',mappingFileName:'mapping.txt'}));assert.equal(json.type,'android-performance-shark-report');assert.equal(json.sourceFileName,'sample.hprof');assert.equal(json.mappingFileName,'mapping.txt');assert.equal(json.report,result.report);assert.equal(json.reportComplete,true);
 assert.throws(()=>sharkReportJson({report:'x'.repeat(12*1024*1024+1)}),/超过导出限制/);
});

test('HTTP Shark analysis is bound to the current retained HPROF session',async t=>{
 if(process.platform==='win32'){t.skip('POSIX fake Java executable is used by this test');return;}
 const f=await fixture(t),app=createApp({adb:{path:'adb'},token:'test',sharkDir:join(f.root,'shark-cli'),sharkJavaPath:f.java});
 app.listen(0,'127.0.0.1');await once(app,'listening');t.after(()=>new Promise(resolve=>app.close(resolve)));
 const base=`http://127.0.0.1:${app.address().port}/api`,headers={'X-Workbench-Token':'test'};
 const uploaded=await fetch(`${base}/heap/analyze`,{method:'POST',headers,body:heap}),session=await uploaded.json();assert.equal(uploaded.status,200);assert.equal(session.sharkAvailable,true);
 const mapping=Buffer.from('com.example.Screen -> a:\n    void draw() -> b\n');
 const mapped=await fetch(`${base}/heap/mapping`,{method:'POST',headers:{...headers,'X-Heap-Session':session.sessionId,'X-Heap-Mapping-Name':encodeURIComponent('mapping.txt')},body:mapping}),mappingResult=await mapped.json();
 assert.equal(mapped.status,200,JSON.stringify(mappingResult));assert.equal(mappingResult.size,mapping.length);assert.equal(mappingResult.fileName,'mapping.txt');
 const analysis=await fetch(`${base}/heap/shark-analysis`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({sessionId:session.sessionId})}),result=await analysis.json();
 assert.equal(analysis.status,200,JSON.stringify(result));assert.equal(result.success,true);assert.match(result.report,/HEAP ANALYSIS RESULT/);assert.match(result.report,/-m/);assert.match(result.report,/mapping-[\w-]+\.txt/);
 const cleared=await fetch(`${base}/heap/mapping/clear`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({sessionId:session.sessionId})});assert.equal(cleared.status,200);assert.equal((await cleared.json()).cleared,true);
 const invalid=await fetch(`${base}/heap/mapping`,{method:'POST',headers:{...headers,'X-Heap-Session':session.sessionId,'X-Heap-Mapping-Name':encodeURIComponent('bad.bin')},body:mapping});assert.equal(invalid.status,400);
 const stale=await fetch(`${base}/heap/shark-analysis`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({sessionId:'stale'})});assert.equal(stale.status,400);
});

test('official Android HPROF is analyzed by the prepared Shark CLI',async t=>{
 const sample=process.env.APW_SHARK_SAMPLE;if(!sample){t.skip('设置 APW_SHARK_SAMPLE 指向官方 Android HPROF 样本');return;}
 const resources=await resolveSharkResources({sharkDir:resolve(root,process.env.APW_SHARK_DIR||'tools/shark-cli'),javaPath:resolve(root,process.env.APW_SHARK_JAVA||'tools/java-runtime/bin/java')});
 const result=await analyzeWithShark(sample,resources,{mappingPath:process.env.APW_SHARK_MAPPING||null});assert.equal(result.available,true);assert.equal(result.success,true,result.reason||result.report);assert.match(result.report,/HEAP ANALYSIS RESULT/);
});
