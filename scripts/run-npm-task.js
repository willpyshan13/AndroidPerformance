import {spawnSync} from 'node:child_process';
import {readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';

const task=process.argv[2];
if(!task||!/^[-:a-z0-9]+$/.test(task))throw new Error('npm task is required');
const command=process.platform==='win32'?'npm.cmd':'npm';
const run=()=>spawnSync(command,['run',task],{encoding:'utf8',shell:process.platform==='win32',maxBuffer:64*1024*1024});
let result=run(),attempt=1;
const maxAttempts=5;
while(task.startsWith('package:')&&result.status!==0&&/EBUSY.*copyfile/i.test(`${result.stdout||''}\n${result.stderr||''}`)&&attempt<maxAttempts){
 console.log(`::warning title=Transient file lock::Retrying ${task} after EBUSY copyfile (attempt ${attempt+1}/${maxAttempts}).`);
 const {version}=JSON.parse(await readFile('package.json','utf8'));
 await rm(join('dist',`v${version}`),{recursive:true,force:true,maxRetries:15,retryDelay:500});
 await new Promise(resolve=>setTimeout(resolve,Math.min(1500*2**(attempt-1),10_000)));result=run();attempt++;
}
if(result.stdout)process.stdout.write(result.stdout);
if(result.stderr)process.stderr.write(result.stderr);
if(result.error||result.status!==0){
 const stdout=result.stdout||'',stderr=result.stderr||'';
 const lines=`${stdout}\n${stderr}`.trim().split(/\r?\n/);
 const clues=lines.filter(line=>/(?:^|\s)(?:⨯|✖|Error:|ERR_[A-Z_]+|failedTask=|fatal:)/i.test(line));
 const tail=clues.length?clues.slice(-16).join('\n'):lines.slice(-12).join('\n');
 const detail=`status=${result.status} signal=${result.signal||'none'} error=${result.error?.message||'none'}\n${tail}`;
 console.log(`::error title=npm run ${task} failed::${detail.replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A')}`);
 process.exitCode=result.status??1;
}
