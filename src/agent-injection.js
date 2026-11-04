import {copyFile,mkdir,lstat,readdir,readFile,realpath,rename,unlink,writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const agentRoot=join(dirname(fileURLToPath(import.meta.url)),'..','android-agent');
const agentSources=[
 ['src/main/java/dev/androidperformance/agent/ApwLifecycleLeakAgent.java','src/debug/java/dev/androidperformance/agent/ApwLifecycleLeakAgent.java'],
 ['src/main/java/dev/androidperformance/agent/ApwLeakCanaryAgentProvider.java','src/debug/java/dev/androidperformance/agent/ApwLeakCanaryAgentProvider.java'],
];
const fragmentSource=['optional-androidx/src/debug/java/dev/androidperformance/agent/ApwAndroidXFragmentLeakAgent.java','src/debug/java/dev/androidperformance/agent/ApwAndroidXFragmentLeakAgent.java'];
const jankStatsSource=['optional-jankstats/src/debug/java/dev/androidperformance/agent/ApwJankStatsAgent.java','src/debug/java/dev/androidperformance/agent/ApwJankStatsAgent.java'];
const manifestSource=join(agentRoot,'src/debug/AndroidManifest.xml');
const ignoredDirs=new Set(['.git','.gradle','build','node_modules','.idea']);

function inside(root,path){const rel=relative(root,path);return rel===''||(!isAbsolute(rel)&&!rel.startsWith(`..${sep}`)&&rel!=='..');}
async function isFile(path){try{return (await lstat(path)).isFile();}catch{return false;}}
async function findAndroidModules(root){
 const found=[],applications=[],queue=[{path:root,depth:0}];let visited=0;
 while(queue.length&&visited++<5000){const {path,depth}=queue.shift();if(await isFile(join(path,'src','main','AndroidManifest.xml'))){found.push(path);let scripts='';for(const name of ['build.gradle','build.gradle.kts'])try{scripts+=`\n${await readFile(join(path,name),'utf8')}`;}catch{}scripts=scripts.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|\s)\/\/.*$/gm,'');if(/com\.android\.application|libs\.plugins\.[\w.-]*application|(?:id|apply\s+plugin)\s*\(?\s*['"][\w.-]*application/i.test(scripts))applications.push(path);}if(depth>=5)continue;let entries;try{entries=await readdir(path,{withFileTypes:true});}catch{continue;}for(const entry of entries){if(entry.isDirectory()&&!entry.isSymbolicLink()&&!ignoredDirs.has(entry.name))queue.push({path:join(path,entry.name),depth:depth+1});}}
 return applications.length?applications:found;
}
function mergeDebugManifest(existing,template){
 if(existing===null)return template;
 if(!/<manifest\b[^>]*>[\s\S]*<\/manifest\s*>/i.test(existing)||!/<application\b[^>]*(?:\/\s*>|>[\s\S]*?<\/application\s*>)/i.test(existing))throw new Error('现有 debug AndroidManifest.xml 结构无效，未修改工程');
 const providerName='dev.androidperformance.agent.ApwLeakCanaryAgentProvider',providerPattern=/<provider\b[^>]*>[\s\S]*?<\/provider\s*>|<provider\b[^>]*\/\s*>/gi;
 for(const match of existing.matchAll(providerPattern)){const block=match[0];if(new RegExp(`android:name\\s*=\\s*["']${providerName.replaceAll('.','\\.')}["']`).test(block)){if(block.includes('${applicationId}.apw-leakcanary-agent')&&/android:initOrder\s*=\s*["']100["']/.test(block)&&/android:exported\s*=\s*["']false["']/.test(block))return existing;throw new Error('debug Manifest 中已有不同配置的生命周期 Agent Provider，未修改工程');}}
 const snippet='        <provider android:name="dev.androidperformance.agent.ApwLeakCanaryAgentProvider" android:authorities="${applicationId}.apw-leakcanary-agent" android:exported="false" android:initOrder="100" />\n';
 let result=existing;
 const applicationOpen=/<application\b[^>]*>/i,applicationMatch=result.match(applicationOpen);
 if(applicationMatch&&!/\/\s*>$/.test(applicationMatch[0]))result=result.replace(applicationOpen,open=>`${open}\n${snippet.trimEnd()}`);
 else result=result.replace(/<application\b([^>]*)\/\s*>/i,(_tag,attributes)=>`<application${attributes}>\n${snippet.trimEnd()}\n    </application>`);
 if(!/xmlns:android\s*=/.test(result))result=result.replace(/<manifest\b/i,tag=>`${tag} xmlns:android="http://schemas.android.com/apk/res/android"`);
 return result;
}
async function ensureSafeDirectory(root,path){
 if(!inside(root,path))throw new Error('注入路径超出所选 Android 工程');
 const rel=relative(root,path),parts=rel?rel.split(sep):[];let current=root;
 for(const part of parts){current=join(current,part);try{const stat=await lstat(current);if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error(`注入目录包含符号链接或非目录：${current}`);}catch(error){if(error.code!=='ENOENT')throw error;await mkdir(current);}}
}

/** Copy lifecycle Agent sources into a selected Android app module's debug source set. */
export async function injectLeakCanaryDebugAgent({projectPath,modulePath=null,includeAndroidXFragments=false,includeJankStats=false}){
 if(typeof projectPath!=='string'||!projectPath.trim()||projectPath.length>4096)throw new Error('请选择有效的 Android 工程目录');
 if(typeof includeAndroidXFragments!=='boolean')throw new Error('Fragment 注入选项无效');
 if(typeof includeJankStats!=='boolean')throw new Error('JankStats 注入选项无效');
 let root;try{root=await realpath(projectPath);}catch{throw new Error('Android 工程目录不存在或不可访问');}
 const rootStat=await lstat(root);if(!rootStat.isDirectory())throw new Error('Android 工程路径不是目录');
 const modules=await findAndroidModules(root);let module;
 if(modulePath!==null&&modulePath!==undefined&&modulePath!==''){
  if(typeof modulePath!=='string'||modulePath.length>4096)throw new Error('App module 路径无效');
  let candidate;try{candidate=await realpath(resolve(root,modulePath));}catch{throw new Error('所选 App module 不存在');}
  if(!inside(root,candidate)||!modules.includes(candidate))throw new Error('所选目录不是该工程中的 Android app module');module=candidate;
 }else if(modules.length===1)module=modules[0];
 else if(modules.length===0)throw new Error('没有找到包含 src/main/AndroidManifest.xml 的 Android app module');
 else {const choices=modules.map(path=>relative(root,path)||'.');throw Object.assign(new Error(`工程包含多个 Android app module，请将目录选择器定位到其中一个 app 模块目录：${choices.join('、')}`),{modules:choices});}

 const files=[...agentSources,...(includeAndroidXFragments?[fragmentSource]:[]),...(includeJankStats?[jankStatsSource]:[])];
 const plans=[];
 for(const [source,destination] of files){const path=join(module,destination),data=await readFile(join(agentRoot,source));let existing=null;try{existing=await readFile(path);}catch(error){if(error.code!=='ENOENT')throw error;}if(existing&&!existing.equals(data))throw new Error(`目标文件已存在且内容不同，未修改工程：${relative(module,path)}`);plans.push({path,data,existing,kind:'source'});}
 const manifestPath=join(module,'src/debug/AndroidManifest.xml');let previousManifest=null;try{previousManifest=await readFile(manifestPath,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
 const template=await readFile(manifestSource,'utf8'),merged=mergeDebugManifest(previousManifest,template),manifestData=Buffer.from(merged);
 plans.push({path:manifestPath,data:manifestData,existing:previousManifest===null?null:Buffer.from(previousManifest),kind:'manifest'});
 const changes=plans.filter(plan=>!plan.existing||!plan.existing.equals(plan.data)),unchanged=plans.length-changes.length;
 if(changes.length===0)return {projectPath:root,modulePath:module,changed:[],unchanged:plans.map(plan=>relative(module,plan.path)),backups:[],includeAndroidXFragments,includeJankStats};

 const created=[],backups=[],temps=[];
 try{
  for(const plan of changes){await ensureSafeDirectory(module,dirname(plan.path));const current=await lstat(plan.path).catch(error=>error.code==='ENOENT'?null:Promise.reject(error));if(current?.isSymbolicLink()||current&&!current.isFile())throw new Error(`目标文件不是普通文件：${relative(module,plan.path)}`);if(plan.existing&&plan.kind==='manifest'){const backup=`${plan.path}.apw-backup-${randomUUID()}`;await copyFile(plan.path,backup,constants.COPYFILE_EXCL);backups.push(backup);}}
  for(const plan of changes){if(!plan.existing)created.push(plan.path);const temp=`${plan.path}.apw-tmp-${randomUUID()}`;temps.push(temp);await writeFile(temp,plan.data,{flag:'wx',mode:0o600});await rename(temp,plan.path);}
 }catch(error){
  for(const temp of temps)await unlink(temp).catch(()=>{});
  for(const backup of backups){const target=backup.slice(0,backup.indexOf('.apw-backup-'));await copyFile(backup,target).catch(()=>{});}
  for(const path of created)await unlink(path).catch(()=>{});
  throw error;
 }
 return {projectPath:root,modulePath:module,changed:changes.map(plan=>relative(module,plan.path)),unchanged:plans.filter(plan=>plan.existing?.equals(plan.data)).map(plan=>relative(module,plan.path)),backups:backups.map(path=>relative(module,path)),includeAndroidXFragments,includeJankStats};
}
