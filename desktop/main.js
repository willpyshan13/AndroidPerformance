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
    location.hash='#overview';await settle();
    return {ok:true,nativePickerBridge:true,pathSelected:true,snapshotFiles,searchMatch:true,matchedPath,fileOpened:true};
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
  window = new BrowserWindow({
    width: 1440, height: 1000, minWidth: 960, minHeight: 680,
    title: 'Android Performance', backgroundColor: '#f5f7f9', show: false,
    icon: join(here, 'resources', 'icon.png'),
    webPreferences: { preload: join(here, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, spellcheck: false },
  });
  window.once('ready-to-show', () => window.show());
  if (process.env.APW_SMOKE_READY_FILE) window.webContents.once('did-finish-load', async () => {
    try {
      const deadline = Date.now() + 10_000;
      let rendererState;
      do {
        rendererState = await window.webContents.executeJavaScript("({title:document.title,readyState:document.readyState,navItems:document.querySelectorAll('#nav .nav-item').length,quickActionRoutes:Array.from(document.querySelectorAll('[data-quick-action-route]'),item=>item.dataset.quickActionRoute),mainPresent:document.querySelector('#main')!==null,mainText:document.querySelector('#main')?.innerText?.slice(0,160)||'',script:document.querySelector('script[type=module]')?.src||''})");
        if (rendererState.navItems > 0 && rendererState.mainPresent && rendererState.quickActionRoutes.length >= 13) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      } while (Date.now() < deadline);
      const routeChecks=await window.webContents.executeJavaScript("(async()=>{const settle=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))),cjk=/[\\u3400-\\u9fff]/,localized='h1,h2,h3,h4,a,button,label,th,dt,option,small,strong,p,.hint,.subtle,.tag,.eyebrow,.metric-note,.section-heading span,.footer-tagline,.empty,.empty-chart';const visitRoutes=async()=>{const links=Array.from(document.querySelectorAll('#nav .nav-item'));const results=[];let previous=document.querySelector('#main')?.innerText?.trim()||'';for(const link of links){const route=link.getAttribute('href');location.hash=route;await new Promise(resolve=>setTimeout(resolve,0));await settle();const main=document.querySelector('#main'),canvas=main?.querySelector('#cpu-stack-timeline');let stackTimeline=false;if(route==='#cpu-profile'&&canvas&&canvas.width>0&&canvas.height>0){const rect=canvas.getBoundingClientRect();canvas.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2}));await settle();const dialog=document.querySelector('#detail-dialog'),apply=dialog?.querySelector('[data-cpu-stack-apply]'),sampleDialog=!!dialog?.open&&!!apply;apply?.click();await settle();stackTimeline=sampleDialog&&!dialog.open&&!!document.querySelector('#cpu-stack-timeline');}const text=main?.innerText?.trim()||'',walker=document.createTreeWalker(main||document.body,NodeFilter.SHOW_TEXT);let node;const untranslated=[];while((node=walker.nextNode())&&untranslated.length<100){const parent=node.parentElement;if(!parent||!parent.matches(localized)||parent.closest('pre,code,textarea,input,td,.tree,#properties,.sample-screen,.phone-preview,[data-source-file],[data-source-match],[data-user-content]')||parent.matches('#appearance-language option[value=zh-CN]'))continue;const value=node.nodeValue.trim();if(value&&cjk.test(value))untranslated.push(value.slice(0,1000));}results.push({route,active:document.querySelector('#nav .nav-item.active')?.getAttribute('href')===route,heading:!!main?.querySelector('h1')?.innerText?.trim(),hasContent:text.length>0,changed:text!==previous,stackTimeline,untranslated});previous=text;}location.hash='#overview';await new Promise(resolve=>setTimeout(resolve,0));await settle();return results;};const empty=await visitRoutes();document.querySelector('#mode-btn').click();await settle();const demoActive=document.querySelector('#mode-btn')?.textContent?.trim()==='Exit demo mode';const demo=await visitRoutes();return {empty,demo,demoActive};})()");
      rendererState.routeChecks=routeChecks;
      rendererState.cpuPngExport=await window.webContents.executeJavaScript(`(async()=>{const settle=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));location.hash='#cpu-profile';await new Promise(resolve=>setTimeout(resolve,0));await settle();const canvas=document.querySelector('#cpu-stack-timeline'),button=document.querySelector('[data-action=export-cpu-stack-timeline]');if(!canvas||!button)return {ok:false,reason:'CPU chart or export button missing'};let blob=null;const originalCreate=URL.createObjectURL,originalClick=HTMLAnchorElement.prototype.click;try{URL.createObjectURL=value=>{blob=value;return 'blob:cpu-export-smoke';};HTMLAnchorElement.prototype.click=()=>{};button.click();const deadline=performance.now()+5000;while(!blob&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));if(!blob)return {ok:false,reason:'PNG blob was not created'};const signature=Array.from(new Uint8Array(await blob.slice(0,8).arrayBuffer())).join(',')==='137,80,78,71,13,10,26,10';const image=await createImageBitmap(blob);return {ok:signature&&image.width>0&&image.height>0,type:blob.type,width:image.width,height:image.height};}finally{URL.createObjectURL=originalCreate;HTMLAnchorElement.prototype.click=originalClick;location.hash='#overview';await new Promise(resolve=>setTimeout(resolve,0));await settle();}})()`);
      rendererState.cpuLargeTimeline=await window.webContents.executeJavaScript(`(async()=>{const {buildSampleTimeline,sampleStackTimeline,drawSampleStackTimeline}=await import(location.origin+'/offline.js'),sampleCount=50000,origin=1730000000000000000n,frames=Array.from({length:24},(_,depth)=>'module'+(depth%4)+'.function'+depth),threads=Array.from({length:32},(_,index)=>'worker-'+index),samples=Array.from({length:sampleCount},(_,index)=>({timeNs:String(origin+BigInt(index)*20000000n),period:String(700+index%900),pid:18472,tid:19000+index%threads.length,thread:threads[index%threads.length],frames}));const start=performance.now(),timeline=buildSampleTimeline({event:'cpu-clock:u',clockId:'monotonic',samples}),indexed=performance.now(),projection=sampleStackTimeline(timeline),projected=performance.now(),canvas=document.createElement('canvas'),draw=drawSampleStackTimeline(canvas,projection),drawn=performance.now(),pixelBytes=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data.length,rasterized=performance.now();return {ok:timeline.samples.length===sampleCount&&projection.renderedSamples===2000&&draw.drawnFrames>0&&pixelBytes>0,samples:timeline.samples.length,renderedSamples:projection.renderedSamples,drawnFrames:draw.drawnFrames,pixelBytes,indexMs:Math.round((indexed-start)*100)/100,projectionMs:Math.round((projected-indexed)*100)/100,drawMs:Math.round((drawn-projected)*100)/100,rasterReadMs:Math.round((rasterized-drawn)*100)/100,totalMs:Math.round((rasterized-start)*100)/100};})()`);
      rendererState.heapCsvExport=await window.webContents.executeJavaScript(`(async()=>{const settle=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))),bytes=Uint8Array.from(atob('SkFWQSBQUk9GSUxFIDEuMC4zAAAAAAQAAAAAAAAAAAEAAAAAAAAAEwAAAAFjb20vZXhhbXBsZS9Gb28CAAAAAAAAABAAAAABAAAAAgAAAAAAAAABHAAAAAAAAAArIQAAAAMAAAAAAAAAAgAAAAQAAAAqIwAAAAQAAAAAAAAAAwgBAgP/AAAAAywAAAAAAAAAAA=='),character=>character.charCodeAt(0)),input=document.querySelector('#heap-input'),transfer=new DataTransfer();if(!input)return {ok:false,reason:'HPROF file input missing'};location.hash='#heap';await settle();transfer.items.add(new File([bytes],'smoke.hprof',{type:'application/octet-stream'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));const deadline=performance.now()+10000;while(!document.querySelector('[data-action=heap-export-csv]')&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));if(!document.querySelector('[data-action=heap-export-csv]'))return {ok:false,reason:'HPROF import did not render class table',files:input.files?.length,toast:document.querySelector('#toast')?.textContent,toastClass:document.querySelector('#toast')?.className};const search=document.querySelector('#heap-search');search.value='Foo';search.dispatchEvent(new Event('input',{bubbles:true}));await settle();let blob=null;const originalCreate=URL.createObjectURL,originalClick=HTMLAnchorElement.prototype.click;try{URL.createObjectURL=value=>{blob=value;return 'blob:heap-csv-smoke';};HTMLAnchorElement.prototype.click=()=>{};document.querySelector('[data-action=heap-export-csv]').click();if(!blob)return {ok:false,reason:'CSV export did not create a Blob'};const text=await blob.text(),signature=Array.from(new Uint8Array(await blob.slice(0,3).arrayBuffer()));const utf8Bom=signature.join(',')==='239,187,191';return {ok:blob.type.startsWith('text/csv')&&utf8Bom&&text.includes('com.example.Foo')&&!text.includes('byte[]'),type:blob.type,filteredClassIncluded:text.includes('com.example.Foo'),unfilteredClassExcluded:!text.includes('byte[]'),utf8Bom,bytes:blob.size};}finally{URL.createObjectURL=originalCreate;HTMLAnchorElement.prototype.click=originalClick;location.hash='#overview';await settle();}})()`);
      rendererState.layoutFindings=await window.webContents.executeJavaScript(`(async()=>{const settle=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))),xml='<hierarchy rotation="0"><node class="android.widget.Button" text="" content-desc="" clickable="true" bounds="[0,0][20,20]"/></hierarchy>',input=document.querySelector('#file-input'),transfer=new DataTransfer();if(!input)return {ok:false,reason:'layout file input missing'};location.hash='#layout';await settle();transfer.items.add(new File([xml],'smoke.xml',{type:'application/xml'}));const originalClick=HTMLInputElement.prototype.click;try{HTMLInputElement.prototype.click=function(){if(this.id==='file-input'){this.files=transfer.files;this.dispatchEvent(new Event('change',{bubbles:true}));}else originalClick.call(this);};document.querySelector('[data-action=import-layout]').click();const deadline=performance.now()+5000;while(!document.querySelector('#main')?.innerText.includes('UIA_UNLABELLED')&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));const text=document.querySelector('#main')?.innerText||'';return {ok:text.includes('UIA_UNLABELLED')&&text.includes('Warning')&&text.includes('High')&&text.includes('emptyLabelFields'),ruleId:text.includes('UIA_UNLABELLED'),severity:text.includes('Warning'),confidence:text.includes('High'),evidence:text.includes('emptyLabelFields')};}finally{HTMLInputElement.prototype.click=originalClick;location.hash='#overview';await settle();}})()`);
      rendererState.homeArtifactChecks=await window.webContents.executeJavaScript("(()=>{const text=document.querySelector('#main')?.innerText||'';return {section:text.includes('最近分析产物')||text.includes('Recent analysis artifacts'),emptyState:text.includes('暂无本地分析产物')||text.includes('No local analysis artifacts')};})()");
      rendererState.sourceWorkspaceSmoke=await smokeSourceWorkspaceInRenderer();
      if(process.env.APW_SMOKE_APK_PATH)rendererState.apkAnalysisSmoke=await smokeApkAnalyzerInRenderer(process.env.APW_SMOKE_APK_PATH);
      const checksValid=results=>Array.isArray(results)&&results.length===rendererState.navItems&&results.every((result,index)=>result.active&&result.heading&&result.hasContent&&(index===0||result.changed));
      const demoCpuRoute=routeChecks.demo.find(result=>result.route==='#cpu-profile');
      const routesReady=routeChecks.demoActive&&checksValid(routeChecks.empty)&&checksValid(routeChecks.demo)&&demoCpuRoute?.stackTimeline&&rendererState.cpuPngExport?.ok&&rendererState.cpuLargeTimeline?.ok&&rendererState.heapCsvExport?.ok&&rendererState.layoutFindings?.ok&&rendererState.homeArtifactChecks.section&&rendererState.homeArtifactChecks.emptyState&&(!process.env.APW_SMOKE_SOURCE_DIR||rendererState.sourceWorkspaceSmoke?.ok)&&(!process.env.APW_SMOKE_APK_PATH||rendererState.apkAnalysisSmoke?.ok);
      const rendererReady = rendererState.navItems > 0 && rendererState.mainPresent && rendererState.quickActionRoutes.length >= 13 && routesReady;
      const menuLabels=Menu.getApplicationMenu()?.items.map(item=>item.label)||[];
      await writeFile(process.env.APW_SMOKE_READY_FILE, JSON.stringify({ origin, rendererReady, rendererState, menuLabels }), { mode: 0o600 });
    } catch (error) { console.error('Desktop smoke readiness check failed:', error); }
  });
  if (process.env.APW_SMOKE_READY_FILE) {
    window.webContents.on('console-message', details => console.error(`Renderer console ${details.level}: ${details.message} (${details.sourceId}:${details.lineNumber})`));
    window.webContents.on('did-fail-load', (_event, code, description, url) => console.error(`Renderer navigation failed (${code}): ${description} ${url}`));
    window.webContents.on('render-process-gone', (_event, details) => console.error(`Renderer process exited: ${details.reason} (${details.exitCode})`));
  }
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
    let adbPath = await locateAdb();
    try { const settings = JSON.parse(await readFile(join(app.getPath('userData'), 'settings.json'), 'utf8')); if (typeof settings.adbPath === 'string') adbPath = settings.adbPath; if(typeof settings.agiPath==='string')agiPath=settings.agiPath;appearanceLanguage=normalizeAppearance(settings).language; } catch {}
    runtimeAdb = new Adb(adbPath);
    server = createApp({ adb: runtimeAdb, dataDir: recordsDir, desktop: true, sharkJavaPath: javaPath, composeInspectorJavaPath: javaPath, javaPath });
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
