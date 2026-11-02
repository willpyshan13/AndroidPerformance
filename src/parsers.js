export function parseDevices(raw) {
  return raw.split(/\r?\n/).filter(line => line && !line.startsWith('List ') && !line.startsWith('*'))
    .map(line => {
      const [serial, state, ...tags] = line.trim().split(/\s+/);
      const properties = Object.fromEntries(tags.filter(t => t.includes(':')).map(t => {
        const i = t.indexOf(':'); return [t.slice(0, i), t.slice(i + 1)];
      }));
      return { ...properties, serial, state, model: (properties.model || serial).replaceAll('_', ' ') };
    }).filter(d => d.serial && d.state);
}

export function parseMemory(raw) {
  const total = raw.match(/TOTAL PSS:\s*([\d,]+)/i) || raw.match(/^\s*TOTAL\s+([\d,]+)/m);
  const amount = match => match ? Number(match[1].replaceAll(',', '')) / 1024 : null;
  const categories = {};
  for (const label of ['Java Heap', 'Native Heap', 'Code', 'Stack', 'Graphics', 'Private Other', 'System']) {
    const match = raw.match(new RegExp(`^\\s*${label}:\\s*([\\d,]+)`, 'm'));
    if (match) categories[label] = amount(match);
  }
  return { pssMb: amount(total), rssMb: amount(raw.match(/TOTAL RSS:\s*([\d,]+)/i)), categories };
}

export function parseCpu(raw, packageName) {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^\\s*\\+?([\\d.]+)%\\s+(\\d+)\\/(${escaped}(?::[^\\s:]+)?):\\s*(.*)$`);
  const processes = raw.split(/\r?\n/).flatMap(line => {
    const m = line.match(pattern);
    return m ? [{ pid: Number(m[2]), name: m[3], cpu: Number(m[1]), detail: m[4] }] : [];
  });
  // Absence from cpuinfo is not evidence of zero utilization.
  const window = raw.split(/\r?\n/).find(line => /CPU usage from/.test(line)) || null;
  const ageMs = window?.match(/to\s+(\d+)ms ago/)?.[1];
  const stale = ageMs !== undefined && Number(ageMs) > 30000;
  return { percent: processes.length && !stale ? processes.reduce((sum, p) => sum + p.cpu, 0) : null, processes,
    method: 'dumpsys', scope: 'application-processes', window, ageMs: ageMs === undefined ? null : Number(ageMs), stale };
}

export function parseProcCpu(raw) {
  const lines = raw.split(/\r?\n/);
  const totals = lines.find(line => /^cpu\s/.test(line))?.trim().split(/\s+/).slice(1, 9).map(Number);
  const cpuCount = lines.filter(line => /^cpu\d+\s/.test(line)).length;
  const process = lines.find(line => /^\d+\s+\(/.test(line));
  const close = process?.lastIndexOf(')');
  const fields = close !== undefined && close > 0 ? process.slice(close + 1).trim().split(/\s+/) : [];
  const pid = Number(process?.match(/^(\d+)\s/)?.[1]);
  // fields[0] is Linux stat field 3 (state); 14/15 are utime/stime, 22 is starttime.
  const ticks = Number(fields[11]) + Number(fields[12]), startTicks = Number(fields[19]);
  if (!totals || totals.length < 4 || !totals.every(n => Number.isSafeInteger(n) && n >= 0) || !cpuCount || !pid || fields.length < 20 || !Number.isSafeInteger(ticks) || !Number.isSafeInteger(startTicks)) throw new Error('无法读取有效的 /proc CPU 计数器');
  // guest and guest_nice are already included in user/nice and must not be counted again.
  return { pid, ticks, startTicks, totalTicks: totals.reduce((a, b) => a + b, 0), cpuCount };
}

export function cpuDelta(previous, current) {
  if (!previous || previous.pid !== current.pid || previous.startTicks !== current.startTicks || previous.cpuCount !== current.cpuCount) return null;
  const total = current.totalTicks - previous.totalTicks, ticks = current.ticks - previous.ticks;
  if (total <= 0 || ticks < 0) return null;
  // One fully used CPU core is 100%; only compare intervals with an unchanged online CPU count.
  return ticks / total * current.cpuCount * 100;
}

export function percentile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)];
}

export function parseFrames(raw, budgetMs = 16.667) {
  const frames = [];
  let columns = null, active = false, section = 0, rawIndex = 0;
  const timestampFields = ['IntendedVsync','Vsync','HandleInputStart','AnimationStart','PerformTraversalsStart','DrawStart','SyncQueued','SyncStart','IssueDrawCommandsStart','SwapBuffers','FrameCompleted'];
  for (const line of raw.split(/\r?\n/)) {
    if (line.includes('---PROFILEDATA---')) { active = !active; columns = null; if(active){section++;rawIndex=0;} continue; }
    if (!active) continue;
    const cells = line.trim().split(',').map(s => s.trim());
    if (cells[0] === 'Flags') { columns = cells; continue; }
    if (!columns || !line.trim()) continue;
    rawIndex++;
    if(cells.length < columns.length)continue;
    const get = name => {const i=columns.indexOf(name);return i<0?undefined:cells[i];};
    const startText=get('IntendedVsync'),endText=get('FrameCompleted');
    if(get('Flags')!=='0'||!/^\d{1,19}$/.test(startText||'')||!/^\d{1,19}$/.test(endText||''))continue;
    const start=BigInt(startText),end=BigInt(endText);
    if(start<=0n||end<=start||end>=9000000000000000000n)continue;
    const durationMs=Number(end-start)/1e6;
    const timestamps=Object.fromEntries(timestampFields.flatMap(name=>{const v=get(name);return /^\d{1,19}$/.test(v||'')&&BigInt(v)>0n&&BigInt(v)<9000000000000000000n?[[name,v]]:[];}));
    frames.push({index:frames.length+1,startNs:Number(start),startNsExact:startText,durationMs,overBudget:durationMs>budgetMs,section,rawIndex,timestamps});
  }
  const durations=frames.map(f=>f.durationMs),slow=frames.filter(f=>f.overBudget).length;
  if(!frames.length){
    const histogram=raw.match(/^\s*HISTOGRAM:\s*(.+)$/m)?.[1],buckets=[];
    for(const match of histogram?.matchAll(/(?:^|\s)(\d+(?:\.\d+)?)ms=(\d+)(?=\s|$)/g)||[]){const upperMs=Number(match[1]),count=Number(match[2]);if(Number.isFinite(upperMs)&&Number.isSafeInteger(count)&&count>0)buckets.push({upperMs,count});}
    const count=buckets.reduce((sum,b)=>sum+b.count,0);
    if(count){const quantile=q=>{let cumulative=0;for(const bucket of buckets){cumulative+=bucket.count;if(cumulative>=Math.ceil(count*q))return bucket.upperMs;}return buckets.at(-1).upperMs;};const reported=q=>{const value=raw.match(new RegExp(`^\\s*${q}th percentile:\\s*([\\d.]+)ms`,'m'))?.[1];return value===undefined?null:Number(value);};const values=[50,90,95,99].map(reported),max=buckets.at(-1).upperMs;
      return {frames,count,budgetMs,slow:null,slowPercent:null,p50:values[0]??quantile(.5),p90:values[1]??quantile(.9),p95:values[2]??quantile(.95),p99:values[3]??quantile(.99),percentileSource:values.every(value=>value!==null)?'platform':'mixed',max,platformJank:raw.match(/^\s*Janky frames:\s*(\d+)/m)?.[1]??null,sourceFormat:'histogram',histogramBuckets:buckets,note:`${values.every(value=>value!==null)?'分位数采用设备 gfxinfo 报告值':'设备未报告的分位数采用直方图桶上界估算'}；设备未提供逐帧时间戳，不能计算精确超预算比例或时间线。`};
    }
  }
  return {frames,count:frames.length,budgetMs,slow,slowPercent:frames.length?slow/frames.length*100:null,
    p50:percentile(durations,.5),p90:percentile(durations,.9),p95:percentile(durations,.95),p99:percentile(durations,.99),
    max:durations.length?durations.reduce((a,b)=>Math.max(a,b),0):null,
    platformJank:raw.match(/^\s*Janky frames:\s*(\d+)/m)?.[1]??null,sourceFormat:'framestats'};
}

export function parseBattery(raw) {
  const value = key => { const m = raw.match(new RegExp(`^\\s*${key}:\\s*(-?[\\d.]+)`, 'm')); return m ? Number(m[1]) : null; };
  const temperature = value('temperature'), level = value('level'), scale = value('scale');
  return { level: level !== null && scale > 0 ? level / scale * 100 : null,
    temperatureC: temperature !== null ? temperature / 10 : null, voltageMv: value('voltage'), status: value('status'),
    scope: 'device' };
}

export function parseStartup(raw) {
  const value = key => { const match = raw.match(new RegExp(`^${key}:\\s*(\\d+)`, 'm')); return match ? Number(match[1]) : null; };
  const status = raw.match(/^Status:\s*(.+)/m)?.[1]?.trim();
  return { status: status || 'unknown', thisTimeMs: value('ThisTime'), totalTimeMs: value('TotalTime'), waitTimeMs: value('WaitTime'),
    observedMode: raw.match(/^LaunchState:\s*(.+)/m)?.[1]?.trim()?.toLowerCase() || null,
    activity: raw.match(/^Activity:\s*(.+)/m)?.[1]?.trim() || null, raw };
}

// Only accept the exact package subtree under Dexopt state. Dumpsys output is
// human-readable and differs by platform version; unknown formats stay empty.
export function parseCompilationState(raw, packageName) {
  const lines=String(raw).split(/\r?\n/),indent=line=>line.match(/^\s*/)[0].length;
  const heading=lines.findIndex(line=>/^\s*Dexopt\s+state\s*:?\s*$/i.test(line));
  if(heading<0)return {available:false,entries:[],reason:'设备未提供可识别的 Dexopt state'};
  const base=indent(lines[heading]);let selected=false,packageIndent=-1,path=null,entries=[];
  for(let i=heading+1;i<lines.length;i++){
    const line=lines[i];if(!line.trim())continue;const level=indent(line),text=line.trim();
    if(level<=base)break;
    const packageLine=text.match(/^\[([^\]]+)\]\s*$/);
    if(packageLine){selected=packageLine[1]===packageName;packageIndent=level;path=null;continue;}
    if(!selected)continue;
    if(level<=packageIndent){selected=false;path=null;continue;}
    const pathMatch=text.match(/^(?:path:\s*)?(\/\S+\.(?:apk|jar|dex))\s*$/i);
    if(pathMatch){path=pathMatch[1];continue;}
    const row=text.match(/^([\w.-]+):\s*\[status=([^\]]+)\](?:\s*\[reason=([^\]]+)\])?/i);
    if(row&&path){entries.push({path,isa:row[1],status:row[2],reason:row[3]||null});if(entries.length>=1000)break;}
  }
  return {available:entries.length>0,entries,reason:entries.length?null:'未找到该应用可识别的编译状态'};
}
