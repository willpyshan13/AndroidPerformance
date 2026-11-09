import test from 'node:test';
import assert from 'node:assert/strict';
import {chmod,mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ensureWindowsJavaRuntime,resolveGradleJavaPath} from '../src/java-runtime.js';

test('Gradle Java resolver prefers a configured full JDK and falls back to the bundled runtime',async t=>{
 const home=await mkdtemp(join(tmpdir(),'apw-gradle-jdk-')),bin=join(home,'bin');await mkdir(bin);
 for(const name of ['java','javac']){const file=join(bin,name);await writeFile(file,'runtime');await chmod(file,0o755);}
 t.after(()=>rm(home,{recursive:true,force:true}));
 assert.equal(await resolveGradleJavaPath({fallbackJavaPath:'/bundled/java',env:{JAVA_HOME:home},platform:'linux'}),join(bin,'java'));
 assert.equal(await resolveGradleJavaPath({fallbackJavaPath:'/bundled/java',env:{JAVA_HOME:'/jdk-25'},platform:'darwin',javaHomeResolver:async()=>home}),join(bin,'java'));
 assert.equal(await resolveGradleJavaPath({fallbackJavaPath:'/bundled/java',env:{JAVA_HOME:'/missing/jdk'},platform:'linux'}),'/bundled/java');
 const windowsJbr=join(home,'Android','Android Studio','jbr'),windowsBin=join(windowsJbr,'bin');await mkdir(windowsBin,{recursive:true});
 for(const name of ['java.exe','javac.exe'])await writeFile(join(windowsBin,name),'runtime');
 assert.equal(await resolveGradleJavaPath({fallbackJavaPath:'C:\\bundled\\java.exe',env:{ProgramFiles:home},platform:'win32',home}),join(windowsBin,'java.exe'));
});

test('Windows Java runtime extracts once from the bundled archive and reuses the verified executable',async()=>{
 const root=await mkdtemp(join(tmpdir(),'apw-java-runtime-'));
 try{
  const archive=join(root,'runtime.tar.gz'),destination=join(root,'runtime');await writeFile(archive,'test archive');let calls=0;
  const runner=async(_command,args)=>{
   calls++;
   if(args[0]==='-tzf')return {stdout:'./\n./bin/\n./bin/java.exe\n'};
   const stage=args[3];await mkdir(join(stage,'bin'),{recursive:true});await writeFile(join(stage,'bin','java.exe'),'runtime binary');return {stdout:''};
  };
  assert.equal(await ensureWindowsJavaRuntime(archive,destination,{runner,tar:'tar'}),destination);
  assert.equal((await readFile(join(destination,'bin','java.exe'),'utf8')),'runtime binary');
  assert.equal(await ensureWindowsJavaRuntime(archive,destination,{runner,tar:'tar'}),destination);assert.equal(calls,2);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('Windows Java runtime rejects archive paths that escape the extraction directory',async()=>{
 const root=await mkdtemp(join(tmpdir(),'apw-java-runtime-'));
 try{
  const archive=join(root,'runtime.tar.gz');await writeFile(archive,'test archive');
  await assert.rejects(()=>ensureWindowsJavaRuntime(archive,join(root,'runtime'),{runner:async()=>({stdout:'./\n../../outside.exe\n'}),tar:'tar'}),/无效路径/);
 }finally{await rm(root,{recursive:true,force:true});}
});
