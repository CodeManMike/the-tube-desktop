import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('ttd', {
  list: () => ipcRenderer.invoke('settings:list'),
  setEnabled: (id: string, on: boolean) => ipcRenderer.invoke('settings:setEnabled', id, on),
  setValue: (id: string, key: string, value: unknown) => ipcRenderer.invoke('settings:setValue', id, key, value),
  support: () => ipcRenderer.send('settings:support'),
});
