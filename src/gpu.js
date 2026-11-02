import {createReadStream,createWriteStream} from 'node:fs';
import {mkdir, mkdtemp, open, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createHash, randomUUID} from 'node:crypto';
import {join, basename, extname} from 'node:path';

const MAX=512*1024*1024;
const idPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const types={'.gfxtrace':'agi-frame','.perfetto-trace':'perfetto','.pftrace':'perfetto','.trace':'trace'};
export function parseGpuCapabilities(features,glesProperty){
 const entries=typeof features==='string'?features.split(/\r?\n/).map(s=>s.trim()).filter(s=>s.startsWith('feature:')):null;
 const feature=name=>{const matches=entries?.filter(s=>s===`feature:${name}`||s.startsWith(`feature:${name}=`))||[];return matches.length===1?matches[0]:null;};
 const vk=feature('android.hardware.vulkan.version'),vkValue=vk?.split('=')[1];
 const number=s=>typeof s==='string'&&/^\d{1,10}$/.test(s)&&Number(s)<=0xffffffff?Number(s):null;
 const vulkan=number(vkValue),gles=number(typeof glesProperty==='string'?glesProperty.trim():null);
 return {featureListAvailable:!!entries?.length,vulkanVersion:vulkan===null?null:`${vulkan>>>22}.${(vulkan>>>12)&1023}.${vulkan&4095}`,vulkanRaw:vk||null,vulkanLevel:feature('android.hardware.vulkan.level'),vulkanCompute:feature('android.hardware.vulkan.compute'),openglAep:feature('android.hardware.opengles.aep'),glesVersion:gles===null||gles===0?null:`${gles>>>16}.${gles&65535}`,glesRaw:glesProperty?.trim()||null};
}
function paths(root,id){if(!idPattern.test(id||''))throw new Error('产物标识无效');return {dir:join(root,id),file:join(root,id,'artifact'),meta:join(root,id,'metadata.json')};}
function validMeta(m,id){return m&&m.id===id&&typeof m.name==='string'&&m.name.length<=255&&Object.values(types).includes(m.type)&&Number.isSafeInteger(m.size)&&m.size>0&&m.size<=MAX&&/^[a-f0-9]{64}$/.test(m.sha256)&&Number.isSafeInteger(m.timestamp);}
export async function importGpuArtifact(req,root,{maxBytes=MAX,magic=null}={}){
 const declared=req.headers['content-length'];if(declared!==undefined&&(!/^\d+$/.test(declared)||Number(declared)>maxBytes)){req.resume();throw Object.assign(new Error('产物超过大小限制'),{status:413});}
 let name;try{name=decodeURIComponent(req.headers['x-file-name']||'');}catch{throw new Error('文件名编码无效');}
 name=basename(name.replaceAll('\\','/')).replace(/[\x00-\x1f\x7f]/g,'');const type=types[extname(name).toLowerCase()];
 if(!name||name.length>255||!type)throw new Error('请选择 .gfxtrace、.perfetto-trace、.pftrace 或 .trace 文件');
 const id=randomUUID(),p=paths(root,id);await mkdir(root,{recursive:true,mode:0o700});await mkdir(p.dir,{mode:0o700});let complete=false;
 try{
  const file=await open(p.file,'wx',0o600),hash=createHash('sha256');let size=0,head=Buffer.alloc(0);
  try{for await(const chunk of req.iterator({destroyOnReturn:false})){size+=chunk.length;if(size>maxBytes){req.resume();throw Object.assign(new Error('产物超过大小限制'),{status:413});}if(magic&&head.length<magic.length)head=Buffer.concat([head,chunk.subarray(0,magic.length-head.length)]);hash.update(chunk);let offset=0;while(offset<chunk.length){const {bytesWritten}=await file.write(chunk,offset,chunk.length-offset);if(!bytesWritten)throw new Error('保存产物失败');offset+=bytesWritten;}}}finally{await file.close();}
  if(!size)throw new Error('文件为空');
  if(magic&&!head.equals(magic))throw new Error('文件不是受支持的 perf.data 格式');
  const meta={id,name,type,size,sha256:hash.digest('hex'),timestamp:Date.now()};await writeFile(p.meta,JSON.stringify(meta),{flag:'wx',mode:0o600});complete=true;return meta;
 }finally{if(!complete)await rm(p.dir,{recursive:true,force:true});}
}
export async function getGpuArtifact(root,id){const p=paths(root,id);let meta;try{meta=JSON.parse(await readFile(p.meta,'utf8'));}catch{throw new Error('GPU 产物不存在或索引损坏');}if(!validMeta(meta,id))throw new Error('GPU 产物索引无效');return {meta,path:p.file};}
export async function listGpuArtifacts(root){let dirs;try{dirs=await readdir(root);}catch(e){if(e.code==='ENOENT')return [];throw e;}const items=await Promise.all(dirs.filter(x=>idPattern.test(x)).map(id=>getGpuArtifact(root,id).then(x=>x.meta).catch(()=>null)));return items.filter(Boolean).sort((a,b)=>b.timestamp-a.timestamp);}
export async function verifyGpuArtifact(root,id){const {meta,path}=await getGpuArtifact(root,id);const hash=createHash('sha256');let size=0;try{for await(const chunk of createReadStream(path)){size+=chunk.length;if(size>MAX)throw new Error('文件超过大小限制');hash.update(chunk);}}catch(e){if(e.code==='ENOENT')return {meta,ok:false,reason:'文件不存在'};throw e;}const sha256=hash.digest('hex');return {meta,ok:size===meta.size&&sha256===meta.sha256,actualSize:size,actualSha256:sha256,reason:size!==meta.size?'文件大小已改变':sha256!==meta.sha256?'SHA-256 不匹配':null};}
// AGI needs a filename with a supported extension; keep its private copy after
// launch because the external process may read it asynchronously.
export async function prepareAgiArtifact(root,copyRoot,id){
 const {meta,path}=await getGpuArtifact(root,id);if(meta.type!=='agi-frame')throw new Error('只能将 AGI 帧捕获交给 AGI');
 await mkdir(copyRoot,{recursive:true,mode:0o700});const dir=await mkdtemp(join(copyRoot,'capture-')),target=join(dir,'capture.gfxtrace');let complete=false;
 try{
  const hash=createHash('sha256');let size=0;
  const inspect=new Transform({transform(chunk,_encoding,callback){size+=chunk.length;if(size>MAX)return callback(new Error('产物超过大小限制'));hash.update(chunk);callback(null,chunk);}});
  await pipeline(createReadStream(path),inspect,createWriteStream(target,{flags:'wx',mode:0o600}));
  if(size!==meta.size||hash.digest('hex')!==meta.sha256)throw new Error('产物完整性校验失败');
  complete=true;return {meta,path:target};
 }finally{if(!complete)await rm(dir,{recursive:true,force:true});}
}
