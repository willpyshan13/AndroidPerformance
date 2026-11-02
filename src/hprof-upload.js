import { mkdtemp, open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
const MAX = 256 * 1024 * 1024;
export async function analyzeHprofUpload(req, { summaryOnly = false, retainFile = false } = {}) {
  const declared=req.headers['content-length'];
  if(declared!==undefined&&(!/^\d+$/.test(declared)||Number(declared)>MAX)){req.resume();throw Object.assign(new Error('HPROF 文件不能超过 256 MiB'),{status:413});}
  const folder=await mkdtemp(join(tmpdir(),'apw-heap-')), path=join(folder,'input.hprof');let retained=false;
  try {
    const file=await open(path,'wx',0o600);let size=0;
    try {
      for await(const chunk of req.iterator({destroyOnReturn:false})){
        size+=chunk.length;if(size>MAX){req.resume();throw Object.assign(new Error('HPROF 文件不能超过 256 MiB'),{status:413});}
        let offset=0;while(offset<chunk.length){const {bytesWritten}=await file.write(chunk,offset,chunk.length-offset);if(!bytesWritten)throw new Error('临时文件写入失败');offset+=bytesWritten;}
      }
    } finally {await file.close();}
    if(!size)throw new Error('HPROF 文件为空');
    const parsed=await new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('./hprof-worker.js',import.meta.url),{workerData:{path,summaryOnly},execArgv:[],resourceLimits:{maxOldGenerationSizeMb:512}});
      let done=false;
      const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);if(error){worker.terminate();reject(error);}else{worker.unref();resolve({result,worker});}};
      const timer=setTimeout(()=>finish(new Error('HPROF 分析超时')),120000);
      worker.once('message',message=>message.error?finish(new Error(message.error)):finish(null,message.result));
      worker.once('error',error=>finish(error));
      worker.once('exit',code=>finish(new Error(`HPROF 分析进程意外退出 (${code})`)));
    });
    if(!retainFile)return parsed;
    retained=true;return {...parsed,filePath:path,cleanup:()=>rm(folder,{recursive:true,force:true})};
  } finally {if(!retained)await rm(folder,{recursive:true,force:true});}
}

export function queryHeapWorker(worker, action, args) {
  return new Promise((resolve,reject)=>{
    const requestId=randomUUID();let done=false;
    const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);worker.off('message',onMessage);worker.off('error',onError);worker.off('exit',onExit);error?reject(error):resolve(result);};
    const onMessage=message=>{if(message.requestId===requestId)finish(message.error?new Error(message.error):null,message.result);};
    const onError=error=>finish(error),onExit=()=>finish(new Error('堆快照已关闭，请重新导入'));
    const timer=setTimeout(()=>finish(new Error('堆查询超时')),action==='dominators'?120000:15000);
    worker.on('message',onMessage);worker.once('error',onError);worker.once('exit',onExit);
    try { worker.postMessage({requestId,action,args}); } catch(error) { finish(error); }
  });
}
