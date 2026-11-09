import {createHash} from 'node:crypto';
import {access,chmod,mkdir,mkdtemp,readdir,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tarExecutable} from '../src/host-tools.js';

const version='3.11.18',release='20261026';
const artifacts={
 'darwin/arm64':{triple:'aarch64-apple-darwin',sha256:'f3e1cd83a7f1d70e58b0d69102c18bd6867d2f973068dc5cbfd5822e445c66df'},
 'darwin/x64':{triple:'x86_64-apple-darwin',sha256:'d38edc2df25e7e7f886c802bf2fa552422b097c509dbdcbae828827470356095'},
 'win32/x64':{triple:'x86_64-pc-windows-msvc',sha256:'67215a7bf1643e33d01b17ee3f1e91a8b0b39163746855ee02594bf0608f68b4'},
 'linux/x64':{triple:'x86_64-unknown-linux-gnu',sha256:'17c4978a36c496dc53c08899ef8dad1ad2734f6325f08d6033a1e66419e0af26'},
 'linux/arm64':{triple:'aarch64-unknown-linux-gnu',sha256:'ecf28575cd67fa7a53c7bf2355bae5cff2c496efeb51780d50a8b54441cdce74'}
};
const target=`${process.platform}/${process.arch}`,artifact=artifacts[target];
if(!artifact)throw new Error(`没有 Python ${version} 内置资源：${target}`);
const filename=`cpython-${version}+${release}-${artifact.triple}-install_only_stripped.tar.gz`;
const url=`https://github.com/astral-sh/python-build-standalone/releases/download/${release}/${filename}`;
const root=dirname(dirname(fileURLToPath(import.meta.url))),simpleperf=join(root,'tools','simpleperf');
const stage=join(simpleperf,`.python-runtime-${process.pid}`),dest=join(simpleperf,'python');
const temp=await mkdtemp(join(tmpdir(),'apw-python-'));
const archive=join(temp,filename),run=promisify(execFile);
async function findLicenses(directory,depth=0){
 if(depth>7)return [];
 const found=[];
 for(const entry of await readdir(directory,{withFileTypes:true})){
  const path=join(directory,entry.name);
  if(entry.isDirectory())found.push(...await findLicenses(path,depth+1));
  else if(entry.isFile()&&/^(?:license|licence|copying)(?:[._-].*)?$/i.test(entry.name))found.push(path.slice(stage.length+1));
 }
 return found;
}
try{
 await mkdir(simpleperf,{recursive:true});
 await run('curl',['-fsSL','--retry','2','--connect-timeout','10','--max-time','240',url,'-o',archive],{timeout:250000});
 const actual=createHash('sha256').update(await readFile(archive)).digest('hex');
 if(actual!==artifact.sha256)throw new Error(`Python runtime SHA-256 不匹配：${actual}`);
 await mkdir(stage,{recursive:true});
 await run(tarExecutable(),['-xzf',archive,'-C',stage,'--strip-components=1'],{timeout:180000,maxBuffer:2*1024*1024});
 const executable=join(stage,process.platform==='win32'?'python.exe':join('bin','python3.11'));
 await access(executable);
 if(process.platform!=='win32')await chmod(executable,0o755);
 const licenses=await findLicenses(stage);
 if(!licenses.length)throw new Error('Python standalone 归档没有许可证文件');
 await writeFile(join(stage,'source.json'),JSON.stringify({project:'astral-sh/python-build-standalone',version,release,archive:filename,url,sha256:artifact.sha256,target:artifact.triple,licenseFiles:licenses},null,2)+'\n');
 await writeFile(join(stage,'NOTICE.txt'),`Python ${version} runtime from astral-sh/python-build-standalone, release ${release}.\nAll ${licenses.length} upstream license files are included in this directory; see source.json for their paths.\n`);
 const library=process.platform==='darwin'?'libsimpleperf_report.dylib':process.platform==='win32'?'libsimpleperf_report.dll':'libsimpleperf_report.so';
 const host=process.platform==='darwin'?'darwin':process.platform==='win32'?'windows':'linux';
 let reportLibraryAvailable=true;
 for(const path of [join(simpleperf,'simpleperf_report_lib.py'),join(simpleperf,'bin',host,'x86_64',library)])try{await access(path);}catch(error){if(error.code==='ENOENT')reportLibraryAvailable=false;else throw error;}
 if(reportLibraryAvailable){
  const probe=await run(executable,['-c','from simpleperf_report_lib import ReportLib; report = ReportLib(); report.Close()'],{cwd:simpleperf,timeout:30000,encoding:'utf8',windowsHide:true,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  if(probe.stderr.trim())console.warn(probe.stderr.trim());
 }
 await run(executable,['--version'],{timeout:15000,encoding:'utf8',windowsHide:true});
 await rm(dest,{recursive:true,force:true});
 await rename(stage,dest);
 console.log(`Python ${version} 已准备：${dest} (${artifact.triple}, SHA-256 verified, ${licenses.length} license files)`);
}finally{
 await rm(temp,{recursive:true,force:true});
 await rm(stage,{recursive:true,force:true});
}
