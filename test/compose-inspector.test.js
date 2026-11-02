import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {captureComposeInspector,resolveComposeInspectorResources} from '../src/compose-inspector.js';

test('Compose Inspector resources verify classpath jar hashes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'apw-inspector-'));
 try{
  await mkdir(join(dir,'lib'));const jar=Buffer.from('test-jar'),sha256=createHash('sha256').update(jar).digest('hex');
  await writeFile(join(dir,'lib','fake.jar'),jar);await writeFile(join(dir,'classpath.json'),JSON.stringify([{file:'lib/fake.jar',size:jar.length,sha256}]));
  assert.equal((await resolveComposeInspectorResources({inspectorDir:dir,javaPath:'/java'})).available,true);
  await writeFile(join(dir,'lib','fake.jar'),'bad--jar');
  const result=await resolveComposeInspectorResources({inspectorDir:dir,javaPath:'/java'});
  assert.equal(result.available,false);assert.match(result.reason,/校验失败/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('Compose Inspector rejects API 25 before invoking the inspector process',async()=>{
 let invoked=false;
 const adb={path:'/opt/android-sdk/platform-tools/adb',async exclusive(_serial,task){return task();},async info(){return {api:'25'};}};
 await assert.rejects(captureComposeInspector(adb,{available:true,javaPath:'/java',classpath:'fake',inspectorDir:tmpdir()},'device-1','com.example.app',{runner:async()=>{invoked=true;return {stdout:'{}'};}}),/需要 Android 10（API 29）/);
 assert.equal(invoked,false);
});

test('Compose Inspector captures runtime tree and screenshot without enabling resolution stacks by default',async()=>{
 const png=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(png);png.writeUInt32BE(1080,16);png.writeUInt32BE(2400,20);
 const adb={path:'/opt/android-sdk/platform-tools/adb',async exclusive(_serial,task){return task();},async info(){return {api:'34'};},async run(args,options){assert.deepEqual(args,['-s','device-1','exec-out','screencap','-p']);assert.equal(options.encoding,'buffer');return png;}};
 let invokedArgs;
 const dump={displays:[{id:0,widthPx:1080,heightPx:2400}],windows:[{root:{type:'compose',className:'DemoScreen',bounds:{x:0,y:0,width:1080,height:2400},parameters:[{name:'modifier',value:'Modifier'}],children:[]}}]};
 const result=await captureComposeInspector(adb,{available:true,javaPath:'/java',classpath:'fake',inspectorDir:tmpdir()},'device-1','com.example.app',{runner:async(_java,args)=>{invokedArgs=args;return {stdout:JSON.stringify(dump)};}});
 assert.ok(invokedArgs.includes('attributes,semantics,system-composables'));assert.equal(invokedArgs.includes('resolution-stack'),false);
 assert.deepEqual(result.imageSize,{width:1080,height:2400});assert.equal(result.screenshot,png.toString('base64'));assert.deepEqual(result.dump,dump);
});

test('Compose Inspector continuation fetches the remaining parameter and skips screenshot capture',async()=>{
 const token='opaque-token';let adbCommands=0,invokedArgs;
 const adb={path:'adb',async exclusive(_serial,task){return task();},async info(){return {api:'33'};},async run(){adbCommands++;throw new Error('screenshot should not be captured for continuation');}};
 const parameter={name:'items',value:'List[8]',elements:[{name:'item',value:'last'}]};
 const result=await captureComposeInspector(adb,{available:true,javaPath:'java',classpath:'fake',inspectorDir:tmpdir()},'device-1','com.example.app',{continuationToken:token,runner:async(_java,args)=>{invokedArgs=args;return {stdout:JSON.stringify(parameter)};}});
 assert.ok(invokedArgs.includes('get-parameter'));assert.ok(invokedArgs.includes(token));assert.deepEqual(result.dump,parameter);assert.equal(result.screenshot,null);assert.equal(adbCommands,0);
});

test('Compose Inspector rejects oversized continuation tokens',async()=>{
 const adb={path:'adb',async exclusive(_serial,task){return task();},async info(){return {api:'34'};}};
 await assert.rejects(captureComposeInspector(adb,{available:true,javaPath:'/java',classpath:'fake',inspectorDir:tmpdir()},'device-1','com.example.app',{continuationToken:'x'.repeat(8193)}),/令牌无效/);
});
