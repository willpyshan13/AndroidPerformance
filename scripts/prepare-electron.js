import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,rename,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {downloadGithubReleaseAsset} from './github-download.js';

const root=dirname(dirname(fileURLToPath(import.meta.url))),electronDir=join(root,'node_modules','electron');
const install=join(electronDir,'install.js'),run=promisify(execFile);
try{
 await run(process.execPath,[install],{cwd:root,timeout:300000,maxBuffer:2*1024*1024,windowsHide:true});
}catch(error){
 if(!/\b50[234]\b|timed?\s*out|connection reset|fetch failed/i.test(String(error.stderr||error.message)))throw error;
 console.warn('Electron download failed; using the official asset fallback with packaged checksums.');
 const require=createRequire(install),{downloadArtifact}=await import(require.resolve('@electron/get'));
 const {extract}=await import(require.resolve('@electron-internal/extract-zip'));
 const {version}=JSON.parse(await readFile(join(electronDir,'package.json'),'utf8'));
 const checksums=JSON.parse(await readFile(join(electronDir,'checksums.json'),'utf8'));
 const platform=process.env.ELECTRON_INSTALL_PLATFORM||process.env.npm_config_platform||process.platform;
 const arch=process.env.ELECTRON_INSTALL_ARCH||process.env.npm_config_arch||process.arch;
 const archive=await downloadArtifact({version,artifactName:'electron',platform,arch,checksums,downloader:{download:downloadGithubReleaseAsset}});
 await extract(archive,{dir:join(electronDir,'dist')});
 await rename(join(electronDir,'dist','electron.d.ts'),join(electronDir,'electron.d.ts')).catch(error=>{if(error.code!=='ENOENT')throw error;});
 const platformPath=platform==='darwin'?'Electron.app/Contents/MacOS/Electron':platform==='win32'?'electron.exe':'electron';
 await writeFile(join(electronDir,'path.txt'),platformPath);
 await run(process.execPath,[install],{cwd:root,timeout:300000,maxBuffer:2*1024*1024,windowsHide:true});
}
