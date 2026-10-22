import { ipcMain, IpcMainEvent, WebContents } from 'electron';
import { HistoryStore } from '../history/historyStore';
import { FetchBridge } from './fetchBridge';
import { Command, NewItem, Playing, QueueModel, ShuffleSource } from './model';
import { QueueStore } from './queueStore';
import { isWatched } from './shuffle';
import { ShuffleRunner } from './shuffleRunner';
import { PageEvent, sanitiseItem, validateEvent } from './validate';

export type QueueSettings = { batchSize: number; watchedPercent: number };

const FULL_PLAYLIST_MAX = 500;
const FULL_PLAYLIST_MAX_PAGES = 10;

export type QueuePayload = { state: ReturnType<QueueModel['state']>; nextVideoId: string | null; command: Command; seq: number };

// Connects the queue model to the page: validates what the page reports, persists every
// change before announcing it, and sends state (plus any navigation) back.
export class QueueService {
  private wc: WebContents | null = null;
  private seq = 0;
  private playing: Playing | null = null;
  private lastFrom: Playing | null = null;
  private autoplay: NewItem | null = null;
  private readonly bridge: FetchBridge;
  private readonly runner: ShuffleRunner;

  constructor(
    private readonly model: QueueModel,
    private readonly store: QueueStore,
    private readonly history: HistoryStore,
    private readonly fetchJson: (url: string) => Promise<any>,
    // Re-read on every refill so changes in Settings apply without a restart.
    private readonly settings: () => QueueSettings = () => ({ batchSize: 10, watchedPercent: 80 }),
  ) {
    this.bridge = new FetchBridge((req) => {
      if (this.wc && !this.wc.isDestroyed()) this.wc.send('queue:fetch', req);
    });
    this.runner = new ShuffleRunner(
      (endpoint, body) => this.bridge.request(endpoint, body),
      (c) => isWatched(c, this.history, this.settings().watchedPercent),
    );
  }

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
      if (!this.fromYouTube(event)) return;
      this.publish(null);
      this.refill(); // after a restart, top up only if needed
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

  // Top the queue up from the shuffle source when it runs low (a no-op otherwise).
  private refill(force = false): void {
    const before = JSON.stringify(this.model.state());
    this.runner
      .refill(this.model, this.settings().batchSize, { force })
      .then(() => {
        if (JSON.stringify(this.model.state()) !== before) this.commit(null);
      })
      .catch((err) => console.warn(`[shuffle] refill failed: ${(err as Error).message}`));
  }

  private applyShuffle(ev: Extract<PageEvent, { type: 'shuffle' }>): void {
    const current = this.model.state().shuffle;
    let next: ShuffleSource | null = null;
    if (ev.action === 'topic') next = { kind: 'topic', query: ev.query! };
    else if (ev.action === 'creator') next = { kind: 'creators', creators: [{ channelId: ev.channelId!, name: ev.name ?? '' }] };
    else if (ev.action === 'addCreator') {
      const existing = current?.kind === 'creators' ? current.creators : [];
      const creators = existing.some((c) => c.channelId === ev.channelId)
        ? existing
        : [...existing, { channelId: ev.channelId!, name: ev.name ?? '' }].slice(0, 20);
      next = { kind: 'creators', creators };
    }
    this.model.setShuffle(next);
    // Shuffling from an empty queue while watching: that video becomes the current item.
    const playing = this.watching();
    if (next && playing) this.model.adoptPlaying(playing);
  }

  // YouTube sends only a ~25-item window of a playlist; fetch the rest (up to 500).
  private async fetchFullPlaylist(listId: string): Promise<void> {
    const items: NewItem[] = [];
    let body: object = { browseId: 'VL' + listId };
    try {
      for (let pages = 0; pages < FULL_PLAYLIST_MAX_PAGES && items.length < FULL_PLAYLIST_MAX; pages++) {
        const page = await this.bridge.request('browse', body);
        for (const { watchedPercent: _w, ...item } of page.items) if (!items.some((i) => i.videoId === item.videoId)) items.push(item);
        if (!page.continuation) break;
        body = { continuation: page.continuation };
      }
    } catch (err) {
      console.warn(`[queue] full playlist fetch failed: ${(err as Error).message}`);
    }
    // A late result for a queue you've since replaced is dropped by the model.
    if (items.length > 0 && this.model.extendPlaylist(listId, items.slice(0, FULL_PLAYLIST_MAX))) this.commit(null);
  }

  handle(ev: PageEvent): void {
    let command: Command = null;
    switch (ev.type) {
      case 'fetched':
        this.bridge.resolve(ev);
        return;
      case 'shuffle':
        this.applyShuffle(ev);
        this.commit(null);
        this.refill(true); // an explicit pick adds a batch right away
        return;
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
          const before = this.model.state().sourceListId;
          this.model.replaceWithPlaylist(ev.listParam, ev.playlist.items, ev.videoId, this.lastFrom?.timeSec ?? 0);
          const meta = ev.playlistMeta;
          const replaced = before !== ev.listParam && this.model.state().sourceListId === ev.listParam;
          if (replaced && meta && !meta.isInfinite && (meta.totalVideos ?? 0) > ev.playlist.items.length) this.fetchFullPlaylist(ev.listParam);
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
    if (ev.type === 'ended' || ev.type === 'action') this.refill();
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
