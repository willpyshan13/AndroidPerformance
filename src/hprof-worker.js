import { parentPort, workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { parseHprof } from './hprof.js';
try {
  const heap=parseHprof(await readFile(workerData.path),{indexed:!workerData.summaryOnly,includeExamples:false});
  parentPort.postMessage({result:workerData.summaryOnly?heap:heap.summary});
  if(!workerData.summaryOnly)parentPort.on('message',({requestId,action,args})=>{
    try {
      const result=action==='instances'?heap.classInstances(args.classId,args.offset,args.limit):action==='bitmaps'?heap.bitmaps(args.offset,args.limit):action==='duplicateBitmaps'?heap.duplicateBitmaps():action==='duplicateStrings'?heap.duplicateStrings():action==='searchStrings'?heap.searchStrings(args):action==='destroyedActivities'?heap.destroyedActivities():action==='object'?heap.objectDetail(args.id,{offset:args.offset??0,limit:args.limit??64}):action==='incoming'?heap.incomingReferences(args.id,args):action==='rootPath'?heap.rootPath(args.id,{excludeNonStrong:args.excludeNonStrong??false}):action==='dominators'?heap.dominatorTree(args):null;
      if(result===null)throw new Error('不支持的堆查询');
      parentPort.postMessage({requestId,result});
    } catch(error){parentPort.postMessage({requestId,error:error.message||'堆查询失败'});}
  });
} catch(error){parentPort.postMessage({error:error.message || 'HPROF 分析失败'});}
