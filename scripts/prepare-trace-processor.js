import {mkdtemp,rm,mkdir,readFile,writeFile,chmod,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {traceProcessorArtifact} from '../src/trace-processor-artifacts.js';
const artifact=traceProcessorArtifact(),{url,sha256:expected,name}=artifact;
const licenseUrl='https://raw.githubusercontent.com/google/perfetto/v59.1/LICENSE';
const tmp=await mkdtemp(join(tmpdir(),'apw-perfetto-'));
const dest=join(dirname(dirname(fileURLToPath(import.meta.url))),'tools/trace-processor');
try {
  await promisify(execFile)('curl',['-fsSL','--retry','5','--retry-all-errors','--retry-delay','2','--connect-timeout','10','--max-time','120',url,'-o',join(tmp,name)],{timeout:130000});
  const data=await readFile(join(tmp,name));
  if(createHash('sha256').update(data).digest('hex')!==expected)throw new Error('Trace Processor SHA-256 不匹配');
  await promisify(execFile)('curl',['-fsSL','--retry','5','--retry-all-errors','--retry-delay','2','--connect-timeout','10','--max-time','30',licenseUrl,'-o',join(tmp,'LICENSE')],{timeout:40000});
  if(process.platform!=='win32')await chmod(join(tmp,name),0o755);await mkdir(dest,{recursive:true});await rm(join(dest,name),{force:true});
  await copyFile(join(tmp,name),join(dest,name));
  await copyFile(join(tmp,'LICENSE'),join(dest,'LICENSE'));
  await writeFile(join(dest,'source.json'),JSON.stringify({...artifact},null,2)+'\n');
  console.log(`Trace Processor v59.1：${dest}`);
}finally{await rm(tmp,{recursive:true,force:true});}
