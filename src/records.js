// Validate imported evidence before it reaches the renderer or local archive.
const validNumber = (value, min = 0) => typeof value === 'number' && Number.isFinite(value) && value >= min;
const optionalNumber = (value, min = 0) => value === null || value === undefined || validNumber(value, min);
const fail = message => { throw new Error(`记录数据无效：${message}`); };
export function validateRecord(body) {
  if (!['monitor', 'frames', 'startup', 'layout', 'network', 'apk', 'battery', 'benchmark'].includes(body.kind)) fail('不支持的分析类型');
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
    for(const snapshot of [p.compilationBefore,p.compilationAfter])if(snapshot!==undefined&&snapshot!==null){
      if(!snapshot||typeof snapshot.available!=='boolean'||!validNumber(snapshot.timestamp)||!Array.isArray(snapshot.entries)||snapshot.entries.length>1000||!snapshot.entries.every(e=>e&&typeof e.path==='string'&&typeof e.isa==='string'&&typeof e.status==='string'&&(e.reason===null||typeof e.reason==='string')))fail('编译状态格式错误');
      if(snapshot.source!==body.source||snapshot.packageName!==p.packageName||snapshot.serial!==p.serial)fail('编译状态来源不一致');
    }
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
  if (body.kind === 'benchmark') {
    if(body.source!=='import'||typeof p.fileName!=='string'||p.fileName.length>255||!p.context||typeof p.context!=='object'||!Array.isArray(p.results)||!p.results.length||p.results.length>50000)fail('Benchmark 运行格式错误');
    if(p.origin!==undefined&&(!p.origin||p.origin.kind!=='device'||typeof p.origin.serial!=='string'||p.origin.serial.length>200||typeof p.origin.path!=='string'||p.origin.path.length>500||!Number.isFinite(p.origin.readAt)))fail('Benchmark 设备来源格式错误');
    for(const row of p.results){
      if(!row||typeof row.key!=='string'||typeof row.name!=='string'||typeof row.className!=='string'||typeof row.metric!=='string'||!['metrics','sampledMetrics'].includes(row.metricType)||typeof row.median!=='number'||!Number.isFinite(row.median)||!Number.isSafeInteger(row.runs)||row.runs<0||!Array.isArray(row.samples)||row.samples.length!==row.runs||row.samples.length>100000||!row.samples.every(n=>typeof n==='number'&&Number.isFinite(n)))fail('Benchmark 指标格式错误');
      if(row.runInfo!==undefined&&(!row.runInfo||typeof row.runInfo!=='object'||Array.isArray(row.runInfo)||Object.entries(row.runInfo).some(([key,value])=>!['warmupIterations','repeatIterations','thermalThrottleSleepSeconds','totalRunTimeNs'].includes(key)||!Number.isSafeInteger(value)||value<0)))fail('Benchmark 运行信息格式错误');
      if(row.sampleGroups!==undefined){
        if(row.metricType!=='sampledMetrics'||!Array.isArray(row.sampleGroups)||row.sampleGroups.length>100000||row.sampleGroups.length!==row.iterations)fail('Benchmark 迭代分组格式错误');
        let i=0;for(const group of row.sampleGroups){if(!Array.isArray(group))fail('Benchmark 迭代分组格式错误');for(const n of group){if(i>=row.samples.length||n!==row.samples[i++])fail('Benchmark 迭代分组与样本不一致');}}if(i!==row.samples.length)fail('Benchmark 迭代分组与样本不一致');
      }
      if(!row.params||typeof row.params!=='object'||Array.isArray(row.params)||Object.keys(row.params).length>100||Object.values(row.params).some(v=>v!==null&&(!['string','number','boolean'].includes(typeof v)||(typeof v==='number'&&!Number.isFinite(v)))))fail('Benchmark 参数格式错误');
      const params=Object.fromEntries(Object.entries(row.params).sort(([a],[b])=>a.localeCompare(b)));
      if(row.key!==JSON.stringify([row.className,row.name,params,row.metricType,row.metric]))fail('Benchmark 指标标识不一致');
    }
  }
  if (body.kind === 'battery') {
    const validateSnapshot = snapshot => {
      if (!snapshot || snapshot.source !== body.source || !Number.isSafeInteger(snapshot.uid) || snapshot.uid < 0 || typeof snapshot.packageName !== 'string' || !Array.isArray(snapshot.packages) || !snapshot.packages.every(x => typeof x === 'string') || !validNumber(snapshot.timestamp) || typeof snapshot.version !== 'string') fail('电池快照标识错误');
      if(snapshot.power!==undefined&&snapshot.power!==null&&(!snapshot.power||snapshot.power.source!=='batterystats-pwi'||!validNumber(snapshot.power.estimatedMah)||typeof snapshot.power.rawValue!=='string'||!/^\d+(?:\.\d+)?$/.test(snapshot.power.rawValue)||Number(snapshot.power.rawValue)!==snapshot.power.estimatedMah))fail('UID 耗电估计格式错误');
      if (snapshot.network !== null && (!snapshot.network || typeof snapshot.network !== 'object' || !Object.values(snapshot.network).every(v => optionalNumber(v)))) fail('网络统计格式错误');
      for (const key of ['wakelocks', 'jobs', 'syncs', 'sensors', ...(snapshot.alarms === undefined ? [] : ['alarms'])]) if (!Array.isArray(snapshot[key]) || snapshot[key].length > 200000 || !snapshot[key].every(r => r && typeof r.name === 'string' && (key === 'wakelocks' ? r.partial === null || (r.partial && optionalNumber(r.partial.timeMs) && optionalNumber(r.partial.count)) : optionalNumber(r.timeMs) && optionalNumber(r.count)))) fail('资源统计格式错误');
    };
    if (p.snapshot) {
      validateSnapshot(p.snapshot); if (p.before !== null && p.before !== undefined) validateSnapshot(p.before);
      if (p.packageName !== p.snapshot.packageName) fail('电池实验包名不一致');
      if (p.samples !== undefined) {
        if (!Array.isArray(p.samples) || p.samples.length < 2 || p.samples.length > 50) fail('电池重复采样数量错误');
        let previousTimestamp=-Infinity;
        for(const sample of p.samples){
          validateSnapshot(sample);
          if(sample.packageName!==p.packageName||sample.uid!==p.snapshot.uid||sample.serial!==p.snapshot.serial||sample.timestamp<=previousTimestamp)fail('电池重复采样的设备、应用或时间顺序不一致');
          previousTimestamp=sample.timestamp;
        }
        if(p.samples.at(-1).timestamp!==p.snapshot.timestamp)fail('电池结束快照与最后一个样本不一致');
      }
    }
    else validateSnapshot(p); // Early single-snapshot records remain readable.
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
