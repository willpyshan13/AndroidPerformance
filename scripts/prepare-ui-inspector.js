import {access,chmod,copyFile,mkdir,readFile,stat,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {basename,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const manifestPath=process.env.UI_INSPECTOR_RUNFILES_MANIFEST;
const resourceJar=process.env.UI_INSPECTOR_RESOURCE_JAR;
if(!manifestPath||!resourceJar){
  throw new Error('Set UI_INSPECTOR_RUNFILES_MANIFEST and UI_INSPECTOR_RESOURCE_JAR to the manifest and cli.res.jar produced by Android Studio tools/base Bazel target //tools/base/ui-inspector/cli:dump-ui.');
}
const output=join(root,'tools','ui-inspector'),libDir=join(output,'lib');
const lines=(await readFile(manifestPath,'utf8')).split(/\r?\n/),sources=[];
for(const line of lines){
  const split=line.indexOf(' ');if(split<1)continue;
  const key=line.slice(0,split),source=resolve(line.slice(split+1));
  if(!key.endsWith('.jar')||key.includes('jrt-fs')||key.endsWith('.compile.jar')||key.includes('ijar'))continue;
  try{if((await stat(source)).isFile())sources.push(source);}catch{}
}
sources.push(resolve(resourceJar));
const unique=[...new Set(sources)];
if(unique.length<20||unique.length>100)throw new Error(`Unexpected Android Studio UI Inspector runtime classpath (${unique.length} jars).`);
await mkdir(libDir,{recursive:true});
const entries=[];
for(let i=0;i<unique.length;i++){
  const source=unique[i],target=join(libDir,`${String(i).padStart(2,'0')}-${basename(source)}`);
  await chmod(target,0o644).catch(()=>{});
  await access(source);await copyFile(source,target);
  await chmod(target,0o644);
  const bytes=await readFile(target);
  entries.push({file:`lib/${basename(target)}`,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
await writeFile(join(output,'classpath.json'),`${JSON.stringify(entries,null,2)}\n`);
console.log(`Prepared ${entries.length} verified runtime jars (${(entries.reduce((sum,item)=>sum+item.size,0)/1024/1024).toFixed(1)} MiB).`);
