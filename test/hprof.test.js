import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseHprof} from '../src/hprof.js';
const n4=n=>{const b=Buffer.alloc(4);b.writeUInt32BE(n);return b;};
const record=(tag,bytes)=>Buffer.concat([Buffer.from([tag]),n4(0),n4(bytes.length),bytes]);
const header=Buffer.concat([Buffer.from('JAVA PROFILE 1.0.3\0'),n4(4),Buffer.alloc(8)]);
const fixture=()=>Buffer.concat([header,record(1,Buffer.concat([n4(1),Buffer.from('com/example/Foo')])),record(2,Buffer.concat([n4(1),n4(2),n4(0),n4(1)])),record(0x1c,Buffer.concat([Buffer.from([0x21]),n4(3),n4(0),n4(2),n4(4),n4(42),Buffer.from([0x23]),n4(4),n4(0),n4(3),Buffer.from([8,1,2,3]),Buffer.from([0xff]),n4(3)])),record(0x2c,Buffer.alloc(0))]);
test('HPROF counts actual instances, arrays and roots without claiming retained size',()=>{
  const r=parseHprof(fixture());assert.equal(r.objects,2);assert.equal(r.arrays,1);assert.equal(r.roots,1);
  assert.equal(r.classes.find(c=>c.name==='com.example.Foo').payloadBytes,4);
  assert.equal(r.classes.find(c=>c.name==='byte[]').payloadBytes,3);
  assert.match(r.note,/不是对象浅大小或保留大小/);
});
test('HPROF rejects invalid, truncated and unknown heap records',()=>{
  assert.throws(()=>parseHprof(Buffer.from('invalid')),/HPROF/);
  assert.throws(()=>parseHprof(fixture().subarray(0,fixture().length-10)),/截断/);
  assert.throws(()=>parseHprof(Buffer.concat([header,record(0x1c,Buffer.from([0x77]))])),/不支持的 HPROF 堆记录/);
});
const n2=n=>{const b=Buffer.alloc(2);b.writeUInt16BE(n);return b;};
function string(id,text){return record(1,Buffer.concat([n4(id),Buffer.from(text)]));}
function load(cls,name){return record(2,Buffer.concat([n4(cls),n4(cls),n4(0),n4(name)]));}
function classDump(cls,parent,fields){return Buffer.concat([Buffer.from([0x20]),n4(cls),n4(0),n4(parent),Buffer.alloc(20),n4(0),n2(0),n2(0),n2(fields.length),...fields.map(([id,type])=>Buffer.concat([n4(id),Buffer.from([type])]))]);}
function fieldFixture(length=8,parent=10){
 const heap=Buffer.concat([classDump(10,0,[[4,10]]),classDump(11,parent,[[5,2]]),Buffer.from([0x21]),n4(20),n4(0),n4(11),n4(length),n4(30),...(length===8?[n4(42)]:[])]);
 return Buffer.concat([header,string(1,'Parent'),string(2,'Child'),string(4,'number'),string(5,'ref'),load(10,1),load(11,2),record(0x1c,heap),record(0x2c,Buffer.alloc(0))]);
}
test('HPROF decodes a bounded example with child fields before inherited fields',()=>{
 const c=parseHprof(fieldFixture()).classes.find(c=>c.name==='Child');
 assert.deepEqual(c.example.fields.map(f=>[f.declaringClass,f.name,f.value]),[['Child','ref','0000001e'],['Parent','number',42]]);
 assert.equal(c.example.warning,null);
});
test('HPROF refuses to fabricate fields when data or inheritance is incomplete',()=>{
 assert.match(parseHprof(fieldFixture(4)).classes[0].example.warning,/长度不一致/);
 assert.match(parseHprof(fieldFixture(8,99)).classes[0].example.warning,/继承信息缺失/);
});
test('indexed heap supports paging, object lookup and following references',()=>{
  const heap=parseHprof(fieldFixture(),{indexed:true});
  const child=heap.summary.classes.find(c=>c.name==='Child');
  const page=heap.classInstances(child.id,0,1);
  assert.equal(page.total,1);assert.equal(page.items[0].id,'00000014');
  const object=heap.objectDetail(page.items[0].id);
  assert.equal(object.fields.find(f=>f.name==='ref').value,'0000001e');
  assert.throws(()=>heap.objectDetail('0000001e'),/不在快照/);
  assert.throws(()=>heap.classInstances(child.id,-1),/分页/);
});
test('object arrays expose references beyond the first page with exact indices',()=>{
 const elements=Array.from({length:205},(_,i)=>n4(i===150?33:0));
 const body=Buffer.concat([Buffer.from([0x22]),n4(20),n4(0),n4(elements.length),n4(10),...elements]);
 const file=Buffer.concat([header,record(0x1c,body),record(0x2c,Buffer.alloc(0))]);const heap=parseHprof(file,{indexed:true});
 const page=heap.objectDetail('00000014',{offset:100,limit:100});assert.equal(page.valueOffset,100);assert.equal(page.values.length,100);assert.equal(page.values[50],'00000021');assert.equal(heap.objectDetail('00000014',{offset:200,limit:100}).values.length,5);assert.throws(()=>heap.objectDetail('00000014',{offset:-1}),/分页/);
});
test('primitive array pages preserve types, nonfinite floats, exact longs and absent data',()=>{
 const array=(id,type,bytes,count=1,tag=0x23)=>Buffer.concat([Buffer.from([tag]),n4(id),n4(0),n4(count),Buffer.from([type]),bytes]);
 const f=Buffer.alloc(4);f.writeFloatBE(Infinity);const d=Buffer.alloc(8);d.writeDoubleBE(NaN);const long=Buffer.alloc(8);long.writeBigInt64BE(-9007199254740993n);
 const body=Buffer.concat([array(20,4,Buffer.from([0,1,2]),3),array(21,5,Buffer.from([0x4e,0x2d])),array(22,6,f),array(23,7,d),array(24,8,Buffer.from([255])),array(25,9,Buffer.from([255,254])),array(26,10,Buffer.from([255,255,255,253])),array(27,11,long),array(28,8,Buffer.alloc(0),9,0xc3)]);
 const heap=parseHprof(Buffer.concat([header,record(0x1c,body),record(0x2c,Buffer.alloc(0))]),{indexed:true});
 const get=id=>heap.objectDetail(id.toString(16).padStart(8,'0'));
 assert.deepEqual(get(20).values,[false,true,'无效 (2)']);assert.deepEqual(get(21).values,[0x4e2d]);assert.deepEqual(get(22).values,['Infinity']);assert.deepEqual(get(23).values,['NaN']);assert.deepEqual(get(24).values,[-1]);assert.deepEqual(get(25).values,[-2]);assert.deepEqual(get(26).values,[-3]);assert.deepEqual(get(27).values,['-9007199254740993']);
 assert.equal(get(28).kind,'arrayNoData');assert.equal(get(28).length,9);assert.equal(get(28).values,undefined);assert.deepEqual(heap.objectDetail('00000014',{offset:1,limit:1}).values,[true]);
});
test('string preview requires a valid explicit char array slice and bounds output',()=>{
 const instance=(id,offset,count,value=30)=>Buffer.concat([Buffer.from([0x21]),n4(id),n4(0),n4(10),n4(12),n4(value),n4(offset),n4(count)]);
 const chars=Buffer.alloc(1040);for(let i=0;i<520;i++)chars.writeUInt16BE(i===1?0x4e2d:65,i*2);
 const array=Buffer.concat([Buffer.from([0x23]),n4(30),n4(0),n4(520),Buffer.from([5]),chars]);
 const secondArray=Buffer.concat([Buffer.from([0x23]),n4(31),n4(0),n4(520),Buffer.from([5]),chars]);
 const body=Buffer.concat([classDump(10,0,[[5,2],[6,10],[7,10]]),instance(20,1,2),instance(21,0,520),instance(22,519,2),instance(23,0,1,99),instance(24,1,2),instance(25,1,2,31),array,secondArray]);
 const file=Buffer.concat([header,string(1,'java/lang/String'),string(5,'value'),string(6,'offset'),string(7,'count'),load(10,1),record(0x1c,body),record(0x2c,Buffer.alloc(0))]);
 const heap=parseHprof(file,{indexed:true});assert.deepEqual(heap.objectDetail('00000014').stringPreview,{text:'中A',length:2,truncated:false,storageId:'0000001e'});
 const long=heap.objectDetail('00000015').stringPreview;assert.equal(long.length,520);assert.equal(long.text.length,512);assert.equal(long.truncated,true);
 assert.equal(heap.objectDetail('00000016').stringPreview,null);assert.equal(heap.objectDetail('00000017').stringPreview,null);
 const duplicates=heap.duplicateStrings();assert.equal(duplicates.scanned,6);assert.equal(duplicates.unavailable,2);assert.equal(duplicates.tooLong,1);assert.equal(duplicates.totalGroups,1);assert.deepEqual(duplicates.groups[0],{text:'中A',instances:3,storageCount:2,ids:['00000014','00000018','00000019']});
 const matches=heap.searchStrings({query:'中a'});assert.deepEqual(matches.items.map(x=>x.id),['00000014','00000018','00000019']);assert.equal(matches.unavailable,2);assert.equal(matches.tooLong,1);assert.equal(matches.nextOffset,null);assert.deepEqual(heap.searchStrings({query:'中a',caseSensitive:true}).items,[]);assert.throws(()=>heap.searchStrings({query:''}),/搜索词/);
});
test('string search continues from the next unscanned instance without omissions',()=>{
 const instance=id=>Buffer.concat([Buffer.from([0x21]),n4(id),n4(0),n4(10),n4(12),n4(900),n4(0),n4(1)]);
 const array=Buffer.concat([Buffer.from([0x23]),n4(900),n4(0),n4(1),Buffer.from([5,0,65])]);
 const body=Buffer.concat([classDump(10,0,[[5,2],[6,10],[7,10]]),...Array.from({length:105},(_,i)=>instance(100+i)),array]);
 const file=Buffer.concat([header,string(1,'java/lang/String'),string(5,'value'),string(6,'offset'),string(7,'count'),load(10,1),record(0x1c,body),record(0x2c,Buffer.alloc(0))]);
 const heap=parseHprof(file,{indexed:true}),first=heap.searchStrings({query:'a'}),second=heap.searchStrings({query:'a',offset:first.nextOffset});assert.equal(first.items.length,100);assert.equal(first.nextOffset,100);assert.equal(second.items.length,5);assert.equal(second.nextOffset,null);assert.equal(new Set([...first.items,...second.items].map(x=>x.id)).size,105);
});
test('ART string previews require marker fields, matching count and supported array bytes',()=>{
 const inst=(id,count,value)=>Buffer.concat([Buffer.from([0x21]),n4(id),n4(0),n4(10),n4(16),n4(count),n4(value),n4(11),n4(0)]);
 const array=(id,type,bytes,count)=>Buffer.concat([Buffer.from([0x23]),n4(id),n4(0),n4(count),Buffer.from([type]),bytes]);
 const body=Buffer.concat([classDump(11,0,[[7,2],[8,10]]),classDump(10,11,[[5,10],[6,2]]),inst(20,2,30),inst(21,1,31),inst(22,2,31),inst(23,1,32),array(30,8,Buffer.from('Hi'),2),array(31,5,Buffer.from([0x4e,0x2d]),1),array(32,8,Buffer.from([0xff]),1)]);
 const file=Buffer.concat([header,string(1,'java/lang/String'),string(2,'java/lang/Object'),string(5,'count'),string(6,'value'),string(7,'shadow$_klass_'),string(8,'shadow$_monitor_'),load(10,1),load(11,2),record(0x1c,body),record(0x2c,Buffer.alloc(0))]);
 const heap=parseHprof(file,{indexed:true});assert.equal(heap.objectDetail('00000014').stringPreview.text,'Hi');assert.equal(heap.objectDetail('00000015').stringPreview.text,'中');assert.equal(heap.objectDetail('00000016').stringPreview,null);assert.equal(heap.objectDetail('00000017').stringPreview,null);
});
test('root path follows recorded instance references and distinguishes unreachable marker',()=>{
 const body=Buffer.concat([classDump(10,0,[[5,2]]),Buffer.from([0x21]),n4(20),n4(0),n4(10),n4(4),n4(30),Buffer.from([0x23]),n4(30),n4(0),n4(1),Buffer.from([8,99]),Buffer.from([0xff]),n4(20),Buffer.from([0x90]),n4(30)]);
 const file=Buffer.concat([header,string(1,'RootClass'),string(5,'child'),load(10,1),record(0x1c,body),record(0x2c,Buffer.alloc(0))]);
 const heap=parseHprof(file,{indexed:true});const path=heap.rootPath('0000001e');
 assert.equal(heap.summary.roots,1);assert.equal(path.found,true);assert.deepEqual(path.path.map(p=>[p.id,p.via]),[['00000014','child'],['0000001e',null]]);
 const incoming=heap.incomingReferences('0000001e');assert.equal(incoming.total,1);assert.deepEqual(incoming.items.map(r=>[r.id,r.className,r.label]),[['00000014','RootClass','child']]);assert.equal(incoming.indexOrGraphIncomplete,false);
 assert.deepEqual(heap.incomingReferences('0000001e',{offset:1,limit:1}).items,[]);assert.throws(()=>heap.incomingReferences('0000001e',{limit:101}),/分页/);assert.throws(()=>heap.incomingReferences('bad'),/对象 ID/);
 assert.match(path.note,/不区分强、弱/);
});
test('missing class layouts make a negative root search explicitly incomplete',()=>{
 const heap=parseHprof(fixture(),{indexed:true});const result=heap.rootPath('00000004');
 assert.equal(result.found,false);assert.equal(result.incomplete,true);assert.ok(result.skipped>0);
});
test('root search can exclude known non-strong referent edges without excluding ordinary fields',()=>{
 for(const kind of ['WeakReference','SoftReference','PhantomReference']){
  const instance=(id,cls,target)=>Buffer.concat([Buffer.from([0x21]),n4(id),n4(0),n4(cls),n4(4),n4(target)]);
  const body=Buffer.concat([classDump(10,0,[[5,2]]),classDump(11,10,[]),instance(20,11,30),Buffer.from([0x23]),n4(30),n4(0),n4(1),Buffer.from([8,99]),Buffer.from([0xff]),n4(20)]);
  const file=Buffer.concat([header,string(1,'java/lang/ref/Reference'),string(2,`java/lang/ref/${kind}`),string(5,'referent'),load(10,1),load(11,2),record(0x1c,body),record(0x2c,Buffer.alloc(0))]);
  const heap=parseHprof(file,{indexed:true});assert.equal(heap.rootPath('0000001e').path[0].referenceKind,kind);assert.equal(heap.rootPath('0000001e',{excludeNonStrong:true}).found,false);assert.equal(heap.incomingReferences('0000001e').items[0].referenceKind,kind);assert.equal(heap.incomingReferences('0000001e',{excludeNonStrong:true}).total,0);
  const all=heap.dominatorTree(),filtered=heap.dominatorTree({excludeNonStrong:true});assert.equal(filtered.excludedEdges,1);assert.equal(filtered.reachable,all.reachable-1);assert.throws(()=>heap.dominatorTree({excludeNonStrong:true,parentId:'0000001e'}),/可达图/);assert.equal(heap.dominatorTree().reachable,all.reachable);assert.throws(()=>heap.dominatorTree({excludeNonStrong:'true'}),/过滤参数/);
 }
 const body=Buffer.concat([classDump(10,0,[[5,2]]),Buffer.from([0x21]),n4(20),n4(0),n4(10),n4(4),n4(30),Buffer.from([0x23]),n4(30),n4(0),n4(1),Buffer.from([8,99]),Buffer.from([0xff]),n4(20)]);
 const file=Buffer.concat([header,string(1,'Example'),string(5,'referent'),load(10,1),record(0x1c,body),record(0x2c,Buffer.alloc(0))]);
 const heap=parseHprof(file,{indexed:true});assert.equal(heap.rootPath('0000001e',{excludeNonStrong:true}).found,true);assert.throws(()=>heap.rootPath('0000001e',{excludeNonStrong:'true'}),/过滤参数/);
});
test('GC root paths include class static fields and expose class object details',()=>{
 const dump=Buffer.concat([Buffer.from([0x20]),n4(10),n4(0),n4(0),Buffer.alloc(20),n4(0),n2(0),n2(1),n4(5),Buffer.from([2]),n4(30),n2(0)]);
 const body=Buffer.concat([dump,Buffer.from([0x23]),n4(30),n4(0),n4(1),Buffer.from([8,99]),Buffer.from([0x05]),n4(10)]);
 const file=Buffer.concat([header,string(1,'Example'),string(5,'singleton'),load(10,1),record(0x1c,body),record(0x2c,Buffer.alloc(0))]);
 const h=parseHprof(file,{indexed:true}),path=h.rootPath('0000001e');
 assert.equal(path.found,true);assert.deepEqual(path.path.map(p=>[p.id,p.via]),[['0000000a','静态字段 singleton'],['0000001e',null]]);
 assert.equal(h.objectDetail('0000000a').fields.find(f=>f.name==='静态字段 singleton').value,'0000001e');
});
test('LeakCanary KeyedWeakReference markers resolve watched objects and batch strong root paths',()=>{
 const instance=(id,cls,...values)=>Buffer.concat([Buffer.from([0x21]),n4(id),n4(0),n4(cls),n4(values.length*4),...values.map(n4)]);
 const chars='watch-12345',charArray=Buffer.concat([Buffer.from([0x23]),n4(60),n4(0),n4(chars.length),Buffer.from([5]),...Array.from(chars,c=>n2(c.charCodeAt(0)))]);
 const body=Buffer.concat([
  classDump(10,0,[[5,2]]),classDump(11,10,[]),classDump(12,11,[[6,2]]),
  classDump(20,0,[[7,2]]),classDump(21,0,[]),classDump(30,0,[[8,2],[9,10],[13,10]]),
  instance(31,21),instance(32,21),instance(40,20,31),instance(41,12,50,31),instance(42,12,50,32),instance(43,12,50,0),instance(50,30,60,0,chars.length),charArray,
  Buffer.from([0xff]),n4(40)
 ]);
 const file=Buffer.concat([header,string(1,'java/lang/ref/Reference'),string(2,'java/lang/ref/WeakReference'),string(3,'leakcanary/KeyedWeakReference'),string(4,'example/Holder'),string(10,'example/Target'),string(11,'java/lang/String'),string(5,'referent'),string(6,'key'),string(7,'child'),string(8,'value'),string(9,'offset'),string(13,'count'),load(10,1),load(11,2),load(12,3),load(20,4),load(21,10),load(30,11),record(0x1c,body),record(0x2c,Buffer.alloc(0))]);
 const heap=parseHprof(file,{indexed:true}),result=heap.leakCanaryRetainedObjects();
 assert.deepEqual(result.markerClasses,['leakcanary.KeyedWeakReference']);assert.equal(result.liveReferences,2);assert.equal(result.cleared,1);assert.equal(result.unavailable,0);assert.equal(result.items[0].targetId,'0000001f');assert.equal(result.items[0].key.text,chars);assert.equal(result.items[0].path.found,true);assert.deepEqual(result.items[0].path.path.map(x=>x.id),['00000028','0000001f']);assert.equal(result.items[1].path.found,false);assert.match(result.note,/不包含 Shark/);
 const shared=heap.rootPaths(['0000001f','00000020'],{excludeNonStrong:true});assert.equal(shared.items[0].found,true);assert.equal(shared.items[1].found,false);assert.equal(shared.excludeNonStrong,true);assert.throws(()=>heap.rootPaths(['bad']),/列表无效/);
});
test('dominator view reports graph-dependent objects and recorded payload, including incomplete layouts',()=>{
 const body=Buffer.concat([classDump(10,0,[[5,2]]),Buffer.from([0x21]),n4(20),n4(0),n4(10),n4(4),n4(30),Buffer.from([0x23]),n4(30),n4(0),n4(3),Buffer.from([8,1,2,3]),Buffer.from([0xff]),n4(20)]);
 const file=Buffer.concat([header,string(1,'RootClass'),string(5,'child'),load(10,1),record(0x1c,body),record(0x2c,Buffer.alloc(0))]);
 const heap=parseHprof(file,{indexed:true}),top=heap.dominatorTree();assert.equal(top.reachable,3);assert.equal(top.items[0].id,'00000014');assert.equal(top.items[0].dominatedObjects,3);assert.equal(top.items[0].recordedPayloadBytes,7);
 const child=heap.dominatorTree({parentId:'00000014'});assert.equal(child.items[0].id,'0000001e');assert.equal(child.items[0].recordedPayloadBytes,3);assert.equal(heap.dominatorTree({parentId:'0000000a'}).total,0);
 const incomplete=parseHprof(fixture(),{indexed:true}).dominatorTree();assert.equal(incomplete.incomplete,true);assert.ok(incomplete.skipped>0);
});
test('Bitmap inspection exposes recorded fields and byte arrays without inferring native size',()=>{
 const fields=[[4,10],[5,10],[6,10],[7,4],[8,2]];
 const instance=(object,buffer)=>Buffer.concat([Buffer.from([0x21]),n4(object),n4(0),n4(10),n4(17),n4(100),n4(50),n4(320),Buffer.from([0]),n4(buffer)]);
 const body=Buffer.concat([classDump(10,0,fields),instance(20,30),instance(21,0),Buffer.from([0x23]),n4(30),n4(0),n4(3),Buffer.from([8,1,2,3])]);
 const file=Buffer.concat([header,string(1,'android/graphics/Bitmap'),string(4,'mWidth'),string(5,'mHeight'),string(6,'mDensity'),string(7,'mRecycled'),string(8,'mBuffer'),load(10,1),record(0x1c,body),record(0x2c,Buffer.alloc(0))]);
 const heap=parseHprof(file,{indexed:true}),result=heap.bitmaps(0,1);
 assert.equal(result.total,2);assert.equal(result.recordedTotal,2);assert.equal(result.items[0].width,100);assert.equal(result.items[0].height,50);assert.equal(result.items[0].bufferLength,3);assert.equal(result.items[0].bufferDataPresent,true);assert.equal(result.items[0].recycled,false);
 assert.equal(heap.bitmaps(1,1).items[0].bufferLength,null);assert.throws(()=>heap.bitmaps(-1,1),/分页/);
});

test('public Android HPROF fixture exposes actual Bitmap objects and references',async t=>{
 const path=process.env.APW_ANDROID_HPROF;if(!path){t.skip('设置 APW_ANDROID_HPROF 指向公开 Android 测试堆');return;}
 const {readFile}=await import('node:fs/promises');const {createHash}=await import('node:crypto');const data=await readFile(path);
 assert.equal(createHash('sha256').update(data).digest('hex'),'14dcec5fa5ddb30fa3142fc5aaa90cdee02969662207458371d13a5eba007363');
 const heap=parseHprof(data,{indexed:true,includeExamples:false});assert.equal(heap.summary.objects,41754);const page=heap.bitmaps(0,1);assert.equal(page.total,52);
 const stringClass=heap.summary.classes.find(c=>c.name==='java.lang.String'),firstString=heap.classInstances(stringClass.id,0,1).items[0];assert.equal(heap.objectDetail(firstString.id).stringPreview.text,'[memory exhausted]');
 const bitmap=page.items[0];assert.equal(bitmap.width,44);assert.equal(bitmap.height,64);assert.equal(bitmap.bufferLength,11264);assert.equal(heap.objectDetail(bitmap.bufferId).length,11264);
 assert.ok(heap.incomingReferences(bitmap.bufferId).items.some(ref=>ref.id===bitmap.id&&ref.label==='mBuffer'));
 const pathResult=heap.rootPath(bitmap.id);assert.equal(pathResult.found,true);assert.equal(pathResult.path.at(-1).id,bitmap.id);
 const filtered=heap.dominatorTree({excludeNonStrong:true});assert.ok(filtered.excludedEdges>0);assert.equal(filtered.excludeNonStrong,true);
});

test('Android 8 Bitmap sample preserves unavailable native pixel storage',async t=>{
 const path=process.env.APW_ANDROID_O_HPROF;if(!path){t.skip('设置 APW_ANDROID_O_HPROF 指向 Android 8 测试堆');return;}
 const {readFile}=await import('node:fs/promises');const {createHash}=await import('node:crypto');const data=await readFile(path);
 assert.equal(createHash('sha256').update(data).digest('hex'),'700b60f9b9bfb64d488f7663cc58b09f68760ed822a760911d4f4952ed4debbc');
 const heap=parseHprof(data,{indexed:true,includeExamples:false}),page=heap.bitmaps(0,1);assert.equal(heap.summary.objects,125238);assert.equal(page.total,102);
 const stringClass=heap.summary.classes.find(c=>c.name==='java.lang.String');assert.equal(heap.objectDetail(heap.classInstances(stringClass.id,0,1).items[0].id).stringPreview.text,'emulated');
 assert.equal(page.items[0].width,144);assert.equal(page.items[0].height,144);assert.equal(page.items[0].bufferLength,null);const duplicates=heap.duplicateBitmaps();assert.equal(duplicates.scanned,102);assert.equal(duplicates.unavailable,102);
});

test('duplicate Bitmap buffers count distinct arrays and avoid double-counting shared references',()=>{
 const inst=(id,ref)=>Buffer.concat([Buffer.from([0x21]),n4(id),n4(0),n4(10),n4(4),n4(ref)]),arr=(id,bytes)=>Buffer.concat([Buffer.from([0x23]),n4(id),n4(0),n4(bytes.length),Buffer.from([8,...bytes])]);
 const body=Buffer.concat([classDump(10,0,[[8,2]]),inst(20,30),inst(21,30),inst(22,31),inst(23,32),arr(30,[1,2,3]),arr(31,[1,2,3]),arr(32,[1,2,4])]);
 const data=Buffer.concat([header,string(1,'android/graphics/Bitmap'),string(8,'mBuffer'),load(10,1),record(0x1c,body),record(0x2c,Buffer.alloc(0))]);
 const r=parseHprof(data,{indexed:true}).duplicateBitmaps();assert.equal(r.groups.length,1);assert.equal(r.groups[0].arrayCount,2);assert.equal(r.groups[0].bitmapCount,3);assert.equal(r.groups[0].duplicateBytes,3);assert.equal(r.hashedBytes,9);assert.equal(r.truncated,false);
});

test('destroyed Activity detection reads inherited flag beyond the object-detail field limit',()=>{
 const fields=[...Array.from({length:70},()=>[3,2]),[4,4]],instance=(id,flag)=>Buffer.concat([Buffer.from([0x21]),n4(id),n4(0),n4(11),n4(285),n4(123),Buffer.alloc(280),Buffer.from([flag])]);
 const body=Buffer.concat([classDump(10,0,fields),classDump(11,10,[[5,10]]),instance(20,1),instance(21,0),instance(22,2)]);
 const file=Buffer.concat([header,string(1,'android/app/Activity'),string(2,'com/example/Screen'),string(3,'dummy'),string(4,'mDestroyed'),string(5,'child'),load(10,1),load(11,2),record(0x1c,body),record(0x2c,Buffer.alloc(0))]);
 const heap=parseHprof(file,{indexed:true}),r=heap.destroyedActivities();assert.equal(r.scanned,3);assert.equal(r.destroyed,1);assert.equal(r.unavailable,1);assert.equal(r.items[0].id,'00000014');assert.ok(!heap.objectDetail('00000014').fields.some(x=>x.name==='mDestroyed'));
 const second=heap.objectDetail('00000014',{offset:64,limit:64});assert.equal(second.fieldOffset,64);assert.equal(second.totalFields,72);assert.equal(second.fields.find(x=>x.name==='mDestroyed').value,true);
});

test('public Android heap exposes destroyed Activity candidates',async t=>{
 const path=process.env.APW_ANDROID_HPROF;if(!path){t.skip('设置 APW_ANDROID_HPROF 指向公开 Android 测试堆');return;}
 const {readFile}=await import('node:fs/promises');const heap=parseHprof(await readFile(path),{indexed:true,includeExamples:false}),r=heap.destroyedActivities();
 assert.equal(r.scanned,2);assert.equal(r.destroyed,1);assert.equal(r.items[0].className,'com.example.leakcanary.MainActivity');assert.equal(heap.rootPath(r.items[0].id).found,true);
});
