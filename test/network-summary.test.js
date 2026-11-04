import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseHar,filterNetworkRequests,networkRequestsCsv,networkRequestsHar,networkRequestsJson,summarizeHarHosts,summarizeNetworkEndpoints,summarizeNetworkConcurrency,buildNetworkTimeline} from '../public/offline.js';

test('HAR host statistics use only present phase evidence, including zero and independent TLS',()=>{
 const entries=[
  {request:{url:'https://example.org/a?q=secret'},response:{status:200},timings:{dns:0,connect:100,ssl:40,wait:20}},
  {request:{url:'https://example.org/b'},response:{status:500},timings:{dns:-1,connect:-1,ssl:-1,wait:40}},
  {request:{url:'http://other.org/'},response:{status:0},timings:{}},
 ];
 const rows=parseHar({log:{entries}}),summary=summarizeHarHosts(rows),host=summary[0];
 assert.equal(host.host,'example.org');assert.equal(host.count,2);assert.equal(host.failures,1);
 assert.deepEqual(host.phases.dns,{count:1,mean:0});assert.deepEqual(host.phases.connect,{count:1,mean:100});
 assert.deepEqual(host.phases.ssl,{count:1,mean:40});assert.deepEqual(host.phases.wait,{count:2,mean:30});
 assert.deepEqual(host.phases.receive,{count:0,mean:null});assert.equal(summary[1].failures,1);
 assert.doesNotMatch(JSON.stringify(summary),/secret/);
});

test('HAR retains epoch timestamps and rejects non-finite values as absent',()=>{
 const [row]=parseHar({log:{entries:[{startedDateTime:'1970-01-01T00:00:00.000Z',request:{url:'http://localhost/'},response:{content:{size:Infinity}},time:Infinity,timings:{ssl:Infinity}}]}});
 assert.equal(row.startedAt,0);assert.equal(row.bytes,null);assert.equal(row.timeMs,null);assert.equal(row.timings.ssl,null);
});

test('network filters combine method, status, connection, time and duration without widening evidence',()=>{
 const rows=parseHar({log:{entries:[
  {startedDateTime:'2026-01-01T00:00:00.000Z',connection:'socket-a',request:{url:'https://one.test/a?secret=1',method:'GET'},response:{status:200},time:10},
  {startedDateTime:'2026-01-01T00:00:01.000Z',connection:'socket-b',request:{url:'https://one.test/b',method:'POST'},response:{status:503},time:40},
  {startedDateTime:'2026-01-01T00:00:02.000Z',connection:'https://private.test',request:{url:'https://two.test/c',method:'GET'},response:{status:302},time:25},
 ]}});
 assert.deepEqual(rows.map(row=>row.connectionId),['socket-a','socket-b',null]);
 const result=filterNetworkRequests(rows,{query:'ONE.TEST',method:'GET',status:'2xx',connection:'socket-a',minDuration:'5',maxDuration:'15',from:'2026-01-01T00:00:00.000Z',to:'2026-01-01T00:00:00.500Z'});
 assert.deepEqual(result.map(row=>row.id),[1]);
 assert.deepEqual(filterNetworkRequests(rows,{status:'failure'}).map(row=>row.id),[2]);
 assert.deepEqual(filterNetworkRequests(rows,{status:'3xx'}).map(row=>row.id),[3]);
 assert.throws(()=>filterNetworkRequests(rows,{minDuration:'30',maxDuration:'10'}),/不能大于/);
 assert.throws(()=>filterNetworkRequests(rows,{from:'bad-date'}),/无效/);
});

test('network CSV export quotes fields, omits HAR secrets, and protects spreadsheet formulas',()=>{
 const [harRow]=parseHar({log:{entries:[{request:{url:'https://u:p@example.test/a,b?token=secret',method:'GET'},response:{status:200},time:12}]} });
 const csv=networkRequestsCsv([harRow,{...harRow,id:2,method:'=1+1',url:'https://example.test/a,"b',startedAt:null}]);
 assert.match(csv,/"开始时间","方法","URL"/);assert.match(csv,/"'=1\+1"/);assert.match(csv,/"https:\/\/example\.test\/a,""b"/);
 assert.doesNotMatch(csv,/secret|u:p|token=/);assert.equal(csv.endsWith('\r\n'),true);assert.equal((csv.match(/\r\n/g)||[]).length,3);
 assert.throws(()=>networkRequestsCsv(Array(50001).fill(harRow)),/超过/);
});

test('network HAR export preserves normalized evidence and excludes request secrets',()=>{
 const [row]=parseHar({log:{entries:[{startedDateTime:'2026-01-01T00:00:00.000Z',connection:'socket-1',request:{url:'https://user:pass@example.test/api/items?token=secret',method:'GET',headers:[{name:'Authorization',value:'secret'}],cookies:[{name:'sid',value:'secret'}],postData:{text:'secret'}},response:{status:200,content:{size:42}},time:12,timings:{dns:1,connect:2,ssl:3,wait:4,receive:5}}]}});
 const doc=networkRequestsHar([row]),entry=doc.log.entries[0];
 assert.equal(doc.log.version,'1.2');assert.equal(entry.request.url,'https://example.test/api/items');assert.equal(entry.startedDateTime,'2026-01-01T00:00:00.000Z');assert.equal(entry.time,12);assert.equal(entry.response.content.size,42);assert.equal(entry.connection,'socket-1');
 assert.deepEqual(entry.request.headers,[]);assert.deepEqual(entry.request.cookies,[]);assert.equal(entry.request.bodySize,-1);assert.equal(entry.timings.ssl,3);assert.doesNotMatch(JSON.stringify(doc),/secret|user:pass|token=/);
 const [roundTrip]=parseHar(doc);assert.equal(roundTrip.url,'https://example.test/api/items');assert.equal(roundTrip.timeMs,12);assert.equal(roundTrip.startedAt,Date.parse('2026-01-01T00:00:00.000Z'));
 const unknown=networkRequestsHar([{url:'https://example.test/a?x=1',method:'GET',startedAt:null,timeMs:null,status:0,bytes:null,timings:{}}]).log.entries[0];assert.equal(unknown.startedDateTime,null);assert.equal(unknown.time,-1);assert.equal(unknown._apw.timeUnavailable,true);assert.equal(unknown.timings.dns,-1);
 assert.throws(()=>networkRequestsHar([{url:'file:///tmp/a'}]),/URL/);assert.throws(()=>networkRequestsHar(Array(50001).fill(row)),/超过/);
});

test('network JSON export retains normalized metrics and excludes URL and request secrets',()=>{
 const [row]=parseHar({log:{entries:[{startedDateTime:'2026-01-01T00:00:00.000Z',connection:'socket-1',request:{url:'https://user:pass@example.test/api/items?token=secret',method:'POST',headers:[{name:'Authorization',value:'secret'}],cookies:[{name:'sid',value:'secret'}],postData:{text:'secret'}},response:{status:201,content:{size:42}},time:12,timings:{dns:1,connect:2,ssl:3,wait:4,receive:5}}]}});
 const doc=networkRequestsJson([{...row,url:'https://user:pass@example.test/api/items?token=secret#fragment',headers:[{name:'Authorization',value:'secret'}],cookies:[{name:'sid',value:'secret'}],body:'secret'}]);
 assert.equal(doc.schemaVersion,1);assert.equal(doc.type,'android-performance-network');assert.equal(doc.records[0].url,'https://example.test/api/items');assert.equal(doc.records[0].method,'POST');assert.equal(doc.records[0].status,201);assert.equal(doc.records[0].connectionId,'socket-1');assert.deepEqual(doc.records[0].timings,{dns:1,connect:2,ssl:3,wait:4,receive:5});
 assert.doesNotMatch(JSON.stringify(doc),/secret|user:pass|token=/);assert.deepEqual(doc.redaction,{credentialsRemoved:true,queryAndFragmentRemoved:true,headersIncluded:false,cookiesIncluded:false,bodyIncluded:false});
 const unknown=networkRequestsJson([{url:'https://example.test/a?token=secret',method:'GET',startedAt:1e100,timeMs:null,status:0,bytes:null,timings:{}}]).records[0];assert.equal(unknown.startedAt,null);assert.equal(unknown.timeMs,null);assert.equal(unknown.responseBytes,null);assert.throws(()=>networkRequestsJson([{url:'file:///tmp/a'}]),/URL/);assert.throws(()=>networkRequestsJson(Array(50001).fill(row)),/超过/);
});

test('network activity timeline positions overlapping requests and excludes missing times',()=>{
 const rows=[{id:2,startedAt:50,timeMs:100,host:'two',path:'/'},{id:1,startedAt:0,timeMs:100,host:'one',path:'/'},{id:3,startedAt:null,timeMs:5},{id:4,startedAt:4,timeMs:null}];
 const result=buildNetworkTimeline(rows);assert.equal(result.startMs,0);assert.equal(result.endMs,150);assert.equal(result.unavailable,2);assert.deepEqual(result.items.map(x=>x.id),[1,2]);assert.equal(result.items[0].left,0);assert.equal(result.items[1].left,1/3);assert.equal(result.items[0].width,2/3);
 const limited=buildNetworkTimeline(rows,1);assert.equal(limited.truncated,true);assert.equal(limited.total,2);assert.equal(limited.endMs,100);
 assert.equal(buildNetworkTimeline([{id:1,startedAt:null,timeMs:2}]).items.length,0);assert.throws(()=>buildNetworkTimeline(rows,0),/参数/);
});

test('network concurrency counts only overlapping intervals with available timing',()=>{
 const rows=[{startedAt:0,timeMs:100},{startedAt:50,timeMs:100},{startedAt:150,timeMs:50},{startedAt:20,timeMs:null},{startedAt:null,timeMs:10}];
 assert.deepEqual(summarizeNetworkConcurrency(rows),{peak:2,peakAtMs:50,eligible:3,unavailable:2});
 assert.deepEqual(summarizeNetworkConcurrency([{startedAt:0,timeMs:10},{startedAt:10,timeMs:20}]),{peak:1,peakAtMs:0,eligible:2,unavailable:0});
 assert.deepEqual(summarizeNetworkConcurrency([{startedAt:0,timeMs:0}]),{peak:0,peakAtMs:null,eligible:1,unavailable:0});
 assert.throws(()=>summarizeNetworkConcurrency(null),/参数/);
});

test('endpoint latency grouping respects method, host, path and missing values',()=>{
 const row=(method,host,path,timeMs,status=200)=>({method,host,path,timeMs,status});
 const rows=[row('GET','a','/x',0),row('GET','a','/x',10),row('GET','a','/x',30,500),row('GET','a','/x',null),row('POST','a','/x',7),row('GET','a','/y',null,0)];
 const groups=summarizeNetworkEndpoints(rows),x=groups.find(x=>x.method==='GET'&&x.path==='/x');
 assert.deepEqual(x,{method:'GET',host:'a',path:'/x',count:4,failures:1,timed:3,p50:10,p95:30,max:30});
 const missing=groups.find(x=>x.path==='/y');assert.equal(missing.failures,1);assert.equal(missing.timed,0);assert.equal(missing.p95,null);
 assert.equal(groups.find(x=>x.method==='POST').p95,7);
});
