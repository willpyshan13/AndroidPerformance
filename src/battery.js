import {parseCsv} from './trace-analysis.js';
import {parseBattery} from './parsers.js';
const numeric=value=>{if(!/^\d+$/.test(value||''))return null;const n=Number(value);return Number.isSafeInteger(n)?n:null;};
const charge=value=>{if(typeof value!=='string'||!/^\d+(?:\.\d+)?$/.test(value))return null;const n=Number(value);return Number.isFinite(n)&&n>=0?n:null;};
const token=(fields,marker)=>{const i=fields.indexOf(marker);return i>0?{timeMs:numeric(fields[i-1]),count:numeric(fields[i+1])}:null;};
export function parseBatteryStats(raw,packageName,{serial=null,batteryRaw=null,source='import'}={}){
  if(typeof packageName!=='string'||!/^[a-zA-Z][\w]*(?:\.[\w]+)+$/.test(packageName))throw new Error('应用包名无效');
  if(typeof raw!=='string'||raw.length>24*1024*1024)throw new Error('batterystats 文件无效或超过 24 MiB');
  const rows=parseCsv(raw).filter(r=>r.length>=4&&/^\d+$/.test(r[0]));if(!rows.length||rows.length>200000)throw new Error('不是有效的 batterystats checkin 数据或记录过多');
  const versions=rows.filter(r=>r[2]==='i'&&r[3]==='vers').map(r=>r[4]);
  if(!versions.length)throw new Error('batterystats 缺少版本信息');
  const mappings=rows.filter(r=>r[2]==='i'&&r[3]==='uid'&&r[5]===packageName).map(r=>numeric(r[4])).filter(x=>x!==null);
  const uids=[...new Set(mappings)];if(uids.length!==1)throw new Error(uids.length?'应用对应多个 UID，无法确定用户':'batterystats 未提供该应用的 UID');
  const uid=uids[0],packages=[...new Set(rows.filter(r=>r[2]==='i'&&r[3]==='uid'&&numeric(r[4])===uid).map(r=>r[5]).filter(Boolean))];
  const list=rows.filter(r=>r[1]===String(uid)&&r[2]==='l'),networkRows=list.filter(r=>r[3]==='nt');
  if(networkRows.length>1)throw new Error('存在多个网络统计行，无法安全归属');
  const powerRows=list.filter(r=>r[3]==='pwi'&&r[4]==='uid');
  const power=powerRows.length===1&&charge(powerRows[0][5])!==null?{estimatedMah:charge(powerRows[0][5]),rawValue:powerRows[0][5],source:'batterystats-pwi'}:null;
  const network=networkRows.length?Object.fromEntries(['mobileRxBytes','mobileTxBytes','wifiRxBytes','wifiTxBytes','mobileRxPackets','mobileTxPackets','wifiRxPackets','wifiTxPackets','mobileActiveMs','mobileActiveCount'].map((k,i)=>[k,numeric(networkRows[0][i+4])])):null;
  const entries=(type)=>list.filter(r=>r[3]===type).map(r=>({name:r[4]||'(未命名)',timeMs:numeric(r[5]),count:numeric(r[6])}));
  const wakelocks=list.filter(r=>r[3]==='wl').map(r=>({name:r[4]||'(未命名)',partial:token(r.slice(5),'p')}));
  const bt=rows.find(r=>r[1]==='0'&&r[2]==='l'&&r[3]==='bt');
  return {source,timestamp:Date.now(),serial,packageName,uid,packages,version:String(versions[0]),sessionStart:bt?numeric(bt[9]):null,
    battery:batteryRaw===null?null:parseBattery(batteryRaw),power,network,wakelocks,alarms:list.filter(r=>r[3]==='wua').map(r=>({name:r[4]||'(未命名)',timeMs:null,count:numeric(r[5])})),jobs:entries('jb'),syncs:entries('sy'),sensors:entries('sr'),
    note:'统计属于 UID，可能由共享 UID 的多个应用共同产生；l 表示系统当前 since-charged 聚合窗口，不是本次实验的独立耗电量。'};
}
export function compareBatteryStats(before,after){
  if(!before||!after||before.packageName!==after.packageName||before.uid!==after.uid||!before.serial||before.serial!==after.serial)throw new Error('两次快照须来自同一设备、应用和 UID');
  if(!before.sessionStart||!after.sessionStart||before.sessionStart!==after.sessionStart)throw new Error('统计窗口无法确认一致或已重置，不能计算差值');
  if(after.timestamp<before.timestamp)throw new Error('结束快照早于基线');
  const warnings=[];
  const delta=(a,b,label)=>{if(a===null||a===undefined||b===null||b===undefined)return null;if(!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||a<0||b<0)throw new Error('快照包含无效计数');if(b<a){warnings.push(`${label} 计数下降，可能发生重置`);return null;}return b-a;};
  const network=before.network&&after.network?Object.fromEntries(Object.keys(before.network).map(k=>[k,delta(before.network[k],after.network[k],k)])):null;
  const diffList=(key,field)=>{const a=new Map();for(const row of before[key]||[]){if(a.has(row.name))a.set(row.name,null);else a.set(row.name,row);}const b=new Map();for(const row of after[key]||[]){if(b.has(row.name))b.set(row.name,null);else b.set(row.name,row);}return [...b].map(([name,row])=>{const old=a.get(name);const x=field?old?.[field]:old,y=field?row?.[field]:row;return {name,timeMs:delta(x?.timeMs,y?.timeMs,name),count:delta(x?.count,y?.count,name)};});};
  return {elapsedMs:after.timestamp-before.timestamp,uid:after.uid,network,wakelocks:diffList('wakelocks','partial'),alarms:diffList('alarms'),jobs:diffList('jobs'),syncs:diffList('syncs'),sensors:diffList('sensors'),warnings,
    note:'差值仅为同一 UID 在两次系统累计快照之间的变化；缺失行不视为零，计数下降视为不可比。不是应用耗电量或因果结论。'};
}
