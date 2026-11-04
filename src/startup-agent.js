const EVENT_NAMES = new Set(['agent-installed','application-created','activity-created','activity-resumed','first-draw','fully-drawn']);
const MAX_INPUT_LINES = 20000;
const MAX_OUTPUT_EVENTS = 500;

function decodeActivity(encoded) {
  if (encoded === '-') return null;
  if (!/^[A-Za-z0-9_-]{1,800}$/.test(encoded)) return undefined;
  try {
    const value = Buffer.from(encoded, 'base64url').toString('utf8');
    if (Buffer.from(value, 'utf8').toString('base64url') !== encoded || value.length > 600 || !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(value)) return undefined;
    return value;
  } catch { return undefined; }
}

function phaseMs(start, end) {
  if (start === undefined || end === undefined) return null;
  const delta = BigInt(end) - BigInt(start);
  return delta < 0n ? null : Number(delta) / 1e6;
}

export function summarizeStartupAgentEvents(events) {
  const groups = new Map();
  for (const event of events) {
    if (!event.activityId) continue;
    const key = `${event.processSessionId}:${event.activityId}`;
    const group = groups.get(key) || { processSessionId:event.processSessionId, activityId:event.activityId, activity:event.activity, events:[], times:Object.create(null) };
    group.events.push(event);if (group.times[event.name] === undefined) group.times[event.name] = event.monotonicNs;groups.set(key,group);
  }
  return [...groups.values()].map(group=>({
    processSessionId:group.processSessionId,activityId:group.activityId,activity:group.activity,
    createdToResumedMs:phaseMs(group.times['activity-created'],group.times['activity-resumed']),
    resumedToFirstDrawMs:phaseMs(group.times['activity-resumed'],group.times['first-draw']),
    firstDrawToFullyDrawnMs:phaseMs(group.times['first-draw'],group.times['fully-drawn']),
    milestones:group.events.map(event=>event.name),
  }));
}

export function startupAgentIterationEvidence(before,after,{limit=100}={}) {
  if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('启动里程碑逐轮事件上限无效');
  if(before?.error)return {available:false,reason:`无法建立运行前的 Agent 事件边界：${before.error}`,events:[],activitySummaries:[]};
  if(after?.error)return {available:false,reason:`运行后无法读取 Agent 事件：${after.error}`,events:[],activitySummaries:[]};
  if(!after?.processSessionId||!Array.isArray(after.events)||after.events.length===0)return {available:false,reason:'运行后未读取到可配对的 Startup Agent 事件',events:[],activitySummaries:[]};
  const sameSession=before?.processSessionId===after.processSessionId;
  let events=after.events;
  if(sameSession){
    const previous=before.events||[],highWater=previous.reduce((value,event)=>{const stamp=BigInt(event.monotonicNs);return value===null||stamp>value?stamp:value;},null);
    if(highWater!==null)events=events.filter(event=>BigInt(event.monotonicNs)>highWater);
  }
  const eventCount=events.length;
  events=events.slice(-limit);
  if(!events.length)return {available:false,reason:'启动区间内没有新的 Startup Agent 事件',events:[],activitySummaries:[]};
  return {available:true,processSessionId:after.processSessionId,events,activitySummaries:summarizeStartupAgentEvents(events),boundary:sameSession?'monotonic-cursor':'new-process-session',truncated:eventCount>limit};
}

/** Parses only APWS1 records and optionally limits them to PIDs already resolved for the target package. */
export function parseStartupAgentLog(text,{serial=null,packageName=null,pids=null,limit=MAX_OUTPUT_EVENTS}={}) {
  if(typeof text!=='string'||text.length>8*1024*1024)throw new Error('Startup Agent Logcat 输入无效或超过 8 MiB');
  if(!Number.isInteger(limit)||limit<1||limit>MAX_OUTPUT_EVENTS)throw new Error('Startup Agent 事件上限无效');
  const allowedPids=pids?new Set(pids.map(Number).filter(Number.isSafeInteger)):null;
  const allLines=text.split(/\r?\n/),inputTruncated=allLines.length>MAX_INPUT_LINES,lines=allLines.slice(-MAX_INPUT_LINES),matches=[],seen=new Set();let ignored=0;
  const pattern=/^[VDIWEF]\/APWStartup\(\s*(\d+)\):\s*APWS1\|([0-9a-f]{32})\|([0-9a-f]{32}|-)\|([a-z-]{1,32})\|([A-Za-z0-9_-]+|-)\|(-?\d{1,19})\|(\d{1,10})\s*$/;
  for(const line of lines){
    if(!line.includes('APWS1|'))continue;
    const match=pattern.exec(line);if(!match){ignored++;continue;}
    const [,headerPid,processSessionId,activityId,eventName,encodedActivity,monotonicNs,recordPid]=match,logPid=Number(headerPid),pid=Number(recordPid),activity=decodeActivity(encodedActivity);
    if(!EVENT_NAMES.has(eventName)||activity===undefined||!Number.isSafeInteger(logPid)||logPid!==pid||allowedPids&&!allowedPids.has(pid)){ignored++;continue;}
    const applicationEvent=eventName==='application-created'||eventName==='agent-installed';
    if(applicationEvent?(activityId!=='-'||activity!==null):(activityId==='-'||activity===null)){ignored++;continue;}
    const timestamp=BigInt(monotonicNs);if(timestamp>9223372036854775807n||timestamp< -9223372036854775808n){ignored++;continue;}
    const key=`${processSessionId}|${activityId}|${eventName}|${monotonicNs}`;if(seen.has(key))continue;seen.add(key);
    matches.push({processSessionId,activityId:activityId==='-'?null:activityId,name:eventName,activity,pid,monotonicNs:timestamp.toString()});
  }
  const session=matches.at(-1)?.processSessionId||null,sessionEvents=session?matches.filter(event=>event.processSessionId===session).sort((a,b)=>BigInt(a.monotonicNs)<BigInt(b.monotonicNs)?-1:BigInt(a.monotonicNs)>BigInt(b.monotonicNs)?1:0):[],events=sessionEvents.slice(-limit);
  return {source:'agent',serial,packageName,processSessionId:session,events,activitySummaries:summarizeStartupAgentEvents(events),eventCount:sessionEvents.length,ignored,truncated:sessionEvents.length>limit||inputTruncated,processSessions:[...new Set(matches.map(event=>event.processSessionId))]};
}
