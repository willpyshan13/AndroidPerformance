import {constants} from 'node:fs';
import {lstat, mkdir, open, readFile, readdir, realpath, rm, writeFile} from 'node:fs/promises';
import {basename, extname, isAbsolute, join, relative, sep} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {parseSourceSymbol,findSourceDeclarations} from './source-symbols.js';

const idPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const digestPattern=/^[a-f0-9]{64}$/;
const extensions=new Set(['.kt','.kts','.java','.xml','.gradle','.c','.cc','.cpp','.h','.hpp','.aidl','.rs','.proto','.properties','.toml']);
const excluded=new Set(['.git','.gradle','.idea','node_modules','build','dist','out','.cxx']);
const maxFiles=5000,maxFile=512*1024,maxTotal=32*1024*1024,maxEntries=50000;
const sha=buffer=>createHash('sha256').update(buffer).digest('hex');
const inside=(root,path)=>path===root||path.startsWith(root+sep);
const snapshotPath=(root,id)=>{if(!idPattern.test(id||''))throw new Error('源码快照标识无效');return join(root,id);};
function validSnapshot(meta,id){
 if(!meta||meta.id!==id||typeof meta.name!=='string'||typeof meta.sourceRoot!=='string'||!isAbsolute(meta.sourceRoot)||!Number.isSafeInteger(meta.timestamp)||!Number.isSafeInteger(meta.skipped)||meta.skipped<0||typeof meta.truncated!=='boolean'||!Array.isArray(meta.reasons)||!meta.reasons.every(x=>typeof x==='string')||!Array.isArray(meta.files)||meta.files.length>maxFiles)return false;
 if(meta.origin!==undefined&&meta.origin!==null){try{const url=new URL(meta.origin);if(url.protocol!=='https:'||!['github.com','android.googlesource.com'].includes(url.hostname)||url.username||url.password||url.search||url.hash||!/^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(meta.commit||''))return false;}catch{return false;}}
 const paths=new Set();let total=0;
 for(const f of meta.files){if(!f||typeof f.path!=='string'||!f.path||f.path.length>4096||f.path.startsWith('/')||f.path.split('/').some(x=>x==='..'||x==='.'||x==='')||!digestPattern.test(f.sha256)||!Number.isSafeInteger(f.size)||f.size<0||f.size>maxFile||paths.has(f.path))return false;paths.add(f.path);total+=f.size;}
 return meta.totalBytes===total&&total<=maxTotal;
}
export async function createSourceSnapshot(source,root,{origin=null,commit=null,ref=null,extraSkipped=0,extraTruncated=false,extraReasons=[]}={}){
 if(typeof source!=='string'||!isAbsolute(source)||source.length>4096)throw new Error('请选择本机绝对目录路径');
 const sourceRoot=await realpath(source);if(!(await lstat(sourceRoot)).isDirectory())throw new Error('源码路径不是目录');
 await mkdir(root,{recursive:true,mode:0o700});const storage=await realpath(root),id=randomUUID(),dir=snapshotPath(root,id);await mkdir(dir,{mode:0o700});await mkdir(join(dir,'blobs'),{mode:0o700});
 const files=[],pending=[sourceRoot],decoder=new TextDecoder('utf-8',{fatal:true});let total=0,visited=0,skipped=0,truncated=false;const reasons=new Set();let committed=false;
 try{
  while(pending.length){const directory=pending.pop();let entries;try{const real=await realpath(directory);if(!inside(sourceRoot,real)||inside(storage,real)){skipped++;continue;}entries=await readdir(real,{withFileTypes:true});}catch{skipped++;continue;}
   entries.sort((a,b)=>a.name.localeCompare(b.name));
   for(const entry of entries){if(++visited>maxEntries){truncated=true;reasons.add('扫描项数上限');break;}
    if(entry.isSymbolicLink()){skipped++;continue;}const path=join(directory,entry.name);
    if(entry.isDirectory()){if(!excluded.has(entry.name))pending.push(path);continue;}
    if(!entry.isFile()||!extensions.has(extname(entry.name).toLowerCase()))continue;
    if(files.length>=maxFiles){truncated=true;reasons.add('文件数量上限');break;}
    let handle,writing=false;try{
      const real=await realpath(path);if(!inside(sourceRoot,real)||inside(storage,real)){skipped++;continue;}
      handle=await open(real,constants.O_RDONLY|(constants.O_NOFOLLOW||0));const before=await handle.stat();if(!before.isFile()||before.size>maxFile){skipped++;continue;}
      if(total+before.size>maxTotal){truncated=true;reasons.add('总大小上限');break;}
      const content=await handle.readFile(),after=await handle.stat();if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||content.length!==before.size||content.includes(0)){skipped++;continue;}decoder.decode(content);
      const rel=relative(sourceRoot,real).split(sep).join('/');if(!rel||rel.startsWith('../')||rel.length>4096){skipped++;continue;}
      const digest=sha(content);writing=true;try{await writeFile(join(dir,'blobs',digest),content,{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}writing=false;
      files.push({path:rel,size:content.length,sha256:digest});total+=content.length;
    }catch(error){if(writing||error.code==='ENOSPC'||error.code==='EDQUOT')throw error;skipped++;}finally{await handle?.close();}
   }
   if(truncated)break;
  }
  if(!files.length)throw new Error('目录中没有可读取的受支持源码文件');
  files.sort((a,b)=>a.path.localeCompare(b.path));const meta={id,name:origin?new URL(origin).pathname.split('/').filter(Boolean).at(-1).replace(/\.git$/,''):basename(sourceRoot),timestamp:Date.now(),sourceRoot,origin,commit,ref,files,totalBytes:total,skipped:skipped+extraSkipped,truncated:truncated||extraTruncated,reasons:[...new Set([...reasons,...extraReasons])]};
  await writeFile(join(dir,'metadata.json'),JSON.stringify(meta),{flag:'wx',mode:0o600});committed=true;return meta;
 }finally{if(!committed)await rm(dir,{recursive:true,force:true});}
}
export async function getSourceSnapshot(root,id){let meta;try{meta=JSON.parse(await readFile(join(snapshotPath(root,id),'metadata.json'),'utf8'));}catch{throw new Error('源码快照不存在或索引损坏');}if(!validSnapshot(meta,id))throw new Error('源码快照索引无效');return meta;}
export async function listSourceSnapshots(root){let names;try{names=await readdir(root);}catch(e){if(e.code==='ENOENT')return [];throw e;}const all=await Promise.all(names.filter(x=>idPattern.test(x)).map(id=>getSourceSnapshot(root,id).catch(()=>null)));return all.filter(Boolean).map(({files,...s})=>({...s,fileCount:files.length})).sort((a,b)=>b.timestamp-a.timestamp);}
async function readIndexedFile(root,id,entry){const buffer=await readFile(join(snapshotPath(root,id),'blobs',entry.sha256));if(buffer.length!==entry.size||sha(buffer)!==entry.sha256)throw new Error('源码快照文件校验失败');return {path:entry.path,sha256:entry.sha256,text:new TextDecoder('utf-8',{fatal:true}).decode(buffer)};}
export async function readSourceFile(root,id,path){const meta=await getSourceSnapshot(root,id),entry=meta.files.find(f=>f.path===path);if(!entry)throw new Error('快照中没有该文件');return readIndexedFile(root,id,entry);}
export async function searchSource(root,id,query){
 if(typeof query!=='string'||!query.trim()||query.length>200)throw new Error('请输入不超过 200 字符的搜索词');
 const needle=query.trim().toLocaleLowerCase(),meta=await getSourceSnapshot(root,id),matches=[];let truncated=false;
 for(const file of meta.files){const fileResult=await readIndexedFile(root,id,file),lines=fileResult.text.split(/\r?\n/);let found=false;
  for(let i=0;i<lines.length;i++){if(lines[i].toLocaleLowerCase().includes(needle)){if(matches.length===200){truncated=true;break;}matches.push({path:file.path,line:i+1,preview:lines[i].slice(0,300)});found=true;}}
  if(truncated)break;if(!found&&file.path.toLocaleLowerCase().includes(needle)){if(matches.length===200){truncated=true;break;}matches.push({path:file.path,line:null,preview:'文件名匹配'});}
 }
 return {matches,truncated};
}
export async function resolveSourceSymbol(root,id,symbol){
 const parsed=parseSourceSymbol(symbol),meta=await getSourceSnapshot(root,id),matches=[];let total=0;
 for(const file of meta.files){
  if(!['.java','.kt','.kts'].includes(extname(file.path).toLowerCase()))continue;
  const content=await readIndexedFile(root,id,file);
  const found=findSourceDeclarations(content.text,file.path,parsed);total+=found.length;
  matches.push(...found);matches.sort((a,b)=>b.score-a.score||a.path.localeCompare(b.path)||a.line-b.line);matches.length=Math.min(matches.length,200);
 }
 matches.sort((a,b)=>b.score-a.score||a.path.localeCompare(b.path)||a.line-b.line);
 return {matches,truncated:total>200,snapshotTruncated:meta.truncated,mode:'resolve'};
}
