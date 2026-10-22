import { contextBridge, ipcRenderer } from 'electron';

// The queue page script's only channel to the app. Everything sent here is validated in
// the main process; the main process only ever sends state back. Only YouTube itself gets
// it (the same window also shows Google's sign-in pages).
if (location.hostname === 'www.youtube.com') contextBridge.exposeInMainWorld('ttd', {
  queue: {
    report: (event: unknown) => ipcRenderer.send('queue:event', event),
    ready: () => ipcRenderer.send('queue:ready'),
    onState: (cb: (payload: unknown) => void) => {
      ipcRenderer.removeAllListeners('queue:state');
      ipcRenderer.on('queue:state', (_event, payload) => cb(payload));
    },
  },
});
