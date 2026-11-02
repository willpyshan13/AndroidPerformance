import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {access,readFile,stat} from 'node:fs/promises';
import {delimiter,join,resolve,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {validateTarget} from './adb.js';

const exec=promisify(execFile),root=dirname(dirname(fileURLToPath(import.meta.url)));
const MAX_DUMP_BYTES=32*1024*1024,MAX_TOKEN_LENGTH=8192,TIMEOUT=180000;

export async function resolveComposeInspectorResources({inspectorDir=join(root,'tools','ui-inspector'),javaPath=null}={}){
  let manifest;
  try{manifest=JSON.parse(await readFile(join(inspectorDir,'classpath.json'),'utf8'));}catch{return {available:false,reason:'完整 Compose Inspector 资源未准备。',inspectorDir};}
  if(!Array.isArray(manifest)||manifest.length<1||manifest.length>100)return {available:false,reason:'Compose Inspector classpath 清单无效。',inspectorDir};
  const jars=[];
  for(const item of manifest){
    if(!item||typeof item.file!=='string'||!/^lib\/[\w.+-]+\.jar$/.test(item.file)||!Number.isSafeInteger(item.size)||item.size<1||!/^([a-f\d]{64})$/.test(item.sha256))return {available:false,reason:'Compose Inspector classpath 项无效。',inspectorDir};
    const file=resolve(inspectorDir,item.file),base=resolve(inspectorDir);if(!file.startsWith(`${base}/`)&&!file.startsWith(`${base}\\`))return {available:false,reason:'Compose Inspector classpath 路径无效。',inspectorDir};
    try{const details=await stat(file);if(!details.isFile()||details.size!==item.size)return {available:false,reason:`Compose Inspector 资源缺失或已损坏：${item.file}`,inspectorDir};const bytes=await readFile(file);if(createHash('sha256').update(bytes).digest('hex')!==item.sha256)return {available:false,reason:`Compose Inspector 资源校验失败：${item.file}`,inspectorDir};await access(file);}catch{return {available:false,reason:`Compose Inspector 资源缺失：${item.file}`,inspectorDir};}
    jars.push(file);
  }
  const java=javaPath||process.env.JAVA_HOME&&join(process.env.JAVA_HOME,'bin',process.platform==='win32'?'java.exe':'java')||'java';
  return {available:true,inspectorDir,classpath:jars.join(delimiter),javaPath:java,version:'Android Studio UI Inspector · AOSP'};
}

export async function captureComposeInspector(adb,resources,serial,packageName,{continuationToken=null,includeResolutionStack=false,runner=exec}={}){
  if(!resources?.available)throw new Error(resources?.reason||'完整 Compose Inspector 资源不可用');
  validateTarget(serial,packageName);
  if(continuationToken!==null&&(typeof continuationToken!=='string'||continuationToken.length<1||continuationToken.length>MAX_TOKEN_LENGTH||/[\r\n\0]/.test(continuationToken)))throw new Error('Compose 参数续读令牌无效');
  return adb.exclusive(serial,async()=>{
    const device=await adb.info(serial),api=Number(device.api);
    if(!Number.isInteger(api)||api<29)throw new Error(`完整 Compose Inspector 需要 Android 10（API 29）或更高版本；当前设备 API ${Number.isInteger(api)?api:'未知'}，本次未向设备注入检查器。`);
    const facets=['attributes','semantics','system-composables'];if(includeResolutionStack===true)facets.push('resolution-stack');
    const args=continuationToken===null
      ?['dump-ui','--device',serial,'--package',packageName,'--include',facets.join(',')]
      :['get-parameter','--device',serial,'--package',packageName,'--continuation-token',continuationToken];
    const sdkRoot=adb.path&&isAbsolute(adb.path)?resolve(adb.path,'..','..'):null;
    const env={...process.env,...(sdkRoot?{ANDROID_HOME:sdkRoot,ANDROID_SDK_ROOT:sdkRoot}: {})};
    let stdout='';
    try{
      ({stdout}=await runner(resources.javaPath,['-cp',resources.classpath,'com.android.tools.ui.inspector.CliHostKt',...args],{cwd:resources.inspectorDir,env,timeout:TIMEOUT,maxBuffer:MAX_DUMP_BYTES,windowsHide:true,encoding:'utf8'}));
    }catch(error){
      if(error.code==='ENOENT')throw new Error(`找不到 Java runtime：${resources.javaPath}`);
      const detail=String(error.stderr||error.stdout||error.message).trim();
      throw new Error((error.killed?'Compose Inspector 采集超时：':'Compose Inspector 执行失败：')+detail.slice(-1800));
    }
    if(Buffer.byteLength(stdout,'utf8')>MAX_DUMP_BYTES)throw new Error('Compose Inspector 结果超过 32 MiB 限制');
    let result;try{result=JSON.parse(stdout);}catch{throw new Error('Compose Inspector 未返回有效 JSON');}
    let screenshot=null,imageSize=null,screenshotWarning=null;
    if(continuationToken===null){
      try{const png=await adb.run(['-s',serial,'exec-out','screencap','-p'],{encoding:'buffer',timeout:20000,maxBuffer:16*1024*1024});if(!Buffer.isBuffer(png)||png.length<24||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new Error('设备未返回有效 PNG');imageSize={width:png.readUInt32BE(16),height:png.readUInt32BE(20)};screenshot=png.toString('base64');}catch(error){screenshotWarning=`截图不可用：${error.message}`;}
    }
    return {source:'compose-inspector',serial,packageName,api,timestamp:Date.now(),dump:result,screenshot,imageSize,screenshotWarning,continuation:Boolean(continuationToken),includeResolutionStack:continuationToken===null&&includeResolutionStack,note:'完整运行时 View/Compose 检查；参数值可能包含应用展示的数据，仅保留在本机。资源解析栈按需读取，首次使用可能修改 debug_view_attributes_application_package 并重启目标 Activity。截图在检查器响应后采集，动画或转场期间边界可能轻微错位。'};
  });
}
