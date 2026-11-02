import {mkdtemp,rm,mkdir,readFile,writeFile,chmod,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
if(process.platform!=='darwin'||process.arch!=='arm64')throw new Error('当前准备脚本仅支持 macOS arm64');
const url='https://commondatastorage.googleapis.com/perfetto-luci-artifacts/v59.1/mac-arm64/trace_processor_shell';
const expected='8488edbefadfc4be152cda1d42d9bfcede8b47638295eb85eb3bad8cd148fdf4';
const licenseUrl='https://raw.githubusercontent.com/google/perfetto/v59.1/LICENSE';
const tmp=await mkdtemp(join(tmpdir(),'apw-perfetto-'));
const dest=join(dirname(dirname(fileURLToPath(import.meta.url))),'tools/trace-processor');
try {
  await promisify(execFile)('curl',['-fsSL','--max-time','120',url,'-o',join(tmp,'trace_processor_shell')],{timeout:130000});
  const data=await readFile(join(tmp,'trace_processor_shell'));
  if(createHash('sha256').update(data).digest('hex')!==expected)throw new Error('Trace Processor SHA-256 不匹配');
  await promisify(execFile)('curl',['-fsSL','--max-time','30',licenseUrl,'-o',join(tmp,'LICENSE')],{timeout:40000});
  await chmod(join(tmp,'trace_processor_shell'),0o755);await mkdir(dest,{recursive:true});
  await rename(join(tmp,'trace_processor_shell'),join(dest,'trace_processor_shell'));
  await rename(join(tmp,'LICENSE'),join(dest,'LICENSE'));
  await writeFile(join(dest,'source.json'),JSON.stringify({version:'v59.1',url,sha256:expected},null,2)+'\n');
  console.log(`Trace Processor v59.1：${dest}`);
}finally{await rm(tmp,{recursive:true,force:true});}
