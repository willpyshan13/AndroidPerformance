import { access, mkdtemp, open, rm } from 'node:fs/promises';
import { constants, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec=promisify(execFile),MAX=256*1024*1024;
const root=dirname(dirname(fileURLToPath(import.meta.url)));
export async function locateTraceProcessor(){
  const paths=[process.env.TRACE_PROCESSOR_PATH,process.resourcesPath&&join(process.resourcesPath,'trace-processor','trace_processor_shell'),join(root,'tools','trace-processor','trace_processor_shell')].filter(Boolean);
  for(const path of paths)try{await access(path,constants.X_OK);return path;}catch{}
  throw new Error('未找到 Trace Processor；macOS 请运行 npm run prepare:trace-processor 或设置 TRACE_PROCESSOR_PATH');
}
export const TRACE_QUERY=`
SELECT 'bounds' AS kind, 'trace' AS label, CAST(start_ts AS TEXT) AS count, CAST(end_ts AS TEXT) AS value FROM trace_bounds
UNION ALL SELECT 'slice', hex(CAST(label AS BLOB)), CAST(n AS TEXT), CAST(ms AS TEXT) FROM (SELECT COALESCE(name,'(未命名)') AS label, COUNT(*) AS n, ROUND(SUM(dur)/1000000.0,3) AS ms FROM slice WHERE dur >= 0 GROUP BY name ORDER BY SUM(dur) DESC LIMIT 100)
UNION ALL SELECT 'thread', hex(CAST(label AS BLOB)), CAST(n AS TEXT), CAST(ms AS TEXT) FROM (SELECT COALESCE(process.name,'?') || ' / ' || COALESCE(thread.name,'?') || ' (' || thread.tid || ')' AS label, COUNT(*) AS n, ROUND(SUM(sched.dur)/1000000.0,3) AS ms FROM sched JOIN thread USING(utid) LEFT JOIN process USING(upid) WHERE sched.dur >= 0 GROUP BY thread.utid ORDER BY SUM(sched.dur) DESC LIMIT 100)
UNION ALL SELECT 'binder', hex(CAST(label AS BLOB)), CAST(n AS TEXT), CAST(ms AS TEXT) FROM (SELECT COALESCE(name,'(未命名)') AS label, COUNT(*) AS n, ROUND(SUM(dur)/1000000.0,3) AS ms FROM slice WHERE dur >= 0 AND LOWER(name) LIKE '%binder%' GROUP BY name ORDER BY SUM(dur) DESC LIMIT 100)
UNION ALL SELECT 'error', hex(CAST(name AS BLOB)), CAST(value AS TEXT), severity FROM (SELECT name,value,severity FROM stats WHERE severity IN ('error','data_loss') AND value > 0 LIMIT 200)
UNION ALL SELECT 'slice_event', label, ts, dur FROM (SELECT hex(CAST(COALESCE(slice.name,'(未命名)') AS BLOB)) || ':' || hex(CAST(COALESCE(thread.name,track.name,'轨道 ' || track.id) AS BLOB)) || ':' || track.id || ':' || COALESCE(thread.tid,'') || ':' || COALESCE(slice.depth,0) || ':' || slice.id AS label, CAST(slice.ts AS TEXT) AS ts, CAST(slice.dur AS TEXT) AS dur FROM slice JOIN track ON track.id=slice.track_id LEFT JOIN thread_track ON thread_track.id=track.id LEFT JOIN thread ON thread.utid=thread_track.utid WHERE slice.dur >= 0 ORDER BY slice.ts LIMIT 3001)
UNION ALL SELECT 'sched_event', label, ts, dur FROM (SELECT sched.cpu || ':' || hex(CAST(COALESCE(thread.name,'?') AS BLOB)) || ':' || thread.tid || ':' || COALESCE(process.pid,'') AS label, CAST(sched.ts AS TEXT) AS ts, CAST(sched.dur AS TEXT) AS dur FROM sched JOIN thread USING(utid) LEFT JOIN process USING(upid) WHERE sched.dur >= 0 ORDER BY sched.ts LIMIT 3001)`;
export function parseCsv(text){
  const rows=[];let row=[],field='',quoted=false,afterQuote=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;afterQuote=true;}}else field+=c;continue;}
    if(c==='"'&&!field&&!afterQuote){quoted=true;continue;}if(c===','){row.push(field);field='';afterQuote=false;continue;}
    if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);rows.push(row);row=[];field='';afterQuote=false;continue;}
    if(afterQuote)throw new Error('Trace Processor CSV 输出格式无效');field+=c;
  }
  if(quoted)throw new Error('Trace Processor CSV 输出被截断');if(row.length||field){row.push(field);rows.push(row);}return rows;
}
export function buildReadOnlyTraceQuery(input){
 if(typeof input!=='string'||Buffer.byteLength(input,'utf8')<1||Buffer.byteLength(input,'utf8')>16*1024||input.includes('\0'))throw new Error('SQL 查询必须为 1–16 KiB 文本');
 if(/--|\/\*|\*\//.test(input)||/["`]/.test(input))throw new Error('SQL 查询暂不接受注释或带引号的标识符');
 let sql=input.trim(),module='';
 if(/^INCLUDE\b/i.test(sql)){
   const match=sql.match(/^INCLUDE\s+PERFETTO\s+MODULE\s+([a-zA-Z0-9_.]+)\s*;\s*/i);
   if(!match)throw new Error('仅支持标准 INCLUDE PERFETTO MODULE 声明');module=match[0];sql=sql.slice(match[0].length);
 }
 sql=sql.replace(/;\s*$/,'').trim();if(!sql)throw new Error('每次只能执行一条 SQL 查询');
 let visible='',quoted=false;
 for(let i=0;i<sql.length;i++){const c=sql[i];if(quoted){if(c==="'"&&sql[i+1]==="'"){visible+='  ';i++;}else if(c==="'"){quoted=false;visible+=' ';}else visible+=' ';}else if(c==="'"){quoted=true;visible+=' ';}else visible+=c;}
 if(quoted)throw new Error('SQL 字符串没有闭合');
 if(visible.includes(';'))throw new Error('每次只能执行一条 SQL 查询');
 if(!/^\s*(SELECT|WITH)\b/i.test(visible))throw new Error('只允许 SELECT 或 WITH 查询');
 if(/\b(ATTACH|DETACH|PRAGMA|CREATE|DROP|INSERT|UPDATE|DELETE|REPLACE|VACUUM|SAVEPOINT|BEGIN|COMMIT|ROLLBACK|LOAD_EXTENSION|READFILE|WRITEFILE)\b/i.test(visible))throw new Error('查询包含不允许的写入或外部文件操作');
 return `${module}SELECT * FROM (${sql}) LIMIT 501`;
}
export async function queryTraceSql(path,{sql,locator=locateTraceProcessor,runner=exec}={}){
 const query=buildReadOnlyTraceQuery(sql),binary=await locator();let output;
 try{output=await runner(binary,['--no-agent','--quiet','query',path,query],{timeout:120000,maxBuffer:4*1024*1024,encoding:'utf8',windowsHide:true});}
 catch(error){throw new Error(`自定义追踪查询失败：${String(error.stderr||error.message).slice(0,1200)}`);}
 const rows=parseCsv(output.stdout);if(!rows.length||!rows[0].length||rows[0].length>50)throw new Error('SQL 查询没有返回可显示的列，或列数超过 50');
 const columns=rows[0];if(columns.some(name=>Buffer.byteLength(name,'utf8')>200))throw new Error('SQL 列名过长');
 const data=rows.slice(1);if(data.some(row=>row.length!==columns.length))throw new Error('SQL 查询返回了不完整的行');
 return {columns,rows:data.slice(0,500),truncated:data.length>500};
}
export function parseTraceSummary(csv){
  const rows=parseCsv(csv),header=rows.shift();if(!header||header.join(',')!=='kind,label,count,value')throw new Error('Trace Processor 返回了意外的列');
  const result={bounds:null,slices:[],threads:[],binder:[],errors:[],sliceEvents:[],schedEvents:[],truncated:{slices:false,sched:false}};
  const decode=hex=>{if(!/^(?:[0-9A-Fa-f]{2})*$/.test(hex))throw new Error('追踪文本编码无效');return Buffer.from(hex,'hex').toString('utf8');};
  for(const row of rows){if(row.length!==4)throw new Error('Trace Processor 返回了不完整的行');const [kind,label,count,value]=row;
    if(kind==='bounds'){if(!/^-?\d+$/.test(count)||!/^-?\d+$/.test(value)||BigInt(value)<BigInt(count))throw new Error('追踪时间范围无效');result.bounds={startNs:count,endNs:value};}
    else if(['slice','thread','binder'].includes(kind)){const n=Number(count),ms=Number(value);if(!/^\d+$/.test(count)||!value.trim()||!Number.isSafeInteger(n)||n<0||!Number.isFinite(ms)||ms<0)throw new Error('追踪统计值无效');result[{slice:'slices',thread:'threads',binder:'binder'}[kind]].push({name:decode(label),count:n,totalMs:ms});}
    else if(kind==='slice_event'||kind==='sched_event'){
      if(!/^-?\d+$/.test(count)||!/^\d+$/.test(value))throw new Error('追踪事件时间无效');
      const parts=label.split(':');if(parts.length!==(kind==='slice_event'?6:4))throw new Error('追踪事件格式无效');
      const integer=v=>{if(v==='')return null;if(!/^-?\d+$/.test(v)||!Number.isSafeInteger(Number(v)))throw new Error('追踪事件标识无效');return Number(v);};
      const info=kind==='slice_event'?{name:decode(parts[0]),track:decode(parts[1]),trackId:integer(parts[2]),tid:integer(parts[3]),depth:integer(parts[4]),sliceId:parts[5]}:{cpu:integer(parts[0]),thread:decode(parts[1]),tid:integer(parts[2]),pid:integer(parts[3])};
      if(kind==='slice_event'&&(!Number.isSafeInteger(info.depth)||info.depth<0||!/^\d{1,19}$/.test(info.sliceId)))throw new Error('追踪切片深度无效');
      const key=kind==='slice_event'?'sliceEvents':'schedEvents',flag=kind==='slice_event'?'slices':'sched';
      if(result[key].length<3000)result[key].push({...info,tsNs:count,durationNs:value});else result.truncated[flag]=true;
    }
    else if(kind==='error')result.errors.push({name:decode(label),count, severity:value});else throw new Error('追踪统计类型无效');
  }
  if(!result.bounds)throw new Error('追踪文件没有可用时间范围');return result;
}
export function traceWindowQuery(startNs,endNs,trackFilter='',sliceFilter=''){
  if(typeof startNs!=='string'||typeof endNs!=='string'||! /^-?\d{1,19}$/.test(startNs)||! /^-?\d{1,19}$/.test(endNs))throw new Error('追踪时间窗口无效');
  const start=BigInt(startNs),end=BigInt(endNs),min=-(1n<<63n),max=(1n<<63n)-1n;
  if(start<min||end>max||end<=start)throw new Error('追踪时间窗口无效');
  if(typeof trackFilter!=='string'||Buffer.byteLength(trackFilter,'utf8')>200||trackFilter.includes('\0'))throw new Error('轨道筛选词无效');
  if(typeof sliceFilter!=='string'||Buffer.byteLength(sliceFilter,'utf8')>200||sliceFilter.includes('\0'))throw new Error('切片筛选词无效');
  const filter=prefix=>` AND ${prefix}.ts < ${end} AND (${prefix}.ts + ${prefix}.dur > ${start} OR (${prefix}.dur = 0 AND ${prefix}.ts >= ${start}))`;
  const literal=`CAST(X'${Buffer.from(trackFilter,'utf8').toString('hex')}' AS TEXT)`;
  const sliceTrackFilter=trackFilter?` AND instr(lower(COALESCE(thread.name,track.name,'轨道 ' || track.id)),lower(${literal})) > 0`:'';
  const sliceNameFilter=sliceFilter?` AND instr(lower(COALESCE(slice.name,'')),lower(CAST(X'${Buffer.from(sliceFilter,'utf8').toString('hex')}' AS TEXT))) > 0`:'';
  const schedFilter=trackFilter?` AND instr(lower('CPU ' || sched.cpu || ' ' || COALESCE(thread.name,'?')),lower(${literal})) > 0`:'';
  return TRACE_QUERY.replace('WHERE slice.dur >= 0 ORDER BY slice.ts LIMIT 3001',`WHERE slice.dur >= 0${filter('slice')}${sliceTrackFilter}${sliceNameFilter} ORDER BY slice.ts LIMIT 3001`)
    .replace('WHERE sched.dur >= 0 ORDER BY sched.ts LIMIT 3001',`WHERE sched.dur >= 0${filter('sched')}${schedFilter} ORDER BY sched.ts LIMIT 3001`);
}
export async function queryTraceFile(path,{startNs,endNs,trackFilter='',sliceFilter='',locator=locateTraceProcessor,runner=exec}={}){
  const binary=await locator(),query=startNs===undefined?TRACE_QUERY:traceWindowQuery(startNs,endNs,trackFilter,sliceFilter);let output;
  try{output=await runner(binary,['--no-agent','--quiet','query',path,query],{timeout:120000,maxBuffer:4*1024*1024,encoding:'utf8',windowsHide:true});}
  catch(error){throw new Error(`Trace Processor 分析失败：${String(error.stderr||error.message).slice(0,1200)}`);}
  return parseTraceSummary(output.stdout);
}
export async function analyzeTraceUpload(req,{locator=locateTraceProcessor,runner=exec,retain=false}={}){
  const declared=req.headers['content-length'];if(declared!==undefined&&(!/^\d+$/.test(declared)||Number(declared)>MAX)){req.resume();throw Object.assign(new Error('追踪文件不能超过 256 MiB'),{status:413});}
  const dir=await mkdtemp(join(tmpdir(),'apw-trace-')),path=join(dir,'input.trace');let kept=false;
  try{
    const file=await open(path,'wx',0o600);let size=0;
    try{for await(const chunk of req.iterator({destroyOnReturn:false})){size+=chunk.length;if(size>MAX){req.resume();throw Object.assign(new Error('追踪文件不能超过 256 MiB'),{status:413});}let offset=0;while(offset<chunk.length){const {bytesWritten}=await file.write(chunk,offset,chunk.length-offset);if(!bytesWritten)throw new Error('追踪临时文件写入失败');offset+=bytesWritten;}}}finally{await file.close();}
    if(!size)throw new Error('追踪文件为空');
    const result={...await queryTraceFile(path,{locator,runner}),fileBytes:size};
    if(retain){kept=true;return {result,session:{path,cleanup:()=>rm(dir,{recursive:true,force:true}),cleanupSync:()=>rmSync(dir,{recursive:true,force:true})}};}
    return result;
  }finally{if(!kept)await rm(dir,{recursive:true,force:true});}
}

// Fetch only the selected slice's recorded arguments. Values are rendered by
// Trace Processor and retained as strings to avoid losing 64-bit integers.
export async function querySliceArguments(path,{sliceId,locator=locateTraceProcessor,runner=exec}={}){
 if(typeof sliceId!=='string'||!/^\d{1,19}$/.test(sliceId)||BigInt(sliceId)>(1n<<63n)-1n)throw new Error('切片标识无效');
 const query=`SELECT hex(CAST(a.key AS BLOB)) AS key_hex,hex(CAST(a.value_type AS BLOB)) AS type_hex,hex(CAST(COALESCE(a.display_value,'') AS BLOB)) AS value_hex FROM slice s JOIN args a ON a.arg_set_id=s.arg_set_id WHERE s.id=${sliceId} ORDER BY a.id LIMIT 201`;
 const binary=await locator();let result;try{result=await runner(binary,['--no-agent','--quiet','query',path,query],{timeout:120000,maxBuffer:4*1024*1024,encoding:'utf8',windowsHide:true});}catch(error){throw new Error(`切片参数查询失败：${String(error.stderr||error.message).slice(0,1200)}`);}
 const rows=parseCsv(result.stdout),header=rows.shift();if(!header||header.join(',')!=='key_hex,type_hex,value_hex')throw new Error('切片参数返回列无效');
 const decode=value=>{if(!/^(?:[0-9a-fA-F]{2})*$/.test(value))throw new Error('切片参数文本编码无效');return Buffer.from(value,'hex').toString('utf8');};
 const args=rows.slice(0,200).map(row=>{if(row.length!==3)throw new Error('切片参数行无效');return {key:decode(row[0]),type:decode(row[1]),value:decode(row[2])};});return {args,truncated:rows.length>200};
}

export function parseHeapProfileSummary(csv,mode='native'){
 if(!['native','art'].includes(mode))throw new Error('内存剖析模式无效');
 const rows=parseCsv(csv),header=rows.shift(),expected='id,parent_id,name_hex,mapping_hex,source_hex,line_number,self_unreleased_bytes,cumulative_unreleased_bytes,self_allocated_bytes,cumulative_allocated_bytes';
 if(!header||header.join(',')!==expected)throw new Error('内存分配剖析返回列无效');
 const decode=hex=>{if(!/^(?:[0-9a-fA-F]{2})*$/.test(hex))throw new Error('内存剖析文本编码无效');return Buffer.from(hex,'hex').toString('utf8');};
 const integer=(value,signed=false)=>{if(!(signed?/^-?\d+$/:/^\d+$/).test(value)||value.length>20)throw new Error('内存剖析数值无效');const n=BigInt(value);if(n<-(1n<<63n)||n>(1n<<63n)-1n)throw new Error('内存剖析数值超出范围');return value;};
 const sites=rows.slice(0,500).map(row=>{
   if(row.length!==10)throw new Error('内存剖析记录不完整');
   const id=integer(row[0]),parentId=row[1]===''?null:integer(row[1]);
   return {id,parentId,name:decode(row[2]),mapping:decode(row[3]),source:decode(row[4]),line:row[5]===''?null:integer(row[5]),selfUnreleasedBytes:integer(row[6],true),cumulativeUnreleasedBytes:integer(row[7],true),selfAllocatedBytes:integer(row[8]),cumulativeAllocatedBytes:integer(row[9])};
 });
 const totals=sites.reduce((best,x)=>BigInt(x.cumulativeAllocatedBytes)>BigInt(best.cumulativeAllocatedBytes)?x:best,{cumulativeAllocatedBytes:'0',cumulativeUnreleasedBytes:'0'});
 return {mode,sites,totalAllocatedBytes:totals.cumulativeAllocatedBytes,totalUnreleasedBytes:totals.cumulativeUnreleasedBytes,truncated:rows.length>500,available:sites.length>0};
}
export async function queryHeapProfile(path,{mode='native',locator=locateTraceProcessor,runner=exec}={}){
 if(!['native','art'].includes(mode))throw new Error('内存剖析模式无效');
 const query=`INCLUDE PERFETTO MODULE android.memory.heap_profile.summary_tree;
 SELECT CAST(id AS TEXT) AS id,COALESCE(CAST(parent_id AS TEXT),'') AS parent_id,
 hex(CAST(COALESCE(name,'') AS BLOB)) AS name_hex,hex(CAST(COALESCE(mapping_name,'') AS BLOB)) AS mapping_hex,
 hex(CAST(COALESCE(source_file,'') AS BLOB)) AS source_hex,COALESCE(CAST(line_number AS TEXT),'') AS line_number,
 CAST(self_size AS TEXT) AS self_unreleased_bytes,CAST(cumulative_size AS TEXT) AS cumulative_unreleased_bytes,
 CAST(self_alloc_size AS TEXT) AS self_allocated_bytes,CAST(cumulative_alloc_size AS TEXT) AS cumulative_allocated_bytes
 FROM android_heap_profile_summary_tree ORDER BY cumulative_alloc_size DESC LIMIT 501`;
 const binary=await locator();let output;
 try{output=await runner(binary,['--no-agent','--quiet','query',path,query],{timeout:120000,maxBuffer:8*1024*1024,encoding:'utf8',windowsHide:true});}
 catch(error){throw new Error(`内存分配剖析查询失败：${String(error.stderr||error.message).slice(0,1200)}`);}
 return parseHeapProfileSummary(output.stdout,mode);
}

export const FRAME_TIMELINE_QUERY=`WITH expected AS (
 SELECT upid,surface_frame_token,display_frame_token,layer_name,COUNT(*) AS n,MIN(ts) AS ts,MIN(dur) AS dur
 FROM expected_frame_timeline_slice WHERE dur >= 0 GROUP BY upid,surface_frame_token,display_frame_token,layer_name
), actual_counts AS (
 SELECT upid,surface_frame_token,display_frame_token,layer_name,COUNT(*) AS n
 FROM actual_frame_timeline_slice WHERE dur >= 0 GROUP BY upid,surface_frame_token,display_frame_token,layer_name
)
 SELECT CAST(a.ts AS TEXT) AS ts, CAST(a.dur AS TEXT) AS dur,
 hex(CAST(COALESCE(p.name,'') AS BLOB)) AS process_hex,
 hex(CAST(COALESCE(a.layer_name,'') AS BLOB)) AS layer_hex,
 hex(CAST(COALESCE(a.jank_type,'') AS BLOB)) AS jank_hex,
 hex(CAST(COALESCE(a.present_type,'') AS BLOB)) AS present_hex,
 COALESCE(CAST(a.surface_frame_token AS TEXT),'') AS surface_token,
 COALESCE(CAST(a.display_frame_token AS TEXT),'') AS display_token,
 COALESCE(CAST(a.on_time_finish AS TEXT),'') AS on_time_finish,
 COALESCE(CAST(CASE WHEN e.n=1 AND ac.n=1 THEN e.ts END AS TEXT),'') AS expected_ts,
 COALESCE(CAST(CASE WHEN e.n=1 AND ac.n=1 THEN e.dur END AS TEXT),'') AS expected_dur,
 CAST(COALESCE(e.n,0) AS TEXT) AS expected_matches,
 CAST(COALESCE(ac.n,0) AS TEXT) AS actual_matches,
 COALESCE(CAST(a.upid AS TEXT),'') AS process_id,
 COALESCE(CAST(a.track_id AS TEXT),'') AS track_id
 FROM actual_frame_timeline_slice a LEFT JOIN process p USING(upid)
 LEFT JOIN expected e ON a.upid=e.upid AND a.surface_frame_token=e.surface_frame_token AND a.display_frame_token=e.display_frame_token AND a.layer_name IS e.layer_name
 LEFT JOIN actual_counts ac ON a.upid=ac.upid AND a.surface_frame_token=ac.surface_frame_token AND a.display_frame_token=ac.display_frame_token AND a.layer_name IS ac.layer_name
 WHERE a.dur >= 0 ORDER BY a.ts LIMIT 2001`;
export function parseFrameTimeline(csv){
 const rows=parseCsv(csv),header=rows.shift();
 if(!header||header.join(',')!=='ts,dur,process_hex,layer_hex,jank_hex,present_hex,surface_token,display_token,on_time_finish,expected_ts,expected_dur,expected_matches,actual_matches,process_id,track_id')throw new Error('FrameTimeline 返回列无效');
 const decode=hex=>{if(!/^(?:[0-9A-Fa-f]{2})*$/.test(hex))throw new Error('FrameTimeline 文本编码无效');return Buffer.from(hex,'hex').toString('utf8');};
 const frames=rows.slice(0,2000).map(r=>{
  if(r.length!==15||!/^\-?\d+$/.test(r[0])||!/^\d+$/.test(r[1])||!/^\d+$/.test(r[11])||!/^\d+$/.test(r[12]))throw new Error('FrameTimeline 时间或匹配数无效');
  const expectedTs=/^-?\d+$/.test(r[9])?r[9]:null,expectedDur=/^\d+$/.test(r[10])?r[10]:null;
  const delta=expectedTs!==null&&expectedDur!==null?(BigInt(r[0])+BigInt(r[1])-BigInt(expectedTs)-BigInt(expectedDur)).toString():null;
  return {tsNs:r[0],durationNs:r[1],process:decode(r[2]),layer:decode(r[3]),jankType:decode(r[4]),presentType:decode(r[5]),surfaceToken:r[6]||null,displayToken:r[7]||null,onTimeFinish:r[8]==='1'?true:r[8]==='0'?false:null,expectedTsNs:expectedTs,expectedDurationNs:expectedDur,completionDeltaNs:delta,expectedMatches:Number(r[11]),actualMatches:Number(r[12]),processId:/^\d+$/.test(r[13])?r[13]:null,trackId:/^\d+$/.test(r[14])?r[14]:null};
 });
 return {frames,truncated:rows.length>2000};
}
export async function queryFrameTimeline(path,{packageName=null,locator=locateTraceProcessor,runner=exec}={}){
 if(packageName!==null&&(typeof packageName!=='string'||!/^[a-zA-Z][\w]*(?:\.[\w]+)+$/.test(packageName)))throw new Error('应用包名无效');
 // Package names are restricted above; hex literals avoid interpolating SQL text.
 const hex=packageName?Buffer.from(packageName).toString('hex').toUpperCase():null;
 const prefix=packageName?Buffer.from(`${packageName}:`).toString('hex').toUpperCase():null;
 const filter=packageName?` AND (hex(CAST(p.name AS BLOB)) = '${hex}' OR substr(hex(CAST(p.name AS BLOB)),1,${prefix.length}) = '${prefix}')`:'';
 const query=FRAME_TIMELINE_QUERY.replace('WHERE a.dur >= 0 ORDER BY',`WHERE a.dur >= 0${filter} ORDER BY`);
 const binary=await locator();let result;try{result=await runner(binary,['--no-agent','--quiet','query',path,query],{timeout:120000,maxBuffer:4*1024*1024,encoding:'utf8',windowsHide:true});}catch(error){throw new Error(`FrameTimeline 查询失败：${String(error.stderr||error.message).slice(0,1200)}`);}return parseFrameTimeline(result.stdout);
}

export function parseStartupTrace(csv){
 const rows=parseCsv(csv),header=rows.shift();
 if(!header||header.join(',')!=='startup_id,ts,dur,package_hex,type_hex,ttid,ttfd,upid')throw new Error('启动追踪返回列无效');
 const decode=hex=>{if(!/^(?:[0-9a-fA-F]{2})*$/.test(hex))throw new Error('启动追踪文本编码无效');return Buffer.from(hex,'hex').toString('utf8');};
 const optional=v=>{if(v==='')return null;if(!/^\d+$/.test(v))throw new Error('启动追踪时间或标识无效');return v;};
 const startups=rows.slice(0,1000).map(r=>{
  if(r.length!==8||!/^\d+$/.test(r[0])||! /^-?\d+$/.test(r[1])||!/^\d+$/.test(r[2]))throw new Error('启动追踪数据无效');
  return {id:r[0],tsNs:r[1],durationNs:r[2],packageName:decode(r[3]),type:decode(r[4]),ttidNs:optional(r[5]),ttfdNs:optional(r[6]),upid:optional(r[7])};
 });return {startups,truncated:rows.length>1000};
}
export async function queryStartupTrace(path,{packageName=null,locator=locateTraceProcessor,runner=exec}={}){
 if(packageName!==null&&(typeof packageName!=='string'||!/^[a-zA-Z][\w]*(?:\.[\w]+)+$/.test(packageName)))throw new Error('应用包名无效');
 const filter=packageName?`WHERE hex(CAST(s.package AS BLOB)) = '${Buffer.from(packageName).toString('hex').toUpperCase()}'`:'';
 const query=`INCLUDE PERFETTO MODULE android.startup.time_to_display;
 SELECT CAST(s.startup_id AS TEXT) AS startup_id,CAST(s.ts AS TEXT) AS ts,CAST(s.dur AS TEXT) AS dur,
 hex(CAST(COALESCE(s.package,'') AS BLOB)) AS package_hex,hex(CAST(COALESCE(s.startup_type,'') AS BLOB)) AS type_hex,
 COALESCE(CAST(d.time_to_initial_display AS TEXT),'') AS ttid,COALESCE(CAST(d.time_to_full_display AS TEXT),'') AS ttfd,COALESCE(CAST(d.upid AS TEXT),'') AS upid
 FROM android_startups s LEFT JOIN android_startup_time_to_display d USING(startup_id) ${filter} ORDER BY s.ts,d.upid LIMIT 1001`;
 const binary=await locator();let result;try{result=await runner(binary,['--no-agent','--quiet','query',path,query],{timeout:120000,maxBuffer:4*1024*1024,encoding:'utf8',windowsHide:true});}catch(error){throw new Error(`启动追踪查询失败：${String(error.stderr||error.message).slice(0,1200)}`);}return parseStartupTrace(result.stdout);
}

export function parseBinderTransactions(csv){
 const rows=parseCsv(csv),header=rows.shift();
 if(!header||header.join(',')!=='ts,dur,client_hex,client_tid,server_hex,server_tid,aidl_hex,is_sync,server_ts,server_dur,txn_id')throw new Error('Binder 事务返回列无效');
 const decode=value=>{if(!/^(?:[0-9a-fA-F]{2})*$/.test(value))throw new Error('Binder 文本编码无效');return Buffer.from(value,'hex').toString('utf8');};
 const optional=(value,signed=false)=>{if(value==='')return null;if(!(signed?/^-?\d+$/:/^\d+$/).test(value))throw new Error('Binder 事务数值无效');return value;};
 const transactions=rows.slice(0,500).map(r=>{
  if(r.length!==11||!/^[-]?\d+$/.test(r[0])||!/^\d+$/.test(r[1])||!['','0','1'].includes(r[7]))throw new Error('Binder 事务数据无效');
  return {tsNs:r[0],durationNs:r[1],client:decode(r[2]),clientTid:optional(r[3]),server:decode(r[4]),serverTid:optional(r[5]),aidl:decode(r[6]),sync:r[7]===''?null:r[7]==='1',serverTsNs:optional(r[8],true),serverDurationNs:optional(r[9]),id:optional(r[10])};
 });return {transactions,truncated:rows.length>500};
}
export async function queryBinderTransactions(path,{packageName=null,direction='both',locator=locateTraceProcessor,runner=exec}={}){
 if(packageName!==null&&(typeof packageName!=='string'||packageName.length>255||!/^[a-zA-Z][\w]*(?:\.[\w]+)+$/.test(packageName)))throw new Error('应用包名无效');
 if(!['both','client','server'].includes(direction))throw new Error('Binder 调用方向无效');
 const match=column=>{const value=Buffer.from(packageName,'utf8').toString('hex'),prefix=Buffer.from(`${packageName}:`,'utf8').toString('hex');return `(hex(CAST(${column} AS BLOB))=upper('${value}') OR substr(hex(CAST(${column} AS BLOB)),1,${prefix.length})=upper('${prefix}'))`;};
 const filter=packageName?` AND ${direction==='both'?`(${match('client_process')} OR ${match('server_process')})`:match(direction==='client'?'client_process':'server_process')}`:'';
 const query=`INCLUDE PERFETTO MODULE android.binder;
 SELECT CAST(client_ts AS TEXT) AS ts,CAST(client_dur AS TEXT) AS dur,hex(CAST(COALESCE(client_process,'') AS BLOB)) AS client_hex,
 COALESCE(CAST(client_tid AS TEXT),'') AS client_tid,hex(CAST(COALESCE(server_process,'') AS BLOB)) AS server_hex,
 COALESCE(CAST(server_tid AS TEXT),'') AS server_tid,hex(CAST(COALESCE(aidl_name,'') AS BLOB)) AS aidl_hex,
 COALESCE(CAST(is_sync AS TEXT),'') AS is_sync,COALESCE(CAST(server_ts AS TEXT),'') AS server_ts,COALESCE(CAST(CASE WHEN server_dur>=0 THEN server_dur END AS TEXT),'') AS server_dur,COALESCE(CAST(binder_txn_id AS TEXT),'') AS txn_id
 FROM android_binder_txns WHERE client_ts IS NOT NULL AND client_dur >= 0${filter} ORDER BY client_dur DESC,client_ts LIMIT 501`;
 const binary=await locator();let result;try{result=await runner(binary,['--no-agent','--quiet','query',path,query],{timeout:120000,maxBuffer:4*1024*1024,encoding:'utf8',windowsHide:true});}catch(error){throw new Error(`Binder 事务查询失败：${String(error.stderr||error.message).slice(0,1200)}`);}return parseBinderTransactions(result.stdout);
}
export function parseBinderBreakdown(csv){
 const rows=parseCsv(csv),header=rows.shift();if(!header||header.join(',')!=='kind,side_hex,reason_hex,ts,dur,count')throw new Error('Binder 分解返回列无效');
 const summary=[],intervals=[];let summaryTruncated=false,intervalsTruncated=false;
 const decode=value=>{if(!/^(?:[0-9a-fA-F]{2})*$/.test(value))throw new Error('Binder 分解文本编码无效');return Buffer.from(value,'hex').toString('utf8');};
 for(const r of rows){if(r.length!==6||!/^\d+$/.test(r[4]))throw new Error('Binder 分解数值无效');const side=decode(r[1]),reason=decode(r[2]);
  if(r[0]==='summary'){if(!/^\d+$/.test(r[5])||!Number.isSafeInteger(Number(r[5])))throw new Error('Binder 分解计数无效');if(summary.length<100)summary.push({side,reason,durationNs:r[4],count:Number(r[5])});else summaryTruncated=true;}
  else if(r[0]==='interval'){if(!/^-?\d+$/.test(r[3]))throw new Error('Binder 分解时间无效');if(intervals.length<1000)intervals.push({side,reason,tsNs:r[3],durationNs:r[4]});else intervalsTruncated=true;}
  else throw new Error('Binder 分解类型无效');
 }return {summary,intervals,summaryTruncated,intervalsTruncated};
}
export async function queryBinderBreakdown(path,{id,locator=locateTraceProcessor,runner=exec}={}){
 if(typeof id!=='string'||!/^\d{1,19}$/.test(id)||BigInt(id)>9223372036854775807n)throw new Error('Binder 事务标识无效');
 const n=BigInt(id).toString(),query=`INCLUDE PERFETTO MODULE android.binder_breakdown;
 SELECT 'summary' AS kind,side_hex,reason_hex,'' AS ts,dur,count FROM (SELECT hex(CAST(COALESCE(reason_type,'') AS BLOB)) AS side_hex,hex(CAST(COALESCE(reason,'') AS BLOB)) AS reason_hex,CAST(SUM(dur) AS TEXT) AS dur,CAST(COUNT(*) AS TEXT) AS count FROM android_binder_client_server_breakdown WHERE binder_txn_id=${n} AND dur>=0 GROUP BY reason_type,reason ORDER BY SUM(dur) DESC LIMIT 101)
 UNION ALL SELECT 'interval',side_hex,reason_hex,ts,dur,'' FROM (SELECT hex(CAST(COALESCE(reason_type,'') AS BLOB)) AS side_hex,hex(CAST(COALESCE(reason,'') AS BLOB)) AS reason_hex,CAST(ts AS TEXT) AS ts,CAST(dur AS TEXT) AS dur FROM android_binder_client_server_breakdown WHERE binder_txn_id=${n} AND dur>=0 ORDER BY ts LIMIT 1001)`;
 const binary=await locator();let result;try{result=await runner(binary,['--no-agent','--quiet','query',path,query],{timeout:120000,maxBuffer:4*1024*1024,encoding:'utf8',windowsHide:true});}catch(error){throw new Error(`Binder 阶段查询失败：${String(error.stderr||error.message).slice(0,1200)}`);}return parseBinderBreakdown(result.stdout);
}

export function parseStartupBreakdown(csv){
 const rows=parseCsv(csv),header=rows.shift();
 if(!header||header.join(',')!=='kind,reason_hex,ts,dur,count')throw new Error('启动阶段返回列无效');
 const summary=[],intervals=[];let summaryTruncated=false,intervalsTruncated=false;
 for(const r of rows){
  if(r.length!==5||!/^(?:[0-9A-Fa-f]{2})*$/.test(r[1])||!/^\d+$/.test(r[3]))throw new Error('启动阶段数据无效');
  const reason=Buffer.from(r[1],'hex').toString('utf8');
  if(r[0]==='summary'){
   if(!/^\d+$/.test(r[4])||!Number.isSafeInteger(Number(r[4])))throw new Error('启动阶段计数无效');
   if(summary.length<100)summary.push({reason,durationNs:r[3],count:Number(r[4])});else summaryTruncated=true;
  }else if(r[0]==='interval'){
   if(!/^-?\d+$/.test(r[2]))throw new Error('启动阶段时间无效');
   if(intervals.length<1000)intervals.push({reason,tsNs:r[2],durationNs:r[3]});else intervalsTruncated=true;
  }else throw new Error('启动阶段类型无效');
 }
 return {summary,intervals,summaryTruncated,intervalsTruncated};
}
export async function queryStartupBreakdown(path,{startupId,locator=locateTraceProcessor,runner=exec}={}){
 if(typeof startupId!=='string'||!/^\d{1,19}$/.test(startupId)||BigInt(startupId)>9223372036854775807n)throw new Error('启动记录标识无效');
 const id=BigInt(startupId).toString();
 const query=`INCLUDE PERFETTO MODULE android.startup.startup_breakdowns;
 SELECT 'summary' AS kind, reason_hex, '' AS ts, dur, count FROM (SELECT hex(CAST(COALESCE(reason,'') AS BLOB)) AS reason_hex, CAST(SUM(dur) AS TEXT) AS dur, CAST(COUNT(*) AS TEXT) AS count FROM android_startup_opinionated_breakdown WHERE startup_id=${id} AND dur>=0 GROUP BY reason ORDER BY SUM(dur) DESC LIMIT 101)
 UNION ALL SELECT 'interval',reason_hex,ts,dur,'' FROM (SELECT hex(CAST(COALESCE(reason,'') AS BLOB)) AS reason_hex,CAST(ts AS TEXT) AS ts,CAST(dur AS TEXT) AS dur FROM android_startup_opinionated_breakdown WHERE startup_id=${id} AND dur>=0 ORDER BY ts LIMIT 1001)`;
 const binary=await locator();let result;try{result=await runner(binary,['--no-agent','--quiet','query',path,query],{timeout:120000,maxBuffer:4*1024*1024,encoding:'utf8',windowsHide:true});}catch(error){throw new Error(`启动阶段查询失败：${String(error.stderr||error.message).slice(0,1200)}`);}return parseStartupBreakdown(result.stdout);
}

export function parseStartupArtAttribution(csv){
 const rows=parseCsv(csv),header=rows.shift();if(!header||header.join(',')!=='phase_hex,category_hex,ts_ns,dur_ns,name_hex,process_hex')throw new Error('ART 启动归因返回列无效');
 const decode=hex=>{if(!/^(?:[0-9A-Fa-f]{2})*$/.test(hex))throw new Error('ART 启动归因文本编码无效');return Buffer.from(hex,'hex').toString('utf8');};
 const groups=new Map();for(const row of rows){if(row.length!==6||! /^-?\d+$/.test(row[2])||! /^\d+$/.test(row[3]))throw new Error('ART 启动归因数值无效');
  const phase=decode(row[0]),category=decode(row[1]);if(!['launch_to_ttid','ttid_to_ttfd'].includes(phase)||!['gc','jit','class_loading','class_verification','class_initialization','dex2oat'].includes(category))throw new Error('ART 启动归因分类无效');
  const key=`${phase}\0${category}`;let group=groups.get(key);if(!group){group={phase,category,totalOverlapNs:0n,count:0,names:[],processes:[]};groups.set(key,group);}group.totalOverlapNs+=BigInt(row[3]);group.count++;
  const name=decode(row[4]),process=decode(row[5]);if(name&&!group.names.includes(name)&&group.names.length<5)group.names.push(name);if(process&&!group.processes.includes(process)&&group.processes.length<5)group.processes.push(process);
 }
 const phases=['launch_to_ttid','ttid_to_ttfd'],categories=['gc','jit','class_loading','class_verification','class_initialization','dex2oat'];return {groups:[...groups.values()].map(g=>({...g,totalOverlapNs:g.totalOverlapNs.toString()})).sort((a,b)=>phases.indexOf(a.phase)-phases.indexOf(b.phase)||categories.indexOf(a.category)-categories.indexOf(b.category)),truncated:rows.length>1000};
}
export async function queryStartupArtAttribution(path,{startup,locator=locateTraceProcessor,runner=exec}={}){
 const decimal=(value,signed=false)=>typeof value==='string'&&(signed?/^-?\d{1,19}$/:/^\d{1,19}$/.test(value));
 if(!startup||!decimal(startup.tsNs,true)||!decimal(startup.ttidNs)||!decimal(startup.ttfdNs)||!decimal(startup.upid)||BigInt(startup.upid)<1n||BigInt(startup.ttfdNs)<BigInt(startup.ttidNs)||BigInt(startup.ttfdNs)-BigInt(startup.ttidNs)>120_000_000_000n)throw new Error('ART 启动归因参数无效或缺少 TTID/TTFD');
 const min=-(1n<<63n),max=(1n<<63n)-1n,start=BigInt(startup.tsNs),initial=BigInt(startup.ttidNs),full=BigInt(startup.ttfdNs),upid=BigInt(startup.upid),ttid=start+initial,ttfd=start+full;
 if(start<min||start>max||initial>max||full>max||upid>max||ttid<min||ttid>max||ttfd<min||ttfd>max)throw new Error('ART 启动归因数值超出 Trace Processor 范围');
 const query=`WITH phases AS (
 SELECT 'launch_to_ttid' AS phase,${start.toString()} AS start_ns,${ttid.toString()} AS end_ns
 UNION ALL SELECT 'ttid_to_ttfd',${ttid.toString()},${ttfd.toString()}
), candidates AS (
 SELECT s.ts,s.dur,s.name,t.name AS thread_name,p.name AS process_name,
 CASE WHEN lower(p.name) GLOB '*dex2oat*' THEN 'dex2oat'
 WHEN s.name GLOB 'JIT compiling*' THEN 'jit'
 WHEN s.name GLOB 'VerifyClass*' OR s.name GLOB '*Class verification*' THEN 'class_verification'
 WHEN s.name GLOB '*InitializeClass*' OR s.name GLOB '*Class initialization*' THEN 'class_initialization'
 WHEN s.name GLOB 'ClassLinker*' OR s.name GLOB 'OpenDexFilesFromOat*' OR s.name GLOB '*LoadClass*' THEN 'class_loading'
 WHEN lower(s.name) GLOB '* garbage collection*' OR lower(s.name) GLOB '* gc' OR lower(s.name) GLOB '* gc *' OR lower(s.name) GLOB '* gc:*' OR lower(s.name) GLOB 'gc *' OR lower(s.name) GLOB 'gc:*' THEN 'gc' END AS category
 FROM slice s JOIN thread_track tt ON s.track_id=tt.id JOIN thread t ON tt.utid=t.utid LEFT JOIN process p ON t.upid=p.upid
 WHERE s.dur>0 AND (t.upid=${BigInt(startup.upid).toString()} OR lower(p.name) GLOB '*dex2oat*')
)
 SELECT hex(CAST(w.phase AS BLOB)) AS phase_hex,hex(CAST(c.category AS BLOB)) AS category_hex,
 CAST(MAX(c.ts,w.start_ns) AS TEXT) AS ts_ns,CAST(MIN(c.ts+c.dur,w.end_ns)-MAX(c.ts,w.start_ns) AS TEXT) AS dur_ns,
 hex(CAST(c.name AS BLOB)) AS name_hex,hex(CAST(COALESCE(c.process_name,'') AS BLOB)) AS process_hex
 FROM candidates c CROSS JOIN phases w WHERE c.category IS NOT NULL AND c.ts<w.end_ns AND c.ts+c.dur>w.start_ns
 ORDER BY CAST(dur_ns AS INT) DESC LIMIT 1001`;
 const binary=await locator();let result;try{result=await runner(binary,['--no-agent','--quiet','query',path,query],{timeout:120000,maxBuffer:4*1024*1024,encoding:'utf8',windowsHide:true});}catch(error){throw new Error(`ART 启动归因查询失败：${String(error.stderr||error.message).slice(0,1200)}`);}return parseStartupArtAttribution(result.stdout);
}

export function parseThreadStates(csv){
 const rows=parseCsv(csv),header=rows.shift();if(!header||header.join(',')!=='kind,utid,tid,pid,thread_hex,process_hex,state_hex,ts,dur,count')throw new Error('线程状态返回列无效');
 const summary=[],intervals=[];let summaryTruncated=false,intervalsTruncated=false;
 const decode=hex=>{if(!/^(?:[0-9A-Fa-f]{2})*$/.test(hex))throw new Error('线程状态文本编码无效');return Buffer.from(hex,'hex').toString('utf8');};
 for(const r of rows){
  if(r.length!==10||!/^\d+$/.test(r[1])||!/^\d+$/.test(r[2])||(r[3]!==''&&!/^\d+$/.test(r[3]))||!/^\d+$/.test(r[8]))throw new Error('线程状态数据无效');
  const row={utid:r[1],tid:r[2],pid:r[3]||null,thread:decode(r[4]),process:decode(r[5]),state:decode(r[6]),durationNs:r[8]};
  if(r[0]==='summary'){if(!/^\d+$/.test(r[9])||!Number.isSafeInteger(Number(r[9])))throw new Error('线程状态计数无效');row.count=Number(r[9]);if(summary.length<200)summary.push(row);else summaryTruncated=true;}
  else if(r[0]==='interval'){if(!/^-?\d+$/.test(r[7]))throw new Error('线程状态时间无效');row.tsNs=r[7];if(intervals.length<1000)intervals.push(row);else intervalsTruncated=true;}
  else throw new Error('线程状态类型无效');
 }
 return {summary,intervals,summaryTruncated,intervalsTruncated};
}
export async function queryThreadStates(path,{tid=null,pid=null,upid=null,utid=null,state=null,startNs,endNs,locator=locateTraceProcessor,runner=exec}={}){
 if(upid===null&&(!Number.isSafeInteger(tid)||tid<0||tid>2147483647))throw new Error('线程 TID 无效');
 if(upid!==null&&(typeof upid!=='string'||!/^\d{1,19}$/.test(upid)||BigInt(upid)>9223372036854775807n||tid!==null||pid!==null))throw new Error('进程 UPID 无效');
 if(utid!==null&&(upid===null||typeof utid!=='string'||!/^\d{1,19}$/.test(utid)||BigInt(utid)>9223372036854775807n))throw new Error('线程 UTID 无效');
 if(state!==null&&(utid===null||typeof state!=='string'||Buffer.byteLength(state,'utf8')>128||state.includes('\0')))throw new Error('线程状态筛选无效');
 if(pid!==null&&(!Number.isSafeInteger(pid)||pid<0||pid>2147483647))throw new Error('进程 PID 无效');
 if(typeof startNs!=='string'||typeof endNs!=='string'||! /^-?\d{1,19}$/.test(startNs)||! /^-?\d{1,19}$/.test(endNs))throw new Error('追踪时间窗口无效');
 const start=BigInt(startNs),end=BigInt(endNs);if(start<-(1n<<63n)||end>(1n<<63n)-1n||end<=start)throw new Error('追踪时间窗口无效');
 const processFilter=(upid!==null?`t.upid=${BigInt(upid)}`:`t.tid=${tid}${pid===null?'':` AND p.pid=${pid}`}`)+(utid!==null?` AND st.utid=${BigInt(utid)}`:'')+(state!==null?` AND COALESCE(st.state,'')=CAST(X'${Buffer.from(state,'utf8').toString('hex')}' AS TEXT)`:'');
 const query=`WITH selected AS (SELECT st.utid,t.tid,p.pid,COALESCE(t.name,'') AS thread,COALESCE(p.name,'') AS process,COALESCE(st.state,'') AS state,MAX(st.ts,${start}) AS ts,MIN(st.ts+st.dur,${end})-MAX(st.ts,${start}) AS dur FROM thread_state st JOIN thread t USING(utid) LEFT JOIN process p USING(upid) WHERE ${processFilter} AND st.dur>0 AND st.ts<${end} AND st.ts+st.dur>${start})
 SELECT 'summary' AS kind,CAST(utid AS TEXT) AS utid,CAST(tid AS TEXT) AS tid,COALESCE(CAST(pid AS TEXT),'') AS pid,hex(CAST(thread AS BLOB)) AS thread_hex,hex(CAST(process AS BLOB)) AS process_hex,hex(CAST(state AS BLOB)) AS state_hex,'' AS ts,CAST(total AS TEXT) AS dur,CAST(n AS TEXT) AS count FROM (SELECT utid,tid,pid,thread,process,state,SUM(dur) AS total,COUNT(*) AS n FROM selected GROUP BY utid,tid,pid,thread,process,state ORDER BY total DESC LIMIT 201)
 UNION ALL SELECT 'interval',CAST(utid AS TEXT),CAST(tid AS TEXT),COALESCE(CAST(pid AS TEXT),''),hex(CAST(thread AS BLOB)),hex(CAST(process AS BLOB)),hex(CAST(state AS BLOB)),CAST(ts AS TEXT),CAST(dur AS TEXT),'' FROM (SELECT * FROM selected ORDER BY ts LIMIT 1001)`;
 const binary=await locator();let result;try{result=await runner(binary,['--no-agent','--quiet','query',path,query],{timeout:120000,maxBuffer:4*1024*1024,encoding:'utf8',windowsHide:true});}catch(error){throw new Error(`线程状态查询失败：${String(error.stderr||error.message).slice(0,1200)}`);}return parseThreadStates(result.stdout);
}
