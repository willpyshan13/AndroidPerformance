import {copyFile,mkdir,chmod} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {locateAapt2} from '../src/apk.js';

const source=await locateAapt2();
if(!source)throw new Error('请先用 Android SDK Manager 安装 Build Tools，或设置 AAPT2_PATH 指向官方 aapt2');
const target=join(dirname(dirname(fileURLToPath(import.meta.url))),'tools/apk-tools');
await mkdir(target,{recursive:true});
const name=process.platform==='win32'?'aapt2.exe':'aapt2';
if(resolve(source)!==resolve(join(target,name))){
  for(const file of [name,'NOTICE.txt','source.properties'])await copyFile(join(dirname(source),file),join(target,file));
  await chmod(join(target,name),0o755);
}
if(process.platform==='darwin')await promisify(execFile)('codesign',['--verify','--verbose=2',join(target,name)]);
const version=await promisify(execFile)(join(target,name),['version']);
console.log((version.stdout||version.stderr).trim());
console.log(`AAPT2 资源：${target}`);
