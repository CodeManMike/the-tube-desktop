import { contextBridge, ipcRenderer } from 'electron';

// The PiP page's only channel to the app (see pip/page.ts). Everything sent here is
// checked in the main process; the main process only sends commands back.
if (location.hostname === 'www.youtube.com') contextBridge.exposeInMainWorld('ttdPip', {
  report: (event: unknown) => ipcRenderer.send('pip:event', event),
  control: (msg: unknown) => ipcRenderer.send('pip:control', msg),
  ready: () => ipcRenderer.send('pip:ready'),
  onCommand: (cb: (cmd: unknown) => void) => {
    ipcRenderer.removeAllListeners('pip:command');
    ipcRenderer.on('pip:command', (_event, cmd) => cb(cmd));
  },
});

// SponsorBlock segments for the skipping plugin (same bridge as the main window).
if (location.hostname === 'www.youtube.com') contextBridge.exposeInMainWorld('ttdSkip', {
  segments: (videoId: string) => ipcRenderer.invoke('skip:segments', videoId),
});
