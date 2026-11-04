import {access,copyFile,mkdir,readFile,writeFile,chmod,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {homedir} from 'node:os';
import {join} from 'node:path';

const root=join(import.meta.dirname,'..'),out=join(root,'tools','native-symbolizer');
const sdkRoots=[process.env.ANDROID_SDK_ROOT,process.env.ANDROID_HOME,join(homedir(),'Library','Android','sdk')].filter(Boolean);
const candidates=[process.env.ANDROID_NDK_HOME,process.env.ANDROID_NDK_ROOT,process.env.NDK_HOME].filter(Boolean);
for(const sdk of sdkRoots)try{const entries=await readdir(join(sdk,'ndk'));for(const entry of entries.sort().reverse())candidates.push(join(sdk,'ndk',entry));}catch{}
let source=null,licenseRoot=null;
search: for(const ndk of [...new Set(candidates)])for(const host of ['darwin-arm64','darwin-x86_64']){
 const prebuilt=join(ndk,'toolchains','llvm','prebuilt',host),binary=join(prebuilt,'bin','llvm-symbolizer');
 try{await access(binary);const props=await readFile(join(ndk,'source.properties'),'utf8');if(!props.includes('Pkg.Desc = Android NDK'))continue;source=binary;licenseRoot=prebuilt;break search;}catch{}
 }
if(!source)throw new Error('找不到 macOS NDK llvm-symbolizer；请安装 Android NDK 27 或设置 ANDROID_NDK_HOME');
const architecture=spawnSync('file',[source],{encoding:'utf8',timeout:15_000});if(architecture.error||architecture.status!==0||!architecture.stdout.includes('arm64'))throw new Error(`llvm-symbolizer 不是 macOS ARM64 可执行文件：${architecture.stderr||architecture.stdout||architecture.error?.message}`);
await mkdir(out,{recursive:true});const destination=join(out,'llvm-symbolizer');await copyFile(source,destination);await chmod(destination,0o755);
const licenses=[];for(const name of ['NOTICE','NOTICE.txt'])try{const path=join(licenseRoot,name);await access(path);licenses.push({name,path});}catch{}
try{const entries=await readdir(licenseRoot);for(const name of entries.filter(value=>value.startsWith('MODULE_LICENSE_'))){const path=join(licenseRoot,name);licenses.push({name,path});}}catch{}
for(const license of licenses)await copyFile(license.path,join(out,license.name));
const digest=createHash('sha256').update(await readFile(destination)).digest('hex');
await writeFile(join(out,'source.json'),JSON.stringify({tool:'llvm-symbolizer',source:'Android NDK LLVM toolchain',binary:'llvm-symbolizer',sha256:digest,licenseFiles:[...new Set(licenses.map(item=>item.name))]},null,2)+'\n');
console.log(`Prepared macOS llvm-symbolizer (${digest.slice(0,16)}…)`);
