import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from '../src/server.js';

test('CPU archive preserves perf bytes and rejects corrupt or invalid inputs',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'apw-cpu-archive-'));
 let app=createApp({adb:{path:'fake'},token:'test',dataDir:dir});app.listen(0,'127.0.0.1');await once(app,'listening');
 t.after(async()=>{await new Promise(resolve=>app.close(resolve));await rm(dir,{recursive:true,force:true});});
 let base=`http://127.0.0.1:${app.address().port}/api`;const headers={'X-Workbench-Token':'test'},file=Buffer.from('PERFILE2real-sample');
 const upload=async body=>fetch(base+'/cpu-profile/archive',{method:'POST',headers:{...headers,'X-File-Name':'sample.perf.data.trace'},body});
 assert.equal((await upload(Buffer.from('not-perf'))).status,400);
 const saved=await upload(file);assert.equal(saved.status,201);const archive=await saved.json();
 await new Promise(resolve=>app.close(resolve));app=createApp({adb:{path:'fake'},token:'test',dataDir:dir});app.listen(0,'127.0.0.1');await once(app,'listening');base=`http://127.0.0.1:${app.address().port}/api`;
 const list=await (await fetch(base+'/cpu-profile/archives',{headers})).json();assert.equal(list.archives.length,1);assert.equal(list.archives[0].id,archive.id);
 const load=()=>fetch(base+'/cpu-profile/archive/load',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({id:archive.id})});
 const loaded=await load();assert.equal(loaded.status,200);assert.deepEqual(Buffer.from(await loaded.arrayBuffer()),file);
 await writeFile(join(dir,'cpu-archives',archive.id,'artifact'),'tampered');const corrupt=await load();assert.equal(corrupt.status,400);assert.match((await corrupt.json()).error,/完整性/);
});
