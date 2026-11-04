import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {injectLeakCanaryDebugAgent} from '../src/agent-injection.js';

async function appModule(root,name='app',gradle="plugins { id 'com.android.application' }\n"){
 const module=join(root,name);
 await mkdir(join(module,'src/main'),{recursive:true});
 await writeFile(join(module,'build.gradle'),gradle);
 await writeFile(join(module,'src/main/AndroidManifest.xml'),'<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application /></manifest>');
 return module;
}

test('Debug Agent injection writes only debug sources, merges manifest, and is idempotent',async t=>{
 const root=await mkdtemp(join(tmpdir(),'apw-agent-injection-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const module=await appModule(root);
 await mkdir(join(module,'src/debug'),{recursive:true});
 const before='<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n    <application>\n    </application>\n</manifest>\n';
 await writeFile(join(module,'src/debug/AndroidManifest.xml'),before);
 const result=await injectLeakCanaryDebugAgent({projectPath:root});
 assert.equal(result.modulePath,await realpath(module));assert.equal(result.changed.length,3);assert.equal(result.backups.length,1);
 const debugManifest=await readFile(join(module,'src/debug/AndroidManifest.xml'),'utf8');
 assert.match(debugManifest,/ApwLeakCanaryAgentProvider/);assert.match(debugManifest,/android:exported="false"/);
 const backupName=(await readdir(join(module,'src/debug'))).find(name=>name.startsWith('AndroidManifest.xml.apw-backup-'));
 assert.ok(backupName);assert.equal(await readFile(join(module,'src/debug',backupName),'utf8'),before);
 assert.equal(await readFile(join(module,'src/main/AndroidManifest.xml'),'utf8'),'<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application /></manifest>');
 const second=await injectLeakCanaryDebugAgent({projectPath:root});assert.equal(second.changed.length,0);assert.equal(second.unchanged.length,3);assert.equal(second.backups.length,0);
});

test('Debug Agent injection refuses source conflicts before modifying files',async t=>{
 const root=await mkdtemp(join(tmpdir(),'apw-agent-conflict-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const module=await appModule(root),conflict=join(module,'src/debug/java/dev/androidperformance/agent/ApwLifecycleLeakAgent.java');
 await mkdir(join(module,'src/debug/java/dev/androidperformance/agent'),{recursive:true});await writeFile(conflict,'user source');
 await assert.rejects(()=>injectLeakCanaryDebugAgent({projectPath:root}),/内容不同/);
 assert.equal(await readFile(conflict,'utf8'),'user source');
 await assert.rejects(()=>readFile(join(module,'src/debug/AndroidManifest.xml')),{code:'ENOENT'});
});

test('Debug Agent injection requires an explicit app module when project contains several',async t=>{
 const root=await mkdtemp(join(tmpdir(),'apw-agent-modules-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const first=await appModule(root,'app'),second=await appModule(root,'demo');
 await assert.rejects(()=>injectLeakCanaryDebugAgent({projectPath:root}),/多个 Android app module/);
 const result=await injectLeakCanaryDebugAgent({projectPath:first});assert.equal(result.modulePath,await realpath(first));
 assert.ok((await readdir(join(second,'src'))).includes('main'));
});

test('Debug Agent injection selects the application plugin and ignores Android library modules',async t=>{
 const root=await mkdtemp(join(tmpdir(),'apw-agent-app-module-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const app=await appModule(root,'app','plugins { alias(libs.plugins.android.application) }'),library=join(root,'library');
 await mkdir(join(library,'src/main'),{recursive:true});
 await writeFile(join(library,'build.gradle.kts'),'plugins { id("com.android.library") }');
 await writeFile(join(library,'src/main/AndroidManifest.xml'),'<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application /></manifest>');
 const result=await injectLeakCanaryDebugAgent({projectPath:root});
 assert.equal(result.modulePath,await realpath(app));
 await assert.rejects(()=>readFile(join(library,'src/debug/AndroidManifest.xml')),{code:'ENOENT'});
});

test('Debug Agent injection can add optional AndroidX Fragment source to debug only',async t=>{
 const root=await mkdtemp(join(tmpdir(),'apw-agent-fragment-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const module=await appModule(root);
 const result=await injectLeakCanaryDebugAgent({projectPath:root,includeAndroidXFragments:true});
 assert.equal(result.includeAndroidXFragments,true);
 assert.ok(result.changed.includes('src/debug/java/dev/androidperformance/agent/ApwAndroidXFragmentLeakAgent.java'));
});

test('Debug Agent injection can add optional JankStats bridge to debug source set',async t=>{
 const root=await mkdtemp(join(tmpdir(),'apw-agent-jankstats-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const module=await appModule(root),result=await injectLeakCanaryDebugAgent({projectPath:root,includeJankStats:true});
 assert.equal(result.includeJankStats,true);
 assert.ok(result.changed.includes('src/debug/java/dev/androidperformance/agent/ApwJankStatsAgent.java'));
});

test('Debug Agent injection expands self-closing debug application manifests',async t=>{
 const root=await mkdtemp(join(tmpdir(),'apw-agent-manifest-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const module=await appModule(root);await mkdir(join(module,'src/debug'),{recursive:true});
 await writeFile(join(module,'src/debug/AndroidManifest.xml'),'<manifest><application /></manifest>');
 await injectLeakCanaryDebugAgent({projectPath:root});
 const manifest=await readFile(join(module,'src/debug/AndroidManifest.xml'),'utf8');
 assert.match(manifest,/xmlns:android="http:\/\/schemas\.android\.com\/apk\/res\/android"/);
 assert.match(manifest,/<application\s*>[\s\S]*ApwLeakCanaryAgentProvider[\s\S]*<\/application>/);
});

test('Debug Agent injection API requires the local workbench token and injects selected module',async t=>{
 const root=await mkdtemp(join(tmpdir(),'apw-agent-api-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const module=await appModule(root),{createApp}=await import('../src/server.js'),{once}=await import('node:events');
 const server=createApp({adb:{path:'fake'},dataDir:join(root,'data'),token:'local-test'});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
 const url=`http://127.0.0.1:${server.address().port}/api/heap/leakcanary-agent/inject`,body=JSON.stringify({projectPath:module,includeJankStats:true});
 assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body})).status,403);
 const response=await fetch(url,{method:'POST',headers:{'X-Workbench-Token':'local-test','Content-Type':'application/json'},body});
 assert.equal(response.status,200);const result=await response.json();assert.equal(result.changed.length,4);assert.equal(result.includeJankStats,true);assert.ok(result.modulePath.includes('/app'));
});
