import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {readFile,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from '../src/server.js';
import {locateTraceProcessor} from '../src/trace-analysis.js';
test('trace sessions query windows and reject stale or out-of-range requests',async(t)=>{
 try{await locateTraceProcessor();}catch{t.skip('未准备 Trace Processor');return;}
 const app=createApp({adb:{path:'adb'},token:'test'});app.listen(0,'127.0.0.1');await once(app,'listening');const base=`http://127.0.0.1:${app.address().port}/api`,headers={'X-Workbench-Token':'test'},data=await readFile(new URL('../fixtures/trace-sample.json',import.meta.url));
 const upload=async()=>{const r=await fetch(`${base}/trace/analyze`,{method:'POST',headers,body:data});return [r,await r.json()];};
 const window=async body=>{const r=await fetch(`${base}/trace/window`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)});return [r,await r.json()];};
 try{
  const [firstStatus,first]=await upload();assert.equal(firstStatus.status,200);
  const exported=await fetch(`${base}/trace/export`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({sessionId:first.sessionId})});assert.equal(exported.status,200);assert.deepEqual(Buffer.from(await exported.arrayBuffer()),data);
  const startup=await fetch(`${base}/trace/startups`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({sessionId:first.sessionId})});assert.equal(startup.status,200);assert.deepEqual((await startup.json()).startups,[]);
  const noFrames=await fetch(`${base}/trace/frame-timeline`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({sessionId:first.sessionId})});assert.equal(noFrames.status,200);assert.deepEqual((await noFrames.json()).frames,[]);
  const noBinder=await fetch(`${base}/trace/binder`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({sessionId:first.sessionId})});assert.equal(noBinder.status,200);assert.deepEqual((await noBinder.json()).transactions,[]);
  const sql=await fetch(`${base}/trace/query`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({sessionId:first.sessionId,sql:'SELECT name, ts, dur FROM slice ORDER BY ts LIMIT 5'})});assert.equal(sql.status,200);const sqlResult=await sql.json();assert.deepEqual(sqlResult.columns,['name','ts','dur']);assert.ok(sqlResult.rows.some(row=>row[0]==='render'));assert.equal(sqlResult.sessionId,first.sessionId);
  const unsafeSql=await fetch(`${base}/trace/query`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({sessionId:first.sessionId,sql:'DELETE FROM slice'})});assert.equal(unsafeSql.status,400);
  const [status,result]=await window({sessionId:first.sessionId,startNs:'32000000',endNs:'46000000'});assert.equal(status.status,200);assert.deepEqual(result.sliceEvents.map(x=>x.name),['render','binder transaction']);assert.equal(result.viewBounds.startNs,'32000000');
  const sliceArgs=async(sliceId,sessionId=first.sessionId)=>fetch(base+'/trace/slice-arguments',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({sessionId,sliceId})});
  const args=await sliceArgs(result.sliceEvents[0].sliceId);assert.equal(args.status,200);assert.deepEqual((await args.json()).args,[]);assert.equal((await sliceArgs('1;DROP')).status,400);assert.equal((await sliceArgs('1','stale')).status,400);
  const [filteredStatus,filtered]=await window({sessionId:first.sessionId,startNs:'32000000',endNs:'46000000',trackFilter:'does-not-exist'});assert.equal(filteredStatus.status,200);assert.deepEqual(filtered.sliceEvents,[]);assert.equal(filtered.trackFilter,'does-not-exist');assert.deepEqual(filtered.slices,result.slices);
  const [sliceStatus,slice]=await window({sessionId:first.sessionId,startNs:'32000000',endNs:'46000000',sliceFilter:'RENDER'});assert.equal(sliceStatus.status,200);assert.deepEqual(slice.sliceEvents.map(x=>x.name),['render']);assert.equal(slice.sliceFilter,'RENDER');assert.deepEqual(slice.slices,result.slices);
  assert.equal((await window({sessionId:first.sessionId,startNs:'32000000',endNs:'46000000',sliceFilter:'x'.repeat(201)}))[0].status,400);
  assert.equal((await window({sessionId:first.sessionId,startNs:'32000000',endNs:'46000000',trackFilter:'x'.repeat(201)}))[0].status,400);
  assert.equal((await window({sessionId:first.sessionId,startNs:'0',endNs:'46000000'}))[0].status,400);
  assert.equal((await window({sessionId:first.sessionId,startNs:'1;DROP',endNs:'46000000'}))[0].status,400);
  const [secondStatus,second]=await upload();assert.equal(secondStatus.status,200);assert.notEqual(first.sessionId,second.sessionId);
  assert.equal((await window({sessionId:first.sessionId,startNs:'32000000',endNs:'46000000'}))[0].status,400);
  const staleExport=await fetch(`${base}/trace/export`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({sessionId:first.sessionId})});assert.equal(staleExport.status,400);
 }finally{app.close();await once(app,'close');}
});

test('self-hosted Perfetto UI serves pinned assets locally and exposes only the retained trace with a token',async t=>{
 try{await locateTraceProcessor();}catch{t.skip('未准备 Trace Processor');return;}
 const {mkdir}=await import('node:fs/promises'),uiDir=await mkdtemp(join(tmpdir(),'apw-perfetto-ui-test-'));
 await mkdir(join(uiDir,'v59.1-test'),{recursive:true});await writeFile(join(uiDir,'index.html'),'<!doctype html><title>local-perfetto-fixture</title>');await writeFile(join(uiDir,'v59.1-test','trace_processor.wasm'),Buffer.from([0,97,115,109]));
 const app=createApp({adb:{path:'adb'},token:'test',perfettoUiDir:uiDir});app.listen(0,'127.0.0.1');await once(app,'listening');t.after(async()=>{await new Promise(resolve=>app.close(resolve));await rm(uiDir,{recursive:true,force:true});});
 const origin=`http://127.0.0.1:${app.address().port}`,api=origin+'/api',headers={'X-Workbench-Token':'test'},data=await readFile(new URL('../fixtures/trace-sample.json',import.meta.url));
 const ui=await fetch(origin+'/perfetto-ui/index.html'),uiText=await ui.text();assert.equal(ui.status,200,uiText);assert.match(ui.headers.get('content-type'),/text\/html/);assert.match(ui.headers.get('content-security-policy'),/frame-ancestors 'self'/);assert.match(uiText,/local-perfetto-fixture/);
 const wasm=await fetch(origin+'/perfetto-ui/v59.1-test/trace_processor.wasm');assert.equal(wasm.headers.get('content-type'),'application/wasm');assert.deepEqual(Buffer.from(await wasm.arrayBuffer()),Buffer.from([0,97,115,109]));
 const status=await fetch(api+'/status',{headers});assert.equal((await status.json()).perfettoUiAvailable,true);
 const analyzed=await fetch(api+'/trace/analyze',{method:'POST',headers,body:data});assert.equal(analyzed.status,200);const session=await analyzed.json();assert.ok(session.sessionId);
 assert.equal((await fetch(api+'/trace/current')).status,403);const current=await fetch(api+'/trace/current',{headers});assert.equal(current.status,200);assert.deepEqual(Buffer.from(await current.arrayBuffer()),data);
});

test('trace archives survive sessions and reject corrupted bytes without replacing current session',async t=>{
 try{await locateTraceProcessor();}catch{t.skip('未准备 Trace Processor');return;}
 const dir=await mkdtemp(join(tmpdir(),'apw-trace-archive-')),app=createApp({adb:{path:'adb'},token:'test',dataDir:dir});app.listen(0,'127.0.0.1');await once(app,'listening');t.after(async()=>{await new Promise(resolve=>app.close(resolve));await rm(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${app.address().port}/api`,headers={'X-Workbench-Token':'test'},data=await readFile(new URL('../fixtures/trace-sample.json',import.meta.url));
 const post=async(path,body)=>fetch(base+path,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const initial=await (await fetch(base+'/trace/analyze',{method:'POST',headers,body:data})).json();
 const save=await post('/trace/archive',{sessionId:initial.sessionId,name:'样本.json'});assert.equal(save.status,201);const archive=await save.json();assert.equal((await (await fetch(base+'/trace/archives',{headers})).json()).archives.length,1);
 const named=await post('/trace/archive',{sessionId:initial.sessionId,name:'sample.perfetto-trace'});assert.equal(named.status,201);assert.equal((await named.json()).name,'sample.perfetto-trace');
 const loaded=await post('/trace/archive/load',{id:archive.id});assert.equal(loaded.status,200);const current=await loaded.json();assert.notEqual(current.sessionId,initial.sessionId);
 const exported=await post('/trace/export',{sessionId:current.sessionId});assert.deepEqual(Buffer.from(await exported.arrayBuffer()),data);
 await writeFile(join(dir,'trace-archives',archive.id,'artifact'),'tampered');const corrupt=await post('/trace/archive/load',{id:archive.id});assert.equal(corrupt.status,400);assert.match((await corrupt.json()).error,/完整性/);
 assert.equal((await post('/trace/export',{sessionId:current.sessionId})).status,200);assert.equal((await post('/trace/archive/load',{id:'../bad'})).status,400);
});

test('real Android startup trace is queryable through the retained HTTP session',async t=>{
 const path=process.env.APW_STARTUP_TRACE;if(!path){t.skip('设置 APW_STARTUP_TRACE 指向 Perfetto 官方 Android 样本');return;}
 const app=createApp({adb:{path:'adb'},token:'test'});app.listen(0,'127.0.0.1');await once(app,'listening');t.after(()=>new Promise(resolve=>app.close(resolve)));
 const base=`http://127.0.0.1:${app.address().port}/api`,headers={'X-Workbench-Token':'test'};
 const uploaded=await fetch(base+'/trace/analyze',{method:'POST',headers,body:await readFile(path)});assert.equal(uploaded.status,200);const session=await uploaded.json();
 const result=await fetch(base+'/trace/startups',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({sessionId:session.sessionId,packageName:'androidx.benchmark.integration.macrobenchmark.target'})});assert.equal(result.status,200);
 const rows=(await result.json()).startups;assert.equal(rows.length,1);assert.equal(rows[0].ttidNs,'143980066');assert.equal(rows[0].ttfdNs,'620815843');
 const states=await fetch(base+'/trace/thread-states',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({sessionId:session.sessionId,tid:626,startNs:session.bounds.startNs,endNs:session.bounds.endNs})});assert.equal(states.status,200);assert.ok((await states.json()).summary.length>0);
 const frameResponse=await fetch(base+'/trace/frame-timeline',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({sessionId:session.sessionId,packageName:'androidx.benchmark.integration.macrobenchmark.target'})});const frame=(await frameResponse.json()).frames[0];
 const frameStates=await fetch(base+'/trace/frame-thread-states',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({sessionId:session.sessionId,upid:frame.processId,startNs:frame.tsNs,endNs:String(BigInt(frame.tsNs)+BigInt(frame.durationNs))})});assert.equal(frameStates.status,200);const frameData=await frameStates.json();assert.ok(frameData.summary.length>0);assert.ok(frameData.summary.every(row=>row.process==='androidx.benchmark.integration.macrobenchmark.target'));
 const selected=frameData.summary.find(x=>x.thread==='RenderThread'&&x.state==='Running');assert.ok(selected);const frameDetail=await fetch(base+'/trace/frame-thread-states',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({sessionId:session.sessionId,upid:frame.processId,utid:selected.utid,state:selected.state,startNs:frame.tsNs,endNs:String(BigInt(frame.tsNs)+BigInt(frame.durationNs))})});assert.equal(frameDetail.status,200);const detailRows=await frameDetail.json();assert.ok(detailRows.intervals.length>0);assert.ok(detailRows.intervals.every(x=>x.utid===selected.utid&&x.state==='Running'));assert.equal(detailRows.summary[0].durationNs,selected.durationNs);
 const escapedState=await fetch(base+'/trace/frame-thread-states',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({sessionId:session.sessionId,upid:frame.processId,utid:selected.utid,state:"R' OR 1=1 --",startNs:frame.tsNs,endNs:String(BigInt(frame.tsNs)+BigInt(frame.durationNs))})});assert.equal(escapedState.status,200);assert.deepEqual((await escapedState.json()).intervals,[]);
 const badFrame=await fetch(base+'/trace/frame-thread-states',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({sessionId:session.sessionId,upid:'1;DROP',startNs:frame.tsNs,endNs:String(BigInt(frame.tsNs)+BigInt(frame.durationNs))})});assert.equal(badFrame.status,400);
 const breakdown=await fetch(base+'/trace/startup-breakdown',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({sessionId:session.sessionId,startupId:rows[0].id})});assert.equal(breakdown.status,200);assert.ok((await breakdown.json()).summary.some(row=>row.reason==='binder'));
 const binder=await fetch(base+'/trace/binder',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({sessionId:session.sessionId})});assert.equal(binder.status,200);const transactions=await binder.json();assert.equal(transactions.transactions.length,500);assert.equal(transactions.truncated,true);assert.equal(transactions.transactions[0].client,'cmd');assert.equal(transactions.transactions[0].server,'system_server');assert.equal(transactions.transactions[0].durationNs,'149306525');
 const binderQuery=async body=>fetch(base+'/trace/binder',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({sessionId:session.sessionId,...body})});
 const clientFiltered=await binderQuery({packageName:'com.breel.wallpapers19',direction:'client'});assert.equal(clientFiltered.status,200);const clientRows=(await clientFiltered.json()).transactions;assert.ok(clientRows.length>0);assert.ok(clientRows.every(x=>x.client==='com.breel.wallpapers19'||x.client.startsWith('com.breel.wallpapers19:')));
 const subproc=await binderQuery({packageName:'com.google.android.googlequicksearchbox',direction:'client'});assert.equal(subproc.status,200);assert.ok((await subproc.json()).transactions.some(x=>x.client==='com.google.android.googlequicksearchbox:search'));
 const serverFiltered=await binderQuery({packageName:'com.breel.wallpapers19',direction:'server'});assert.equal(serverFiltered.status,200);const serverRows=(await serverFiltered.json()).transactions;assert.ok(serverRows.every(x=>x.server==='com.breel.wallpapers19'||x.server.startsWith('com.breel.wallpapers19:')));
 assert.equal((await binderQuery({packageName:"com.example';DROP"})).status,400);assert.equal((await binderQuery({direction:'invalid'})).status,400);
 const binderDetail=await fetch(base+'/trace/binder-breakdown',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({sessionId:session.sessionId,id:transactions.transactions[0].id})});assert.equal(binderDetail.status,200);const detail=await binderDetail.json();assert.ok(detail.summary.some(x=>x.side==='server'&&x.reason==='S'&&x.durationNs==='134500014'));assert.ok(detail.intervals.length>0);
 const badBinder=await fetch(base+'/trace/binder-breakdown',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({sessionId:session.sessionId,id:'1;DROP'})});assert.equal(badBinder.status,400);
 const invalid=await fetch(base+'/trace/startup-breakdown',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({sessionId:session.sessionId,startupId:'1;DROP'})});assert.equal(invalid.status,400);
});
