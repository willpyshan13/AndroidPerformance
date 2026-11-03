import { access, copyFile, mkdir, readFile, readdir, writeFile, chmod } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

if(!['darwin','win32','linux'].includes(process.platform)||process.arch==='arm64'&&process.platform==='linux')throw new Error(`当前 simpleperf host 资源尚不支持 ${process.platform}/${process.arch}`);
const roots=[process.env.ANDROID_HOME,process.env.ANDROID_SDK_ROOT,process.env.LOCALAPPDATA&&join(process.env.LOCALAPPDATA,'Android','Sdk'),join(homedir(),'Library/Android/sdk'),join(homedir(),'Android/Sdk')].filter(Boolean);
const ndks=[];
for(const root of roots){const dir=join(root,'ndk');let names=[];try{names=await readdir(dir);}catch{}for(const name of names){const path=join(dir,name);try{const props=await readFile(join(path,'source.properties'),'utf8');const revision=props.match(/^Pkg\.Revision\s*=\s*(.+)$/m)?.[1];if(revision&&!/alpha|beta|rc/i.test(revision))ndks.push({name,path,revision});}catch{}}}
ndks.sort((a,b)=>b.name.localeCompare(a.name,undefined,{numeric:true}));
const root=dirname(dirname(fileURLToPath(import.meta.url))),target=join(root,'tools/simpleperf'),legacyBundle=join(root,'tools/simpleperf-legacy');
const modern=process.env.SIMPLEPERF_NDK?{path:process.env.SIMPLEPERF_NDK,revision:'由 SIMPLEPERF_NDK 指定'}:ndks[0];
let legacy=process.env.SIMPLEPERF_LEGACY_NDK?{path:process.env.SIMPLEPERF_LEGACY_NDK,revision:'由 SIMPLEPERF_LEGACY_NDK 指定'}:ndks.find(n=>Number.parseInt(n.name,10)<=26);
if(!legacy){
  const manifest=JSON.parse(await readFile(join(legacyBundle,'source.json'),'utf8'));
  if(manifest.sdkPackage!=='ndk;26.1.10909125')throw new Error('旧版 simpleperf 资源的来源版本无效');
  for(const arch of ['arm','arm64','x86','x86_64'])await access(join(legacyBundle,'android',arch,'simpleperf'));
  await access(join(legacyBundle,'NOTICE.txt'));
  legacy={path:null,revision:manifest.sdkPackage.slice(4)};
}
if(!modern)throw new Error('需要已安装稳定版 Android NDK；可设置 SIMPLEPERF_NDK');
async function copy(from,to,executable=false){await access(from);await mkdir(dirname(to),{recursive:true});await copyFile(from,to);if(executable&&process.platform!=='win32')await chmod(to,0o755);}
for(const name of ['stackcollapse.py','simpleperf_report_lib.py','simpleperf_utils.py'])await copy(join(modern.path,'simpleperf',name),join(target,name));
try{await access(join(modern.path,'simpleperf','etm_types.py'));await copy(join(modern.path,'simpleperf','etm_types.py'),join(target,'etm_types.py'));}catch(error){if(error.code!=='ENOENT')throw error;}
const host=process.platform==='darwin'?'darwin':process.platform==='win32'?'windows':'linux';
const hostArch='x86_64';
const library=host==='darwin'?'libsimpleperf_report.dylib':host==='windows'?'libsimpleperf_report.dll':'libsimpleperf_report.so';
const hostDir=join(modern.path,'simpleperf','bin',host,hostArch),targetHostDir=join(target,'bin',host,hostArch);
await copy(join(hostDir,library),join(targetHostDir,library));
if(host==='windows')await copy(join(hostDir,'libwinpthread-1.dll'),join(targetHostDir,'libwinpthread-1.dll'));
for(const arch of ['arm','arm64','x86','x86_64']){
  await copy(join(modern.path,'simpleperf/bin/android',arch,'simpleperf'),join(target,'bin/android',arch,'simpleperf'),true);
  const legacyBinary=legacy.path?join(legacy.path,'simpleperf/bin/android',arch,'simpleperf'):join(legacyBundle,'android',arch,'simpleperf');
  await copy(legacyBinary,join(target,'legacy/android',arch,'simpleperf'),true);
}
await copy(join(modern.path,'NOTICE'),join(target,'NOTICE-modern.txt'));
await copy(legacy.path?join(legacy.path,'NOTICE'):join(legacyBundle,'NOTICE.txt'),join(target,'NOTICE-legacy.txt'));
await writeFile(join(target,'versions.json'),JSON.stringify({modern:modern.revision,legacy:legacy.revision},null,2)+'\n');
console.log(`simpleperf 资源：${target}；host ${host}/${hostArch}；主版本 ${modern.revision}；Android 7 兼容版本 ${legacy.revision}`);
