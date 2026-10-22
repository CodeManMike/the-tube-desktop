import { ipcMain, IpcMainEvent, WebContents } from 'electron';
import { HistoryStore } from '../history/historyStore';
import { Command, NewItem, Playing, QueueModel } from './model';
import { QueueStore } from './queueStore';
import { PageEvent, sanitiseItem, validateEvent } from './validate';

export type QueuePayload = { state: ReturnType<QueueModel['state']>; nextVideoId: string | null; command: Command; seq: number };

// Connects the queue model to the page: validates what the page reports, persists every
// change before announcing it, and sends state (plus any navigation) back.
export class QueueService {
  private wc: WebContents | null = null;
  private seq = 0;
  private playing: Playing | null = null;
  private lastFrom: Playing | null = null;
  private autoplay: NewItem | null = null;

  constructor(
    private readonly model: QueueModel,
    private readonly store: QueueStore,
    private readonly history: HistoryStore,
    private readonly fetchJson: (url: string) => Promise<any>,
  ) {}

  attach(wc: WebContents): void {
    this.wc = wc;
    ipcMain.on('queue:event', (event, raw) => {
      if (!this.fromYouTube(event)) return;
      const ev = validateEvent(raw);
      if (!ev) {
        console.warn('[queue] ignored an invalid event from the page');
        return;
      }
      this.handle(ev);
    });
    ipcMain.on('queue:ready', (event) => {
      if (this.fromYouTube(event)) this.publish(null);
    });
  }

  private fromYouTube(event: IpcMainEvent): boolean {
    const ok = event.sender === this.wc && /^https:\/\/www\.youtube\.com\//.test(event.senderFrame?.url ?? '');
    if (!ok) console.warn(`[queue] ignored a message from an unexpected sender: ${event.senderFrame?.url ?? 'unknown'}`);
    return ok;
  }

  // What the main window is showing right now. The 5 s progress sample can be stale (a
  // different video, or one you already left), so the URL decides.
  private watching(): Playing | undefined {
    try {
      const u = new URL(this.wc?.getURL() ?? '');
      const id = u.searchParams.get('v');
      if (u.hostname !== 'www.youtube.com' || u.pathname !== '/watch' || !id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return undefined;
      return this.playing?.videoId === id ? this.playing : { videoId: id, timeSec: 0 };
    } catch {
      return undefined;
    }
  }

  // Title, channel and thumbnail for a bare video id, from YouTube's public oEmbed.
  private async lookup(videoId: string): Promise<NewItem> {
    let meta: unknown = null;
    try {
      const watch = `https://www.youtube.com/watch?v=${videoId}`;
      const o = await this.fetchJson(`https://www.youtube.com/oembed?url=${encodeURIComponent(watch)}&format=json`);
      meta = { videoId, title: o?.title, channel: o?.author_name, thumbnail: o?.thumbnail_url };
    } catch (err) {
      console.warn(`[queue] oEmbed lookup failed for ${videoId}: ${(err as Error).message}`);
    }
    return sanitiseItem(meta) ?? sanitiseItem({ videoId })!;
  }

  // "Add to queue" arrives as a bare video id.
  async addById(videoId: string): Promise<void> {
    this.model.add(await this.lookup(videoId), this.watching());
    this.commit(null);
  }

  // YouTube's autoplay pick sometimes arrives without a title; fill it in before it can
  // be appended to the queue.
  private async fillAutoplayTitle(videoId: string): Promise<void> {
    const item = await this.lookup(videoId);
    if (this.autoplay?.videoId === videoId) this.autoplay = item;
  }

  handle(ev: PageEvent): void {
    let command: Command = null;
    switch (ev.type) {
      case 'navigated':
        this.lastFrom = ev.from;
        this.autoplay = null;
        this.model.navigated(ev.videoId, ev.from);
        break;
      case 'ended':
        command = this.model.ended(ev.videoId, this.autoplay);
        break;
      case 'progress':
        this.playing = { videoId: ev.videoId, timeSec: ev.timeSec, title: ev.title, channel: ev.channel };
        this.history.record({ videoId: ev.videoId, title: ev.title, channel: ev.channel, durationSec: ev.durationSec, timeSec: ev.timeSec });
        return; // no queue change
      case 'watchData':
        if (ev.autoplay) {
          this.autoplay = ev.autoplay;
          if (ev.autoplay.title === ev.autoplay.videoId) this.fillAutoplayTitle(ev.autoplay.videoId);
        }
        if (ev.playlist && ev.listParam === ev.playlist.playlistId) {
          this.model.replaceWithPlaylist(ev.listParam, ev.playlist.items, ev.videoId, this.lastFrom?.timeSec ?? 0);
        }
        break;
      case 'action': {
        const { action, uid } = ev;
        if (action === 'back') command = this.model.back();
        else if (uid && action === 'jump') command = this.model.jump(uid);
        else if (uid && action === 'remove') this.model.remove(uid);
        else if (uid && action === 'playNext') {
          const s = this.model.state();
          const from = s.items.findIndex((i) => i.uid === uid);
          const current = s.current ?? -1;
          this.model.move(uid, from > current ? current + 1 : current);
        }
        break;
      }
      case 'move':
        this.model.move(ev.uid, ev.toIndex);
        break;
    }
    this.commit(command);
  }

  // Losing the queue counts as breakage: save first, then tell the page.
  private commit(command: Command): void {
    this.store.save(this.model.state());
    this.publish(command);
  }

  private publish(command: Command): void {
    if (!this.wc || this.wc.isDestroyed()) return;
    const payload: QueuePayload = { state: this.model.state(), nextVideoId: this.model.nextVideoId(), command, seq: ++this.seq };
    this.wc.send('queue:state', payload);
  }

  flush(): void {
    this.store.save(this.model.state());
    this.history.flush();
  }
}
