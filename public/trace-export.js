import { summarizeFrameAttribution } from './frame-attribution.js';

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

const REPORT_EVIDENCE_KEYS=['startupTrace','frameTimeline','binderResult','binderBreakdown','gpuTraceDiagnostics','powerRailDiagnostics','composeTraceCorrelation','cpuTraceCorrelation','jankStatsFrameCorrelation','networkTraceCorrelation'];
const MAX_TRACE_REPORT_BYTES=16*1024*1024;
const MAX_PERFETTO_UI_CSV_BYTES=8*1024*1024,MAX_PERFETTO_UI_CSV_ROWS=2000,MAX_PERFETTO_UI_CSV_COLUMNS=50;

export function parsePerfettoUiQueryCsv(text,{maxBytes=MAX_PERFETTO_UI_CSV_BYTES,maxRows=MAX_PERFETTO_UI_CSV_ROWS,maxColumns=MAX_PERFETTO_UI_CSV_COLUMNS}={}){
  if(typeof text!=='string'||new TextEncoder().encode(text).byteLength>maxBytes)throw new Error('Perfetto UI CSV exceeds the supported file size');
  if(!Number.isSafeInteger(maxRows)||maxRows<1||maxRows>10000||!Number.isSafeInteger(maxColumns)||maxColumns<1||maxColumns>50)throw new Error('Perfetto UI CSV bounds are invalid');
  const source=text.charCodeAt(0)===0xfeff?text.slice(1):text,records=[];let row=[],cell='',quoted=false,afterQuote=false,truncated=false;
  for(let i=0;i<source.length;i++){
    const ch=source[i];
    if(quoted){if(ch==='"'){if(source[i+1]==='"'){cell+='"';i++;}else{quoted=false;afterQuote=true;}}else cell+=ch;continue;}
    if(afterQuote&&ch!==','&&ch!=='\r'&&ch!=='\n')throw new Error('Perfetto UI CSV has characters after a quoted field');
    if(ch==='"'){if(cell.length||afterQuote)throw new Error('Perfetto UI CSV has an invalid quote');quoted=true;continue;}
    if(ch===','){row.push(cell);cell='';afterQuote=false;continue;}
    if(ch==='\r'||ch==='\n'){
      if(ch==='\r'&&source[i+1]==='\n')i++;
      row.push(cell);cell='';afterQuote=false;
      if(records.length<maxRows+1)records.push(row);else truncated=true;
      row=[];continue;
    }
    cell+=ch;
  }
  if(quoted)throw new Error('Perfetto UI CSV has an unterminated quoted field');
  if(cell.length||row.length||afterQuote){row.push(cell);if(records.length<maxRows+1)records.push(row);else truncated=true;}
  if(!records.length)throw new Error('Perfetto UI CSV is empty');
  const columns=records[0];
  if(!columns.length||columns.length>maxColumns||columns.some(value=>!value.trim()))throw new Error('Perfetto UI CSV column headers are invalid or exceed the supported bounds');
  const rows=records.slice(1,1+maxRows);
  if(rows.some(record=>record.length!==columns.length))throw new Error('Perfetto UI CSV rows do not match the result columns');
  truncated ||= records.length>maxRows+1;
  return {columns,rows,truncated};
}

export function createTraceAnalysisReport({trace,sqlResult=null,sql='',perfettoUiCsv=null,...evidence}={}) {
  if(!trace||typeof trace!=='object'||typeof trace.sessionId!=='string'||!trace.sessionId)throw new Error('Trace analysis report requires an active trace session');
  const report={
    schema:'android-performance.trace-analysis-report',
    schemaVersion:1,
    generatedAt:new Date().toISOString(),
    trace:{fileName:String(trace.fileName||'trace'),fileBytes:Number.isSafeInteger(trace.fileBytes)?trace.fileBytes:null,bounds:trace.bounds||null,slices:Array.isArray(trace.slices)?trace.slices.slice(0,100):[],threads:Array.isArray(trace.threads)?trace.threads.slice(0,100):[],binder:Array.isArray(trace.binder)?trace.binder.slice(0,100):[],errors:Array.isArray(trace.errors)?trace.errors.slice(0,200):[]},
    customSql:null,
    perfettoUiCsv:null,
    evidence:{}
  };
  if(sqlResult?.sessionId===trace.sessionId){
    const {columns,rows,truncated}=sqlResult;
    if(!Array.isArray(columns)||columns.length<1||columns.length>50||!Array.isArray(rows)||rows.length>500||rows.some(row=>!Array.isArray(row)||row.length!==columns.length))throw new Error('Trace SQL report result is malformed or exceeds the supported bounds');
    report.customSql={query:String(sql),columns:columns.map(String),rows:rows.map(row=>row.map(value=>String(value??''))),truncated:Boolean(truncated)};
  }
  if(perfettoUiCsv?.sessionId===trace.sessionId){
    const {columns,rows,truncated}=perfettoUiCsv;
    if(typeof perfettoUiCsv.fileName!=='string'||perfettoUiCsv.fileName.length>255||!Array.isArray(columns)||columns.length<1||columns.length>MAX_PERFETTO_UI_CSV_COLUMNS||columns.some(value=>typeof value!=='string'||!value.trim()||value.length>1000)||!Array.isArray(rows)||rows.length>MAX_PERFETTO_UI_CSV_ROWS||rows.some(row=>!Array.isArray(row)||row.length!==columns.length||row.some(value=>typeof value!=='string'||value.length>100000)))throw new Error('Perfetto UI CSV report result is malformed or exceeds the supported bounds');
    report.perfettoUiCsv={source:'embedded-perfetto-ui-csv',fileName:perfettoUiCsv.fileName,query:null,columns:[...columns],rows:rows.map(row=>[...row]),truncated:Boolean(truncated)};
  }
  for(const key of REPORT_EVIDENCE_KEYS){
    const value=evidence[key];
    if(value&&typeof value==='object'&&value.sessionId===trace.sessionId)report.evidence[key]=value;
  }
  if(report.evidence.jankStatsFrameCorrelation&&Array.isArray(evidence.jankStatsFrames))report.evidence.jankStatsFrameAttribution=summarizeFrameAttribution(evidence.jankStatsFrames,report.evidence.jankStatsFrameCorrelation);
  return report;
}

export function formatTraceAnalysisReport(input) {
  const serialized=JSON.stringify(createTraceAnalysisReport(input),null,2);
  if(new TextEncoder().encode(serialized).byteLength>MAX_TRACE_REPORT_BYTES)throw new Error('追踪分析报告超过 16 MiB；请缩小 SQL 结果或减少关联数据后重试');
  return `${serialized}\n`;
}
