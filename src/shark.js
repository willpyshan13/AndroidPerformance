import {access, readdir, stat} from 'node:fs/promises';
import {join, delimiter} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run=promisify(execFile);
const MAX_REPORT=12*1024*1024;
const DISPLAY_REPORT=2*1024*1024;
const TIMEOUT=150000;

export async function resolveSharkResources({sharkDir,javaPath}={}){
  const libDir=sharkDir?join(sharkDir,'lib'):null;
  const jars=libDir?await readdir(libDir).catch(()=>[]):[];
  const available=['shark-cli-2.14.jar','shark-android-2.14.jar','clikt-2.3.0.jar','jline-2.14.6.jar','shark-2.14.jar','shark-graph-2.14.jar','okio-2.2.2.jar','shark-hprof-2.14.jar','shark-log-2.14.jar','kotlin-stdlib-1.3.72.jar'].every(name=>jars.includes(name));
  return {available,sharkDir:available?sharkDir:null,classpath:available?jars.filter(name=>name.endsWith('.jar')).map(name=>join(libDir,name)).join(delimiter):null,javaPath:javaPath||'java',version:available?'2.14':null};
}

export async function analyzeWithShark(filePath,resources,{mappingPath=null}={}){
  if(!resources?.available)return {available:false,success:false,reason:'Shark 2.14 资源未准备；运行 npm run prepare:shark。',report:null};
  if(mappingPath!==null&&(typeof mappingPath!=='string'||mappingPath.length>4096))throw new Error('混淆映射路径无效');
  const info=await stat(filePath);if(!info.isFile()||info.size<=0||info.size>256*1024*1024)throw new Error('Shark 输入 HPROF 无效或超过 256 MiB');
  const args=['-cp',resources.classpath,'shark.MainKt','-h',filePath];if(mappingPath)args.push('-m',mappingPath);args.push('analyze');
  const start=Date.now();
  try{
    const {stdout,stderr}=await run(resources.javaPath,args,{cwd:tmpdir(),timeout:TIMEOUT,maxBuffer:MAX_REPORT,windowsHide:true,encoding:'utf8'});
    const report=`${stdout||''}${stderr?`\n${stderr}`:''}`;
    return {available:true,success:report.includes('HEAP ANALYSIS RESULT')&&!report.includes('HEAP ANALYSIS FAILED'),version:resources.version,durationMs:Date.now()-start,report:report.slice(0,DISPLAY_REPORT),reportTruncated:report.length>DISPLAY_REPORT};
  }catch(error){
    if(error.code==='ENOENT')return {available:false,success:false,reason:`未找到 Java runtime：${resources.javaPath}`,report:null};
    const report=`${error.stdout||''}${error.stderr?`\n${error.stderr}`:''}`.slice(0,MAX_REPORT);
    return {available:true,success:report.includes('HEAP ANALYSIS RESULT')&&!report.includes('HEAP ANALYSIS FAILED'),version:resources.version,durationMs:Date.now()-start,exitCode:Number.isInteger(error.code)?error.code:null,reason:error.killed?'Shark 分析超时':'Shark 分析进程返回错误',report:report.slice(0,DISPLAY_REPORT),reportTruncated:report.length>DISPLAY_REPORT};
  }
}
