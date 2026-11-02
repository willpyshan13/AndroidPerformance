const { contextBridge, ipcRenderer } = require('electron');
const routes = new Set(['overview', 'monitor', 'cpu-profile', 'heap', 'battery', 'gpu', 'frames', 'startup', 'layout', 'trace', 'network', 'benchmark', 'apk', 'source', 'sessions', 'settings']);
contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  getAppearance: () => ipcRenderer.invoke('workbench:get-appearance'),
  saveAppearance: appearance => ipcRenderer.invoke('workbench:save-appearance', appearance),
  agiStatus: () => ipcRenderer.invoke('workbench:agi-status'),
  selectAgi: () => ipcRenderer.invoke('workbench:agi-select'),
  launchAgi: () => ipcRenderer.invoke('workbench:agi-launch'),
  openAgiArtifact: id => ipcRenderer.invoke('workbench:agi-open-artifact', id),
  selectSourceDir: () => ipcRenderer.invoke('workbench:source-select'),
  onAdbUpdated(callback) {
    if (typeof callback !== 'function') return;
    const handler = () => callback();
    ipcRenderer.on('workbench:adb-updated', handler);
    return () => ipcRenderer.removeListener('workbench:adb-updated', handler);
  },
  onNavigate(callback) {
    if (typeof callback !== 'function') return;
    const handler = (_event, route) => { if (routes.has(route)) callback(route); };
    ipcRenderer.on('workbench:navigate', handler);
    return () => ipcRenderer.removeListener('workbench:navigate', handler);
  },
});
