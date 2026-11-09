import test from 'node:test';
import assert from 'node:assert/strict';
import {tarExecutable} from '../src/host-tools.js';

test('Windows archive tasks bypass Git Bash tar and use the system executable',()=>{
 const env={SystemRoot:'D:\\Windows',PATH:'C:\\Program Files\\Git\\usr\\bin'};
 assert.equal(tarExecutable({platform:'win32',env}),'D:\\Windows\\System32\\tar.exe');
 assert.equal(tarExecutable({platform:'win32',env:{WINDIR:'C:\\Windows'}}),'C:\\Windows\\System32\\tar.exe');
 assert.equal(tarExecutable({platform:'darwin',env}),'tar');
});
