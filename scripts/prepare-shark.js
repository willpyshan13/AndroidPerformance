import {createWriteStream} from 'node:fs';
import {access,cp,mkdir,mkdtemp,readFile,rename,rm,writeFile,chmod,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {pipeline} from 'node:stream/promises';
import {execFile} from 'node:child_process';
import yauzl from 'yauzl';

const version='2.14';
const javaVersion='17.0.21+9';
const asset=`https://github.com/square/leakcanary/releases/download/v${version}/shark-cli-${version}.zip`;
const expected='4a1022a4610fd6a4a1306b264f95985c4210e169e2bd4b0ad19bbdcc16d6beef';
const apacheLicenseUrl='https://www.apache.org/licenses/LICENSE-2.0.txt';
const jlineLicenseUrl='https://raw.githubusercontent.com/jline/jline2/master/LICENSE.txt';
const includedJars=['shark-cli-2.14.jar','shark-android-2.14.jar','clikt-2.3.0.jar','jline-2.14.6.jar','shark-2.14.jar','shark-graph-2.14.jar','okio-2.2.2.jar','shark-hprof-2.14.jar','shark-log-2.14.jar','kotlin-stdlib-1.3.72.jar'];
const root=dirname(dirname(fileURLToPath(import.meta.url))),tools=join(root,'tools'),tmp=await mkdtemp(join(tmpdir(),'apw-shark-'));
const archive=join(tmp,'shark-cli.zip'),runtimeArchive=join(tmp,'java-runtime.tar.gz'),stage=join(tools,`.shark-cli-${process.pid}`),runtimeStage=join(tools,`.java-runtime-${process.pid}`);
const run=promisify(execFile);
function openZip(path){return new Promise((resolve,reject)=>yauzl.open(path,{lazyEntries:true,validateEntrySizes:true},(error,zip)=>error?reject(error):resolve(zip)));}
async function extractCoreJars(){
 const zip=await openZip(archive);let entries=0,total=0;const found=new Set();
 await new Promise((resolveZip,rejectZip)=>{
  zip.once('error',rejectZip);zip.once('end',resolveZip);
  zip.on('entry',entry=>{(async()=>{
   if(++entries>200)throw new Error('Shark CLI ZIP 文件过多');
   const prefix='shark-cli-2.14/lib/',name=entry.fileName;
   if(!name.startsWith(prefix)||name.endsWith('/')){zip.readEntry();return;}
   const filename=name.slice(prefix.length);if(!includedJars.includes(filename))return zip.readEntry();
   if(filename.includes('/')||filename.includes('\\'))throw new Error('Shark CLI ZIP 路径无效');
   total+=entry.uncompressedSize;if(total>16*1024*1024)throw new Error('Shark CLI 核心依赖超过预期大小');
   const target=join(stage,'lib',filename);await mkdir(dirname(target),{recursive:true});
   const stream=await new Promise((resolveStream,rejectStream)=>zip.openReadStream(entry,(error,value)=>error?rejectStream(error):resolveStream(value)));
   await pipeline(stream,createWriteStream(target,{flags:'wx',mode:0o644}));found.add(filename);zip.readEntry();
  })().catch(rejectZip);});zip.readEntry();
 });
 const missing=includedJars.filter(name=>!found.has(name));if(missing.length)throw new Error(`Shark CLI 缺少依赖：${missing.join(', ')}`);
}
async function findJavaHome(root,depth=0){
 if(depth>5)return null;
 const executable=join(root,'bin',process.platform==='win32'?'java.exe':'java');
 try{await access(executable);return root;}catch{}
 for(const entry of await readdir(root,{withFileTypes:true}).catch(()=>[]))if(entry.isDirectory()){const found=await findJavaHome(join(root,entry.name),depth+1);if(found)return found;}
 return null;
}
async function prepareRuntime(){
 const osMap={darwin:'mac',linux:'linux'},archMap={arm64:'aarch64',x64:'x64'};
 const checksums={
  'mac/aarch64':'a5ab5bacd6e719d5a5570580ed14dceb2ed532208a39af927906b9742da1745e',
  'mac/x64':'890214eb4d6c88dc06f990d5a6a3b72b91d5dffab6a0a6d8cffb98468bf26181',
  'linux/x64':'9f41bf88c7900c7097444a1bdeb84146ae692bc08842490ab098063c74bf9a8a',
  'linux/aarch64':'1114f09d6174f54270c3117410b5e4022b43ebc0b43b751af08b927c55ed7bb5'
 };
 const target=osMap[process.platform]&&archMap[process.arch]?`${osMap[process.platform]}/${archMap[process.arch]}`:null;
 if(target&&checksums[target]){
  const url=`https://api.adoptium.net/v3/binary/version/jdk-${javaVersion.replace('+','%2B')}/${target}/jre/hotspot/normal/eclipse`;
  await run('curl',['-fsSL','--retry','2','--connect-timeout','10','--max-time','240',url,'-o',runtimeArchive],{timeout:250000});
  const actual=createHash('sha256').update(await readFile(runtimeArchive)).digest('hex');
  if(actual!==checksums[target])throw new Error(`Temurin JRE SHA-256 不匹配：${actual}`);
  await mkdir(runtimeStage,{recursive:true});
  await run('tar',['-xzf',runtimeArchive,'-C',runtimeStage],{timeout:120000,maxBuffer:2*1024*1024});
  const javaHome=await findJavaHome(runtimeStage);if(!javaHome)throw new Error('Temurin JRE 压缩包中找不到 Java runtime');
  const packed=join(runtimeStage,'packed');await rename(javaHome,packed);
  for(const entry of await readdir(runtimeStage))if(entry!=='packed')await rm(join(runtimeStage,entry),{recursive:true,force:true});
  const contents=await readdir(packed);for(const entry of contents)await rename(join(packed,entry),join(runtimeStage,entry));await rm(packed,{recursive:true,force:true});
  return `Temurin ${javaVersion} ${target}`;
 }
 let javaHome=process.env.JAVA_HOME;
 if(!javaHome){const {stdout,stderr}=await run('java',['-XshowSettings:properties','-version'],{timeout:10000,maxBuffer:1024*1024}).catch(error=>({stdout:error.stdout||'',stderr:error.stderr||''}));const match=`${stdout}\n${stderr}`.match(/java\.home\s*=\s*(.+)/);if(match)javaHome=match[1].trim();}
 if(!javaHome)throw new Error(`当前平台 ${process.platform}/${process.arch} 无内置 Temurin 下载配置；请设置 JAVA_HOME 指向 JDK/JRE 17+`);
 const java=join(javaHome,'bin',process.platform==='win32'?'java.exe':'java');
 try{await access(java);}catch{throw new Error(`找不到 Java runtime：${java}`);}
 await cp(javaHome,runtimeStage,{recursive:true,dereference:true});
 return `本机 Java runtime (${javaHome})`;
}
try{
 await mkdir(tools,{recursive:true});
 await run('curl',['-fsSL','--retry','2','--connect-timeout','10','--max-time','180',asset,'-o',archive],{timeout:190000});
 const actual=createHash('sha256').update(await readFile(archive)).digest('hex');if(actual!==expected)throw new Error(`Shark CLI ZIP SHA-256 不匹配：${actual}`);
 await mkdir(stage,{recursive:true});await extractCoreJars();
 await mkdir(join(stage,'licenses'),{recursive:true});
 await run('curl',['-fsSL','--max-time','30',apacheLicenseUrl,'-o',join(stage,'licenses','Apache-2.0.txt')],{timeout:40000});
 await run('curl',['-fsSL','--max-time','30',jlineLicenseUrl,'-o',join(stage,'licenses','BSD-2-Clause-JLine.txt')],{timeout:40000});
 const apache=await readFile(join(stage,'licenses','Apache-2.0.txt'),'utf8'),bsd=await readFile(join(stage,'licenses','BSD-2-Clause-JLine.txt'),'utf8');
 if(!apache.includes('Apache License')||!apache.includes('Version 2.0')||!bsd.includes('Redistribution and use in source and binary forms'))throw new Error('Shark CLI 许可证校验失败');
 await writeFile(join(stage,'NOTICE.txt'),'Shark CLI and Shark Android libraries are Copyright 2015 Square, Inc. and licensed under Apache-2.0.\nIncluded Kotlin standard library, Okio, and Clikt use Apache-2.0. JLine 2.14.6 is distributed under BSD-2-Clause. Full license texts are in licenses/.\n');
 await writeFile(join(stage,'source.json'),JSON.stringify({project:'square/leakcanary',version,asset,sha256:expected,includedJars,licenses:{apache:apacheLicenseUrl,jline:jlineLicenseUrl}},null,2)+'\n');
 const runtimeDescription=await prepareRuntime();
 await rm(join(runtimeStage,'lib','server','classes.jsa'),{force:true});
 await rm(join(runtimeStage,'lib','server','classes_nocoops.jsa'),{force:true});
 const dest=join(tools,'shark-cli'),runtimeDest=join(tools,'java-runtime');await rm(dest,{recursive:true,force:true});await rm(runtimeDest,{recursive:true,force:true});
 await rename(stage,dest);await rename(runtimeStage,runtimeDest);
 const java=join(runtimeDest,'bin',process.platform==='win32'?'java.exe':'java');await chmod(java,0o755).catch(()=>{});
 console.log(`Shark CLI ${version} 与 ${runtimeDescription} 已准备；核心 JAR ${includedJars.length} 个，归档 SHA-256 ${expected}`);
}finally{await rm(tmp,{recursive:true,force:true});await rm(stage,{recursive:true,force:true});await rm(runtimeStage,{recursive:true,force:true});}
