import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join,dirname,extname} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createSourceSnapshot} from './source-workspace.js';
const exec=promisify(execFile),MAX_FILES=5000,MAX_FILE=512*1024,MAX_TOTAL=32*1024*1024;
const allowed=new Set(['.kt','.kts','.java','.xml','.gradle','.c','.cc','.cpp','.h','.hpp','.aidl','.rs','.proto','.properties','.toml']);
const excluded=new Set(['.git','.gradle','.idea','node_modules','build','dist','out','.cxx']);
export function validateRemoteSource(url,ref=''){
 if(typeof url!=='string'||url.length>1000)throw new Error('仓库地址无效');let parsed;try{parsed=new URL(url);}catch{throw new Error('仓库地址无效');}
 if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port||parsed.search||parsed.hash||!['github.com','android.googlesource.com'].includes(parsed.hostname))throw new Error('仅支持 GitHub 或 android.googlesource.com 的 HTTPS 仓库地址');
 const path=parsed.pathname;if(!/^\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\/?$/.test(path)||path.split('/').some(x=>x==='.'||x==='..')||(parsed.hostname==='github.com'&&path.replace(/\/$/,'').split('/').length!==3))throw new Error('仓库路径无效');
 if(typeof ref!=='string'||ref.length>200||(ref&&(!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref)||ref.includes('..')||ref.includes('//')||ref.endsWith('/')||ref.split('/').some(x=>x.endsWith('.lock')||x.startsWith('.')))))throw new Error('分支或标签名称无效');
 return {url:parsed.toString().replace(/\/$/,''),ref,kind:parsed.hostname==='github.com'?'github':'aosp'};
}
const gitEnv=()=>({...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_'))),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_LFS_SKIP_SMUDGE:'1'});
const baseArgs=['-c','core.hooksPath=/dev/null','-c','protocol.file.allow=never','-c','protocol.ext.allow=never','-c','http.followRedirects=false'];
async function defaultRun(args,{cwd,encoding='utf8',maxBuffer=20*1024*1024}={}){return exec('git',[...baseArgs,...args],{cwd,encoding,maxBuffer,timeout:120000,env:gitEnv(),windowsHide:true});}
async function defaultBatch(cwd,entries){
 return new Promise((resolve,reject)=>{
  const child=spawn('git',[...baseArgs,'cat-file','--batch'],{cwd,env:gitEnv(),windowsHide:true,stdio:['pipe','pipe','pipe']});const chunks=[];let size=0,err='',settled=false;
  const timer=setTimeout(()=>{child.kill();finish(new Error('读取 Git 对象超时'));},120000);
  function finish(error,data){if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(data);}
  child.on('error',error=>finish(error));child.stdin.on('error',()=>{});child.stderr.on('data',chunk=>{if(err.length<1000)err+=chunk.toString().slice(0,1000-err.length);});
  child.stdout.on('data',chunk=>{size+=chunk.length;if(size>MAX_TOTAL+2*1024*1024){child.kill();finish(new Error('Git 对象输出超过限制'));}else chunks.push(chunk);});
  child.on('close',code=>code===0?finish(null,Buffer.concat(chunks)):finish(new Error(`读取 Git 对象失败：${err||code}`)));
  child.stdin.end(entries.map(e=>e.oid).join('\n')+'\n');
 });
}
export function parseGitTree(text){
 const entries=[];let total=0,skipped=0,truncated=false;const reasons=[];
 for(const record of text.split('\0')){if(!record)continue;const tab=record.indexOf('\t');if(tab<0)throw new Error('Git 文件索引格式无效');const metadata=record.slice(0,tab).trim().split(/\s+/),path=record.slice(tab+1),[mode,type,oid,sizeText]=metadata;
  if(!/^(100644|100755)$/.test(mode)||type!=='blob'||!/^[a-f0-9]{40,64}$/.test(oid))continue;
  if(!path||path.length>4096||path.startsWith('/')||path.includes('\\')||path.split('/').some(p=>!p||p==='.'||p==='..'||excluded.has(p))||!allowed.has(extname(path).toLowerCase()))continue;
  if(!/^\d+$/.test(sizeText))throw new Error('Git 对象大小无效');const size=Number(sizeText);if(!Number.isSafeInteger(size)||size>MAX_FILE){skipped++;continue;}
  if(entries.length>=MAX_FILES||total+size>MAX_TOTAL){truncated=true;reasons.push(entries.length>=MAX_FILES?'文件数量上限':'总大小上限');break;}
  entries.push({path,oid,size});total+=size;
 }
 if(!entries.length)throw new Error('仓库中没有可读取的受支持源码文件');return {entries,skipped,truncated,reasons};
}
export function parseGitBatch(data,entries){
 if(!Buffer.isBuffer(data))throw new Error('Git 对象输出无效');const blobs=[];let pos=0;
 for(const entry of entries){const end=data.indexOf(10,pos);if(end<0||end-pos>200)throw new Error('Git 对象头无效');const header=data.subarray(pos,end).toString('ascii').split(' ');if(header[0]!==entry.oid||header[1]!=='blob'||Number(header[2])!==entry.size)throw new Error('Git 对象信息不一致');pos=end+1;const next=pos+entry.size;if(next>=data.length||data[next]!==10)throw new Error('Git 对象内容被截断');const blob=data.subarray(pos,next);const digest=createHash(entry.oid.length===40?'sha1':'sha256').update(`blob ${entry.size}\0`).update(blob).digest('hex');if(digest!==entry.oid)throw new Error('Git 对象内容校验失败');blobs.push(blob);pos=next+1;}
 if(pos!==data.length)throw new Error('Git 对象输出包含额外数据');return blobs;
}
export async function createRemoteSourceSnapshot({url,ref=''},root,{run=defaultRun,batch=defaultBatch}={}){
 const remote=validateRemoteSource(url,ref),tmp=await mkdtemp(join(tmpdir(),'apw-source-git-')),repo=join(tmp,'repository'),source=join(tmp,'source');
 try{
  const pinned=/^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(ref);
  // A shallow complete object set avoids thousands of lazy network requests
  // when inspecting object sizes. The temporary clone can exceed snapshot limits.
  const clone=['clone','--no-checkout','--depth=1','--single-branch','--no-tags'];if(ref&&!pinned)clone.push('--branch',ref);clone.push('--',remote.url,repo);
  try{if(pinned){await mkdir(repo);await run(['init','--quiet'],{cwd:repo});await run(['remote','add','origin',remote.url],{cwd:repo});await run(['fetch','--depth=1','--no-tags','origin',ref],{cwd:repo});}else await run(clone);}catch(error){const detail=error.killed?'Git 操作超时，请检查网络或选择其他版本':String(error.stderr||error.message);throw new Error(`获取源码仓库失败：${detail.slice(0,1000)}`);}
  const commit=(await run(['rev-parse','--verify',pinned?'FETCH_HEAD^{commit}':'HEAD^{commit}'],{cwd:repo})).stdout.trim();if(!/^[a-f0-9]{40,64}$/.test(commit)||(pinned&&commit!==ref))throw new Error('Git 提交标识无效或与请求不一致');
  const tree=parseGitTree((await run(['ls-tree','-r','-z','-l','--full-tree',commit],{cwd:repo})).stdout);
  const blobs=parseGitBatch(await batch(repo,tree.entries),tree.entries);await mkdir(source,{mode:0o700});
  let skipped=tree.skipped;
  for(let i=0;i<tree.entries.length;i++){const {path}=tree.entries[i],content=blobs[i];if(content.subarray(0,80).toString().startsWith('version https://git-lfs.github.com/spec/v1\n')){skipped++;continue;}const dest=join(source,...path.split('/'));await mkdir(dirname(dest),{recursive:true,mode:0o700});await writeFile(dest,content,{flag:'wx',mode:0o600});}
  return await createSourceSnapshot(source,root,{origin:remote.url,ref:remote.ref||null,commit,extraSkipped:skipped,extraTruncated:tree.truncated,extraReasons:tree.reasons});
 }finally{await rm(tmp,{recursive:true,force:true});}
}
