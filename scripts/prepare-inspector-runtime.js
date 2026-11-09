import {createHash} from 'node:crypto';
import {access,cp,mkdir,mkdtemp,readdir,readFile,rename,rm,stat,writeFile,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const version='25.0.5+8',target=`${process.platform}/${process.arch}`;
const artifacts={
 'darwin/arm64':{
  archive:'OpenJDK25U-jre_aarch64_mac_hotspot_25.0.5_8.tar.gz',
  url:'https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.5%2B8/OpenJDK25U-jre_aarch64_mac_hotspot_25.0.5_8.tar.gz',
  sha256:'72ebd76b502c849e88dea39afae51baf5f82f2b5b1b6389c28ea707b20451bce'
 }
};
const artifact=artifacts[target];
if(!artifact&&target==='win32/x64')await import('./prepare-inspector-runtime-windows.js');
else if(!artifact)throw new Error(`Android Studio UI Inspector Java 25 运行时尚无内置资源：${target}`);
if(artifact){
const root=dirname(dirname(fileURLToPath(import.meta.url))),tools=join(root,'tools');
const temp=await mkdtemp(join(tmpdir(),'apw-inspector-runtime-'));
const archive=join(temp,artifact.archive),unpacked=join(temp,'unpacked'),stage=join(tools,`.java25-runtime-${process.pid}`),dest=join(tools,'java25-runtime');
const run=promisify(execFile);

async function findJavaHome(directory,depth=0){
 if(depth>8)return null;
 try{if((await stat(join(directory,'bin','java'))).isFile())return directory;}catch{}
 for(const entry of await readdir(directory,{withFileTypes:true}).catch(()=>[]))if(entry.isDirectory()){
  const found=await findJavaHome(join(directory,entry.name),depth+1);if(found)return found;
 }
 return null;
}

try{
 await mkdir(tools,{recursive:true});
 await run('curl',['-fsSL','--retry','5','--retry-all-errors','--retry-delay','2','--connect-timeout','10','--max-time','240',artifact.url,'-o',archive],{timeout:250000});
 const actual=createHash('sha256').update(await readFile(archive)).digest('hex');
 if(actual!==artifact.sha256)throw new Error(`Temurin JRE ${version} SHA-256 不匹配：${actual}`);
 await mkdir(unpacked,{recursive:true});
 await run('tar',['-xzf',archive,'-C',unpacked],{timeout:180000,maxBuffer:2*1024*1024});
 const javaHome=await findJavaHome(unpacked);if(!javaHome)throw new Error('Temurin JRE 归档中找不到 bin/java');
 await mkdir(stage,{recursive:true});
 await cp(javaHome,stage,{recursive:true,dereference:true});
 const java=join(stage,'bin','java');
 const result=await run(java,['-version'],{timeout:15000,maxBuffer:4096,encoding:'utf8'});
 const versionOutput=`${result.stdout}\n${result.stderr}`;
 if(!versionOutput.includes('25.0.5'))throw new Error(`内置 Inspector Java 版本不匹配：${versionOutput.trim()}`);
 const licenses=await readdir(join(stage,'legal')).catch(()=>[]);
 const rootLicense=await access(join(stage,'LICENSE')).then(()=>true,()=>false);
 if(licenses.length===0&&!rootLicense)throw new Error('Temurin JRE 归档缺少许可证文件');
 await writeFile(join(stage,'source.json'),JSON.stringify({project:'Eclipse Adoptium Temurin',version,archive:artifact.archive,url:artifact.url,sha256:artifact.sha256,target:'macOS arm64',licenseDirectory:'legal'},null,2)+'\n');
 await writeFile(join(stage,'NOTICE.txt'),`Eclipse Temurin JRE ${version} for macOS arm64.\nUpstream archive SHA-256 verified. License and notice files are included in legal/.\n`);
 await chmod(java,0o755);
 await rm(dest,{recursive:true,force:true});await rename(stage,dest);
 console.log(`Android Studio UI Inspector runtime ready: Temurin ${version}, ${target}, SHA-256 verified`);
}finally{
 await rm(temp,{recursive:true,force:true});
 await rm(stage,{recursive:true,force:true});
}
}
