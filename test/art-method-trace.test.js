import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseArtMethodTrace} from '../public/offline.js';

function header(clock='dual',version=3){return Buffer.from(`*version\n${version}\nclock=${clock}\n*threads\n1\tmain\n*methods\n0x1000\tpkg/Foo\touter\t()V\n0x2000\tpkg/Foo\tinner\t()V\n*end\n`);}
function standardTrace({version=3,clock='dual',records}){
 const key=header(clock,version),recordSize=version===1?9:version===2?10:clock==='dual'?14:10,data=Buffer.alloc(32+recordSize*records.length);
 data.writeUInt32LE(0x574f4c53,0);data.writeUInt16LE(version,4);data.writeUInt16LE(32,6);data.writeBigUInt64LE(1_700_000_000_000_000n,8);if(version===3)data.writeUInt16LE(recordSize,16);
 records.forEach(([tid,method,action,threadTime,wallTime],index)=>{const at=32+index*recordSize;if(version===1)data.writeUInt8(tid,at);else data.writeUInt16LE(tid,at);const pos=at+(version===1?1:2);data.writeUInt32LE(method|action,pos);data.writeUInt32LE(threadTime,pos+4);if(version===3&&clock==='dual')data.writeUInt32LE(wallTime,pos+8);});
 return Buffer.concat([key,data]);
}

test('ART v3 dual-clock trace reconstructs nested calls, exclusive time and thread spans',()=>{
 const result=parseArtMethodTrace(standardTrace({records:[[1,0x1000,0,10,100],[1,0x2000,0,20,120],[1,0x2000,1,30,150],[1,0x1000,1,50,200]]}));
 assert.equal(result.version,3);assert.equal(result.clock,'dual');assert.equal(result.threadCount,1);assert.equal(result.completedCalls,2);assert.equal(result.eventCount,4);assert.equal(result.intervalsTruncated,false);
 assert.deepEqual(result.methods.map(row=>[row.name,row.calls,row.inclusiveUs,row.exclusiveUs]),[['pkg/Foo.outer()V',1,'100','70'],['pkg/Foo.inner()V',1,'30','30']]);
 assert.equal(result.durationUs,'100');assert.deepEqual(result.intervals.map(row=>[row.name,row.startUs,row.endUs,row.depth]),[['pkg/Foo.inner()V','20','50',1],['pkg/Foo.outer()V','0','100',0]]);
});

test('ART v1/v2 records support their distinct thread id widths and exit-unroll action',()=>{
 const v1=parseArtMethodTrace(standardTrace({version:1,clock:'global',records:[[1,0x1000,0,10],[1,0x2000,0,20],[1,0x1000,2,40]]}));
 assert.equal(v1.completedCalls,2);assert.equal(v1.intervals.find(x=>x.name.includes('outer')).unrolled,true);assert.equal(v1.methods.find(x=>x.name.includes('outer')).inclusiveUs,'30');
 const v2=parseArtMethodTrace(standardTrace({version:2,clock:'thread-cpu',records:[[1,0x1000,0,100],[1,0x1000,1,180]]}));
 assert.equal(v2.version,2);assert.equal(v2.clock,'thread-cpu');assert.equal(v2.methods[0].inclusiveUs,'80');
});

test('ART streaming trace decodes inline thread/method metadata and method actions',()=>{
 const prefix=Buffer.alloc(32);prefix.writeUInt32LE(0x574f4c53,0);prefix.writeUInt16LE(0xf3,4);prefix.writeUInt16LE(32,6);prefix.writeBigUInt64LE(1000n,8);prefix.writeUInt16LE(14,16);
 const u16=value=>{const out=Buffer.alloc(2);out.writeUInt16LE(value);return out;},u32=value=>{const out=Buffer.alloc(4);out.writeUInt32LE(value);return out;},record=(tid,id,action,threadTime,wallTime)=>Buffer.concat([u16(tid),u32(id|action),u32(threadTime),u32(wallTime)]),text=value=>Buffer.from(value);
 const thread=Buffer.concat([u16(0),Buffer.from([2]),u16(7),u16(4),text('main')]),methodLine='0x3000\tpkg/Stream\twork\t()V',method=Buffer.concat([u16(0),Buffer.from([1]),u16(Buffer.byteLength(methodLine)),text(methodLine)]),summaryText='*version\n3\nclock=dual\n*threads\n',summary=Buffer.concat([u16(0),Buffer.from([3]),u32(Buffer.byteLength(summaryText)),text(summaryText)]);
 const stream=Buffer.concat([prefix,thread,method,record(7,0x3000,0,5,5),record(7,0x3000,1,25,35),summary]);
 const result=parseArtMethodTrace(stream);assert.equal(result.streaming,true);assert.equal(result.clock,'dual');assert.equal(result.threads[0].name,'main');assert.equal(result.methods[0].name,'pkg/Stream.work()V');assert.equal(result.methods[0].inclusiveUs,'30');
});

test('ART streaming trace applies the clock declared in its trailing summary',()=>{
 const prefix=Buffer.alloc(32);prefix.writeUInt32LE(0x574f4c53,0);prefix.writeUInt16LE(0xf3,4);prefix.writeUInt16LE(32,6);prefix.writeUInt16LE(14,16);
 const u16=value=>{const out=Buffer.alloc(2);out.writeUInt16LE(value);return out;},u32=value=>{const out=Buffer.alloc(4);out.writeUInt32LE(value);return out;},record=(action,threadTime,wallTime)=>Buffer.concat([u16(7),u32(0x3000|action),u32(threadTime),u32(wallTime)]),text=value=>Buffer.from(value);
 const methodLine='0x3000\tpkg/Stream\twork\t()V',method=Buffer.concat([u16(0),Buffer.from([1]),u16(Buffer.byteLength(methodLine)),text(methodLine)]),thread=Buffer.concat([u16(0),Buffer.from([2]),u16(7),u16(4),text('main')]),summaryText='clock=thread-cpu\n',summary=Buffer.concat([u16(0),Buffer.from([3]),u32(Buffer.byteLength(summaryText)),text(summaryText)]);
 const result=parseArtMethodTrace(Buffer.concat([prefix,thread,method,record(0,5,100),record(1,25,1000),summary]));assert.equal(result.clock,'thread-cpu');assert.equal(result.durationUs,'20');assert.equal(result.methods[0].inclusiveUs,'20');
});

test('ART trace rejects bad headers, unsupported versions, malformed records and excessive events',()=>{
 assert.throws(()=>parseArtMethodTrace(Buffer.from('PERFILE2')),/不是受支持的 ART/);
 const unsupported=standardTrace({records:[]});unsupported.writeUInt16LE(4,unsupported.indexOf(Buffer.from('SLOW'))+4);assert.throws(()=>parseArtMethodTrace(unsupported),/不支持 ART trace 版本/);
 const incomplete=Buffer.concat([standardTrace({records:[]}),Buffer.from([1])]);assert.throws(()=>parseArtMethodTrace(incomplete),/不完整记录/);
 assert.throws(()=>parseArtMethodTrace(standardTrace({version:2,clock:'wall',records:[[1,0x1000,0,1],[1,0x1000,1,2]]}),{maxEvents:1}),/事件数超过/);
});
