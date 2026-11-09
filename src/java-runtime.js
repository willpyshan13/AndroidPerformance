import {access,mkdir,realpath,rename,rm,stat} from 'node:fs/promises';
import {dirname,join,isAbsolute} from 'node:path';
import {homedir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tarExecutable} from './host-tools.js';

const run=promisify(execFile);

export async function resolveGradleJavaPath({fallbackJavaPath,env=process.env,platform=process.platform,home=homedir(),javaHomeResolver=async()=>{const {stdout}=await run('/usr/libexec/java_home',['-v','17'],{timeout:3000,maxBuffer:4096});return stdout.trim();}}={}){
 const candidates=[];
 if(platform==='darwin'){
  try{const javaHome=await javaHomeResolver();if(javaHome)candidates.push(javaHome);}catch{}
 }
 if(typeof env.JAVA_HOME==='string'&&env.JAVA_HOME)candidates.push(env.JAVA_HOME);
 if(platform==='darwin'){
  candidates.push(join(home,'Applications','Android Studio.app','Contents','jbr','Contents','Home'),'/Applications/Android Studio.app/Contents/jbr/Contents/Home');
 }
 if(platform==='win32'){
  candidates.push(join(env.ProgramFiles||'C:\\Program Files','Android','Android Studio','jbr'),join(env.LOCALAPPDATA||join(home,'AppData','Local'),'Programs','Android Studio','jbr'));
 }
 for(const candidate of [...new Set(candidates)]){
  const java=join(candidate,'bin',platform==='win32'?'java.exe':'java'),javac=join(candidate,'bin',platform==='win32'?'javac.exe':'javac');
  try{if((await stat(java)).isFile()&&(await stat(javac)).isFile()){await access(java);await access(javac);return java;}}catch{}
 }
 return fallbackJavaPath;
}

export async function ensureWindowsJavaRuntime(archive,destination,{runner=run,tar=tarExecutable()}={}){
 const executable=join(destination,'bin','java.exe');
 try{if((await stat(executable)).isFile())return destination;}catch{}
 const archivePath=await realpath(archive);
 const listing=await runner(tar,['-tzf',archivePath],{timeout:30000,maxBuffer:4*1024*1024});
 for(const entry of listing.stdout.split(/\r?\n/).filter(Boolean)){
  const normalized=entry.replaceAll('\\','/').replace(/^\.\//,'');
  if(isAbsolute(entry)||normalized.split('/').some(part=>part==='..')||normalized.includes(':'))throw new Error('Java runtime 归档包含无效路径');
 }
 const stage=`${destination}.extracting-${process.pid}`;
 await mkdir(dirname(destination),{recursive:true});
 await rm(stage,{recursive:true,force:true});
 await mkdir(stage,{recursive:true});
 try{
  await runner(tar,['-xzf',archivePath,'-C',stage],{timeout:180000,maxBuffer:4*1024*1024});
  if(!(await stat(join(stage,'bin','java.exe'))).isFile())throw new Error('Java runtime 归档缺少 bin/java.exe');
  await rm(destination,{recursive:true,force:true});await rename(stage,destination);return destination;
 }catch(error){await rm(stage,{recursive:true,force:true});throw new Error(`解压内置 Java runtime 失败：${error.message}`);}
}
