import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {downloadGithubReleaseAsset} from '../scripts/github-download.js';

const gatewayFailure=async()=>{const error=new Error('download failed');error.stderr='curl: (22) HTTP 504';throw error;};

test('a gateway failure downloads the exact official asset without putting the token in child arguments',async(t)=>{
 const dir=await mkdtemp(join(tmpdir(),'apw-download-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const destination=join(dir,'tool.zip'),calls=[],api='https://api.github.com/repos/example/tool';
 const fetcher=async(url,options)=>{
  calls.push({url,options});
  if(calls.length===1)return Response.json({assets:[{id:8,name:'wrong.zip',url:`${api}/releases/assets/8`},{id:9,name:'tool+1.zip',url:`${api}/releases/assets/9`}]});
  return new Response('verified binary fixture');
 };
 await downloadGithubReleaseAsset('https://github.com/example/tool/releases/download/v1%2B2/tool%2B1.zip',destination,{
  runner:async(command,args)=>{assert.equal(command,'curl');assert.ok(!args.some(arg=>arg.includes('test-token')));return gatewayFailure();},fetcher,token:'test-token'
 });
 assert.equal(calls[0].url,`${api}/releases/tags/v1%2B2`);assert.equal(calls[1].url,`${api}/releases/assets/9`);
 assert.equal(calls[1].options.headers.Accept,'application/octet-stream');
 for(const call of calls)assert.equal(call.options.headers.Authorization,'Bearer test-token');
 assert.equal(await readFile(destination,'utf8'),'verified binary fixture');
});

test('fallback rejects mismatched assets and does not mask non-network failures',async()=>{
 let calls=0;
 const fetcher=async()=>{calls++;return Response.json({assets:[{id:7,name:'tool.zip',url:'https://other.example/file'}]});};
 await assert.rejects(downloadGithubReleaseAsset('https://github.com/example/tool/releases/download/v1/tool.zip','output.zip',{runner:gatewayFailure,fetcher,token:''}),/exact requested asset/);assert.equal(calls,1);
 calls=0;await assert.rejects(downloadGithubReleaseAsset('https://github.com/example/tool/releases/download/v1/tool.zip','output.zip',{runner:async()=>{throw new Error('EACCES');},fetcher}),/EACCES/);assert.equal(calls,0);
});

test('API errors report only status and unauthenticated requests omit Authorization',async()=>{
 await assert.rejects(downloadGithubReleaseAsset('https://github.com/example/tool/releases/download/v1/tool.zip','output.zip',{
  runner:gatewayFailure,token:'',fetcher:async(_url,options)=>{assert.equal(options.headers.Authorization,undefined);return new Response('private server details',{status:403});}
 }),/^Error: Official GitHub release metadata returned HTTP 403$/);
});
