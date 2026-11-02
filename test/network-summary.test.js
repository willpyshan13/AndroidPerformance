import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseHar,filterNetworkRequests,networkRequestsCsv,summarizeHarHosts,summarizeNetworkEndpoints,buildNetworkTimeline} from '../public/offline.js';

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

test('network activity timeline positions overlapping requests and excludes missing times',()=>{
 const rows=[{id:2,startedAt:50,timeMs:100,host:'two',path:'/'},{id:1,startedAt:0,timeMs:100,host:'one',path:'/'},{id:3,startedAt:null,timeMs:5},{id:4,startedAt:4,timeMs:null}];
 const result=buildNetworkTimeline(rows);assert.equal(result.startMs,0);assert.equal(result.endMs,150);assert.equal(result.unavailable,2);assert.deepEqual(result.items.map(x=>x.id),[1,2]);assert.equal(result.items[0].left,0);assert.equal(result.items[1].left,1/3);assert.equal(result.items[0].width,2/3);
 const limited=buildNetworkTimeline(rows,1);assert.equal(limited.truncated,true);assert.equal(limited.total,2);assert.equal(limited.endMs,100);
 assert.equal(buildNetworkTimeline([{id:1,startedAt:null,timeMs:2}]).items.length,0);assert.throws(()=>buildNetworkTimeline(rows,0),/参数/);
});

test('endpoint latency grouping respects method, host, path and missing values',()=>{
 const row=(method,host,path,timeMs,status=200)=>({method,host,path,timeMs,status});
 const rows=[row('GET','a','/x',0),row('GET','a','/x',10),row('GET','a','/x',30,500),row('GET','a','/x',null),row('POST','a','/x',7),row('GET','a','/y',null,0)];
 const groups=summarizeNetworkEndpoints(rows),x=groups.find(x=>x.method==='GET'&&x.path==='/x');
 assert.deepEqual(x,{method:'GET',host:'a',path:'/x',count:4,failures:1,timed:3,p50:10,p95:30,max:30});
 const missing=groups.find(x=>x.path==='/y');assert.equal(missing.failures,1);assert.equal(missing.timed,0);assert.equal(missing.p95,null);
 assert.equal(groups.find(x=>x.method==='POST').p95,7);
});
