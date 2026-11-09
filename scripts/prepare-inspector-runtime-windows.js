import {access,cp,mkdir,readFile,rename,rm,stat,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const root=dirname(dirname(fileURLToPath(import.meta.url))),tools=join(root,'tools');
const stage=join(tools,`.java25-runtime-${process.pid}`),dest=join(tools,'java25-runtime'),run=promisify(execFile);
const candidates=[process.env.APW_INSPECTOR_JAVA_HOME,process.env.JAVA_HOME_25_X64,process.env.JAVA_HOME,process.env.ANDROID_STUDIO_JDK].filter(Boolean);
let javaHome=null,versionOutput='',sourceName='JAVA_HOME';
for(const candidate of [...new Set(candidates)]){
 const executable=join(candidate,'bin','java.exe');
 try{
  if(!(await stat(executable)).isFile())continue;
  const result=await run(executable,['-version'],{timeout:15000,maxBuffer:4096,encoding:'utf8',windowsHide:true});
  const output=`${result.stdout}\n${result.stderr}`;
  if(!/version "25(?:\.|\+)/.test(output))continue;
  javaHome=candidate;versionOutput=output.trim();sourceName=candidate===process.env.APW_INSPECTOR_JAVA_HOME?'APW_INSPECTOR_JAVA_HOME':candidate===process.env.JAVA_HOME_25_X64?'JAVA_HOME_25_X64':candidate===process.env.JAVA_HOME?'JAVA_HOME':'ANDROID_STUDIO_JDK';break;
 }catch{}
}
if(!javaHome)throw new Error('Compose Inspector 需要 Java 25。请安装 Temurin JDK 25，或设置 JAVA_HOME_25_X64 / APW_INSPECTOR_JAVA_HOME 后重新运行。');
const java=join(javaHome,'bin','java.exe');
await mkdir(tools,{recursive:true});await rm(stage,{recursive:true,force:true});await mkdir(stage,{recursive:true});
try{
 await cp(javaHome,stage,{recursive:true,dereference:true});
 const copied=join(stage,'bin','java.exe');await access(copied);
 const legal=await readFile(join(stage,'LICENSE'),'utf8').catch(()=>null);
 const licenseDir=join(stage,'legal');
 if(!legal&&!await stat(licenseDir).then(()=>true,()=>false))throw new Error('Java 25 安装目录缺少许可证文件');
 await writeFile(join(stage,'source.json'),JSON.stringify({project:'Eclipse Adoptium Temurin or Android Studio JBR',version:versionOutput,target:'windows/x64',source:sourceName,licenseDirectory:'legal'},null,2)+'\n');
 await writeFile(join(stage,'NOTICE.txt'),`Java 25 runtime for Windows x64, copied from ${sourceName}.\nThe upstream license and notice files are included in this directory.\n`);
 await rm(dest,{recursive:true,force:true});await rename(stage,dest);
 console.log(`Android Studio UI Inspector runtime ready: Java 25 for windows/x64 (${sourceName})`);
}finally{await rm(stage,{recursive:true,force:true});}
