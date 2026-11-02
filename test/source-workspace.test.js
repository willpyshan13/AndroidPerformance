import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSourceSnapshot,listSourceSnapshots,readSourceFile,searchSource} from '../src/source-workspace.js';
test('local source snapshots are immutable, searchable and never follow symlinks or build output',async t=>{
 const base=await mkdtemp(join(tmpdir(),'apw-source-test-')),source=join(base,'project'),store=join(source,'data','snapshots');t.after(()=>rm(base,{recursive:true,force:true}));
 await mkdir(join(source,'src'),{recursive:true});await mkdir(join(source,'build'),{recursive:true});await writeFile(join(source,'src','Screen.kt'),'class Screen {\n  fun render() {}\n}\n');await writeFile(join(source,'build','Generated.kt'),'class Generated');await writeFile(join(base,'secret.kt'),'secret outside');await symlink(join(base,'secret.kt'),join(source,'src','escape.kt'));
 const snapshot=await createSourceSnapshot(source,store);assert.equal(snapshot.files.length,1);assert.ok(snapshot.skipped>=1);assert.equal((await listSourceSnapshots(store))[0].id,snapshot.id);
 await writeFile(join(source,'src','Screen.kt'),'changed');assert.match((await readSourceFile(store,snapshot.id,'src/Screen.kt')).text,/fun render/);
 const matches=await searchSource(store,snapshot.id,'render');assert.deepEqual(matches.matches.map(x=>[x.path,x.line]),[['src/Screen.kt',2]]);assert.equal((await searchSource(store,snapshot.id,'Screen.kt')).matches[0].line,null);
 await assert.rejects(readSourceFile(store,snapshot.id,'../secret.kt'),/没有该文件/);await assert.rejects(readSourceFile(store,'../outside','src/Screen.kt'),/标识无效|不存在/);
 await writeFile(join(store,snapshot.id,'blobs',snapshot.files[0].sha256),'tampered');await assert.rejects(readSourceFile(store,snapshot.id,'src/Screen.kt'),/校验失败/);
});
test('snapshot creation rejects empty sources and cleans incomplete artifacts',async t=>{
 const base=await mkdtemp(join(tmpdir(),'apw-source-empty-'));t.after(()=>rm(base,{recursive:true,force:true}));const root=join(base,'source'),store=join(base,'store');await mkdir(root);await writeFile(join(root,'readme.md'),'nothing');
 await assert.rejects(createSourceSnapshot(root,store),/没有可读取/);assert.deepEqual(await listSourceSnapshots(store),[]);await assert.rejects(createSourceSnapshot('relative',store),/绝对目录/);
});
