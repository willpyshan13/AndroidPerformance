import { app, BrowserWindow, Menu, dialog, shell, nativeImage, session, ipcMain } from 'electron';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { readFile, writeFile, access, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { Adb, locateAdb } from '../src/adb.js';
import { createApp, VERSION } from '../src/server.js';
import { prepareAgiArtifact } from '../src/gpu.js';
import { normalizeAppearance } from '../src/preferences.js';
import { ensureWindowsJavaRuntime } from '../src/java-runtime.js';
import { buildMenuTemplate } from './menu.js';
import { nativeText } from './locale.js';

const here = dirname(fileURLToPath(import.meta.url));
const allowedExternal = new Set(['https://ui.perfetto.dev/', 'https://github.com/yuchuangu85/AndroidPerformanceStudio']);
let window, server, origin, runtimeAdb, agiPath=null;
let appearanceLanguage='zh-CN';
const profilePath = process.env.APW_PROFILE_DIR || (!app.isPackaged ? join(here, '..', 'data', 'desktop-profile') : null);
if (profilePath) { mkdirSync(profilePath, { recursive: true }); app.setPath('userData', profilePath); }
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();

function navigate(route) {
  if (window && !window.isDestroyed()) { window.show(); window.webContents.send('workbench:navigate', route); }
}
async function smokeTraceOnlyLayoutEvidence() {
  const trace=JSON.stringify({traceEvents:[{name:'DemoProcess',ph:'M',pid:101,tid:101,args:{name:'DemoProcess'}},{name:'render',cat:'gfx',ph:'X',pid:101,tid:101,ts:1000,dur:12000}]});
  return window.webContents.executeJavaScript(`(async()=>{let step='initialize';try{const settle=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))),payload=${JSON.stringify(trace)},fileName='trace-only-layout-smoke.json',mode=document.querySelector('#mode-btn');step='disable demo';if(mode&&/退出演示|Exit demo mode/.test(mode.textContent)){mode.click();await settle();}step='open trace route';location.hash='#trace';await settle();const input=document.querySelector('#trace-input'),transfer=new DataTransfer();if(!input)return {ok:false,reason:'trace file input is missing'};transfer.items.add(new File([payload],fileName,{type:'application/json'}));input.files=transfer.files;step='import synthetic trace';input.dispatchEvent(new Event('change',{bubbles:true}));const importedUntil=performance.now()+20000;while(performance.now()<importedUntil&&!document.querySelector('#main')?.innerText.includes(fileName))await new Promise(resolve=>setTimeout(resolve,25));if(!document.querySelector('#main')?.innerText.includes(fileName))return {ok:false,reason:'synthetic trace was not loaded'};const sqlRun=document.querySelector('[data-action=\"trace-sql-run\"]');if(!sqlRun)return {ok:false,reason:'trace SQL action missing'};sqlRun.click();const sqlDeadline=performance.now()+20000;while(performance.now()<sqlDeadline&&(!document.querySelector('[data-action=\"trace-sql-export\"]')||document.querySelector('[data-action=\"trace-sql-export\"]').disabled))await new Promise(resolve=>setTimeout(resolve,25));const sqlButton=document.querySelector('[data-action=\"trace-sql-export\"]'),sqlExport=!!sqlButton&&!sqlButton.disabled;let csvBlob=null,csvText='',csvBytes=null,sqlCsvExport=false;const originalCreate=URL.createObjectURL,originalAnchorClick=HTMLAnchorElement.prototype.click;try{URL.createObjectURL=blob=>{csvBlob=blob;return 'blob:trace-sql-smoke';};HTMLAnchorElement.prototype.click=()=>{};sqlButton?.click();if(csvBlob){csvText=await csvBlob.text();csvBytes=new Uint8Array(await csvBlob.arrayBuffer());sqlCsvExport=csvBlob.type==='text/csv;charset=utf-8'&&csvBytes[0]===0xef&&csvBytes[1]===0xbb&&csvBytes[2]===0xbf&&csvText.includes('"name","occurrences","total_ms"')&&csvText.includes('"render"');}}finally{URL.createObjectURL=originalCreate;HTMLAnchorElement.prototype.click=originalAnchorClick;}step='open frames route';location.hash='#frames';await settle();const load=document.querySelector('[data-action="load-frame-timeline"]');if(!load)return {ok:false,reason:'FrameTimeline action is missing'};step='load frame timeline';load.click();const deadline=performance.now()+20000;while(performance.now()<deadline&&!document.querySelector('#main')?.innerText.includes('相关布局证据')&&!document.querySelector('#main')?.innerText.includes('Related layout evidence'))await new Promise(resolve=>setTimeout(resolve,25));await settle();const text=document.querySelector('#main')?.innerText||'',toast=document.querySelector('#toast')?.textContent||'',panel=text.includes('相关布局证据')||text.includes('Related layout evidence'),noGfxinfo=text.includes('暂无有效帧')||text.includes('No valid frames')||toast.includes('没有 FrameTimeline 记录')||toast.includes('No FrameTimeline records in the trace'),identityNotice=text.includes('需要直接采集的帧数据及其设备序列号和目标包名。')||text.includes('Requires directly captured frame data with a device serial and target package.');step='restore overview';location.hash='#overview';await settle();if(mode&&!/退出演示|Exit demo mode/.test(mode.textContent)){mode.click();await settle();}return {ok:panel&&noGfxinfo&&identityNotice&&sqlExport&&sqlCsvExport,panelVisible:panel,noGfxinfo,identityNotice,sqlExport,sqlCsvExport,csvType:csvBlob?.type,csvBytes:csvBlob?.size,csvPrefix:Array.from(csvBytes||[]).slice(0,3),csvTextPrefix:csvText.slice(0,160),toast,excerpt:text.slice(-500)};}catch(error){return {ok:false,reason:step+': '+(error.stack||error.message||String(error))};}})()`);
}
async function smokeTraceAnalysisReportInRenderer() {
  const trace=JSON.stringify({traceEvents:[{name:'SmokeProcess',ph:'M',pid:202,tid:202,args:{name:'SmokeProcess'}},{name:'smoke_render',cat:'gfx',ph:'X',pid:202,tid:202,ts:1000,dur:12000}]});
  return window.webContents.executeJavaScript(`(async()=>{let step='initialize';const settle=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))),fail=reason=>({ok:false,reason}),payload=${JSON.stringify(trace)},fileName='trace-report-smoke.json',mode=document.querySelector('#mode-btn');try{if(mode&&/退出演示|Exit demo mode/.test(mode.textContent)){step='exit demo';mode.click();await settle();}step='open trace';location.hash='#trace';await settle();const input=document.querySelector('#trace-input'),transfer=new DataTransfer();if(!input)return fail('trace file input missing');transfer.items.add(new File([payload],fileName,{type:'application/json'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));let deadline=performance.now()+20000;while(performance.now()<deadline&&!document.querySelector('#main')?.innerText.includes(fileName))await new Promise(resolve=>setTimeout(resolve,25));if(!document.querySelector('#main')?.innerText.includes(fileName))return fail('synthetic trace was not loaded');step='run SQL';const editor=document.querySelector('#trace-sql-editor'),run=document.querySelector('[data-action="trace-sql-run"]');if(!editor||!run)return fail('SQL editor or run action missing');const query="SELECT name, COUNT(*) AS occurrences FROM slice WHERE name = 'smoke_render' GROUP BY name";editor.value=query;editor.dispatchEvent(new Event('input',{bubbles:true}));run.click();deadline=performance.now()+20000;while(performance.now()<deadline&&(!document.querySelector('[data-action="trace-sql-export"]')||document.querySelector('[data-action="trace-sql-export"]').disabled))await new Promise(resolve=>setTimeout(resolve,25));if(!document.querySelector('[data-action="trace-sql-export"]'))return fail('SQL result did not appear');step='export report';const button=document.querySelector('[data-action="export-trace-report"]');if(!button||button.disabled)return fail('trace report export action is unavailable');let blob=null;const originalCreate=URL.createObjectURL,originalClick=HTMLAnchorElement.prototype.click;try{URL.createObjectURL=value=>{blob=value;return 'blob:trace-report-smoke';};HTMLAnchorElement.prototype.click=()=>{};button.click();if(!blob)return fail('report export did not create a Blob');const text=await blob.text(),report=JSON.parse(text),sql=report.customSql,ok=blob.type==='application/json;charset=utf-8'&&report.schema==='android-performance.trace-analysis-report'&&report.schemaVersion===1&&report.trace.fileName===fileName&&sql?.query===query&&sql.columns.includes('occurrences')&&sql.rows.some(row=>row[0]==='smoke_render'&&row[1]==='1')&&report.trace.bounds?.startNs!==undefined;return {ok,type:blob.type,bytes:blob.size,traceName:report.trace.fileName,sqlRows:sql?.rows.length,queryIncluded:sql?.query===query,matchingResult:!!sql?.rows.some(row=>row[0]==='smoke_render'&&row[1]==='1'),traceBoundsIncluded:!!report.trace.bounds?.startNs};}finally{URL.createObjectURL=originalCreate;HTMLAnchorElement.prototype.click=originalClick;}}catch(error){return fail(step+': '+(error.stack||error.message||String(error)));}finally{location.hash='#overview';await settle();if(mode&&!/退出演示|Exit demo mode/.test(mode.textContent)){mode.click();await settle();}}})()`);
}
async function smokePerfettoUiCsvReportInRenderer() {
  const trace=JSON.stringify({traceEvents:[{name:'PerfettoCsvSmokeProcess',ph:'M',pid:707,tid:707,args:{name:'PerfettoCsvSmokeProcess'}},{name:'perfetto_ui_csv_render',cat:'gfx',ph:'X',pid:707,tid:707,ts:2000,dur:9000}]});
  return window.webContents.executeJavaScript(`(async()=>{let step='initialize';const settle=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))),fail=reason=>({ok:false,reason}),payload=${JSON.stringify(trace)},fileName='perfetto-ui-csv-report-smoke.json',mode=document.querySelector('#mode-btn');try{if(mode&&/退出演示|Exit demo mode/.test(mode.textContent)){mode.click();await settle();}step='import trace';location.hash='#trace';await settle();const traceInput=document.querySelector('#trace-input'),traceTransfer=new DataTransfer();if(!traceInput)return fail('trace file input missing');traceTransfer.items.add(new File([payload],fileName,{type:'application/json'}));traceInput.files=traceTransfer.files;traceInput.dispatchEvent(new Event('change',{bubbles:true}));let deadline=performance.now()+20000;while(performance.now()<deadline&&!document.querySelector('#main')?.innerText.includes(fileName))await new Promise(resolve=>setTimeout(resolve,25));if(!document.querySelector('#main')?.innerText.includes(fileName))return fail('synthetic trace was not loaded');step='import Perfetto UI CSV';const csvInput=document.querySelector('#trace-ui-csv-input'),csvTransfer=new DataTransfer();if(!csvInput)return fail('Perfetto UI CSV input missing');csvTransfer.items.add(new File(['\\uFEFF"name","count"\\r\\n"perfetto_ui_csv_render","1"\\r\\n'],'perfetto-ui-query.csv',{type:'text/csv'}));csvInput.files=csvTransfer.files;csvInput.dispatchEvent(new Event('change',{bubbles:true}));deadline=performance.now()+5000;while(performance.now()<deadline&&!document.querySelector('#main')?.innerText.includes('perfetto-ui-query.csv'))await new Promise(resolve=>setTimeout(resolve,20));const rendered=document.querySelector('#main')?.innerText||'';if(!rendered.includes('perfetto-ui-query.csv')||!rendered.includes('perfetto_ui_csv_render'))return fail('imported CSV preview did not render');step='export report';const button=document.querySelector('[data-action="export-trace-report"]');if(!button||button.disabled)return fail('trace report export action unavailable');let blob=null;const originalCreate=URL.createObjectURL,originalClick=HTMLAnchorElement.prototype.click;try{URL.createObjectURL=value=>{blob=value;return 'blob:perfetto-ui-csv-report-smoke';};HTMLAnchorElement.prototype.click=()=>{};button.click();if(!blob)return fail('report export did not create a Blob');const report=JSON.parse(await blob.text()),result=report.perfettoUiCsv,ok=report.trace.fileName===fileName&&result?.source==='embedded-perfetto-ui-csv'&&result.fileName==='perfetto-ui-query.csv'&&result.query===null&&result.columns.join(',')==='name,count'&&result.rows.some(row=>row[0]==='perfetto_ui_csv_render'&&row[1]==='1')&&!report.customSql;return {ok,type:blob.type,traceName:report.trace.fileName,csvName:result?.fileName,source:result?.source,queryNotClaimed:result?.query===null,csvRows:result?.rows.length,rowIncluded:!!result?.rows.some(row=>row[0]==='perfetto_ui_csv_render'&&row[1]==='1')};}finally{URL.createObjectURL=originalCreate;HTMLAnchorElement.prototype.click=originalClick;}}catch(error){return fail(step+': '+(error.stack||error.message||String(error)));}finally{location.hash='#overview';await settle();if(mode&&!/退出演示|Exit demo mode/.test(mode.textContent)){mode.click();await settle();}}})()`);
}
async function smokePerfettoUiCsvDownloadBridgeInRenderer(){
 const trace=JSON.stringify({traceEvents:[{name:'PerfettoBridgeSmoke',ph:'M',pid:708,tid:708,args:{name:'PerfettoBridgeSmoke'}},{name:'perfetto_bridge_render',cat:'gfx',ph:'X',pid:708,tid:708,ts:3000,dur:8000}]});
 return window.webContents.executeJavaScript(`(async()=>{
  let step='initialize';
  const fail=reason=>({ok:false,reason}),payload=${JSON.stringify(trace)},fileName='perfetto-ui-csv-bridge-smoke.json',mode=document.querySelector('#mode-btn'),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),settle=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  try{
   if(mode&&/退出演示|Exit demo mode/.test(mode.textContent)){mode.click();await settle();}
   step='import trace';location.hash='#trace';await settle();const input=document.querySelector('#trace-input'),transfer=new DataTransfer();if(!input)return fail('trace file input missing');transfer.items.add(new File([payload],fileName,{type:'application/json'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));let deadline=performance.now()+20000;while(performance.now()<deadline&&!document.querySelector('#main')?.innerText.includes(fileName))await wait(25);if(!document.querySelector('#main')?.innerText.includes(fileName))return fail('trace did not load');
   step='open embedded Perfetto UI';document.querySelector('[data-action="open-perfetto-viewer"]')?.click();deadline=performance.now()+10000;let iframe;while(performance.now()<deadline&&!(iframe=document.querySelector('#perfetto-viewer')))await wait(25);if(!iframe)return fail('embedded Perfetto UI frame was not created');let pong=false;const onMessage=event=>{if(event.source===iframe.contentWindow&&event.origin===location.origin&&event.data==='PONG')pong=true;};window.addEventListener('message',onMessage);deadline=performance.now()+10000;while(performance.now()<deadline&&!pong){iframe.contentWindow.postMessage('PING',location.origin);await wait(50);}window.removeEventListener('message',onMessage);if(!pong)return fail('embedded Perfetto UI did not answer its readiness ping');
   step='download query CSV';const child=iframe.contentWindow,doc=iframe.contentDocument;if(!child||!doc)return fail('same-origin Perfetto UI frame is inaccessible');
   const downloadCsv=async(name,row)=>{const blob=new child.Blob(['"name","count"\\r\\n"'+row+'","1"\\r\\n'],{type:'text/csv;charset=utf-8'}),url=child.URL.createObjectURL(blob),anchor=doc.createElement('a');anchor.href=url;anchor.download=name;doc.body.append(anchor);anchor.click();anchor.remove();const until=performance.now()+5000;while(performance.now()<until&&!document.querySelector('#main')?.innerText.includes(name))await wait(25);const text=document.querySelector('#main')?.innerText||'';child.URL.revokeObjectURL(url);if(!text.includes(name)||!text.includes(row))throw new Error('CSV '+name+' was not imported');};
   await downloadCsv('perfetto-query-old.csv','old_perfetto_csv');await downloadCsv('perfetto-query-latest.csv','latest_perfetto_csv');
   step='export report';let reportBlob=null;const create=URL.createObjectURL,click=HTMLAnchorElement.prototype.click;try{URL.createObjectURL=value=>{reportBlob=value;return 'blob:perfetto-bridge-report-smoke';};HTMLAnchorElement.prototype.click=()=>{};document.querySelector('[data-action="export-trace-report"]')?.click();if(!reportBlob)return fail('trace report did not export');const report=JSON.parse(await reportBlob.text()),csv=report.perfettoUiCsv;return {ok:report.trace.fileName===fileName&&csv?.fileName==='perfetto-query-latest.csv'&&csv.query===null&&csv.rows.some(row=>row[0]==='latest_perfetto_csv'&&row[1]==='1')&&!csv.rows.some(row=>row[0]==='old_perfetto_csv'),automaticImport:true,latestResultWins:true,reportIncludesResult:!!csv?.rows.some(row=>row[0]==='latest_perfetto_csv'&&row[1]==='1'),sqlNotClaimed:csv?.query===null};}finally{URL.createObjectURL=create;HTMLAnchorElement.prototype.click=click;}
  }catch(error){return fail(step+': '+(error.stack||error.message||String(error)));}
  finally{document.querySelector('[data-action="close-perfetto-viewer"]')?.click();location.hash='#overview';if(mode&&!/退出演示|Exit demo mode/.test(mode.textContent))mode.click();}
 })()`);
}
async function smokePowerUidEnergyInRenderer() {
  const trace=JSON.stringify({traceEvents:[{name:'PowerSmokeProcess',ph:'M',pid:303,tid:303,args:{name:'PowerSmokeProcess'}},{name:'power_smoke_render',cat:'gfx',ph:'X',pid:303,tid:303,ts:1000,dur:1000}]});
  return window.webContents.executeJavaScript(`(async()=>{const settle=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))),fail=reason=>({ok:false,reason}),payload=${JSON.stringify(trace)},fileName='power-uid-smoke.json',mode=document.querySelector('#mode-btn');try{if(mode&&/退出演示|Exit demo mode/.test(mode.textContent)){mode.click();await settle();}location.hash='#trace';await settle();const input=document.querySelector('#trace-input'),transfer=new DataTransfer();if(!input)return fail('trace file input missing');transfer.items.add(new File([payload],fileName,{type:'application/json'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));let deadline=performance.now()+20000;while(performance.now()<deadline&&!document.querySelector('#main')?.innerText.includes(fileName))await new Promise(resolve=>setTimeout(resolve,25));if(!document.querySelector('#main')?.innerText.includes(fileName))return fail('synthetic trace did not load');const action=document.querySelector('[data-action="trace-power-rails"]');if(!action||action.disabled)return fail('power diagnostics action is unavailable');action.click();deadline=performance.now()+20000;let dialog=document.querySelector('#detail-dialog');while(performance.now()<deadline&&(!dialog?.open||!dialog.innerText.includes('按 UID 归属')&&!dialog.innerText.includes('attributed by UID'))){await new Promise(resolve=>setTimeout(resolve,25));dialog=document.querySelector('#detail-dialog');}const text=dialog?.innerText||'',heading=text.includes('按 UID 归属的系统能耗估算')||text.includes('System energy estimate attributed by UID'),empty=text.includes('此追踪没有按 UID 归属的能耗样本')||text.includes('No per-UID energy samples were recorded'),rails=text.includes('硬件功耗轨道')||text.includes('Hardware power rails');return {ok:dialog?.open&&heading&&empty&&rails,dialogOpen:!!dialog?.open,uidEnergyHeading:heading,emptyState:empty,hardwareRailsSection:rails,excerpt:text.slice(0,900)};}catch(error){return fail(error.stack||error.message||String(error));}finally{document.querySelector('#detail-dialog')?.close();location.hash='#overview';await settle();if(mode&&!/退出演示|Exit demo mode/.test(mode.textContent)){mode.click();await settle();}}})()`);
}
function openExternal(url) {
  if (allowedExternal.has(url)) shell.openExternal(url).catch(error => dialog.showErrorBox(nativeText(appearanceLanguage,'无法打开链接','Could not open link'), error.message));
}
async function smokeApkAnalyzerInRenderer(apkPath) {
  const encoded = JSON.stringify(await readFile(apkPath, 'base64'));
  const expectedPackage = JSON.stringify(process.env.APW_SMOKE_EXPECTED_PACKAGE || 'dev.apw.smoke');
  return window.webContents.executeJavaScript(`(async encoded=>{
    const settle=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const fail=reason=>({ok:false,reason});
    const input=document.querySelector('#apk-input');
    if(!input)return fail('APK input missing');
    location.hash='#apk';await settle();
    const transfer=new DataTransfer(),bytes=Uint8Array.from(atob(encoded),char=>char.charCodeAt(0));
    transfer.items.add(new File([bytes],'apw-smoke.apk',{type:'application/vnd.android.package-archive'}));
    Object.defineProperty(input,'files',{configurable:true,value:transfer.files});
    input.dispatchEvent(new Event('change',{bubbles:true}));
    const uploadDeadline=performance.now()+30000;
    while(!document.querySelector('[data-apk-tab]')&&performance.now()<uploadDeadline)await new Promise(resolve=>setTimeout(resolve,25));
    const packageName=document.querySelector('.apk-app-title .mono')?.textContent?.trim();
    const expectedPackage=${expectedPackage};
    if(packageName!==expectedPackage)return fail('APK import did not produce the expected package name '+expectedPackage+': '+(packageName||'no analysis result'));
    const tabs=['overview','files','permissions','components','dex','signing','manifest'],checks={};
    for(const name of tabs){
      const tab=document.querySelector('[data-apk-tab="'+name+'"]');if(!tab)return fail('Missing APK tab: '+name);
      tab.click();await settle();
      const content=document.querySelector('#apk-content'),text=content?.textContent||'',selected=document.querySelector('[data-apk-tab="'+name+'"]')?.getAttribute('aria-selected')==='true';
      const valid=selected&&(
        name==='overview'?!!content?.querySelector('.apk-stack'):
        name==='files'?!!content?.querySelector('#apk-file-table tbody tr'):
        name==='permissions'?!!content?.querySelector('.table-wrap table'):
        name==='components'?!!content?.querySelector('#apk-component-table'):
        name==='dex'?text.includes('method_ids'):
        name==='signing'?text.includes('签名结构')||text.includes('Signing structure'):
        name==='manifest'?!!content?.querySelector('.apk-manifest pre')?.textContent.includes('<manifest'):false);
      checks[name]=valid;if(!valid)return fail('APK tab failed to render: '+name+'; '+text.slice(0,300));
    }
    document.querySelector('[data-apk-tab="files"]')?.click();await settle();
    const search=document.querySelector('#apk-search');search.value='AndroidManifest.xml';search.dispatchEvent(new Event('input',{bubbles:true}));await settle();
    const filtered=Array.from(document.querySelectorAll('#apk-file-table tbody tr')).filter(row=>row.textContent.includes('AndroidManifest.xml')).length===1;
    if(!filtered)return fail('APK file-path filter did not isolate AndroidManifest.xml');
    let reportBlob=null;const createObjectURL=URL.createObjectURL,anchorClick=HTMLAnchorElement.prototype.click;
    try{
      URL.createObjectURL=blob=>{reportBlob=blob;return 'blob:apw-apk-report-smoke';};HTMLAnchorElement.prototype.click=()=>{};
      document.querySelector('[data-action="export-apk"]')?.click();
      const exportDeadline=performance.now()+5000;while(!reportBlob&&performance.now()<exportDeadline)await new Promise(resolve=>setTimeout(resolve,10));
      if(!reportBlob)return fail('APK JSON report export did not create a Blob');
      const report=JSON.parse(await reportBlob.text());
      if(report.kind!=='apk'||report.packageName!==expectedPackage)return fail('APK JSON report did not preserve analyzer output');
    }finally{URL.createObjectURL=createObjectURL;HTMLAnchorElement.prototype.click=anchorClick;}
    location.hash='#overview';await settle();
    return {ok:true,packageName,expectedPackage,tabs:checks,manifestFileFilter:filtered,jsonReport:true};
  })(${encoded})`);
}
async function smokeNetworkJsonExportInRenderer() {
  return window.webContents.executeJavaScript(`(async()=>{
    const settle=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))),fail=reason=>({ok:false,reason});
    const documentModel={log:{entries:[{startedDateTime:'2026-01-01T00:00:00.000Z',connection:'socket-smoke',request:{url:'https://user:pass@example.test/api/items?token=secret#fragment',method:'GET',headers:[{name:'Authorization',value:'secret'}],cookies:[{name:'sid',value:'secret'}],postData:{text:'secret'}},response:{status:200,content:{size:42}},time:12,timings:{dns:1,connect:2,ssl:3,wait:4,receive:5}}]}};
    location.hash='#network';await settle();const input=document.querySelector('#file-input'),button=document.querySelector('[data-action="import-har"]');if(!input||!button)return fail('HAR import controls are missing');
    const transfer=new DataTransfer();transfer.items.add(new File([JSON.stringify(documentModel)],'network-smoke.har',{type:'application/json'}));const originalClick=HTMLInputElement.prototype.click;
    try{
      HTMLInputElement.prototype.click=function(){if(this.id==='file-input'){Object.defineProperty(this,'files',{configurable:true,value:transfer.files});this.dispatchEvent(new Event('change',{bubbles:true}));}else originalClick.call(this);};
      button.click();const importDeadline=performance.now()+5000;while(performance.now()<importDeadline&&!document.querySelector('#network-table')?.innerText.includes('/api/items'))await new Promise(resolve=>setTimeout(resolve,20));
      if(!document.querySelector('#network-table')?.innerText.includes('/api/items'))return fail('Synthetic HAR was not imported: '+(document.querySelector('#main')?.innerText||'network route missing').slice(0,300));
      const search=document.querySelector('#network-search');if(search){search.value='items';search.dispatchEvent(new Event('input',{bubbles:true}));await settle();}
      const exportButton=document.querySelector('[data-action="export-network-json"]');if(!exportButton||exportButton.disabled)return fail('Filtered network JSON export is unavailable');
      let blob=null;const originalCreate=URL.createObjectURL,originalAnchorClick=HTMLAnchorElement.prototype.click;
      try{
        URL.createObjectURL=value=>{blob=value;return 'blob:network-json-smoke';};HTMLAnchorElement.prototype.click=()=>{};exportButton.click();
        if(!blob)return fail('Network JSON export did not create a Blob');const text=await blob.text(),doc=JSON.parse(text),record=doc.records?.[0],ok=blob.type==='application/json;charset=utf-8'&&doc.type==='android-performance-network'&&doc.records.length===1&&record?.url==='https://example.test/api/items'&&record.timings.wait===4&&!text.match(/secret|user:pass|token=/);
        return {ok,type:blob.type,filteredRecordCount:doc.records?.length,sanitizedUrl:record?.url,credentialsRemoved:!text.includes('user:pass'),queryRemoved:!text.includes('token='),headersIncluded:false,cookiesIncluded:false,bodyIncluded:false};
      }finally{URL.createObjectURL=originalCreate;HTMLAnchorElement.prototype.click=originalAnchorClick;}
    }finally{HTMLInputElement.prototype.click=originalClick;location.hash='#overview';await settle();}
  })()`);
}

async function smokeNetworkAgentPackageInRenderer() {
  return window.webContents.executeJavaScript(`(async()=>{
    const response=await fetch('/api/network/agent-package',{headers:{'X-Workbench-Token':document.querySelector('meta[name="api-token"]')?.content||''}});
    if(!response.ok)return {ok:false,reason:'Agent package returned HTTP '+response.status};
    if(response.headers.get('content-type')!=='application/zip')return {ok:false,reason:'Agent package did not return a ZIP'};
    const bytes=new Uint8Array(await response.arrayBuffer()),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),decoder=new TextDecoder(),paths=[];let offset=0;
    while(offset+30<=bytes.length&&view.getUint32(offset,true)===0x04034b50){
      const method=view.getUint16(offset+8,true),size=view.getUint32(offset+18,true),nameLength=view.getUint16(offset+26,true),extraLength=view.getUint16(offset+28,true),nameStart=offset+30;
      if(method!==0||nameStart+nameLength+extraLength+size>bytes.length)return {ok:false,reason:'Agent ZIP entry uses unexpected compression or bounds'};
      paths.push(decoder.decode(bytes.subarray(nameStart,nameStart+nameLength)));offset=nameStart+nameLength+extraLength+size;
    }
    const debugOnly=paths.length===4&&paths.includes('README.md')&&paths.includes('src/debug/java/dev/androidperformance/agent/NetworkEvents.java')&&paths.includes('src/debug/java/dev/androidperformance/agent/NetworkAgentServer.java')&&paths.includes('src/debug/java/dev/androidperformance/agent/LogcatSink.java')&&paths.every(path=>path==='README.md'||path.startsWith('src/debug/java/'));
    return {ok:debugOnly,contentType:response.headers.get('content-type'),entryCount:paths.length,debugOnly,paths};
  })()`);
}
async function smokeLeakCanaryAgentPackageInRenderer() {
  return window.webContents.executeJavaScript(`(async()=>{
    const response=await fetch('/api/heap/leakcanary-agent-package',{headers:{'X-Workbench-Token':document.querySelector('meta[name="api-token"]')?.content||''}});
    if(!response.ok)return {ok:false,reason:'LeakCanary Agent package returned HTTP '+response.status};
    if(response.headers.get('content-type')!=='application/zip')return {ok:false,reason:'LeakCanary Agent package did not return a ZIP'};
    const bytes=new Uint8Array(await response.arrayBuffer()),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),decoder=new TextDecoder(),paths=[];let offset=0;
    while(offset+30<=bytes.length&&view.getUint32(offset,true)===0x04034b50){
      const method=view.getUint16(offset+8,true),size=view.getUint32(offset+18,true),nameLength=view.getUint16(offset+26,true),extraLength=view.getUint16(offset+28,true),nameStart=offset+30;
      if(method!==0||nameStart+nameLength+extraLength+size>bytes.length)return {ok:false,reason:'LeakCanary Agent ZIP entry uses unexpected compression or bounds'};
      paths.push(decoder.decode(bytes.subarray(nameStart,nameStart+nameLength)));offset=nameStart+nameLength+extraLength+size;
    }
    const required=['LEAKCANARY_AGENT_README.md','src/debug/AndroidManifest.xml','src/debug/java/dev/androidperformance/agent/ApwLifecycleLeakAgent.java','src/debug/java/dev/androidperformance/agent/ApwLeakCanaryAgentProvider.java','optional-androidx/src/debug/java/dev/androidperformance/agent/ApwAndroidXFragmentLeakAgent.java','optional-jankstats/src/debug/java/dev/androidperformance/agent/ApwJankStatsAgent.java'];
    const complete=required.every(path=>paths.includes(path));
    return {ok:complete,contentType:response.headers.get('content-type'),entryCount:paths.length,complete,paths};
  })()`);
}
async function smokeJankStatsAgentPackageInRenderer() {
  return window.webContents.executeJavaScript(`(async()=>{
    const response=await fetch('/api/frames/jankstats-agent-package',{headers:{'X-Workbench-Token':document.querySelector('meta[name="api-token"]')?.content||''}});
    if(!response.ok)return {ok:false,reason:'JankStats Agent package returned HTTP '+response.status};
    if(response.headers.get('content-type')!=='application/zip')return {ok:false,reason:'JankStats Agent package did not return a ZIP'};
    const bytes=new Uint8Array(await response.arrayBuffer()),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),decoder=new TextDecoder(),paths=[];let offset=0;
    while(offset+30<=bytes.length&&view.getUint32(offset,true)===0x04034b50){
      const method=view.getUint16(offset+8,true),size=view.getUint32(offset+18,true),nameLength=view.getUint16(offset+26,true),extraLength=view.getUint16(offset+28,true),nameStart=offset+30;
      if(method!==0||nameStart+nameLength+extraLength+size>bytes.length)return {ok:false,reason:'JankStats Agent ZIP entry uses unexpected compression or bounds'};
      paths.push(decoder.decode(bytes.subarray(nameStart,nameStart+nameLength)));offset=nameStart+nameLength+extraLength+size;
    }
    const required=['JANKSTATS_AGENT_README.md','src/debug/AndroidManifest.xml','src/debug/java/dev/androidperformance/agent/ApwLifecycleLeakAgent.java','src/debug/java/dev/androidperformance/agent/ApwLeakCanaryAgentProvider.java','src/debug/java/dev/androidperformance/agent/ApwJankStatsAgent.java','optional-androidx/src/debug/java/dev/androidperformance/agent/ApwAndroidXFragmentLeakAgent.java'];
    const complete=required.every(path=>paths.includes(path))&&!paths.includes('LEAKCANARY_AGENT_README.md');
    return {ok:complete,contentType:response.headers.get('content-type'),entryCount:paths.length,complete,paths};
  })()`);
}
async function smokeStartupAgentPackageInRenderer() {
  return window.webContents.executeJavaScript(`(async()=>{
    const response=await fetch('/api/startup/agent-package',{headers:{'X-Workbench-Token':document.querySelector('meta[name="api-token"]')?.content||''}});
    if(!response.ok)return {ok:false,reason:'Startup Agent package returned HTTP '+response.status};
    if(response.headers.get('content-type')!=='application/zip')return {ok:false,reason:'Startup Agent package did not return a ZIP'};
    const bytes=new Uint8Array(await response.arrayBuffer()),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),decoder=new TextDecoder(),paths=[];let offset=0;
    while(offset+30<=bytes.length&&view.getUint32(offset,true)===0x04034b50){const method=view.getUint16(offset+8,true),size=view.getUint32(offset+18,true),nameLength=view.getUint16(offset+26,true),extraLength=view.getUint16(offset+28,true),nameStart=offset+30;if(method!==0||nameStart+nameLength+extraLength+size>bytes.length)return {ok:false,reason:'Startup Agent ZIP entry uses unexpected compression or bounds'};paths.push(decoder.decode(bytes.subarray(nameStart,nameStart+nameLength)));offset=nameStart+nameLength+extraLength+size;}
    const required=['STARTUP_AGENT_README.md','src/debug/AndroidManifest.xml','src/debug/java/dev/androidperformance/agent/ApwStartupAgentProvider.java','src/debug/java/dev/androidperformance/agent/ApwStartupAgent.java'];
    const complete=required.every(path=>paths.includes(path))&&paths.length===required.length;
    return {ok:complete,contentType:response.headers.get('content-type'),entryCount:paths.length,debugOnly:paths.every(path=>path==='STARTUP_AGENT_README.md'||path==='src/debug/AndroidManifest.xml'||path.startsWith('src/debug/java/')),paths};
  })()`);
}
async function smokeStartupComparisonInRenderer() {
  return window.webContents.executeJavaScript(`(async()=>{
    const settle=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))),token=document.querySelector('meta[name="api-token"]')?.content||'',headers={'X-Workbench-Token':token,'Content-Type':'application/json'},fail=reason=>({ok:false,reason});
    const save=async(name,serial,values)=>{const payload={kind:'startup',source:'demo',name,packageName:'dev.apw.smoke',payload:{source:'demo',requestedMode:'cold',packageName:'dev.apw.smoke',serial,results:values.map((totalTimeMs,index)=>({run:index+1,totalTimeMs})),meanMs:values.reduce((sum,value)=>sum+value,0)/values.length}};const response=await fetch('/api/sessions',{method:'POST',headers,body:JSON.stringify(payload)});if(!response.ok)throw new Error('startup fixture save failed: '+response.status);return response.json();};
    try{
      const baseline=await save('Startup comparison baseline','smoke-device-a',[100,102,98]),current=await save('Startup comparison current','smoke-device-b',[110,112,108]);
      location.hash='#sessions';await settle();document.querySelector('[data-action="refresh-sessions"]')?.click();const sessionsDeadline=performance.now()+5000;while(performance.now()<sessionsDeadline&&!document.querySelector('#main')?.innerText.includes('Startup comparison current'))await new Promise(resolve=>setTimeout(resolve,20));await settle();
      location.hash='#startup';await settle();const before=document.querySelector('#startup-compare-baseline'),after=document.querySelector('#startup-compare-current');
      if(!before||!after)return fail('startup comparison selectors missing');before.value=baseline.id;after.value=current.id;
      const compare=document.querySelector('[data-action="compare-startup-records"]');if(!compare)return fail('startup comparison button missing');compare.click();
      const deadline=performance.now()+5000;while(performance.now()<deadline&&!document.querySelector('#detail-dialog')?.open)await new Promise(resolve=>setTimeout(resolve,20));
      const dialog=document.querySelector('#detail-dialog'),text=dialog?.innerText||'';if(!dialog?.open||!text.includes('10.0%')||!text.includes('Device serial differs'))return fail('startup comparison result or context warning missing: '+text.slice(0,500));
      let blob=null;const originalCreate=URL.createObjectURL,originalClick=HTMLAnchorElement.prototype.click;try{URL.createObjectURL=value=>{blob=value;return 'blob:startup-comparison-smoke';};HTMLAnchorElement.prototype.click=()=>{};dialog.querySelector('[data-action="export-startup-comparison"]')?.click();const exportDeadline=performance.now()+3000;while(!blob&&performance.now()<exportDeadline)await new Promise(resolve=>setTimeout(resolve,20));if(!blob)return fail('startup comparison JSON export did not create a Blob');const report=JSON.parse(await blob.text());return {ok:report.kind==='startup-experiment-comparison'&&report.deltaPercent.p50===10&&report.warnings.includes('设备序列号不一致'),deltaPercent:report.deltaPercent,warnings:report.warnings,exported:report.kind};}finally{URL.createObjectURL=originalCreate;HTMLAnchorElement.prototype.click=originalClick;}
    }catch(error){return fail(error.message);}finally{document.querySelector('#detail-dialog')?.close();location.hash='#overview';await settle();}
  })()`);
}
async function smokeStartupExportsInRenderer() {
  return window.webContents.executeJavaScript(`(async()=>{
    const settle=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))),fail=reason=>({ok:false,reason}),mode=document.querySelector('#mode-btn');
    try{
      if(!/退出演示|Exit demo mode/.test(mode?.textContent||'')){mode?.click();await settle();}
      location.hash='#startup';await settle();
      const jsonButton=document.querySelector('[data-action="export-startup-json"]'),csvButton=document.querySelector('[data-action="export-startup-csv"]'),capture=document.querySelector('#startup-agent-iterations'),captureSystem=document.querySelector('#startup-system-iterations');
      if(!jsonButton||!csvButton||jsonButton.disabled||csvButton.disabled)return fail('startup export buttons are unavailable');
      if(!capture||!capture.disabled||capture.checked)return fail('milestone capture should be visible and disabled in demo mode');
      if(!captureSystem||!captureSystem.disabled||captureSystem.checked)return fail('system milestone capture should be visible and disabled in demo mode');
      const blobs=[],originalCreate=URL.createObjectURL,originalClick=HTMLAnchorElement.prototype.click;
      try{
        URL.createObjectURL=blob=>{blobs.push(blob);return 'blob:startup-export-smoke-'+blobs.length;};HTMLAnchorElement.prototype.click=()=>{};
        jsonButton.click();csvButton.click();
      }finally{URL.createObjectURL=originalCreate;HTMLAnchorElement.prototype.click=originalClick;}
      if(blobs.length!==2)return fail('startup exports did not create two files');
      const json=JSON.parse(await blobs[0].text()),csv=await blobs[1].text(),csvBytes=new Uint8Array(await blobs[1].arrayBuffer()),rows=csv.split(/\\r?\\n/).filter(Boolean),utf8Bom=csvBytes[0]===0xef&&csvBytes[1]===0xbb&&csvBytes[2]===0xbf;
      const jsonOk=blobs[0].type==='application/json;charset=utf-8'&&json.schema==='android-performance.startup-experiment-report'&&json.schemaVersion===1&&json.context.packageName==='com.example.reading'&&json.runs.length===3&&json.summary.p50>0&&json.runs.every(row=>typeof row.raw==='string');
      const csvOk=blobs[1].type==='text/csv;charset=utf-8'&&utf8Bom&&rows.length===4&&rows[0].includes('"raw_output"')&&rows[0].includes('"milestone_events_json"')&&rows[0].includes('"system_startup_evidence_json"')&&rows[1].includes('"com.example.reading"');
      return {ok:jsonOk&&csvOk&&capture.disabled&&captureSystem.disabled,json:{schema:json.schema,packageName:json.context.packageName,runs:json.runs.length,p50:json.summary.p50},csv:{type:blobs[1].type,rows:rows.length,utf8Bom,milestoneEvidence:rows[0].includes('"milestone_events_json"'),systemEvidence:rows[0].includes('"system_startup_evidence_json"')},milestoneControl:{visible:!!capture,disabled:capture.disabled,checked:capture.checked},systemMilestoneControl:{visible:!!captureSystem,disabled:captureSystem.disabled,checked:captureSystem.checked}};
    }catch(error){return fail(error.stack||error.message||String(error));}finally{location.hash='#overview';await settle();}
  })()`);
}
async function smokeBenchmarkRegressionInRenderer() {
  return window.webContents.executeJavaScript(`(async()=>{
    const settle=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))),token=document.querySelector('meta[name="api-token"]')?.content||'',headers={'X-Workbench-Token':token,'Content-Type':'application/json'},fail=reason=>({ok:false,reason}),params={mode:'cold'},key=JSON.stringify(['SmokeBenchmark','startup',params,'metrics','timeNs']),context={build:{model:'smoke-device',device:'smoke-device',version:{sdk:35},fingerprint:'smoke-fingerprint'},compilationMode:'speed',cpuLocked:true,cpuCoreCount:8,cpuMaxFreqHz:2000000000,sustainedPerformanceModeEnabled:true,artMainlineVersion:'1'};
    const save=async(name,value)=>{const payload={fileName:name+'.json',context,results:[{key,name:'startup',className:'SmokeBenchmark',params,metric:'timeNs',metricType:'metrics',median:value,runs:2,iterations:1,samples:[value,value]}]};const response=await fetch('/api/sessions',{method:'POST',headers,body:JSON.stringify({kind:'benchmark',source:'import',name,packageName:'',payload})});if(!response.ok)throw new Error('benchmark fixture save failed: '+response.status+' '+(await response.text()).slice(0,200));return response.json();};
    try{
      const baseline=await save('Regression smoke baseline',100),current=await save('Regression smoke current',110);
      location.hash='#sessions';await settle();document.querySelector('[data-action="refresh-sessions"]')?.click();const sessionsDeadline=performance.now()+5000;while(performance.now()<sessionsDeadline&&!document.querySelector('#main')?.innerText.includes('Regression smoke current'))await new Promise(resolve=>setTimeout(resolve,20));
      location.hash='#benchmark';await settle();
      for(const [slot,record] of [['baseline',baseline],['current',current]]){const selector=document.querySelector('#benchmark-history-'+slot);if(!selector)return fail('benchmark '+slot+' history selector missing');selector.value=record.id;document.querySelector('[data-action="load-benchmark-'+slot+'"]')?.click();await new Promise(resolve=>setTimeout(resolve,80));await settle();}
      const threshold=document.querySelector('#benchmark-regression-threshold'),direction=document.querySelector('[data-benchmark-direction="0"]');if(!threshold||!direction)return fail('benchmark regression controls missing');threshold.value='5';threshold.dispatchEvent(new Event('change',{bubbles:true}));await settle();const refreshedDirection=document.querySelector('[data-benchmark-direction="0"]');refreshedDirection.value='lower-is-better';refreshedDirection.dispatchEvent(new Event('change',{bubbles:true}));await settle();
      if(!document.querySelector('.benchmark-status.regression')||!document.querySelector('#main')?.innerText.includes('Regression'))return fail('configured threshold did not flag the expected regression');
      let blob=null;const originalCreate=URL.createObjectURL,originalClick=HTMLAnchorElement.prototype.click;try{URL.createObjectURL=value=>{blob=value;return 'blob:benchmark-ci-smoke';};HTMLAnchorElement.prototype.click=()=>{};document.querySelector('[data-action="export-benchmark-ci"]')?.click();const deadline=performance.now()+3000;while(!blob&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));if(!blob)return fail('Benchmark CI export did not create a Blob');const report=JSON.parse(await blob.text());return {ok:report.kind==='benchmark-ci-result'&&report.status==='regression'&&report.regressionCount===1&&report.regressions[0]?.deltaPercent===10,kind:report.kind,status:report.status,regressionCount:report.regressionCount};}finally{URL.createObjectURL=originalCreate;HTMLAnchorElement.prototype.click=originalClick;}
    }catch(error){return fail(error.message);}finally{location.hash='#overview';await settle();}
  })()`);
}
async function smokeNetworkAgentDeviceInRenderer(serial, packageName) {
  const expectedSerial=JSON.stringify(serial),expectedPackage=JSON.stringify(packageName);
  return window.webContents.executeJavaScript(`(async(serial,packageName)=>{
    const waitFor=async(test,ms=15000)=>{const deadline=performance.now()+ms;while(performance.now()<deadline){const value=test();if(value)return value;await new Promise(resolve=>setTimeout(resolve,50));}return null;};
    const fail=reason=>({ok:false,reason});
    const mode=document.querySelector('#mode-btn');if(/exit demo|退出演示/i.test(mode?.textContent||'')){mode.click();await new Promise(resolve=>setTimeout(resolve,300));}
    const device=await waitFor(()=>{const select=document.querySelector('#device-select');return Array.from(select?.options||[]).some(option=>option.value===serial)?select:null;});
    if(!device)return fail('connected device is not present in the desktop selector');
    device.value=serial;device.dispatchEvent(new Event('change',{bubbles:true}));
    const packageOption=await waitFor(()=>Array.from(document.querySelector('#package-list')?.options||[]).some(option=>option.value===packageName));
    if(!packageOption)return fail('target package did not load for the connected device');
    const input=document.querySelector('#package-input');input.value=packageName;input.dispatchEvent(new Event('change',{bubbles:true}));
    location.hash='#network';await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const start=document.querySelector('[data-action="network-agent-start"]');if(!start)return fail('network Agent start action is missing');start.click();
    const waiting=await waitFor(()=>{const text=document.querySelector('#main')?.innerText||'';return text.includes('Waiting for requests from the configured Agent')?text:null;});
    if(!waiting){document.querySelector('[data-action="network-agent-stop"]')?.click();return fail('desktop did not show the Agent waiting state after reading a device snapshot');}
    document.querySelector('[data-action="network-agent-stop"]')?.click();
    const empty=await waitFor(()=>{const text=document.querySelector('#main')?.innerText||'';return text.includes('No Agent requests received yet')?text:null;},5000);
    return {ok:!!empty,serial,packageName,waitingState:true,emptyAgentState:!!empty,uidEvidence:(empty||waiting).match(/UID \\d+/)?.[0]||null};
  })(${expectedSerial},${expectedPackage})`);
}
async function smokeSourceWorkspaceInRenderer() {
  if (!process.env.APW_SMOKE_SOURCE_DIR) return null;
  const expectedPath = JSON.stringify(process.env.APW_SMOKE_SOURCE_DIR);
  return window.webContents.executeJavaScript(`(async expectedPath=>{
    const settle=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const waitFor=async(test,ms=20000)=>{const deadline=performance.now()+ms;while(performance.now()<deadline){const value=test();if(value)return value;await new Promise(resolve=>setTimeout(resolve,25));}return null;};
    const fail=reason=>({ok:false,reason});
    location.hash='#source';await settle();
    if(typeof window.desktop?.selectSourceDir!=='function')return fail('native source directory bridge is missing');
    const chooser=document.querySelector('[data-action="source-choose"]');if(!chooser)return fail('source directory picker button is missing');
    chooser.click();
    const pathInput=await waitFor(()=>{const input=document.querySelector('#source-path');return input?.value===expectedPath?input:null;});
    if(!pathInput)return fail('directory picker did not fill the selected path');
    document.querySelector('[data-action="source-create"]')?.click();
    const snapshotSelect=await waitFor(()=>{const select=document.querySelector('#source-snapshot');return select?.options.length>1&&select.value?select:null;},30000);
    if(!snapshotSelect)return fail('local source snapshot was not created');
    const snapshotFiles=Number(snapshotSelect.selectedOptions[0]?.textContent.match(/(\\d+) 文件/)?.[1]||snapshotSelect.selectedOptions[0]?.textContent.match(/(\\d+) files/)?.[1]||0);
    const query=document.querySelector('#source-query');if(!query)return fail('source search controls are missing');
    query.value='LOCAL_SOURCE_WORKSPACE_SMOKE';
    document.querySelector('[data-action="source-search"]')?.click();
    const match=await waitFor(()=>document.querySelector('[data-source-match]'),15000);
    if(!match)return fail('local source text search found no fixture match');
    const matchedPath=match.textContent.trim();match.click();
    const opened=await waitFor(()=>Array.from(document.querySelectorAll('#main pre')).some(pre=>pre.textContent.includes('LOCAL_SOURCE_WORKSPACE_SMOKE')),10000);
    if(!opened)return fail('source search result did not open the matching file');
    const nativeQuery=document.querySelector('#source-query');if(!nativeQuery)return fail('source search controls disappeared after opening the first match');
    nativeQuery.value='_ZN3apw11SmokeWorker3runEv';document.querySelector('[data-action="source-resolve"]')?.click();
    const nativeMatch=await waitFor(()=>Array.from(document.querySelectorAll('[data-source-match]')).find(node=>node.textContent.includes('native.cxx')),15000);
    if(!nativeMatch)return fail('C++ symbol did not resolve to the native fixture declaration: '+(document.querySelector('#main')?.innerText||'').slice(-800));
    const nativeReason=Array.from(document.querySelectorAll('#main .hint')).some(node=>node.textContent.includes('Native function name match'));
    if(!nativeReason)return fail('C++ candidate evidence was not localized in the packaged English renderer');
    nativeMatch.click();
    const nativeOpened=await waitFor(()=>Array.from(document.querySelectorAll('#main pre')).some(pre=>pre.textContent.includes('SmokeWorker::')&&pre.textContent.includes('run()')),10000);
    if(!nativeOpened)return fail('C++ source candidate did not open the matching file');
    location.hash='#overview';await settle();
    return {ok:true,nativePickerBridge:true,pathSelected:true,snapshotFiles,searchMatch:true,matchedPath,fileOpened:true,nativeSymbolResolve:true,nativeCandidateLocalized:nativeReason,nativeFileOpened:true};
  })(${expectedPath})`);
}
async function saveSettings(update) {
  const path=join(app.getPath('userData'),'settings.json');let current={};try{current=JSON.parse(await readFile(path,'utf8'));}catch{}
  await writeFile(path,JSON.stringify({...current,...update}),{mode:0o600});
}
async function existingAgi(){
  const candidates=[agiPath,process.platform==='darwin'?'/Applications/Android GPU Inspector.app':null,process.platform==='win32'?join(process.env.ProgramFiles||'C:\\Program Files','Android GPU Inspector','agi.exe'):null].filter(Boolean);
  for(const path of candidates)try{await access(path);return path;}catch{}return null;
}
function authorizeGpuIpc(event){if(!window||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame)throw new Error('无效的桌面请求');}
async function chooseAdb() {
  if (runtimeAdb.busy.size) { dialog.showMessageBox(window, { message: nativeText(appearanceLanguage,'设备采集任务尚未结束，请等待完成后更换 ADB。','A device capture is still running. Wait for it to finish before changing ADB.') }); return; }
  const result = await dialog.showOpenDialog(window, { title: nativeText(appearanceLanguage,'选择 Android Platform Tools 中的 adb 程序','Select adb from Android Platform Tools'), properties: ['openFile'], defaultPath: runtimeAdb.path === 'adb' ? app.getPath('home') : runtimeAdb.path });
  if (result.canceled) return;
  const path = result.filePaths[0];
  try {
    if (!['adb', 'adb.exe'].includes(basename(path).toLowerCase())) throw new Error(nativeText(appearanceLanguage,'请选择 Android Platform Tools 中名为 adb 或 adb.exe 的程序','Select a file named adb or adb.exe from Android Platform Tools'));
    const candidate = new Adb(path);
    if (!(await candidate.run(['version'])).startsWith('Android Debug Bridge version')) throw new Error(nativeText(appearanceLanguage,'该程序未返回有效 ADB 版本','The selected program did not return a valid ADB version'));
    await saveSettings({adbPath:path});
    runtimeAdb.path = path;
    runtimeAdb.cpuSnapshots.clear();
    window?.webContents.send('workbench:adb-updated');
  } catch (error) { dialog.showErrorBox(nativeText(appearanceLanguage,'无法设置 ADB','Could not set ADB'), error.message); }
}
function installMenu(language='zh-CN') {
  const isMac = process.platform === 'darwin';
  const menu=buildMenuTemplate({language,isMac,navigate,chooseAdb,openRecords:async()=>{const path=join(app.getPath('userData'),'records');mkdirSync(path,{recursive:true});await shell.openPath(path);},openPerfetto:()=>openExternal('https://ui.perfetto.dev/'),about:()=>app.showAboutPanel()});
  if(!app.isPackaged){const view=menu.find(item=>item.label===(language==='en-US'?'View':'视图'));view.submenu.push({role:'toggleDevTools',label:language==='en-US'?'Developer Tools':'开发者工具'});}
  Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
}
function createWindow() {
  const smokeRendererMessages=[];
  window = new BrowserWindow({
    width: 1440, height: 1000, minWidth: 960, minHeight: 680,
    title: 'Android Performance', backgroundColor: '#f5f7f9', show: false,
    icon: join(here, 'resources', 'icon.png'),
    webPreferences: { preload: join(here, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, spellcheck: false },
  });
  if (process.env.APW_SMOKE_READY_FILE) {
    window.webContents.on('console-message', details => {const message=`Renderer console ${details.level}: ${details.message} (${details.sourceId}:${details.lineNumber})`;smokeRendererMessages.push(message);console.error(message);});
    window.webContents.on('did-fail-load', (_event, code, description, url) => console.error(`Renderer navigation failed (${code}): ${description} ${url}`));
    window.webContents.on('render-process-gone', (_event, details) => console.error(`Renderer process exited: ${details.reason} (${details.exitCode})`));
  }
  window.once('ready-to-show', () => window.show());
  if (process.env.APW_SMOKE_READY_FILE) window.webContents.once('did-finish-load', async () => {
    let smokeStep='initial renderer state';
    try {
      const deadline = Date.now() + 10_000;
      let rendererState;
      do {
        rendererState = await window.webContents.executeJavaScript("({title:document.title,readyState:document.readyState,navItems:document.querySelectorAll('#nav .nav-item').length,quickActionRoutes:Array.from(document.querySelectorAll('[data-quick-action-route]'),item=>item.dataset.quickActionRoute),mainPresent:document.querySelector('#main')!==null,mainText:document.querySelector('#main')?.innerText?.slice(0,160)||'',script:document.querySelector('script[type=module]')?.src||'',resources:performance.getEntriesByType('resource').map(x=>({name:x.name,status:x.responseStatus})).filter(x=>x.name.endsWith('.js')),smokeErrors:window.desktop?.smokeDiagnostics?.()||[]})");
        if (rendererState.navItems > 0 && rendererState.mainPresent && rendererState.quickActionRoutes.length >= 13) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      } while (Date.now() < deadline);
      smokeStep='route checks';const routeChecks=await window.webContents.executeJavaScript("(async()=>{const settle=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))),cjk=/[\\u3400-\\u9fff]/,localized='h1,h2,h3,h4,a,button,label,th,dt,option,small,strong,p,.hint,.subtle,.tag,.eyebrow,.metric-note,.section-heading span,.footer-tagline,.empty,.empty-chart';const visitRoutes=async()=>{const links=Array.from(document.querySelectorAll('#nav .nav-item'));const results=[];let previous=document.querySelector('#main')?.innerText?.trim()||'';for(const link of links){const route=link.getAttribute('href');location.hash=route;await new Promise(resolve=>setTimeout(resolve,0));await settle();const main=document.querySelector('#main'),canvas=main?.querySelector('#cpu-stack-timeline');let stackTimeline=false;if(route==='#cpu-profile'&&canvas&&canvas.width>0&&canvas.height>0){const rect=canvas.getBoundingClientRect();canvas.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2}));await settle();const dialog=document.querySelector('#detail-dialog'),apply=dialog?.querySelector('[data-cpu-stack-apply]'),sampleDialog=!!dialog?.open&&!!apply;apply?.click();await settle();stackTimeline=sampleDialog&&!dialog.open&&!!document.querySelector('#cpu-stack-timeline');}const text=main?.innerText?.trim()||'',walker=document.createTreeWalker(main||document.body,NodeFilter.SHOW_TEXT);let node;const untranslated=[];while((node=walker.nextNode())&&untranslated.length<100){const parent=node.parentElement;if(!parent||!parent.matches(localized)||parent.closest('pre,code,textarea,input,td,.tree,#properties,.sample-screen,.phone-preview,[data-source-file],[data-source-match],[data-user-content]')||parent.matches('#appearance-language option[value=zh-CN]'))continue;const value=node.nodeValue.trim();if(value&&cjk.test(value))untranslated.push(value.slice(0,1000));}results.push({route,active:document.querySelector('#nav .nav-item.active')?.getAttribute('href')===route,heading:!!main?.querySelector('h1')?.innerText?.trim(),hasContent:text.length>0,changed:text!==previous,stackTimeline,untranslated});previous=text;}location.hash='#overview';await new Promise(resolve=>setTimeout(resolve,0));await settle();return results;};const empty=await visitRoutes();document.querySelector('#mode-btn')?.click();await settle();const demoActive=document.querySelector('#mode-btn')?.textContent?.trim()==='Exit demo mode';const demo=await visitRoutes();return {empty,demo,demoActive};})()");
      rendererState.routeChecks=routeChecks;
      smokeStep='deep CPU stack detail';rendererState.deepCpuStackSmoke=await window.webContents.executeJavaScript(`(async()=>{const settle=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))),setDepth=async depth=>{const select=document.querySelector('#cpu-stack-depth');if(!select)return false;select.value=String(depth);select.dispatchEvent(new Event('change',{bubbles:true}));await settle();return true;},mode=document.querySelector('#mode-btn');if(mode?.textContent.trim().toLowerCase().includes('exit')){mode.click();await settle();document.querySelector('#mode-btn')?.click();await settle();}location.hash='#cpu-profile';await new Promise(resolve=>setTimeout(resolve,0));await settle();if(!document.querySelector('#cpu-stack-depth')||!document.querySelector('#cpu-stack-timeline'))return {ok:false,reason:'CPU stack depth selector or canvas missing'};await setDepth(16);const height16=document.querySelector('#cpu-stack-timeline')?.style.height;await setDepth(64);const canvas=document.querySelector('#cpu-stack-timeline'),height64=canvas?.style.height;if(!canvas)return {ok:false,reason:'CPU canvas missing after depth change',height16,height64};const rect=canvas.getBoundingClientRect();canvas.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:rect.left+rect.width*0.5016,clientY:rect.top+rect.height/2}));await settle();const dialog=document.querySelector('#detail-dialog'),rows=dialog?.querySelectorAll('tbody tr').length||0;dialog?.close();location.hash='#overview';await settle();return {ok:height16==='128px'&&height64==='512px'&&rows===90,height16,height64,detailFrames:rows};})()`);
      smokeStep='CPU PNG export';rendererState.cpuPngExport=await window.webContents.executeJavaScript(`(async()=>{const settle=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));location.hash='#cpu-profile';await new Promise(resolve=>setTimeout(resolve,0));await settle();const canvas=document.querySelector('#cpu-stack-timeline'),button=document.querySelector('[data-action=export-cpu-stack-timeline]');if(!canvas||!button)return {ok:false,reason:'CPU chart or export button missing'};let blob=null;const originalCreate=URL.createObjectURL,originalClick=HTMLAnchorElement.prototype.click;try{URL.createObjectURL=value=>{blob=value;return 'blob:cpu-export-smoke';};HTMLAnchorElement.prototype.click=()=>{};button.click();const deadline=performance.now()+5000;while(!blob&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));if(!blob)return {ok:false,reason:'PNG blob was not created'};const signature=Array.from(new Uint8Array(await blob.slice(0,8).arrayBuffer())).join(',')==='137,80,78,71,13,10,26,10';const image=await createImageBitmap(blob);return {ok:signature&&image.width>0&&image.height>0,type:blob.type,width:image.width,height:image.height};}finally{URL.createObjectURL=originalCreate;HTMLAnchorElement.prototype.click=originalClick;location.hash='#overview';await new Promise(resolve=>setTimeout(resolve,0));await settle();}})()`);
      smokeStep='large CPU timeline';rendererState.cpuLargeTimeline=await window.webContents.executeJavaScript(`(async()=>{
        const {buildSampleTimeline,sampleStackTimeline,drawSampleStackTimeline}=await import(location.origin+'/offline.js'),sampleCount=50000,origin=1730000000000000000n,frames=Array.from({length:24},(_,depth)=>'module'+(depth%4)+'.function'+depth),threads=Array.from({length:32},(_,index)=>'worker-'+index),samples=Array.from({length:sampleCount},(_,index)=>({timeNs:String(origin+BigInt(index)*20000000n),period:String(700+index%900),pid:18472,tid:19000+index%threads.length,thread:threads[index%threads.length],frames}));
        const start=performance.now(),timeline=buildSampleTimeline({event:'cpu-clock:u',clockId:'monotonic',samples}),indexed=performance.now(),projection=sampleStackTimeline(timeline),projected=performance.now(),canvas=document.createElement('canvas'),draw=drawSampleStackTimeline(canvas,projection),drawn=performance.now(),pixelBytes=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data.length,rasterized=performance.now(),zoomStart=performance.now(),zoom=sampleStackTimeline(timeline,{rangeMs:{start:1000,end:1100}}),zoomed=performance.now();
        const zoomOk=zoom.totalSamples===6&&zoom.renderedSamples===6&&!zoom.truncated&&zoom.startMs===1000&&zoom.endMs===1100;
        return {ok:timeline.samples.length===sampleCount&&projection.renderedSamples===2000&&draw.drawnFrames>0&&pixelBytes>0&&zoomOk,samples:timeline.samples.length,renderedSamples:projection.renderedSamples,zoomSamples:zoom.renderedSamples,zoomFirstSample:zoom.entries[0]?.sample.timeNs,zoomLastSample:zoom.entries.at(-1)?.sample.timeNs,zoomMs:Math.round((zoomed-zoomStart)*100)/100,drawnFrames:draw.drawnFrames,pixelBytes,indexMs:Math.round((indexed-start)*100)/100,projectionMs:Math.round((projected-indexed)*100)/100,drawMs:Math.round((drawn-projected)*100)/100,rasterReadMs:Math.round((rasterized-drawn)*100)/100,totalMs:Math.round((rasterized-start)*100)/100};
      })()`);
      smokeStep='HPROF CSV and dominator';rendererState.heapCsvExport=await window.webContents.executeJavaScript(`(async()=>{const settle=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))),bytes=Uint8Array.from(atob('SkFWQSBQUk9GSUxFIDEuMC4zAAAAAAQAAAAAAAAAAAEAAAAAAAAAEwAAAAFjb20vZXhhbXBsZS9Gb28CAAAAAAAAABAAAAABAAAAAgAAAAAAAAABHAAAAAAAAAArIQAAAAMAAAAAAAAAAgAAAAQAAAAqIwAAAAQAAAAAAAAAAwgBAgP/AAAAAywAAAAAAAAAAA=='),character=>character.charCodeAt(0)),input=document.querySelector('#heap-input'),transfer=new DataTransfer();if(!input)return {ok:false,reason:'HPROF file input missing'};location.hash='#heap';await settle();transfer.items.add(new File([bytes],'smoke.hprof',{type:'application/octet-stream'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));const deadline=performance.now()+10000;while(!document.querySelector('[data-action=heap-export-csv]')&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));if(!document.querySelector('[data-action=heap-export-csv]'))return {ok:false,reason:'HPROF import did not render class table',files:input.files?.length,toast:document.querySelector('#toast')?.textContent,toastClass:document.querySelector('#toast')?.className};const search=document.querySelector('#heap-search');search.value='Foo';search.dispatchEvent(new Event('input',{bubbles:true}));await settle();let blob=null;const originalCreate=URL.createObjectURL,originalClick=HTMLAnchorElement.prototype.click;try{URL.createObjectURL=value=>{blob=value;return 'blob:heap-csv-smoke';};HTMLAnchorElement.prototype.click=()=>{};document.querySelector('[data-action=heap-export-csv]').click();if(!blob)return {ok:false,reason:'CSV export did not create a Blob'};const text=await blob.text(),signature=Array.from(new Uint8Array(await blob.slice(0,3).arrayBuffer()));const utf8Bom=signature.join(',')==='239,187,191',csvOk=blob.type.startsWith('text/csv')&&utf8Bom&&text.includes('com.example.Foo')&&!text.includes('byte[]'),domButton=document.querySelector('[data-action=heap-dominators]');if(!domButton)return {ok:false,reason:'dominator graph action missing',csvOk};domButton.click();const domDeadline=performance.now()+10000;let dialog=document.querySelector('#detail-dialog');while((!dialog?.open||!dialog.innerText.includes('可达'))&&performance.now()<domDeadline){await new Promise(resolve=>setTimeout(resolve,20));dialog=document.querySelector('#detail-dialog');}const domText=dialog?.innerText||'',dominatorGraph={ok:dialog?.open&&domText.includes('可达')&&domText.includes('已索引')&&domText.includes('引用'),summary:domText.slice(0,240)};dialog?.close();return {ok:csvOk&&dominatorGraph.ok,type:blob.type,filteredClassIncluded:text.includes('com.example.Foo'),unfilteredClassExcluded:!text.includes('byte[]'),utf8Bom,bytes:blob.size,dominatorGraph};}finally{URL.createObjectURL=originalCreate;HTMLAnchorElement.prototype.click=originalClick;location.hash='#overview';await settle();}})()`);
      smokeStep='layout findings';rendererState.layoutFindings=await window.webContents.executeJavaScript(`(async()=>{const settle=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))),xml='<hierarchy rotation="0"><node class="android.widget.Button" text="" content-desc="" clickable="true" bounds="[0,0][20,20]"/><node class="android.widget.TextView" text="Hidden" content-desc="" visibility="invisible" alpha="1.000" bounds="[0,0][40,40]"/></hierarchy>',input=document.querySelector('#file-input'),transfer=new DataTransfer();if(!input)return {ok:false,reason:'layout file input missing'};location.hash='#layout';await settle();transfer.items.add(new File([xml],'smoke.xml',{type:'application/xml'}));const originalClick=HTMLInputElement.prototype.click;try{HTMLInputElement.prototype.click=function(){if(this.id==='file-input'){this.files=transfer.files;this.dispatchEvent(new Event('change',{bubbles:true}));}else originalClick.call(this);};let importButton=document.querySelector('[data-action=import-layout]'),routeDeadline=performance.now()+5000;while(!importButton&&performance.now()<routeDeadline){await new Promise(resolve=>setTimeout(resolve,20));importButton=document.querySelector('[data-action=import-layout]');}if(!importButton)return {ok:false,reason:'layout import action missing',route:location.hash,main:document.querySelector('#main')?.innerText?.slice(0,200)};importButton.click();const deadline=performance.now()+5000;while(!document.querySelector('#main')?.innerText.includes('UIA_UNLABELLED')&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));const text=document.querySelector('#main')?.innerText||'';return {ok:text.includes('UIA_UNLABELLED')&&text.includes('UIA_INVISIBLE_NODE')&&text.includes('Warning')&&text.includes('High')&&text.includes('emptyLabelFields')&&text.includes('invisible'),ruleId:text.includes('UIA_UNLABELLED'),invisibleNode:text.includes('UIA_INVISIBLE_NODE'),severity:text.includes('Warning'),confidence:text.includes('High'),evidence:text.includes('emptyLabelFields')};}finally{HTMLInputElement.prototype.click=originalClick;location.hash='#overview';await settle();}})()`);
      smokeStep='HPROF Markdown export';rendererState.heapMarkdownExport=await window.webContents.executeJavaScript(`(async()=>{const settle=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));location.hash='#heap';await settle();const button=document.querySelector('[data-action=heap-export-markdown]');if(!button)return {ok:false,reason:'HPROF Markdown export button missing'};const search=document.querySelector('#heap-search');if(search){search.value='Foo';search.dispatchEvent(new Event('input',{bubbles:true}));await settle();}const deadline=performance.now()+5000;while(button.disabled&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));if(button.disabled)return {ok:false,reason:'HPROF actions are still busy'};let blob=null;const originalCreate=URL.createObjectURL,originalClick=HTMLAnchorElement.prototype.click;try{URL.createObjectURL=value=>{blob=value;return 'blob:heap-markdown-smoke';};HTMLAnchorElement.prototype.click=()=>{};button.click();if(!blob)return {ok:false,reason:'Markdown export did not create a Blob'};const text=await blob.text(),ok=blob.type.startsWith('text/markdown')&&text.startsWith('# HPROF class statistics')&&text.includes('| com.example.Foo |')&&!text.includes('byte[]')&&text.includes('not shallow or retained size');return {ok,type:blob.type,filteredClassIncluded:text.includes('com.example.Foo'),unfilteredClassExcluded:!text.includes('byte[]'),bytes:blob.size};}finally{URL.createObjectURL=originalCreate;HTMLAnchorElement.prototype.click=originalClick;location.hash='#overview';await settle();}})()`);
      smokeStep='HPROF JSON export';rendererState.heapJsonExport=await window.webContents.executeJavaScript(`(async()=>{const settle=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));location.hash='#heap';await settle();const button=document.querySelector('[data-action=heap-export-json]');if(!button)return {ok:false,reason:'HPROF JSON export button missing'};const search=document.querySelector('#heap-search');if(search){search.value='Foo';search.dispatchEvent(new Event('input',{bubbles:true}));await settle();}const deadline=performance.now()+5000;while(button.disabled&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));if(button.disabled)return {ok:false,reason:'HPROF actions are still busy'};let blob=null;const originalCreate=URL.createObjectURL,originalClick=HTMLAnchorElement.prototype.click;try{URL.createObjectURL=value=>{blob=value;return 'blob:heap-json-smoke';};HTMLAnchorElement.prototype.click=()=>{};button.click();if(!blob)return {ok:false,reason:'JSON export did not create a Blob'};const text=await blob.text(),data=JSON.parse(text),ok=blob.type.startsWith('application/json')&&data.kind==='classes'&&data.schemaVersion===1&&data.rows.some(row=>row.className==='com.example.Foo')&&!data.rows.some(row=>row.className==='byte[]')&&data.rows[0].fieldElementPayloadBytes!==undefined;return {ok,type:blob.type,filteredClassIncluded:data.rows.some(row=>row.className==='com.example.Foo'),unfilteredClassExcluded:!data.rows.some(row=>row.className==='byte[]'),bytes:blob.size};}finally{URL.createObjectURL=originalCreate;HTMLAnchorElement.prototype.click=originalClick;location.hash='#overview';await settle();}})()`);
      smokeStep='home artifacts';rendererState.homeArtifactChecks=await window.webContents.executeJavaScript("(()=>{const text=document.querySelector('#main')?.innerText||'';return {section:text.includes('最近分析产物')||text.includes('Recent analysis artifacts'),emptyState:text.includes('暂无本地分析产物')||text.includes('No local analysis artifacts')};})()");
      smokeStep='source workspace';rendererState.sourceWorkspaceSmoke=await smokeSourceWorkspaceInRenderer();
      smokeStep='network agent package';rendererState.networkAgentPackage=await smokeNetworkAgentPackageInRenderer();
      smokeStep='network JSON export';rendererState.networkJsonExport=await smokeNetworkJsonExportInRenderer();
      smokeStep='LeakCanary Debug Agent package';rendererState.leakCanaryAgentPackage=await smokeLeakCanaryAgentPackageInRenderer();
      smokeStep='JankStats Debug Agent package';rendererState.jankStatsAgentPackage=await smokeJankStatsAgentPackageInRenderer();
      smokeStep='Startup Debug Agent package';rendererState.startupAgentPackage=await smokeStartupAgentPackageInRenderer();
      smokeStep='startup comparison';rendererState.startupComparisonSmoke=await smokeStartupComparisonInRenderer();
      smokeStep='startup exports';rendererState.startupExportSmoke=await smokeStartupExportsInRenderer();
      smokeStep='Benchmark regression';rendererState.benchmarkRegressionSmoke=await smokeBenchmarkRegressionInRenderer();
      if(process.env.APW_SMOKE_NETWORK_SERIAL&&process.env.APW_SMOKE_NETWORK_PACKAGE)rendererState.networkAgentDeviceSmoke=await smokeNetworkAgentDeviceInRenderer(process.env.APW_SMOKE_NETWORK_SERIAL,process.env.APW_SMOKE_NETWORK_PACKAGE);
      if(process.env.APW_SMOKE_APK_PATH)rendererState.apkAnalysisSmoke=await smokeApkAnalyzerInRenderer(process.env.APW_SMOKE_APK_PATH);
      smokeStep='trace-only layout evidence';rendererState.layoutTraceOnlySmoke=await smokeTraceOnlyLayoutEvidence();
      smokeStep='trace analysis report export';rendererState.traceAnalysisReportSmoke=await smokeTraceAnalysisReportInRenderer();
      smokeStep='Perfetto UI CSV report import';rendererState.perfettoUiCsvSmoke=await smokePerfettoUiCsvReportInRenderer();
      smokeStep='Perfetto UI CSV download bridge';rendererState.perfettoUiCsvBridgeSmoke=await smokePerfettoUiCsvDownloadBridgeInRenderer();if(!rendererState.perfettoUiCsvBridgeSmoke?.ok)console.error('Perfetto UI CSV download bridge smoke detail:',JSON.stringify(rendererState.perfettoUiCsvBridgeSmoke));
      smokeStep='power UID energy diagnostics';rendererState.powerUidEnergySmoke=await smokePowerUidEnergyInRenderer();
      const checksValid=results=>Array.isArray(results)&&results.length===rendererState.navItems&&results.every((result,index)=>result.active&&result.heading&&result.hasContent&&(index===0||result.changed));
      const demoCpuRoute=routeChecks.demo.find(result=>result.route==='#cpu-profile');
      const routeGateChecks={routeChecksDemoActive:routeChecks.demoActive,emptyRoutes:checksValid(routeChecks.empty),demoRoutes:checksValid(routeChecks.demo),cpuStackTimeline:!!demoCpuRoute?.stackTimeline,deepCpuStackDetail:!!rendererState.deepCpuStackSmoke?.ok,cpuPngExport:!!rendererState.cpuPngExport?.ok,cpuLargeTimeline:!!rendererState.cpuLargeTimeline?.ok,heapCsvExport:!!rendererState.heapCsvExport?.ok,heapDominatorGraph:!!rendererState.heapCsvExport?.dominatorGraph?.ok,heapMarkdownExport:!!rendererState.heapMarkdownExport?.ok,heapJsonExport:!!rendererState.heapJsonExport?.ok,layoutFindings:!!rendererState.layoutFindings?.ok,homeArtifactSection:!!rendererState.homeArtifactChecks.section,homeArtifactEmptyState:!!rendererState.homeArtifactChecks.emptyState,networkAgentPackage:!!rendererState.networkAgentPackage?.ok,networkJsonExport:!!rendererState.networkJsonExport?.ok,leakCanaryAgentPackage:!!rendererState.leakCanaryAgentPackage?.ok,jankStatsAgentPackage:!!rendererState.jankStatsAgentPackage?.ok,startupAgentPackage:!!rendererState.startupAgentPackage?.ok,startupComparison:!!rendererState.startupComparisonSmoke?.ok,startupExport:!!rendererState.startupExportSmoke?.ok,benchmarkRegression:!!rendererState.benchmarkRegressionSmoke?.ok,layoutTraceOnly:!!rendererState.layoutTraceOnlySmoke?.ok,traceAnalysisReport:!!rendererState.traceAnalysisReportSmoke?.ok,perfettoUiCsvReport:!!rendererState.perfettoUiCsvSmoke?.ok,perfettoUiCsvBridge:!!rendererState.perfettoUiCsvBridgeSmoke?.ok,powerUidEnergy:!!rendererState.powerUidEnergySmoke?.ok,sourceWorkspace:!process.env.APW_SMOKE_SOURCE_DIR||!!rendererState.sourceWorkspaceSmoke?.ok,apkAnalysis:!process.env.APW_SMOKE_APK_PATH||!!rendererState.apkAnalysisSmoke?.ok,networkAgentDevice:!process.env.APW_SMOKE_NETWORK_SERIAL||!!rendererState.networkAgentDeviceSmoke?.ok};
      rendererState.failedReadinessChecks=Object.entries(routeGateChecks).filter(([,passed])=>!passed).map(([name])=>name);
      const routesReady=rendererState.failedReadinessChecks.length===0;
      const rendererReady = rendererState.navItems > 0 && rendererState.mainPresent && rendererState.quickActionRoutes.length >= 13 && routesReady;
      const menuLabels=Menu.getApplicationMenu()?.items.map(item=>item.label)||[];
      rendererState.smokeRendererMessages=smokeRendererMessages.slice(-50);
      await writeFile(process.env.APW_SMOKE_READY_FILE, JSON.stringify({ origin, rendererReady, rendererState, menuLabels }), { mode: 0o600 });
    } catch (error) { const detail=`${smokeStep}: ${error.stack||error.message||String(error)}`;console.error('Desktop smoke readiness check failed:', detail);await writeFile(process.env.APW_SMOKE_READY_FILE,JSON.stringify({error:detail}),{mode:0o600}).catch(()=>{}); }
  });
  window.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== origin) { event.preventDefault(); openExternal(url); } });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('will-prevent-unload', event => {
    const choice = dialog.showMessageBoxSync(window, { type: 'question', title: nativeText(appearanceLanguage,'采集尚未结束','Capture in Progress'), message: nativeText(appearanceLanguage,'当前有采集任务正在运行。确定关闭吗？','A capture is still running. Are you sure you want to close?'), detail: nativeText(appearanceLanguage,'尚未保存的采样将丢失。','Unsaved samples will be lost.'), buttons: [nativeText(appearanceLanguage,'继续采集','Keep Capturing'), nativeText(appearanceLanguage,'关闭窗口','Close Window')], defaultId: 0, cancelId: 0 });
    if (choice === 1) event.preventDefault();
  });
  window.on('closed', () => { window = null; });
  window.loadURL(origin);
}

if (singleInstance) {
  app.on('second-instance', () => { if (!window) createWindow(); else { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(async () => {
    app.setAboutPanelOptions({ applicationName: 'Android Performance', applicationVersion: VERSION, version: VERSION, copyright: '本地 Android 性能采集与分析工作台', iconPath: join(here, 'resources', 'icon.png') });
    if (process.platform === 'darwin') app.dock.setIcon(nativeImage.createFromPath(join(here, 'resources', 'icon.png')));
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.on('will-download', (_event, item, webContents) => {
      if (webContents !== window?.webContents) { item.cancel(); return; }
      // Electron shows a native save dialog for JSON reports and Perfetto traces.
      item.setSaveDialogOptions({ title: nativeText(appearanceLanguage,'保存性能采集文件','Save Performance Capture'), defaultPath: join(app.getPath('downloads'), item.getFilename()) });
      item.on('done', (_event, status) => { if (status === 'interrupted') dialog.showErrorBox(nativeText(appearanceLanguage,'下载失败','Download Failed'), nativeText(appearanceLanguage,'文件保存被中断，请重试。','Saving the file was interrupted. Please try again.')); });
    });
    ipcMain.handle('workbench:agi-status',async event=>{authorizeGpuIpc(event);return await existingAgi();});
    ipcMain.handle('workbench:get-appearance',async event=>{
      authorizeGpuIpc(event);const defaults={theme:'system',scale:'1',language:'zh-CN'};try{const settings=JSON.parse(await readFile(join(app.getPath('userData'),'settings.json'),'utf8')),saved={};if(typeof settings.theme==='string')saved.theme=settings.theme;if(settings.scale!==undefined)saved.scale=settings.scale;if(typeof settings.language==='string')saved.language=settings.language;return {...defaults,...(Object.keys(saved).length?normalizeAppearance(saved):{})};}catch(error){if(error.code==='ENOENT')return defaults;return defaults;}
    });
    ipcMain.handle('workbench:save-appearance',async(event,value)=>{authorizeGpuIpc(event);const appearance=normalizeAppearance(value);await saveSettings(appearance);appearanceLanguage=appearance.language;installMenu(appearanceLanguage);return appearance;});
    ipcMain.handle('workbench:source-select',async event=>{authorizeGpuIpc(event);if(process.env.APW_SMOKE_READY_FILE&&process.env.APW_SMOKE_SOURCE_DIR)return process.env.APW_SMOKE_SOURCE_DIR;const result=await dialog.showOpenDialog(window,{title:nativeText(appearanceLanguage,'选择本地源码目录','Select Local Source Directory'),properties:['openDirectory']});return result.canceled?null:result.filePaths[0];});
    ipcMain.handle('workbench:baseline-profile-select',async event=>{authorizeGpuIpc(event);const result=await dialog.showOpenDialog(window,{title:nativeText(appearanceLanguage,'选择 Baseline Profile','Select Baseline Profile'),properties:['openFile'],filters:[{name:'Baseline Profile',extensions:['txt','prof','profm']}]});return result.canceled?null:result.filePaths[0];});
    ipcMain.handle('workbench:agi-select',async event=>{authorizeGpuIpc(event);const result=await dialog.showOpenDialog(window,{title:nativeText(appearanceLanguage,'选择 Android GPU Inspector 应用程序','Select Android GPU Inspector Application'),properties:['openFile'],...(process.platform==='darwin'?{defaultPath:'/Applications'}:{})});if(result.canceled)return null;const chosen=result.filePaths[0];await access(chosen);agiPath=chosen;await saveSettings({agiPath});return chosen;});
    ipcMain.handle('workbench:agi-launch',async event=>{authorizeGpuIpc(event);const path=await existingAgi();if(!path)throw new Error(nativeText(appearanceLanguage,'未找到 AGI，请先选择应用程序','AGI was not found. Select the application first.'));const error=await shell.openPath(path);if(error)throw new Error(error);return true;});
    ipcMain.handle('workbench:agi-open-artifact',async(event,id)=>{
      authorizeGpuIpc(event);const agi=await existingAgi();if(!agi)throw new Error(nativeText(appearanceLanguage,'未找到 AGI，请先选择应用程序','AGI was not found. Select the application first.'));
      const prepared=await prepareAgiArtifact(join(app.getPath('userData'),'records','gpu-artifacts'),join(app.getPath('userData'),'gpu-open'),id);
      try{
        if(process.platform==='darwin'&&agi.toLowerCase().endsWith('.app'))await promisify(execFile)('/usr/bin/open',['-n','-a',agi,'--args',prepared.path],{timeout:30000});
        else {const child=spawn(agi,[prepared.path],{detached:true,stdio:'ignore'});await new Promise((resolve,reject)=>{child.once('error',reject);child.once('spawn',resolve);});child.unref();}
        return true;
      }catch(error){await rm(dirname(prepared.path),{recursive:true,force:true});throw new Error(`${nativeText(appearanceLanguage,'无法启动 AGI：','Could not launch AGI: ')}${error.message}`);}
    });
    const recordsDir = join(app.getPath('userData'), 'records');
    const javaRuntimeDir=app.isPackaged&&process.platform==='win32'
      ? await ensureWindowsJavaRuntime(join(process.resourcesPath,'java-runtime.tar.gz'),join(app.getPath('userData'),'runtime','java-runtime'))
      : app.isPackaged?join(process.resourcesPath,'java-runtime'):join(here,'..','tools','java-runtime');
    const javaPath=join(javaRuntimeDir,'bin',process.platform==='win32'?'java.exe':'java');
    const composeInspectorJavaPath=app.isPackaged?join(process.resourcesPath,'java25-runtime','bin','java'):join(here,'..','tools','java25-runtime','bin','java');
    let adbPath = await locateAdb();
    try { const settings = JSON.parse(await readFile(join(app.getPath('userData'), 'settings.json'), 'utf8')); if (typeof settings.adbPath === 'string') adbPath = settings.adbPath; if(typeof settings.agiPath==='string')agiPath=settings.agiPath;appearanceLanguage=normalizeAppearance(settings).language; } catch {}
    runtimeAdb = new Adb(adbPath);
    server = createApp({ adb: runtimeAdb, dataDir: recordsDir, desktop: true, sharkJavaPath: javaPath, composeInspectorJavaPath, javaPath });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    origin = `http://127.0.0.1:${server.address().port}`;
    installMenu(appearanceLanguage); createWindow();
    app.on('activate', () => { if (!window) createWindow(); });
  }).catch(async error => {
    if (process.env.APW_SMOKE_READY_FILE) await writeFile(process.env.APW_SMOKE_READY_FILE, JSON.stringify({ error: error.stack || error.message }), { mode: 0o600 }).catch(() => {});
    dialog.showErrorBox(nativeText(appearanceLanguage,'Android Performance 启动失败','Android Performance Failed to Start'), error.stack || error.message); app.quit();
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  // before-quit can be canceled by the unsaved-capture dialog. Keep the backend alive until quitting is final.
  app.on('will-quit', event => {
    if(!server?.listening)return;
    event.preventDefault();
    // Wait for local requests and trace temporary-file cleanup before Electron exits.
    server.close(() => app.exit(0));
    server.closeIdleConnections?.();
  });
}
