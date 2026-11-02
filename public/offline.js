export function parseHar(document) {
  const entries = document?.log?.entries;
  if (!Array.isArray(entries)) throw new Error('不是有效的 HAR 文件，缺少 log.entries');
  if (entries.length > 50000) throw new Error('HAR 请求数超过 50,000 条限制');
  return entries.map((entry, i) => {
    let url;
    try { url = new URL(entry.request?.url); } catch { throw new Error(`HAR 第 ${i + 1} 条请求 URL 无效`); }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`HAR 第 ${i + 1} 条 URL 协议不支持`);
    const timings = {};
    for (const key of ['blocked', 'dns', 'connect', 'ssl', 'send', 'wait', 'receive']) {
      const n = entry.timings?.[key]; timings[key] = typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
    }
    const connectionId=typeof entry.connection==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(entry.connection)?entry.connection:null;
    return { id: i + 1, method: String(entry.request?.method || 'GET'), host: url.host, path: url.pathname, connectionId,
      // Discard queries, URL credentials, headers, cookies and bodies on import.
      url: `${url.protocol}//${url.host}${url.pathname}`, status: Number(entry.response?.status || 0),
      timeMs: typeof entry.time === 'number' && Number.isFinite(entry.time) && entry.time >= 0 ? entry.time : null,
      bytes: typeof entry.response?.content?.size === 'number' && Number.isFinite(entry.response.content.size) && entry.response.content.size >= 0 ? entry.response.content.size : null,
      startedAt: Number.isFinite(Date.parse(entry.startedDateTime)) ? Date.parse(entry.startedDateTime) : null, timings };
  });
}

export function filterNetworkRequests(rows,{query='',method='all',status='all',connection='all',minDuration='',maxDuration='',from='',to=''}={}){
 if(!Array.isArray(rows)||typeof query!=='string')throw new Error('网络筛选参数无效');
 const numeric=(value,label)=>{if(value===''||value===null||value===undefined)return null;const n=Number(value);if(!Number.isFinite(n)||n<0)throw new Error(`${label}必须是非负数字`);return n;};
 const min=numeric(minDuration,'最小耗时'),max=numeric(maxDuration,'最大耗时');if(min!==null&&max!==null&&min>max)throw new Error('最小耗时不能大于最大耗时');
 const dateValue=(value,label)=>{if(!value)return null;const n=Date.parse(value);if(!Number.isFinite(n))throw new Error(`${label}无效`);return n;};
 const start=dateValue(from,'起始时间'),end=dateValue(to,'结束时间');if(start!==null&&end!==null&&start>end)throw new Error('起始时间不能晚于结束时间');
 const needle=query.toLocaleLowerCase();
 return rows.filter(row=>{
  if(needle&&!`${row.host||''}${row.path||''}`.toLocaleLowerCase().includes(needle))return false;
  if(method!=='all'&&row.method!==method)return false;
  if(connection!=='all'&&row.connectionId!==connection)return false;
  if(status!=='all'){const code=Number(row.status)||0;if(status==='2xx'&&(code<200||code>=300)||status==='3xx'&&(code<300||code>=400)||status==='4xx'&&(code<400||code>=500)||status==='5xx'&&(code<500||code>=600)||status==='failure'&&!(row.failed===true||code===0||code>=400))return false;}
  if(min!==null&&(row.timeMs===null||row.timeMs<min)||max!==null&&(row.timeMs===null||row.timeMs>max))return false;
  if(start!==null&&(row.startedAt===null||row.startedAt<start)||end!==null&&(row.startedAt===null||row.startedAt>end))return false;
  return true;
 });
}

export function networkRequestsCsv(rows){
 if(!Array.isArray(rows)||rows.length>50000)throw new Error('网络导出记录无效或超过 50,000 条');
 const columns=[['开始时间',r=>r.startedAt!==null&&r.startedAt!==undefined&&Number.isFinite(new Date(r.startedAt).getTime())?new Date(r.startedAt).toISOString():''],['方法',r=>r.method],['URL',r=>r.url],['状态',r=>r.status],['调用失败',r=>r.failed===true?'是':r.failed===false?'否':''],['连接 ID',r=>r.connectionId],['总耗时 ms',r=>r.timeMs],['响应内容字节',r=>r.bytes],['DNS ms',r=>r.timings?.dns],['连接 ms',r=>r.timings?.connect],['TLS ms',r=>r.timings?.ssl],['等待 ms',r=>r.timings?.wait],['接收 ms',r=>r.timings?.receive]];
 const cell=value=>{let text=value===null||value===undefined?'':String(value);if(typeof value==='string'&&/^[\t\r ]*[=+\-@]/.test(value))text=`'${text}`;return `"${text.replace(/"/g,'""')}"`;};
 return [columns.map(([name])=>cell(name)).join(','),...rows.map(row=>columns.map(([,get])=>cell(get(row))).join(','))].join('\r\n')+'\r\n';
}

// Only inspect the file listing of this APK; packaging does not prove that a
// profile was valid, installed, compiled, or used by the measured build.
export function apkBaselineEvidence(apk){
 if(!apk||!Array.isArray(apk.files))return null;
 const paths=['assets/dexopt/baseline.prof','assets/dexopt/baseline.profm'];
 const files=paths.map(path=>{const rows=apk.files.filter(x=>x?.path===path);const headers=Array.isArray(apk.profileHeaders)?apk.profileHeaders.filter(x=>x?.path===path):[];const header=headers.length===1?headers[0]:null;return rows.length===0?{path,status:'absent',bytes:null,header:null}:rows.length!==1||!Number.isSafeInteger(rows[0].uncompressedBytes)||rows[0].uncompressedBytes<0?{path,status:'unknown',bytes:null,header:null}:{path,status:'present',bytes:rows[0].uncompressedBytes,header};});
 return {files};
}

// Accumulate uniquely identified v2 events across logcat snapshots; legacy
// records remain a current snapshot because they have no stable identity.
export function mergeNetworkAgentSnapshot(accumulator,snapshot,limit=10000){
 if(!snapshot||!Array.isArray(snapshot.rows)||!Number.isInteger(limit)||limit<1||limit>10000)throw new Error('Agent 快照无效');
 const state=accumulator||{rows:[],seen:new Set(),queue:[],dropped:0};
 const legacy=[];
 for(const row of snapshot.rows){
  if(!row.eventId){legacy.push(row);continue;}
  if(state.seen.has(row.eventId))continue;
  state.seen.add(row.eventId);state.queue.push(row.eventId);state.rows.push(row);
  if(state.rows.length>limit){state.rows.shift();state.dropped++;}
  if(state.queue.length>limit*3)state.seen.delete(state.queue.shift());
 }
 // Keep the newest records when a legacy snapshot and accumulated records
 // exceed the display limit. v1 rows are not counted as independent samples.
 const combined=[...state.rows,...legacy].sort((a,b)=>a.startedAt-b.startedAt).slice(-limit).map((row,i)=>({...row,id:i+1}));
 return {state,result:{...snapshot,rows:combined,accumulated:state.rows.length,legacy:legacy.length,dropped:state.dropped,displayTruncated:state.rows.length+legacy.length>limit}};
}

// HAR's ssl is included in connect. Aggregate phases independently, without
// inferring connection reuse from missing timing values.
export function summarizeHarHosts(rows) {
 const hosts=new Map(),phases=['dns','connect','ssl','wait','receive'];
 for(const row of rows){
  let host=hosts.get(row.host);
  if(!host){host={host:row.host,count:0,failures:0,phases:Object.fromEntries(phases.map(k=>[k,{count:0,mean:null}]))};hosts.set(row.host,host);}
  host.count++;if(row.failed===true||row.status===0||row.status>=400)host.failures++;
  for(const phase of phases){const value=row.timings?.[phase];if(typeof value==='number'&&Number.isFinite(value)&&value>=0){const p=host.phases[phase];p.count++;p.mean=(p.mean??0)*((p.count-1)/p.count)+value/p.count;}}
 }
 return [...hosts.values()].sort((a,b)=>b.count-a.count||a.host.localeCompare(b.host));
}

// Quantiles describe retained requests only, not independent experiments.
export function summarizeNetworkEndpoints(rows){
 const groups=new Map();
 for(const row of rows){
  const key=JSON.stringify([row.method,row.host,row.path]);let group=groups.get(key);
  if(!group){group={method:row.method,host:row.host,path:row.path,count:0,failures:0,times:[]};groups.set(key,group);}
  group.count++;if(row.failed===true||row.status===0||row.status>=400)group.failures++;
  if(typeof row.timeMs==='number'&&Number.isFinite(row.timeMs)&&row.timeMs>=0)group.times.push(row.timeMs);
 }
 return [...groups.values()].map(({times,...group})=>{
  times.sort((a,b)=>a-b);const quantile=p=>times.length?times[Math.ceil(times.length*p)-1]:null;
  return {...group,timed:times.length,p50:quantile(.5),p95:quantile(.95),max:times.at(-1)??null};
 }).sort((a,b)=>b.count-a.count||a.host.localeCompare(b.host)||a.path.localeCompare(b.path)||a.method.localeCompare(b.method));
}

// Only entries with recorded start and duration can be positioned on a wall
// clock timeline. Overlap is descriptive and does not imply causation.
export function buildNetworkTimeline(rows,limit=200){
 if(!Array.isArray(rows)||!Number.isInteger(limit)||limit<1||limit>1000)throw new Error('网络时间线参数无效');
 const eligible=rows.filter(r=>Number.isFinite(r.startedAt)&&Number.isFinite(r.timeMs)&&r.timeMs>=0&&Number.isFinite(r.startedAt+r.timeMs)).slice().sort((a,b)=>a.startedAt-b.startedAt||a.id-b.id);
 if(!eligible.length)return {items:[],total:0,unavailable:rows.length,startMs:null,endMs:null,truncated:false};
 const visible=eligible.slice(0,limit),startMs=visible[0].startedAt,endMs=visible.reduce((max,r)=>Math.max(max,r.startedAt+r.timeMs),startMs),span=Math.max(endMs-startMs,1);
 return {startMs,endMs,total:eligible.length,unavailable:rows.length-eligible.length,truncated:eligible.length>visible.length,items:visible.map(row=>({id:row.id,host:row.host,path:row.path,method:row.method,status:row.status,failed:row.failed===true,timeMs:row.timeMs,startedAt:row.startedAt,left:(row.startedAt-startMs)/span,width:row.timeMs/span}))};
}

export function parseBenchmark(document) {
  if (!Array.isArray(document?.benchmarks)) throw new Error('不是 AndroidX Benchmark JSON，缺少 benchmarks');
  if (document.benchmarks.length > 10000) throw new Error('Benchmark 测试数量超过 10,000');
  const results = [];
  for (const benchmark of document.benchmarks) {
    if (!benchmark || typeof benchmark.name !== 'string' || !benchmark.name || typeof benchmark.className !== 'string' || !benchmark.className) continue;
    const params=benchmark.params??{};
    if(!params || typeof params!=='object' || Array.isArray(params) || Object.keys(params).length>100 || Object.values(params).some(v=>v!==null && (!['string','number','boolean'].includes(typeof v)||(typeof v==='number'&&!Number.isFinite(v))))) continue;
    const orderedParams=Object.fromEntries(Object.entries(params).sort(([a],[b])=>a.localeCompare(b)));
    const runInfo=Object.fromEntries(['warmupIterations','repeatIterations','thermalThrottleSleepSeconds','totalRunTimeNs'].flatMap(key=>{
      const value=benchmark[key];return Number.isSafeInteger(value)&&value>=0?[[key,value]]:[];
    }));
    for (const field of ['metrics', 'sampledMetrics']) {
      for (const [metric, value] of Object.entries(benchmark[field] || {})) {
        if (!value || typeof value !== 'object') continue;
        const groups=Array.isArray(value.runs)?value.runs:[];
        if(groups.length>100000)throw new Error('Benchmark 迭代数量超过限制');
        if(results.length>=50000)throw new Error('Benchmark 指标或样本超过限制');
        const sampleGroups=[],samples=[];
        for(const group of groups){
          const valid=[];
          for(const n of Array.isArray(group)?group:[group]){
            if(typeof n!=='number'||!Number.isFinite(n))continue;
            if(samples.length>=100000)throw new Error('Benchmark 指标或样本超过限制');
            samples.push(n);if(field==='sampledMetrics')valid.push(n);
          }
          if(field==='sampledMetrics')sampleGroups.push(valid);
        }
        const sorted=[...samples].sort((a,b)=>a-b),mid=Math.floor(sorted.length/2);
        const median = typeof value.median === 'number' && Number.isFinite(value.median) ? value.median : sorted.length ? (sorted.length%2?sorted[mid]:sorted[mid-1]/2+sorted[mid]/2) : null;
        if (median !== null) results.push({ key: JSON.stringify([benchmark.className,benchmark.name,orderedParams,field,metric]), name: benchmark.name, className: benchmark.className, params:orderedParams, metric, metricType:field, median, medianSource:typeof value.median==='number'&&Number.isFinite(value.median)?'reported':'computed', runs:samples.length, iterations:groups.length, samples,runInfo,...(field==='sampledMetrics'?{sampleGroups}:{}) });
      }
    }
  }
  if (!results.length) throw new Error('文件中没有可读取的 Benchmark 指标');
  return { context: document.context || {}, results };
}

// Quantiles describe recorded values; samples in a group need not be independent.
export function benchmarkSampleSummary(row){
 if(!row||!Array.isArray(row.samples))return null;
 const values=row.samples.filter(n=>typeof n==='number'&&Number.isFinite(n)).sort((a,b)=>a-b);
 if(!values.length)return {count:0,minimum:null,q1:null,median:null,q3:null,maximum:null,groups:Array.isArray(row.sampleGroups)?{iterations:row.sampleGroups.length,nonempty:0,medianMinimum:null,medianMaximum:null}:null};
 const quantile=(sorted,p)=>sorted[Math.max(0,Math.ceil(sorted.length*p)-1)];
 const middle=sorted=>sorted.length%2?sorted[Math.floor(sorted.length/2)]:sorted[sorted.length/2-1]/2+sorted[sorted.length/2]/2;
 let groups=null;
 if(Array.isArray(row.sampleGroups)){
  const medians=row.sampleGroups.filter(g=>Array.isArray(g)&&g.length).map(g=>middle([...g].sort((a,b)=>a-b))).sort((a,b)=>a-b);
  groups={iterations:row.sampleGroups.length,nonempty:medians.length,medianMinimum:medians[0]??null,medianMaximum:medians.at(-1)??null};
 }
 return {count:values.length,minimum:values[0],q1:quantile(values,.25),median:middle(values),q3:quantile(values,.75),maximum:values.at(-1),groups};
}

export function compareBenchmarks(baseline, current) {
  const group=results=>{const map=new Map();for(const r of results){const list=map.get(r.key)||[];list.push(r);map.set(r.key,list);}return map;};
  const before=group(baseline.results),after=group(current.results),keys=new Set([...after.keys(),...before.keys()]);
  return [...keys].map(key=>{const a=before.get(key)||[],b=after.get(key)||[],ambiguous=a.length>1||b.length>1,row=b[0]||a[0];
    const previous=a[0]?.median??null,next=b[0]?.median??null;
    const difference=!ambiguous&&previous!==null&&next!==null&&previous!==0?(next-previous)/Math.abs(previous)*100:null;
    return {...row,ambiguous,missing:!a.length?'baseline':!b.length?'current':null,baseline:ambiguous?null:previous,median:ambiguous?null:next,
      delta:Number.isFinite(difference)?difference:null,baselineRuns:a[0]?.runs??null};
  });
}

export function benchmarkContextWarnings(baseline,current) {
  const fields=[['设备型号',x=>x.build?.model],['设备代号',x=>x.build?.device],['系统版本',x=>x.build?.version?.sdk],['构建指纹',x=>x.build?.fingerprint],['编译模式',x=>x.compilationMode],['CPU 锁频',x=>x.cpuLocked],['CPU 核数',x=>x.cpuCoreCount],['CPU 最大频率',x=>x.cpuMaxFreqHz],['持续性能模式',x=>x.sustainedPerformanceModeEnabled],['ART 版本',x=>x.artMainlineVersion]];
  return fields.flatMap(([label,get])=>{const a=get(baseline.context||{}),b=get(current.context||{});return a===undefined||a===null||b===undefined||b===null?[`${label}缺失`]:a!==b?[`${label}不一致`]:[];});
}

// HPROF object IDs are snapshot-local. Match unambiguous class names only.
export function compareHeaps(baseline, current) {
  const group = heap => {
    const map=new Map();
    for(const row of heap.classes){
      const list=map.get(row.name)||[];list.push(row);map.set(row.name,list);
    }
    return map;
  };
  const before=group(baseline),after=group(current),names=new Set([...before.keys(),...after.keys()]);
  const bytesComparable=baseline.idSize===current.idSize;
  return [...names].map(name=>{
    const a=before.get(name)||[],b=after.get(name)||[];
    const ambiguous=a.length>1||b.length>1||name.startsWith('未知类 ');
    const previous=a[0]||null,next=b[0]||null;
    return {name,ambiguous,baseline:ambiguous?null:previous?.count??0,current:ambiguous?null:next?.count??0,
      countDelta:ambiguous?null:(next?.count??0)-(previous?.count??0),
      bytesDelta:ambiguous||!bytesComparable?null:(next?.payloadBytes??0)-(previous?.payloadBytes??0),
      countDeltaPercent:ambiguous||!previous?.count?null:((next?.count??0)-previous.count)/previous.count*100,
      bytesDeltaPercent:ambiguous||!bytesComparable||!previous?.payloadBytes?null:((next?.payloadBytes??0)-previous.payloadBytes)/previous.payloadBytes*100,
      currentId:ambiguous?null:next?.id??null};
  }).sort((a,b)=>a.ambiguous-b.ambiguous||Math.abs(b.bytesDelta??0)-Math.abs(a.bytesDelta??0)||a.name.localeCompare(b.name));
}

// Folded stacks carry event-period weights, not necessarily sample counts or time.
export function parseFoldedStacks(text) {
  if(typeof text!=='string'||!text.trim())throw new Error('调用栈文件为空');
  const lines=text.split(/\r?\n/);if(lines.length>100000)throw new Error('调用栈超过 100,000 行限制');
  const root={name:'所有线程',weight:0,self:0,children:[]},aggregate=new Map(),childrenIndex=new WeakMap();let stacks=0,nodes=1;
  for(const [i,line] of lines.entries()){
    if(!line.trim()||line.trimStart().startsWith('#'))continue;
    const match=line.match(/^(.+?)\s+(\d+)\s*$/);if(!match)throw new Error(`第 ${i+1} 行不是 folded stack 格式`);
    const frames=match[1].split(';').map(x=>x.trim()),weight=Number(match[2]);
    if(frames.length>128||frames.some(f=>!f||f.length>1000)||!Number.isSafeInteger(weight)||weight<=0)throw new Error(`第 ${i+1} 行的调用栈或权重无效`);
    if(!Number.isSafeInteger(root.weight+weight))throw new Error('权重总和超出安全范围');
    root.weight+=weight;let node=root;
    for(const frame of frames){let lookup=childrenIndex.get(node);if(!lookup){lookup=new Map();childrenIndex.set(node,lookup);}let child=lookup.get(frame);if(!child){if(++nodes>100000)throw new Error('调用树超过 100,000 节点限制');child={name:frame,weight:0,self:0,children:[]};lookup.set(frame,child);node.children.push(child);}child.weight+=weight;node=child;
      const a=aggregate.get(frame)||{name:frame,inclusive:0,self:0};a.inclusive+=weight;if(!Number.isSafeInteger(a.inclusive))throw new Error('函数汇总权重超出安全范围');aggregate.set(frame,a);
    }
    node.self+=weight;aggregate.get(frames.at(-1)).self+=weight;stacks++;
  }
  if(!stacks)throw new Error('文件中没有调用栈');
  const sort=node=>{node.children.sort((a,b)=>b.weight-a.weight);for(const child of node.children)sort(child);};sort(root);
  return {root,stacks,symbols:[...aggregate.values()].sort((a,b)=>b.self-a.self),note:'权重来自 folded stack 文件；可能是采样周期而不是采样次数，不直接表示 CPU 百分比。'};
}

// Each matching node represents one occurrence in the forward tree. Its
// inclusive weight is propagated toward its callers; recursive occurrences
// are counted separately, just as in the function summary.
export function reverseCallTree(scope, symbol) {
  if(!scope||typeof symbol!=='string'||!symbol)throw new Error('请选择有效函数');
  const root={name:symbol,weight:0,children:[]},lookup=new WeakMap(),stack=[{node:scope,ancestors:[]}];let matches=0,created=1;
  while(stack.length){
    const {node,ancestors}=stack.pop();
    if(node.name===symbol){
      matches++;root.weight+=node.weight;if(!Number.isSafeInteger(root.weight))throw new Error('反向调用树权重超出安全范围');
      let target=root;for(let i=ancestors.length-1;i>=0;i--){const name=ancestors[i].name;let map=lookup.get(target);if(!map){map=new Map();lookup.set(target,map);}let next=map.get(name);if(!next){if(++created>100000)throw new Error('反向调用树超过 100,000 个节点');next={name,weight:0,children:[]};map.set(name,next);target.children.push(next);}next.weight+=node.weight;target=next;}
    }
    for(let i=node.children.length-1;i>=0;i--)stack.push({node:node.children[i],ancestors:[...ancestors,node]});
  }
  const pending=[root];while(pending.length){const node=pending.pop();node.children.sort((a,b)=>b.weight-a.weight);for(const child of node.children)pending.push(child);}
  return {root,matches};
}

// Positions are normalized to the selected root's event-period weight.
export function layoutFlame(root,{maxDepth=40,maxNodes=3000}={}) {
  if(!root||!Number.isFinite(root.weight)||root.weight<=0)throw new Error('火焰图缺少有效权重');
  const frames=[],pending=[{node:root,x:0,width:1,depth:0,path:[]}];let truncated=false,depth=0;
  while(pending.length){
    if(frames.length>=maxNodes){truncated=true;break;}
    const frame=pending.pop();frames.push(frame);depth=Math.max(depth,frame.depth);
    if(frame.depth>=maxDepth){if(frame.node.children.length)truncated=true;continue;}
    let cursor=frame.x;const children=[];
    for(let i=0;i<frame.node.children.length;i++){
      const node=frame.node.children[i],width=frame.width*node.weight/frame.node.weight;
      children.push({node,x:cursor,width,depth:frame.depth+1,path:[...frame.path,i]});cursor+=width;
    }
    for(let i=children.length-1;i>=0;i--)pending.push(children[i]);
  }
  return {frames,depth,truncated};
}

export function buildSampleTimeline(input, bins=60) {
  if(!input||!Array.isArray(input.samples)||!Number.isInteger(bins)||bins<1||bins>200)throw new Error('时间线数据无效');
  let origin=null,last=null,skipped=0;const valid=[];
  for(const s of input.samples){
    try{
      if(!/^\d+$/.test(s.timeNs)||!/^\d+$/.test(s.period)||!Array.isArray(s.frames)||s.frames.length>127||!Number.isSafeInteger(s.pid)||!Number.isSafeInteger(s.tid))throw Error();
      const time=BigInt(s.timeNs),weight=Number(s.period);if(time===0n||!Number.isSafeInteger(weight)||weight<=0)throw Error();
      if(s.frames.some(f=>typeof f!=='string'||!f||f.length>1000||/[;\r\n]/.test(f))||typeof s.thread!=='string'||/[;\r\n]/.test(s.thread))throw Error();
      if(origin===null||time<origin)origin=time;if(last===null||time>last)last=time;
      valid.push({time,weight,frames:s.frames,thread:`${s.thread}-${s.pid}/${s.tid}`,pid:s.pid,tid:s.tid});
    }catch{skipped++;}
  }
  if(!valid.length)return {available:false,skipped,truncated:!!input.truncated,event:input.event||'未知事件'};
  const span=last-origin;if(span>604800000000000n)throw new Error('时间线超过 7 天范围');
  const groups=new Map();
  for(const s of valid){s.bin=span===0n?0:Math.min(bins-1,Number((s.time-origin)*BigInt(bins)/span));
    let g=groups.get(s.thread);if(!g){g={thread:s.thread,pid:s.pid,tid:s.tid,counts:Array(bins).fill(0),weights:Array(bins).fill(0),total:0};groups.set(s.thread,g);}
    g.counts[s.bin]++;g.weights[s.bin]+=s.weight;g.total+=s.weight;if(!Number.isSafeInteger(g.total))throw new Error('时间线权重超出安全范围');
  }
  return {available:true,event:input.event||'未知事件',durationMs:Number(span)/1e6,bins,groups:[...groups.values()].sort((a,b)=>b.total-a.total),samples:valid,skipped,truncated:!!input.truncated};
}
// Count observed sample records only, not inferred lost samples or CPU time.
export function sampleQuality(timeline){
 if(!timeline?.available||!Array.isArray(timeline.samples))return null;
 let unknownLeaf=0,noCallers=0,unknownLeafWeight=0;
 for(const sample of timeline.samples){
  if(sample.frames.length===1)noCallers++;
  if(sample.frames.at(-1)==='unknown'){unknownLeaf++;if(unknownLeafWeight!==null){unknownLeafWeight+=sample.weight;if(!Number.isSafeInteger(unknownLeafWeight))unknownLeafWeight=null;}}
 }
 return {samples:timeline.samples.length,unknownLeaf,noCallers,unknownLeafWeight,skipped:timeline.skipped||0,truncated:!!timeline.truncated};
}
// Summarize observed leaf-frame weights per time bin. This is a sampled trend,
// not CPU time or an estimate of inclusive function cost.
export function sampleStackChart(timeline, limit=8) {
 if(!timeline?.available||!Array.isArray(timeline.samples)||!Number.isInteger(limit)||limit<1||limit>12)throw new Error('函数时间图数据无效');
 const totals=new Map();
 for(const sample of timeline.samples){const name=sample.frames.at(-1)||'(无调用栈)';totals.set(name,(totals.get(name)||0)+sample.weight);if(!Number.isSafeInteger(totals.get(name)))throw new Error('函数时间图权重超出安全范围');}
 const names=[...totals].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,limit).map(([name])=>name);
 const bins=Array.from({length:timeline.bins},()=>new Map(names.map(name=>[name,0])));
 const other='其他函数';
 for(const sample of timeline.samples){const leaf=sample.frames.at(-1)||'(无调用栈)',name=names.includes(leaf)?leaf:other,bin=bins[sample.bin];bin.set(name,(bin.get(name)||0)+sample.weight);if(!Number.isSafeInteger(bin.get(name)))throw new Error('函数时间图权重超出安全范围');}
 const series=names.map(name=>({name,total:totals.get(name),values:bins.map(bin=>bin.get(name)||0)}));
 const otherTotal=[...totals].filter(([name])=>!names.includes(name)).reduce((sum,[,weight])=>sum+weight,0);
 if(!Number.isSafeInteger(otherTotal))throw new Error('函数时间图权重超出安全范围');
 if(otherTotal)series.push({name:other,total:otherTotal,values:bins.map(bin=>bin.get(other)||0)});
 const binTotals=bins.map(bin=>[...bin.values()].reduce((sum,weight)=>sum+weight,0));
 if(binTotals.some(total=>!Number.isSafeInteger(total)))throw new Error('函数时间图权重超出安全范围');
 return {bins:timeline.bins,series,totals:binTotals};
}
export function profileForTimeBin(timeline,bin,thread=null) {
  if(!timeline?.available||!Number.isInteger(bin)||bin<0||bin>=timeline.bins)throw new Error('时间范围无效');
  if(thread!==null&&typeof thread!=='string')throw new Error('线程筛选无效');
  const lines=timeline.samples.filter(s=>s.bin===bin&&(thread===null||s.thread===thread)).map(s=>`${[s.thread,...s.frames].join(';')} ${s.weight}`);
  if(!lines.length)throw new Error('所选时间范围没有样本');
  return parseFoldedStacks(lines.join('\n'));
}

export function profileForTimeRange(timeline,startMs,endMs,thread=null) {
  if(!timeline?.available||!Number.isFinite(startMs)||!Number.isFinite(endMs)||startMs<0||endMs<startMs||endMs>timeline.durationMs)throw new Error('时间范围无效，请输入快照范围内的起止毫秒');
  if(thread!==null&&typeof thread!=='string')throw new Error('线程筛选无效');
  const origin=timeline.samples.reduce((a,s)=>s.time<a?s.time:a,timeline.samples[0].time);
  const start=BigInt(Math.round(startMs*1e6)),end=BigInt(Math.round(endMs*1e6));
  const lines=timeline.samples.filter(s=>{const delta=s.time-origin;return delta>=start&&delta<=end&&(thread===null||s.thread===thread);}).map(s=>`${[s.thread,...s.frames].join(';')} ${s.weight}`);
  if(!lines.length)throw new Error('所选时间范围没有采样点');
  return parseFoldedStacks(lines.join('\n'));
}

function parseComposeCsv(text){
 const records=[];let row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++;}else if(c==='"')quoted=false;else field+=c;}
  else if(c==='"'){if(field)throw new Error('Compose CSV 引号位置无效');quoted=true;}
  else if(c===','){row.push(field);field='';}
  else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);field='';if(row.some(v=>v!==''))records.push(row);row=[];if(records.length>100001)throw new Error('Compose CSV 行数超过 100,000');}
  else field+=c;
  if(field.length>65536)throw new Error('Compose CSV 单元格超过 64 KiB');
 }
 if(quoted)throw new Error('Compose CSV 引号未闭合');if(field||row.length){row.push(field);records.push(row);}
 if(records.length<2)throw new Error('Compose CSV 缺少表头或数据行');
 const headers=records[0].map(x=>x.trim()),indices=new Map(headers.map((h,i)=>[h,i]));
 if(!indices.has('name')||!indices.has('composable')||!indices.has('skippable')||!indices.has('restartable'))throw new Error('不是受支持的 Compose composables.csv（缺少必要列）');
 const textAt=(r,key)=>{const i=indices.get(key);return i===undefined?'':r[i]||'';},flag=(r,key)=>{const value=textAt(r,key);if(value==='1')return true;if(value==='0'||value==='')return false;throw new Error(`Compose CSV ${key} 列含无效标志`);},count=(r,key)=>{const value=textAt(r,key);if(value===''||value===undefined)return null;if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))throw new Error(`Compose CSV ${key} 列含无效数字`);return Number(value);};
 const rows=[];
 for(const r of records.slice(1)){
  if(r.length!==headers.length)throw new Error('Compose CSV 列数不一致');
  if(!flag(r,'composable'))continue;
  const name=textAt(r,'name');if(!name||name.length>1000)throw new Error('Compose CSV 函数名无效');
  rows.push({package:textAt(r,'package'),name,skippable:flag(r,'skippable'),restartable:flag(r,'restartable'),readonly:flag(r,'readonly'),inline:flag(r,'inline'),isLambda:flag(r,'isLambda'),hasDefaults:flag(r,'hasDefaults'),defaultsGroup:count(r,'defaultsGroup'),groups:count(r,'groups'),calls:count(r,'calls'),unstableParameters:[],parameters:[]});
  if(rows.length>100000)throw new Error('Compose composable 数量超过 100,000');
 }
 if(!rows.length)throw new Error('Compose CSV 没有标记为 composable 的行');
 return {type:'composables',rows,summary:{composables:rows.length,skippable:rows.filter(x=>x.skippable).length,restartable:rows.filter(x=>x.restartable).length,withUnstableParameters:null},sourceFormat:'csv'};
}

function parseComposeText(text){
 const lines=text.split(/\r?\n/),composables=[],classes=[];
 for(let i=0;i<lines.length;i++){
  const line=lines[i],trim=line.trim();
  if(/\b(?:restartable|skippable|readonly)\b|\bscheme\s*\(/.test(trim)&&/\bfun\s+/.test(trim)){
   const match=trim.match(/\bfun\s+(?:<[^>]+>\s*)?([A-Za-z_$][\w.$<>-]*)\s*\(/);if(!match)continue;
   const open=trim.indexOf('(',match.index+match[0].length-1);let depth=1,block=trim.slice(open+1),j=i;
   for(;j<lines.length&&depth>0;j++){
    const part=j===i?trim.slice(open+1):lines[j];if(j!==i)block+=`\n${part}`;
    let string=null,escape=false;
    for(const c of part){if(string){if(escape)escape=false;else if(c==='\\')escape=true;else if(c===string)string=null;}else if(c==='"'||c==="'")string=c;else if(c==='(')depth++;else if(c===')')depth--;}
   }
   if(depth!==0)throw new Error('Compose composable 函数参数未闭合');
   const parameters=[];
   for(const parameterLine of block.split(/\r?\n/)){
    const p=parameterLine.match(/^\s*(stable|unstable|runtime)\s+([^:\s]+)\s*:/);if(p)parameters.push({stability:p[1],name:p[2]});
   }
   const unstableParameters=parameters.filter(p=>p.stability==='unstable').map(p=>p.name);
   const prefix=trim.slice(0,match.index);
   composables.push({package:'',name:match[1],skippable:/\bskippable\b/.test(prefix),restartable:/\brestartable\b/.test(prefix),readonly:/\breadonly\b/.test(prefix),inline:false,isLambda:false,hasDefaults:/@(?:static|dynamic)\b/.test(block),defaultsGroup:null,groups:null,calls:null,parameters,unstableParameters});
   i=Math.max(i,j-1);
   if(composables.length>100000)throw new Error('Compose composable 数量超过 100,000');
   continue;
  }
  const classMatch=trim.match(/^(stable|unstable|runtime)\s+class\s+(.+?)\s*\{\s*$/);if(!classMatch)continue;
  const fields=[];let j=i+1;
  for(;j<lines.length&&lines[j].trim()!=='}';j++){
   const f=lines[j].trim().match(/^(stable|unstable|runtime)\s+(?:val|var)\s+(.+?)\s*:\s*(.+)$/);if(f)fields.push({stability:f[1],name:f[2],type:f[3]});
  }
  const runtime=lines.slice(i+1,j+1).map(x=>x.trim()).find(x=>/^<runtime stability>\s*=/.test(x))||null;
  classes.push({stability:classMatch[1],name:classMatch[2],fields,runtime});i=j;
  if(classes.length>100000)throw new Error('Compose class 数量超过 100,000');
 }
 if(composables.length)return {type:'composables',rows:composables,summary:{composables:composables.length,skippable:composables.filter(x=>x.skippable).length,restartable:composables.filter(x=>x.restartable).length,withUnstableParameters:composables.filter(x=>x.unstableParameters.length).length},sourceFormat:'txt'};
 if(classes.length)return {type:'classes',rows:classes,summary:{classes:classes.length,unstable:classes.filter(x=>x.stability==='unstable').length,unstableFields:classes.reduce((n,x)=>n+x.fields.filter(f=>f.stability==='unstable').length,0)},sourceFormat:'txt'};
 throw new Error('无法识别 Compose Compiler composables.txt 或 classes.txt 报告');
}

export function parseComposeCompilerReport(text,filename=''){
 if(typeof text!=='string'||text.length>12*1024*1024)throw new Error('Compose Compiler 报告超过 12 MiB 或格式无效');
 if(text.charCodeAt(0)===0xfeff)text=text.slice(1);
 if(!text.trim())throw new Error('Compose Compiler 报告为空');
 const csv=/\.csv$/i.test(filename)||/^\s*package\s*,\s*name\s*,\s*composable\s*,/i.test(text);
 return csv?parseComposeCsv(text):parseComposeText(text);
}

// UIAutomator nodes are recorded in preorder, so a subtree ends at the next
// node at the same or shallower depth. Keep the original IDs for selection.
export function layoutScope(nodes, rootId = null) {
  if (rootId === null) return nodes;
  const start = nodes.findIndex(node => node.id === rootId);
  if (start < 0) return [];
  let end = start + 1;
  while (end < nodes.length && nodes[end].depth > nodes[start].depth) end++;
  return nodes.slice(start, end);
}

// Accessibility snapshots may omit fields or descendants. Report candidates
// only when the recorded subtree has explicit, empty label fields throughout.
export function inspectLayout(nodes,{densityDpi=null}={}){
 if(!Array.isArray(nodes))throw new Error('层级节点无效');
 const densityScale=Number.isFinite(densityDpi)&&densityDpi>0&&densityDpi<=1000?densityDpi/160:null;
 const findings=[],stack=[];
 const flush=()=>{const item=stack.pop(),a=item.node.attributes||{};
  const interactive=a.clickable==='true'||a['long-clickable']==='true'||a.checkable==='true';
  if(interactive&&a.enabled!=='false'){
   if(item.complete&&!item.label)findings.push({id:item.node.id,kind:'unlabelled'});
   const b=item.node.bounds;if(Array.isArray(b)&&b.length===4&&b.every(Number.isFinite)&&b[2]>=b[0]&&b[3]>=b[1]){
    const width=b[2]-b[0],height=b[3]-b[1];
    if(width===0||height===0)findings.push({id:item.node.id,kind:'emptyBounds'});
    else if(densityScale&&(width/densityScale<48||height/densityScale<48))findings.push({id:item.node.id,kind:'smallTouchTarget',widthDp:width/densityScale,heightDp:height/densityScale});
   }
  }
  if(stack.length){stack.at(-1).label||=item.label;stack.at(-1).complete&&=item.complete;}
 };
 for(const node of nodes){while(stack.length&&stack.at(-1).node.depth>=node.depth)flush();const a=node.attributes||{};
  const complete=typeof a.text==='string'&&typeof a['content-desc']==='string';
  const label=!!(a.text?.trim()||a['content-desc']?.trim());stack.push({node,complete,label});
 }
 while(stack.length)flush();
 return findings;
}

// Repeated IDs may be compared within a shared unique ancestor when each
// snapshot contains exactly one such node in that ancestor's scope.
// Refuse partial trees: missing descendants could turn into false removals,
// or conceal labels when inspecting clickable nodes.
export function extractLayoutNodes(root,{maxNodes=10000,maxDepth=100}={}) {
 const nodes=[];
 function walk(element,depth){
  if(depth>maxDepth)throw new Error(`层级深度超过 ${maxDepth}，无法完整分析`);
  if(element.tagName==='node'){
   if(nodes.length>=maxNodes)throw new Error(`层级节点超过 ${maxNodes}，无法完整分析`);
   const attributes=Object.fromEntries([...element.attributes].map(a=>[a.name,a.value]));
   const bounds=attributes.bounds?.match(/^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/)?.slice(1).map(Number);
   nodes.push({id:nodes.length,depth,attributes,bounds,className:attributes.class?.split('.').at(-1)||'Node'});
  }
  for(const child of element.children)walk(child,depth+(element.tagName==='node'?1:0));
 }
 walk(root,0);return nodes;
}

export function compareLayouts(before, after) {
  function index(nodes) {
    const map=new Map();let unkeyed=0;
    for(const node of nodes){const id=node.attributes['resource-id'];if(!id){unkeyed++;continue;}const key=`${node.attributes.package||''}\0${id}`;const list=map.get(key)||[];list.push(node);map.set(key,list);}
    return {map,unkeyed};
  }
  const a=index(before),b=index(after),changes=[],ambiguous=[];
  // Only shared, unique resource IDs are usable as stable ancestry anchors.
  // Unkeyed or duplicate containers are skipped rather than guessed.
  const anchors=new Set([...a.map.keys()].filter(key=>a.map.get(key).length===1&&b.map.get(key)?.length===1));
  function parents(nodes){
    const result=new Map(),stack=[];
    for(const node of nodes){
      while(stack.length&&stack.at(-1).depth>=node.depth)stack.pop();
      const id=node.attributes['resource-id'],key=id?`${node.attributes.package||''}\0${id}`:null;
      result.set(node,stack.at(-1)?.anchor??null);
      const anchor=key&&anchors.has(key)?key:(stack.at(-1)?.anchor??null);
      stack.push({depth:node.depth,anchor});
    }
    return result;
  }
  const oldParents=parents(before),newParents=parents(after);
  // Compare relative order only for globally unique children of the same
  // directly matched parent. Insertions and removals alone are not reorders.
  function siblingGroups(nodes){
    const stack=[],groups=new Map();
    for(const node of nodes){
      while(stack.length&&stack.at(-1).depth>=node.depth)stack.pop();
      const id=node.attributes['resource-id'],key=id?`${node.attributes.package||''}\0${id}`:null;
      const parent=stack.at(-1),parentKey=parent?.key;
      if(key&&anchors.has(key)&&parentKey&&anchors.has(parentKey)){
        const group=groups.get(parentKey)||[];group.push(key);groups.set(parentKey,group);
      }
      stack.push({depth:node.depth,key});
    }
    return groups;
  }
  const oldGroups=siblingGroups(before),newGroups=siblingGroups(after),reordered=new Set();
  for(const [parent,oldList] of oldGroups){
    const next=newGroups.get(parent);if(!next)continue;
    const positions=new Map(oldList.map((key,i)=>[key,i]));
    const shared=next.filter(key=>positions.has(key)),ranks=shared.map(key=>positions.get(key));
    let max=-1;const earlier=[];
    for(const rank of ranks){earlier.push(max);max=Math.max(max,rank);}
    let min=Infinity;
    for(let i=ranks.length-1;i>=0;i--){if(earlier[i]>ranks[i]||min<ranks[i])reordered.add(shared[i]);min=Math.min(min,ranks[i]);}
  }
  function comparePair(id,previous,current,matchScope=null){
    const fields=[...new Set([...Object.keys(previous.attributes),...Object.keys(current.attributes)])].filter(k=>previous.attributes[k]!==current.attributes[k]).sort();
    const oldParent=oldParents.get(previous),newParent=newParents.get(current),moved=oldParent!==newParent;
    const key=`${previous.attributes.package||''}\0${id}`,orderChanged=!matchScope&&reordered.has(key);
    if(fields.length||moved||orderChanged)changes.push({id,kind:'changed',before:previous,after:current,fields,moved,orderChanged,oldParent:oldParent?.split('\0')[1]||null,newParent:newParent?.split('\0')[1]||null,matchScope});
  }
  for(const key of new Set([...a.map.keys(),...b.map.keys()])){
    const old=a.map.get(key)||[],now=b.map.get(key)||[];
    const previous=old[0],current=now[0],id=key.split('\0')[1];
    if(old.length>1||now.length>1){
      const group=(nodes,parents)=>{const map=new Map();for(const node of nodes){const parent=parents.get(node);if(parent===null||parent===undefined)continue;const list=map.get(parent)||[];list.push(node);map.set(parent,list);}return map;};
      const left=group(old,oldParents),right=group(now,newParents);let paired=0;
      for(const [parent,items] of left){const matches=right.get(parent);if(items.length===1&&matches?.length===1){comparePair(id,items[0],matches[0],parent.split('\0')[1]);paired++;}}
      if(paired!==old.length||paired!==now.length)ambiguous.push(id);
      continue;
    }
    if(!previous||!current){changes.push({id,kind:previous?'removed':'added',before:previous||null,after:current||null,fields:[]});continue;}
    comparePair(id,previous,current);
  }
  return {changes,ambiguous,unkeyedBefore:a.unkeyed,unkeyedAfter:b.unkeyed};
}

export function summarizeLayoutChanges(before,after){
  const diff=compareLayouts(before,after),summary={added:0,removed:0,changed:0,ambiguous:diff.ambiguous.length};
  for(const change of diff.changes)summary[change.kind]++;
  return summary;
}

export function layoutDiffOverlays(changes,limit=500,side='after'){
  if(!Array.isArray(changes)||!Number.isInteger(limit)||limit<0||!['before','after'].includes(side))throw new Error('布局差异边界参数无效');
  return changes.filter(change=>{
    if(side==='before'&&change?.kind!=='removed'&&!change?.moved&&!change?.orderChanged)return false;
    const bounds=change?.[side]?.bounds;
    return Array.isArray(bounds)&&bounds.length===4&&bounds.every(Number.isFinite)&&bounds[2]>=bounds[0]&&bounds[3]>=bounds[1];
  }).slice(0,limit).map(change=>({id:change.id,kind:change.kind==='added'?'added':change.kind==='removed'?'removed':change.moved||change.orderChanged?'moved':'changed',bounds:[...change[side].bounds]}));
}

export function layoutComparisonReport(baseline,current,generatedAt=Date.now()) {
  if(!Array.isArray(baseline?.nodes)||!Array.isArray(current?.nodes))throw new Error('需要两份布局快照');
  const diff=compareLayouts(baseline.nodes,current.nodes);
  return {schemaVersion:1,kind:'layout-comparison',generatedAt,
    baseline:{name:baseline.name||null,source:baseline.source||null,timestamp:baseline.timestamp??null,nodeCount:baseline.nodes.length},
    current:{name:current.name||null,source:current.source||null,timestamp:current.timestamp??null,nodeCount:current.nodes.length},
    limitations:'按包名与资源 ID 匹配；重复 ID 在共同唯一祖先内仅作候选匹配。无 ID 节点和无法消歧的重复 ID 不参与匹配；层级采集不一定完整。',
    ...diff};
}

// A cluster is a run of adjacent, valid, over-budget records in one PROFILEDATA
// section, with nondecreasing start times no more than 100 ms apart. Missing,
// flagged and invalid records break runs, as do separate window sections.
export function clusterFrames(frames, budgetMs, maxGapMs = 100) {
  const clusters=[];let run=[];
  const flush=()=>{if(run.length>=2)clusters.push({first:run[0].index,last:run.at(-1).index,count:run.length,maxMs:run.reduce((max,f)=>Math.max(max,f.durationMs),0),section:run[0].section});run=[];};
  for(const frame of frames){
    if(!Number.isInteger(frame.section)||!Number.isInteger(frame.rawIndex)||!/^\d{1,19}$/.test(frame.startNsExact||'')||!Number.isFinite(frame.durationMs)||frame.durationMs<=budgetMs){flush();continue;}
    if(run.length){const previous=run.at(-1),gap=BigInt(frame.startNsExact)-BigInt(previous.startNsExact);
      if(frame.section!==previous.section||frame.rawIndex!==previous.rawIndex+1||gap<0n||gap>BigInt(Math.round(maxGapMs*1e6)))flush();}
    run.push(frame);
  }
  flush();return clusters;
}

// Group consecutive deadline-miss records on the same Perfetto track. Events
// from other tracks do not break a run; ordinary events on this track do.
export function clusterFrameTimeline(frames) {
  const active=new Map(),clusters=[];
  const flush=key=>{const run=active.get(key);if(run?.indices.length>=2)clusters.push(run);active.delete(key);};
  for(let i=0;i<frames.length;i++){
    const frame=frames[i],track=frame.trackId;if(!track||!/^\d+$/.test(track)||!/^\-?\d+$/.test(frame.tsNs||''))continue;
    const reasons=String(frame.jankType||'').split(',').map(x=>x.trim());
    const missed=reasons.some(x=>['App Deadline Missed','SurfaceFlinger CPU Deadline Missed','SurfaceFlinger GPU Deadline Missed'].includes(x));
    if(!missed){flush(track);continue;}
    const previous=active.get(track),time=BigInt(frame.tsNs);
    if(previous){const gap=time-BigInt(previous.endNs);if(gap<=0n||gap>100000000n)flush(track);}
    let run=active.get(track);if(!run){run={trackId:track,process:frame.process,layer:frame.layer,startNs:frame.tsNs,endNs:frame.tsNs,indices:[]};active.set(track,run);}
    run.endNs=frame.tsNs;run.indices.push(i);
  }
  for(const key of [...active.keys()])flush(key);
  return clusters.sort((a,b)=>BigInt(a.startNs)<BigInt(b.startNs)?-1:BigInt(a.startNs)>BigInt(b.startNs)?1:0);
}

// Keep timestamps exact; clamp context around an event to the retained trace.
export function traceEventWindow(bounds,tsNs,durationNs,paddingNs='20000000') {
 if(!bounds||! /^-?\d{1,19}$/.test(bounds.startNs||'')||! /^-?\d{1,19}$/.test(bounds.endNs||'')||! /^-?\d{1,19}$/.test(tsNs||'')||! /^\d{1,19}$/.test(durationNs||'')||! /^\d{1,19}$/.test(paddingNs||''))throw new Error('事件或追踪时间无效');
 const first=BigInt(bounds.startNs),last=BigInt(bounds.endNs),ts=BigInt(tsNs),duration=BigInt(durationNs),padding=BigInt(paddingNs);
 if(last<=first||ts>=last||ts+duration<first)throw new Error('事件不在当前追踪范围');
 const start=ts-padding<first?first:ts-padding,end=ts+duration+padding>last?last:ts+duration+padding;
 if(end<=start)throw new Error('事件时间窗口无效');return {startNs:start.toString(),endNs:end.toString()};
}
