import { BrowserWindow, ipcMain, IpcMainEvent, screen } from 'electron';
import path from 'path';
import { pipEntry } from '../../pip/page';
import { PARTITION } from '../config';
import { attachPageBundle } from '../pageBundle';
import { Playing } from '../queue/model';
import { QueueService } from '../queue/queueService';
import { SettingsStore } from '../settingsStore';
import { Rect } from '../windowState';
import { fitAspect, MIN_PIP_WIDTH, moveBy, pipBounds, resizeFromCorner } from './geometry';

const PLAYER = `document.querySelector('#movie_player')`;
const NOW_PLAYING = `(() => {
  const p = ${PLAYER};
  const d = p && p.getVideoData && p.getVideoData();
  return d && d.video_id ? { videoId: d.video_id, timeSec: p.getCurrentTime() } : null;
})()`;
const WATCH = /^https:\/\/www\.youtube\.com\/watch\?/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const finite = (...n: unknown[]) => n.every((v) => typeof v === 'number' && Number.isFinite(v));
const isPlaying = (v: any): v is Playing => !!v && typeof v.videoId === 'string' && VIDEO_ID.test(v.videoId) && finite(v.timeSec) && v.timeSec >= 0;

// The PiP window (spec §5.4): a second frameless window on the same session that plays
// the queue while it's open, then hands playback back to the main window.
export class PipWindow {
  private win: BrowserWindow | null = null;
  private opening = false;
  private handoff = true;
  private ratio = 16 / 9;
  private drag: { mode: 'move' | 'resize'; start: Rect; x: number; y: number } | null = null;
  private last: Playing | null = null;

  constructor(
    private readonly main: BrowserWindow,
    private readonly queue: QueueService,
    private readonly store: SettingsStore,
    private readonly icon: string,
  ) {
    ipcMain.on('pip:event', (event, raw) => {
      if (!this.fromPip(event)) return;
      if ((raw as any)?.type === 'progress' && isPlaying(raw)) this.last = { videoId: (raw as any).videoId, timeSec: (raw as any).timeSec };
      queue.handlePip(raw);
    });
    ipcMain.on('pip:ready', (event) => {
      if (this.fromPip(event)) this.send({ onTop: this.win!.isAlwaysOnTop() });
    });
    ipcMain.on('pip:control', (event, msg) => {
      if (this.fromPip(event)) this.control(msg);
    });
  }

  isOpen(): boolean {
    return this.win !== null;
  }

  private fromPip(event: IpcMainEvent): boolean {
    const ok = !!this.win && event.sender === this.win.webContents && /^https:\/\/www\.youtube\.com\//.test(event.senderFrame?.url ?? '');
    if (!ok) console.warn(`[pip] ignored a message from an unexpected sender: ${event.senderFrame?.url ?? 'unknown'}`);
    return ok;
  }

  private send(cmd: object): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('pip:command', cmd);
  }

  private area(): Rect {
    return screen.getDisplayMatching(this.win!.getBounds()).workArea;
  }

  private save(): void {
    if (!this.win) return;
    this.store.setPipState({ ...this.win.getBounds(), alwaysOnTop: this.win.isAlwaysOnTop() });
  }

  private control(msg: any): void {
    const win = this.win!;
    switch (msg?.kind) {
      case 'toggleOnTop':
        win.setAlwaysOnTop(!win.isAlwaysOnTop());
        this.save();
        this.send({ onTop: win.isAlwaysOnTop() });
        return;
      case 'return':
        this.close();
        return;
      case 'aspect':
        if (!finite(msg.ratio) || msg.ratio < 0.25 || msg.ratio > 4 || Math.abs(msg.ratio - this.ratio) < 0.01) return;
        this.ratio = msg.ratio;
        win.setAspectRatio(this.ratio);
        win.setBounds(fitAspect(win.getBounds(), this.ratio, this.area()));
        return;
      case 'dragStart':
        if ((msg.mode !== 'move' && msg.mode !== 'resize') || !finite(msg.screenX, msg.screenY)) break;
        this.drag = { mode: msg.mode, start: win.getBounds(), x: msg.screenX, y: msg.screenY };
        return;
      case 'dragMove': {
        if (!this.drag || !finite(msg.screenX, msg.screenY)) return;
        const dx = msg.screenX - this.drag.x;
        const dy = msg.screenY - this.drag.y;
        // Always from where the drag started, so rounding never accumulates.
        win.setBounds(this.drag.mode === 'move' ? moveBy(this.drag.start, dx, dy) : resizeFromCorner(this.drag.start, dx, dy, this.ratio, this.area()));
        return;
      }
      case 'dragEnd':
        this.drag = null;
        this.save();
        return;
    }
    console.warn('[pip] ignored an invalid control message');
  }

  async open(): Promise<void> {
    if (this.win || this.opening) return;
    this.opening = true;
    try {
      const at = await this.main.webContents.executeJavaScript(NOW_PLAYING).catch(() => null);
      if (!isPlaying(at)) {
        console.log('[pip] no video');
        return;
      }
      await this.main.webContents.executeJavaScript(`${PLAYER}.pauseVideo()`).catch(() => {});

      const saved = this.store.getPipState();
      const win = new BrowserWindow({
        ...pipBounds(saved, screen.getAllDisplays().map((d) => d.workArea)),
        frame: false,
        alwaysOnTop: saved?.alwaysOnTop ?? true,
        backgroundColor: '#000',
        minWidth: MIN_PIP_WIDTH,
        icon: this.icon,
        title: 'The Tube Desktop — PiP',
        webPreferences: {
          partition: PARTITION,
          preload: path.join(__dirname, '..', '..', 'preload', 'pip.js'),
          contextIsolation: true,
          sandbox: true,
        },
      });
      this.win = win;
      this.handoff = true;
      this.last = at;
      this.ratio = 16 / 9;
      win.setAspectRatio(this.ratio);

      // PiP only ever shows a watch page; nothing else loads or opens from it.
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      const guard = (event: Electron.Event, url: string) => {
        if (url !== 'about:blank' && !WATCH.test(url)) event.preventDefault();
      };
      win.webContents.on('will-navigate', guard);
      win.webContents.on('will-redirect', (event, url, _inPlace, isMainFrame) => {
        if (isMainFrame) guard(event, url);
      });

      // Every way of closing (Return, Alt+F4, the taskbar) goes through here.
      let closing = false;
      win.on('close', async (event) => {
        if (closing) return;
        event.preventDefault();
        closing = true;
        const now = await win.webContents.executeJavaScript(NOW_PLAYING).catch(() => null);
        const resumeAt = isPlaying(now) ? now : this.last;
        this.save();
        win.destroy();
        if (this.handoff && resumeAt) this.queue.resumeInMain(resumeAt);
        else this.queue.setPlayer(null);
        console.log(`[pip] closed${this.handoff && resumeAt ? `; main resumes ${resumeAt.videoId} at ${resumeAt.timeSec.toFixed(1)}s` : ''}`);
      });
      win.on('closed', () => {
        this.win = null;
        this.drag = null;
      });

      await attachPageBundle(win.webContents, () => [pipEntry()]);
      this.queue.setPlayer({ webContents: win.webContents, navigate: (cmd) => this.send(cmd) }, () => this.dismiss());
      console.log(`[pip] open ${at.videoId} at ${at.timeSec.toFixed(1)}s`);
      win.loadURL(`https://www.youtube.com/watch?v=${at.videoId}&t=${Math.floor(at.timeSec)}s`).catch(() => {});
    } catch (err) {
      console.warn(`[pip] open failed: ${(err as Error).message}`);
      this.win?.destroy();
    } finally {
      this.opening = false;
    }
  }

  // Back to the main window at PiP's time.
  close(): void {
    this.win?.close();
  }

  // The main window took over (or is closing): close without handing back.
  dismiss(): void {
    this.handoff = false;
    this.win?.close();
  }
}
