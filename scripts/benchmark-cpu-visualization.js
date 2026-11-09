import {performance} from 'node:perf_hooks';
import {buildSampleTimeline,drawSampleStackTimeline,parseFoldedStacks,profileForTimeBin,profileForTimeRange,sampleStackChart,sampleStackTimeline} from '../public/offline.js';

const sampleCount=50_000,stackCount=512;
const stacks=Array.from({length:stackCount},(_,variant)=>Array.from({length:16+(variant%49)},(_,depth)=>`module${variant%23}.function${(variant*37+depth*19)%4093}`));
const threads=Array.from({length:32},(_,i)=>`worker-${i}`);
const input={event:'cpu-clock:u',clockId:'monotonic',truncated:false,samples:Array.from({length:sampleCount},(_,i)=>({
  timeNs:String(1_730_000_000_000_000_000n+BigInt(i)*20_000_000n),period:String(700+(i*131)%1600),
  thread:threads[i%threads.length],pid:18472,tid:19000+i%threads.length,frames:stacks[(i*73)%stackCount],
}))};
const timings={};
function measure(name,task){const start=performance.now(),result=task();timings[name]=Math.round((performance.now()-start)*100)/100;return result;}
const timeline=measure('timelineIndexMs',()=>buildSampleTimeline(input,60));
const projection=measure('sampleStackProjectionMs',()=>sampleStackTimeline(timeline));
const leafSummary=measure('leafFunctionSummaryMs',()=>sampleStackChart(timeline,8));
const callTree=measure('singleTimeBinCallTreeMs',()=>profileForTimeBin(timeline,30));
const fullRangeCallTree=measure('fullTimeRangeCallTreeMs',()=>profileForTimeRange(timeline,0,timeline.durationMs));
let fillRects=0,pathRects=0,pathFills=0;class Path{rect(){pathRects++;}}
const context={setTransform(){},clearRect(){},fillRect(){fillRects++;},fill(){pathFills++;},set globalAlpha(_value){},set fillStyle(_value){}};
const canvas={style:{},width:0,height:0,getContext:()=>context};
const canvasResult=measure('canvasCommandGenerationMs',()=>drawSampleStackTimeline(canvas,projection,{Path2DImpl:Path}));
const fragmentedSamples=700,fragmentedDepth=127,fragmentedTimeline=buildSampleTimeline({samples:Array.from({length:fragmentedSamples},(_,sample)=>({timeNs:String(1_800_000_000_000_000_000n+BigInt(sample)*1_000_000n),period:'1',thread:'fragmented',pid:1,tid:1,frames:Array.from({length:fragmentedDepth},(_,depth)=>`s${sample}.f${depth}`)}))},20);
const fragmentedStart=performance.now(),fragmentedProfile=profileForTimeRange(fragmentedTimeline,0,fragmentedTimeline.durationMs),fragmentedDirectMs=performance.now()-fragmentedStart;
const legacyStart=performance.now(),fragmentedFolded=fragmentedTimeline.samplesByTime.map(sample=>`${[sample.thread,...sample.frames].join(';')} ${sample.weight}`).join('\n'),fragmentedLegacyProfile=parseFoldedStacks(fragmentedFolded),fragmentedLegacyMs=performance.now()-legacyStart;
let fragmentedTreeNodes=0;const pending=[fragmentedProfile.root];while(pending.length){const node=pending.pop();fragmentedTreeNodes++;pending.push(...node.children);}
const report={sampleCount,uniqueStacks:stackCount,uniqueThreads:threads.length,maxRenderedSamples:projection.renderedSamples,drawnStackFrames:canvasResult.drawnFrames,canvas:{width:canvas.width,height:canvas.height,pathRects,pathFills,legacyFillRects:fillRects},leafSeries:leafSummary.series.length,selectedBinCallTreeNodes:callTree.symbols.length,fullRangeCallTreeStacks:fullRangeCallTree.stacks,fullRangeCallTreeNodes:fullRangeCallTree.symbols.length,deepFragmented:{samples:fragmentedSamples,framesPerSample:fragmentedDepth,treeNodes:fragmentedTreeNodes,serializedBytes:Buffer.byteLength(fragmentedFolded),directRangeMs:+fragmentedDirectMs.toFixed(2),serializeAndParseMs:+fragmentedLegacyMs.toFixed(2),legacyStacks:fragmentedLegacyProfile.stacks},timings,heapUsedMiB:Math.round(process.memoryUsage().heapUsed/1024/1024*10)/10};
console.log(JSON.stringify(report,null,2));
