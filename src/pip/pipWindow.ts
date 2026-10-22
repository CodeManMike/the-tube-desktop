import { BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { PARTITION } from '../config';
import { overlayScript } from './overlay';

const PLAYER = `document.querySelector('#movie_player')`;

let pip: BrowserWindow | null = null;
let main: BrowserWindow | null = null;

export function isPipOpen(): boolean {
  return pip !== null;
}

export function getPip(): BrowserWindow | null {
  return pip;
}

function resumeMain(time: number): void {
  main?.webContents
    .executeJavaScript(`(() => { const p = ${PLAYER}; p.seekTo(${time}, true); p.playVideo(); })()`)
    .catch((err) => console.warn('[pip] resume failed:', err.message));
}

export async function openPip(mainWindow: BrowserWindow): Promise<void> {
  if (pip) return;
  main = mainWindow;
  const info = await main.webContents.executeJavaScript(`(() => {
    const p = ${PLAYER};
    const d = p && p.getVideoData && p.getVideoData();
    return d && d.video_id ? { id: d.video_id, t: p.getCurrentTime() } : null;
  })()`);
  if (!info) {
    console.log('[pip] no video');
    return;
  }
  await main.webContents.executeJavaScript(`${PLAYER}.pauseVideo()`);

  const win = new BrowserWindow({
    width: 480,
    height: 270,
    frame: false,
    alwaysOnTop: true,
    backgroundColor: '#000',
    webPreferences: {
      partition: PARTITION,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  pip = win;
  win.setAspectRatio(16 / 9);
  win.webContents.on('dom-ready', () => {
    win.webContents.executeJavaScript(overlayScript()).catch((err) => console.warn('[pip] overlay:', err.message));
  });

  // Every way of closing (⤢, Alt+F4, closePip) hands the current time back to main.
  let closing = false;
  win.on('close', async (event) => {
    if (closing) return;
    event.preventDefault();
    closing = true;
    const time = await win.webContents.executeJavaScript(`${PLAYER}.getCurrentTime()`).catch(() => info.t);
    win.destroy();
    resumeMain(time);
  });
  win.on('closed', () => {
    pip = null;
  });

  console.log(`[pip] open ${info.id} at ${info.t.toFixed(1)}s`);
  win.loadURL(`https://www.youtube.com/watch?v=${info.id}&t=${Math.floor(info.t)}s`).catch(() => {});
}

export function closePip(): void {
  pip?.close();
}

ipcMain.on('pip:toggleOnTop', (event) => {
  if (pip && event.sender === pip.webContents) pip.setAlwaysOnTop(!pip.isAlwaysOnTop());
});
ipcMain.on('pip:setAspect', (event, ratio: number) => {
  if (pip && event.sender === pip.webContents && ratio > 0) pip.setAspectRatio(ratio);
});
ipcMain.on('pip:close', (event) => {
  if (pip && event.sender === pip.webContents) pip.close();
});
