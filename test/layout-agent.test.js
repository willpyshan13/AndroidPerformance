import {test} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {createHash} from 'node:crypto';
import {captureLayoutFromAgent} from '../src/layout-agent.js';
import {buildLayoutAgentPackage} from '../src/agent-package.js';
import {once} from 'node:events';
import {default as yauzl} from 'yauzl';
import {readFile} from 'node:fs/promises';
import {createApp} from '../src/server.js';

const serial='device-123',packageName='com.example.app',token='a'.repeat(48);
const socketName=`apw-layout-${createHash('sha256').update(packageName).digest('hex').slice(0,24)}`;
const png=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(png);png.writeUInt32BE(1080,16);png.writeUInt32BE(1920,20);

async function harness(t,response){
 const server=net.createServer(socket=>{let request='';socket.on('data',chunk=>{request+=chunk.toString();if(request.includes('\n')){const parsed=JSON.parse(request);assert.equal(parsed.action,'capture');assert.equal(parsed.token,token);socket.end(JSON.stringify(response)+'\n');}});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 let removed=false;const adb={run:async args=>{if(args.includes('--remove')){removed=true;return '';}assert.deepEqual(args,['-s',serial,'forward','tcp:0',`localabstract:${socketName}`]);return String(port);},shell:async(s,args)=>{assert.equal(s,serial);assert.deepEqual(args,['wm','density']);return 'Physical density: 420\nOverride density: 440';}};
 t.after(()=>new Promise(resolve=>server.close(resolve)));return {adb,get removed(){return removed;}};
}

test('layout debug agent forwards a read-only View snapshot and always removes ADB forwarding',async t=>{
 const h=await harness(t,{ok:true,xml:'<hierarchy><node class="android.view.View" bounds="[0,0][1080,1920]"/></hierarchy>',screenshot:png.toString('base64'),truncated:false});
 const result=await captureLayoutFromAgent(h.adb,serial,packageName,token);
 assert.equal(result.source,'agent');assert.equal(result.imageSize.width,1080);assert.equal(result.imageSize.height,1920);assert.equal(result.densityDpi,440);assert.equal(result.truncated,false);assert.equal(result.composeHosts,0);assert.equal(result.composeNodes,0);assert.match(result.note,/不读取 State 值/);assert.match(result.xml,/<hierarchy/);assert.equal(h.removed,true);
});

test('layout agent reports Compose Semantics counts and runtime incompatibility',async t=>{
 const h=await harness(t,{ok:true,xml:'<hierarchy><node class="ComposeSemanticsNode" compose-tree="merged" text="Hello"/></hierarchy>',screenshot:null,composeHosts:1,composeNodes:7,composeWarning:true});
 const result=await captureLayoutFromAgent(h.adb,serial,packageName,token);
 assert.equal(result.composeHosts,1);assert.equal(result.composeNodes,7);assert.match(result.warning,/Compose 宿主/);assert.match(result.note,/7 个 Compose Semantics 节点/);
});

test('layout agent reports runtime group and per-scope state-read relationship counts',async t=>{
 const xml='<hierarchy><node class="ComposeRuntimeTree"><node class="ComposeRuntimeGroup" compose-key="-1" compose-state-read-count="2"/></node></hierarchy>';
 const h=await harness(t,{ok:true,xml,screenshot:png.toString('base64'),composeHosts:1,composeNodes:4,composeRuntimeGroups:30,composeStateReads:7,composeStateReadsAvailable:true,composeRuntimeWarning:false});
 const result=await captureLayoutFromAgent(h.adb,serial,packageName,token);
 assert.equal(result.composeRuntimeGroups,30);assert.equal(result.composeStateReads,7);assert.equal(result.composeStateReadsAvailable,true);assert.match(result.note,/30 个组合组和 7 条 State 读取关联/);assert.match(result.note,/不会通过强制重组/);assert.equal(result.warning,null);assert.match(result.xml,/compose-state-read-count="2"/);
});

test('layout agent reports unavailable State observations instead of zero',async t=>{
 const h=await harness(t,{ok:true,xml:'<hierarchy/>',screenshot:png.toString('base64'),composeHosts:1,composeStateReads:0,composeStateReadsAvailable:false,composeStateReadsWarning:true});
 const result=await captureLayoutFromAgent(h.adb,serial,packageName,token);assert.equal(result.composeStateReadsAvailable,false);assert.match(result.note,/State 读取关联不可用/);assert.match(result.warning,/State 观察关联不可用/);
});

test('layout agent distinguishes secure screenshots and reports truncated trees',async t=>{
 const h=await harness(t,{ok:true,xml:'<hierarchy/>',screenshot:null,warning:'Secure window',truncated:true});
 const result=await captureLayoutFromAgent(h.adb,serial,packageName,token);assert.equal(result.screenshot,null);assert.equal(result.truncated,true);assert.match(result.warning,/Secure window/);assert.match(result.warning,/采集上限/);
});

test('layout agent validates token, protocol and returned XML without leaving a forward',async t=>{
 const h=await harness(t,{ok:false,error:'Token rejected'});
 await assert.rejects(captureLayoutFromAgent(h.adb,serial,packageName,'short'),/32–256/);assert.equal(h.removed,false);
 await assert.rejects(captureLayoutFromAgent(h.adb,serial,packageName,token),/Token rejected/);assert.equal(h.removed,true);
});

test('downloadable View Agent ZIP contains the Java source and lifecycle guide',async()=>{
 const archive=await buildLayoutAgentPackage();
 const entries=await new Promise((resolve,reject)=>yauzl.fromBuffer(archive,{lazyEntries:true},(err,zip)=>{if(err)return reject(err);const files={};zip.on('error',reject);zip.on('end',()=>resolve(files));zip.on('entry',entry=>zip.openReadStream(entry,(error,stream)=>{if(error)return reject(error);const chunks=[];stream.on('data',chunk=>chunks.push(chunk));stream.on('error',reject);stream.on('end',()=>{files[entry.fileName]=Buffer.concat(chunks);zip.readEntry();});}));zip.readEntry();}));
 const paths=['LAYOUT_AGENT_README.md','src/main/java/dev/androidperformance/agent/LayoutAgent.java','src/main/kotlin/dev/androidperformance/agent/ApwComposeRecompositionProbe.kt','src/main/kotlin/dev/androidperformance/agent/ApwComposeAutomaticProbe.kt','compose-compiler-plugin/settings.gradle.kts','compose-compiler-plugin/build.gradle.kts','compose-compiler-plugin/src/main/resources/META-INF/services/org.jetbrains.kotlin.compiler.plugin.CompilerPluginRegistrar','compose-compiler-plugin/src/main/java/dev/androidperformance/compiler/IrCalls.java','compose-compiler-plugin/src/main/kotlin/dev/androidperformance/compiler/ApwComposeInstrumentationRegistrar.kt'];assert.deepEqual(Object.keys(entries).sort(),paths.slice().sort());
 for(const path of paths)assert.deepEqual(entries[path],await readFile(new URL('../android-agent/'+path,import.meta.url)));
 assert.match(entries['src/main/kotlin/dev/androidperformance/agent/ApwComposeRecompositionProbe.kt'].toString(),/@NonSkippableComposable/);
 assert.match(entries['src/main/kotlin/dev/androidperformance/agent/ApwComposeRecompositionProbe.kt'].toString(),/System\.nanoTime\(\).*\|U/);
 assert.match(entries['src/main/kotlin/dev/androidperformance/agent/ApwComposeAutomaticProbe.kt'].toString(),/apwComposeAutomaticEnter/);assert.match(entries['src/main/kotlin/dev/androidperformance/agent/ApwComposeAutomaticProbe.kt'].toString(),/apwComposeAutomaticExit/);
 assert.match(entries['src/main/kotlin/dev/androidperformance/agent/ApwComposeAutomaticProbe.kt'].toString(),/System\.nanoTime\(\).*\|U/);
});

test('protected layout Agent API forwards the shared token and returns an app snapshot',async t=>{
 const app=createApp({adb:{path:'fake',layoutAgent:async(serial,pkg,sharedToken)=>({serial,packageName:pkg,tokenWasForwarded:sharedToken===token,xml:'<hierarchy/>',screenshot:null,source:'agent'})},token:'workbench'});
 app.listen(0,'127.0.0.1');await once(app,'listening');t.after(()=>new Promise(resolve=>app.close(resolve)));
 const base=`http://127.0.0.1:${app.address().port}/api/layout/agent`,body=JSON.stringify({serial,packageName,token});
 assert.equal((await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body})).status,403);
 const response=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':'workbench'},body});assert.equal(response.status,200);const result=await response.json();assert.equal(result.tokenWasForwarded,true);assert.equal(result.source,'agent');
 const bundle=await fetch(`http://127.0.0.1:${app.address().port}/api/layout/agent-package`,{headers:{'X-Workbench-Token':'workbench'}});assert.equal(bundle.status,200);assert.equal(bundle.headers.get('content-type'),'application/zip');
});
