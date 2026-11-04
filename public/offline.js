const LAYOUT_ARCHIVE_TYPE = 'android-performance-layout-capture';
const MAX_LAYOUT_ARCHIVE_XML_BYTES = 8 * 1024 * 1024;
const MAX_LAYOUT_ARCHIVE_SCREENSHOT_BYTES = 24 * 1024 * 1024;

export function correlateComposeEventsToFrames(events, frames) {
  if (!Array.isArray(events) || !Array.isArray(frames) || !frames.length) return {available:false,reason:'请同时载入 Compose 运行时记录和逐帧 gfxinfo 数据。',frames:[],matchedEventCount:0,clockMismatchCount:0};
  const timedFrames=frames.flatMap(frame=>{
    const start=frame?.timestamps?.IntendedVsync||frame?.startNsExact,end=frame?.timestamps?.FrameCompleted;
    if(!/^\d{1,19}$/.test(start||'')||!/^\d{1,19}$/.test(end||''))return [];
    const startNs=BigInt(start),endNs=BigInt(end);return endNs>startNs?[{frame,startNs,endNs,events:[]}]:[];
  });
  if(!timedFrames.length)return {available:false,reason:'当前帧数据没有可用的逐帧起止时间戳。',frames:[],matchedEventCount:0,clockMismatchCount:0};
  let clockMismatchCount=0,invalidCount=0,matchedEventCount=0;const matchedEventIndices=new Set();
  for(const [eventIndex,event] of events.entries()){
    if(event?.clock!=='uptime'){clockMismatchCount++;continue;}
    if(typeof event.elapsedNs!=='string'||!/^\d{1,19}$/.test(event.elapsedNs)){invalidCount++;continue;}
    const time=BigInt(event.elapsedNs),matches=timedFrames.filter(candidate=>time>=candidate.startNs&&time<=candidate.endNs);
    for(const frame of matches){frame.events.push({name:String(event.name||'未知 Composable').slice(0,300),measurement:event.measurement||'unknown',count:Number.isSafeInteger(event.count)?event.count:null,elapsedNs:event.elapsedNs});matchedEventCount++;matchedEventIndices.add(eventIndex);}
  }
  return {available:true,frames:timedFrames.filter(item=>item.events.length).map(({frame,events:matched})=>({index:frame.index,durationMs:frame.durationMs,overBudget:frame.overBudget,events:matched})),matchedEventCount,uniqueMatchedEventCount:matchedEventIndices.size,clockMismatchCount,invalidCount,frameCount:timedFrames.length};
}

export function correlateGfxFramesToTimeline(gfxFrames, timelineFrames, {sameDevice=false, api=null, packageName=null}={}) {
  const unavailable=reason=>({available:false,reason,frames:[],matchedFrameCount:0,overlapPairs:0,ambiguousFrameCount:0,unmatchedFrameCount:0});
  if(!sameDevice)return unavailable('需要两组数据都来自同一台已知设备；导入的追踪或 gfxinfo 文本没有设备身份，不能自动关联。');
  if(!Number.isInteger(Number(api))||Number(api)<31)return unavailable('需要 Android 12（API 31）或更高版本的设备。');
  if(typeof packageName!=='string'||!/^[a-zA-Z][\w]*(?:\.[\w]+)+$/.test(packageName))return unavailable('需要有效的目标应用包名。');
  if(!Array.isArray(gfxFrames)||!gfxFrames.length||!Array.isArray(timelineFrames)||!timelineFrames.length)return unavailable('请同时读取逐帧 gfxinfo 和当前追踪的 FrameTimeline。');
  const validTimeline=timelineFrames.flatMap((frame,index)=>{
    if(typeof frame?.tsNs!=='string'||! /^-?\d{1,19}$/.test(frame.tsNs)||typeof frame?.durationNs!=='string'||! /^\d{1,19}$/.test(frame.durationNs)||BigInt(frame.durationNs)<=0n)return [];
    if(typeof frame.process!=='string'||!(frame.process===packageName||frame.process.startsWith(`${packageName}:`)))return [];
    const start=BigInt(frame.tsNs),end=start+BigInt(frame.durationNs);
    return [{frame,index,start,end}];
  });
  if(!validTimeline.length)return unavailable('当前追踪没有该应用进程的有效 FrameTimeline 时间区间。');
  const matched=[];let overlapPairs=0,ambiguousFrameCount=0,validGfxCount=0;
  for(const frame of gfxFrames){
    const startText=frame?.timestamps?.IntendedVsync||frame?.startNsExact,endText=frame?.timestamps?.FrameCompleted;
    if(!/^\d{1,19}$/.test(startText||'')||!/^\d{1,19}$/.test(endText||''))continue;
    const start=BigInt(startText),end=BigInt(endText);if(end<=start)continue;validGfxCount++;
    const candidates=[];
    for(const item of validTimeline){
      const overlapStart=start>item.start?start:item.start,overlapEnd=end<item.end?end:item.end;
      if(overlapEnd<=overlapStart)continue;
      candidates.push({timelineIndex:item.index,process:item.frame.process,layer:item.frame.layer||'',tsNs:item.frame.tsNs,durationNs:item.frame.durationNs,jankType:item.frame.jankType||'',presentType:item.frame.presentType||'',overlapNs:(overlapEnd-overlapStart).toString()});
    }
    if(candidates.length){matched.push({gfxFrameIndex:frame.index,startNs:startText,endNs:endText,durationMs:frame.durationMs,overBudget:frame.overBudget,candidates});overlapPairs+=candidates.length;if(candidates.length>1)ambiguousFrameCount++;}
  }
  return {available:true,frames:matched,matchedFrameCount:matched.length,overlapPairs,ambiguousFrameCount,unmatchedFrameCount:Math.max(0,validGfxCount-matched.length),validGfxFrameCount:validGfxCount,note:'按同一设备上 gfxinfo IntendedVsync–FrameCompleted 与 FrameTimeline 时间区间重叠匹配。重叠是候选关系，不代表相同帧、因果或 Jank 来源；多图层可能产生多个候选。'};
}

export function findRelatedLayoutCaptures({serial,packageName,timestamp,records=[],currentLayout=null}={}){
  const unavailable=reason=>({available:false,reason,captures:[],truncated:false});
  if(typeof serial!=='string'||!serial||typeof packageName!=='string'||!/^[a-zA-Z][\w]*(?:\.[\w]+)+$/.test(packageName))return unavailable('需要直接采集的帧数据及其设备序列号和目标包名。');
  const hasTime=Number.isSafeInteger(timestamp)&&timestamp>0,all=[];
  const add=(id,name,source,layout)=>{
    if(layout?.source!=='agent'||layout.serial!==serial||layout.packageName!==packageName||!Number.isSafeInteger(layout.timestamp)||layout.timestamp<=0)return;
    if(all.some(item=>item.id===id))return;
    const start=typeof layout.captureStartUptimeNs==='string'&&/^\d{1,19}$/.test(layout.captureStartUptimeNs)?layout.captureStartUptimeNs:null;
    const end=typeof layout.captureEndUptimeNs==='string'&&/^\d{1,19}$/.test(layout.captureEndUptimeNs)&&(!start||BigInt(layout.captureEndUptimeNs)>=BigInt(start))?layout.captureEndUptimeNs:null;
    all.push({id,name:String(name||'布局快照').slice(0,200),source,timestamp:layout.timestamp,deltaMs:hasTime?layout.timestamp-timestamp:null,captureStartUptimeNs:start&&end?start:null,captureEndUptimeNs:start&&end?end:null});
  };
  add('current','当前布局快照','agent',currentLayout);
  const list=Array.isArray(records)?records:[],truncated=list.length>1000;
  for(const session of list.slice(0,1000))if(session?.kind==='layout'&&session.source==='agent')add(session.id,session.name,session.source,session.payload);
  all.sort((a,b)=>hasTime?Math.abs(a.deltaMs)-Math.abs(b.deltaMs)||b.timestamp-a.timestamp:b.timestamp-a.timestamp);
  return {available:true,captures:all,truncated,note:'仅按采集元数据中的设备序列号和应用包名筛选，按布局快照与 gfxinfo 读取时刻的近似先后排序；gfxinfo 是有限历史缓冲区，不能由此确定布局快照对应哪一帧。'};
}

export function layoutFrameCorrelationContext({frames=null,frameTimeline=null,traceResult=null,traceSource=null,frameSource=null}={}){
  const visible=!!(frames||frameTimeline),source=traceSource||frameSource||null;
  const canMap=!!(frameTimeline?.sessionId&&traceSource?.sessionId===frameTimeline.sessionId&&typeof traceSource.serial==='string'&&traceSource.serial&&typeof traceSource.packageName==='string'&&/^[a-zA-Z][\w]*(?:\.[\w]+)+$/.test(traceSource.packageName)&&Number.isSafeInteger(Number(traceSource.api))&&Number(traceSource.api)>=31);
  return {visible,serial:source?.serial||null,packageName:source?.packageName||null,timestamp:frames?.timestamp||traceResult?.timestamp,canMap};
}

export function correlateGpuStagesToFrames(stages, frames) {
  if (!Array.isArray(stages) || !Array.isArray(frames)) return {available:false,reason:'请先载入同一追踪的 GPU RenderStage 和 FrameTimeline 数据。',frames:[],matchedFrameCount:0,stageFramePairs:0};
  if (stages.length > 1000 || frames.length > 2000) throw new Error('GPU 与帧区间关联数据超出限制');
  if (!frames.length) return {available:false,reason:'请先载入同一追踪的 GPU RenderStage 和 FrameTimeline 数据。',frames:[],matchedFrameCount:0,stageFramePairs:0};
  const validFrames=frames.flatMap(frame=>{
    if(typeof frame?.tsNs!=='string'||! /^-?\d{1,19}$/.test(frame.tsNs)||typeof frame?.durationNs!=='string'||! /^\d{1,19}$/.test(frame.durationNs)||BigInt(frame.durationNs)<=0n)return [];
    return [{frame,start:BigInt(frame.tsNs),end:BigInt(frame.tsNs)+BigInt(frame.durationNs),stages:[]}];
  });
  if(!validFrames.length)return {available:false,reason:'当前 FrameTimeline 没有可用的帧起止时间。',frames:[],matchedFrameCount:0,stageFramePairs:0};
  let stageFramePairs=0;
  for(const stage of stages){
    if(typeof stage?.upid!=='string'||!/^\d+$/.test(stage.upid)||typeof stage.tsNs!=='string'||! /^-?\d{1,19}$/.test(stage.tsNs)||typeof stage.durationNs!=='string'||! /^\d{1,19}$/.test(stage.durationNs)||typeof stage.name!=='string')continue;
    const start=BigInt(stage.tsNs),end=start+BigInt(stage.durationNs);if(end<=start)continue;
    for(const item of validFrames){
      if(item.frame.processId!==stage.upid)continue;
      const overlapStart=start>item.start?start:item.start,overlapEnd=end<item.end?end:item.end;if(overlapEnd<=overlapStart)continue;
      item.stages.push({name:stage.name,queue:stage.queue||'',submissionId:stage.submissionId||null,tsNs:stage.tsNs,durationNs:stage.durationNs,overlapNs:(overlapEnd-overlapStart).toString()});stageFramePairs++;
    }
  }
  const matched=validFrames.filter(item=>item.stages.length).map(({frame,stages:matches})=>({process:frame.process||'',layer:frame.layer||'',tsNs:frame.tsNs,durationNs:frame.durationNs,jankType:frame.jankType||'',stages:matches}));
  return {available:true,frames:matched,matchedFrameCount:matched.length,stageFramePairs,frameCount:validFrames.length,note:'按进程 UPID 和纳秒区间重叠匹配。此关联不包含帧令牌到 GPU submission 的直接因果链；队列可并行，重叠本身不能证明 GPU 工作导致该帧卡顿。'};
}

export function createLayoutCaptureArchive(layout) {
  if (!layout || typeof layout.xml !== 'string' || new TextEncoder().encode(layout.xml).length > MAX_LAYOUT_ARCHIVE_XML_BYTES || !layout.xml.includes('<hierarchy')) {
    throw new Error('当前布局 XML 无效或超过 8 MiB');
  }
  let screenshot = null;
  if (layout.screenshot !== null && layout.screenshot !== undefined) {
    if (typeof layout.screenshot !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(layout.screenshot) || layout.screenshot.length % 4 !== 0) throw new Error('当前布局截图编码无效');
    let bytes; try { bytes = Uint8Array.from(atob(layout.screenshot), character => character.charCodeAt(0)); } catch { throw new Error('当前布局截图编码无效'); }
    if (bytes.length < 24 || bytes.length > MAX_LAYOUT_ARCHIVE_SCREENSHOT_BYTES || [...bytes.slice(0, 8)].join(',') !== '137,80,78,71,13,10,26,10') throw new Error('当前布局截图不是有效 PNG 或超过 24 MiB');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), width = view.getUint32(16), height = view.getUint32(20);
    if (!width || !height || width * height > 50_000_000 || (layout.imageSize && (layout.imageSize.width !== width || layout.imageSize.height !== height))) throw new Error('当前布局截图尺寸无效或与元数据不一致');
    screenshot = layout.screenshot;
  }
  const captureStartUptimeNs=typeof layout.captureStartUptimeNs==='string'&&/^\d{1,19}$/.test(layout.captureStartUptimeNs)?layout.captureStartUptimeNs:null;
  const captureEndUptimeNs=typeof layout.captureEndUptimeNs==='string'&&/^\d{1,19}$/.test(layout.captureEndUptimeNs)?layout.captureEndUptimeNs:null;
  const captureClockValid=!!captureStartUptimeNs&&!!captureEndUptimeNs&&BigInt(captureEndUptimeNs)>=BigInt(captureStartUptimeNs);
  return {
    schemaVersion: 1,
    type: LAYOUT_ARCHIVE_TYPE,
    exportedAt: Date.now(),
    capture: {
      source: String(layout.source || 'unknown').slice(0, 40),
      timestamp: Number.isSafeInteger(layout.timestamp) ? layout.timestamp : null,
      serial: typeof layout.serial === 'string' ? layout.serial.slice(0, 256) : null,
      packageName: typeof layout.packageName === 'string' ? layout.packageName.slice(0, 256) : null,
      api: Number.isSafeInteger(layout.api) ? layout.api : null,
      captureStartUptimeNs:captureClockValid?captureStartUptimeNs:null,
      captureEndUptimeNs:captureClockValid?captureEndUptimeNs:null,
      densityDpi: Number.isSafeInteger(layout.densityDpi) ? layout.densityDpi : null,
      imageSize: layout.imageSize && Number.isSafeInteger(layout.imageSize.width) && Number.isSafeInteger(layout.imageSize.height) ? layout.imageSize : null,
      warning: typeof layout.warning === 'string' ? layout.warning.slice(0, 2000) : null,
      note: typeof layout.note === 'string' ? layout.note.slice(0, 2000) : null,
      xml: layout.xml,
      screenshot,
    },
  };
}

export function parseLayoutCaptureArchive(document) {
  if (!document || document.schemaVersion !== 1 || document.type !== LAYOUT_ARCHIVE_TYPE || !document.capture || typeof document.capture !== 'object') throw new Error('不是受支持的布局采集档案');
  const capture = document.capture;
  if (typeof capture.xml !== 'string' || new TextEncoder().encode(capture.xml).length > MAX_LAYOUT_ARCHIVE_XML_BYTES || !capture.xml.includes('<hierarchy')) throw new Error('布局档案 XML 无效或超过 8 MiB');
  if (capture.timestamp !== null && capture.timestamp !== undefined && (!Number.isSafeInteger(capture.timestamp) || capture.timestamp < 0)) throw new Error('布局档案时间戳无效');
  const captureStartUptimeNs=typeof capture.captureStartUptimeNs==='string'&&/^\d{1,19}$/.test(capture.captureStartUptimeNs)?capture.captureStartUptimeNs:null;
  const captureEndUptimeNs=typeof capture.captureEndUptimeNs==='string'&&/^\d{1,19}$/.test(capture.captureEndUptimeNs)?capture.captureEndUptimeNs:null;
  const captureClockValid=!!captureStartUptimeNs&&!!captureEndUptimeNs&&BigInt(captureEndUptimeNs)>=BigInt(captureStartUptimeNs);
  if (capture.densityDpi !== null && capture.densityDpi !== undefined && (!Number.isSafeInteger(capture.densityDpi) || capture.densityDpi < 72 || capture.densityDpi > 1000)) throw new Error('布局档案显示密度无效');
  if (capture.imageSize !== null && capture.imageSize !== undefined && (!Number.isSafeInteger(capture.imageSize.width) || !Number.isSafeInteger(capture.imageSize.height) || capture.imageSize.width < 1 || capture.imageSize.height < 1 || capture.imageSize.width * capture.imageSize.height > 50_000_000)) throw new Error('布局档案图像尺寸无效');
  let screenshot = null;
  if (capture.screenshot !== null && capture.screenshot !== undefined) {
    if (typeof capture.screenshot !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(capture.screenshot) || capture.screenshot.length % 4 !== 0) throw new Error('布局档案截图编码无效');
    let bytes; try { bytes = Uint8Array.from(atob(capture.screenshot), character => character.charCodeAt(0)); } catch { throw new Error('布局档案截图编码无效'); }
    if (bytes.length < 24 || bytes.length > MAX_LAYOUT_ARCHIVE_SCREENSHOT_BYTES || [...bytes.slice(0, 8)].join(',') !== '137,80,78,71,13,10,26,10') throw new Error('布局档案截图不是有效 PNG 或超过 24 MiB');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), width = view.getUint32(16), height = view.getUint32(20);
    if (!width || !height || width * height > 50_000_000) throw new Error('布局档案截图像素尺寸无效');
    if (capture.imageSize && (capture.imageSize.width !== width || capture.imageSize.height !== height)) throw new Error('布局档案截图尺寸与元数据不一致');
    screenshot = capture.screenshot;
  }
  return {
    source: typeof capture.source === 'string' ? capture.source.slice(0, 40) : 'import',
    timestamp: Number.isSafeInteger(capture.timestamp) ? capture.timestamp : Date.now(),
    serial: typeof capture.serial === 'string' ? capture.serial.slice(0, 256) : null,
    packageName: typeof capture.packageName === 'string' ? capture.packageName.slice(0, 256) : null,
    api: Number.isSafeInteger(capture.api) ? capture.api : null,
    captureStartUptimeNs:captureClockValid?captureStartUptimeNs:null,
    captureEndUptimeNs:captureClockValid?captureEndUptimeNs:null,
    densityDpi: capture.densityDpi ?? null,
    imageSize: capture.imageSize ?? null,
    warning: typeof capture.warning === 'string' ? capture.warning.slice(0, 2000) : null,
    note: typeof capture.note === 'string' ? capture.note.slice(0, 2000) : null,
    xml: capture.xml,
    screenshot,
  };
}

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

// Export only the normalized, privacy-reduced request model. Raw headers,
// cookies, query strings, credentials and bodies are never reconstructed.
export function networkRequestsHar(rows){
 if(!Array.isArray(rows)||rows.length>50000)throw new Error('网络导出记录无效或超过 50,000 条');
 const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
 const entries=rows.map(row=>{
  let url=null;
  try{url=new URL(row.url);if(!['http:','https:'].includes(url.protocol))url=null;else{url.username='';url.password='';url.search='';url.hash='';}}catch{}
  if(!url)throw new Error('网络记录包含无效 URL');
  const startedAt=finite(row.startedAt),date=startedAt===null?null:new Date(startedAt),startedDateTime=date&&Number.isFinite(date.getTime())?date.toISOString():null;
  const timing=value=>finite(value)??-1;
  return {
   startedDateTime,
   time:finite(row.timeMs)??-1,
   request:{method:typeof row.method==='string'?row.method:'GET',url:url.toString(),httpVersion:'',cookies:[],headers:[],queryString:[],headersSize:-1,bodySize:-1},
   response:{status:Number.isInteger(row.status)&&row.status>=0?row.status:0,statusText:'',httpVersion:'',cookies:[],headers:[],content:{size:finite(row.bytes)??-1,mimeType:''},redirectURL:'',headersSize:-1,bodySize:finite(row.bytes)??-1},
   cache:{},
   timings:{blocked:-1,dns:timing(row.timings?.dns),connect:timing(row.timings?.connect),send:-1,wait:timing(row.timings?.wait),receive:timing(row.timings?.receive),ssl:timing(row.timings?.ssl)},
   ...(typeof row.connectionId==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(row.connectionId)?{connection:row.connectionId}:{}),
   _apw:{failed:row.failed===true,timeUnavailable:finite(row.timeMs)===null,startTimeUnavailable:startedDateTime===null,redacted:true}
  };
 });
 return {log:{version:'1.2',creator:{name:'Android Performance Workbench',version:'0.2.0'},entries}};
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

export function networkRequestEmptyState({hasSnapshot,source,agentActive,totalRows,filteredRows}){
 if(!hasSnapshot)return 'import';
 if(filteredRows>0)return null;
 if(totalRows>0)return 'filtered';
 if(source==='adb')return agentActive?'agent-waiting':'agent-empty';
 return 'no-requests';
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

// Peak in-flight request count from recorded wall-clock intervals. End events
// sort before starts at the same timestamp, so adjacent requests do not overlap.
export function summarizeNetworkConcurrency(rows){
 if(!Array.isArray(rows))throw new Error('网络并发统计参数无效');
 const events=[];let eligible=0;
 for(const row of rows){
  if(!Number.isFinite(row?.startedAt)||!Number.isFinite(row?.timeMs)||row.timeMs<0||!Number.isFinite(row.startedAt+row.timeMs))continue;
  eligible++;events.push([row.startedAt,1],[row.startedAt+row.timeMs,-1]);
 }
 events.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 let active=0,peak=0,peakAtMs=null;
 for(const [timestamp,delta] of events){active+=delta;if(active>peak){peak=active;peakAtMs=timestamp;}}
 return {peak,peakAtMs,eligible,unavailable:rows.length-eligible};
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

// Startup iteration percentiles and outliers are descriptive review signals, not significance tests.
export function startupRunSummary(runs){
 const values=(Array.isArray(runs)?runs:[]).map((row,index)=>({run:Number.isInteger(row?.run)&&row.run>0?row.run:index+1,value:row?.totalTimeMs})).filter(row=>typeof row.value==='number'&&Number.isFinite(row.value)&&row.value>=0).sort((a,b)=>a.value-b.value);
 if(!values.length)return {count:0,mean:null,minimum:null,p50:null,p90:null,maximum:null,range:null,standardDeviation:null,coefficientOfVariationPercent:null,medianAbsoluteDeviation:null,outlierRuns:[]};
 const samples=values.map(row=>row.value),middle=sorted=>sorted.length%2?sorted[Math.floor(sorted.length/2)]:sorted[sorted.length/2-1]/2+sorted[sorted.length/2]/2;
 const mean=samples.reduce((sum,value)=>sum+value,0)/samples.length,median=middle(samples),deviations=samples.map(value=>Math.abs(value-median)).sort((a,b)=>a-b),mad=middle(deviations),variance=samples.reduce((sum,value)=>sum+(value-mean)**2,0)/samples.length,standardDeviation=Math.sqrt(variance);
 const outlierThreshold=Math.max(3*1.4826*mad,Math.abs(median)*0.05),outlierRuns=samples.length>=5&&Number.isFinite(outlierThreshold)?values.filter(row=>Math.abs(row.value-median)>outlierThreshold).map(row=>row.run):[];
 return {count:samples.length,mean,minimum:samples[0],p50:median,p90:samples[Math.max(0,Math.ceil(samples.length*.9)-1)],maximum:samples.at(-1),range:samples.at(-1)-samples[0],standardDeviation,coefficientOfVariationPercent:samples.length>1&&mean!==0?standardDeviation/Math.abs(mean)*100:null,medianAbsoluteDeviation:mad,outlierRuns};
}

// Compare two saved startup experiments descriptively; iterations are not independent experiments.
export function compareStartupExperiments(baseline,current){
 const read=record=>record?.kind&&record.kind!=='startup'?null:record?.payload||record;
 const before=read(baseline),after=read(current);
 if(!before||!after||!Array.isArray(before.results)||!Array.isArray(after.results))throw new Error('启动对比需要两份有效实验记录');
 const a=startupRunSummary(before.results),b=startupRunSummary(after.results),warnings=[];
 for(const [label,left,right] of [['目标包名',before.packageName,after.packageName],['请求模式',before.requestedMode,after.requestedMode],['设备序列号',before.serial,after.serial]]){
  if(left==null||left===''||right==null||right==='')warnings.push(`${label}缺失`);
  else if(left!==right)warnings.push(`${label}不一致`);
 }
 const delta=(x,y)=>x===null||y===null||x===0?null:(y-x)/Math.abs(x)*100;
 return {schemaVersion:1,kind:'startup-experiment-comparison',timestamp:Date.now(),baseline:{name:baseline?.name||'基线',timestamp:baseline?.timestamp||null,requestedMode:before.requestedMode,packageName:before.packageName,serial:before.serial,summary:a},current:{name:current?.name||'当前',timestamp:current?.timestamp||null,requestedMode:after.requestedMode,packageName:after.packageName,serial:after.serial,summary:b},deltaPercent:{p50:delta(a.p50,b.p50),p90:delta(a.p90,b.p90),mean:delta(a.mean,b.mean)},warnings,note:'描述性实验对比。每份记录内的重复轮次可能相关；结果不表示独立实验、统计显著性或代码因果。'};
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

export function classifyBenchmarkDelta(row,{direction='unset',thresholdPercent=5}={}){
 if(typeof thresholdPercent!=='number'||!Number.isFinite(thresholdPercent)||thresholdPercent<0||thresholdPercent>100)throw new Error('回归阈值必须为 0–100%');
 if(!['unset','lower-is-better','higher-is-better'].includes(direction))throw new Error('指标方向无效');
 if(row?.ambiguous||row?.missing||typeof row?.delta!=='number'||!Number.isFinite(row.delta))return {status:'incomparable',direction,thresholdPercent,adverseChangePercent:null};
 if(direction==='unset')return {status:'unconfigured',direction,thresholdPercent,adverseChangePercent:null};
 const adverseChangePercent=direction==='lower-is-better'?row.delta:-row.delta;
 const status=adverseChangePercent>thresholdPercent?'regression':adverseChangePercent< -thresholdPercent?'improvement':'within-threshold';
 return {status,direction,thresholdPercent,adverseChangePercent};
}

// Only explicitly configured metrics participate in the CI-style summary.
export function benchmarkRegressionSummary(rows,{thresholdPercent=5,directions={}}={}){
 if(!Array.isArray(rows)||!directions||typeof directions!=='object'||Array.isArray(directions))throw new Error('Benchmark 回归汇总参数无效');
 const classified=rows.map(row=>({...row,...classifyBenchmarkDelta(row,{direction:directions[row.key]||'unset',thresholdPercent})}));
 const configured=classified.filter(row=>row.direction!=='unset'),comparable=configured.filter(row=>row.status!=='incomparable'),regressions=comparable.filter(row=>row.status==='regression'),incomparableCount=configured.length-comparable.length;
 const status=regressions.length?'regression':!configured.length?'not-configured':incomparableCount?'inconclusive':'no-configured-regressions';
 return {thresholdPercent,status,configuredMetrics:configured.length,classifiedMetrics:comparable.length,regressionCount:regressions.length,improvementCount:comparable.filter(row=>row.status==='improvement').length,withinThresholdCount:comparable.filter(row=>row.status==='within-threshold').length,incomparableCount,unconfiguredCount:classified.filter(row=>row.status==='unconfigured').length,rows:classified};
}

export function buildBenchmarkRegressionReport(baseline,current,{thresholdPercent=5,directions={}}={}){
 const rows=compareBenchmarks(baseline,current),summary=benchmarkRegressionSummary(rows,{thresholdPercent,directions});
 return {schemaVersion:1,kind:'benchmark-regression-report',timestamp:Date.now(),thresholdPercent,directions:{...directions},baseline:{fileName:baseline?.fileName||null,context:baseline?.context||{}},current:{fileName:current?.fileName||null,context:current?.context||{}},contextWarnings:benchmarkContextWarnings(baseline||{},current||{}),summary,rows:summary.rows,note:'Threshold labels use only the explicitly selected metric direction. Unconfigured and incomparable metrics do not affect the CI-style status. This rule is not a significance test or causal conclusion.'};
}

export function benchmarkRegressionCsv(report){
 if(report?.kind!=='benchmark-regression-report'||!Array.isArray(report.rows))throw new Error('Benchmark 回归报告无效');
 const esc=value=>{let text=String(value??'');if(typeof value==='string'&&/^[\t\r ]*[=+\-@]/.test(value))text=`'${text}`;return `"${text.replaceAll('"','""')}"`;},header=['class','benchmark','metricType','metric','params','baseline','current','deltaPercent','direction','thresholdPercent','status'];
 return [header,...report.rows.map(row=>[row.className,row.name,row.metricType,row.metric,JSON.stringify(row.params||{}),row.baseline,row.median,row.delta,row.direction,row.thresholdPercent,row.status])].map(row=>row.map(esc).join(',')).join('\r\n')+'\r\n';
}

export function benchmarkRegressionMarkdown(report){
 if(report?.kind!=='benchmark-regression-report'||!Array.isArray(report.rows))throw new Error('Benchmark 回归报告无效');
 const cell=value=>String(value??'—').replaceAll('|','\\|').replace(/[\r\n]+/g,' '),headers=['Benchmark','Metric','Baseline','Current','Change %','Direction','Threshold %','Status'];
 return [`# Benchmark regression report`,'',`Status: ${report.summary.status} · threshold: ${report.thresholdPercent}%`,'',`| ${headers.join(' | ')} |`,`| ${headers.map(()=> '---').join(' | ')} |`,...report.rows.map(row=>`| ${[`${row.className||''} ${row.name||''}`.trim(),`${row.metricType||''} ${row.metric||''}`.trim(),row.baseline,row.median,row.delta,row.direction,row.thresholdPercent,row.status].map(cell).join(' | ')} |`),'',`Context warnings: ${report.contextWarnings.join('; ')||'none'}`,'',report.note].join('\n');
}

export function benchmarkRegressionCi(report){
 if(report?.kind!=='benchmark-regression-report'||!report.summary)throw new Error('Benchmark 回归报告无效');
 return {schemaVersion:1,kind:'benchmark-ci-result',status:report.summary.status,thresholdPercent:report.thresholdPercent,configuredMetrics:report.summary.configuredMetrics,classifiedMetrics:report.summary.classifiedMetrics,regressionCount:report.summary.regressionCount,improvementCount:report.summary.improvementCount,withinThresholdCount:report.summary.withinThresholdCount,incomparableCount:report.summary.incomparableCount,unconfiguredCount:report.summary.unconfiguredCount,regressions:report.rows.filter(row=>row.status==='regression').map(row=>({key:row.key,name:row.name,metric:row.metric,deltaPercent:row.delta,direction:row.direction,thresholdPercent:row.thresholdPercent})),contextWarnings:report.contextWarnings};
}

export function benchmarkContextWarnings(baseline,current) {
  const fields=[['设备型号',x=>x.build?.model],['设备代号',x=>x.build?.device],['系统版本',x=>x.build?.version?.sdk],['构建指纹',x=>x.build?.fingerprint],['编译模式',x=>x.compilationMode],['CPU 锁频',x=>x.cpuLocked],['CPU 核数',x=>x.cpuCoreCount],['CPU 最大频率',x=>x.cpuMaxFreqHz],['持续性能模式',x=>x.sustainedPerformanceModeEnabled],['ART 版本',x=>x.artMainlineVersion]];
  return fields.flatMap(([label,get])=>{const a=get(baseline.context||{}),b=get(current.context||{});return a===undefined||a===null||b===undefined||b===null?[`${label}缺失`]:a!==b?[`${label}不一致`]:[];});
}

// Treat separately saved AndroidX reports as the experiment units. Iterations
// inside one report are not promoted to independent experiments.
export function benchmarkExperimentUncertainty(baselineReports,currentReports,key,{resamples=5000,minExperiments=5,maxExperiments=100}={}){
 if(!Array.isArray(baselineReports)||!Array.isArray(currentReports)||!baselineReports.length||!currentReports.length||baselineReports.length>maxExperiments||currentReports.length>maxExperiments||typeof key!=='string'||!key||!Number.isInteger(resamples)||resamples<1000||resamples>20000||!Number.isInteger(minExperiments)||minExperiments<2||minExperiments>20)throw new Error('独立实验统计参数无效');
 const collect=reports=>reports.flatMap(report=>{
  if(!report||!Array.isArray(report.results))return [];
  const rows=report.results.filter(row=>row?.key===key);
  return rows.length===1&&Number.isFinite(rows[0].median)?[rows[0].median]:[];
 });
 const before=collect(baselineReports),after=collect(currentReports),middle=values=>{const sorted=[...values].sort((a,b)=>a-b);return sorted.length%2?sorted[(sorted.length-1)/2]:sorted[sorted.length/2-1]/2+sorted[sorted.length/2]/2;};
 if(!before.length||!after.length)return {available:false,reason:'至少一侧没有唯一且有效的报告级指标',baselineExperiments:before.length,currentExperiments:after.length};
 const baselineMedian=middle(before),currentMedian=middle(after),deltaPercent=baselineMedian===0?null:(currentMedian-baselineMedian)/Math.abs(baselineMedian)*100;
 if(before.length<minExperiments||after.length<minExperiments||baselineMedian===0)return {available:false,reason:baselineMedian===0?'基线中位数为零，不能计算相对区间':minExperiments===5?'每侧至少需要 5 份独立报告':`每侧至少需要 ${minExperiments} 份独立报告`,baselineExperiments:before.length,currentExperiments:after.length,baselineMedian,currentMedian,deltaPercent,lowerPercent:null,upperPercent:null,resamples:0,method:'独立报告中位数的百分位 Bootstrap'};
 let seed=2166136261;for(const ch of `${key}|${before.join(',')}|${after.join(',')}`)seed=Math.imul(seed^ch.charCodeAt(0),16777619)>>>0;
 const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;},sampleMedian=values=>{const sample=Array.from({length:values.length},()=>values[Math.floor(random()*values.length)]);return middle(sample);},distribution=[];
 for(let i=0;i<resamples;i++){const b=sampleMedian(before),c=sampleMedian(after);if(b!==0)distribution.push((c-b)/Math.abs(b)*100);}
 if(distribution.length<resamples*.95)return {available:false,reason:'重抽样中基线中位数过多为零，无法估计相对区间',baselineExperiments:before.length,currentExperiments:after.length,baselineMedian,currentMedian,deltaPercent,lowerPercent:null,upperPercent:null,resamples:distribution.length,method:'独立报告中位数的百分位 Bootstrap'};
 distribution.sort((a,b)=>a-b);const quantile=p=>distribution[Math.max(0,Math.ceil(distribution.length*p)-1)];
 return {available:true,baselineExperiments:before.length,currentExperiments:after.length,baselineMedian,currentMedian,deltaPercent,lowerPercent:quantile(.025),upperPercent:quantile(.975),resamples:distribution.length,method:'独立报告中位数的百分位 Bootstrap',seeded:true};
}

export function buildBenchmarkExperimentComparisonReport(baselineReports,currentReports,key){
 if(!Array.isArray(baselineReports)||!Array.isArray(currentReports)||baselineReports.length<5||currentReports.length<5||baselineReports.length>100||currentReports.length>100||typeof key!=='string'||!key)throw new Error('独立实验统计参数无效');
 const find=report=>{const rows=Array.isArray(report?.results)?report.results.filter(row=>row?.key===key):[];return rows.length===1?rows[0]:null;};
 const sample=[...baselineReports,...currentReports].map(find).find(Boolean);if(!sample)throw new Error('至少一侧没有唯一且有效的报告级指标');
 const contextWarnings=[];for(const reports of [baselineReports,currentReports])for(let i=1;i<reports.length;i++)contextWarnings.push(...benchmarkContextWarnings(reports[0],reports[i]));contextWarnings.push(...benchmarkContextWarnings(baselineReports[0],currentReports[0]));
 const serialize=reports=>reports.map(report=>{const row=find(report);return {sessionId:report.sessionId||null,name:report.sessionName||report.fileName||'Benchmark 报告',timestamp:report.sessionTimestamp||report.timestamp||null,context:report.context||null,median:row&&Number.isFinite(row.median)?row.median:null,metricPresent:!!row};});
 return {schemaVersion:1,kind:'benchmark-experiment-comparison',timestamp:Date.now(),metric:{key,name:sample.name,className:sample.className,params:sample.params,metric:sample.metric,metricType:sample.metricType},baseline:serialize(baselineReports),current:serialize(currentReports),contextWarnings:[...new Set(contextWarnings)],estimate:benchmarkExperimentUncertainty(baselineReports,currentReports,key),limitations:['Each separately saved report is one experiment unit; within-report runs are summarized by the report median.','The bootstrap interval is exploratory, not a p-value, significance test, proof of causation, or proof that runs are independent. Verify run independence and comparability from the actual test procedure.']};
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
const ART_TRACE_LIMITS={events:5_000_000,methods:2_000_000,spans:100_000,threads:10_000};
function traceText(bytes,start,end,encoding='utf-8'){return new TextDecoder(encoding).decode(bytes.subarray(start,end));}
function traceLine(bytes,start){const end=bytes.indexOf(10,start);if(end<0)throw new Error('ART trace key 区缺少换行');return {text:traceText(bytes,start,end).replace(/\r$/,''),next:end+1};}
function traceNumber(value){const parsed=/^0x[\da-f]+$/i.test(value)?Number.parseInt(value.slice(2),16):Number(value);return Number.isSafeInteger(parsed)&&parsed>=0?parsed:null;}
function parseArtKey(header){
  const methods=new Map(),threads=new Map(),options={};let offset=0,section='';
  while(offset<header.length){if(offset>32*1024*1024)throw new Error('ART trace key 区超过 32 MiB 上限');const line=traceLine(header,offset);offset=line.next;const value=line.text;if(value==='*end')return {methods,threads,options,headerBytes:offset};if(value.startsWith('*')){section=value;continue;}
    if(section==='*version'){if(/^\d+$/.test(value))options.version=Number(value);else if(value.includes('=')){const at=value.indexOf('=');options[value.slice(0,at)]=value.slice(at+1);}continue;}
    if(section==='*threads'){const match=value.match(/^(\d+)\t(.*)$/);if(match){if(threads.size>=ART_TRACE_LIMITS.threads)throw new Error('ART trace 线程数超过上限');threads.set(Number(match[1]),match[2]);}continue;}
    if(section==='*methods'){const fields=value.split('\t'),id=traceNumber(fields[0]||'');if(id===null)continue;if(methods.size>=ART_TRACE_LIMITS.methods)throw new Error('ART trace 方法数超过上限');const className=fields[1]||'unknown',methodName=fields[2]||'unknown',signature=fields[3]||'';methods.set(id,`${className}.${methodName}${signature}`);continue;}
    if(value.includes('=')){const at=value.indexOf('=');options[value.slice(0,at)]=value.slice(at+1);}
  }
  throw new Error('ART trace key 区缺少 *end 标记');
}
function parseArtMethodLine(line,methods,threads){if(line.length>4096)throw new Error('ART trace 元数据行超过 4 KiB 上限');const fields=line.split('\t'),id=traceNumber(fields[0]||'');if(id===null)return;if(fields.length===2&&/^\d+$/.test(fields[0])){if(threads.size>=ART_TRACE_LIMITS.threads&&!threads.has(id))throw new Error('ART trace 线程数超过上限');threads.set(id,fields[1]);}else if(fields.length>=2){if(methods.size>=ART_TRACE_LIMITS.methods&&!methods.has(id))throw new Error('ART trace 方法数超过上限');methods.set(id,`${fields[1]||'unknown'}.${fields[2]||'unknown'}${fields[3]||''}`);}}
export function parseArtMethodTrace(buffer,{maxEvents=ART_TRACE_LIMITS.events,maxSpans=ART_TRACE_LIMITS.spans}={}){
  if(!(buffer instanceof Uint8Array))buffer=new Uint8Array(buffer);
  const view=new DataView(buffer.buffer,buffer.byteOffset,buffer.byteLength),u16=offset=>view.getUint16(offset,true),u32=offset=>view.getUint32(offset,true),u64=offset=>view.getBigUint64(offset,true);
  if(buffer.length<4||buffer.length>256*1024*1024)throw new Error('ART method trace 文件为空或超过 256 MiB');
  const magic=0x574f4c53;let cursor=0,version,recordSize,baseTimeUs=0n,clock='wall',methods=new Map(),threads=new Map(),streaming=false,recordsStart;
  if(traceText(buffer,0,Math.min(8,buffer.length),'ascii').startsWith('*version')){
    const key=parseArtKey(buffer);methods=key.methods;threads=key.threads;version=key.options.version;clock=key.options.clock||'wall';cursor=key.headerBytes;
    if(![1,2,3].includes(version))throw new Error(`不支持 ART trace 版本：${version??'未提供'}`);
    if(cursor+16>buffer.length||u32(cursor)!==magic)throw new Error('ART trace 数据区 magic 无效');
  }else if(u32(0)===magic){
    streaming=true;cursor=0;
  }else throw new Error('文件不是受支持的 ART method trace（缺少 SLOW magic 或 *version 区）');
  const fileVersion=u16(cursor+4);version=streaming?(fileVersion^0xf0):fileVersion;
  if(![1,2,3].includes(version))throw new Error(`不支持 ART trace 版本：${version}`);
  if(streaming&&version===1)throw new Error('不支持 ART v1 streaming trace 格式');
  const dataOffset=u16(cursor+6),headerStart=cursor;
  if(cursor+16>buffer.length)throw new Error('ART trace 数据头不完整');
  baseTimeUs=u64(cursor+8);cursor+=16;
  recordSize=version===1?9:version===2?10:buffer.length>=cursor+2?u16(cursor):0;
  if(version===3)cursor+=2;
  if(recordSize<(version===1?9:version===2?10:14)||recordSize>64)throw new Error('ART trace record size 无效');
  recordsStart=headerStart+dataOffset;
  if(recordsStart<cursor||recordsStart>buffer.length)throw new Error('ART trace 数据偏移无效');
  cursor=recordsStart;
  const stacks=new Map(),stats=new Map(),spans=[];let events=0,unmatchedExits=0,minTimestamp=null,maxTimestamp=0n,threadCpuLast=new Map(),threadCpuEpoch=new Map(),globalLast=0n,globalEpoch=0n,spanSeen=0,reservoirState=0x6d2b79f5;
  const methodName=id=>methods.get(id)||`unknown method 0x${id.toString(16)}`;
  const methodStats=id=>{let row=stats.get(id);if(!row){row={id,name:methodName(id),calls:0,inclusiveUs:0n,exclusiveUs:0n,completedCalls:0};stats.set(id,row);}return row;};
  const getTime=(tid,threadTime,wallTime)=>{
    const perThread=clock==='thread-cpu';let raw=BigInt(perThread?threadTime:wallTime??threadTime),previous=perThread?threadCpuLast.get(tid):globalLast,epoch=perThread?threadCpuEpoch.get(tid)||0n:globalEpoch;
    if(previous!==undefined&&raw<previous&&previous-raw>0x80000000n)epoch+=0x100000000n;
    const value=epoch+raw;if(perThread){threadCpuLast.set(tid,raw);threadCpuEpoch.set(tid,epoch);}else{globalLast=raw;globalEpoch=epoch;}if(minTimestamp===null||value<minTimestamp)minTimestamp=value;if(value>maxTimestamp)maxTimestamp=value;return value;
  };
  const pushEvent=(tid,methodWord,threadTime,wallTime)=>{
    if(++events>maxEvents)throw new Error(`ART trace 事件数超过 ${maxEvents.toLocaleString()} 上限`);
    const action=methodWord&3,id=methodWord&0xfffffffc,time=getTime(tid,threadTime,wallTime);let stack=stacks.get(tid);if(!stack){stack=[];stacks.set(tid,stack);}
    if(action===0){methodStats(id).calls++;stack.push({id,startUs:time,childUs:0n,depth:stack.length});return;}
    if(action===3)throw new Error('ART trace 包含保留的 method action 3');
    let target=-1;for(let i=stack.length-1;i>=0;i--)if(stack[i].id===id){target=i;break;}
    if(target<0){unmatchedExits++;return;}
    if(action===1&&target!==stack.length-1){unmatchedExits++;while(stack.length-1>target)closeFrame(tid,stack.pop(),time,true);}
    while(stack.length>target){const frame=stack.pop();closeFrame(tid,frame,time,action===2);}
  };
  const closeFrame=(tid,frame,endUs,unrolled)=>{
    const inclusive=endUs>frame.startUs?endUs-frame.startUs:0n,exclusive=inclusive>frame.childUs?inclusive-frame.childUs:0n,row=methodStats(frame.id);row.inclusiveUs+=inclusive;row.exclusiveUs+=exclusive;row.completedCalls++;
    if(stackParent(tid))stackParent(tid).childUs+=inclusive;
    const span={tid,methodId:frame.id,name:row.name,startUs:frame.startUs.toString(),endUs:endUs.toString(),inclusiveUs:inclusive.toString(),exclusiveUs:exclusive.toString(),depth:frame.depth,unrolled};spanSeen++;
    if(spans.length<maxSpans)spans.push(span);else if(maxSpans>0){reservoirState=(Math.imul(reservoirState,1664525)+1013904223)>>>0;const slot=reservoirState%spanSeen;if(slot<maxSpans)spans[slot]=span;}
  };
  const stackParent=tid=>stacks.get(tid)?.at(-1);
  const parseTimeFields=(pos,tid)=>({threadTime:u32(pos),wallTime:version===3&&recordSize>=14?u32(pos+4):undefined});
  if(streaming){
    const streamDataStart=cursor;
    while(cursor+2<=buffer.length){const tid=u16(cursor);cursor+=2;if(tid===0){if(cursor>=buffer.length)throw new Error('ART streaming trace special record 不完整');const code=buffer[cursor++];if(code===1){if(cursor+2>buffer.length)throw new Error('ART streaming method record 不完整');const len=u16(cursor);cursor+=2;if(cursor+len>buffer.length)throw new Error('ART streaming method 名称超出文件范围');parseArtMethodLine(traceText(buffer,cursor,cursor+len),methods,threads);cursor+=len;}
      else if(code===2){if(cursor+4>buffer.length)throw new Error('ART streaming thread record 不完整');const threadId=u16(cursor),len=u16(cursor+2);cursor+=4;if(cursor+len>buffer.length)throw new Error('ART streaming thread 名称超出文件范围');threads.set(threadId,traceText(buffer,cursor,cursor+len));cursor+=len;}
      else if(code===3){if(cursor+4>buffer.length)throw new Error('ART streaming summary 头不完整');const len=u32(cursor);cursor+=4;if(len>buffer.length-cursor)throw new Error('ART streaming summary 超出文件范围');const summary=traceText(buffer,cursor,cursor+len);cursor+=len;for(const line of summary.split(/\r?\n/)){const eq=line.indexOf('=');if(eq>0){const key=line.slice(0,eq);if(key==='clock')clock=line.slice(eq+1);}}break;}
      else throw new Error(`ART streaming trace 特殊记录类型无效：${code}`);continue;}
      if(cursor+recordSize-2>buffer.length)throw new Error('ART streaming trace 记录不完整');cursor+=recordSize-2;
    }
    cursor=streamDataStart;
    while(cursor+2<=buffer.length){const tid=u16(cursor);cursor+=2;if(tid===0){if(cursor>=buffer.length)throw new Error('ART streaming trace special record 不完整');const code=buffer[cursor++];if(code===1){if(cursor+2>buffer.length)throw new Error('ART streaming method record 不完整');const len=u16(cursor);cursor+=2;if(len>buffer.length-cursor)throw new Error('ART streaming method 名称超出文件范围');cursor+=len;}else if(code===2){if(cursor+4>buffer.length)throw new Error('ART streaming thread record 不完整');const len=u16(cursor+2);cursor+=4;if(len>buffer.length-cursor)throw new Error('ART streaming thread 名称超出文件范围');cursor+=len;}else if(code===3){if(cursor+4>buffer.length)throw new Error('ART streaming summary 头不完整');const len=u32(cursor);cursor+=4;if(len>buffer.length-cursor)throw new Error('ART streaming summary 超出文件范围');break;}else throw new Error(`ART streaming trace 特殊记录类型无效：${code}`);continue;}
      if(cursor+recordSize-2>buffer.length)throw new Error('ART streaming trace 记录不完整');const methodWord=u32(cursor);cursor+=4;const threadTime=u32(cursor);cursor+=4;let wallTime;if(version===3&&recordSize>=14){wallTime=u32(cursor);cursor+=4;}cursor+=recordSize-(version===1?10:recordSize);pushEvent(tid,methodWord,threadTime,wallTime);
    }
  }else{
    const remaining=buffer.length-cursor;if(remaining%recordSize!==0)throw new Error('ART method trace 数据区包含不完整记录');const total=remaining/recordSize;if(total>maxEvents)throw new Error(`ART trace 事件数超过 ${maxEvents.toLocaleString()} 上限`);
    while(cursor<buffer.length){const tid=version===1?buffer[cursor]:u16(cursor);const field=version===1?cursor+1:cursor+2,methodWord=u32(field),timeFields=parseTimeFields(field+4,tid);pushEvent(tid,methodWord,timeFields.threadTime,timeFields.wallTime);cursor+=recordSize;}
  }
  let incompleteCalls=0;for(const stack of stacks.values())incompleteCalls+=stack.length;
  const methodStatsList=[...stats.values()].map(row=>({...row,inclusiveUs:row.inclusiveUs.toString(),exclusiveUs:row.exclusiveUs.toString()})).sort((a,b)=>BigInt(b.inclusiveUs)>BigInt(a.inclusiveUs)?1:BigInt(b.inclusiveUs)<BigInt(a.inclusiveUs)?-1:a.name.localeCompare(b.name));
  const completedCalls=methodStatsList.reduce((sum,row)=>sum+row.completedCalls,0);
  const origin=minTimestamp??0n,duration=maxTimestamp-origin;
  return {format:'ART method trace',version,streaming,clock,startTimeUs:baseTimeUs.toString(),durationUs:duration.toString(),eventCount:events,threadCount:new Set([...threads.keys(),...stacks.keys()]).size,methodCount:methods.size,completedCalls,incompleteCalls,unmatchedExits,intervalsTruncated:spanSeen>spans.length,methods:methodStatsList,threads:[...new Set([...threads.keys(),...stacks.keys()])].map(tid=>({tid,name:threads.get(tid)||`Thread ${tid}`})).sort((a,b)=>a.tid-b.tid),intervals:spans.map(span=>({...span,startUs:(BigInt(span.startUs)-origin).toString(),endUs:(BigInt(span.endUs)-origin).toString()}))};
}

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
  const root={name:symbol,weight:0,children:[]},lookup=new WeakMap(),parents=new WeakMap([[scope,null]]),stack=[scope];let matches=0,created=1;
  while(stack.length){
    const node=stack.pop();
    if(node.name===symbol){
      matches++;root.weight+=node.weight;if(!Number.isSafeInteger(root.weight))throw new Error('反向调用树权重超出安全范围');
      let target=root;for(let caller=parents.get(node);caller;caller=parents.get(caller)){const name=caller.name;let map=lookup.get(target);if(!map){map=new Map();lookup.set(target,map);}let next=map.get(name);if(!next){if(++created>100000)throw new Error('反向调用树超过 100,000 个节点');next={name,weight:0,children:[]};map.set(name,next);target.children.push(next);}next.weight+=node.weight;if(!Number.isSafeInteger(next.weight))throw new Error('反向调用树权重超出安全范围');target=next;}
    }
    for(let i=node.children.length-1;i>=0;i--){const child=node.children[i];parents.set(child,node);stack.push(child);}
  }
  const pending=[root];while(pending.length){const node=pending.pop();node.children.sort((a,b)=>b.weight-a.weight);for(const child of node.children)pending.push(child);}
  return {root,matches};
}

// Positions are normalized to the selected root's event-period weight.
export function layoutFlame(root,{maxDepth=40,maxNodes=3000}={}) {
  if(!root||!Number.isFinite(root.weight)||root.weight<=0)throw new Error('火焰图缺少有效权重');
 const rootFrame={node:root,x:0,width:1,depth:0,path:[]},frames=[rootFrame],stack=[{...rootFrame,next:0,cursor:0}];let truncated=false,depth=0;
 if(!Number.isInteger(maxDepth)||maxDepth<0||maxDepth>128||!Number.isInteger(maxNodes)||maxNodes<1||maxNodes>100000)throw new Error('火焰图绘制上限无效');
 while(stack.length){
    const parent=stack.at(-1);
    if(!Array.isArray(parent.node.children))throw new Error('火焰图调用树无效');
    if(parent.depth>=maxDepth){if(parent.node.children.length)truncated=true;stack.pop();continue;}
    if(parent.next>=parent.node.children.length){stack.pop();continue;}
    const index=parent.next++,node=parent.node.children[index];
    if(!node||!Number.isFinite(node.weight)||node.weight<=0)throw new Error('火焰图调用树无效');
    if(frames.length>=maxNodes){truncated=true;break;}
    const width=parent.width*node.weight/parent.node.weight,frame={node,x:parent.cursor,width,depth:parent.depth+1,path:[...parent.path,index]};parent.cursor+=width;
    frames.push(frame);depth=Math.max(depth,frame.depth);stack.push({...frame,next:0,cursor:frame.x});
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
      const libraries=Array.isArray(s.libraries)&&s.libraries.length===s.frames.length&&s.libraries.every(name=>typeof name==='string'&&name.length>0&&name.length<=4096&&!/[\x00-\x1f\x7f]/.test(name))?s.libraries:null;
      if(origin===null||time<origin)origin=time;if(last===null||time>last)last=time;
      valid.push({time,timeNs:s.timeNs,weight,frames:s.frames,libraries,threadName:s.thread,thread:`${s.thread}-${s.pid}/${s.tid}`,pid:s.pid,tid:s.tid});
    }catch{skipped++;}
  }
  if(!valid.length)return {available:false,skipped,truncated:!!input.truncated,event:input.event||'未知事件',clockId:typeof input.clockId==='string'?input.clockId:null};
  const span=last-origin;if(span>604800000000000n)throw new Error('时间线超过 7 天范围');
  const groups=new Map(),samplesByBin=Array.from({length:bins},()=>[]);
  for(const s of valid){s.bin=span===0n?0:Math.min(bins-1,Number((s.time-origin)*BigInt(bins)/span));samplesByBin[s.bin].push(s);
    let g=groups.get(s.thread);if(!g){g={thread:s.thread,pid:s.pid,tid:s.tid,counts:Array(bins).fill(0),weights:Array(bins).fill(0),total:0};groups.set(s.thread,g);}
    g.counts[s.bin]++;g.weights[s.bin]+=s.weight;g.total+=s.weight;if(!Number.isSafeInteger(g.total))throw new Error('时间线权重超出安全范围');
  }
  const samplesByTime=[...valid].sort((a,b)=>a.time<b.time?-1:a.time>b.time?1:0);
  return {available:true,event:input.event||'未知事件',clockId:typeof input.clockId==='string'?input.clockId:null,durationMs:Number(span)/1e6,bins,groups:[...groups.values()].sort((a,b)=>b.total-a.total),samples:valid,samplesByBin,samplesByTime,skipped,truncated:!!input.truncated};
}
export function cpuLibraryOptions(timeline,limit=500){
 if(!timeline?.available||!Array.isArray(timeline.samples)||!Number.isInteger(limit)||limit<1||limit>2000)return [];
 const counts=new Map();for(const sample of timeline.samples)for(const name of new Set(sample.libraries||[]))counts.set(name,(counts.get(name)||0)+sample.weight);
 return [...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,limit).map(([name,weight])=>({name,weight}));
}
export function filterCpuProfileByLibrary(timeline,library){
 if(!timeline?.available||!Array.isArray(timeline.samples)||typeof library!=='string'||!library||library.length>4096)throw new Error('CPU 库筛选参数无效');
 const samples=[];for(const sample of timeline.samples){if(!Array.isArray(sample.libraries)||sample.libraries.length!==sample.frames.length)continue;const frames=[],libraries=[];for(let i=0;i<sample.frames.length;i++)if(sample.libraries[i]===library){frames.push(sample.frames[i]);libraries.push(library);}if(frames.length)samples.push({timeNs:sample.timeNs,period:String(sample.weight),pid:sample.pid,tid:sample.tid,thread:sample.threadName||sample.thread.replace(/-\d+\/\d+$/,''),frames,libraries});}
 if(!samples.length)return {timeline:{available:false,event:timeline.event,clockId:timeline.clockId,skipped:0,truncated:timeline.truncated},profile:null};
 const filteredTimeline=buildSampleTimeline({event:timeline.event,clockId:timeline.clockId,truncated:timeline.truncated,samples},timeline.bins);
 const folded=filteredTimeline.samples.map(sample=>`${[sample.thread,...sample.frames].join(';')} ${sample.weight}`).join('\n');
 return {timeline:filteredTimeline,profile:parseFoldedStacks(folded)};
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
export function createCpuAnalysisReport({profile=null,timeline=null,methodTrace=null,captureDiagnostics=null,libraryFilter='all',fileName='cpu-profile',generatedAt=new Date().toISOString()}={}){
  if(methodTrace){
    if(methodTrace.format!=='ART method trace'||!Array.isArray(methodTrace.methods)||!Array.isArray(methodTrace.threads)||!Array.isArray(methodTrace.intervals))throw new Error('ART 方法报告数据无效');
    const sampleRows=(rows,limit)=>rows.length<=limit?rows:Array.from({length:limit},(_,index)=>rows[Math.floor(index*rows.length/limit)]),threads=sampleRows(methodTrace.threads,1000),methods=sampleRows(methodTrace.methods,1000),intervals=sampleRows(methodTrace.intervals,2000);
    return {schema:'android-performance-cpu-report',schemaVersion:1,generatedAt,fileName,profileType:'art-method-trace',summary:{version:methodTrace.version,streaming:methodTrace.streaming,clock:methodTrace.clock,durationUs:methodTrace.durationUs,eventCount:methodTrace.eventCount,threadCount:methodTrace.threadCount,methodCount:methodTrace.methodCount,completedCalls:methodTrace.completedCalls,incompleteCalls:methodTrace.incompleteCalls,unmatchedExits:methodTrace.unmatchedExits,intervalsTruncated:methodTrace.intervalsTruncated},threads,methods,intervals,captureDiagnostics,limits:{methodsReported:methods.length,threadsReported:threads.length,intervalsReported:intervals.length}};
  }
  if(!profile?.root||!Array.isArray(profile.symbols))throw new Error('CPU 报告没有可导出的采样数据');
  const quality=sampleQuality(timeline),threadTotals=timeline?.available?timeline.groups.slice(0,100).map(row=>({thread:row.thread,pid:row.pid,tid:row.tid,samples:row.counts.reduce((sum,count)=>sum+count,0),weight:row.total})):[];
  return {schema:'android-performance-cpu-report',schemaVersion:1,generatedAt,fileName,profileType:'sampled-call-stacks',source:profile.source||'import',weightMeaning:'sampling event period; not direct CPU time or CPU percentage',summary:{stacks:profile.stacks,totalWeight:profile.root.weight,symbolCount:profile.symbols.length,event:timeline?.event||'unknown',libraryFilter:libraryFilter==='all'?null:libraryFilter,sampleQuality:quality,timeline:timeline?{available:!!timeline.available,clockId:timeline.clockId||null,durationMs:timeline.durationMs??null,sampleCount:timeline.samples?.length||0,skipped:timeline.skipped||0,truncated:!!timeline.truncated}:null},topFunctions:profile.symbols.slice(0,1000),threads:threadTotals,captureDiagnostics,limits:{topFunctionsReported:Math.min(1000,profile.symbols.length),threadsReported:threadTotals.length}};
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
// Keep chronological sample stacks visible without creating one DOM/SVG node per frame.
// The renderer consumes this bounded projection and draws it to a canvas.
export function sampleStackTimeline(timeline,{thread=null,maxSamples=2000,maxDepth=32}={}) {
 if(!timeline?.available||!Array.isArray(timeline.samples)||!Number.isInteger(maxSamples)||maxSamples<1||maxSamples>5000||!Number.isInteger(maxDepth)||maxDepth<1||maxDepth>64||thread!==null&&typeof thread!=='string')throw new Error('调用栈时间图数据无效');
 const ordered=timeline.samplesByTime||[...timeline.samples].sort((a,b)=>a.time<b.time?-1:a.time>b.time?1:0),candidates=thread===null?ordered:ordered.filter(sample=>sample.thread===thread);
 if(!candidates.length)return {entries:[],functions:[],totalSamples:0,renderedSamples:0,truncated:false,maxDepth,startTime:null,endTime:null};
 const count=Math.min(candidates.length,maxSamples),entries=[],weights=new Map();
 for(let i=0;i<count;i++){
  const index=count===candidates.length?i:count===1?Math.floor((candidates.length-1)/2):Math.round(i*(candidates.length-1)/(count-1)),sample=candidates[index],allFrames=sample.frames||[],frames=allFrames.length>maxDepth?allFrames.slice(-maxDepth):allFrames;
  entries.push({sample,frames,omittedFrames:allFrames.length-frames.length});
  for(const name of frames){const weight=(weights.get(name)||0)+sample.weight;if(!Number.isSafeInteger(weight))throw new Error('调用栈时间图权重超出安全范围');weights.set(name,weight);}
 }
 const functions=[...weights].map(([name,weight])=>({name,weight})).sort((a,b)=>b.weight-a.weight||a.name.localeCompare(b.name)).slice(0,8);
 return {entries,functions,totalSamples:candidates.length,renderedSamples:entries.length,truncated:entries.length<candidates.length,maxDepth,startTime:candidates[0].time,endTime:candidates.at(-1).time};
}
export function drawSampleStackTimeline(canvas,projection,{devicePixelRatio=globalThis.devicePixelRatio||1}={}) {
 if(!canvas||!Array.isArray(projection?.entries)||!projection.entries.length||!Number.isFinite(devicePixelRatio)||devicePixelRatio<=0)throw new Error('调用栈时间图画布无效');
 const rowHeight=8,width=Math.max(1000,Math.min(10000,projection.entries.length*2)),height=Math.max(64,Math.max(1,...projection.entries.map(entry=>entry.frames.length))*rowHeight),dpr=Math.min(devicePixelRatio,2),span=projection.endTime-projection.startTime;
 canvas.width=Math.ceil(width*dpr);canvas.height=Math.ceil(height*dpr);canvas.style.width=`${width}px`;canvas.style.height=`${height}px`;
 const context=canvas.getContext('2d');if(!context)throw new Error('浏览器无法创建 CPU 时间图画布');context.setTransform(dpr,0,0,dpr,0,0);context.clearRect(0,0,width,height);
 const functionColors=new Map(projection.functions.map((fn,index)=>[fn.name,`hsl(${(index*43+28)%360} 54% 58%)`]));context.globalAlpha=.72;
 let drawnFrames=0;
 for(let i=0;i<projection.entries.length;i++){const entry=projection.entries[i],position=span===0n?(projection.entries.length===1?.5:i/(projection.entries.length-1)):Number(entry.sample.time-projection.startTime)/Number(span),x=position*(width-1.5);for(let depth=0;depth<entry.frames.length;depth++){const name=entry.frames[depth],y=height-(depth+1)*rowHeight;context.fillStyle=functionColors.get(name)||'#9aa6aa';context.fillRect(x,y,1.5,rowHeight-1);drawnFrames++;}}
 return {width,height,renderedSamples:projection.entries.length,drawnFrames};
}
export function profileForTimeBin(timeline,bin,thread=null) {
  if(!timeline?.available||!Number.isInteger(bin)||bin<0||bin>=timeline.bins)throw new Error('时间范围无效');
  if(thread!==null&&typeof thread!=='string')throw new Error('线程筛选无效');
  const candidates=timeline.samplesByBin?.[bin]||timeline.samples.filter(s=>s.bin===bin);
  const lines=candidates.filter(s=>thread===null||s.thread===thread).map(s=>`${[s.thread,...s.frames].join(';')} ${s.weight}`);
  if(!lines.length)throw new Error('所选时间范围没有样本');
  return parseFoldedStacks(lines.join('\n'));
}

export function profileForTimeRange(timeline,startMs,endMs,thread=null) {
  if(!timeline?.available||!Number.isFinite(startMs)||!Number.isFinite(endMs)||startMs<0||endMs<startMs||endMs>timeline.durationMs)throw new Error('时间范围无效，请输入快照范围内的起止毫秒');
  if(thread!==null&&typeof thread!=='string')throw new Error('线程筛选无效');
  const ordered=timeline.samplesByTime||[...timeline.samples].sort((a,b)=>a.time<b.time?-1:a.time>b.time?1:0),origin=ordered[0].time;
  const start=origin+BigInt(Math.round(startMs*1e6)),end=origin+BigInt(Math.round(endMs*1e6));
  const lowerBound=value=>{let lo=0,hi=ordered.length;while(lo<hi){const mid=(lo+hi)>>1;if(ordered[mid].time<value)lo=mid+1;else hi=mid;}return lo;};
  const upperBound=value=>{let lo=0,hi=ordered.length;while(lo<hi){const mid=(lo+hi)>>1;if(ordered[mid].time<=value)lo=mid+1;else hi=mid;}return lo;};
  const first=lowerBound(start),last=upperBound(end),lines=[];
  for(let i=first;i<last;i++){const s=ordered[i];if(thread===null||s.thread===thread)lines.push(`${[s.thread,...s.frames].join(';')} ${s.weight}`);}
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

export function correlateComposeStateApplyToExecution(runtimeGroups, events) {
  if (!Array.isArray(runtimeGroups) || !Array.isArray(events)) return [];
  const byKey = new Map();
  for (const group of runtimeGroups) {
    const key = String(group?.key ?? ''), lastApplyNs = group?.lastApplyNs;
    if (!/^-?\d{1,12}$/.test(key)) continue;
    const row = byKey.get(key) || {key, groups: 0, lastApplyNs: null};
    row.groups++;
    if (typeof lastApplyNs === 'string' && /^\d{1,19}$/.test(lastApplyNs) && (row.lastApplyNs === null || BigInt(lastApplyNs) > BigInt(row.lastApplyNs))) row.lastApplyNs = lastApplyNs;
    byKey.set(key, row);
  }
  const executions = new Map();
  for (const event of events) {
    if (event?.measurement !== 'automatic-execution' || event.clock !== 'uptime' || event.groupKey === null || event.groupKey === undefined || typeof event.elapsedNs !== 'string' || !/^\d{1,19}$/.test(event.elapsedNs)) continue;
    const key = String(event.groupKey), group = byKey.get(key);
    if (!group || group.groups !== 1 || BigInt(event.elapsedNs) < BigInt(group.lastApplyNs)) continue;
    const previous = executions.get(key);
    if (!previous || BigInt(event.elapsedNs) < BigInt(previous.executionNs)) executions.set(key, {executionNs: event.elapsedNs, name: event.name || null});
  }
  return [...byKey.values()].filter(row => row.lastApplyNs !== null).map(row => {
    const execution = executions.get(row.key);
    return {...row, ...(execution ? {executionNs: execution.executionNs, executionName: execution.name, deltaNs: (BigInt(execution.executionNs) - BigInt(row.lastApplyNs)).toString()} : {})};
  });
}

export function matchComposeRuntimeGroups(nodes, key) {
  if (!Array.isArray(nodes) || !Number.isSafeInteger(key)) return [];
  return nodes.filter(node => node?.className === 'ComposeRuntimeGroup' && node.attributes?.['compose-key'] === String(key));
}

// Accessibility snapshots may omit fields or descendants. Report candidates
// only when the recorded subtree has explicit, empty label fields throughout.
export function inspectLayout(nodes,{densityDpi=null}={}){
 if(!Array.isArray(nodes))throw new Error('层级节点无效');
 const densityScale=Number.isFinite(densityDpi)&&densityDpi>0&&densityDpi<=1000?densityDpi/160:null;
 const findings=[],stack=[];
 const finding=(node,kind,confidence,evidence,extra={})=>({id:node.id,nodeId:node.id,kind,ruleId:`UIA_${kind.replace(/[A-Z]/g,letter=>`_${letter}`).toUpperCase()}`,severity:kind==='smallTouchTarget'?'warning':kind==='unlabelled'?'warning':'info',confidence,evidence,...extra});
 const flush=()=>{const item=stack.pop(),a=item.node.attributes||{};
  const interactive=a.clickable==='true'||a['long-clickable']==='true'||a.checkable==='true';
  if(interactive&&a.enabled!=='false'){
   if(item.complete&&!item.label)findings.push(finding(item.node,'unlabelled','high',{emptyLabelFields:['text','content-desc'],checkedSubtree:true}));
   const b=item.node.bounds;if(Array.isArray(b)&&b.length===4&&b.every(Number.isFinite)&&b[2]>=b[0]&&b[3]>=b[1]){
    const width=b[2]-b[0],height=b[3]-b[1];
    if(width===0||height===0)findings.push(finding(item.node,'emptyBounds','high',{bounds:b,widthPx:width,heightPx:height}));
    else if(densityScale&&(width/densityScale<48||height/densityScale<48))findings.push(finding(item.node,'smallTouchTarget','medium',{bounds:b,densityDpi,widthDp:width/densityScale,heightDp:height/densityScale,minimumDp:48},{widthDp:width/densityScale,heightDp:height/densityScale}));
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
  function matchId(node) {
    const resourceId = node.attributes['resource-id'];
    if (resourceId) return resourceId;
    const tag = node.attributes['compose-test-tag'];
    return node.className === 'ComposeSemanticsNode' && typeof tag === 'string' && tag.length ? `compose-test-tag:${tag}` : null;
  }
  function index(nodes) {
    const map=new Map();let unkeyed=0;
    for(const node of nodes){const id=matchId(node);if(!id){unkeyed++;continue;}const key=`${node.attributes.package||''}\0${id}`;const list=map.get(key)||[];list.push(node);map.set(key,list);}
    return {map,unkeyed};
  }
  const a=index(before),b=index(after),changes=[],ambiguous=[];
  // Shared unique resource IDs and Compose test tags can anchor descendant matching.
  // Unkeyed or duplicate containers are skipped rather than guessed.
  const anchors=new Set([...a.map.keys()].filter(key=>a.map.get(key).length===1&&b.map.get(key)?.length===1));
  function parents(nodes){
    const result=new Map(),stack=[];
    for(const node of nodes){
      while(stack.length&&stack.at(-1).depth>=node.depth)stack.pop();
      const id=matchId(node),key=id?`${node.attributes.package||''}\0${id}`:null;
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
      const id=matchId(node),key=id?`${node.attributes.package||''}\0${id}`:null;
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
