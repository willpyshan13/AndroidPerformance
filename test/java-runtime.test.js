import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ensureWindowsJavaRuntime} from '../src/java-runtime.js';

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
