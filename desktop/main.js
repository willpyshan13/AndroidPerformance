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

const here = dirname(fileURLToPath(import.meta.url));
const allowedExternal = new Set(['https://ui.perfetto.dev/', 'https://github.com/yuchuangu85/AndroidPerformanceStudio']);
let window, server, origin, runtimeAdb, agiPath=null;
const profilePath = process.env.APW_PROFILE_DIR || (!app.isPackaged ? join(here, '..', 'data', 'desktop-profile') : null);
if (profilePath) { mkdirSync(profilePath, { recursive: true }); app.setPath('userData', profilePath); }
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();

function navigate(route) {
  if (window && !window.isDestroyed()) { window.show(); window.webContents.send('workbench:navigate', route); }
}
function openExternal(url) {
  if (allowedExternal.has(url)) shell.openExternal(url).catch(error => dialog.showErrorBox('无法打开链接', error.message));
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
  if (runtimeAdb.busy.size) { dialog.showMessageBox(window, { message: '设备采集任务尚未结束，请等待完成后更换 ADB。' }); return; }
  const result = await dialog.showOpenDialog(window, { title: '选择 Android Platform Tools 中的 adb 程序', properties: ['openFile'], defaultPath: runtimeAdb.path === 'adb' ? app.getPath('home') : runtimeAdb.path });
  if (result.canceled) return;
  const path = result.filePaths[0];
  try {
    if (!['adb', 'adb.exe'].includes(basename(path).toLowerCase())) throw new Error('请选择 Android Platform Tools 中名为 adb 或 adb.exe 的程序');
    const candidate = new Adb(path);
    if (!(await candidate.run(['version'])).startsWith('Android Debug Bridge version')) throw new Error('该程序未返回有效 ADB 版本');
    await saveSettings({adbPath:path});
    runtimeAdb.path = path;
    runtimeAdb.cpuSnapshots.clear();
    window?.webContents.send('workbench:adb-updated');
  } catch (error) { dialog.showErrorBox('无法设置 ADB', error.message); }
}
function installMenu() {
  const isMac = process.platform === 'darwin';
  const menu = [
    ...(isMac ? [{ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: '文件', submenu: [
      { label: '采集记录', accelerator: 'CmdOrCtrl+O', click: () => navigate('sessions') },
      { label: '打开记录目录', click: async () => { const path = join(app.getPath('userData'), 'records'); mkdirSync(path, { recursive: true }); await shell.openPath(path); } },
      { label: '选择 ADB 程序…', click: chooseAdb },
      { type: 'separator' }, { role: isMac ? 'close' : 'quit', label: isMac ? '关闭窗口' : '退出' },
    ] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '分析', submenu: [
      ['overview', '概览', '1'], ['monitor', '实时监控', '2'], ['frames', '帧耗时分析', '3'], ['startup', '启动测试', '4'], ['layout', '布局检查', '5'], ['trace', '系统追踪', '6'], ['network', '网络分析', '7'], ['benchmark', '基准对比', '8'],
      ['apk', 'APK 分析', '9'], ['cpu-profile', 'CPU 采样'], ['heap', '内存堆分析'], ['battery', '电池与资源'], ['gpu', 'GPU 产物'], ['source', '源码工作区'],
    ].map(([route, label, key]) => ({ label, ...(key ? { accelerator: `CmdOrCtrl+${key}` } : {}), click: () => navigate(route) })) },
    { label: '视图', submenu: [{ role: 'resetZoom', label: '实际大小' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }, { type: 'separator' }, { role: 'togglefullscreen', label: '全屏' }, ...(!app.isPackaged ? [{ role: 'toggleDevTools', label: '开发者工具' }] : [])] },
    { label: '窗口', submenu: [{ role: 'minimize', label: '最小化' }, { role: 'zoom', label: '缩放' }, ...(isMac ? [{ role: 'front', label: '全部置前' }] : [])] },
    { label: '帮助', submenu: [ { label: '设置与帮助', accelerator: 'CmdOrCtrl+,', click: () => navigate('settings') }, { label: '打开 Perfetto UI', click: () => openExternal('https://ui.perfetto.dev/') }, ...(!isMac ? [{ label: '关于', click: () => app.showAboutPanel() }] : []) ] },
  ];
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
  window.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== origin) { event.preventDefault(); openExternal(url); } });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('will-prevent-unload', event => {
    const choice = dialog.showMessageBoxSync(window, { type: 'question', title: '采集尚未结束', message: '当前有采集任务正在运行。确定关闭吗？', detail: '尚未保存的采样将丢失。', buttons: ['继续采集', '关闭窗口'], defaultId: 0, cancelId: 0 });
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
      item.setSaveDialogOptions({ title: '保存性能采集文件', defaultPath: join(app.getPath('downloads'), item.getFilename()) });
      item.on('done', (_event, status) => { if (status === 'interrupted') dialog.showErrorBox('下载失败', '文件保存被中断，请重试。'); });
    });
    ipcMain.handle('workbench:agi-status',async event=>{authorizeGpuIpc(event);return await existingAgi();});
    ipcMain.handle('workbench:get-appearance',async event=>{
      authorizeGpuIpc(event);const defaults={theme:'system',scale:'1'};try{const settings=JSON.parse(await readFile(join(app.getPath('userData'),'settings.json'),'utf8')),saved={};if(typeof settings.theme==='string')saved.theme=settings.theme;if(settings.scale!==undefined)saved.scale=settings.scale;return {...defaults,...(Object.keys(saved).length?normalizeAppearance(saved):{})};}catch(error){if(error.code==='ENOENT')return defaults;return defaults;}
    });
    ipcMain.handle('workbench:save-appearance',async(event,value)=>{authorizeGpuIpc(event);const appearance=normalizeAppearance(value);await saveSettings(appearance);return appearance;});
    ipcMain.handle('workbench:source-select',async event=>{authorizeGpuIpc(event);const result=await dialog.showOpenDialog(window,{title:'选择本地源码目录',properties:['openDirectory']});return result.canceled?null:result.filePaths[0];});
    ipcMain.handle('workbench:agi-select',async event=>{authorizeGpuIpc(event);const result=await dialog.showOpenDialog(window,{title:'选择 Android GPU Inspector 应用程序',properties:['openFile'],...(process.platform==='darwin'?{defaultPath:'/Applications'}:{})});if(result.canceled)return null;const chosen=result.filePaths[0];await access(chosen);agiPath=chosen;await saveSettings({agiPath});return chosen;});
    ipcMain.handle('workbench:agi-launch',async event=>{authorizeGpuIpc(event);const path=await existingAgi();if(!path)throw new Error('未找到 AGI，请先选择应用程序');const error=await shell.openPath(path);if(error)throw new Error(error);return true;});
    ipcMain.handle('workbench:agi-open-artifact',async(event,id)=>{
      authorizeGpuIpc(event);const agi=await existingAgi();if(!agi)throw new Error('未找到 AGI，请先选择应用程序');
      const prepared=await prepareAgiArtifact(join(app.getPath('userData'),'records','gpu-artifacts'),join(app.getPath('userData'),'gpu-open'),id);
      try{
        if(process.platform==='darwin'&&agi.toLowerCase().endsWith('.app'))await promisify(execFile)('/usr/bin/open',['-n','-a',agi,'--args',prepared.path],{timeout:30000});
        else {const child=spawn(agi,[prepared.path],{detached:true,stdio:'ignore'});await new Promise((resolve,reject)=>{child.once('error',reject);child.once('spawn',resolve);});child.unref();}
        return true;
      }catch(error){await rm(dirname(prepared.path),{recursive:true,force:true});throw new Error(`无法启动 AGI：${error.message}`);}
    });
    const recordsDir = join(app.getPath('userData'), 'records');
    let adbPath = await locateAdb();
    try { const settings = JSON.parse(await readFile(join(app.getPath('userData'), 'settings.json'), 'utf8')); if (typeof settings.adbPath === 'string') adbPath = settings.adbPath; if(typeof settings.agiPath==='string')agiPath=settings.agiPath; } catch {}
    runtimeAdb = new Adb(adbPath);
    server = createApp({ adb: runtimeAdb, dataDir: recordsDir, desktop: true });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    origin = `http://127.0.0.1:${server.address().port}`;
    installMenu(); createWindow();
    app.on('activate', () => { if (!window) createWindow(); });
  }).catch(error => { dialog.showErrorBox('Android Performance 启动失败', error.stack || error.message); app.quit(); });
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
