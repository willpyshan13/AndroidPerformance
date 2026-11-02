import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {access,readFile} from 'node:fs/promises';
import {analyzePerfUpload} from '../src/perf-upload.js';
function request(chunks,headers={}){const r=Readable.from(chunks);r.headers=headers;return r;}
test('perf upload validates magic, invokes the converter with argument array and cleans the file',async()=>{
 let temporary;
 const result=await analyzePerfUpload(request([Buffer.from('PERF'),Buffer.from('ILE2data')]),{locator:async()=>'/ndk/simpleperf/stackcollapse.py',runner:async(cmd,args,opts)=>{assert.equal(cmd,'python3');assert.equal(opts.cwd,'/ndk/simpleperf');if(args[0].endsWith('simpleperf-timeline.py'))return {stdout:JSON.stringify({event:'cpu-clock',samples:[],truncated:false}),stderr:''};assert.ok(args[0].endsWith('simpleperf-collapse.py'));assert.equal(args[1],'/ndk/simpleperf');temporary=args[2];assert.equal((await readFile(temporary)).toString(),'PERFILE2data');return {stdout:'thread;func 2\n',stderr:'warning'};}});
 assert.equal(result.folded,'thread;func 2\n');assert.equal(result.warning,'warning');await assert.rejects(access(temporary));
});
test('invalid perf uploads and empty converter results fail without leaving temporary files',async()=>{
 await assert.rejects(analyzePerfUpload(request([Buffer.from('invalid')])),/perf.data/);
 let temporary;await assert.rejects(analyzePerfUpload(request([Buffer.from('PERFILE2')]),{locator:async()=>'/x/script',runner:async(_cmd,args)=>{temporary=args[2];return {stdout:'',stderr:''};}}),/没有可用调用栈/);await assert.rejects(access(temporary));
 await assert.rejects(analyzePerfUpload(request([],{ 'content-length':String(256*1024*1024+1) })),/超过/);
});

test('selected perf event is passed as one safe argument to both converters',async()=>{
 let converterArgs,helperArgs;
 const result=await analyzePerfUpload(request([Buffer.from('PERFILE2')],{'x-perf-event':encodeURIComponent('cpu-cycles:u')}),{locator:async()=>'/ndk/stackcollapse.py',runner:async(_cmd,args)=>{if(args[0].endsWith('simpleperf-timeline.py')){helperArgs=args;return {stdout:JSON.stringify({event:'cpu-cycles:u',events:[{name:'cpu-cycles:u',count:1}],samples:[],truncated:false}),stderr:''};}converterArgs=args;return {stdout:'thread;symbol 1\n',stderr:''};}});
 assert.equal(converterArgs.at(-1),'cpu-cycles:u');assert.equal(helperArgs.at(-1),'cpu-cycles:u');assert.equal(result.timeline.event,'cpu-cycles:u');
 await assert.rejects(()=>analyzePerfUpload(request([],{ 'x-perf-event':'%0Aevil' })),/事件名称/);
});
test('symbol directory is validated and passed identically to both parsers',async()=>{
 const argsSeen=[];const result=await analyzePerfUpload(request([Buffer.from('PERFILE2')],{'x-perf-symfs':encodeURIComponent('/tmp')}),{locator:async()=>'/ndk/stackcollapse.py',runner:async(_cmd,args)=>{argsSeen.push(args);return args[0].endsWith('timeline.py')?{stdout:JSON.stringify({samples:[]}),stderr:''}:{stdout:'thread;symbol 1\n',stderr:''};}});
 assert.equal(result.folded,'thread;symbol 1\n');assert.equal(argsSeen.length,2);for(const args of argsSeen)assert.deepEqual(args.slice(-2),['','/tmp']);
 await assert.rejects(analyzePerfUpload(request([],{ 'x-perf-symfs':'relative' })),/绝对路径/);
 await assert.rejects(analyzePerfUpload(request([],{ 'x-perf-symfs':encodeURIComponent('/path/does/not/exist') })),/不存在/);
});
test('simpleperf timeline enumerates events and retains only the selected event samples',async t=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
 const dir=await mkdtemp(join(tmpdir(),'apw-perf-events-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await writeFile(join(dir,'simpleperf_report_lib.py'),`from types import SimpleNamespace as N\nclass ReportLib:\n def __init__(self): self.i=-1; self.symfs=None\n def SetSymfs(self, path): self.symfs=path\n def SetRecordFile(self, path): pass\n def GetNextSample(self):\n  self.i+=1\n  return None if self.i>=3 else N(time=100+self.i,pid=1,tid=2,thread_comm='main;worker',period=1)\n def GetEventOfCurrentSample(self): return N(name=['cycles','instructions','cycles'][self.i])\n def GetCallChainOfCurrentSample(self): return N(nr=1,entries=[N(symbol=N(symbol_name='caller;name'))])\n def GetSymbolOfCurrentSample(self): return N(symbol_name='resolved' if self.symfs else 'leaf%3Bname')\n def Close(self): pass\n`);
 const script=new URL('../scripts/simpleperf-timeline.py',import.meta.url).pathname;const run=promisify(execFile);const parse=async(...args)=>JSON.parse((await run('python3',[script,dir,'dummy',...args])).stdout);
 const first=await parse();assert.equal(first.event,'cycles');assert.deepEqual(first.events,[{name:'cycles',count:2},{name:'instructions',count:1}]);assert.equal(first.samples.length,2);
 const second=await parse('instructions');assert.equal(second.event,'instructions');assert.equal(second.samples.length,1);assert.equal(second.samples[0].timeNs,'101');
 assert.deepEqual(first.samples[0].frames,['caller%3Bname','leaf%253Bname']);assert.equal(first.samples[0].thread,'main%3Bworker');const collapse=new URL('../scripts/simpleperf-collapse.py',import.meta.url).pathname;const result=await run('python3',[collapse,dir,'dummy','instructions']);assert.equal(result.stdout,'main%3Bworker-1/2;caller%3Bname;leaf%253Bname 1\n');
 const {buildSampleTimeline,profileForTimeRange,parseFoldedStacks}=await import('../public/offline.js');const timeline=buildSampleTimeline(second);assert.equal(timeline.skipped,0);assert.deepEqual(profileForTimeRange(timeline,0,0).symbols.map(x=>x.name).sort(),parseFoldedStacks(result.stdout).symbols.map(x=>x.name).sort());
 const resolved=await parse('instructions',dir);assert.equal(resolved.samples[0].frames.at(-1),'resolved');const collapsed=await run('python3',[collapse,dir,'dummy','instructions',dir]);assert.match(collapsed.stdout,/;resolved 1/);
});

test('official multi-event perf.data isolates full stacks and timeline by event',async t=>{
 const path=process.env.APW_MULTI_EVENT_PERF;if(!path){t.skip('设置 APW_MULTI_EVENT_PERF 指向 Android 官方多事件样本');return;}
 const {createHash}=await import('node:crypto');const {createReadStream}=await import('node:fs');const {parseFoldedStacks,buildSampleTimeline,sampleQuality}=await import('../public/offline.js');
 assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'),'32c9e9edc7894fb96094041db31b6ddcb63f3b5bb24f402089e39c78d4dc9779');
 const run=async event=>{const stream=createReadStream(path);stream.headers=event?{'x-perf-event':encodeURIComponent(event)}:{};return analyzePerfUpload(stream);};
 const first=await run(null),second=await run('cpu-clock');assert.deepEqual(first.timeline.events,[{name:'cpu-cycles',count:8},{name:'cpu-clock',count:2}]);
 assert.equal(first.timeline.event,'cpu-cycles');assert.equal(first.timeline.samples.length,8);assert.equal(parseFoldedStacks(first.folded).root.weight,3983917);assert.equal(buildSampleTimeline(first.timeline).skipped,0);
 assert.ok(first.timeline.samples.every(s=>s.frames.length>0));assert.ok(first.folded.includes(';unknown '));
 const quality=sampleQuality(buildSampleTimeline(first.timeline));assert.equal(quality.samples,8);assert.equal(quality.unknownLeaf,8);assert.equal(quality.noCallers,8);assert.equal(quality.unknownLeafWeight,3983917);
 assert.equal(second.timeline.event,'cpu-clock');assert.equal(second.timeline.samples.length,2);assert.equal(parseFoldedStacks(second.folded).root.weight,500000);assert.equal(buildSampleTimeline(second.timeline).skipped,0);
});

test('multi-event perf.data selection works through HTTP upload',async t=>{
 const path=process.env.APW_MULTI_EVENT_PERF;if(!path){t.skip('设置 APW_MULTI_EVENT_PERF 指向 Android 官方多事件样本');return;}
 const {createApp}=await import('../src/server.js');const {once}=await import('node:events');const app=createApp({adb:{path:'fake'},token:'test'});app.listen(0,'127.0.0.1');await once(app,'listening');t.after(()=>new Promise(resolve=>app.close(resolve)));
 const response=await fetch(`http://127.0.0.1:${app.address().port}/api/cpu-profile/analyze`,{method:'POST',headers:{'X-Workbench-Token':'test','X-Perf-Event':'cpu-clock'},body:await readFile(path)});assert.equal(response.status,200);const result=await response.json();assert.equal(result.timeline.event,'cpu-clock');assert.equal(result.timeline.samples.length,2);assert.equal(result.timeline.events.length,2);
});

test('official build-id sample resolves real ELF symbols with symfs',async t=>{
 const dir=process.env.APW_SYMFS_FIXTURE;if(!dir){t.skip('设置 APW_SYMFS_FIXTURE 指向官方 perf.data 及匹配 ELF 的目录');return;}
 const {join}=await import('node:path'),{createHash}=await import('node:crypto'),{createReadStream}=await import('node:fs');
 const path=join(dir,'perf.data'),elf=join(dir,'elf_for_build_id_check'),wrong=join(dir,'wrong'),hash=async p=>createHash('sha256').update(await readFile(p)).digest('hex');
 assert.equal(await hash(path),'d3d697516190f4b456801315f0cddfaba8dc0e33d669a3cdb54f630d9c2c5e1e');assert.equal(await hash(elf),'70f34abcec04a93732a43abebc4e9043a25cb0586b650975eda16f31cfaf5848');
 const run=async symbols=>{const stream=createReadStream(path);stream.headers=symbols?{'x-perf-symfs':encodeURIComponent(symbols)}:{};return analyzePerfUpload(stream);};
 const before=await run(null),after=await run(dir);assert.match(before.folded,/;unknown /);assert.match(after.folded,/;main /);assert.equal(before.timeline.samples.length,after.timeline.samples.length);assert.ok(after.timeline.samples.every(s=>s.frames.at(-1)==='main'));
 assert.equal(await hash(join(wrong,'elf_for_build_id_check')),'c3aaee67a14edf04f9a8c1e5abda7f9287e0997c86801c715bce253bfc1b8f9a');const mismatch=await run(wrong);assert.match(mismatch.folded,/;unknown /);assert.match(mismatch.warning,/构建 ID 与采样记录不匹配/);
});
