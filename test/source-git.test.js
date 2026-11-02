import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {validateRemoteSource,parseGitTree,parseGitBatch,createRemoteSourceSnapshot} from '../src/source-git.js';
import {readSourceFile,listSourceSnapshots} from '../src/source-workspace.js';
const text='class Demo {}\n',oid=createHash('sha1').update(`blob ${text.length}\0`).update(text).digest('hex'),commit='b'.repeat(40);
test('only permitted HTTPS GitHub and AOSP repositories and safe branch names are accepted',()=>{
 assert.equal(validateRemoteSource('https://github.com/user/project.git','main').kind,'github');assert.equal(validateRemoteSource('https://android.googlesource.com/platform/frameworks/base','android-14.0.0_r1').kind,'aosp');
 for(const url of ['file:///etc/passwd','https://evil.example/a/b','https://user:pass@github.com/a/b','https://github.com/a/b?token=secret','https://github.com:444/a/b','https://github.com/a/b/c'])assert.throws(()=>validateRemoteSource(url));
 for(const ref of ['-bad','main;reboot','a/../b','a//b','evil.lock','foo bar'])assert.throws(()=>validateRemoteSource('https://github.com/a/b',ref));
});
test('Git tree and batch parser enforce paths, sizes and object identity',()=>{
 const tree=parseGitTree(`100644 blob ${oid} ${text.length}\tsrc/Demo.kt\0`+`120000 blob ${oid} 3\tlinked.kt\0`+`100644 blob ${oid} 5\t../escape.kt\0`);
 assert.equal(tree.entries.length,1);const data=Buffer.from(`${oid} blob ${text.length}\n${text}\n`);assert.equal(parseGitBatch(data,tree.entries)[0].toString(),text);
 assert.throws(()=>parseGitBatch(Buffer.from(`bad blob ${text.length}\n${text}\n`),tree.entries),/不一致/);assert.throws(()=>parseGitBatch(data.subarray(0,-1),tree.entries),/截断/);
});
test('remote snapshots retain immutable commit and remove checkout artifacts',async t=>{
 const root=await mkdtemp(join(tmpdir(),'apw-git-source-'));t.after(()=>rm(root,{recursive:true,force:true}));let cloneDir;
 const run=async(args)=>{if(args[0]==='clone'){cloneDir=args.at(-1);return {stdout:''};}if(args[0]==='rev-parse')return {stdout:commit+'\n'};if(args[0]==='ls-tree')return {stdout:`100644 blob ${oid} ${text.length}\tsrc/Demo.kt\0`};throw new Error('unexpected');};
 const batch=async(_cwd,entries)=>Buffer.from(`${entries[0].oid} blob ${text.length}\n${text}\n`);
 const snap=await createRemoteSourceSnapshot({url:'https://github.com/example/repo',ref:'main'},root,{run,batch});assert.equal(snap.commit,commit);assert.equal(snap.origin,'https://github.com/example/repo');assert.equal(snap.name,'repo');assert.equal((await readSourceFile(root,snap.id,'src/Demo.kt')).text,text);assert.equal((await listSourceSnapshots(root)).length,1);await assert.rejects(import('node:fs/promises').then(fs=>fs.access(cloneDir)));
});
test('pinned remote requests the exact commit and rejects a different resolved revision',async t=>{
 const root=await mkdtemp(join(tmpdir(),'apw-git-pin-'));t.after(()=>rm(root,{recursive:true,force:true}));const calls=[];
 const run=async(args)=>{calls.push(args);if(args[0]==='rev-parse')return {stdout:'c'.repeat(40)+'\n'};return {stdout:''};};
 await assert.rejects(createRemoteSourceSnapshot({url:'https://github.com/a/b',ref:commit},root,{run,batch:async()=>Buffer.alloc(0)}),/提交标识无效/);
 assert.ok(calls.some(a=>a[0]==='fetch'&&a.includes(commit)));assert.ok(calls.some(a=>a[0]==='rev-parse'&&a.includes('FETCH_HEAD^{commit}')));assert.deepEqual(await listSourceSnapshots(root),[]);
});
