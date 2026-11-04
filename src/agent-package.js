import {readFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=join(dirname(dirname(fileURLToPath(import.meta.url))),'android-agent');
const networkPackageFiles=[
 {source:'README.md',path:'README.md'},
 {source:'src/main/java/dev/androidperformance/agent/NetworkEvents.java',path:'src/debug/java/dev/androidperformance/agent/NetworkEvents.java'},
 {source:'src/main/java/dev/androidperformance/agent/NetworkAgentServer.java',path:'src/debug/java/dev/androidperformance/agent/NetworkAgentServer.java'},
 {source:'src/main/java/dev/androidperformance/agent/LogcatSink.java',path:'src/debug/java/dev/androidperformance/agent/LogcatSink.java'},
];
const layoutPaths=['LAYOUT_AGENT_README.md','src/main/java/dev/androidperformance/agent/LayoutAgent.java','src/main/kotlin/dev/androidperformance/agent/ApwComposeRecompositionProbe.kt','src/main/kotlin/dev/androidperformance/agent/ApwComposeAutomaticProbe.kt','compose-compiler-plugin/settings.gradle.kts','compose-compiler-plugin/build.gradle.kts','compose-compiler-plugin/src/main/resources/META-INF/services/org.jetbrains.kotlin.compiler.plugin.CompilerPluginRegistrar','compose-compiler-plugin/src/main/java/dev/androidperformance/compiler/IrCalls.java','compose-compiler-plugin/src/main/kotlin/dev/androidperformance/compiler/ApwComposeInstrumentationRegistrar.kt'];
const crcTable=Uint32Array.from({length:256},(_,i)=>{let x=i;for(let j=0;j<8;j++)x=(x>>>1)^((x&1)?0xedb88320:0);return x>>>0;});
function crc32(data){let n=0xffffffff;for(const byte of data)n=(n>>>8)^crcTable[(n^byte)&255];return (n^0xffffffff)>>>0;}
// Fixed local files, uncompressed ZIP entries, no shell, no user-supplied paths.
export async function buildAgentPackage(){
 return buildZip(networkPackageFiles);
}
export async function buildLayoutAgentPackage(){
 return buildZip(layoutPaths);
}
export async function buildLeakCanaryAgentPackage(){
 return buildZip([
  'LEAKCANARY_AGENT_README.md',
  {source:'src/main/java/dev/androidperformance/agent/ApwLifecycleLeakAgent.java',path:'src/debug/java/dev/androidperformance/agent/ApwLifecycleLeakAgent.java'},
  {source:'src/main/java/dev/androidperformance/agent/ApwLeakCanaryAgentProvider.java',path:'src/debug/java/dev/androidperformance/agent/ApwLeakCanaryAgentProvider.java'},
  'src/debug/AndroidManifest.xml',
  {source:'optional-androidx/src/debug/java/dev/androidperformance/agent/ApwAndroidXFragmentLeakAgent.java',path:'optional-androidx/src/debug/java/dev/androidperformance/agent/ApwAndroidXFragmentLeakAgent.java'},
  {source:'optional-jankstats/src/debug/java/dev/androidperformance/agent/ApwJankStatsAgent.java',path:'optional-jankstats/src/debug/java/dev/androidperformance/agent/ApwJankStatsAgent.java'},
 ]);
}
export async function buildJankStatsAgentPackage(){
 return buildZip([
  'JANKSTATS_AGENT_README.md',
  {source:'src/main/java/dev/androidperformance/agent/ApwLifecycleLeakAgent.java',path:'src/debug/java/dev/androidperformance/agent/ApwLifecycleLeakAgent.java'},
  {source:'src/main/java/dev/androidperformance/agent/ApwLeakCanaryAgentProvider.java',path:'src/debug/java/dev/androidperformance/agent/ApwLeakCanaryAgentProvider.java'},
  'src/debug/AndroidManifest.xml',
  {source:'optional-jankstats/src/debug/java/dev/androidperformance/agent/ApwJankStatsAgent.java',path:'src/debug/java/dev/androidperformance/agent/ApwJankStatsAgent.java'},
 ]);
}
async function buildZip(files){
 const local=[],central=[];let offset=0;
 for(const file of files){
  const source=typeof file==='string'?file:file.source,path=typeof file==='string'?file:file.path;
  const data=await readFile(join(root,source)),name=Buffer.from(path),crc=crc32(data);
  if(data.length>1024*1024)throw new Error('Agent 源码文件超过大小限制');
  const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(0x21,12);h.writeUInt32LE(crc,14);h.writeUInt32LE(data.length,18);h.writeUInt32LE(data.length,22);h.writeUInt16LE(name.length,26);
  const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(0x21,14);c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(offset,42);
  local.push(h,name,data);central.push(c,name);offset+=h.length+name.length+data.length;
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...local,directory,end]);
}
