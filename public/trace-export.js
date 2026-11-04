function csvCell(value) {
  let text=String(value??'');
  if(/^[\s\u0000-\u001f]*[=+\-@]/.test(text))text=`'${text}`;
  return `"${text.replaceAll('"','""')}"`;
}

export function formatTraceQueryCsv(columns,rows,{maxRows=500}={}) {
  if(!Number.isInteger(maxRows)||maxRows<0||maxRows>2000||!Array.isArray(columns)||columns.length<1||columns.length>50||!Array.isArray(rows)||rows.length>maxRows)throw new Error('Trace query CSV exceeds the supported result bounds');
  if(rows.some(row=>!Array.isArray(row)||row.length!==columns.length))throw new Error('Trace query CSV rows do not match the result columns');
  return `\uFEFF${[columns,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n')}${rows.length?'\r\n':''}`;
}

const REPORT_EVIDENCE_KEYS=['startupTrace','frameTimeline','binderResult','binderBreakdown','gpuTraceDiagnostics','powerRailDiagnostics','composeTraceCorrelation','cpuTraceCorrelation'];
const MAX_TRACE_REPORT_BYTES=16*1024*1024;

export function createTraceAnalysisReport({trace,sqlResult=null,sql='',...evidence}={}) {
  if(!trace||typeof trace!=='object'||typeof trace.sessionId!=='string'||!trace.sessionId)throw new Error('Trace analysis report requires an active trace session');
  const report={
    schema:'android-performance.trace-analysis-report',
    schemaVersion:1,
    generatedAt:new Date().toISOString(),
    trace:{fileName:String(trace.fileName||'trace'),fileBytes:Number.isSafeInteger(trace.fileBytes)?trace.fileBytes:null,bounds:trace.bounds||null,slices:Array.isArray(trace.slices)?trace.slices.slice(0,100):[],threads:Array.isArray(trace.threads)?trace.threads.slice(0,100):[],binder:Array.isArray(trace.binder)?trace.binder.slice(0,100):[],errors:Array.isArray(trace.errors)?trace.errors.slice(0,200):[]},
    customSql:null,
    evidence:{}
  };
  if(sqlResult?.sessionId===trace.sessionId){
    const {columns,rows,truncated}=sqlResult;
    if(!Array.isArray(columns)||columns.length<1||columns.length>50||!Array.isArray(rows)||rows.length>500||rows.some(row=>!Array.isArray(row)||row.length!==columns.length))throw new Error('Trace SQL report result is malformed or exceeds the supported bounds');
    report.customSql={query:String(sql),columns:columns.map(String),rows:rows.map(row=>row.map(value=>String(value??''))),truncated:Boolean(truncated)};
  }
  for(const key of REPORT_EVIDENCE_KEYS){
    const value=evidence[key];
    if(value&&typeof value==='object'&&value.sessionId===trace.sessionId)report.evidence[key]=value;
  }
  return report;
}

export function formatTraceAnalysisReport(input) {
  const serialized=JSON.stringify(createTraceAnalysisReport(input),null,2);
  if(new TextEncoder().encode(serialized).byteLength>MAX_TRACE_REPORT_BYTES)throw new Error('追踪分析报告超过 16 MiB；请缩小 SQL 结果或减少关联数据后重试');
  return `${serialized}\n`;
}
