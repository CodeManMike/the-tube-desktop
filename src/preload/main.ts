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
  // The sidebar's "TTD settings" entry (plugins/settingsLink.ts).
  settings: {
    open: () => ipcRenderer.send('settings:open'),
  },
});

// SponsorBlock segments for the skipping plugin (main window and PiP alike).
if (location.hostname === 'www.youtube.com') contextBridge.exposeInMainWorld('ttdSkip', {
  segments: (videoId: string) => ipcRenderer.invoke('skip:segments', videoId),
});

// TTD's own watch history, for Hide watched.
if (location.hostname === 'www.youtube.com') contextBridge.exposeInMainWorld('ttdHistory', {
  watched: (threshold: number) => ipcRenderer.invoke('history:watched', threshold),
});

// A channel blocked from the ⋮ menu, so the page can hide it straight away.
if (location.hostname === 'www.youtube.com') contextBridge.exposeInMainWorld('ttdBlock', {
  onAdded: (cb: (c: unknown) => void) => {
    ipcRenderer.removeAllListeners('blocklist:added');
    ipcRenderer.on('blocklist:added', (_event, c) => cb(c));
  },
});

// Return YouTube Dislike counts, for Show dislikes.
if (location.hostname === 'www.youtube.com') contextBridge.exposeInMainWorld('ttdRyd', {
  votes: (videoId: string) => ipcRenderer.invoke('ryd:votes', videoId),
});
