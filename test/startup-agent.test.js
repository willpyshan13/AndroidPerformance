import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {once} from 'node:events';
import yauzl from 'yauzl';
import {buildStartupAgentPackage} from '../src/agent-package.js';
import {createApp} from '../src/server.js';
import {parseStartupAgentLog,startupAgentIterationEvidence} from '../src/startup-agent.js';
import {Adb} from '../src/adb.js';

async function archiveEntries(buffer) {
  return new Promise((resolve,reject)=>yauzl.fromBuffer(buffer,{lazyEntries:true},(error,zip)=>{
    if(error)return reject(error);const entries={};zip.on('error',reject);zip.on('end',()=>resolve(entries));zip.on('entry',entry=>zip.openReadStream(entry,(streamError,stream)=>{
      if(streamError)return reject(streamError);const chunks=[];stream.on('data',chunk=>chunks.push(chunk));stream.on('error',reject);stream.on('end',()=>{entries[entry.fileName]=Buffer.concat(chunks);zip.readEntry();});
    }));zip.readEntry();
  }));
}

test('Startup Debug Agent package contains lifecycle milestones, safe manifest and integration guide',async()=>{
  const entries=await archiveEntries(await buildStartupAgentPackage());
  assert.deepEqual(Object.keys(entries).sort(),[
    'STARTUP_AGENT_README.md',
    'src/debug/AndroidManifest.xml',
    'src/debug/java/dev/androidperformance/agent/ApwStartupAgent.java',
    'src/debug/java/dev/androidperformance/agent/ApwStartupAgentProvider.java',
  ].sort());
  const agent=entries['src/debug/java/dev/androidperformance/agent/ApwStartupAgent.java'].toString(),manifest=entries['src/debug/AndroidManifest.xml'].toString(),guide=entries['STARTUP_AGENT_README.md'].toString();
  assert.match(agent,/application-created/);assert.match(agent,/activity-created/);assert.match(agent,/activity-resumed/);assert.match(agent,/first-draw/);assert.match(agent,/fully-drawn/);assert.match(agent,/System\.nanoTime\(\)/);assert.match(agent,/APWS1\|/);assert.match(agent,/WeakReference<Activity>/);
  assert.match(manifest,/android:exported="false"/);assert.match(guide,/debug build/i);assert.match(guide,/not proof of user-visible readiness/i);
});

test('Startup Agent package endpoint is local-token protected',async t=>{
  const app=createApp({adb:{path:'fake'},token:'startup-agent-token'});app.listen(0,'127.0.0.1');await once(app,'listening');t.after(()=>new Promise(resolve=>app.close(resolve)));
  const url=`http://127.0.0.1:${app.address().port}/api/startup/agent-package`;
  assert.equal((await fetch(url)).status,403);
  const response=await fetch(url,{headers:{'X-Workbench-Token':'startup-agent-token'}});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/zip');
  assert.ok(Object.keys(await archiveEntries(Buffer.from(await response.arrayBuffer()))).includes('STARTUP_AGENT_README.md'));
});

test('Startup Agent parser validates PID/session identities and computes monotonic milestone intervals',()=>{
  const session='0123456789abcdef0123456789abcdef',activityId='abcdef0123456789abcdef0123456789',activity=Buffer.from('com.example.MainActivity').toString('base64url');
  const row=(name,time,pid=42,id=activityId,encoded=activity)=>`I/APWStartup( ${pid}): APWS1|${session}|${id}|${name}|${encoded}|${time}|${pid}`;
  const log=[row('agent-installed',900000000,'42','-','-'),row('application-created',910000000,'42','-','-'),row('activity-created',1000000000),row('activity-resumed',1020000000),row('first-draw',1090000000),row('fully-drawn',1200000000),row('activity-created',1300000000,77)].join('\n');
  const result=parseStartupAgentLog(log,{serial:'device-1',packageName:'com.example',pids:[42]});
  assert.equal(result.processSessionId,session);assert.equal(result.eventCount,6);assert.equal(result.ignored,1);assert.equal(result.activitySummaries.length,1);
  assert.equal(result.activitySummaries[0].activity,'com.example.MainActivity');assert.equal(result.activitySummaries[0].createdToResumedMs,20);assert.equal(result.activitySummaries[0].resumedToFirstDrawMs,70);assert.equal(result.activitySummaries[0].firstDrawToFullyDrawnMs,110);
  assert.equal(parseStartupAgentLog(row('first-draw',1),{pids:[100]}).eventCount,0);
  assert.throws(()=>parseStartupAgentLog('x'.repeat(8*1024*1024+1)),/8 MiB/);
});

test('Startup Agent iteration pairing uses a monotonic watermark and handles process restarts',()=>{
  const session='0123456789abcdef0123456789abcdef',next='abcdef0123456789abcdef0123456789',activityId='11111111111111111111111111111111';
  const event=(name,monotonicNs,processSessionId=session)=>({name,monotonicNs,processSessionId,activityId,activity:'com.example.MainActivity',pid:42});
  const before={processSessionId:session,events:[event('activity-resumed','100')]};
  const after={processSessionId:session,eventCount:3,events:[event('activity-resumed','100'),event('first-draw','120'),event('fully-drawn','150')]};
  const paired=startupAgentIterationEvidence(before,after);
  assert.equal(paired.available,true);assert.equal(paired.boundary,'monotonic-cursor');assert.deepEqual(paired.events.map(row=>row.name),['first-draw','fully-drawn']);assert.equal(paired.activitySummaries[0].resumedToFirstDrawMs,null);
  const restarted=startupAgentIterationEvidence(before,{processSessionId:next,events:[event('activity-created','10',next)]});
  assert.equal(restarted.available,true);assert.equal(restarted.boundary,'new-process-session');assert.equal(restarted.events[0].name,'activity-created');
  assert.equal(startupAgentIterationEvidence({error:'offline'},after).available,false);
  assert.equal(startupAgentIterationEvidence(before,{processSessionId:session,events:[]}).available,false);
  assert.throws(()=>startupAgentIterationEvidence(before,after,{limit:101}),/上限无效/);
});

test('Startup Agent read endpoint requires the local token and binds the selected package',async t=>{
  let captured=null;const app=createApp({adb:{path:'fake',startupAgentSnapshot:async(serial,packageName)=>{captured={serial,packageName};return {source:'agent',serial,packageName,events:[],activitySummaries:[]};}},token:'startup-agent-api'});
  app.listen(0,'127.0.0.1');await once(app,'listening');t.after(()=>new Promise(resolve=>app.close(resolve)));
  const url=`http://127.0.0.1:${app.address().port}/api/startup/agent`,body=JSON.stringify({serial:'device-1',packageName:'com.example'});
  assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body})).status,403);
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':'startup-agent-api'},body});
  assert.equal(response.status,200);assert.deepEqual(captured,{serial:'device-1',packageName:'com.example'});assert.equal((await response.json()).source,'agent');
});

test('ADB startup milestone snapshot resolves package PIDs and filters UID Logcat output back to those PIDs',async()=>{
  const session='11111111111111111111111111111111',activityId='22222222222222222222222222222222',activity=Buffer.from('com.example.MainActivity').toString('base64url'),calls=[];
  const log=[42,99].map(pid=>`I/APWStartup( ${pid}): APWS1|${session}|${activityId}|activity-created|${activity}|1000000000|${pid}`).join('\n');
  const adb=new Adb('adb',async(_path,args)=>{calls.push(args);const command=args.join(' ');if(command.includes("'cmd' 'package' 'list'"))return {stdout:'package:com.example uid:10123\n'};if(command.includes("'pidof' 'com.example'"))return {stdout:'42 43\n'};if(command.includes("'--uid=10123'"))return {stdout:log};throw new Error('unexpected ADB command: '+command);});
  const result=await adb.startupAgentSnapshot('device-1','com.example');assert.deepEqual(result.pids,[42]);assert.equal(result.uid,10123);assert.equal(result.processScope,'main-process');assert.equal(result.eventCount,1);assert.equal(result.events[0].pid,42);assert.ok(calls.some(args=>args.includes("'--uid=10123'")));
});
