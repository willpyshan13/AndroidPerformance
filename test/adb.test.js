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
