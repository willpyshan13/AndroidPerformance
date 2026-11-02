import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createApp} from '../src/server.js';

test('GPU artifact import persists, verifies, hands traces to analyzer and rejects modified files',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'apw-gpu-test-'));
 const app=createApp({adb:{path:'adb'},dataDir:dir,token:'token'});app.listen(0,'127.0.0.1');await once(app,'listening');
 t.after(async()=>{await new Promise(r=>app.close(r));await rm(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${app.address().port}`,headers={'X-Workbench-Token':'token'};
 const raw=await readFile(new URL('../fixtures/trace-sched.txt',import.meta.url));
 const post=(path,body)=>fetch(base+path,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const response=await fetch(base+'/api/gpu/import',{method:'POST',headers:{...headers,'X-File-Name':encodeURIComponent('测试.trace')},body:raw});assert.equal(response.status,201);const artifact=await response.json();assert.equal(artifact.name,'测试.trace');
 assert.equal((await (await fetch(base+'/api/gpu/artifacts',{headers})).json()).artifacts.length,1);
 assert.equal((await (await post('/api/gpu/verify',{id:artifact.id})).json()).ok,true);
 const opened=await post('/api/gpu/trace',{id:artifact.id});assert.equal(opened.status,200);const trace=await opened.json();assert.ok(trace.sessionId);assert.ok(trace.schedEvents.length);
 const result=await fetch(base+`/api/gpu/artifacts/${artifact.id}/file`,{headers});assert.deepEqual(Buffer.from(await result.arrayBuffer()),raw);
 await writeFile(join(dir,'gpu-artifacts',artifact.id,'artifact'),'corrupted');
 assert.equal((await (await post('/api/gpu/verify',{id:artifact.id})).json()).ok,false);
 assert.equal((await post('/api/gpu/trace',{id:artifact.id})).status,400);
 assert.equal((await fetch(base+`/api/gpu/artifacts/${artifact.id}/file`,{headers})).status,400);
 assert.equal((await post('/api/gpu/verify',{id:'../escape'})).status,400);
 const bad=await fetch(base+'/api/gpu/import',{method:'POST',headers:{...headers,'X-File-Name':'bad.exe'},body:'hello'});assert.equal(bad.status,400);
});

test('GPU capabilities preserve missing or failing evidence without inferring AGI support',async()=>{
 const {parseGpuCapabilities}=await import('../src/gpu.js');const {Adb}=await import('../src/adb.js');
 const parsed=parseGpuCapabilities('feature:android.hardware.vulkan.version=4198400\nfeature:android.hardware.vulkan.level=1\nfeature:android.hardware.opengles.aep\n','196610\n');
 assert.equal(parsed.vulkanVersion,'1.1.0');assert.equal(parsed.glesVersion,'3.2');assert.equal(parsed.vulkanLevel,'feature:android.hardware.vulkan.level=1');
 const missing=parseGpuCapabilities('Permission denied','0');assert.equal(missing.featureListAvailable,false);assert.equal(missing.vulkanVersion,null);assert.equal(missing.glesVersion,null);
 const duplicate=parseGpuCapabilities('feature:android.hardware.vulkan.version=4198400\nfeature:android.hardware.vulkan.version=1','x');assert.equal(duplicate.vulkanVersion,null);
 const adb=new Adb('adb',async(_path,args)=>{if(args.includes("'pm'"))throw new Error('permission');return {stdout:'196608'};});
 const result=await adb.gpuCapabilities('serial-1');assert.equal(result.glesVersion,'3.0');assert.equal(result.featureListAvailable,false);assert.match(result.warnings[0],/读取失败/);
});

test('GPU capability HTTP endpoint uses requested device',async t=>{
 const app=createApp({adb:{path:'fake',gpuCapabilities:async serial=>({serial,glesVersion:'3.2'})},token:'test'});app.listen(0,'127.0.0.1');await once(app,'listening');t.after(()=>new Promise(resolve=>app.close(resolve)));
 const result=await fetch(`http://127.0.0.1:${app.address().port}/api/gpu/capabilities`,{method:'POST',headers:{'X-Workbench-Token':'test','Content-Type':'application/json'},body:JSON.stringify({serial:'abc'})});assert.equal(result.status,200);assert.deepEqual(await result.json(),{serial:'abc',glesVersion:'3.2'});
});

test('AGI handoff creates a private extension-preserving copy only after checksum verification',async t=>{
 const {Readable}=await import('node:stream');const {stat}=await import('node:fs/promises');const {importGpuArtifact,prepareAgiArtifact}=await import('../src/gpu.js');
 const dir=await mkdtemp(join(tmpdir(),'apw-agi-'));t.after(()=>rm(dir,{recursive:true,force:true}));const root=join(dir,'index'),copies=join(dir,'copies');
 const stream=Readable.from([Buffer.from('capture contents')]);stream.headers={'x-file-name':'test.gfxtrace'};const meta=await importGpuArtifact(stream,root);
 const result=await prepareAgiArtifact(root,copies,meta.id);assert.match(result.path,/capture\.gfxtrace$/);assert.equal((await readFile(result.path)).toString(),'capture contents');assert.equal((await stat(result.path)).mode&0o777,0o600);
 await writeFile(join(root,meta.id,'artifact'),'altered');await assert.rejects(()=>prepareAgiArtifact(root,copies,meta.id),/完整性/);
 const {readdir}=await import('node:fs/promises');assert.equal((await readdir(copies)).length,1);await assert.rejects(()=>prepareAgiArtifact(root,copies,'../bad'),/标识/);
});
