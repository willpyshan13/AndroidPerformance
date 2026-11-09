import {access,copyFile,mkdir,readFile,writeFile,chmod,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {homedir} from 'node:os';
import {dirname,join} from 'node:path';

const root=join(import.meta.dirname,'..'),out=join(root,'tools','native-symbolizer');
const sdkRoots=[process.env.ANDROID_SDK_ROOT,process.env.ANDROID_HOME,process.env.LOCALAPPDATA&&join(process.env.LOCALAPPDATA,'Android','Sdk'),join(homedir(),'Library','Android','sdk'),join(homedir(),'Android','Sdk')].filter(Boolean);
const candidates=[process.env.ANDROID_NDK_HOME,process.env.ANDROID_NDK_ROOT,process.env.NDK_HOME].filter(Boolean);
for(const sdk of sdkRoots)try{const entries=await readdir(join(sdk,'ndk'));for(const entry of entries.sort().reverse())candidates.push(join(sdk,'ndk',entry));}catch{}
let source=null,licenseRoot=null;
let sourceCxxfilt=null;
const hostTags=process.platform==='win32'?['windows-x86_64']:process.platform==='darwin'?(process.arch==='arm64'?['darwin-arm64','darwin-x86_64']:['darwin-x86_64']):[`linux-${process.arch==='arm64'?'aarch64':'x86_64'}`];
search: for(const ndk of [...new Set(candidates)])for(const hostTag of hostTags){
 const prebuilt=join(ndk,'toolchains','llvm','prebuilt',hostTag),suffix=process.platform==='win32'?'.exe':'',binary=join(prebuilt,'bin',`llvm-symbolizer${suffix}`),cxxfilt=join(prebuilt,'bin',`llvm-cxxfilt${suffix}`);
 try{await access(binary);await access(cxxfilt);const props=await readFile(join(ndk,'source.properties'),'utf8');if(!props.includes('Pkg.Desc = Android NDK'))continue;source=binary;sourceCxxfilt=cxxfilt;licenseRoot=prebuilt;break search;}catch{}
}
if(!source||!sourceCxxfilt)throw new Error(`找不到 ${process.platform}/${process.arch} Android NDK llvm-symbolizer / llvm-cxxfilt；请安装 Android NDK 27 或设置 ANDROID_NDK_HOME`);
const destinationName=`llvm-symbolizer${process.platform==='win32'?'.exe':''}`,cxxfiltName=`llvm-cxxfilt${process.platform==='win32'?'.exe':''}`;
for(const [binary,label] of [[source,'llvm-symbolizer'],[sourceCxxfilt,'llvm-cxxfilt']]){const result=spawnSync(binary,['--version'],{encoding:'utf8',timeout:15_000,windowsHide:true});if(result.error||result.status!==0)throw new Error(`${label} 不是可运行的 ${process.platform}/${process.arch} NDK 工具：${result.stderr||result.stdout||result.error?.message}`);}
await mkdir(out,{recursive:true});const destination=join(out,destinationName),destinationCxxfilt=join(out,cxxfiltName);await copyFile(source,destination);if(process.platform!=='win32')await chmod(destination,0o755);await copyFile(sourceCxxfilt,destinationCxxfilt);if(process.platform!=='win32')await chmod(destinationCxxfilt,0o755);
if(process.platform==='win32')for(const name of await readdir(dirname(source)))if(/\.dll$/i.test(name))await copyFile(join(dirname(source),name),join(out,name));
for(const binary of [destination,destinationCxxfilt]){const result=spawnSync(binary,['--version'],{encoding:'utf8',timeout:15_000,windowsHide:true});if(result.error||result.status!==0)throw new Error(`复制后的 LLVM 工具无法启动：${result.stderr||result.error?.message}`);}
const licenses=[];for(const name of ['NOTICE','NOTICE.txt'])try{const path=join(licenseRoot,name);await access(path);licenses.push({name,path});}catch{}
try{const entries=await readdir(licenseRoot);for(const name of entries.filter(value=>value.startsWith('MODULE_LICENSE_'))){const path=join(licenseRoot,name);licenses.push({name,path});}}catch{}
for(const license of licenses)await copyFile(license.path,join(out,license.name));
const digest=createHash('sha256').update(await readFile(destination)).digest('hex'),cxxfiltDigest=createHash('sha256').update(await readFile(destinationCxxfilt)).digest('hex');
await writeFile(join(out,'source.json'),JSON.stringify({tool:'Android NDK LLVM symbol tools',source:'Android NDK LLVM toolchain',binaries:{'llvm-symbolizer':digest,'llvm-cxxfilt':cxxfiltDigest},sha256:digest,licenseFiles:[...new Set(licenses.map(item=>item.name))]},null,2)+'\n');
console.log(`Prepared ${process.platform}/${process.arch} llvm-symbolizer and llvm-cxxfilt (${digest.slice(0,12)}… / ${cxxfiltDigest.slice(0,12)}…)`);
