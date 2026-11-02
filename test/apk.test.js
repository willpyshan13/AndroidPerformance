import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,X509Certificate} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {analyzeApk,parseApkManifest,parseDexHeader,parseProfileHeader,parseProfileDexHeaders,apkCategory} from '../src/apk.js';
import {readApkSigningBlock,certificatesFromSigningValue,certificatesFromPkcs7} from '../src/apk-signatures.js';
import {validateRecord} from '../src/records.js';
import {apkBaselineEvidence} from '../public/offline.js';
import {zipFixture,dexFixture,BADGING,TREE,aaptRunner} from '../fixtures/apk/helpers.js';

const cert=await readFile(new URL('../fixtures/apk/certificate.der',import.meta.url));
const pkcs7=await readFile(new URL('../fixtures/apk/signature.p7b',import.meta.url));
const lp=b=>{const size=Buffer.alloc(4);size.writeUInt32LE(b.length);return Buffer.concat([size,b]);};
function schemeValue(v3=false){const signed=Buffer.concat([lp(Buffer.alloc(0)),lp(lp(cert)),...(v3?[Buffer.alloc(8)]:[]),lp(Buffer.alloc(0))]);const signer=Buffer.concat([lp(signed),...(v3?[Buffer.from([23,0,0,0,35,0,0,0])]:[]),lp(Buffer.alloc(0)),lp(Buffer.alloc(0))]);return lp(lp(signer));}
test('Manifest handles modern/legacy typed values, permissions, component names and undeclared flags',()=>{
  const m=parseApkManifest(BADGING,TREE);assert.equal(m.packageName,'com.test.apk');assert.equal(m.minSdk,23);assert.equal(m.debuggable,false);assert.equal(m.allowBackup,true);assert.equal(m.usesCleartextTraffic,null);
  assert.equal(m.permissions.length,2);assert.equal(m.permissions[1].maxSdk,28);assert.equal(m.declaredPermissions[0].protectionLevel,2);
  assert.deepEqual(m.components.map(c=>c.name),['com.test.apk.MainActivity','com.test.apk.WorkService','com.external.Provider']);assert.equal(m.components[1].exported,null);assert.equal(m.components[0].actions[0],'android.intent.action.MAIN');assert.match(m.xml,/Test &amp; &lt;App&gt;/);
});
test('DEX parser reads method IDs rather than inventing unique method counts',()=>{
  const h=parseDexHeader(dexFixture());assert.equal(h.methodIds,12);assert.equal(h.classDefs,3);assert.equal(h.version,'035');assert.throws(()=>parseDexHeader(Buffer.from('not dex')),/DEX/);
  const bad=dexFixture();bad.writeUInt32LE(0x78563412,40);assert.throws(()=>parseDexHeader(bad),/字节序/);
});
test('APK categories distinguish resource table, metadata, code, ABI and assets',()=>{
  assert.deepEqual(['classes10.dex','lib/arm64-v8a/libx.so','resources.arsc','assets/classes.dex','META-INF/CERT.RSA','AndroidManifest.xml','res/drawable/x.png'].map(apkCategory),['dex','native','table','assets','signatures','manifest','resources']);
});
test('v1 PKCS7 and v2/v3 signing data yield the same certificate fingerprint without claiming verification',()=>{
  const expected=new X509Certificate(cert).fingerprint256;
  assert.equal(certificatesFromPkcs7(pkcs7)[0].sha256,expected);
  assert.equal(certificatesFromSigningValue(schemeValue(),'v2')[0].sha256,expected);
  assert.equal(certificatesFromSigningValue(schemeValue(true),'v3')[0].sha256,expected);
  assert.throws(()=>certificatesFromSigningValue(Buffer.from([255,255,255,255]),'v2'),/越界/);
});
test('locates APK Signing Block ahead of central directory and handles malformed pairs',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'apw-apk-sign-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const zip=zipFixture([['AndroidManifest.xml','xml']]),cd=zip.readUInt32LE(zip.length-6),value=schemeValue();
  const pair=Buffer.alloc(12);pair.writeBigUInt64LE(BigInt(value.length+4),0);pair.writeUInt32LE(0x7109871a,8);
  const size=BigInt(8+pair.length+value.length+24-8),head=Buffer.alloc(8),foot=Buffer.alloc(24);head.writeBigUInt64LE(size);foot.writeBigUInt64LE(size);foot.write('APK Sig Block 42',8);
  const block=Buffer.concat([head,pair,value,foot]),end=Buffer.from(zip.subarray(-22));end.writeUInt32LE(cd+block.length,16);
  const bytes=Buffer.concat([zip.subarray(0,cd),block,zip.subarray(cd,-22),end]),path=join(dir,'sample.apk');await writeFile(path,bytes);
  const info=await readApkSigningBlock(path,bytes.length);assert.deepEqual(info.detectedSchemes,['v2']);assert.equal(info.certificates.length,1);assert.equal(info.verification,'not-performed');assert.equal(info.blockBytes,block.length);
  bytes.writeBigUInt64LE(999999n,cd+8);await writeFile(path,bytes);assert.match((await readApkSigningBlock(path,bytes.length)).warnings.join(),/越界/);
});
test('APK analysis reconciles every byte and round-trips as a saved report',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'apw-apk-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'sample.apk'),zip=zipFixture([['AndroidManifest.xml','binary'],['classes.dex',dexFixture()],['assets/test.txt','hello'],['lib/arm64-v8a/libx.so','native'],['META-INF/CERT.RSA',pkcs7]]);await writeFile(path,zip);
  const r=await analyzeApk(path,{aapt2Path:'fixture-aapt',runner:aaptRunner,fileName:'测试.apk'});
  assert.equal(r.fileName,'测试.apk');assert.equal(r.fileCount,5);assert.equal(r.packageName,'com.test.apk');assert.equal(r.abis[0].name,'arm64-v8a');assert.equal(r.dex[0].methodIds,12);
  assert.equal(r.categories.reduce((s,c)=>s+c.compressedBytes,0),zip.length);assert.equal(r.sha256,createHash('sha256').update(zip).digest('hex'));assert.equal(r.signatures.certificates.length,1);
  assert.doesNotThrow(()=>validateRecord({kind:'apk',source:'import',payload:r}));
});
test('APK file inventory exposes packaged baseline profile evidence',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'apw-apk-profile-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const path=join(dir,'sample.apk');await writeFile(path,zipFixture([['AndroidManifest.xml','binary'],['assets/dexopt/baseline.prof',Buffer.from('pro\0'+'010\0')],['assets/dexopt/baseline.profm',Buffer.from('prm\0'+'002\0')]]));
 const apk=await analyzeApk(path,{aapt2Path:'fixture-aapt',runner:aaptRunner});const files=apkBaselineEvidence(apk).files;assert.deepEqual(files.map(f=>[f.status,f.bytes,f.header.status,f.header.version]),[['present',8,'recognized','010'],['present',8,'recognized','002']]);
 assert.doesNotThrow(()=>validateRecord({kind:'apk',source:'import',payload:apk}));
});
test('profile headers distinguish truncated, invalid and unrecognized versions',()=>{
 assert.equal(parseProfileHeader(Buffer.from('pro')).status,'truncated');assert.equal(parseProfileHeader(Buffer.from('bad\0'+'010\0')).status,'invalid-magic');
 assert.equal(parseProfileHeader(Buffer.from('pro\0'+'999\0')).status,'unknown-version');assert.equal(parseProfileHeader(Buffer.from([112,114,111,0,0xb0,0x31,0x30,0])).status,'invalid-version');
 assert.equal(parseProfileHeader(Buffer.from('pro\0'+'010\0'),true).status,'invalid-magic');
});
test('010 profile DEX header parsing checks compressed bounds and conservative checksum matching',async t=>{
 const name=Buffer.from('classes.dex'),row=Buffer.alloc(16);row.writeUInt16LE(name.length,0);row.writeUInt16LE(2,2);row.writeUInt32LE(0x11223344,8);row.writeUInt32LE(12,12);
 const body=Buffer.concat([row,name,Buffer.from([0,0,1,0,0,0,0])]),compressed=deflateSync(body),header=Buffer.alloc(17);header.write('pro\0'+'010\0',0,'binary');header[8]=1;header.writeUInt32LE(body.length,9);header.writeUInt32LE(compressed.length,13);const profile=Buffer.concat([header,compressed]);
 const dex=dexFixture();dex.writeUInt32LE(0x11223344,8);
 const match=parseProfileDexHeaders(profile,[{path:'classes.dex',checksum:0x11223344}]);assert.equal(match.entries[0].match,'checksum-equal');assert.equal(match.entries[0].classes,2);assert.equal(match.entries[0].methodIds,12);
 assert.equal(parseProfileDexHeaders(profile,[{path:'classes.dex',checksum:1}]).entries[0].match,'checksum-different');assert.equal(parseProfileDexHeaders(profile,[]).entries[0].match,'unmatched');
 assert.throws(()=>parseProfileDexHeaders(profile.subarray(0,-1)),/长度不一致/);const bad=Buffer.from(profile);bad.writeUInt32LE(0xffffffff,9);assert.throws(()=>parseProfileDexHeaders(bad),/上限/);
 const dir=await mkdtemp(join(tmpdir(),'apw-profile-body-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'test.apk');await writeFile(path,zipFixture([['AndroidManifest.xml','binary'],['classes.dex',dex],['assets/dexopt/baseline.prof',profile]]));const result=await analyzeApk(path,{aapt2Path:'fixture',runner:aaptRunner});assert.equal(result.profileHeaders[0].body.entries[0].match,'checksum-equal');
});
test('010 profile counts hot, startup, post-startup methods and validates inline-cache bounds',()=>{
 const key=Buffer.from('classes.dex'),row=Buffer.alloc(16);row.writeUInt16LE(key.length,0);row.writeUInt16LE(2,2);row.writeUInt32LE(12,12);
 const hot=Buffer.from([2,0,1,0,3,0,6,3,0,1,0,4,0,1,0,1,2,0]);row.writeUInt32LE(hot.length,4);
 const make=(hotData=hot)=>{const body=Buffer.concat([row,key,hotData,Buffer.from([0,0,1,0,0x24,0,0x02])]),z=deflateSync(body),h=Buffer.alloc(17);h.write('pro\0'+'010\0');h[8]=1;h.writeUInt32LE(body.length,9);h.writeUInt32LE(z.length,13);return Buffer.concat([h,z]);};
 const item=parseProfileDexHeaders(make()).entries[0];assert.equal(item.hotMethods,2);assert.equal(item.startupMethods,2);assert.equal(item.postStartupMethods,1);assert.equal(item.classes,2);
 const bad=Buffer.from(hot);bad[0]=12;assert.throws(()=>parseProfileDexHeaders(make(bad)),/热方法索引/);
 const badCache=Buffer.from(hot);badCache[14]=2;assert.throws(()=>parseProfileDexHeaders(make(badCache)),/缓存 DEX 索引/);
});
test('official AndroidX 010 baseline sample exposes expected DEX metadata',async t=>{
 const path=process.env.APW_ANDROIDX_BASELINE;if(!path){t.skip('设置 APW_ANDROIDX_BASELINE 指向 AndroidX 官方样本');return;}
 const bytes=await readFile(path);assert.equal(createHash('sha256').update(bytes).digest('hex'),'3d256891c99253c9600b9fd34ec3702c799b443dd6f6eee2ac1a7dd07968f3b1');
 const r=parseProfileDexHeaders(bytes);assert.equal(r.entries.length,1);assert.equal(r.entries[0].checksum,147004379);assert.equal(r.entries[0].methodIds,18487);assert.equal(r.entries[0].hotBytes,140);assert.equal(r.entries[0].hotMethods,35);
});
test('official AndroidX multidex profile parses all five DEX records',async t=>{
 const path=process.env.APW_ANDROIDX_MULTIDEX;if(!path){t.skip('设置 APW_ANDROIDX_MULTIDEX 指向 AndroidX 官方多 DEX 样本');return;}
 const bytes=await readFile(path);assert.equal(createHash('sha256').update(bytes).digest('hex'),'fac62f8c666310dbee2053ff73faaf4d9363d8d823a22cab03f99892fe213fb6');
 const r=parseProfileDexHeaders(bytes);assert.deepEqual(r.entries.map(x=>x.name),['classes.dex','classes2.dex','classes3.dex','classes4.dex','classes5.dex']);
 assert.deepEqual(r.entries.map(x=>x.hotMethods),[9049,8810,6066,3893,846]);
 assert.deepEqual(r.entries.map(x=>x.startupMethods),[8963,8734,6024,3883,846]);
});
test('invalid ZIP, absent/duplicate manifest and unsafe paths fail before running AAPT2',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'apw-apk-invalid-'));t.after(()=>rm(dir,{recursive:true,force:true}));let calls=0;
  for(const [name,bytes] of [['bad',Buffer.from('not ZIP')],['missing',zipFixture([['assets/a','x']])],['duplicate',zipFixture([['AndroidManifest.xml','a'],['AndroidManifest.xml','b']])],['unsafe',zipFixture([['../escape','x'],['AndroidManifest.xml','a']])]]){
    const path=join(dir,name+'.apk');await writeFile(path,bytes);await assert.rejects(analyzeApk(path,{aapt2Path:'fixture',runner:async()=>{calls++;return {stdout:''};}}));
  }assert.equal(calls,0);
});
