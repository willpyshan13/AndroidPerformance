import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const localTools=join(dirname(dirname(fileURLToPath(import.meta.url))),'tools','simpleperf');
const ARCH={'arm64-v8a':'arm64','armeabi-v7a':'arm','x86':'x86','x86_64':'x86_64'};
export async function locateDeviceSimpleperf(abi, api) {
  const arch=ARCH[abi];if(!arch)throw new Error(`不支持设备 ABI：${abi}`);
  const bundled=[process.resourcesPath&&join(process.resourcesPath,'simpleperf'),localTools].filter(Boolean);
  const candidates=[process.env.SIMPLEPERF_DIR&&join(process.env.SIMPLEPERF_DIR,'bin','android',arch,'simpleperf'),...bundled.map(root=>join(root,Number(api)<=25?'legacy/android':'bin/android',arch,'simpleperf'))].filter(Boolean);
  const roots=[process.env.ANDROID_HOME,process.env.ANDROID_SDK_ROOT,join(homedir(),'Library/Android/sdk'),join(homedir(),'Android/Sdk')].filter(Boolean);
  for(const root of roots){const ndk=join(root,'ndk');let versions=[];try{versions=await readdir(ndk);}catch{};versions.sort((a,b)=>{const oldApi=Number(api)<=25;const compatible=v=>!oldApi||Number.parseInt(v,10)<=26;return Number(compatible(b))-Number(compatible(a))||b.localeCompare(a,undefined,{numeric:true});});for(const v of versions)candidates.push(join(ndk,v,'simpleperf','bin','android',arch,'simpleperf'));}
  for(const path of candidates)try{await access(path);return path;}catch{}
  throw new Error('未找到 Android NDK simpleperf；请安装 NDK 或设置 SIMPLEPERF_DIR');
}

export async function locateStackcollapse() {
  const candidates=[process.env.SIMPLEPERF_DIR,process.resourcesPath&&join(process.resourcesPath,'simpleperf'),localTools].filter(Boolean).map(dir=>join(dir,'stackcollapse.py'));
  const roots=[process.env.ANDROID_HOME,process.env.ANDROID_SDK_ROOT,join(homedir(),'Library/Android/sdk'),join(homedir(),'Android/Sdk')].filter(Boolean);
  for(const root of roots){const ndk=join(root,'ndk');let versions=[];try{versions=await readdir(ndk);}catch{}versions.sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));for(const v of versions)candidates.push(join(ndk,v,'simpleperf','stackcollapse.py'));}
  for(const path of candidates)try{await access(path);return path;}catch{}
  throw new Error('未找到 Android NDK stackcollapse.py；请安装 NDK 或设置 SIMPLEPERF_DIR');
}
