import { contextBridge, ipcRenderer } from 'electron';

// Bridge for the PiP overlay's buttons (exposed to the page's main world).
contextBridge.exposeInMainWorld('tube', {
  toggleOnTop: () => ipcRenderer.send('pip:toggleOnTop'),
  setAspect: (ratio: number) => ipcRenderer.send('pip:setAspect', ratio),
  close: (currentTime: number) => ipcRenderer.send('pip:close', currentTime),
});
