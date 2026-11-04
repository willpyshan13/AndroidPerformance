import {mkdtemp,mkdir,copyFile,rm,writeFile,open,stat,readdir} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {readElfBuildId,symbolizeNativeAddress} from '../src/native-symbolizer.js';

const ndkCandidates=[process.env.ANDROID_NDK_HOME,process.env.ANDROID_NDK_ROOT,process.env.NDK_HOME].filter(Boolean);
for(const sdk of [process.env.ANDROID_SDK_ROOT,process.env.ANDROID_HOME,join(homedir(),'Library','Android','sdk')].filter(Boolean))try{for(const version of (await readdir(join(sdk,'ndk'))).sort().reverse())ndkCandidates.push(join(sdk,'ndk',version));}catch{}
const ndk=ndkCandidates.find(candidate=>candidate&&['darwin-arm64','darwin-x86_64'].some(host=>!spawnSync(join(candidate,'toolchains','llvm','prebuilt',host,'bin','clang++'),['--version'],{encoding:'utf8',timeout:10_000}).error));
if(!ndk)throw new Error('Native DWARF smoke requires an installed macOS Android NDK');
const host=['darwin-arm64','darwin-x86_64'].find(value=>{const result=spawnSync(join(ndk,'toolchains','llvm','prebuilt',value,'bin','clang++'),['--version'],{encoding:'utf8',timeout:10_000});return !result.error&&result.status===0;});
const prebuilt=join(ndk,'toolchains','llvm','prebuilt',host),bin=join(prebuilt,'bin');
const temp=await mkdtemp(join(tmpdir(),'apw-native-symbolizer-smoke-'));
function run(command,args){const result=spawnSync(command,args,{encoding:'utf8',timeout:30_000});if(result.error||result.status!==0)throw new Error(`${command} failed: ${result.stderr||result.error?.message||`exit ${result.status}`}`);return result.stdout;}
try{
 const source=join(temp,'native-smoke.cpp'),built=join(temp,'libnative-smoke.so');
 await writeFile(source,'namespace apw {\n__attribute__((noinline)) int smoke(int input) {\n  return input + 11;\n}\n}\n');
 run(join(bin,'clang++'),['--target=aarch64-linux-android24','-g','-O0','-fPIC','-shared','-nostdlib++','-Wl,--build-id=sha1',source,'-o',built]);
 const nm=run(join(bin,'llvm-nm'),['-n','--defined-only',built]),symbol=nm.split('\n').map(line=>line.match(/^([0-9a-fA-F]+)\s+[Tt]\s+(_ZN3apw5smokeEi)$/)).find(Boolean);
 if(!symbol)throw new Error('Smoke ELF did not contain the expected C++ symbol');
 const notes=run(join(bin,'llvm-readelf'),['-n',built]),buildId=notes.match(/Build ID:\s*([0-9a-fA-F]{8,128})/)?.[1];if(!buildId)throw new Error('Smoke ELF has no GNU Build ID');
 const handle=await open(built,'r');try{const parsed=await readElfBuildId(handle,(await stat(built)).size);if(parsed!==buildId.toLowerCase())throw new Error(`ELF Build ID reader mismatch: expected ${buildId}, received ${parsed}`);}finally{await handle.close();}
 const symfs=join(temp,'symfs'),dso='/data/app/apw-smoke/lib/arm64/libnative-smoke.so',symbolFile=join(symfs,dso.slice(1));await mkdir(join(symbolFile,'..'),{recursive:true});await copyFile(built,symbolFile);
 const result=await symbolizeNativeAddress({symfs,dso,address:symbol[1],expectedBuildId:buildId});
 const match=result.frames.find(frame=>frame.function?.includes('apw::smoke')&&frame.source?.endsWith('native-smoke.cpp')&&frame.line===2);
 if(!match)throw new Error(`DWARF smoke did not resolve the expected C++ source location: ${JSON.stringify(result)}`);
 await assert.rejects(symbolizeNativeAddress({symfs,dso,address:symbol[1],expectedBuildId:'0000000000000000000000000000000000000000'}),/Build ID 与采样记录不匹配/);
 console.log(`Native DWARF smoke passed: ${match.function} → ${match.source}:${match.line}; Build ID verified.`);
}finally{await rm(temp,{recursive:true,force:true});}
