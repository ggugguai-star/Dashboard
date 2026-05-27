const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openPath:       (url)    => ipcRenderer.invoke('open-url', url),
  googleAuthStart:(params) => ipcRenderer.invoke('google-auth-start', params),
  quitApp:        ()       => ipcRenderer.invoke('quit-app'),
  statPath:       (p)      => ipcRenderer.invoke('stat-path', p),
});
