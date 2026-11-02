import { mkdtemp, open, rm, access, stat } from 'node:fs/promises';
import { join, dirname, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { locateStackcollapse } from './simpleperf.js';
import { fileURLToPath } from 'node:url';
const exec=promisify(execFile), MAX=256*1024*1024;
export async function analyzePerfUpload(req,{locator=locateStackcollapse,runner=exec}={}) {
  let event=null;try{event=req.headers['x-perf-event']===undefined?null:decodeURIComponent(req.headers['x-perf-event']);}catch{throw new Error('采样事件编码无效');}
  if(event!==null&&(typeof event!=='string'||!event||event.length>256||/[\x00-\x1f\x7f]/.test(event)))throw new Error('采样事件名称无效');
  let symfs=null;try{symfs=req.headers['x-perf-symfs']===undefined?null:decodeURIComponent(req.headers['x-perf-symfs']);}catch{throw new Error('符号目录编码无效');}
  if(symfs!==null){if(!symfs||symfs.length>4096||!isAbsolute(symfs)||/[\x00-\x1f\x7f]/.test(symfs))throw new Error('符号目录必须为有效绝对路径');let info;try{info=await stat(symfs);}catch{throw new Error('符号目录不存在或无法读取');}if(!info.isDirectory())throw new Error('符号路径不是目录');}
  const declared=req.headers['content-length'];if(declared!==undefined&&(!/^\d+$/.test(declared)||Number(declared)>MAX)){req.resume();throw Object.assign(new Error('perf.data 不能超过 256 MiB'),{status:413});}
  const dir=await mkdtemp(join(tmpdir(),'apw-perf-')),path=join(dir,'perf.data');
  try {
    const file=await open(path,'wx',0o600);let size=0,head=Buffer.alloc(0);
    try {for await(const chunk of req.iterator({destroyOnReturn:false})){
      size+=chunk.length;if(size>MAX){req.resume();throw Object.assign(new Error('perf.data 不能超过 256 MiB'),{status:413});}
      if(head.length<8)head=Buffer.concat([head,chunk.subarray(0,8-head.length)]);
      let offset=0;while(offset<chunk.length){const {bytesWritten}=await file.write(chunk,offset,chunk.length-offset);if(!bytesWritten)throw new Error('临时文件写入失败');offset+=bytesWritten;}
    }}finally{await file.close();}
    if(head.toString('ascii')!=='PERFILE2')throw new Error('文件不是受支持的 perf.data 格式');
    const script=await locator();let output;
    let converter=fileURLToPath(new URL('../scripts/simpleperf-collapse.py',import.meta.url));
    if(process.resourcesPath){const packaged=join(process.resourcesPath,'app.asar.unpacked','scripts','simpleperf-collapse.py');try{await access(packaged);converter=packaged;}catch{}}
    const options=symfs?[event||'',symfs]:(event?[event]:[]);
    try{output=await runner('python3',[converter,dirname(script),path,...options],{cwd:dirname(script),timeout:120000,maxBuffer:12*1024*1024,encoding:'utf8',windowsHide:true,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});}
    catch(error){if(error.code==='ENOENT')throw new Error('未找到 Python 3，无法运行 NDK stackcollapse.py');throw new Error(`simpleperf 解析失败：${String(error.stderr||error.message).slice(0,1000)}`);}
    if(!output.stdout.trim())throw new Error('采样文件没有可用调用栈；目标可能在采样期间没有运行，或数据不包含样本');
    const warnings=[String(output.stderr||'').trim()].filter(Boolean);let timeline=null;
    let helper=fileURLToPath(new URL('../scripts/simpleperf-timeline.py',import.meta.url));
    if(process.resourcesPath){const packaged=join(process.resourcesPath,'app.asar.unpacked','scripts','simpleperf-timeline.py');try{await access(packaged);helper=packaged;}catch{}}
    try {
      const detail=await runner('python3',[helper,dirname(script),path,...options],{cwd:dirname(script),timeout:120000,maxBuffer:24*1024*1024,encoding:'utf8',windowsHide:true,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
      timeline=JSON.parse(detail.stdout);
      if(!Array.isArray(timeline.samples)||timeline.samples.length>50000)throw new Error('采样列表格式无效');
      if(detail.stderr?.trim())warnings.push(String(detail.stderr).trim().slice(0,500));
    } catch(error) {warnings.push(`时间线不可用：${String(error.stderr||error.message).slice(0,500)}`);}
    if(warnings.some(message=>/build id mismatch/i.test(message)))warnings.unshift('符号文件构建 ID 与采样记录不匹配；simpleperf 已拒绝使用该文件');
    return {folded:output.stdout,warning:warnings.join('；').slice(0,1500),timeline,fileBytes:size};
  } finally {await rm(dir,{recursive:true,force:true});}
}
