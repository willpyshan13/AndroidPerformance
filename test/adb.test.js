import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Adb, validateTarget } from '../src/adb.js';

test('target validation rejects remote shell injection and option injection',()=>{
  for(const serial of ['-s foo','serial;reboot','$(id)','']) assert.throws(()=>validateTarget(serial));
  for(const pkg of ['com.example;reboot','com.app && id','com.$(id)','--help'])assert.throws(()=>validateTarget('ABC',pkg));
  assert.doesNotThrow(()=>validateTarget('192.168.1.3:5555','com.example.app_1'));
});
test('remote shell arguments are quoted, including nested Activity dollar signs',async()=>{
  let received;
  const adb=new Adb('/fake/adb',async(path,args)=>{received=args;return {stdout:'ok'};});
  await adb.shell('ABC',['am','start','-n','com.app/.Main$Nested']);
  assert.deepEqual(received,['-s','ABC','shell',"'am'","'start'","'-n'","'com.app/.Main$Nested'"]);
});
test('benchmark instrumentation validates selection, locks device and preserves actual result',async()=>{
 let call;const adb=new Adb('adb',async(_path,args,options)=>{if(args.includes("'stat'"))return {stdout:''};call={args,options};return {stdout:'INSTRUMENTATION_STATUS_CODE: 0\nOK (2 tests)\nINSTRUMENTATION_CODE: -1\n'};});
 const result=await adb.runBenchmark('ABC','com.example.benchmark/androidx.test.runner.AndroidJUnitRunner','com.example.Startup#cold');
 assert.equal(result.status,'completed');assert.equal(result.testCount,2);assert.equal(call.options.timeout,600000);
 assert.ok(call.args.includes("'com.example.Startup#cold'"));assert.ok(call.args.includes("'com.example.benchmark/androidx.test.runner.AndroidJUnitRunner'"));
 for(const input of ['com.example.test/runner;reboot','com.example.test/--bad'])await assert.rejects(adb.runBenchmark('ABC',input),/格式无效/);
 await assert.rejects(adb.runBenchmark('ABC','com.example.test/.Runner','com.Test#run;reboot'),/格式无效/);
 const failed=new Adb('adb',async(_path,args)=>({stdout:args.includes("'stat'")?'':'FAILURES!!!\nTests run: 1, Failures: 1\n'}));assert.equal((await failed.runBenchmark('ABC','com.example.test/.Runner')).status,'failed');
 const unknown=new Adb('adb',async(_path,args)=>({stdout:args.includes("'stat'")?'':'INSTRUMENTATION_CODE: -1\n'}));assert.equal((await unknown.runBenchmark('ABC','com.example.test/.Runner')).status,'unknown');
 await assert.rejects(adb.exclusive('ABC',()=>adb.runBenchmark('ABC','com.example.test/.Runner')),/已有采集任务/);assert.equal(adb.busy.size,0);
});
test('benchmark report reads only explicit media JSON paths with a bounded device command',async()=>{
 let calls=0,args;const adb=new Adb('adb',async(_path,command)=>{calls++;args=command;return {stdout:'{"benchmarks":[]}'};});
 const path='/sdcard/Android/media/com.example.benchmark/com.example.benchmark-benchmarkData.json';
 const result=await adb.readBenchmarkReport('ABC',path);assert.deepEqual(result.report,{benchmarks:[]});assert.equal(result.path,path);
 assert.ok(args.includes("'head'"));assert.ok(args.includes("'12582913'"));assert.ok(args.includes(`'${path}'`));
 for(const bad of ['/sdcard/Download/file.json','/sdcard/Android/media/com.example/../secret.json','/sdcard/Android/media/com.example/x.json;reboot'])await assert.rejects(adb.readBenchmarkReport('ABC',bad),/路径/);
 assert.equal(calls,1);
 const malformed=new Adb('adb',async()=>({stdout:'not json'}));await assert.rejects(malformed.readBenchmarkReport('ABC',path),/有效 JSON/);assert.equal(malformed.busy.size,0);
 const huge=new Adb('adb',async()=>({stdout:'x'.repeat(12*1024*1024+1)}));await assert.rejects(huge.readBenchmarkReport('ABC',path),/超过 12 MiB/);
});
test('metrics preserves independently failing evidence without inventing values',async()=>{
  const adb=new Adb('/fake/adb',async(path,args)=>{
    const command=args.join(' ');
    if(command.includes('cpuinfo'))throw new Error('permission denied');
    if(command.includes('meminfo'))return {stdout:'TOTAL PSS: 102400'};
    if(command.includes('battery'))return {stdout:'level: 50\n scale: 100'};
    return {stdout:'123'};
  });
  const sample=await adb.metrics('ABC','com.example.app');
  assert.equal(sample.cpu,null);assert.equal(sample.memory.pssMb,100);assert.equal(sample.source,'adb');assert.equal(sample.warnings.length,1);
});
test('device mutation lock releases after failure and rejects concurrent capture',async()=>{
  const adb=new Adb('adb');let release;
  const task=adb.exclusive('ABC',()=>new Promise(r=>release=r));
  await assert.rejects(adb.exclusive('ABC',async()=>{}),/已有采集任务/);
  release();await task;
  await assert.rejects(adb.exclusive('ABC',async()=>{throw new Error('failure');}),/failure/);
  assert.equal(adb.busy.size,0);
});
test('live CPU establishes a baseline then computes deltas; restarts reset the baseline',async()=>{
  let index=0;
  const snapshots=[{ticks:10,total:1000,start:7},{ticks:30,total:1200,start:7},{ticks:0,total:1400,start:9}];
  const adb=new Adb('adb',async()=>{
    const sample=snapshots[index++],fields=Array(22).fill('0');fields[0]='S';fields[11]=String(sample.ticks);fields[19]=String(sample.start);
    return {stdout:`cpu ${sample.total} 0 0 0\ncpu0 1\ncpu1 1\n123 (com.app) ${fields.join(' ')}`};
  });
  const first=await adb.cpu('ABC','com.app','123');assert.equal(first.percent,null);assert.equal(first.method,'proc-stat');
  assert.equal((await adb.cpu('ABC','com.app','123')).percent,20);
  assert.equal((await adb.cpu('ABC','com.app','123')).percent,null);
});
test('proc permission denial falls back to cpuinfo with explicit source',async()=>{
  const adb=new Adb('adb',async(_path,args)=>{if(args.join(' ').includes('/proc/'))throw new Error('permission denied');return {stdout:'CPU usage from 1000ms to 0ms ago:\n 8% 123/com.app: 8% user'};});
  const cpu=await adb.cpu('ABC','com.app','123');assert.equal(cpu.percent,8);assert.equal(cpu.method,'dumpsys');assert.match(cpu.fallbackReason,/permission denied/);
});
test('unsupported Perfetto fails clearly before creating any temporary files',async()=>{
  const calls=[];
  const adb=new Adb('adb',async(_path,args)=>{calls.push(args.join(' '));throw new Error('not found');});
  await assert.rejects(adb.trace('ABC',3),/当前设备没有 perfetto/);
  assert.equal(calls.length,1);assert.equal(adb.busy.size,0);
});
test('layout retains actual screenshot dimensions and cleans temporary device XML',async()=>{
  const calls=[];const png=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(png);png.writeUInt32BE(1080,16);png.writeUInt32BE(1920,20);
  const adb=new Adb('adb',async(_path,args)=>{calls.push(args.join(' '));if(args.includes('exec-out'))return {stdout:png};return {stdout:args.join(' ').includes("'cat'")?'<hierarchy><node bounds="[0,0][1080,1848]"/></hierarchy>':''};});
  const layout=await adb.layout('ABC');assert.deepEqual(layout.imageSize,{width:1080,height:1920});assert.equal(layout.screenshot,png.toString('base64'));
  assert.match(calls.at(-1),/'rm' '-f' '\/data\/local\/tmp\/apw-/);assert.equal(adb.busy.size,0);
});
test('invalid screenshot does not discard usable XML or leak a capture lock',async()=>{
  const adb=new Adb('adb',async(_path,args)=>({stdout:args.includes('exec-out')?Buffer.from('invalid'):args.join(' ').includes("'cat'")?'<hierarchy/>':''}));
  const layout=await adb.layout('ABC');assert.equal(layout.screenshot,null);assert.match(layout.warning,/PNG/);assert.equal(adb.busy.size,0);
});
test('system-killed ADB gives an actionable signature error instead of an empty command failure',async()=>{
  const adb=new Adb('/sdk/adb',async()=>{throw Object.assign(new Error('Command failed'),{signal:'SIGKILL'});});
  await assert.rejects(adb.run(['version']),/SIGKILL.*签名/);
});
test('heap capture rejects device errors and always removes the remote file and lock',async()=>{
  const calls=[];
  const adb=new Adb('adb',async(_path,args)=>{calls.push(args);return {stdout:args.join(' ').includes('dumpheap')?'Error: process not debuggable':''};});
  await assert.rejects(adb.heapDump('ABC','com.example.app'),/堆转储失败/);
  assert.ok(calls.some(args=>args.join(' ').includes("'rm' '-f'")));
  assert.equal(adb.busy.size,0);
});
test('heap capture returns valid HPROF and removes temporary files',async()=>{
  const {writeFile,access}=await import('node:fs/promises');
  const calls=[];let local;
  const adb=new Adb('adb',async(_path,args)=>{calls.push(args);if(args.includes('pull')){local=args.at(-1);await writeFile(local,Buffer.from('JAVA PROFILE 1.0.3\0test'));}return {stdout:''};});
  adb.waitHeapFile=async()=>Buffer.byteLength('JAVA PROFILE 1.0.3\0test');
  const data=await adb.heapDump('ABC','com.example.app');
  assert.match(data.toString(),/^JAVA PROFILE/);
  await assert.rejects(access(local));
  assert.ok(calls.some(args=>args.join(' ').includes("'rm' '-f'")));
  assert.equal(adb.busy.size,0);
});

test('heap capture waits for asynchronous device writes and enforces size limit',async()=>{
  const sizes=[0,12,24,24,24];
  const adb=new Adb('adb',async()=>({stdout:`${sizes.shift()} /tmp/heap`}));
  assert.equal(await adb.waitHeapFile('ABC','/tmp/heap',{intervalMs:1,stableChecks:2,timeoutMs:1000}),24);
  const large=new Adb('adb',async()=>({stdout:`${256*1024*1024+1} /tmp/heap`}));
  await assert.rejects(large.waitHeapFile('ABC','/tmp/heap',{intervalMs:1}),/超过/);
});

test('FrameTimeline capture requests the explicit source, gates Android version and cleans both files',async()=>{
  const {readFile,writeFile,access}=await import('node:fs/promises');let configLocal,traceLocal,config,remoteConfig;const calls=[];
  const adb=new Adb('adb',async(_p,args)=>{calls.push(args);const command=args.join(' ');
    if(command.includes("'which'"))return {stdout:'/system/bin/perfetto'};
    if(command.includes("'ro.build.version.sdk'"))return {stdout:'31'};
    if(args.includes('push')){configLocal=args.at(-2);remoteConfig=args.at(-1);config=await readFile(configLocal,'utf8');return {stdout:''};}
    if(args.includes('pull')){traceLocal=args.at(-1);await writeFile(traceLocal,Buffer.from('trace data'));return {stdout:''};}
    return {stdout:''};
  });
  assert.equal((await adb.trace('ABC',5,'frame-timeline','com.example.app')).toString(),'trace data');
  assert.match(config,/name: "android\.surfaceflinger\.frametimeline"/);assert.match(config,/duration_ms: 5000/);
  assert.match(config,/atrace_apps: "com\.example\.app"/);
  assert.ok(calls.some(a=>a.join(' ').includes("'--txt' '-c'")));assert.ok(remoteConfig.startsWith('/data/misc/perfetto-configs/'));
  assert.ok(calls.some(a=>a.join(' ').includes(remoteConfig)&&a.join(' ').includes("'rm'")));
  await assert.rejects(access(configLocal));await assert.rejects(access(traceLocal));assert.equal(adb.busy.size,0);
  const old=new Adb('adb',async(_p,args)=>({stdout:args.join(' ').includes('which')?'/system/bin/perfetto':'30'}));
  await assert.rejects(old.trace('ABC',5,'frame-timeline'),/Android 12/);assert.equal(old.busy.size,0);
  await assert.rejects(adb.trace('ABC',5,'bad'),/模式无效/);
  await assert.rejects(adb.trace('ABC',5,'frame-timeline','com.example.app" bad'),/包名无效/);
});
test('standard Perfetto capture passes the optional validated target app to atrace',async()=>{
 const {writeFile}=await import('node:fs/promises');const calls=[];
 const adb=new Adb('adb',async(_p,args)=>{calls.push(args);if(args.join(' ').includes("'which'"))return {stdout:'/system/bin/perfetto'};if(args.includes('pull'))await writeFile(args.at(-1),'trace');return {stdout:''};});
 await adb.trace('ABC',3,'standard','com.example.app');const perfetto=calls.find(a=>a.includes("'perfetto'")&&a.includes("'-o'"));assert.ok(perfetto.includes("'-a'"));assert.ok(perfetto.includes("'com.example.app'"));
});

test('native and ART allocation profiles use gated heapprofd configs and clean temporary files',async()=>{
 const {readFile,writeFile,access}=await import('node:fs/promises');let configLocal,traceLocal,config;const calls=[];
 const adb=new Adb('adb',async(_p,args)=>{calls.push(args);const command=args.join(' ');if(command.includes('getprop'))return {stdout:'31'};if(command.includes('which'))return {stdout:'/system/bin/perfetto'};if(args.includes('push')){configLocal=args.at(-2);config=await readFile(configLocal,'utf8');return {stdout:''};}if(args.includes('pull')){traceLocal=args.at(-1);await writeFile(traceLocal,'trace profile');}return {stdout:''};});
 assert.equal((await adb.heapProfile('ABC','com.example.app',10,'art',16384)).toString(),'trace profile');
 assert.match(config,/name: "android\.heapprofd"/);assert.match(config,/process_cmdline: "com\.example\.app"/);assert.match(config,/heaps: "com\.android\.art"/);assert.match(config,/sampling_interval_bytes: 16384/);assert.match(config,/duration_ms: 10000/);
 assert.ok(calls.some(a=>a.join(' ').includes("'perfetto'")&&a.join(' ').includes("'--txt'")));assert.ok(calls.some(a=>a.join(' ').includes("'rm'")));await assert.rejects(access(configLocal));await assert.rejects(access(traceLocal));assert.equal(adb.busy.size,0);
 const old=new Adb('adb',async()=>({stdout:'25'}));await assert.rejects(old.heapProfile('ABC','com.example.app'),/Android 10/);assert.equal(old.busy.size,0);
 await assert.rejects(adb.heapProfile('ABC','com.example.app',10,'art',0),/采样间隔/);
 await assert.rejects(adb.heapProfile('ABC','com.example.app',10,'unknown'),/模式无效/);
});
