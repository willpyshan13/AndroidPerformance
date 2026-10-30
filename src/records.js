// Validate imported evidence before it reaches the renderer or local archive.
const validNumber = (value, min = 0) => typeof value === 'number' && Number.isFinite(value) && value >= min;
const optionalNumber = (value, min = 0) => value === null || value === undefined || validNumber(value, min);
const fail = message => { throw new Error(`记录数据无效：${message}`); };
export function validateRecord(body) {
  if (!['monitor', 'frames', 'startup', 'layout', 'network', 'apk'].includes(body.kind)) fail('不支持的分析类型');
  if (!['adb', 'demo', 'import'].includes(body.source)) fail('来源必须为 adb / demo / import');
  const p = body.payload;
  if (!p || typeof p !== 'object' || Array.isArray(p)) fail('缺少 payload');
  if (body.kind === 'monitor') {
    if (!Array.isArray(p.samples) || !p.samples.length || p.samples.length > 1800) fail('监控样本须为 1–1,800 条');
    for (const s of p.samples) {
      if (!s || !validNumber(s.timestamp) || s.source !== body.source) fail('样本时间或来源不一致');
      if (!optionalNumber(s.cpu?.percent) || !optionalNumber(s.memory?.pssMb) || !optionalNumber(s.battery?.level) || !optionalNumber(s.battery?.temperatureC, -273.15)) fail('样本指标类型错误');
      if (s.warnings && (!Array.isArray(s.warnings) || !s.warnings.every(w => typeof w === 'string'))) fail('warnings 格式错误');
      if (s.memory?.categories && !Object.values(s.memory.categories).every(v => validNumber(v))) fail('内存组成格式错误');
    }
  }
  if (body.kind === 'frames') {
    if (![16.667, 11.111, 8.333].includes(p.budgetMs) || !Array.isArray(p.frames) || p.frames.length > 50000 || p.count !== p.frames.length) fail('帧预算或帧数量错误');
    if (!p.frames.every(row => row && validNumber(row.index) && validNumber(row.durationMs))) fail('帧耗时格式错误');
    for (const field of ['slowPercent', 'p50', 'p90', 'p95', 'p99', 'max']) if (!optionalNumber(p[field])) fail('帧汇总指标格式错误');
  }
  if (body.kind === 'startup') {
    if (!['cold', 'warm', 'hot'].includes(p.requestedMode) || !Array.isArray(p.results) || !p.results.length || p.results.length > 10) fail('启动实验格式错误');
    if (!p.results.every(row => row && validNumber(row.totalTimeMs) && validNumber(row.run))) fail('启动实验缺少 TotalTime');
    if (!validNumber(p.meanMs)) fail('缺少平均启动耗时');
  }
  if (body.kind === 'layout') {
    if (typeof p.xml !== 'string' || p.xml.length > 2 * 1024 * 1024 || !p.xml.includes('<hierarchy') || /<!DOCTYPE|<!ENTITY/i.test(p.xml)) fail('层级 XML 格式不支持');
    if (p.screenshot && (typeof p.screenshot !== 'string' || !/^[A-Za-z0-9+/=\r\n]+$/.test(p.screenshot))) fail('截图须为 Base64 PNG');
    if (p.screenshot) {
      const png = Buffer.from(p.screenshot, 'base64');
      if (png.length < 24 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') fail('截图内容不是 PNG');
    }
    if (p.imageSize && (!validNumber(p.imageSize.width, 1) || !validNumber(p.imageSize.height, 1) || p.imageSize.width > 100000 || p.imageSize.height > 100000)) fail('截图尺寸无效');
  }
  if (body.kind === 'network') {
    if (!Array.isArray(p.rows) || p.rows.length > 50000) fail('网络请求数量错误');
    if (!p.rows.every(r => r && validNumber(r.id) && typeof r.path === 'string' && typeof r.host === 'string' && typeof r.method === 'string' && validNumber(r.status) && optionalNumber(r.timeMs) && optionalNumber(r.bytes))) fail('网络请求字段错误');
  }
  if(body.kind==='apk'){
    if(p.kind!=='apk'||typeof p.fileName!=='string'||!validNumber(p.sizeBytes,1)||typeof p.sha256!=='string'||!/^[\da-f]{64}$/.test(p.sha256))fail('APK 文件信息错误');
    if(!p.manifest||typeof p.manifest.packageName!=='string'||typeof p.manifest.xml!=='string'||!Array.isArray(p.manifest.permissions)||!Array.isArray(p.manifest.components))fail('APK Manifest 数据错误');
    if(!p.manifest.permissions.every(r=>r&&typeof r.name==='string')||!p.manifest.components.every(c=>c&&typeof c.name==='string'&&typeof c.type==='string'&&Array.isArray(c.actions)&&Array.isArray(c.categories)))fail('APK 权限或组件字段错误');
    if(!Array.isArray(p.files)||p.files.length>50000||!p.files.every(f=>f&&typeof f.path==='string'&&typeof f.category==='string'&&validNumber(f.compressedBytes)&&validNumber(f.uncompressedBytes)))fail('APK 文件列表错误');
    if(p.fileCount!==p.files.length||!validNumber(p.compressedBytes)||!validNumber(p.uncompressedBytes))fail('APK 文件汇总不一致');
    if(!Array.isArray(p.categories)||!p.categories.every(c=>c&&typeof c.key==='string'&&typeof c.label==='string'&&validNumber(c.count)&&validNumber(c.compressedBytes)))fail('APK 分类汇总错误');
    if(!Array.isArray(p.dex)||!Array.isArray(p.abis)||!p.signatures||!Array.isArray(p.signatures.certificates)||!Array.isArray(p.signatures.detectedSchemes)||!Array.isArray(p.warnings))fail('APK 分析结构错误');
    if(!p.dex.every(d=>d&&typeof d.path==='string')||!p.abis.every(a=>a&&typeof a.name==='string'&&validNumber(a.count)&&validNumber(a.compressedBytes)&&validNumber(a.uncompressedBytes)))fail('APK DEX 或 ABI 字段错误');
    if(!p.signatures.certificates.every(c=>c&&typeof c.subject==='string'&&typeof c.issuer==='string'&&typeof c.sha256==='string')||!p.signatures.detectedSchemes.every(s=>typeof s==='string')||!p.warnings.every(s=>typeof s==='string'))fail('APK 签名或警告字段错误');
    if(p.manifest.declaredPermissions!==undefined&&(!Array.isArray(p.manifest.declaredPermissions)||!p.manifest.declaredPermissions.every(r=>r&&typeof r.name==='string')))fail('APK 自定义权限格式错误');
    if(p.icon&&(typeof p.icon!=='string'||!/^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(p.icon)))fail('APK 图标格式错误');
  }
  if (p.source && p.source !== body.source) fail('payload 来源与记录来源不一致');
}
