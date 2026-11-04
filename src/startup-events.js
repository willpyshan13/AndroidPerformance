const MAX_EVENT_LINES=10000;
const MAX_EVENT_TEXT=2*1024*1024;
const EVENT_NAMES=new Set(['launch-time','fully-drawn-time']);
function validComponent(value,packageName){
 if(typeof value!=='string'||value.length>600)return false;
 const slash=value.indexOf('/');if(slash<1||slash!==value.lastIndexOf('/'))return false;
 const pkg=value.slice(0,slash),activity=value.slice(slash+1);
 return pkg===packageName&&/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(pkg)&&/^(?:\.[\w$]+|[A-Za-z_$][\w$]*(?:\.[\w$]+)*)$/.test(activity);
}
function duration(value){return /^\d{1,10}$/.test(value)&&Number(value)<=3600000?Number(value):null;}
function eventKey(event){return `${event.name}|${event.userId}|${event.activityToken}|${event.component}|${event.activityTimeMs}|${event.totalTimeMs}`;}
export function parseStartupSystemEvents(text,{packageName=null,component=null,limit=1000}={}){
 if(typeof text!=='string'||text.length>MAX_EVENT_TEXT)throw new Error('系统启动事件输入无效或超过 2 MiB');
 if(packageName!==null&&!/^[A-Za-z][\w]*(?:\.[\w]+)+$/.test(packageName))throw new Error('系统启动事件包名无效');
 if(component!==null&&(!packageName||!validComponent(component,packageName)))throw new Error('系统启动事件 Activity 无效');
 if(!Number.isInteger(limit)||limit<1||limit>1000)throw new Error('系统启动事件上限无效');
 const lines=text.split(/\r?\n/),matches=[],pattern=/^[VDIWEF]\/am_activity_(launch_time|fully_drawn_time)\(\s*\d+\):\s*\[([^\]]{1,1200})\]\s*$/;
 let ignored=0;
 for(const line of lines.slice(-MAX_EVENT_LINES)){
  if(!line.includes('am_activity_'))continue;
  const match=pattern.exec(line);if(!match){ignored++;continue;}
  const name=match[1].replaceAll('_','-'),parts=match[2].split(',').map(value=>value.trim());
  if(!EVENT_NAMES.has(name)||![4,5].includes(parts.length)){ignored++;continue;}
  const [userId,activityToken,activityComponent]=parts,activityTimeMs=duration(parts.at(-2)),totalTimeMs=duration(parts.at(-1));
  if(!/^\d{1,6}$/.test(userId)||!/^\d{1,12}$/.test(activityToken)||!validComponent(activityComponent,packageName)||component&&activityComponent!==component||activityTimeMs===null||totalTimeMs===null){ignored++;continue;}
  matches.push({name,userId:Number(userId),activityToken,component:activityComponent,activityTimeMs,totalTimeMs});
 }
 return {events:matches.slice(-limit),eventCount:matches.length,ignored,truncated:lines.length>MAX_EVENT_LINES};
}
export function startupSystemIterationEvidence(before,after,{component,packageName}={}){
 if(before?.error)return {available:false,reason:`无法读取运行前系统事件：${String(before.error).slice(0,500)}`,events:[],ttidMs:null,ttfdMs:null};
 if(after?.error)return {available:false,reason:`无法读取运行后系统事件：${String(after.error).slice(0,500)}`,events:[],ttidMs:null,ttfdMs:null};
 if(!before||!after||!Array.isArray(before.events)||!Array.isArray(after.events))return {available:false,reason:'系统启动事件边界无效',events:[],ttidMs:null,ttfdMs:null};
 const prior=new Map();for(const event of before.events){const key=eventKey(event);prior.set(key,(prior.get(key)||0)+1);}
 const fresh=[];for(const event of after.events){const key=eventKey(event),count=prior.get(key)||0;if(count){prior.set(key,count-1);continue;}if(event.component===component&&event.component.startsWith(`${packageName}/`))fresh.push(event);}
 if(!fresh.length)return {available:false,reason:'运行区间内没有新的目标应用系统启动事件',events:[],ttidMs:null,ttfdMs:null};
 const launch=fresh.filter(event=>event.name==='launch-time'),fullyDrawn=fresh.filter(event=>event.name==='fully-drawn-time');
 const latestLaunch=launch.at(-1),drawn=latestLaunch?fullyDrawn.find(event=>event.userId===latestLaunch.userId&&event.activityToken===latestLaunch.activityToken&&event.component===latestLaunch.component):null;
 return {available:true,source:'android-event-log',events:fresh.slice(-100),ttidMs:latestLaunch?.totalTimeMs??null,activityDisplayMs:latestLaunch?.activityTimeMs??null,ttfdMs:drawn?.totalTimeMs??null,activityToken:latestLaunch?.activityToken??null,component:latestLaunch?.component??fresh.at(-1)?.component,truncated:after.truncated===true};
}
