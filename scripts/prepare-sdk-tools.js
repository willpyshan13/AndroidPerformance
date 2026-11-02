import {access,copyFile,mkdir,chmod,readFile,readdir} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {locateAapt2} from '../src/apk.js';

const run=promisify(execFile),root=dirname(dirname(fileURLToPath(import.meta.url))),sdkRoots=[process.env.ANDROID_HOME,process.env.ANDROID_SDK_ROOT,process.env.LOCALAPPDATA&&join(process.env.LOCALAPPDATA,'Android','Sdk'),join(homedir(),'Library','Android','sdk'),join(homedir(),'Android','Sdk')].filter(Boolean);
let sdkPlatformTools=null;
for(const sdk of sdkRoots){const candidate=join(sdk,'platform-tools');try{await access(join(candidate,process.platform==='win32'?'adb.exe':'adb'));sdkPlatformTools=candidate;break;}catch{}}
if(!sdkPlatformTools)throw new Error('未找到 Android SDK platform-tools；请设置 ANDROID_HOME / ANDROID_SDK_ROOT');
const aapt=await locateAapt2();if(!aapt)throw new Error('未找到 Android SDK Build Tools 中的 AAPT2');
const targetPlatformTools=join(root,'tools','platform-tools'),targetApkTools=join(root,'tools','apk-tools'),adbName=process.platform==='win32'?'adb.exe':'adb',aaptName=process.platform==='win32'?'aapt2.exe':'aapt2';
await mkdir(targetPlatformTools,{recursive:true});await mkdir(targetApkTools,{recursive:true});
const copyDifferent=async(from,to)=>{if(resolve(from)!==resolve(to))await copyFile(from,to);};
for(const name of await readdir(sdkPlatformTools))if(name==='adb'||name==='adb.exe'||/^AdbWin.*\.dll$/i.test(name)||name==='NOTICE.txt'||name==='source.properties')await copyDifferent(join(sdkPlatformTools,name),join(targetPlatformTools,name));
await copyDifferent(aapt,join(targetApkTools,aaptName));
for(const name of ['NOTICE.txt','source.properties'])try{await copyDifferent(join(dirname(aapt),name),join(targetApkTools,name));}catch(error){if(error.code!=='ENOENT')throw error;}
if(process.platform!=='win32'){await chmod(join(targetPlatformTools,adbName),0o755);await chmod(join(targetApkTools,aaptName),0o755);}
await run(join(targetPlatformTools,adbName),['version'],{timeout:10000});
const version=await run(join(targetApkTools,aaptName),['version'],{timeout:10000});
const sdkProps=await readFile(join(dirname(aapt),'source.properties'),'utf8').catch(()=>''),revision=sdkProps.match(/^Pkg\.Revision\s*=\s*(.+)$/m)?.[1]||'unknown';
console.log(`Prepared native Android SDK tools for ${process.platform}/${process.arch}: ADB, AAPT2 ${revision} (${(version.stdout||version.stderr).trim()})`);
