import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';

const files=(await readdir(new URL('../test/',import.meta.url))).filter(name=>name.endsWith('.test.js')).sort();
let failedFiles=0;
for(const file of files){
 const path=`test/${file}`,result=spawnSync(process.execPath,['--test','--test-reporter=spec',path],{encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024});
 if(result.error||result.status!==0){
  failedFiles++;
  const output=`${result.stdout||''}\n${result.stderr||''}`.trim();
  const summary=output.slice(-1800)||`${path} exited ${result.status??'without status'}: ${String(result.error?.message||'no test output')}`;
  console.log(`::error file=${path},title=Failing test file::${summary.replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A')}`);
 }
}
if(failedFiles)console.log(`::notice title=CI diagnosis::${failedFiles} of ${files.length} test files failed individually.`);
