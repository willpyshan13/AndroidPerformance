import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

test('simpleperf converters select distinct on-CPU and off-CPU records for trace-offcpu profiles',async()=>{
 const fake=await mkdtemp(join(tmpdir(),'apw-fake-reportlib-'));
 try {
  await writeFile(join(fake,'simpleperf_report_lib.py'),`class Symbol:\n def __init__(self,name): self.symbol_name=name; self.dso_name='libsample.so'\nclass Entry:\n def __init__(self,name): self.symbol=Symbol(name)\nclass Chain:\n def __init__(self,name): self.nr=1; self.entries=[Entry(name)]\nclass Sample:\n def __init__(self,time,period,thread): self.time=time; self.period=period; self.thread_comm=thread; self.pid=1; self.tid=1\nclass Event:\n def __init__(self,name): self.name=name\nclass ReportLib:\n def __init__(self): self.i=0; self.mode=None; self.rows=[('cpu-clock',Sample(100,5,'worker'),'run'),('sched:sched_switch',Sample(200,7000000,'worker'),'wait')]\n def SetRecordFile(self,path): pass\n def GetSupportedTraceOffCpuModes(self): return ['on-cpu','off-cpu','on-off-cpu','mixed-on-off-cpu']\n def SetTraceOffCpuMode(self,mode): self.mode=mode\n def MetaInfo(self): return {'clockid':'monotonic'}\n def GetNextSample(self):\n  if self.i>=len(self.rows): return None\n  self.row=self.rows[self.i]; self.i+=1; return self.row[1]\n def GetEventOfCurrentSample(self): return Event(self.row[0])\n def GetCallChainOfCurrentSample(self): return Chain('caller')\n def GetSymbolOfCurrentSample(self): return Symbol(self.row[2])\n def Close(self): pass\n`);
  const run=(script,event)=>JSON.parse(execFileSync('python3',[resolve('scripts',script),fake,'/tmp/fake.perf.data',event],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}}));
  const timeline=run('simpleperf-timeline.py','sched:sched_switch');
  assert.equal(timeline.traceOffCpu,true);assert.deepEqual(timeline.events.map(row=>row.name),['cpu-clock','sched:sched_switch']);assert.equal(timeline.samples.length,1);assert.equal(timeline.samples[0].period,'7000000');assert.equal(timeline.samples[0].frames.at(-1),'wait');
  const folded=execFileSync('python3',[resolve('scripts','simpleperf-collapse.py'),fake,'/tmp/fake.perf.data','sched:sched_switch'],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  assert.match(folded,/worker-1\/1;caller;wait 7000000/);
 } finally {await rm(fake,{recursive:true,force:true});}
});
