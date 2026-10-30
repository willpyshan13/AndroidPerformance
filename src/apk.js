import yauzl from 'yauzl';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, stat, readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readApkSigningBlock, certificatesFromPkcs7 } from './apk-signatures.js';

export const MAX_APK_BYTES = 512 * 1024 * 1024;
const exec = promisify(execFile);
export const CATEGORY_NAMES = { dex: 'DEX 代码', native: 'Native 库', resources: 'res 资源', assets: 'assets 资源', table: '资源表', manifest: 'Manifest', signatures: 'META-INF', other: '其他文件', overhead: '容器开销' };
export function apkCategory(path) {
  if (/^classes(?:\d+)?\.dex$/.test(path)) return 'dex';
  if (path.startsWith('lib/')) return 'native';
  if (path.startsWith('res/')) return 'resources';
  if (path.startsWith('assets/')) return 'assets';
  if (path === 'resources.arsc') return 'table';
  if (path === 'AndroidManifest.xml') return 'manifest';
  if (path.startsWith('META-INF/')) return 'signatures';
  return 'other';
}
export async function locateAapt2() {
  const name = process.platform === 'win32' ? 'aapt2.exe' : 'aapt2';
  const candidates = [process.env.AAPT2_PATH, process.resourcesPath && join(process.resourcesPath, 'apk-tools', name),
    join(dirname(dirname(fileURLToPath(import.meta.url))), 'tools/apk-tools', name)].filter(Boolean);
  const roots = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, join(homedir(), 'Library/Android/sdk'), join(homedir(), 'Android/Sdk'), process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Android/Sdk')].filter(Boolean);
  for (const root of roots) {
    try { const versions = (await readdir(join(root, 'build-tools'))).sort((a,b) => b.localeCompare(a, undefined, { numeric: true })); for (const version of versions) candidates.push(join(root, 'build-tools', version, name)); } catch {}
  }
  for (const path of candidates) { try { await access(path); return path; } catch {} }
  return null;
}

function aaptValue(value) {
  if (value.startsWith('"')) {
    const quoted = value.match(/^"((?:\\.|[^"\\])*)"/);
    if (quoted) { try { return JSON.parse(`"${quoted[1]}"`); } catch { return quoted[1]; } }
  }
  if (value === 'true' || value === 'false') return value === 'true';
  if (/^(?:0x[\da-f]+|\d+)$/i.test(value)) return Number(value);
  if (/^\(type 0x12\)0x[\da-f]+$/i.test(value)) return Number(value.match(/0x[\da-f]+$/i)[0])!==0;
  if (/^\(type 0x10\)0x[\da-f]+$/i.test(value)) return Number(value.split(')').at(-1));
  return value;
}
export function parseAaptTree(raw) {
  const stack = []; let root = null, count=0;
  for (const line of raw.split(/\r?\n/)) {
    const element = line.match(/^(\s*)E:\s+([^\s(]+)(?:\s+\(line=(\d+)\))?/);
    if (element) {
      if(++count>50000||element[1].length>256)throw new Error('Manifest 节点数量或深度超过限制');
      const depth = element[1].length, node = { name: element[2], attributes: {}, children: [], line: Number(element[3] || 0) };
      while (stack.length && stack.at(-1).depth >= depth) stack.pop();
      if (stack.length) stack.at(-1).node.children.push(node); else root = node;
      stack.push({ depth, node }); continue;
    }
    const attr = line.match(/^\s*A:\s+([^=]+)=(.*)$/);
    if (attr && stack.length) {
      const name = attr[1].replace(/\(0x[\da-f]+\)$/i, '').replace('http://schemas.android.com/apk/res/android:', 'android:');
      stack.at(-1).node.attributes[name] = aaptValue(attr[2].trim());
    }
  }
  if (root?.name !== 'manifest') throw new Error('AAPT2 未返回有效 Manifest');
  return root;
}
const xmlEscape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function manifestXml(node, depth = 0) {
  const attributes = { ...(depth === 0 ? { 'xmlns:android': 'http://schemas.android.com/apk/res/android' } : {}), ...node.attributes };
  const head = `${'  '.repeat(depth)}<${node.name}${Object.entries(attributes).map(([k,v]) => ` ${k}="${xmlEscape(v)}"`).join('')}`;
  return node.children.length ? `${head}>\n${node.children.map(c => manifestXml(c, depth + 1)).join('\n')}\n${'  '.repeat(depth)}</${node.name}>` : `${head} />`;
}
export function parseApkManifest(badging, treeText) {
  const root = parseAaptTree(treeText), application = root.children.find(n => n.name === 'application');
  const packageLine = badging.split(/\r?\n/).find(l => l.startsWith('package:')) || '';
  const pairs = Object.fromEntries([...packageLine.matchAll(/(\w+)='((?:\\.|[^'\\])*)'/g)].map(m => [m[1], m[2]]));
  const packageName = pairs.name || root.attributes.package;
  const fullName = name => !name ? '' : name.startsWith('.') ? packageName + name : name.includes('.') ? name : `${packageName}.${name}`;
  const sdk = root.children.find(n => n.name === 'uses-sdk')?.attributes || {};
  const sdkLine = name => badging.match(new RegExp(`^${name}:'([^']*)'`, 'm'))?.[1] ?? null;
  const a = application?.attributes || {};
  const components = (application?.children || []).filter(n => ['activity', 'activity-alias', 'service', 'receiver', 'provider'].includes(n.name)).map(node => {
    const attrs = node.attributes;
    return { type: node.name, name: fullName(attrs['android:name']), exported: attrs['android:exported'] ?? null, enabled: attrs['android:enabled'] ?? null,
      permission: attrs['android:permission'] ?? null, authorities: attrs['android:authorities'] ?? null, process: attrs['android:process'] ?? null,
      actions: [...new Set(node.children.filter(c => c.name === 'intent-filter').flatMap(c => c.children.filter(n => n.name === 'action').map(n => n.attributes['android:name'])).filter(Boolean))],
      categories: [...new Set(node.children.filter(c => c.name === 'intent-filter').flatMap(c => c.children.filter(n => n.name === 'category').map(n => n.attributes['android:name'])).filter(Boolean))] };
  });
  const permissions = root.children.filter(n => ['uses-permission', 'uses-permission-sdk-23'].includes(n.name)).map(n => ({ name: n.attributes['android:name'], maxSdk: n.attributes['android:maxSdkVersion'] ?? null, tag: n.name })).filter(n => n.name);
  const label = badging.match(/^application-label:'((?:\\.|[^'\\])*)'/m)?.[1] ?? a['android:label'] ?? null;
  const iconPath = badging.match(/^application:.*\bicon='([^']+)'/m)?.[1] ?? null;
  return { packageName, versionCode: pairs.versionCode ?? root.attributes['android:versionCode'] ?? null, versionName: pairs.versionName ?? root.attributes['android:versionName'] ?? null,
    label, minSdk: sdk['android:minSdkVersion'] ?? sdkLine('minSdkVersion'), targetSdk: sdk['android:targetSdkVersion'] ?? sdkLine('targetSdkVersion'),
    compileSdk: root.attributes['android:compileSdkVersion'] ?? pairs.compileSdkVersion ?? null,
    split: root.attributes.split ?? null, sharedUserId: root.attributes['android:sharedUserId'] ?? null,
    debuggable: a['android:debuggable'] ?? badging.includes('\napplication-debuggable'), allowBackup: a['android:allowBackup'] ?? null,
    usesCleartextTraffic: a['android:usesCleartextTraffic'] ?? null, extractNativeLibs: a['android:extractNativeLibs'] ?? null,
    permissions, components, declaredPermissions:root.children.filter(n=>n.name==='permission').map(n=>({name:n.attributes['android:name'],protectionLevel:n.attributes['android:protectionLevel']??null})),
    features: root.children.filter(n => n.name === 'uses-feature').map(n => ({ name: n.attributes['android:name'] ?? n.attributes['android:glEsVersion'], required: n.attributes['android:required'] ?? null })),
    iconPath, xml: '<?xml version="1.0" encoding="utf-8"?>\n' + manifestXml(root) };
}

export function parseDexHeader(bytes) {
  if (bytes.length < 112 || !/^dex\n\d{3}\0$/.test(bytes.subarray(0,8).toString('ascii'))) throw new Error('无效或不支持的 DEX 文件头');
  if (bytes.readUInt32LE(40) !== 0x12345678) throw new Error('不支持此 DEX 字节序');
  return { version: bytes.subarray(4,7).toString(), declaredBytes: bytes.readUInt32LE(32), stringIds: bytes.readUInt32LE(56), typeIds: bytes.readUInt32LE(64), methodIds: bytes.readUInt32LE(88), classDefs: bytes.readUInt32LE(96) };
}
function openZip(path) { return new Promise((resolve,reject) => yauzl.open(path, { lazyEntries: true, autoClose: false, validateEntrySizes: true, strictFileNames: true }, (error,zip) => error ? reject(error) : resolve(zip))); }
function entryStream(zip,entry) { return new Promise((resolve,reject) => zip.openReadStream(entry, (error,stream) => error ? reject(error) : resolve(stream))); }
async function entryBytes(zip, entry, limit, prefix = false) {
  if (!prefix && entry.uncompressedSize > limit) throw new Error(`${entry.fileName} 超过读取限制`);
  const stream = await entryStream(zip, entry), chunks = []; let size = 0;
  try { for await (const chunk of stream) { const remaining = limit - size; if (!prefix && chunk.length > remaining) throw new Error('ZIP 实际展开数据超过限制'); chunks.push(chunk.subarray(0, remaining)); size += Math.min(chunk.length,remaining); if (prefix && size === limit) break; } }
  finally { stream.destroy(); }
  return Buffer.concat(chunks);
}
async function zipEntries(zip) {
  return new Promise((resolve,reject) => {
    const entries = []; let unpacked = 0;
    zip.once('error', reject); zip.on('entry', entry => {
      entries.push(entry); unpacked += entry.uncompressedSize;
      if (entries.length > 50000 || unpacked > 8 * 1024 ** 3 || Buffer.byteLength(entry.fileName) > 2048) { reject(new Error('APK 超过 50,000 个条目、8 GB 展开量或路径长度限制')); zip.close(); return; }
      zip.readEntry();
    }); zip.once('end', () => resolve(entries)); zip.readEntry();
  });
}
export async function analyzeApk(path, { fileName = basename(path), aapt2Path, runner = exec } = {}) {
  const info = await stat(path); if (!info.isFile() || info.size > MAX_APK_BYTES) throw new Error('请选择不超过 512 MB 的 APK 文件');
  let zip;
  try { zip=await openZip(path); } catch(error) { throw new Error('APK ZIP 结构无效或文件已损坏：'+error.message); }
  const warnings = [];
  try {
    const entries = await zipEntries(zip), files = entries.filter(e => !e.fileName.endsWith('/'));
    const manifests = files.filter(e => e.fileName === 'AndroidManifest.xml');
    if (manifests.length !== 1 || manifests[0].uncompressedSize > 8 * 1024 * 1024) throw new Error('APK 必须包含唯一、且不超过 8 MB 的 AndroidManifest.xml');
    if (files.some(e => e.generalPurposeBitFlag & 1)) throw new Error('不支持加密的 APK ZIP 条目');
    const names = new Set();
    for (const entry of files) { if (names.has(entry.fileName)) throw new Error('APK 含重名 ZIP 条目，无法给出无歧义分析'); names.add(entry.fileName); }
    const tool = aapt2Path ?? await locateAapt2();
    if (!tool) throw new Error('未找到 AAPT2：桌面版应包含解析器，源码运行可设置 AAPT2_PATH');
    let badging, tree;
    try {
      const results = await Promise.allSettled([['dump','badging',path], ['dump','xmltree',path,'--file','AndroidManifest.xml']].map(async args => (await runner(tool,args,{timeout:60000,maxBuffer:16*1024*1024,encoding:'utf8',windowsHide:true})).stdout));
      const failure=results.find(r=>r.status==='rejected');if(failure)throw failure.reason;
      [badging,tree]=results.map(r=>r.value);
    } catch (error) { throw new Error(`AAPT2 解析失败：${String(error.stderr || error.message).slice(0,800)}`); }
    const manifest = parseApkManifest(badging, tree);
    const categories = Object.entries(CATEGORY_NAMES).map(([key,label]) => ({ key,label,compressedBytes:0,uncompressedBytes:0,count:0 }));
    const groups = Object.fromEntries(categories.map(g => [g.key,g]));
    let compressedBytes=0,uncompressedBytes=0;
    const fileList = files.map(entry => {
      const category = apkCategory(entry.fileName), group = groups[category];
      compressedBytes += entry.compressedSize; uncompressedBytes += entry.uncompressedSize;
      group.compressedBytes += entry.compressedSize; group.uncompressedBytes += entry.uncompressedSize; group.count++;
      return { path:entry.fileName,category,compressedBytes:entry.compressedSize,uncompressedBytes:entry.uncompressedSize,method:entry.compressionMethod,crc32:entry.crc32.toString(16).padStart(8,'0') };
    }).sort((a,b) => b.compressedBytes-a.compressedBytes || a.path.localeCompare(b.path));
    if (compressedBytes > info.size) throw new Error('ZIP 压缩体积汇总异常');
    groups.overhead.compressedBytes = info.size-compressedBytes;
    const dex=[];
    for (const entry of files.filter(e => /^classes(?:\d+)?\.dex$/.test(e.fileName))) {
      try { const header=parseDexHeader(await entryBytes(zip,entry,112,true)); dex.push({path:entry.fileName,...header}); if (header.version==='041') warnings.push(`${entry.fileName} 为 DEX 041，当前只统计首个容器文件头`); }
      catch(error) { dex.push({path:entry.fileName,error:error.message}); warnings.push(`${entry.fileName}：${error.message}`); }
    }
    dex.sort((a,b)=>a.path.localeCompare(b.path,undefined,{numeric:true}));
    const abiMap = new Map();
    for (const entry of fileList) { const m=entry.path.match(/^lib\/([^/]+)\/.+\.so$/); if(m){const abi=abiMap.get(m[1])||{name:m[1],count:0,compressedBytes:0,uncompressedBytes:0};abi.count++;abi.compressedBytes+=entry.compressedBytes;abi.uncompressedBytes+=entry.uncompressedBytes;abiMap.set(m[1],abi);} }
    const signatures = await readApkSigningBlock(path,info.size);
    const v1 = files.filter(e=>/^META-INF\/[^/]+\.(?:RSA|DSA|EC)$/i.test(e.fileName));
    if(v1.length)signatures.detectedSchemes.unshift('v1');
    for(const [index,entry] of v1.slice(0,16).entries()) { try { signatures.certificates.push(...certificatesFromPkcs7(await entryBytes(zip,entry,4*1024*1024)).map(c=>({...c,signer:index+1}))); } catch(error){signatures.warnings.push(`${entry.fileName}：${error.message}`);} }
    signatures.certificates=signatures.certificates.filter((cert,index,list)=>list.findIndex(c=>c.sha256===cert.sha256&&c.scheme===cert.scheme&&c.signer===cert.signer)===index);
    warnings.push(...signatures.warnings);
    let icon=null;
    const iconEntry=manifest.iconPath&&files.find(e=>e.fileName===manifest.iconPath&&/\.png$/i.test(e.fileName));
    if(iconEntry&&iconEntry.uncompressedSize<=2*1024*1024){try{const png=await entryBytes(zip,iconEntry,2*1024*1024);if(png.subarray(0,8).toString('hex')==='89504e470d0a1a0a')icon=`data:image/png;base64,${png.toString('base64')}`;}catch(error){warnings.push('图标未读取：'+error.message);}}
    const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);
    return { schemaVersion:1,source:'import',kind:'apk',timestamp:Date.now(),packageName:manifest.packageName,
      fileName:basename(fileName).slice(0,200),sizeBytes:info.size,sha256:hash.digest('hex'),fileCount:files.length,compressedBytes,uncompressedBytes,
      categories:categories.filter(c=>c.count||c.key==='overhead'),files:fileList,manifest,dex,abis:[...abiMap.values()],signatures,icon,warnings,
      notes:['体积按 ZIP 条目统计；容器开销包括 ZIP 结构、签名块与填充。展开体积不是安装占用。','DEX 方法数为各文件 method_ids 数量，跨 DEX 可重复，不等于应用自行定义的方法数。','证书与签名方案仅做提取和识别，未验证 APK 内容签名、信任链或安装兼容性。','仅分析单个 APK；split APK 只表示当前分片，不会自动合并其他分片。'] };
  } finally { zip.close(); }
}
