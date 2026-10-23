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
    // Page-fetch requests for shuffle sources and full playlists (see FetchBridge).
    onFetch: (cb: (request: unknown) => void) => {
      ipcRenderer.removeAllListeners('queue:fetch');
      ipcRenderer.on('queue:fetch', (_event, request) => cb(request));
    },
  },
  pip: {
    open: () => ipcRenderer.send('pip:open'),
  },
});

// SponsorBlock segments for the skipping plugin (main window and PiP alike).
if (location.hostname === 'www.youtube.com') contextBridge.exposeInMainWorld('ttdSkip', {
  segments: (videoId: string) => ipcRenderer.invoke('skip:segments', videoId),
});
