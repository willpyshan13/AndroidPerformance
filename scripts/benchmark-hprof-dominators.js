import {performance} from 'node:perf_hooks';
import {parseHprof} from '../src/hprof.js';

const count=Number(process.argv[2]||500010);
if(!Number.isSafeInteger(count)||count<1||count>800000)throw new Error('object count must be an integer from 1 to 800000');
const shape=process.argv[3]||'chain';
if(!['chain','fragmented-cycle','edge-limit'].includes(shape))throw new Error('shape must be chain, fragmented-cycle, or edge-limit');
if(shape==='edge-limit'&&count<=750000)throw new Error('edge-limit requires more than 750,000 objects to exceed the 1,500,000-edge cap');
const u2=value=>{const out=Buffer.allocUnsafe(2);out.writeUInt16BE(value);return out;};
const u4=value=>{const out=Buffer.allocUnsafe(4);out.writeUInt32BE(value);return out;};
const record=(tag,payload)=>Buffer.concat([Buffer.from([tag]),u4(0),u4(payload.length),payload]);
const string=(id,text)=>record(1,Buffer.concat([u4(id),Buffer.from(text)]));
const loadClass=(id,nameId)=>record(2,Buffer.concat([u4(id),u4(id),u4(0),u4(nameId)]));

// One instance field points to the next object. A sticky class root points at
// the first instance. Each object also has the ordinary edge to its class.
const classId=10,objectId=index=>shape==='chain'?1000+index:(0x10000000+Math.imul(index,2654435761))>>>0;
const classDump=Buffer.concat([
 Buffer.from([0x20]),u4(classId),u4(0),u4(0),Buffer.alloc(20),u4(4),
 u2(0),u2(0),u2(1),u4(4),Buffer.from([2]),
]);
const records=Buffer.allocUnsafe(count*21);
for(let i=0,offset=0;i<count;i++,offset+=21){
 records[offset]=0x21;
 records.writeUInt32BE(objectId(i),offset+1);
 records.writeUInt32BE(i+1,offset+5);
 records.writeUInt32BE(classId,offset+9);
 records.writeUInt32BE(4,offset+13);
 records.writeUInt32BE(i+1<count?objectId(i+1):shape==='fragmented-cycle'||shape==='edge-limit'?objectId(0):0,offset+17);
}
const heap=Buffer.concat([classDump,Buffer.from([0xff]),u4(objectId(0)),records]);
const data=Buffer.concat([
 Buffer.from('JAVA PROFILE 1.0.3\0'),u4(4),Buffer.alloc(8),
 string(1,'com/example/HeapNode'),loadClass(classId,1),
 record(0x1c,heap),record(0x2c,Buffer.alloc(0)),
]);

const start=performance.now(),parsed=parseHprof(data,{indexed:true,includeExamples:false}),parsedAt=performance.now();
const root=parsed.dominatorTree({limit:2}),rootNode=root.items.find(item=>item.id===objectId(0).toString(16).padStart(8,'0')),done=performance.now(),overLimit=shape==='edge-limit',expectedEdges=overLimit?1500000:count*2-(shape==='chain'?1:0);
const basicInvalid=parsed.summary.objects!==count||parsed.summary.indexTruncated||root.edgeCount!==expectedEdges;
const invalid=basicInvalid||(overLimit?!root.incomplete||!root.edgeLimitReached:root.incomplete||root.edgeLimitReached||rootNode?.dominatedObjects!==count+1);
if(invalid)throw new Error(`large graph result mismatch: ${JSON.stringify({objects:parsed.summary.objects,indexTruncated:parsed.summary.indexTruncated,reachable:root.reachable,incomplete:root.incomplete,edgeLimitReached:root.edgeLimitReached,edgeCount:root.edgeCount,dominatedObjects:rootNode?.dominatedObjects})}`);
const usage=process.memoryUsage();
console.log(JSON.stringify({shape,objects:count,hprofBytes:data.length,indexedObjects:parsed.summary.indexedObjects,reachable:root.reachable,referenceEdges:root.edgeCount,dominatedObjects:rootNode?.dominatedObjects??null,incomplete:root.incomplete,edgeLimitReached:root.edgeLimitReached,parseMs:Math.round((parsedAt-start)*100)/100,dominatorMs:Math.round((done-parsedAt)*100)/100,totalMs:Math.round((done-start)*100)/100,rssMiB:Math.round(usage.rss/1024/1024*10)/10,heapUsedMiB:Math.round(usage.heapUsed/1024/1024*10)/10},null,2));
