import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {readFile,access} from 'node:fs/promises';
import {createApp} from '../src/server.js';
import {request} from 'node:http';

test('APK binary upload bypasses the 12 MB JSON limit, retains Unicode filename, and removes temporary APK',async t=>{
  let tempPath;
  const app=createApp({adb:{path:'fixture'},token:'apk-test',apkAnalyzer:async(path,options)=>{tempPath=path;const bytes=await readFile(path);return {bytes:bytes.length,name:options.fileName};}});
  app.listen(0,'127.0.0.1');await once(app,'listening');t.after(()=>new Promise(r=>app.close(r)));
  const base=`http://127.0.0.1:${app.address().port}`,headers={'X-Workbench-Token':'apk-test','X-APK-Name':encodeURIComponent('本机应用.apk'),'Content-Type':'application/octet-stream'};
  const response=await fetch(base+'/api/apk/analyze',{method:'POST',headers,body:Buffer.alloc(13*1024*1024,42)});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{bytes:13*1024*1024,name:'本机应用.apk'});await assert.rejects(access(tempPath));
  assert.equal((await fetch(base+'/api/apk/analyze',{method:'POST',headers:{...headers,'X-APK-Name':'other.zip'},body:'test'})).status,400);
  assert.equal((await fetch(base+'/api/apk/analyze',{method:'POST',headers,body:''})).status,400);
});
test('APK analysis errors clean temporary files and release the singleton analysis lock',async t=>{
  let tempPath,calls=0;
  const app=createApp({adb:{path:'fixture'},token:'apk-test',apkAnalyzer:async path=>{tempPath=path;if(calls++===0)throw new Error('invalid APK fixture');return {ok:true};}});
  app.listen(0,'127.0.0.1');await once(app,'listening');t.after(()=>new Promise(r=>app.close(r)));
  const base=`http://127.0.0.1:${app.address().port}/api/apk/analyze`,headers={'X-Workbench-Token':'apk-test','X-APK-Name':'fixture.apk'};
  assert.equal((await fetch(base,{method:'POST',headers,body:'fixture'})).status,400);await assert.rejects(access(tempPath));
  const response=await fetch(base,{method:'POST',headers,body:'fixture'});assert.equal(response.status,200);assert.equal((await response.json()).ok,true);
});
test('APK upload rejects declared sizes over 512 MB before reading or analyzing the body',async t=>{
  let calls=0;const app=createApp({adb:{path:'fixture'},token:'apk-test',apkAnalyzer:async()=>{calls++;}});
  app.listen(0,'127.0.0.1');await once(app,'listening');t.after(()=>new Promise(r=>app.close(r)));
  const status=await new Promise((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port:app.address().port,path:'/api/apk/analyze',method:'POST',headers:{'X-Workbench-Token':'apk-test','Content-Length':512*1024*1024+1,Connection:'close'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});
  assert.equal(status,413);assert.equal(calls,0);
});
test('second APK request is rejected while analysis is running, without affecting the first',async t=>{
  let release,started;const ready=new Promise(r=>started=r);
  const app=createApp({adb:{path:'fixture'},token:'apk-test',apkAnalyzer:async()=>{started();return new Promise(r=>release=()=>r({ok:true}));}});
  app.listen(0,'127.0.0.1');await once(app,'listening');t.after(()=>new Promise(r=>app.close(r)));
  const url=`http://127.0.0.1:${app.address().port}/api/apk/analyze`,options={method:'POST',headers:{'X-Workbench-Token':'apk-test'},body:'fixture'};
  const first=fetch(url,options);await ready;
  const second=await fetch(url,options);assert.equal(second.status,409);release();assert.equal((await first).status,200);
});
