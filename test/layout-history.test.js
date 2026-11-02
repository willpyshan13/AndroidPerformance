import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../src/server.js';
import {compareLayouts} from '../public/offline.js';

test('two layout snapshots survive archive round-trip and remain comparable',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'apw-layout-history-'));
 const app=createApp({adb:{path:'adb'},dataDir:dir,token:'test'});app.listen(0,'127.0.0.1');await once(app,'listening');t.after(async()=>{await new Promise(resolve=>app.close(resolve));await rm(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${app.address().port}/api`,headers={'X-Workbench-Token':'test','Content-Type':'application/json'};
 const payload=text=>({source:'import',timestamp:42,xml:`<hierarchy><node package="app" resource-id="app:id/title" text="${text}"/></hierarchy>`,screenshot:null});
 const save=async p=>{const response=await fetch(base+'/sessions',{method:'POST',headers,body:JSON.stringify({kind:'layout',source:'import',name:'布局',payload:p})});assert.equal(response.status,201);return response.json();};
 const first=await save(payload('before')),second=await save(payload('after'));const list=await (await fetch(base+'/sessions',{headers})).json();assert.equal(list.sessions.filter(x=>x.kind==='layout').length,2);
 const left=await (await fetch(base+'/sessions/'+first.id,{headers})).json(),right=await (await fetch(base+'/sessions/'+second.id,{headers})).json();
 assert.deepEqual(left.payload,payload('before'));assert.deepEqual(right.payload,payload('after'));
 const node=xml=>({id:0,depth:0,attributes:Object.fromEntries([...xml.matchAll(/(package|resource-id|text)="([^"]*)"/g)].map(m=>[m[1],m[2]]))});
 const diff=compareLayouts([node(left.payload.xml)],[node(right.payload.xml)]);assert.deepEqual(diff.changes[0].fields,['text']);assert.equal(diff.changes[0].after.id,0);
});
