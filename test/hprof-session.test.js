import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createApp} from '../src/server.js';
const n4=n=>{const b=Buffer.alloc(4);b.writeUInt32BE(n);return b;};
const record=(tag,bytes)=>Buffer.concat([Buffer.from([tag]),n4(0),n4(bytes.length),bytes]);
const heap=Buffer.concat([Buffer.from('JAVA PROFILE 1.0.3\0'),n4(4),Buffer.alloc(8),record(0x1c,Buffer.concat([Buffer.from([0x23]),n4(4),n4(0),n4(3),Buffer.from([8,1,2,3])])),record(0x2c,Buffer.alloc(0))]);
test('heap sessions support indexed queries, preserve old session on failure and invalidate it on replacement',async()=>{
 const app=createApp({adb:{path:'adb'},token:'test'});app.listen(0,'127.0.0.1');await once(app,'listening');
 const base=`http://127.0.0.1:${app.address().port}/api`;const headers={'X-Workbench-Token':'test'};
 const upload=async body=>{const r=await fetch(`${base}/heap/analyze`,{method:'POST',headers,body});return [r,await r.json()];};
 const query=async (path,body)=>{const r=await fetch(`${base}/heap/${path}`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)});return [r,await r.json()];};
 try {
  const [a,first]=await upload(heap);assert.equal(a.status,200,JSON.stringify(first));assert.equal(first.indexedObjects,1);
  const [b,page]=await query('instances',{sessionId:first.sessionId,classId:'primitive:8',offset:0,limit:100});assert.equal(b.status,200);assert.equal(page.items[0].id,'00000004');
  const [bitmapStatus,bitmaps]=await query('bitmaps',{sessionId:first.sessionId,offset:0,limit:100});assert.equal(bitmapStatus.status,200);assert.equal(bitmaps.total,0);
  const [stringStatus,strings]=await query('string-duplicates',{sessionId:first.sessionId});assert.equal(stringStatus.status,200);assert.deepEqual(strings.groups,[]);assert.equal((await query('string-duplicates',{sessionId:'stale'}))[0].status,400);
  const [searchStatus,search]=await query('string-search',{sessionId:first.sessionId,query:'example'});assert.equal(searchStatus.status,200);assert.deepEqual(search.items,[]);assert.equal((await query('string-search',{sessionId:first.sessionId,query:''}))[0].status,400);
  const [c,item]=await query('object',{sessionId:first.sessionId,id:'00000004',offset:1,limit:1});assert.equal(c.status,200);assert.equal(item.className,'byte[]');assert.equal(item.valueOffset,1);assert.deepEqual(item.values,[2]);
  const baseResponse=await fetch(`${base}/heap/analyze`,{method:'POST',headers:{...headers,'X-Heap-Role':'baseline'},body:heap});
  const baseline=await baseResponse.json();assert.equal(baseResponse.status,200,JSON.stringify(baseline));assert.equal(baseline.indexedObjects,null);assert.equal(baseline.sessionId,undefined);
  const [afterBaseline]=await query('object',{sessionId:first.sessionId,id:'00000004'});assert.equal(afterBaseline.status,200);
  const [pathStatus,path]=await query('root-path',{sessionId:first.sessionId,id:'00000004'});assert.equal(pathStatus.status,200);assert.equal(path.found,false);assert.equal(path.incomplete,true);
  const [incomingStatus,incoming]=await query('incoming',{sessionId:first.sessionId,id:'00000004'});assert.equal(incomingStatus.status,200);assert.deepEqual(incoming.items,[]);assert.equal((await query('incoming',{sessionId:'stale',id:'00000004'}))[0].status,400);
  const [bad]=await upload(Buffer.from('bad'));assert.equal(bad.status,400);
  const [still]=await query('object',{sessionId:first.sessionId,id:'00000004'});assert.equal(still.status,200);
  const [d,second]=await upload(heap);assert.equal(d.status,200);assert.notEqual(second.sessionId,first.sessionId);
  const [stale]=await query('object',{sessionId:first.sessionId,id:'00000004'});assert.equal(stale.status,400);
 } finally {app.close();await once(app,'close');}
});
test('heap session exposes indexed dominator graph via worker',async()=>{
 const bytes=Buffer.concat([Buffer.from('JAVA PROFILE 1.0.3\0'),n4(4),Buffer.alloc(8),record(0x1c,Buffer.concat([Buffer.from([0x23]),n4(4),n4(0),n4(3),Buffer.from([8,1,2,3]),Buffer.from([0xff]),n4(4)])),record(0x2c,Buffer.alloc(0))]);
 const app=createApp({adb:{path:'adb'},token:'test'});app.listen(0,'127.0.0.1');await once(app,'listening');const base=`http://127.0.0.1:${app.address().port}/api`,headers={'X-Workbench-Token':'test'};
 try{
  const uploaded=await fetch(`${base}/heap/analyze`,{method:'POST',headers,body:bytes});const session=await uploaded.json();assert.equal(uploaded.status,200);
  const result=await fetch(`${base}/heap/dominators`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({sessionId:session.sessionId,excludeNonStrong:true})});assert.equal(result.status,200);const tree=await result.json();assert.equal(tree.items[0].id,'00000004');assert.equal(tree.items[0].recordedPayloadBytes,3);assert.equal(tree.incomplete,false);assert.equal(tree.excludeNonStrong,true);
 }finally{app.close();await once(app,'close');}
});

test('public Android heap works through indexed HTTP session',async t=>{
 const path=process.env.APW_ANDROID_HPROF;if(!path){t.skip('设置 APW_ANDROID_HPROF 指向公开 Android 测试堆');return;}
 const {readFile}=await import('node:fs/promises');const app=createApp({adb:{path:'adb'},token:'test'});app.listen(0,'127.0.0.1');await once(app,'listening');t.after(()=>new Promise(resolve=>app.close(resolve)));
 const base=`http://127.0.0.1:${app.address().port}/api`,headers={'X-Workbench-Token':'test'};
 const upload=await fetch(base+'/heap/analyze',{method:'POST',headers,body:await readFile(path)});assert.equal(upload.status,200);const snapshot=await upload.json();assert.equal(snapshot.objects,41754);
 const bitmap=await fetch(base+'/heap/bitmaps',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({sessionId:snapshot.sessionId,offset:0,limit:1})});assert.equal(bitmap.status,200);const page=await bitmap.json();assert.equal(page.total,52);assert.equal(page.items[0].bufferLength,11264);
 const duplicate=await fetch(base+'/heap/bitmap-duplicates',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({sessionId:snapshot.sessionId})});assert.equal(duplicate.status,200);const groups=await duplicate.json();assert.equal(groups.scanned,52);assert.equal(groups.unavailable,0);
 const activities=await fetch(base+'/heap/destroyed-activities',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({sessionId:snapshot.sessionId})});assert.equal(activities.status,200);assert.equal((await activities.json()).destroyed,1);
});
