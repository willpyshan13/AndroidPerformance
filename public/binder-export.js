import {formatTraceQueryCsv} from './trace-export.js';

const MAX_BINDER_TRANSACTIONS=500;
const MAX_TEXT=512;
const text=(value,max=MAX_TEXT)=>typeof value==='string'?value.slice(0,max):'';
const optionalId=value=>typeof value==='string'&&/^-?\d{1,19}$/.test(value)?value:null;

function boundedTransactions(value){
 if(!Array.isArray(value)||value.length>MAX_BINDER_TRANSACTIONS)throw new Error('Binder 事务结果无效或超过导出限制');
 return value.map(row=>{
  if(!row||typeof row!=='object')throw new Error('Binder 事务结果无效');
  const durationNs=optionalId(row.durationNs),serverDurationNs=optionalId(row.serverDurationNs);
  if(durationNs===null||BigInt(durationNs)<0n||(serverDurationNs!==null&&BigInt(serverDurationNs)<0n))throw new Error('Binder 事务耗时无效');
  return {tsNs:optionalId(row.tsNs),durationNs,client:text(row.client),clientTid:optionalId(row.clientTid),server:text(row.server),serverTid:optionalId(row.serverTid),aidl:text(row.aidl),interface:text(row.interface),method:text(row.method),sync:row.sync===true?true:row.sync===false?false:null,serverTsNs:optionalId(row.serverTsNs),serverDurationNs,id:optionalId(row.id)};
 });
}

export function binderTransactionsCsv(transactions){
 const rows=boundedTransactions(transactions);
 const columns=['client_timestamp_ns','client_duration_ns','client_process','client_tid','server_process','server_tid','aidl_interface','binder_interface','binder_method','synchronous','server_timestamp_ns','server_duration_ns','transaction_id'];
 const data=rows.map(row=>[row.tsNs,row.durationNs,row.client,row.clientTid,row.server,row.serverTid,row.aidl,row.interface,row.method,row.sync===null?'':String(row.sync),row.serverTsNs,row.serverDurationNs,row.id]);
 return formatTraceQueryCsv(columns,data);
}

function boundedMethodGroups(value){
 if(!Array.isArray(value)||value.length>200)throw new Error('Binder 方法汇总无效或超过导出限制');
 return value.map(row=>{
  if(!row||typeof row!=='object')throw new Error('Binder 方法汇总无效');
  const integer=(item,nullable=false)=>{if(item===null&&nullable)return null;if(typeof item!=='string'||!/^\d{1,19}$/.test(item))throw new Error('Binder 方法汇总数值无效');return item;};
  const count=Number(row.count),syncCount=Number(row.syncCount);
  if(!Number.isSafeInteger(count)||count<0||!Number.isSafeInteger(syncCount)||syncCount<0||syncCount>count)throw new Error('Binder 方法汇总计数无效');
  return {client:text(row.client),server:text(row.server),interface:text(row.interface),method:text(row.method),count,totalClientNs:integer(row.totalClientNs),totalServerNs:integer(row.totalServerNs,true),maxClientNs:integer(row.maxClientNs),syncCount};
 });
}
export function binderMethodSummaryCsv(groups){
 const rows=boundedMethodGroups(groups),columns=['client_process','server_process','binder_interface','binder_method','transaction_count','total_client_duration_ns','total_server_duration_ns','max_client_duration_ns','sync_transaction_count'];
 return formatTraceQueryCsv(columns,rows.map(row=>[row.client,row.server,row.interface,row.method,String(row.count),row.totalClientNs,row.totalServerNs,row.maxClientNs,String(row.syncCount)]));
}
export function binderMethodSummaryJson(result,{traceFileName=null,packageName=null,direction='both'}={}){
 if(!result||!['both','client','server'].includes(direction))throw new Error('Binder 方法汇总无效');
 const groups=boundedMethodGroups(result.groups);
 return `${JSON.stringify({schemaVersion:1,kind:'perfetto-binder-method-summary',traceFileName:text(traceFileName),packageName:text(packageName),direction,limit:200,truncated:result.truncated===true,generatedAt:new Date().toISOString(),count:groups.length,groups},null,2)}\n`;
}

export function binderTransactionsJson(result,{traceFileName=null}={}){
 if(!result||!['both','client','server'].includes(result.direction??'both'))throw new Error('Binder 事务结果无效');
 const transactions=boundedTransactions(result.transactions);
 return `${JSON.stringify({schemaVersion:1,kind:'perfetto-binder-transactions',traceFileName:text(traceFileName),packageName:text(result.packageName),direction:result.direction??'both',limit:MAX_BINDER_TRANSACTIONS,truncated:result.truncated===true,generatedAt:new Date().toISOString(),count:transactions.length,transactions},null,2)}\n`;
}

export function binderBreakdownCsv(result){
 if(!result||!Array.isArray(result.summary)||result.summary.length>100||!Array.isArray(result.intervals)||result.intervals.length>1000)throw new Error('Binder 阶段分解结果无效或超过导出限制');
 const columns=['record_type','side','reason','timestamp_ns','duration_ns','count'];
 const rows=[...result.summary.map(row=>['summary',text(row.side),text(row.reason),null,optionalId(row.durationNs),Number.isSafeInteger(row.count)&&row.count>=0?String(row.count):'']),...result.intervals.map(row=>['interval',text(row.side),text(row.reason),optionalId(row.tsNs),optionalId(row.durationNs),null])];
 if(rows.some(row=>row[4]===null||(row[0]==='interval'&&row[3]===null)))throw new Error('Binder 阶段时间无效');
 return formatTraceQueryCsv(columns,rows,{maxRows:1100});
}

export function binderBreakdownJson(result,{traceFileName=null,transactionId=null}={}){
 if(!result||!Array.isArray(result.summary)||result.summary.length>100||!Array.isArray(result.intervals)||result.intervals.length>1000)throw new Error('Binder 阶段分解结果无效或超过导出限制');
 const summary=result.summary.map(row=>({side:text(row.side),reason:text(row.reason),durationNs:optionalId(row.durationNs),count:Number.isSafeInteger(row.count)&&row.count>=0?row.count:null}));
 const intervals=result.intervals.map(row=>({side:text(row.side),reason:text(row.reason),tsNs:optionalId(row.tsNs),durationNs:optionalId(row.durationNs)}));
 if(summary.some(row=>row.durationNs===null)||intervals.some(row=>row.tsNs===null||row.durationNs===null))throw new Error('Binder 阶段时间无效');
 return `${JSON.stringify({schemaVersion:1,kind:'perfetto-binder-transaction-breakdown',traceFileName:text(traceFileName),transactionId:optionalId(transactionId),summaryTruncated:result.summaryTruncated===true,intervalsTruncated:result.intervalsTruncated===true,generatedAt:new Date().toISOString(),summary,intervals},null,2)}\n`;
}
