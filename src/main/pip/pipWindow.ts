import { BrowserWindow, ipcMain, IpcMainEvent, screen } from 'electron';
import path from 'path';
import { pipEntry } from '../../pip/page';
import { PageEntry } from '../../shared/plugin';
import { PARTITION } from '../config';
import { attachPageBundle } from '../pageBundle';
import { Playing } from '../queue/model';
import { QueueService } from '../queue/queueService';
import { SettingsStore } from '../settingsStore';
import { Rect } from '../windowState';
import { applyAudioScript, AudioState, audioOf } from './audio';
import { fitAspect, MIN_PIP_WIDTH, moveBy, openingBounds, resizeFromCorner, withTimeout } from './geometry';

const PLAYER = `document.querySelector('#movie_player')`;
// The player outlives the watch page (YouTube keeps it in the DOM), so a video only counts
// on a watch page or in the miniplayer, and while it's loaded (playing, paused, buffering).
const NOW_PLAYING = `(() => {
  const p = ${PLAYER};
  const d = p && p.getVideoData && p.getVideoData();
  const shown = location.pathname === '/watch' || !!document.querySelector('ytd-miniplayer[active], ytd-app[miniplayer-is-active]');
  const loaded = [1, 2, 3].includes(p && p.getPlayerState && p.getPlayerState());
  return shown && loaded && d && d.video_id
    ? { videoId: d.video_id, timeSec: p.getCurrentTime(), muted: !!(p.isMuted && p.isMuted()), volume: p.getVolume ? p.getVolume() : 100 }
    : null;
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
  // The main player's mute and volume when PiP opened, handed to PiP's player once it's ready.
  private openAudio: AudioState | null = null;

  constructor(
    private readonly main: BrowserWindow,
    private readonly queue: QueueService,
    private readonly store: SettingsStore,
    private readonly icon: string,
    // Plugins that also run in PiP (e.g. skipping); see PluginRegistry.pageEntries('pip').
    private readonly pluginEntries: () => PageEntry[] = () => [],
  ) {
    ipcMain.on('pip:event', (event, raw) => {
      if (!this.fromPip(event)) return;
      if ((raw as any)?.type === 'progress' && isPlaying(raw)) this.last = { videoId: (raw as any).videoId, timeSec: (raw as any).timeSec };
      queue.handlePip(raw);
    });
    ipcMain.on('pip:ready', (event) => {
      if (this.fromPip(event)) this.send({ onTop: this.win!.isAlwaysOnTop(), ...(this.openAudio && { audio: this.openAudio }) });
    });
    ipcMain.on('pip:control', (event, msg) => {
      if (this.fromPip(event)) this.control(msg);
    });
  }

  isOpen(): boolean {
    return this.win !== null;
  }

  // The PiP page's contents while open (the player the tray and hotkeys act on).
  contents(): Electron.WebContents | null {
    return this.win && !this.win.isDestroyed() ? this.win.webContents : null;
  }

  // For IPC that both windows may use (SponsorBlock lookups).
  ownsSender(wc: Electron.WebContents): boolean {
    return !!this.win && !this.win.isDestroyed() && wc === this.win.webContents;
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
      {
        if (!finite(msg.ratio) || msg.ratio < 0.25 || msg.ratio > 4) return;
        this.ratio = msg.ratio;
        win.setAspectRatio(this.ratio);
        // Compare with the window's actual shape, not the last ratio: it may have been
        // restored from another video's shape.
        const b = win.getBounds();
        if (Math.abs(b.width / b.height - this.ratio) >= 0.01) win.setBounds(fitAspect(b, this.ratio, this.area()));
        return;
      }
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
        ...openingBounds(saved, screen.getAllDisplays().map((d) => d.workArea)),
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
      this.openAudio = audioOf(at);
      // A window muted as a whole (not just its player) stays muted in PiP too.
      win.webContents.setAudioMuted(this.main.webContents.isAudioMuted());
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
      // A second close while the first is still reading the time is held too, and the
      // handback always runs, even if the page hangs or the window is already gone.
      let closing = false;
      win.on('close', async (event) => {
        event.preventDefault();
        if (closing) return;
        closing = true;
        this.save(); // before the wait: the window may be gone after it
        let resumeAt: Playing | null = this.last;
        let now: unknown = null;
        try {
          now = await withTimeout(win.webContents.executeJavaScript(NOW_PLAYING), 500, null);
          if (isPlaying(now)) resumeAt = now;
        } finally {
          if (!win.isDestroyed()) win.destroy();
          if (this.handoff && resumeAt) {
            // Playback moves back to the main window; if it's hidden in the tray, show it rather
            // than play on unseen.
            if (!this.main.isDestroyed() && !this.main.isVisible()) this.main.show();
            this.queue.resumeInMain(resumeAt);
            // PiP's mute and volume go back with the video.
            const audio = audioOf(now);
            if (audio) this.main.webContents.executeJavaScript(applyAudioScript(audio)).catch(() => {});
          }
          else this.queue.setPlayer(null);
          console.log(`[pip] closed${this.handoff && resumeAt ? `; main resumes ${resumeAt.videoId} at ${resumeAt.timeSec.toFixed(1)}s` : ''}`);
        }
      });
      win.on('closed', () => {
        this.win = null;
        this.drag = null;
      });

      this.devHook(win);
      await attachPageBundle(win.webContents, () => [pipEntry(), ...this.pluginEntries()]);
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

  // Dev-only, like TTD_DEV_EVAL for the main window: TTD_DEV_EVAL_PIP=<file> runs that
  // script in PiP after each load (muted); '[ttd-dev] capture <name>' saves a screenshot.
  private devHook(win: BrowserWindow): void {
    const file = process.env.TTD_DEV_EVAL_PIP;
    if (!file) return;
    const fs = require('fs');
    win.webContents.setAudioMuted(true);
    win.webContents.on('console-message', async (event: any, _level?: number, legacy?: string) => {
      const m = String(event.message ?? legacy ?? '').match(/^\[ttd-dev\] capture ([\w-]+)$/);
      if (!m || win.isDestroyed()) return;
      const shot = await win.webContents.capturePage().catch((err: Error) => console.warn('[dev-capture] failed:', err.message));
      if (shot) fs.writeFileSync(path.join(path.dirname(file), `${m[1]}.png`), shot.toPNG());
      console.log('[dev-capture]', m[1]);
    });
    win.webContents.on('did-finish-load', async () => {
      if (!WATCH.test(win.webContents.getURL())) return;
      const result = await win.webContents.executeJavaScript(fs.readFileSync(file, 'utf8')).catch((err: Error) => `error: ${err.message}`);
      console.log('[dev-eval-pip]', JSON.stringify(result));
    });
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
