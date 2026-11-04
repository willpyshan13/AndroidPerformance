const MAX_SHARK_REPORT_CHARACTERS=12*1024*1024;

function boundedText(value,max=512){
  return typeof value==='string'?value.slice(0,max):null;
}

export function sharkReportJson(result,{sourceFileName=null,mappingFileName=null}={}){
  if(!result||typeof result.report!=='string'||result.report.length>MAX_SHARK_REPORT_CHARACTERS)throw new Error('Shark 报告不可用或超过导出限制');
  return `${JSON.stringify({
    schemaVersion:1,
    type:'android-performance-shark-report',
    sourceFileName:boundedText(sourceFileName),
    mappingFileName:boundedText(mappingFileName),
    available:result.available===true,
    success:result.success===true,
    version:boundedText(result.version,64),
    durationMs:Number.isFinite(result.durationMs)&&result.durationMs>=0?result.durationMs:null,
    exitCode:Number.isInteger(result.exitCode)?result.exitCode:null,
    reason:boundedText(result.reason,2000),
    reportComplete:result.reportComplete!==false,
    reportTruncated:result.reportTruncated===true,
    report:result.report
  },null,2)}\n`;
}
