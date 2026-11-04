import { startupRunSummary } from './offline.js';

const MAX_STARTUP_RUNS = 10;

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function agentEvidenceForExport(value) {
  if(value===undefined||value===null)return null;
  if(!value||typeof value!=='object'||typeof value.available!=='boolean'||!Array.isArray(value.events)||value.events.length>100||!Array.isArray(value.activitySummaries)||value.activitySummaries.length>100)throw new Error('启动里程碑证据格式无效或超过 100 项');
  const events=value.events.map(event=>{
    if(!event||typeof event!=='object'||!['agent-installed','application-created','activity-created','activity-resumed','first-draw','fully-drawn'].includes(event.name)||!Number.isSafeInteger(Number(event.pid))||Number(event.pid)<1||Number(event.pid)>2147483647||! /^\d{1,19}$/.test(String(event.monotonicNs))||typeof event.processSessionId!=='string'||!/^[0-9a-f]{32}$/.test(event.processSessionId)||event.activityId!==null&&!/^[0-9a-f]{32}$/.test(String(event.activityId))||event.activity!==null&&(typeof event.activity!=='string'||event.activity.length>600))throw new Error('启动里程碑事件字段无效');
    return {processSessionId:event.processSessionId,activityId:event.activityId||null,name:event.name,activity:event.activity||null,pid:Number(event.pid),monotonicNs:String(event.monotonicNs)};
  });
  const summaries=value.activitySummaries.map(row=>{
    if(!row||typeof row!=='object'||typeof row.processSessionId!=='string'||!/^[0-9a-f]{32}$/.test(row.processSessionId)||typeof row.activityId!=='string'||!/^[0-9a-f]{32}$/.test(row.activityId)||typeof row.activity!=='string'||row.activity.length>600||!Array.isArray(row.milestones)||row.milestones.length>20||!row.milestones.every(name=>['agent-installed','application-created','activity-created','activity-resumed','first-draw','fully-drawn'].includes(name))||['createdToResumedMs','resumedToFirstDrawMs','firstDrawToFullyDrawnMs'].some(key=>row[key]!==null&&(!Number.isFinite(row[key])||row[key]<0)))throw new Error('启动里程碑阶段汇总无效');
    return {processSessionId:row.processSessionId,activityId:row.activityId,activity:row.activity,createdToResumedMs:row.createdToResumedMs,resumedToFirstDrawMs:row.resumedToFirstDrawMs,firstDrawToFullyDrawnMs:row.firstDrawToFullyDrawnMs,milestones:row.milestones};
  });
  return {available:value.available,reason:typeof value.reason==='string'?value.reason.slice(0,1000):null,processSessionId:typeof value.processSessionId==='string'&&/^[0-9a-f]{32}$/.test(value.processSessionId)?value.processSessionId:null,boundary:['monotonic-cursor','new-process-session'].includes(value.boundary)?value.boundary:null,truncated:Boolean(value.truncated),events,activitySummaries:summaries};
}

function systemEvidenceForExport(value){
  if(value===undefined||value===null)return null;
  const names=['launch-time','fully-drawn-time'];
  if(!value||typeof value!=='object'||typeof value.available!=='boolean'||!Array.isArray(value.events)||value.events.length>100||value.ttidMs!=null&&(!Number.isFinite(value.ttidMs)||value.ttidMs<0)||value.activityDisplayMs!=null&&(!Number.isFinite(value.activityDisplayMs)||value.activityDisplayMs<0)||value.ttfdMs!=null&&(!Number.isFinite(value.ttfdMs)||value.ttfdMs<0))throw new Error('系统启动事件证据格式无效或超过 100 项');
  const events=value.events.map(event=>{
    if(!event||!names.includes(event.name)||!Number.isSafeInteger(event.userId)||event.userId<0||typeof event.activityToken!=='string'||!/^\d{1,12}$/.test(event.activityToken)||typeof event.component!=='string'||event.component.length>600||!Number.isSafeInteger(event.activityTimeMs)||event.activityTimeMs<0||!Number.isSafeInteger(event.totalTimeMs)||event.totalTimeMs<0)throw new Error('系统启动事件字段无效');
    return {name:event.name,userId:event.userId,activityToken:event.activityToken,component:event.component,activityTimeMs:event.activityTimeMs,totalTimeMs:event.totalTimeMs};
  });
  return {available:value.available,reason:typeof value.reason==='string'?value.reason.slice(0,1000):null,source:'android-event-log',ttidMs:value.ttidMs??null,activityDisplayMs:value.activityDisplayMs??null,ttfdMs:value.ttfdMs??null,activityToken:typeof value.activityToken==='string'?value.activityToken:null,component:typeof value.component==='string'?value.component.slice(0,600):null,truncated:Boolean(value.truncated),events};
}

function validExperiment(result) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.results) || result.results.length > MAX_STARTUP_RUNS) throw new Error('启动实验报告格式无效或超过 10 次运行上限');
  if (!['cold', 'warm', 'hot'].includes(result.requestedMode) || typeof result.packageName !== 'string' || !result.packageName) throw new Error('启动实验报告缺少包名或请求模式');
  for (const row of result.results) {
    if (!row || !Number.isInteger(row.run) || row.run < 1 || !['ok', 'unknown'].includes(row.status) || (row.totalTimeMs !== null && (!Number.isFinite(row.totalTimeMs) || row.totalTimeMs < 0))) throw new Error('启动实验轮次数据无效');
  }
  return result;
}

export function startupExperimentCsv(input) {
  const result = validExperiment(input);
  const header = ['run', 'package', 'device_serial', 'requested_mode', 'observed_mode', 'compilation_mode', 'status', 'activity', 'total_time_ms', 'this_time_ms', 'wait_time_ms', 'raw_output','milestone_evidence_status','milestone_phase_summaries_json','milestone_events_json','system_startup_evidence_json'];
  const rows = result.results.map(row => {const evidence=agentEvidenceForExport(row.agentEvidence),system=systemEvidenceForExport(row.systemEvidence);return [row.run, result.packageName, result.serial, result.requestedMode, row.observedMode, result.compilationMode, row.status, row.activity, row.totalTimeMs, row.thisTimeMs, row.waitTimeMs, row.raw,evidence?.available?'available':evidence?.reason||'not-captured',JSON.stringify(evidence?.activitySummaries||[]),JSON.stringify(evidence?.events||[]),JSON.stringify(system)];});
  return `\uFEFF${[header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}${rows.length ? '\r\n' : ''}`;
}

export function startupExperimentJson(input) {
  const result = validExperiment(input);
  const report = {
    schema: 'android-performance.startup-experiment-report',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    context: {
      source: result.source || null,
      timestamp: Number.isFinite(result.timestamp) ? result.timestamp : null,
      packageName: result.packageName,
      serial: result.serial || null,
      requestedMode: result.requestedMode,
      compilationMode: result.compilationMode || null,
      compilationAction: result.compilationAction || null,
      note: typeof result.note === 'string' ? result.note : null,
    },
    summary: startupRunSummary(result.results),
    runs: result.results.map(row => ({ run: row.run, status: row.status, observedMode: row.observedMode || null, activity: row.activity || null, totalTimeMs: row.totalTimeMs, thisTimeMs: row.thisTimeMs ?? null, waitTimeMs: row.waitTimeMs ?? null, raw: row.raw || '',agentEvidence:agentEvidenceForExport(row.agentEvidence),systemEvidence:systemEvidenceForExport(row.systemEvidence) })),
    compilationBefore: result.compilationBefore || null,
    compilationAfter: result.compilationAfter || null,
    evidenceLimit: 'TotalTime is reported by am start -W and is not TTFD. Compilation state is system output and does not prove a Baseline Profile is installed or effective.',
  };
  const serialized = JSON.stringify(report, null, 2);
  if (new TextEncoder().encode(serialized).byteLength > 4 * 1024 * 1024) throw new Error('启动实验 JSON 报告超过 4 MiB');
  return `${serialized}\n`;
}
