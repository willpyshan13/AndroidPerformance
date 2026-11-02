import {dominators} from './dominators.js';
import {createHash} from 'node:crypto';
// HPROF record layout follows Android's perflib parser and the HotSpot heap dump format.
const MAX_FILE = 256 * 1024 * 1024;
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
  let sampledClasses=0;
  const index = indexed ? new Map() : null, byClass = indexed ? new Map() : null, rootIds = indexed ? new Map() : null;
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
        const root=id();
        if(tag===0x01)skip(idSize);else if([0x02,0x03,0x08,0x8e].includes(tag))skip(8);else if([0x04,0x06].includes(tag))skip(4);
        // UNREACHABLE is a diagnostic marker, not a GC root.
        if(tag!==0x90){roots++;if(rootIds){let tags=rootIds.get(root);if(!tags){tags=[];rootIds.set(root,tags);}if(!tags.includes(tag))tags.push(tag);}}
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
    else if(tag===2){skip(4);const cls=id();skip(4);classNames.set(cls,id());}
    else if(tag===0x0c||tag===0x1c){heapRecords++;if(tag===0x1c)segmented=true;heap();}
    else if(tag===0x2c){if(length!==0)throw new Error('HPROF 结束记录长度无效');heapEnd=true;}
    pos=end;
  }
  if(!heapRecords)throw new Error('文件没有 HPROF 堆数据');
  if(segmented&&!heapEnd)throw new Error('HPROF 分段数据缺少结束记录，文件可能已截断');
  const nullId='0'.repeat(idSize*2);
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
  const summary={format:data.subarray(0,zero).toString('ascii'),idSize,fileBytes:data.length,objects,arrays,roots,heapRecords,classes,indexedObjects:index?.size??null,indexTruncated,note:'字节数为 HPROF 记录中的实例字段或数组元素数据，不是对象浅大小或保留大小；不包含对象头和对齐。'};
  if(!indexed)return summary;
  const names=new Map(classes.map(c=>[c.id,c.name]));
  function stringPreview(item){
    const decoded=decodeSample(item.cls,item);
    if(decoded.warning||decoded.totalFields>64)return null;
    const get=(name,type)=>{const found=decoded.fields.filter(f=>f.declaringClass==='java.lang.String'&&f.name===name&&f.type===type);return found.length===1?found[0].value:undefined;};
    const value=get('value',2),offset=get('offset',10),count=get('count',10),array=index.get(value);
    if(!array||array.kind!=='primitiveArray'||!Number.isSafeInteger(count)||count<0)return null;
    // ART emits a synthetic value array and normalized character count in
    // HPROF: https://android.googlesource.com/platform/art/+/f169e27/runtime/hprof/hprof.cc
    const art=offset===undefined&&decoded.fields.some(f=>f.declaringClass==='java.lang.Object'&&f.name==='shadow$_klass_'&&f.type===2)&&decoded.fields.some(f=>f.declaringClass==='java.lang.Object'&&f.name==='shadow$_monitor_'&&f.type===10);
    const first=art?0:offset;
    if(!Number.isSafeInteger(first)||first<0||(!art&&array.type!==5)||(art&&(![5,8].includes(array.type)||array.length!==count))||first+count>array.length)return null;
    const length=Math.min(count,512),units=[];for(let i=0;i<length;i++){const unit=array.type===5?data.readUInt16BE(array.offset+(first+i)*2):data[array.offset+first+i];if(array.type===8&&unit>127)return null;units.push(unit);}
    return {text:String.fromCharCode(...units),length:count,truncated:count>length,storageId:value};
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
  function buildReverseGraph(){
    if(reverseGraph)return reverseGraph;
    const edges=new Map(), layouts=new Map();let edgeCount=0,incomplete=indexTruncated, skipped=0, missingTargets=0, limited=false;
    const edgeLimit=750000;
    function add(target,source,label,referenceKind=null){
      if(target===nullId)return;
      if(!index.has(target)){missingTargets++;incomplete=true;return;}
      if(edgeCount>=edgeLimit){incomplete=true;limited=true;return;}
      let refs=edges.get(target);if(!refs){refs=[];edges.set(target,refs);}
      refs.push({id:source,label,referenceKind});edgeCount++;
    }
    function layout(cls){
      if(layouts.has(cls))return layouts.get(cls);
      const fields=[],seen=new Set();let cursor=cls,offset=0,valid=true,referenceKind=null;
      while(cursor!==nullId){
        if(seen.has(cursor)||seen.size>=100){valid=false;break;}seen.add(cursor);
        const def=definitions.get(cursor);if(!def){valid=false;break;}
        const name=(strings.get(classNames.get(cursor))||'').replaceAll('/','.');
        if(!referenceKind&&['java.lang.ref.WeakReference','java.lang.ref.SoftReference','java.lang.ref.PhantomReference'].includes(name))referenceKind=name.split('.').at(-1);
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
        for(let i=0;i<item.length;i++){const offset=item.offset+i*idSize;add(data.subarray(offset,offset+idSize).toString('hex'),item.id,`[${i}]`);if(limited)break;}
      }
    }
    return reverseGraph={edges,edgeCount,incomplete,skipped,missingTargets,limited};
  }
  function incomingReferences(target,{offset=0,limit=100,excludeNonStrong=false}={}){
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('分页参数无效');
    if(typeof excludeNonStrong!=='boolean')throw new Error('引用过滤参数无效');
    objectDetail(target);const graph=buildReverseGraph();
    const refs=(graph.edges.get(target)||[]).filter(edge=>!excludeNonStrong||!edge.referenceKind);
    const items=refs.slice(offset,offset+limit).map(edge=>{const item=index.get(edge.id);return {id:edge.id,kind:item.kind,className:item.kind==='class'?(strings.get(classNames.get(item.id))||names.get(item.id)||item.id).replaceAll('/','.'):(names.get(item.cls)||item.cls||'未知类'),label:edge.label,referenceKind:edge.referenceKind};});
    return {target,offset,total:refs.length,items,excludeNonStrong,rootTags:rootIds.get(target)||[],edgeCount:graph.edgeCount,indexOrGraphIncomplete:graph.incomplete,skipped:graph.skipped,missingTargets:graph.missingTargets,edgeLimitReached:graph.limited};
  }
  function rootPath(target,{excludeNonStrong=false}={}){
    if(typeof excludeNonStrong!=='boolean')throw new Error('引用过滤参数无效');
    objectDetail(target);
    const graph=buildReverseGraph(), queue=[target], visited=new Set(queue), towardTarget=new Map();let root=null;
    for(let n=0;n<queue.length&&n<50000;n++){
      const node=queue[n];if(rootIds.has(node)){root=node;break;}
      for(const edge of graph.edges.get(node)||[]){if(excludeNonStrong&&edge.referenceKind)continue;if(!visited.has(edge.id)){visited.add(edge.id);towardTarget.set(edge.id,{id:node,label:edge.label,referenceKind:edge.referenceKind});queue.push(edge.id);}}
    }
    const path=[];
    if(root){let node=root;while(node){const item=index.get(node);const next=towardTarget.get(node);path.push({id:node,className:item?.kind==='class'?(strings.get(classNames.get(node))||names.get(node)||node).replaceAll('/','.'):(names.get(item?.cls)||item?.cls||'未知类'),via:next?.label||null,referenceKind:next?.referenceKind||null});node=next?.id;}}
    return {found:!!root,path,excludeNonStrong,rootTags:root?rootIds.get(root):[],visited:visited.size,edgeCount:graph.edgeCount,
      incomplete:true,searchLimitReached:!root&&queue.length>50000,indexOrGraphIncomplete:graph.incomplete,skipped:graph.skipped,edgeLimitReached:graph.limited,
      note:excludeNonStrong?'已排除可识别的 WeakReference、SoftReference 和 PhantomReference 的 referent 字段；其他引用语义和运行时关系可能未覆盖，结果不能证明对象存活原因或内存泄漏。':'候选路径涵盖已索引对象的实例字段、对象数组、类对象和静态字段；不区分强、弱引用进行搜索，已识别的弱、软、虚引用会标注；可能缺少运行时关系，不能证明对象存活原因或内存泄漏。'};
  }
  let dominatorCache=null;
  function dominatorTree({parentId=null,offset=0,limit=100,excludeNonStrong=false}={}){
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('分页参数无效');
    if(typeof excludeNonStrong!=='boolean')throw new Error('引用过滤参数无效');
    if(!dominatorCache||dominatorCache.excludeNonStrong!==excludeNonStrong){
      dominatorCache=null;
      if(index.size>250000)throw new Error('支配图超过 25 万对象计算上限');
      const graph=buildReverseGraph(),items=[null,...index.values()],ids=new Map(items.slice(1).map((item,i)=>[item.id,i+1]));
      const outgoing=Array.from({length:items.length},()=>[]),weights=new Float64Array(items.length),unknownBytes=new Uint8Array(items.length);
      let missingRoots=0;
      for(const rootId of rootIds.keys()){const root=ids.get(rootId);if(root)outgoing[0].push(root);else missingRoots++;}
      if(!outgoing[0].length)throw new Error('快照没有可索引的 GC 根，无法计算支配关系');
      let excludedEdges=0;for(const [target,refs] of graph.edges){const to=ids.get(target);for(const ref of refs){if(excludeNonStrong&&ref.referenceKind){excludedEdges++;continue;}const from=ids.get(ref.id);if(from&&to)outgoing[from].push(to);}}
      for(let i=1;i<items.length;i++){const item=items[i];if(item.kind==='instance')weights[i]=item.length;else if(item.kind==='objectArray')weights[i]=item.length*idSize;else if(item.kind==='primitiveArray')weights[i]=item.length*typeSize(item.type);else unknownBytes[i]=1;}
      const result=dominators(outgoing,weights,unknownBytes),children=Array.from({length:result.count+1},()=>[]);
      for(let i=2;i<=result.count;i++)children[result.idom[i]].push(i);
      for(const childList of children)childList.sort((a,b)=>result.payload[b]-result.payload[a]||result.dominated[b]-result.dominated[a]);
      dominatorCache={graph,items,ids,result,children,missingRoots,excludeNonStrong,excludedEdges};
    }
    const {graph,items,ids,result,children,missingRoots,excludedEdges}=dominatorCache;
    let parent=1;if(parentId!==null){const indexId=ids.get(parentId);if(!indexId)throw new Error('对象不在索引中');parent=result.order[indexId];if(!parent)throw new Error('对象不在已记录根的可达图中');}
    const list=children[parent],name=item=>item.kind==='class'?(strings.get(classNames.get(item.id))||item.id).replaceAll('/','.'):(names.get(item.cls)||item.cls||'未知类');
    return {parentId,offset,total:list.length,reachable:result.count-1,indexed:index.size,edgeCount:graph.edgeCount,excludeNonStrong,excludedEdges,incomplete:graph.incomplete||missingRoots>0,missingTargets:graph.missingTargets,missingRoots,skipped:graph.skipped,edgeLimitReached:graph.limited,
      items:list.slice(offset,offset+limit).map(i=>{const item=items[result.vertex[i]];return {id:item.id,className:name(item),kind:item.kind,dominatedObjects:result.dominated[i],recordedPayloadBytes:result.payload[i],unknownPayloadObjects:result.unknown[i],children:children[i].length};}),
      note:`基于已记录引用、对象类关系和 GC 根计算的近似支配关系；${excludeNonStrong?'已排除可识别的弱、软、虚引用 referent 字段，其他引用语义仍可能未识别':'未区分强弱引用'}，可能缺少运行时边。记录数据字节不含对象头、对齐或类对象大小，不是保留大小；图不完整时支配关系可能改变。`};
  }
  return {summary,objectDetail,classInstances,bitmaps,duplicateBitmaps,duplicateStrings,searchStrings,destroyedActivities,rootPath,incomingReferences,dominatorTree};
}
