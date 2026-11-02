import {spawnSync} from 'node:child_process';

const task=process.argv[2];
if(!task||!/^[-:a-z0-9]+$/.test(task))throw new Error('npm task is required');
const command=process.platform==='win32'?'npm.cmd':'npm';
const result=spawnSync(command,['run',task],{encoding:'utf8',shell:process.platform==='win32',maxBuffer:64*1024*1024});
if(result.stdout)process.stdout.write(result.stdout);
if(result.stderr)process.stderr.write(result.stderr);
if(result.error||result.status!==0){
 const stdout=result.stdout||'',stderr=result.stderr||'';
 const detail=`status=${result.status} signal=${result.signal||'none'} error=${result.error?.message||'none'}\nSTDOUT (start):\n${stdout.slice(0,1200)}\nSTDOUT (end):\n${stdout.slice(-3000)}\nSTDERR (end):\n${stderr.slice(-3000)}`;
 console.log(`::error title=npm run ${task} failed::${detail.replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A')}`);
 process.exitCode=result.status??1;
}
