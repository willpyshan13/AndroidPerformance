const { contextBridge, ipcRenderer } = require('electron');
const routes = new Set(['overview', 'monitor', 'frames', 'startup', 'layout', 'trace', 'network', 'benchmark', 'apk', 'sessions', 'settings']);
contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
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
