import test from 'node:test';
import assert from 'node:assert/strict';
import {downloadGithubReleaseAsset} from '../scripts/github-download.js';

test('a gateway failure selects the exact official release asset and requests binary media',async()=>{
 const calls=[],api='https://api.github.com/repos/example/tool',runner=async(_command,args)=>{
  calls.push(args);if(calls.length===1){const error=new Error('download failed');error.stderr='curl: (22) HTTP 504';throw error;}
  if(calls.length===2)return {stdout:JSON.stringify({assets:[{id:8,name:'wrong.zip',url:`${api}/releases/assets/8`},{id:9,name:'tool+1.zip',url:`${api}/releases/assets/9`}]})};
  return {stdout:''};
 };
 await downloadGithubReleaseAsset('https://github.com/example/tool/releases/download/v1%2B2/tool%2B1.zip','output.zip',{runner});
 assert.ok(calls[1].includes(`${api}/releases/tags/v1%2B2`));assert.ok(calls[2].includes(`${api}/releases/assets/9`));
 assert.ok(calls[2].includes('Accept: application/octet-stream'));assert.deepEqual(calls[2].slice(-2),['-o','output.zip']);
});

test('fallback rejects mismatched assets and does not mask non-network failures',async()=>{
 let calls=0;const runner=async()=>{calls++;if(calls===1){const e=new Error('HTTP 504');throw e;}return {stdout:JSON.stringify({assets:[{id:7,name:'tool.zip',url:'https://other.example/file'}]})};};
 await assert.rejects(downloadGithubReleaseAsset('https://github.com/example/tool/releases/download/v1/tool.zip','output.zip',{runner}),/exact requested asset/);assert.equal(calls,2);
 calls=0;await assert.rejects(downloadGithubReleaseAsset('https://github.com/example/tool/releases/download/v1/tool.zip','output.zip',{runner:async()=>{calls++;throw new Error('EACCES');}}),/EACCES/);assert.equal(calls,1);
});
