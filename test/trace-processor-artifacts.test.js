import test from 'node:test';
import assert from 'node:assert/strict';
import {traceProcessorArtifact} from '../src/trace-processor-artifacts.js';

test('Trace Processor artifacts are pinned for each desktop architecture',()=>{
 const cases=[
  ['darwin','arm64','mac-arm64','trace_processor_shell','8488edbefadfc4be152cda1d42d9bfcede8b47638295eb85eb3bad8cd148fdf4'],
  ['darwin','x64','mac-amd64','trace_processor_shell','df38039845244c353c399994748599345cf08f740491b5832e7feb9a4dbcc476'],
  ['linux','x64','linux-amd64','trace_processor_shell','2434129a3af4dc9e2034a476f7b76447b490975213e301769310d3bd0d5d6458'],
  ['linux','arm64','linux-arm64','trace_processor_shell','a08e4836171c87be3ba5834eef3489aa8803476d35f292ed7feaccae252747d0'],
  ['win32','x64','windows-amd64','trace_processor_shell.exe','3acc5aca1c764541033a82ba3bb0a47524b5c3c0aa194eea8d9a7b0cdb346bdc']
 ];
 for(const [platform,arch,target,name,sha256] of cases){const item=traceProcessorArtifact(platform,arch);assert.equal(item.arch,target);assert.equal(item.name,name);assert.equal(item.sha256,sha256);assert.ok(item.url.endsWith(`${target}/${name}`));}
 assert.throws(()=>traceProcessorArtifact('win32','arm64'),/没有已校验/);
});
