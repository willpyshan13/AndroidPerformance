import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseFoldedStacks,layoutFlame} from '../public/offline.js';
import {Adb} from '../src/adb.js';
test('folded stacks accumulate event period weights and preserve call order',()=>{
 const p=parseFoldedStacks('thread;main;work 10\nthread;main;wait 5\n');assert.equal(p.root.weight,15);assert.equal(p.stacks,2);
 assert.equal(p.root.children[0].children[0].name,'main');assert.equal(p.symbols.find(x=>x.name==='work').self,10);
});
test('folded stacks reject malformed values and unsafe weights',()=>{
 for(const s of ['x; 5','x -2','x 9007199254740992','x y'])assert.throws(()=>parseFoldedStacks(s));
});
test('CPU profile capture releases device lock and removes temporary files on device failure',async()=>{
 const calls=[];const adb=new Adb('adb',async(_path,args)=>{calls.push(args);if(args.join(' ').includes('getprop'))return {stdout:'arm64-v8a'};if(args.join(' ').includes('record'))throw new Error('not debuggable');return {stdout:''};});
 await assert.rejects(adb.captureCpuProfile('ABC','com.example.app',5,async()=>'/fake/simpleperf'),/not debuggable/);
 assert.ok(calls.some(args=>args.join(' ').includes("'rm' '-f'")));assert.equal(adb.busy.size,0);
});
test('CPU profile capture validates perf magic and cleans both copies',async()=>{
 const {writeFile,access}=await import('node:fs/promises');let local;const calls=[];
 const adb=new Adb('adb',async(_path,args)=>{calls.push(args);const cmd=args.join(' ');if(cmd.includes('ro.product.cpu.abi'))return {stdout:'arm64-v8a'};if(cmd.includes('ro.build.version.sdk'))return {stdout:'25'};if(cmd.includes("'wc'"))return {stdout:'12 /tmp/data'};if(args.includes('pull')){local=args.at(-1);await writeFile(local,Buffer.from('PERFILE2test'));}return {stdout:''};});
 const data=await adb.captureCpuProfile('ABC','com.example.app',5,async(abi,api)=>{assert.equal(abi,'arm64-v8a');assert.equal(api,'25');return '/fake/simpleperf';},['cpu-clock:u','cpu-cycles:u','instructions:u']);
 assert.equal(data.toString(),'PERFILE2test');await assert.rejects(access(local));assert.ok(calls.some(args=>args.join(' ').includes("'rm' '-f'")));assert.equal(adb.busy.size,0);
 const record=calls.find(args=>args.join(' ').includes("'record'"));assert.ok(record);const eventIndex=record.indexOf("'-e'");assert.equal(record[eventIndex+1],"'cpu-clock:u,cpu-cycles:u,instructions:u'");
 const before=calls.length;for(const events of [[],Array(9).fill('cpu-clock'),['cpu-clock','cpu-clock'],['cpu-clock;id']])await assert.rejects(adb.captureCpuProfile('ABC','com.example.app',5,async()=>'/fake/simpleperf',events),/simpleperf 事件名/);assert.equal(calls.length,before);
});

test('CPU event discovery parses device simpleperf list output and removes uploaded binary',async()=>{
 const calls=[];const adb=new Adb('adb',async(_path,args)=>{calls.push(args);const joined=args.join(' ');if(joined.includes('ro.product.cpu.abi'))return {stdout:'arm64-v8a'};if(joined.includes('ro.build.version.sdk'))return {stdout:'34'};if(joined.includes("'list'"))return {stdout:'List of hardware events:\n  cpu-cycles\t# CPU cycles\n  instructions\nList of software events:\n  cpu-clock (may not supported)\n'};return {stdout:''};});
 const result=await adb.listCpuEvents('ABC',async(abi,api)=>{assert.equal(abi,'arm64-v8a');assert.equal(api,'34');return '/fake/simpleperf';});
 assert.deepEqual(result,{events:['cpu-cycles','instructions','cpu-clock'],source:'simpleperf list'});assert.ok(calls.some(args=>args.join(' ').includes("'rm' '-f'")));assert.equal(adb.busy.size,0);
});

test('flame layout uses normalized event weights and preserves stack ancestry',()=>{
 const p=parseFoldedStacks('t;main;a 6\nt;main;b 4\n');const graph=layoutFlame(p.root);
 const a=graph.frames.find(x=>x.node.name==='a'),b=graph.frames.find(x=>x.node.name==='b');
 assert.equal(a.width,.6);assert.equal(b.width,.4);assert.equal(a.x,0);assert.equal(b.x,.6);assert.deepEqual(a.path,[0,0,0]);
 assert.equal(layoutFlame(p.root,{maxNodes:2}).truncated,true);assert.equal(layoutFlame(p.root,{maxDepth:1}).truncated,true);
});
test('sample timeline preserves large nanosecond timestamps and filters by sample time',async()=>{
 const {buildSampleTimeline,profileForTimeBin}=await import('../public/offline.js');
 const input={event:'cpu-clock:u',truncated:false,samples:[{timeNs:'1700000000000000000',pid:1,tid:2,thread:'t',period:'10',frames:['main','a']},{timeNs:'1700000001000000000',pid:1,tid:2,thread:'t',period:'20',frames:['main','b']}]};
 const grouped=buildSampleTimeline(input);assert.equal(grouped.groups[0].pid,1);assert.equal(grouped.groups[0].tid,2);
 const t=buildSampleTimeline(input,2);assert.equal(t.durationMs,1000);assert.deepEqual(t.groups[0].counts,[1,1]);
 const p=profileForTimeBin(t,1);assert.equal(p.root.weight,20);assert.equal(p.symbols.find(x=>x.name==='b').self,20);
});
test('sample timeline reports unusable timestamps and rejects invalid ranges',async()=>{
 const {buildSampleTimeline,profileForTimeBin}=await import('../public/offline.js');
 const t=buildSampleTimeline({samples:[{timeNs:'0',period:'2',thread:'x',pid:1,tid:1,frames:[]}]});assert.equal(t.available,false);assert.equal(t.skipped,1);assert.throws(()=>profileForTimeBin(t,0));
});
test('sample quality counts unknown leaf and missing callers only among retained samples',async()=>{
 const {buildSampleTimeline,sampleQuality}=await import('../public/offline.js');
 const timeline=buildSampleTimeline({truncated:true,samples:[{timeNs:'1',period:'3',thread:'t',pid:1,tid:1,frames:['unknown']},{timeNs:'2',period:'4',thread:'t',pid:1,tid:1,frames:['unknown','work']},{timeNs:'0',period:'5',thread:'t',pid:1,tid:1,frames:['unknown']}]});
 assert.deepEqual(sampleQuality(timeline),{samples:2,unknownLeaf:1,noCallers:1,unknownLeafWeight:3,skipped:1,truncated:true});assert.equal(sampleQuality({available:false}),null);
});
test('time range filters sample timestamps precisely and rejects invalid or empty ranges',async()=>{
 const {buildSampleTimeline,profileForTimeRange}=await import('../public/offline.js');
 const t=buildSampleTimeline({event:'cpu-clock',samples:[{timeNs:'9000000000000000',pid:1,tid:1,thread:'t',period:'3',frames:['a']},{timeNs:'9000000010000000',pid:1,tid:1,thread:'t',period:'7',frames:['b']}]});
 assert.equal(profileForTimeRange(t,0,0).root.weight,3);assert.equal(profileForTimeRange(t,0,10).root.weight,10);
 assert.throws(()=>profileForTimeRange(t,1,9),/没有采样点/);assert.throws(()=>profileForTimeRange(t,10,0),/时间范围无效/);
});
test('time filtering can isolate one recorded thread without mixing other threads',async()=>{
 const {buildSampleTimeline,profileForTimeBin,profileForTimeRange}=await import('../public/offline.js');
 const timeline=buildSampleTimeline({samples:[{timeNs:'1000000',period:'3',thread:'main',pid:1,tid:1,frames:['a']},{timeNs:'1000000',period:'7',thread:'worker',pid:1,tid:2,frames:['b']},{timeNs:'2000000',period:'5',thread:'worker',pid:1,tid:2,frames:['c']}]},2);
 assert.equal(profileForTimeBin(timeline,0,'main-1/1').root.weight,3);assert.equal(profileForTimeBin(timeline,0).root.weight,10);
 assert.equal(profileForTimeRange(timeline,0,1,'worker-1/2').root.weight,12);assert.throws(()=>profileForTimeRange(timeline,0,1,'missing'),/没有采样点/);assert.throws(()=>profileForTimeBin(timeline,0,3),/线程筛选/);
});
test('sample stack chart aggregates leaf weights by time and keeps remaining functions visible',async()=>{
 const {buildSampleTimeline,sampleStackChart}=await import('../public/offline.js');
 const timeline=buildSampleTimeline({samples:[
  {timeNs:'1000000',period:'7',thread:'main',pid:1,tid:1,frames:['root','hot']},
  {timeNs:'1000000',period:'3',thread:'worker',pid:1,tid:2,frames:['hot']},
  {timeNs:'2000000',period:'5',thread:'main',pid:1,tid:1,frames:['root','cold']},
  {timeNs:'2000000',period:'2',thread:'main',pid:1,tid:1,frames:['root','rare']}
 ],},2);
 const chart=sampleStackChart(timeline,2);
 assert.equal(chart.bins,2);assert.deepEqual(chart.series.map(x=>x.name),['hot','cold','其他函数']);
 assert.deepEqual(chart.series.map(x=>x.total),[10,5,2]);assert.deepEqual(chart.series.map(x=>x.values),[[10,0],[0,5],[0,2]]);assert.deepEqual(chart.totals,[10,7]);
 assert.throws(()=>sampleStackChart(timeline,0),/无效/);assert.throws(()=>sampleStackChart({available:false},8),/无效/);
});
test('reverse callers aggregate inclusive weights, respect scope and count recursion explicitly',async()=>{
 const {reverseCallTree}=await import('../public/offline.js');
 const p=parseFoldedStacks('main;A;target;leaf 4\nmain;B;target 3\nworker;A;target 2\nmain;target;target 1\n');
 const r=reverseCallTree(p.root,'target');assert.equal(r.matches,5);assert.equal(r.root.weight,11);
 const callers=r.root.children;assert.equal(callers.find(x=>x.name==='A').weight,6);assert.equal(callers.find(x=>x.name==='B').weight,3);assert.equal(callers.find(x=>x.name==='target').weight,1);
 assert.equal(callers.find(x=>x.name==='A').children.find(x=>x.name==='main').weight,4);
 const main=p.root.children.find(n=>n.name==='main');const scoped=reverseCallTree(main,'target');assert.equal(scoped.root.weight,9);
 assert.equal(reverseCallTree(p.root,'absent').matches,0);
});
