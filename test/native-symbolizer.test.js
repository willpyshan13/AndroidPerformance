import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {symbolizeNativeAddress} from '../src/native-symbolizer.js';

test('Native symbolization accepts the host absolute directory and checks the ELF Build ID before invoking LLVM',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'apw-native-path-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const buildId='0123456789abcdef0123456789abcdef01234567',elf=Buffer.alloc(156);
 Buffer.from([0x7f,0x45,0x4c,0x46,2,1]).copy(elf);elf.writeBigUInt64LE(64n,32);elf.writeUInt16LE(56,54);elf.writeUInt16LE(1,56);
 elf.writeUInt32LE(4,64);elf.writeBigUInt64LE(120n,72);elf.writeBigUInt64LE(36n,96);
 elf.writeUInt32LE(4,120);elf.writeUInt32LE(20,124);elf.writeUInt32LE(3,128);Buffer.from('GNU\0').copy(elf,132);Buffer.from(buildId,'hex').copy(elf,136);
 const file=join(dir,'libdemo.so');await writeFile(file,elf);const canonical=await realpath(file);let invoked=0;
 const options={symfs:dir,dso:'/data/app/libdemo.so',address:'12ab',expectedBuildId:buildId,locator:async()=> 'llvm-symbolizer',runner:async(_binary,args)=>{
  invoked++;assert.ok(args.includes(`--obj=${canonical}`));assert.equal(args.at(-1),'0x12ab');return {stdout:'demo::run()\nsource/demo.cpp:42:7\n'};
 }};
 const result=await symbolizeNativeAddress(options);assert.equal(result.hasSource,true);assert.equal(result.frames[0].line,42);
 await assert.rejects(symbolizeNativeAddress({...options,expectedBuildId:'0'.repeat(40)}),/Build ID 与采样记录不匹配/);assert.equal(invoked,1);
 await assert.rejects(symbolizeNativeAddress({...options,symfs:'relative/symbols'}),/有效绝对路径/);
});
