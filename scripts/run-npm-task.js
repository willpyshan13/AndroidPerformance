import {spawnSync} from 'node:child_process';

const task=process.argv[2];
if(!task||!/^[-:a-z0-9]+$/.test(task))throw new Error('npm task is required');
const command=process.platform==='win32'?'npm.cmd':'npm';
const result=spawnSync(command,['run',task],{encoding:'utf8',shell:process.platform==='win32',maxBuffer:64*1024*1024});
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
