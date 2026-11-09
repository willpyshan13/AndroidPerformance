import {dominatorsCsr} from './dominators.js';
import {indexJavaMapping,resolveJavaMappingFrame} from './source-symbols.js';
import {createHash} from 'node:crypto';
// HPROF record layout follows Android's perflib parser and the HotSpot heap dump format.
const MAX_FILE = 256 * 1024 * 1024;
const PNG_CRC_TABLE=Uint32Array.from({length:256},(_,value)=>{for(let i=0;i<8;i++)value=(value&1)?0xedb88320^(value>>>1):value>>>1;return value>>>0;});
function validatePng(bytes){
  const signature=Buffer.from([137,80,78,71,13,10,26,10]);if(bytes.length<45||!bytes.subarray(0,8).equals(signature))return null;
  let offset=8,width=0,height=0,first=true,hasData=false;
  while(offset+12<=bytes.length){
    const length=bytes.readUInt32BE(offset);if(length>bytes.length-offset-12)return null;
    const type=bytes.toString('ascii',offset+4,offset+8),dataStart=offset+8,crcOffset=dataStart+length;
    let crc=0xffffffff;for(let i=offset+4;i<crcOffset;i++)crc=PNG_CRC_TABLE[(crc^bytes[i])&255]^(crc>>>8);crc=(crc^0xffffffff)>>>0;
    if(crc!==bytes.readUInt32BE(crcOffset))return null;
    if(first){if(type!=='IHDR'||length!==13)return null;width=bytes.readUInt32BE(dataStart);height=bytes.readUInt32BE(dataStart+4);if(!width||!height||width>100000||height>100000||width*height>100000000)return null;first=false;}
    else if(type==='IHDR')return null;
    if(type==='IDAT')hasData=true;
    offset=crcOffset+4;
    if(type==='IEND')return length===0&&hasData&&offset===bytes.length?{width,height}:null;
  }
  return null;
}
export function parseHprof(data, { indexed = false, includeExamples = true } = {}) {
  if (!Buffer.isBuffer(data) || data.length > MAX_FILE) throw new Error('HPROF 文件超过 256 MiB 限制');
  const zero = data.indexOf(0);
  if (zero < 0 || zero > 64 || !data.subarray(0, zero).toString('ascii').startsWith('JAVA PROFILE 1.0.')) throw new Error('不是受支持的 HPROF 文件');
  let pos = zero + 1, end = data.length;
  function need(n) { if (!Number.isSafeInteger(n) || n < 0 || pos + n > end) throw new Error('HPROF 文件已截断或记录长度无效'); }
  function skip(n) { need(n); pos += n; }
  function u1() { need(1); return data[pos++]; }
  function u2() { need(2); const n=data.readUInt16BE(pos);pos+=2;return n; }
  function u4() { need(4);const n=data.readUInt32BE(pos);pos+=4;return n; }
  const idSize=u4(); if (![4,8].includes(idSize)) throw new Error('不支持的 HPROF ID 长度');
  skip(8);
  function id(){need(idSize);const s=data.subarray(pos,pos+idSize).toString('hex');pos+=idSize;return s;}
  const sizes={2:idSize,4:1,5:2,6:4,7:8,8:1,9:2,10:4,11:8};
  function typeSize(t){const n=sizes[t];if(!n)throw new Error(`不支持的 HPROF 值类型 ${t}`);return n;}
  const strings=new Map(), classNames=new Map(), stats=new Map(), definitions=new Map(), sampleData=new Map();
  const classSerialNames=new Map(),threadNameIds=new Map(),stackFrames=new Map(),stackTraces=new Map(),threadStackTraces=new Map();
  let javaMappingIndex=null;const mappedFrames=new Map();
  const MAX_STACK_FRAMES=200000,MAX_TRACE_RECORDS=100000,MAX_FRAMES_PER_TRACE=256;
  let storedTraceFrames=0,stackFramesTruncated=false,stackTracesTruncated=false;
  let sampledClasses=0;
  const index = indexed ? new Map() : null, byClass = indexed ? new Map() : null, rootIds = indexed ? new Map() : null, rootDetails = indexed ? new Map() : null;
  const rootKinds={0xff:'未知根',0x01:'JNI 全局引用',0x02:'JNI 局部引用',0x03:'Java 栈帧',0x04:'Native 栈',0x05:'驻留类',0x06:'线程阻塞',0x07:'Monitor',0x08:'线程对象',0x89:'驻留字符串',0x8a:'待 finalize 对象',0x8b:'Debugger 根',0x8c:'Reference 清理根',0x8d:'VM 内部根',0x8e:'JNI Monitor'};
  const indexLimit=1000000;let indexTruncated=false;
  function addIndex(key, object, offset, length, kind, type=null) {
    if(!index)return;
    if(index.size>=indexLimit){indexTruncated=true;return;}
    if(index.has(object))throw new Error('HPROF 含重复对象 ID');
    const item={id:object,cls:key,offset,length,kind,type};index.set(object,item);
    let list=byClass.get(key);if(!list){list=[];byClass.set(key,list);}list.push(item);
  }
  let objects=0, arrays=0, roots=0, heapRecords=0, segmented=false, heapEnd=false;
  function count(key, bytes, objectId) {
    let row=stats.get(key);if(!row){row={count:0,payloadBytes:0,samples:[]};stats.set(key,row);}
    row.count++;row.payloadBytes+=bytes;if(!indexed && includeExamples && row.samples.length<20)row.samples.push(objectId);
  }
  function heap() {
    while(pos<end){
      const tag=u1();
      if ([0xff,0x05,0x07,0x89,0x8a,0x8b,0x8c,0x8d,0x90,0x01,0x02,0x03,0x08,0x8e,0x04,0x06].includes(tag)) {
        const root=id(),detail={tag,kind:rootKinds[tag]};
        if(tag===0x01)detail.jniGlobalRefId=id();
        else if(tag===0x02||tag===0x03){detail.threadSerial=u4();detail.frameNumber=u4();}
        else if(tag===0x04||tag===0x06)detail.threadSerial=u4();
        else if(tag===0x08){detail.threadSerial=u4();detail.stackTraceSerial=u4();}
        else if(tag===0x8e){detail.threadSerial=u4();detail.stackDepth=u4();}
        // UNREACHABLE is a diagnostic marker, not a GC root.
        if(tag!==0x90){roots++;if(rootIds){let tags=rootIds.get(root);if(!tags){tags=[];rootIds.set(root,tags);}if(!tags.includes(tag))tags.push(tag);let details=rootDetails.get(root);if(!details){details=[];rootDetails.set(root,details);}details.push(detail);}}
      }
      else if(tag===0xfe){skip(4+idSize);}
      else if(tag===0x20){
        const cls=id();skip(4);const parent=id(),loader=id(),signers=id(),protection=id();skip(idSize*2);const instanceSize=u4();
        let n=u2();while(n--){skip(2);skip(typeSize(u1()));}
        n=u2();const staticRefs=[];while(n--){const name=id(),type=u1();if(type===2)staticRefs.push({name,target:id()});else skip(typeSize(type));}
        n=u2();const fields=[];while(n--){const name=id(),type=u1();typeSize(type);fields.push({name,type});}
        definitions.set(cls,{parent,loader,signers,protection,staticRefs,instanceSize,fields});
        if(index){if(index.size>=indexLimit)indexTruncated=true;else if(index.has(cls))throw new Error('HPROF 含重复对象 ID');else index.set(cls,{id:cls,cls,kind:'class',length:0});}
      } else if(tag===0x21){
        const object=id();skip(4);const cls=id();const length=u4();need(length);
        if (!indexed && includeExamples && !sampleData.has(cls) && sampledClasses < 3000) { sampleData.set(cls,{id:object,offset:pos,length});sampledClasses++; }
        addIndex(cls,object,pos,length,'instance');skip(length);count(cls,length,object);objects++;
      } else if(tag===0x22){
        const object=id();skip(4);const length=u4();const cls=id();need(length*idSize);addIndex(cls,object,pos,length,'objectArray');skip(length*idSize);count(cls,length*idSize,object);objects++;arrays++;
      } else if(tag===0x23||tag===0xc3){
        const object=id();skip(4);const length=u4();const type=u1();if(type===2)throw new Error('HPROF 原始数组类型无效');const bytes=length*typeSize(type);if(tag===0x23)need(bytes);addIndex(`primitive:${type}`,object,pos,length,tag===0xc3?'arrayNoData':'primitiveArray',type);if(tag===0x23)skip(bytes);count(`primitive:${type}`,tag===0xc3?0:bytes,object);objects++;arrays++;
      } else throw new Error(`不支持的 HPROF 堆记录类型 0x${tag.toString(16)}（偏移 ${pos-1}）`);
    }
  }
  while(pos<data.length){
    end=data.length;need(9);const tag=u1();skip(4);const length=u4();need(length);end=pos+length;
    if(tag===1){const key=id();strings.set(key,data.subarray(pos,end).toString('utf8'));pos=end;}
    else if(tag===2){const serial=u4(),cls=id();skip(4);const nameId=id();classNames.set(cls,nameId);classSerialNames.set(serial,nameId);}
    else if(tag===0x0a){const serial=u4();skip(idSize);threadNameIds.set(serial,id());skip(idSize*2);}
    else if(tag===0x04){const frameId=id(),methodId=id(),signatureId=id(),sourceId=id(),classSerial=u4();need(4);const lineNumber=data.readInt32BE(pos);pos+=4;if(stackFrames.size<MAX_STACK_FRAMES)stackFrames.set(frameId,{id:frameId,methodId,signatureId,sourceId,classSerial,lineNumber});else stackFramesTruncated=true;}
    else if(tag===0x05){const serial=u4(),threadSerial=u4(),frameCount=u4();need(frameCount*idSize);const available=Math.max(0,MAX_STACK_FRAMES-storedTraceFrames),take=Math.min(frameCount,MAX_FRAMES_PER_TRACE,available),frameIds=[];for(let i=0;i<take;i++)frameIds.push(id());skip((frameCount-take)*idSize);const trace={serial,threadSerial,frameCount,frameIds,truncated:frameCount>take};storedTraceFrames+=take;if(stackTraces.size<MAX_TRACE_RECORDS){stackTraces.set(serial,trace);threadStackTraces.set(threadSerial,serial);}else stackTracesTruncated=true;}
    else if(tag===0x0c||tag===0x1c){heapRecords++;if(tag===0x1c)segmented=true;heap();}
    else if(tag===0x2c){if(length!==0)throw new Error('HPROF 结束记录长度无效');heapEnd=true;}
    pos=end;
  }
  if(!heapRecords)throw new Error('文件没有 HPROF 堆数据');
  if(segmented&&!heapEnd)throw new Error('HPROF 分段数据缺少结束记录，文件可能已截断');
  const nullId='0'.repeat(idSize*2);
  function setMappingText(text){
    if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>128*1024*1024)throw new Error('混淆映射文件不能超过 128 MiB');
    javaMappingIndex=indexJavaMapping(text);mappedFrames.clear();return {classes:javaMappingIndex.classes.size,methods:javaMappingIndex.methodCount};
  }
  function clearMapping(){javaMappingIndex=null;mappedFrames.clear();return {cleared:true};}
  function mappedFrame(frameId,frame){
    if(!javaMappingIndex)return frame;
    if(mappedFrames.has(frameId))return mappedFrames.get(frameId);
    const mappingCandidates=resolveJavaMappingFrame(javaMappingIndex,frame),result=mappingCandidates.length?{...frame,mappingCandidates}:frame;
    mappedFrames.set(frameId,result);return result;
  }
  function rootInfo(objectId){return (rootDetails?.get(objectId)||[]).slice(0,16).map(root=>{
    const info={...root,...(root.threadSerial!==undefined&&threadNameIds.has(root.threadSerial)?{threadName:strings.get(threadNameIds.get(root.threadSerial))||null}:{})};
    const traceSerial=root.stackTraceSerial??threadStackTraces.get(root.threadSerial),trace=traceSerial===undefined?null:stackTraces.get(traceSerial);
    if(trace){
      info.stackTraceSerial=traceSerial;info.stackTraceTruncated=trace.truncated;
      info.stackTrace=trace.frameIds.map(frameId=>{const frame=stackFrames.get(frameId);if(!frame)return {id:frameId,unavailable:true};const classNameId=classSerialNames.get(frame.classSerial);return mappedFrame(frameId,{id:frameId,className:classNameId===undefined?null:(strings.get(classNameId)||'').replaceAll('/','.'),methodName:strings.get(frame.methodId)||null,signature:strings.get(frame.signatureId)||null,sourceFile:strings.get(frame.sourceId)||null,lineNumber:frame.lineNumber});});
      info.stackFrameDataIncomplete=stackFramesTruncated||info.stackTrace.some(frame=>frame.unavailable);
      if(Number.isInteger(root.frameNumber))info.frame=info.stackTrace[root.frameNumber]||null;
      if(Number.isInteger(root.stackDepth))info.frame=info.stackTrace[root.stackDepth]||null;
    }else if(traceSerial!==undefined)info.stackTraceUnavailable=true;
    if((rootDetails?.get(objectId)?.length||0)>16)info.rootRecordsTruncated=true;
    return info;
  });}
  function decodeSample(cls, sample = sampleData.get(cls), fieldOffset=0, fieldLimit=64) {
    if(!sample)return null;
    const chain=[],seen=new Set();let cursor=cls,complete=true;
    while(cursor!==nullId){
      if(seen.has(cursor)||chain.length>=100){complete=false;break;}
      seen.add(cursor);const def=definitions.get(cursor);if(!def){complete=false;break;}
      chain.push({id:cursor,...def});cursor=def.parent;
    }
    if(!complete)return {id:sample.id,fields:[],warning:'类继承信息缺失或异常，无法安全解码字段'};
    let offset=sample.offset,limit=sample.offset+sample.length;const fields=[];let total=0;
    for(const def of chain)for(const field of def.fields){
      const width=typeSize(field.type);if(offset+width>limit)return {id:sample.id,fields:[],warning:'实例数据与字段定义长度不一致'};
      let value;
      switch(field.type){
        case 2:value=data.subarray(offset,offset+idSize).toString('hex');if(value===nullId)value=null;break;
        case 4:value=data[offset]!==0;break;case 5:value=data.readUInt16BE(offset);break;
        case 6:value=data.readFloatBE(offset);break;case 7:value=data.readDoubleBE(offset);break;
        case 8:value=data.readInt8(offset);break;case 9:value=data.readInt16BE(offset);break;
        case 10:value=data.readInt32BE(offset);break;case 11:value=data.readBigInt64BE(offset).toString();break;
      }
      if(typeof value==='number'&&!Number.isFinite(value))value=String(value);
      if(total>=fieldOffset&&total<fieldOffset+fieldLimit)fields.push({name:strings.get(field.name)||`字段 ${field.name}`,declaringClass:(strings.get(classNames.get(def.id))||def.id).replaceAll('/','.'),type:field.type,value});
      total++;offset+=width;
    }
    return {id:sample.id,fields,totalFields:total,fieldOffset,warning:offset!==limit?'字段定义未覆盖全部实例数据，可能包含运行时扩展字段':total>fieldLimit?'字段仅显示当前页':null};
  }
  const primitive={4:'boolean[]',5:'char[]',6:'float[]',7:'double[]',8:'byte[]',9:'short[]',10:'int[]',11:'long[]'};
  const classes=[...stats].map(([key,row])=>({id:key,name:key.startsWith('primitive:')?primitive[Number(key.slice(10))]||key:(strings.get(classNames.get(key))||`未知类 ${key}`).replaceAll('/','.'),...row,...(!indexed&&includeExamples?{example:decodeSample(key)}:{})})).sort((a,b)=>b.payloadBytes-a.payloadBytes||b.count-a.count);
  const summary={format:data.subarray(0,zero).toString('ascii'),idSize,fileBytes:data.length,objects,arrays,roots,heapRecords,classes,indexedObjects:index?.size??null,indexTruncated,stackMetadata:{frameRecords:stackFrames.size,traceRecords:stackTraces.size,storedTraceFrames,frameRecordLimitReached:stackFramesTruncated,traceRecordLimitReached:stackTracesTruncated},note:'字节数为 HPROF 记录中的实例字段或数组元素数据，不是对象浅大小或保留大小；不包含对象头和对齐。'};
  if(!indexed)return summary;
  const names=new Map(classes.map(c=>[c.id,c.name]));
  function stringPreview(item){
    const decoded=decodeSample(item.cls,item);
    if(decoded.warning||decoded.totalFields>64)return null;
    const get=(name,type)=>{const found=decoded.fields.filter(f=>f.declaringClass==='java.lang.String'&&f.name===name&&f.type===type);return found.length===1?found[0].value:undefined;};
    const value=get('value',2),offset=get('offset',10),count=get('count',10),coder=get('coder',8),array=index.get(value);
    if(!array||array.kind!=='primitiveArray')return null;
    // ART emits a synthetic value array and normalized character count in
    // HPROF: https://android.googlesource.com/platform/art/+/f169e27/runtime/hprof/hprof.cc
    const art=offset===undefined&&decoded.fields.some(f=>f.declaringClass==='java.lang.Object'&&f.name==='shadow$_klass_'&&f.type===2)&&decoded.fields.some(f=>f.declaringClass==='java.lang.Object'&&f.name==='shadow$_monitor_'&&f.type===10);
    let first,length,readUnit;
    if(!art&&offset===undefined&&count===undefined&&coder!==undefined){
      // OpenJDK Compact Strings store Latin-1 (coder 0) or big-endian
      // UTF-16 (coder 1) directly in byte[] value, without offset/count.
      if(array.type!==8||![0,1].includes(coder))return null;
      const bytesPerUnit=coder===0?1:2;if(array.length%bytesPerUnit!==0)return null;
      first=0;length=array.length/bytesPerUnit;
      readUnit=i=>coder===0?data[array.offset+i]:data.readUInt16BE(array.offset+i*2);
    }else{
      if(!Number.isSafeInteger(count)||count<0)return null;
      first=art?0:offset;length=count;
      if(!Number.isSafeInteger(first)||first<0||(!art&&array.type!==5)||(art&&(![5,8].includes(array.type)||array.length!==count))||first+count>array.length)return null;
      readUnit=i=>{const unit=array.type===5?data.readUInt16BE(array.offset+(first+i)*2):data[array.offset+first+i];return array.type===8&&unit>127?null:unit;};
    }
    const previewLength=Math.min(length,512),units=[];for(let i=0;i<previewLength;i++){const unit=readUnit(i);if(unit===null)return null;units.push(unit);}
    return {text:String.fromCharCode(...units),length,truncated:length>previewLength,storageId:value};
  }
  function duplicateStrings(){
    const stringClasses=classes.filter(c=>c.name==='java.lang.String'),groups=new Map();let scanned=0,unavailable=0,tooLong=0,indexedTotal=0;
    for(const cls of stringClasses){
      const list=byClass.get(cls.id)||[];indexedTotal+=list.length;
      for(const item of list){
        if(scanned>=20000)continue;scanned++;
        const value=stringPreview(item);if(!value){unavailable++;continue;}if(value.truncated){tooLong++;continue;}
        let group=groups.get(value.text);if(!group){group={text:value.text,instances:0,storage:new Set(),ids:[]};groups.set(value.text,group);}
        group.instances++;group.storage.add(value.storageId);if(group.ids.length<5)group.ids.push(item.id);
      }
    }
    const matches=[...groups.values()].filter(g=>g.instances>1).sort((a,b)=>b.instances-a.instances||a.text.localeCompare(b.text));
    return {scanned,indexedTotal,unavailable,tooLong,indexTruncated,scanLimitReached:indexedTotal>scanned,totalGroups:matches.length,groups:matches.slice(0,100).map(g=>({text:g.text,instances:g.instances,storageCount:g.storage.size,ids:g.ids}))};
  }
  function searchStrings({query,offset=0,caseSensitive=false}={}){
    if(typeof query!=='string'||!query.length||query.length>256)throw new Error('请输入 1–256 个字符的搜索词');
    if(!Number.isSafeInteger(offset)||offset<0||typeof caseSensitive!=='boolean')throw new Error('搜索参数无效');
    const lists=classes.filter(c=>c.name==='java.lang.String').map(c=>byClass.get(c.id)||[]),indexedTotal=lists.reduce((n,list)=>n+list.length,0);
    if(offset>indexedTotal)throw new Error('搜索位置超出范围');
    const needle=caseSensitive?query:query.toLowerCase(),items=[];let position=0,scanned=0,unavailable=0,tooLong=0;
    for(const list of lists){
      if(position+list.length<=offset){position+=list.length;continue;}
      let i=Math.max(0,offset-position);position+=i;
      for(;i<list.length&&scanned<5000&&items.length<100;i++,position++,scanned++){
        const value=stringPreview(list[i]);if(!value){unavailable++;continue;}if(value.truncated){tooLong++;continue;}
        if((caseSensitive?value.text:value.text.toLowerCase()).includes(needle))items.push({id:list[i].id,text:value.text,storageId:value.storageId});
      }
      if(scanned>=5000||items.length>=100)break;
    }
    return {items,offset,nextOffset:position<indexedTotal?position:null,indexedTotal,scanned,unavailable,tooLong,indexTruncated};
  }
  function objectDetail(id,{offset=0,limit=64}={}){
    if(typeof id!=='string'||!new RegExp(`^[a-f0-9]{${idSize*2}}$`).test(id))throw new Error('对象 ID 无效');
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('分页参数无效');
    const item=index.get(id);if(!item)throw new Error(indexTruncated?'对象未找到，索引可能已达到上限':'对象不在快照中');
    const output={id,kind:item.kind,classId:item.cls,className:names.get(item.cls)||item.cls};
    if(item.kind==='instance')return {...output,...decodeSample(item.cls,item,offset,limit),...(output.className==='java.lang.String'?{stringPreview:stringPreview(item)}:{})};
    if(item.kind==='class'){
      const d=definitions.get(id);const links=[['父类',d.parent],['类加载器',d.loader],['签名对象',d.signers],['保护域',d.protection],...d.staticRefs.map(f=>[`静态字段 ${strings.get(f.name)||f.name}`,f.target])];
      return {...output,className:(strings.get(classNames.get(id))||names.get(id)||id).replaceAll('/','.'),fields:links.map(([name,value])=>({name,declaringClass:'类对象',type:2,value:value===nullId?null:value}))};
    }
    output.length=item.length;
    if(item.kind==='objectArray'){
      output.valueOffset=offset;output.values=[];for(let i=offset;i<Math.min(offset+limit,item.length);i++){const value=data.subarray(item.offset+i*idSize,item.offset+(i+1)*idSize).toString('hex');output.values.push(value===nullId?null:value);}
    } else if(item.kind==='primitiveArray'){
      output.valueOffset=offset;output.elementType=item.type;output.values=[];
      for(let i=offset;i<Math.min(offset+limit,item.length);i++){
        const at=item.offset+i*typeSize(item.type);let value;
        switch(item.type){
          case 4:value=data[at]===0?false:data[at]===1?true:`无效 (${data[at]})`;break;
          case 5:value=data.readUInt16BE(at);break;case 6:value=data.readFloatBE(at);break;case 7:value=data.readDoubleBE(at);break;
          case 8:value=data.readInt8(at);break;case 9:value=data.readInt16BE(at);break;case 10:value=data.readInt32BE(at);break;case 11:value=data.readBigInt64BE(at).toString();break;
        }
        if(typeof value==='number'&&!Number.isFinite(value))value=String(value);output.values.push(value);
      }
    }
    return output;
  }
  function classInstances(cls,offset=0,limit=100){
    if(typeof cls!=='string'||!byClass.has(cls))return {items:[],offset:0,total:0,indexTruncated};
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('分页参数无效');
    const list=byClass.get(cls);return {items:list.slice(offset,offset+limit).map(({id,kind,length})=>({id,kind,length})),offset,total:list.length,indexTruncated};
  }
  function bitmaps(offset=0,limit=100){
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('分页参数无效');
    const bitmapClasses=classes.filter(c=>c.name==='android.graphics.Bitmap'),items=[];let total=0;
    for(const cls of bitmapClasses){
      const instances=byClass.get(cls.id)||[];
      for(const item of instances){
        const position=total++;if(position<offset||position>=offset+limit)continue;
        const decoded=decodeSample(cls.id,item),fields=decoded.fields.filter(f=>f.declaringClass==='android.graphics.Bitmap');
        const field=(name,type)=>{const matches=fields.filter(f=>f.name===name&&f.type===type);return matches.length===1?matches[0].value:null;};
        const ref=field('mBuffer',2),buffer=ref?index.get(ref):null;
        items.push({id:item.id,classId:cls.id,width:field('mWidth',10),height:field('mHeight',10),density:field('mDensity',10),recycled:field('mRecycled',4),bufferId:ref,bufferLength:buffer&&(buffer.kind==='primitiveArray'||buffer.kind==='arrayNoData')&&buffer.type===8?buffer.length:null,bufferDataPresent:buffer&&(buffer.kind==='primitiveArray'||buffer.kind==='arrayNoData')&&buffer.type===8?buffer.kind==='primitiveArray':null,warning:decoded.warning});
      }
    }
    return {items,offset,total,indexTruncated,recordedTotal:bitmapClasses.reduce((sum,c)=>sum+c.count,0),classCount:bitmapClasses.length};
  }
  let bitmapPngIndex;
  function readBitmapPngIndex(){
    const findClass=name=>[...classNames].find(([,stringId])=>strings.get(stringId)===name)?.[0],bitmapClassId=findClass('android/graphics/Bitmap'),dumpClassId=findClass('android/graphics/Bitmap$DumpData');
    const bitmapClass=bitmapClassId?{id:bitmapClassId}:null,dumpClass=dumpClassId?{id:dumpClassId}:null;
    if(!bitmapClass||!dumpClass)return {available:false,reason:'快照不含 Android 35 Bitmap PNG dump 元数据',items:[],recordedCount:null,discoveredCount:null};
    const dumpRef=(definitions.get(bitmapClass.id)?.staticRefs||[]).filter(f=>strings.get(f.name)==='dumpData');
    if(dumpRef.length!==1||!dumpRef[0].target)return {available:false,reason:'Bitmap.dumpData 元数据不可用',items:[],recordedCount:null,discoveredCount:null};
    const dumpObject=index.get(dumpRef[0].target);if(!dumpObject||dumpObject.kind!=='instance'||dumpObject.cls!==dumpClass.id)return {available:false,reason:'Bitmap PNG dump 数据对象缺失',items:[],recordedCount:null,discoveredCount:null};
    const decoded=decodeSample(dumpObject.cls,dumpObject);if(!decoded||decoded.warning)return {available:false,reason:'Bitmap PNG dump 字段布局无法解析',items:[],recordedCount:null,discoveredCount:null};
    const field=(name,type)=>{const found=decoded.fields.filter(f=>f.declaringClass==='android.graphics.Bitmap$DumpData'&&f.name===name&&f.type===type);return found.length===1?found[0].value:null;};
    const recordedCount=field('count',10),discoveredCount=field('max',10),arrayId=field('buffers',2),array=arrayId?index.get(arrayId):null;
    if(!Number.isSafeInteger(recordedCount)||recordedCount<0||recordedCount>1000000||!Number.isSafeInteger(discoveredCount)||discoveredCount<recordedCount||!array||array.kind!=='objectArray')return {available:false,reason:'Bitmap PNG dump 数组或计数无效',items:[],recordedCount,discoveredCount};
    const items=[],count=Math.min(recordedCount,array.length);
    for(let i=0;i<count;i++){
      const id=data.subarray(array.offset+i*idSize,array.offset+(i+1)*idSize).toString('hex');if(!id||/^0+$/.test(id))continue;
      const item=index.get(id);if(!item||item.kind!=='primitiveArray'||item.type!==8)continue;
      const bytes=data.subarray(item.offset,item.offset+item.length),png=validatePng(bytes);if(!png)continue;
      items.push({recordIndex:i+1,arrayId:id,width:png.width,height:png.height,pngBytes:item.length,sha256:createHash('sha256').update(bytes).digest('hex')});
    }
    const frequencies=new Map();for(const item of items)frequencies.set(item.sha256,(frequencies.get(item.sha256)||0)+1);
    for(const item of items)item.duplicateCount=frequencies.get(item.sha256);
    return {available:true,reason:null,recordedCount,discoveredCount,exportedCount:items.length,uniqueImageCount:frequencies.size,duplicateGroupCount:[...frequencies.values()].filter(count=>count>1).length,totalPngBytes:items.reduce((sum,item)=>sum+item.pngBytes,0),items};
  }
  function bitmapPngs(offset=0,limit=100){
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('分页参数无效');
    bitmapPngIndex??=readBitmapPngIndex();
    return {...bitmapPngIndex,items:bitmapPngIndex.items.slice(offset,offset+limit),offset,total:bitmapPngIndex.items.length};
  }
  function bitmapPng(arrayId){
    if(typeof arrayId!=='string'||!new RegExp(`^[a-f0-9]{${idSize*2}}$`).test(arrayId))throw new Error('Bitmap PNG 数组 ID 无效');
    bitmapPngIndex??=readBitmapPngIndex();if(!bitmapPngIndex.available||!bitmapPngIndex.items.some(item=>item.arrayId===arrayId))throw new Error('对象不是当前快照中通过校验的 Bitmap PNG');
    const metadata=bitmapPngIndex.items.find(image=>image.arrayId===arrayId),item=index.get(arrayId);if(item.length>64*1024*1024)throw new Error('单张 Bitmap PNG 导出上限为 64 MiB');return {...metadata,bytes:Uint8Array.from(data.subarray(item.offset,item.offset+item.length))};
  }
  function bitmapBuffer(bitmapId){
    if(typeof bitmapId!=='string'||!new RegExp(`^[a-f0-9]{${idSize*2}}$`).test(bitmapId))throw new Error('Bitmap 对象 ID 无效');
    const bitmap=index.get(bitmapId);
    if(!bitmap||bitmap.kind!=='instance'||!classes.some(c=>c.id===bitmap.cls&&c.name==='android.graphics.Bitmap'))throw new Error('Bitmap 对象不在当前快照中');
    const decoded=decodeSample(bitmap.cls,bitmap),fields=decoded.fields.filter(f=>f.declaringClass==='android.graphics.Bitmap'&&f.name==='mBuffer'&&f.type===2);
    if(decoded.warning||fields.length!==1||!fields[0].value)throw new Error('Bitmap 没有可确认的 Java 缓冲区');
    const buffer=index.get(fields[0].value);
    if(!buffer||buffer.kind!=='primitiveArray'||buffer.type!==8)throw new Error('Bitmap 缓冲区数据未保存在 HPROF 中');
    return {bitmapId,bufferId:fields[0].value,width:(()=>{const f=decoded.fields.filter(x=>x.declaringClass==='android.graphics.Bitmap'&&x.name==='mWidth'&&x.type===10);return f.length===1?f[0].value:null;})(),height:(()=>{const f=decoded.fields.filter(x=>x.declaringClass==='android.graphics.Bitmap'&&x.name==='mHeight'&&x.type===10);return f.length===1?f[0].value:null;})(),bytes:Uint8Array.from(data.subarray(buffer.offset,buffer.offset+buffer.length))};
  }
  function duplicateBitmaps(){
    const groups=new Map(),arrays=new Map();let scanned=0,hashedBytes=0,unavailable=0,limitReached=false;
    outer:for(const cls of classes.filter(c=>c.name==='android.graphics.Bitmap'))for(const item of byClass.get(cls.id)||[]){
      if(scanned>=10000){limitReached=true;break outer;}scanned++;
      const decoded=decodeSample(cls.id,item),fields=decoded.fields.filter(f=>f.declaringClass==='android.graphics.Bitmap'&&f.name==='mBuffer'&&f.type===2);
      const ref=fields.length===1?fields[0].value:null,buffer=ref?index.get(ref):null;
      if(!buffer||buffer.kind!=='primitiveArray'||buffer.type!==8||!buffer.length){unavailable++;continue;}
      let group=arrays.get(ref);
      if(!group){
        if(hashedBytes+buffer.length>64*1024*1024){limitReached=true;unavailable++;continue;}
        const bytes=data.subarray(buffer.offset,buffer.offset+buffer.length);hashedBytes+=buffer.length;
        const digest=createHash('sha256').update(bytes).digest('hex'),key=`${buffer.length}:${digest}`;
        let candidates=groups.get(key);if(!candidates){candidates=[];groups.set(key,candidates);}
        group=candidates.find(g=>data.subarray(g.offset,g.offset+g.length).equals(bytes));
        if(!group){group={sha256:digest,length:buffer.length,offset:buffer.offset,arrayIds:[],bitmapCount:0,bitmapIds:[]};candidates.push(group);}
        group.arrayIds.push(ref);arrays.set(ref,group);
      }
      group.bitmapCount++;if(group.bitmapIds.length<20)group.bitmapIds.push(item.id);
    }
    const duplicates=[...groups.values()].flat().filter(g=>g.arrayIds.length>1).map(g=>({sha256:g.sha256,byteLength:g.length,arrayCount:g.arrayIds.length,bitmapCount:g.bitmapCount,duplicateBytes:g.length*(g.arrayIds.length-1),bitmapIds:g.bitmapIds,arrayIds:g.arrayIds.slice(0,20)})).sort((a,b)=>b.duplicateBytes-a.duplicateBytes);
    return {groups:duplicates.slice(0,100),truncated:duplicates.length>100||limitReached||indexTruncated,scanned,hashedBytes,unavailable,indexTruncated,limitReached};
  }
  function destroyedActivities(){
    const layouts=new Map(),items=[];let scanned=0,unavailable=0,destroyed=0,incompleteClasses=0,limitReached=false;
    function layout(cls){
      if(layouts.has(cls))return layouts.get(cls);
      let cursor=cls,offset=0,found=false,target=null,complete=true;const seen=new Set();
      while(cursor!==nullId){
        if(seen.has(cursor)||seen.size>=100){complete=false;break;}seen.add(cursor);
        const def=definitions.get(cursor);if(!def){complete=false;break;}
        const name=(strings.get(classNames.get(cursor))||'').replaceAll('/','.');
        if(name==='android.app.Activity')found=true;
        for(const field of def.fields){
          if(name==='android.app.Activity'&&strings.get(field.name)==='mDestroyed'&&field.type===4){if(target!==null)complete=false;target=offset;}
          offset+=typeSize(field.type);
        }
        cursor=def.parent;
      }
      const result={found,complete,target,bytes:offset};layouts.set(cls,result);return result;
    }
    outer:for(const [cls,instances] of byClass){
      if(cls.startsWith('primitive:')||!instances.some(item=>item.kind==='instance'))continue;const info=layout(cls);if(!info.complete)incompleteClasses++;if(!info.found)continue;
      for(const item of instances){
        if(item.kind!=='instance')continue;if(scanned>=20000){limitReached=true;break outer;}scanned++;
        if(!info.complete||info.target===null||item.length<info.bytes){unavailable++;continue;}
        const value=data[item.offset+info.target];if(value!==0&&value!==1){unavailable++;continue;}if(value===0)continue;
        destroyed++;if(items.length<500)items.push({id:item.id,classId:cls,className:names.get(cls)||`未知类 ${cls}`,extraBytes:item.length>info.bytes});
      }
    }
    return {items,scanned,destroyed,unavailable,incompleteClasses,indexTruncated,limitReached,truncated:indexTruncated||limitReached||destroyed>items.length};
  }
  let reverseGraph=null;
  const referenceKindCodes={WeakReference:1,SoftReference:2,PhantomReference:3,FinalizerReference:4};
  const referenceKindNames=[null,'WeakReference','SoftReference','PhantomReference','FinalizerReference'];
  const edgeFlags=(referenceKind,arrayIndex)=>((referenceKindCodes[referenceKind]||0)<<1)|(arrayIndex?1:0);
  const edgeLabel=(label,flags)=>(flags&1)?`[${label}]`:label;
  const edgeReferenceKind=flags=>referenceKindNames[flags>>1]||null;
  const isNonStrongReference=kind=>['WeakReference','SoftReference','PhantomReference'].includes(kind);
  function buildReverseGraph(){
    if(reverseGraph)return reverseGraph;
    const edges=new Map(), layouts=new Map();let edgeCount=0,incomplete=indexTruncated, skipped=0, missingTargets=0, limited=false;
    const edgeLimit=1500000;
    function add(target,source,label,referenceKind=null){
      if(target===nullId)return;
      if(!index.has(target)){missingTargets++;incomplete=true;return;}
      if(edgeCount>=edgeLimit){incomplete=true;limited=true;return;}
      let refs=edges.get(target);if(!refs){refs=[];edges.set(target,refs);}
      const arrayIndex=typeof label==='number';refs.push(source,label,edgeFlags(referenceKind,arrayIndex));edgeCount++;
    }
    function layout(cls){
      if(layouts.has(cls))return layouts.get(cls);
      const fields=[],seen=new Set();let cursor=cls,offset=0,valid=true,referenceKind=null;
      while(cursor!==nullId){
        if(seen.has(cursor)||seen.size>=100){valid=false;break;}seen.add(cursor);
        const def=definitions.get(cursor);if(!def){valid=false;break;}
        const name=(strings.get(classNames.get(cursor))||'').replaceAll('/','.');
        if(!referenceKind&&['java.lang.ref.WeakReference','java.lang.ref.SoftReference','java.lang.ref.PhantomReference','java.lang.ref.FinalizerReference'].includes(name))referenceKind=name.split('.').at(-1);
        for(const field of def.fields){const label=strings.get(field.name)||field.name;if(field.type===2)fields.push({offset,label,referent:name==='java.lang.ref.Reference'&&label==='referent'});offset+=typeSize(field.type);}
        cursor=def.parent;
      }
      const value=valid?{fields,bytes:offset,referenceKind}:null;layouts.set(cls,value);return value;
    }
    for(const item of index.values()){
      if(limited)break;
      if(item.kind==='class'){
        const def=definitions.get(item.id);
        for(const [target,label] of [[def.parent,'父类'],[def.loader,'类加载器'],[def.signers,'签名对象'],[def.protection,'保护域'],...def.staticRefs.map(f=>[f.target,`静态字段 ${strings.get(f.name)||f.name}`])]){add(target,item.id,label);if(limited)break;}
      } else if(item.kind==='instance'){
        add(item.cls,item.id,'对象类');if(limited)break;
        const def=layout(item.cls);
        if(!def||def.bytes!==item.length){incomplete=true;skipped++;continue;}
        for(const field of def.fields){const offset=item.offset+field.offset;add(data.subarray(offset,offset+idSize).toString('hex'),item.id,field.label,field.referent?def.referenceKind:null);if(limited)break;}
      } else if(item.kind==='objectArray'){
        add(item.cls,item.id,'数组类');if(limited)break;
        for(let i=0;i<item.length;i++){const offset=item.offset+i*idSize;add(data.subarray(offset,offset+idSize).toString('hex'),item.id,i);if(limited)break;}
      }
    }
    return reverseGraph={edges,edgeCount,incomplete,skipped,missingTargets,limited};
  }
  function incomingReferences(target,{offset=0,limit=100,excludeNonStrong=false}={}){
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('分页参数无效');
    if(typeof excludeNonStrong!=='boolean')throw new Error('引用过滤参数无效');
    objectDetail(target);const graph=buildReverseGraph(),refs=graph.edges.get(target)||[];let total=0;const items=[];
    for(let i=0;i<refs.length;i+=3){const flags=refs[i+2],referenceKind=edgeReferenceKind(flags);if(excludeNonStrong&&isNonStrongReference(referenceKind))continue;if(total>=offset&&items.length<limit){const id=refs[i],item=index.get(id);items.push({id,kind:item.kind,className:item.kind==='class'?(strings.get(classNames.get(item.id))||names.get(item.id)||item.id).replaceAll('/','.'):(names.get(item.cls)||item.cls||'未知类'),label:edgeLabel(refs[i+1],flags),referenceKind});}total++;}
    return {target,offset,total,items,excludeNonStrong,rootTags:rootIds.get(target)||[],rootDetails:rootInfo(target),edgeCount:graph.edgeCount,indexOrGraphIncomplete:graph.incomplete,skipped:graph.skipped,missingTargets:graph.missingTargets,edgeLimitReached:graph.limited};
  }
  function rootPath(target,{excludeNonStrong=false}={}){
    if(typeof excludeNonStrong!=='boolean')throw new Error('引用过滤参数无效');
    objectDetail(target);
    const graph=buildReverseGraph(), queue=[target], visited=new Set(queue), towardTarget=new Map();let root=null;
    for(let n=0;n<queue.length&&n<50000;n++){
      const node=queue[n];if(rootIds.has(node)){root=node;break;}
      const refs=graph.edges.get(node)||[];for(let i=0;i<refs.length;i+=3){const id=refs[i],flags=refs[i+2],referenceKind=edgeReferenceKind(flags);if(excludeNonStrong&&isNonStrongReference(referenceKind))continue;if(!visited.has(id)){visited.add(id);towardTarget.set(id,{id:node,label:edgeLabel(refs[i+1],flags),referenceKind});queue.push(id);}}
    }
    const path=[];
    if(root){let node=root;while(node){const item=index.get(node);const next=towardTarget.get(node);path.push({id:node,className:item?.kind==='class'?(strings.get(classNames.get(node))||names.get(node)||node).replaceAll('/','.'):(names.get(item?.cls)||item?.cls||'未知类'),via:next?.label||null,referenceKind:next?.referenceKind||null});node=next?.id;}}
    return {found:!!root,path,excludeNonStrong,rootTags:root?rootIds.get(root):[],rootDetails:root?rootInfo(root):[],visited:visited.size,edgeCount:graph.edgeCount,
      incomplete:true,searchLimitReached:!root&&queue.length>50000,indexOrGraphIncomplete:graph.incomplete,skipped:graph.skipped,edgeLimitReached:graph.limited,
      note:excludeNonStrong?'已排除可识别的 WeakReference、SoftReference 和 PhantomReference 的 referent 字段；FinalizerReference 会标注但保留在路径中，因为运行时可能暂存待 finalize 对象。其他引用语义和运行时关系可能未覆盖，结果不能证明对象存活原因或内存泄漏。':'候选路径涵盖已索引对象的实例字段、对象数组、类对象和静态字段；不区分强、弱引用进行搜索，已识别的弱、软、虚引用会标注；FinalizerReference 会单独标注；可能缺少运行时关系，不能证明对象存活原因或内存泄漏。'};
  }
  function rootPaths(targets,{excludeNonStrong=false}={}){
    if(!Array.isArray(targets)||targets.length>500||targets.some(id=>typeof id!=='string'||!new RegExp(`^[a-f0-9]{${idSize*2}}$`).test(id)))throw new Error('对象路径列表无效');
    if(typeof excludeNonStrong!=='boolean')throw new Error('引用过滤参数无效');
    if(!targets.length)return {items:[],reachable:0,indexed:index.size,edgeCount:0,excludeNonStrong,incomplete:false,missingTargets:0,skipped:0,edgeLimitReached:false,searchLimitReached:false};
    for(const target of targets)objectDetail(target);
    const graph=buildReverseGraph(),outgoing=new Map();
    for(const [target,refs] of graph.edges)for(let i=0;i<refs.length;i+=3){const source=refs[i],flags=refs[i+2],referenceKind=edgeReferenceKind(flags);if(excludeNonStrong&&isNonStrongReference(referenceKind))continue;let list=outgoing.get(source);if(!list){list=[];outgoing.set(source,list);}list.push(target,refs[i+1],flags);}
    const parents=new Map(),queue=[];for(const id of rootIds.keys())if(index.has(id)&&!parents.has(id)){parents.set(id,null);queue.push(id);}
    for(let cursor=0;cursor<queue.length&&cursor<50000;cursor++){
      const parent=queue[cursor],edges=outgoing.get(parent)||[];for(let i=0;i<edges.length;i+=3){const id=edges[i],flags=edges[i+2];if(parents.has(id))continue;parents.set(id,{id:parent,label:edgeLabel(edges[i+1],flags),referenceKind:edgeReferenceKind(flags)});queue.push(id);}
    }
    const className=item=>item.kind==='class'?(strings.get(classNames.get(item.id))||names.get(item.id)||item.id).replaceAll('/','.'):names.get(item.cls)||item.cls||'未知类';
    const results=targets.map(target=>{
      if(!parents.has(target))return {target,found:false,path:[],rootTags:[],rootDetails:[],visited:parents.size,searchLimitReached:queue.length>50000};
      const chain=[];let node=target;
      while(node){chain.push(node);node=parents.get(node)?.id||null;}
      chain.reverse();const path=chain.map((id,i)=>{const item=index.get(id),next=i+1<chain.length?parents.get(chain[i+1]):null;return {id,className:className(item),via:next?.label||null,referenceKind:next?.referenceKind||null};});
      return {target,found:true,path,rootTags:rootIds.get(chain[0])||[],rootDetails:rootInfo(chain[0]),visited:parents.size,searchLimitReached:queue.length>50000};
    });
    return {items:results,reachable:parents.size,indexed:index.size,edgeCount:graph.edgeCount,excludeNonStrong,incomplete:graph.incomplete,missingTargets:graph.missingTargets,skipped:graph.skipped,edgeLimitReached:graph.limited,searchLimitReached:queue.length>50000};
  }
  function leakCanaryRetainedObjects(){
    const markerClasses=classes.filter(c=>/(?:^|\.)KeyedWeakReference$/.test(c.name)),watchers=[];let scanned=0,unavailable=0,cleared=0,scanLimitReached=false;
    for(const cls of markerClasses){
      for(const item of byClass.get(cls.id)||[]){
        if(scanned>=5000){scanLimitReached=true;break;}scanned++;if(item.kind!=='instance'){unavailable++;continue;}
        const decoded=decodeSample(cls.id,item,0,100);if(decoded.warning&&decoded.warning!=='字段仅显示当前页'){unavailable++;continue;}
        const fields=decoded.fields,referents=fields.filter(f=>f.name==='referent'&&f.declaringClass==='java.lang.ref.Reference'&&f.type===2);
        if(referents.length!==1){unavailable++;continue;}const targetId=referents[0].value;
        if(!targetId){cleared++;continue;}if(!index.has(targetId)){unavailable++;continue;}
        const stringValue=name=>{const found=fields.filter(f=>f.name===name&&f.type===2);if(found.length!==1||!found[0].value)return null;const value=index.get(found[0].value);return value&&names.get(value.cls)==='java.lang.String'?stringPreview(value):null;};
        watchers.push({watcherId:item.id,className:names.get(cls.id)||cls.name,targetId,targetClassName:names.get(index.get(targetId)?.cls)||'未知类',key:stringValue('key'),description:stringValue('description')||stringValue('name')});
      }
      if(scanLimitReached)break;
    }
    const paths=watchers.length?rootPaths(watchers.slice(0,500).map(item=>item.targetId),{excludeNonStrong:true}):{items:[],reachable:0,indexed:index.size,edgeCount:0,excludeNonStrong:true,incomplete:false,missingTargets:0,skipped:0,edgeLimitReached:false,searchLimitReached:false},pathByTarget=new Map(paths.items.map(item=>[item.target,item]));
    const items=watchers.slice(0,500).map(watcher=>({...watcher,path:pathByTarget.get(watcher.targetId)||null}));
    return {...paths,graphAnalyzed:watchers.length>0,items,markerClasses:markerClasses.map(c=>c.name),scanned,liveReferences:watchers.length,cleared,unavailable,scanLimitReached,truncated:scanLimitReached||watchers.length>500||indexTruncated,indexTruncated,note:'LeakCanary KeyedWeakReference 只标识 heap dump 中仍可读取的 watched object。路径仅排除可识别的 WeakReference、SoftReference 和 PhantomReference referent 字段；FinalizerReference 会标注但保留，因为运行时可能暂存待 finalize 对象。分析使用本工具已索引的对象关系，不包含 Shark 的 Android reference matchers、object inspectors、泄漏指纹或 retained size；找到强路径不是泄漏结论，未找到强路径也可能由数据不完整造成。'};
  }
  let dominatorCache=null;
  function dominatorTree({parentId=null,offset=0,limit=100,excludeNonStrong=false}={}){
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('分页参数无效');
    if(typeof excludeNonStrong!=='boolean')throw new Error('引用过滤参数无效');
    if(!dominatorCache||dominatorCache.excludeNonStrong!==excludeNonStrong){
      dominatorCache=null;
      const graph=buildReverseGraph(),items=[null,...index.values()];
      for(let i=1;i<items.length;i++)items[i].dominatorIndex=i;
      const degree=new Int32Array(items.length),weights=new Float64Array(items.length),unknownBytes=new Uint8Array(items.length);
      let missingRoots=0;
      for(const rootId of rootIds.keys()){const root=index.get(rootId)?.dominatorIndex;if(root)degree[0]++;else missingRoots++;}
      if(!degree[0])throw new Error('快照没有可索引的 GC 根，无法计算支配关系');
      let excludedEdges=0,edgeCount=degree[0];
      for(const [target,refs] of graph.edges){const to=index.get(target)?.dominatorIndex;if(!to)continue;for(let j=0;j<refs.length;j+=3){if(excludeNonStrong&&isNonStrongReference(edgeReferenceKind(refs[j+2]))){excludedEdges++;continue;}const from=index.get(refs[j])?.dominatorIndex;if(from){degree[from]++;edgeCount++;}}}
      if(edgeCount>0x7fffffff)throw new Error('支配图边数超过计算上限');
      const offsets=new Int32Array(items.length+1);for(let i=0;i<degree.length;i++)offsets[i+1]=offsets[i]+degree[i];
      const edges=new Int32Array(edgeCount),cursor=offsets.slice(0,degree.length);
      for(const rootId of rootIds.keys()){const root=index.get(rootId)?.dominatorIndex;if(root)edges[cursor[0]++]=root;}
      for(const [target,refs] of graph.edges){const to=index.get(target)?.dominatorIndex;if(!to)continue;for(let j=0;j<refs.length;j+=3){if(excludeNonStrong&&isNonStrongReference(edgeReferenceKind(refs[j+2])))continue;const from=index.get(refs[j])?.dominatorIndex;if(from)edges[cursor[from]++]=to;}}
      for(let i=1;i<items.length;i++){const item=items[i];if(item.kind==='instance')weights[i]=item.length;else if(item.kind==='objectArray')weights[i]=item.length*idSize;else if(item.kind==='primitiveArray')weights[i]=item.length*typeSize(item.type);else unknownBytes[i]=1;}
      const result=dominatorsCsr(offsets,edges,weights,unknownBytes),firstChild=new Int32Array(result.count+1),nextSibling=new Int32Array(result.count+1),childCount=new Int32Array(result.count+1);
      for(let i=2;i<=result.count;i++){const p=result.idom[i];nextSibling[i]=firstChild[p];firstChild[p]=i;childCount[p]++;}
      dominatorCache={graph,items,result,firstChild,nextSibling,childCount,sortedChildren:new Map(),missingRoots,excludeNonStrong,excludedEdges};
    }
    const {graph,items,result,firstChild,nextSibling,childCount,sortedChildren,missingRoots,excludedEdges}=dominatorCache;
    let parent=1;if(parentId!==null){const indexId=index.get(parentId)?.dominatorIndex;if(!indexId)throw new Error('对象不在索引中');parent=result.order[indexId];if(!parent)throw new Error('对象不在已记录根的可达图中');}
    let list=sortedChildren.get(parent);if(!list){list=[];for(let child=firstChild[parent];child;child=nextSibling[child])list.push(child);list.sort((a,b)=>result.payload[b]-result.payload[a]||result.dominated[b]-result.dominated[a]);sortedChildren.set(parent,list);}
    const name=item=>item.kind==='class'?(strings.get(classNames.get(item.id))||item.id).replaceAll('/','.'):(names.get(item.cls)||item.cls||'未知类');
    return {parentId,offset,total:childCount[parent],reachable:result.count-1,indexed:index.size,edgeCount:graph.edgeCount,excludeNonStrong,excludedEdges,incomplete:graph.incomplete||missingRoots>0,missingTargets:graph.missingTargets,missingRoots,skipped:graph.skipped,edgeLimitReached:graph.limited,
      items:list.slice(offset,offset+limit).map(i=>{const item=items[result.vertex[i]];return {id:item.id,className:name(item),kind:item.kind,dominatedObjects:result.dominated[i],recordedPayloadBytes:result.payload[i],unknownPayloadObjects:result.unknown[i],children:childCount[i]};}),
      note:`基于已记录引用、对象类关系和 GC 根计算的近似支配关系；${excludeNonStrong?'已排除可识别的弱、软、虚引用 referent 字段，FinalizerReference 会标注并保留，其他引用语义仍可能未识别':'未区分强弱引用；弱、软、虚引用及 FinalizerReference 会标注'}，可能缺少运行时边。记录数据字节不含对象头、对齐或类对象大小，不是保留大小；图不完整时支配关系可能改变。`};
  }
  return {summary,objectDetail,classInstances,bitmaps,bitmapPngs,bitmapPng,bitmapBuffer,duplicateBitmaps,duplicateStrings,searchStrings,destroyedActivities,rootPath,rootPaths,leakCanaryRetainedObjects,incomingReferences,dominatorTree,setMappingText,clearMapping};
}
