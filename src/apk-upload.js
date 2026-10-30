import { mkdtemp, open, rm } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { analyzeApk, MAX_APK_BYTES } from './apk.js';

export async function analyzeApkUpload(req, analyze = analyzeApk) {
  const declared = req.headers['content-length'];
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > MAX_APK_BYTES)) {
    req.resume(); throw Object.assign(new Error('APK 文件不能超过 512 MB'), {status:413});
  }
  const name = basename(decodeURIComponent(String(req.headers['x-apk-name'] || 'import.apk'))).slice(0,200);
  if (!name.toLowerCase().endsWith('.apk')) { req.resume(); throw new Error('请选择 .apk 文件'); }
  const folder = await mkdtemp(join(tmpdir(),'apw-apk-')), path = join(folder,'input.apk');
  try {
    const file = await open(path,'wx',0o600); let size=0;
    try {
      // Do not destroy the HTTP socket on a rejected upload; drain it so the JSON error can be delivered.
      for await (const chunk of req.iterator({destroyOnReturn:false})) {
        size+=chunk.length;
        if(size>MAX_APK_BYTES){req.resume();throw Object.assign(new Error('APK 文件不能超过 512 MB'),{status:413});}
        let offset=0;
        while(offset<chunk.length){const {bytesWritten}=await file.write(chunk,offset,chunk.length-offset);if(!bytesWritten)throw new Error('APK 临时文件写入失败');offset+=bytesWritten;}
      }
    } finally { await file.close(); }
    if(!size)throw new Error('APK 文件为空');
    return await analyze(path,{fileName:name});
  } finally { await rm(folder,{recursive:true,force:true}); }
}
