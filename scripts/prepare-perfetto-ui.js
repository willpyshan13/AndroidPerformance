import {createWriteStream} from 'node:fs';
import {access,mkdir,mkdtemp,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {pipeline} from 'node:stream/promises';
import {execFile} from 'node:child_process';
import yauzl from 'yauzl';

const version='v59.1',asset='https://github.com/google/perfetto/releases/download/v59.1/perfetto-ui.zip';
const expected='df4433f5d8d98d2c490249870944c819ff85206f61e55e5983bbcc2338c83904';
const licenseUrl='https://raw.githubusercontent.com/google/perfetto/v59.1/LICENSE';
const root=dirname(dirname(fileURLToPath(import.meta.url))),tools=join(root,'tools'),tmp=await mkdtemp(join(tmpdir(),'apw-perfetto-ui-'));
const archive=join(tmp,'perfetto-ui.zip'),stage=join(tools,`.perfetto-ui-${process.pid}`),dest=join(tools,'perfetto-ui');
const run=promisify(execFile);
function openZip(path){return new Promise((resolve,reject)=>yauzl.open(path,{lazyEntries:true,validateEntrySizes:true},(error,zip)=>error?reject(error):resolve(zip)));}
try{
 await run('curl',['-fsSL','--max-time','180',asset,'-o',archive],{timeout:190000});
 const bytes=await readFile(archive),actual=createHash('sha256').update(bytes).digest('hex');
 if(actual!==expected)throw new Error(`Perfetto UI SHA-256 不匹配：${actual}`);
 await mkdir(stage,{recursive:true});
 const zip=await openZip(archive);let entries=0,total=0;
 await new Promise((resolveZip,rejectZip)=>{
  zip.once('error',rejectZip);zip.once('end',resolveZip);
  zip.on('entry',entry=>{(async()=>{
   if(++entries>10000)throw new Error('Perfetto UI 文件过多');
   const name=entry.fileName;if(!name||name.includes('\\')||name.startsWith('/')||name.split('/').some(part=>part==='..'||part==='')){
    if(name.endsWith('/')&&name.split('/').slice(0,-1).every(part=>part&&part!=='.'&&part!=='..')){/* directory */}
    else throw new Error('Perfetto UI ZIP 含无效路径');
   }
   const target=resolve(stage,name),rel=relative(stage,target);
   if(rel==='..'||rel.startsWith(`..${sep}`)||resolve(target)===resolve(stage))throw new Error('Perfetto UI ZIP 路径越界');
   const unixMode=(entry.externalFileAttributes>>>16)&0xf000;if(unixMode===0xa000)throw new Error('Perfetto UI ZIP 不允许符号链接');
   await mkdir(dirname(target),{recursive:true});
   if(name.endsWith('/')){zip.readEntry();return;}
   total+=entry.uncompressedSize;if(total>300*1024*1024)throw new Error('Perfetto UI 解压后超过 300 MiB');
   const stream=await new Promise((resolveStream,rejectStream)=>zip.openReadStream(entry,(error,value)=>error?rejectStream(error):resolveStream(value)));
   await pipeline(stream,createWriteStream(target,{flags:'wx',mode:0o644}));zip.readEntry();
  })().catch(rejectZip);});
  zip.readEntry();
 });
 const indexes=['index.html',...await (await import('node:fs/promises')).readdir(stage)];
 if(!indexes.includes('index.html')||!indexes.some(name=>/^v59\.1-/.test(name)))throw new Error('Perfetto UI ZIP 缺少入口或版本资源目录');
 await run('curl',['-fsSL','--max-time','30',licenseUrl,'-o',join(stage,'LICENSE')],{timeout:40000});
 await writeFile(join(stage,'source.json'),JSON.stringify({version,asset,sha256:expected},null,2)+'\n',{mode:0o644});
 try{await access(dest);await rm(dest,{recursive:true,force:true});}catch{}
 await rename(stage,dest);
 console.log(`Perfetto UI ${version}：${dest}（ZIP SHA-256 ${expected}）`);
}finally{await rm(tmp,{recursive:true,force:true});await rm(stage,{recursive:true,force:true});}
