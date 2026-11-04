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
  return {tsNs:optionalId(row.tsNs),durationNs,client:text(row.client),clientTid:optionalId(row.clientTid),server:text(row.server),serverTid:optionalId(row.serverTid),aidl:text(row.aidl),sync:row.sync===true?true:row.sync===false?false:null,serverTsNs:optionalId(row.serverTsNs),serverDurationNs,id:optionalId(row.id)};
 });
}

export function binderTransactionsCsv(transactions){
 const rows=boundedTransactions(transactions);
 const columns=['client_timestamp_ns','client_duration_ns','client_process','client_tid','server_process','server_tid','aidl_interface','synchronous','server_timestamp_ns','server_duration_ns','transaction_id'];
 const data=rows.map(row=>[row.tsNs,row.durationNs,row.client,row.clientTid,row.server,row.serverTid,row.aidl,row.sync===null?'':String(row.sync),row.serverTsNs,row.serverDurationNs,row.id]);
 return formatTraceQueryCsv(columns,data);
}

export function binderTransactionsJson(result,{traceFileName=null}={}){
 if(!result||!['both','client','server'].includes(result.direction??'both'))throw new Error('Binder 事务结果无效');
 const transactions=boundedTransactions(result.transactions);
 return `${JSON.stringify({schemaVersion:1,kind:'perfetto-binder-transactions',traceFileName:text(traceFileName),packageName:text(result.packageName),direction:result.direction??'both',limit:MAX_BINDER_TRANSACTIONS,truncated:result.truncated===true,generatedAt:new Date().toISOString(),count:transactions.length,transactions},null,2)}\n`;
}
