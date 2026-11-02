import { access, copyFile, mkdir, readFile, readdir, writeFile, chmod } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

if(process.platform!=='darwin')throw new Error('当前资源准备脚本仅支持 macOS，其他系统尚未验证');
const roots=[process.env.ANDROID_HOME,process.env.ANDROID_SDK_ROOT,join(homedir(),'Library/Android/sdk'),join(homedir(),'Android/Sdk')].filter(Boolean);
const ndks=[];
for(const root of roots){const dir=join(root,'ndk');let names=[];try{names=await readdir(dir);}catch{}for(const name of names){const path=join(dir,name);try{const props=await readFile(join(path,'source.properties'),'utf8');const revision=props.match(/^Pkg\.Revision\s*=\s*(.+)$/m)?.[1];if(revision&&!/alpha|beta|rc/i.test(revision))ndks.push({name,path,revision});}catch{}}}
ndks.sort((a,b)=>b.name.localeCompare(a.name,undefined,{numeric:true}));
const modern=process.env.SIMPLEPERF_NDK?{path:process.env.SIMPLEPERF_NDK,revision:'由 SIMPLEPERF_NDK 指定'}:ndks[0];
const legacy=process.env.SIMPLEPERF_LEGACY_NDK?{path:process.env.SIMPLEPERF_LEGACY_NDK,revision:'由 SIMPLEPERF_LEGACY_NDK 指定'}:ndks.find(n=>Number.parseInt(n.name,10)<=26);
if(!modern||!legacy)throw new Error('需要已安装的稳定版 NDK 和 r26 或更早版本；可设置 SIMPLEPERF_NDK 与 SIMPLEPERF_LEGACY_NDK');
const target=join(dirname(dirname(fileURLToPath(import.meta.url))),'tools/simpleperf');
async function copy(from,to,executable=false){await access(from);await mkdir(dirname(to),{recursive:true});await copyFile(from,to);if(executable)await chmod(to,0o755);}
for(const name of ['stackcollapse.py','simpleperf_report_lib.py','simpleperf_utils.py'])await copy(join(modern.path,'simpleperf',name),join(target,name));
try{await access(join(modern.path,'simpleperf','etm_types.py'));await copy(join(modern.path,'simpleperf','etm_types.py'),join(target,'etm_types.py'));}catch(error){if(error.code!=='ENOENT')throw error;}
await copy(join(modern.path,'simpleperf/bin/darwin/x86_64/libsimpleperf_report.dylib'),join(target,'bin/darwin/x86_64/libsimpleperf_report.dylib'));
for(const arch of ['arm','arm64','x86','x86_64']){
  await copy(join(modern.path,'simpleperf/bin/android',arch,'simpleperf'),join(target,'bin/android',arch,'simpleperf'),true);
  await copy(join(legacy.path,'simpleperf/bin/android',arch,'simpleperf'),join(target,'legacy/android',arch,'simpleperf'),true);
}
await copy(join(modern.path,'NOTICE'),join(target,'NOTICE-modern.txt'));
await copy(join(legacy.path,'NOTICE'),join(target,'NOTICE-legacy.txt'));
await writeFile(join(target,'versions.json'),JSON.stringify({modern:modern.revision,legacy:legacy.revision},null,2)+'\n');
console.log(`simpleperf 资源：${target}；主版本 ${modern.revision}；Android 7 兼容版本 ${legacy.revision}`);
