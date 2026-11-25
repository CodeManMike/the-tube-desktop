import { randomUUID } from 'crypto';

export type QueueItem = { uid: string; videoId: string; title: string; channel: string; thumbnail: string; durationSec?: number; played?: true; watchedSec?: number; source?: 'shuffle' | 'autoplay' };
export type NewItem = Omit<QueueItem, 'uid' | 'played' | 'watchedSec' | 'source'>;

// Where shuffle refills come from: one or more creators' uploads, or a topic search.
export type ShuffleSource =
  | { kind: 'creators'; creators: { channelId: string; name: string }[] }
  | { kind: 'topic'; query: string };

export type ReturnPoint =
  | { kind: 'video'; videoId: string; timeSec: number }
  | {
      kind: 'queue';
      items: QueueItem[];
      current: number | null;
      sourceListId: string | null;
      shuffle: ShuffleSource | null;
      resumeTimeSec: number;
      resumeVideoId?: string;
    };

export type QueueState = {
  items: QueueItem[];
  current: number | null;
  returnStack: ReturnPoint[];
  // The video being watched as a side trip, if any; its end returns to the last saved point.
  detourVideoId: string | null;
  // The playlist/Mix the queue came from, so reloading that playlist doesn't replace it again.
  sourceListId: string | null;
  shuffle: ShuffleSource | null;
  // The shuffle source has nothing unwatched left; refills stop until the source changes.
  shuffleExhausted: boolean;
};

export type Command = { navigate: { videoId: string; timeSec: number } } | null;

// What the page last reported as playing.
export type Playing = { videoId: string; timeSec: number; title?: string; channel?: string };

export const MAX_RETURN_POINTS = 10;
export const MAX_DETOUR_DEPTH = 2;
export const QUEUE_WATCHED_SECONDS = 300;

const emptyState = (): QueueState => ({
  items: [],
  current: null,
  returnStack: [],
  detourVideoId: null,
  sourceListId: null,
  shuffle: null,
  shuffleExhausted: false,
});
const navigate = (videoId: string, timeSec = 0): Command => ({ navigate: { videoId, timeSec } });

// The app-owned queue as a pure state machine. Items are tracked by uid, never by
// videoId, so the same video can be queued twice.
export class QueueModel {
  private s: QueueState;
  // The playing video was removed from the queue: its end should play the new current item.
  private removedPlaying: string | null = null;

  constructor(state?: QueueState, private readonly newUid: () => string = randomUUID) {
    this.s = state ? structuredClone(state) : emptyState();
  }

  state(): QueueState {
    return structuredClone(this.s);
  }

  private withUid(item: NewItem): QueueItem {
    return { ...item, uid: this.newUid() };
  }

  private currentVideoId(): string | null {
    return this.s.current === null ? null : this.s.items[this.s.current].videoId;
  }

  private indexOf(uid: string): number {
    return this.s.items.findIndex((i) => i.uid === uid);
  }

  private pushReturn(point: ReturnPoint): void {
    this.s.returnStack.push(point);
  }

  // Starting a queue while watching something: that video becomes item 0, the current one.
  adoptPlaying(playing: Playing): void {
    if (this.s.items.length > 0) return;
    this.s.items.push(
      this.withUid({
        videoId: playing.videoId,
        title: playing.title ?? playing.videoId,
        channel: playing.channel ?? '',
        thumbnail: `https://i.ytimg.com/vi/${playing.videoId}/mqdefault.jpg`,
      }),
    );
    this.s.current = 0;
    // The video being watched is now the queue's own, so it is no longer a side trip.
    if (this.s.detourVideoId === playing.videoId) this.s.detourVideoId = null;
  }

  add(item: NewItem, playing?: Playing): string {
    const isPlayingItem = this.s.items.length === 0 && playing?.videoId === item.videoId;
    if (playing && !isPlayingItem) this.adoptPlaying(playing);
    const entry = this.withUid(item);
    this.s.items.push(entry);
    if (isPlayingItem) {
      this.s.current = 0;
      this.leaveDetour();
    }
    return entry.uid;
  }

  updateItem(uid: string, item: NewItem): boolean {
    const existing = this.s.items[this.indexOf(uid)];
    if (!existing || existing.videoId !== item.videoId) return false;
    Object.assign(existing, item);
    return true;
  }

  playNext(item: NewItem, playing?: Playing): void {
    if (this.s.items.length === 0) {
      this.add(item, playing);
      return;
    }
    const at = this.s.current === null ? 0 : this.s.current + 1;
    this.s.items.splice(at, 0, this.withUid(item));
    if (this.s.current !== null && at <= this.s.current) this.s.current++;
  }

  move(uid: string, toIndex: number): void {
    const from = this.indexOf(uid);
    if (from < 0) return;
    const currentUid = this.s.current === null ? null : this.s.items[this.s.current].uid;
    const [item] = this.s.items.splice(from, 1);
    this.s.items.splice(Math.max(0, Math.min(toIndex, this.s.items.length)), 0, item);
    this.s.current = currentUid === null ? null : this.indexOf(currentUid);
  }

  remove(uid: string): void {
    const idx = this.indexOf(uid);
    if (idx < 0) return;
    if (idx === this.s.current) this.removedPlaying = this.s.items[idx].videoId;
    this.s.items.splice(idx, 1);
    if (this.s.current === null) return;
    if (idx < this.s.current) this.s.current--;
    else if (idx === this.s.current && this.s.current >= this.s.items.length) this.s.current = null;
  }

  // Empties the queue and everything tied to it (shuffle, playlist, return points). The video
  // on screen keeps playing; it just isn't part of a queue any more.
  clear(): void {
    this.s = emptyState();
    this.removedPlaying = null;
  }

  private pendingIndex(): number {
    return this.s.items.findIndex((item, index) => index !== this.s.current && !item.played);
  }

  currentEntry(videoId: string): string | undefined {
    const current = this.s.current === null ? undefined : this.s.items[this.s.current];
    return current?.videoId === videoId ? current.uid : undefined;
  }

  creditPlayback(uid: string, seconds: number): void {
    const item = this.s.items[this.indexOf(uid)];
    if (item) item.watchedSec = Math.min(QUEUE_WATCHED_SECONDS, (item.watchedSec ?? 0) + seconds);
  }

  private select(index: number, rotateUnwatched = false): void {
    const selected = this.s.items[index];
    if (this.s.current !== null && this.s.current !== index) {
      const previous = this.s.items[this.s.current];
      if ((previous.watchedSec ?? 0) >= QUEUE_WATCHED_SECONDS) this.s.items.splice(this.s.current, 1);
      else if (rotateUnwatched) {
        this.s.items.splice(this.s.current, 1);
        this.s.items.push(previous);
      }
    }
    this.s.current = this.indexOf(selected.uid);
    delete selected.played;
  }

  moveToPlayNext(uid: string): void {
    const from = this.indexOf(uid);
    if (from < 0 || from === this.s.current) return;
    const to = this.s.items.findIndex((item, index) => index !== this.s.current && index !== from && !item.played);
    delete this.s.items[from].played;
    if (to >= 0) this.move(uid, from < to ? to - 1 : to);
  }

  shufflePending(): void {
    const indices = this.s.items.flatMap((item, index) => index !== this.s.current && !item.played ? [index] : []);
    for (let i = indices.length - 1; i > 0; i--) {
      const a = indices[i];
      const b = indices[Math.floor(Math.random() * (i + 1))];
      [this.s.items[a], this.s.items[b]] = [this.s.items[b], this.s.items[a]];
    }
  }

  jump(uid: string): Command {
    const idx = this.indexOf(uid);
    if (idx < 0) return null;
    this.select(idx);
    this.leaveDetour();
    return navigate(this.s.items[idx].videoId);
  }

  // Back in the queue by choice: an abandoned detour's return points no longer apply.
  private leaveDetour(): void {
    this.s.detourVideoId = null;
    this.s.returnStack = this.s.returnStack.filter((p) => p.kind === 'queue');
  }

  navigated(videoId: string, from: Playing | null): void {
    this.removedPlaying = null;
    const currentId = this.currentVideoId();
    if (videoId === currentId) {
      if (this.s.detourVideoId) this.leaveDetour();
      return;
    }
    if (videoId === this.s.detourVideoId) return;
    if (this.s.detourVideoId) {
      const stop = this.s.returnStack.findIndex((point) => point.kind === 'video' && point.videoId === videoId);
      if (stop >= 0) {
        this.s.returnStack.length = stop;
        this.s.detourVideoId = videoId;
        return;
      }
    }

    // Picking another queued video is a jump within the queue, not a detour.
    const start = this.s.current ?? -1;
    const after = this.s.items.findIndex((i, n) => n > start && i.videoId === videoId);
    const idx = after >= 0 ? after : this.s.items.findIndex((i) => i.videoId === videoId);
    if (idx >= 0) {
      this.select(idx);
      this.leaveDetour();
      return;
    }

    // Leaving the queue's video (or a detour) for something else starts a (nested) detour.
    if (from && (from.videoId === currentId || from.videoId === this.s.detourVideoId)) {
      const depth = this.s.returnStack.filter((point) => point.kind === 'video').length;
      if (depth >= MAX_DETOUR_DEPTH) return;
      this.pushReturn({ kind: 'video', videoId: from.videoId, timeSec: from.timeSec });
      this.s.detourVideoId = videoId;
    }
  }

  ended(videoId: string): Command {
    if (videoId === this.s.detourVideoId) return this.back();
    if (videoId === this.removedPlaying) {
      this.removedPlaying = null;
      const id = this.currentVideoId();
      return id ? navigate(id) : this.startPending();
    }
    if (this.s.current === null) return this.startPending();
    if (videoId !== this.currentVideoId()) return null;
    this.s.items.splice(this.s.current, 1);
    this.s.current = null;
    return this.startPending();
  }

  replaceWithPlaylist(listId: string, items: NewItem[], startVideoId: string, from: Playing | null): void {
    if (listId === this.s.sourceListId) return;
    const id = this.currentVideoId();
    const origin = this.s.returnStack.find((point) => point.kind === 'video' && point.videoId === id);
    // A Mix opened during a rabbit hole returns to the original queue's video.
    // The resume time is only usable when its source video matches that video.
    const resumeTimeSec = origin?.kind === 'video' ? origin.timeSec : id && from?.videoId === id ? from.timeSec : 0;
    const savedQueues = this.s.returnStack.filter((point) => point.kind === 'queue');
    if (savedQueues.length >= MAX_RETURN_POINTS) return;
    this.s.returnStack = savedQueues;
    if (this.s.items.length > 0) {
      this.pushReturn({
        kind: 'queue',
        items: this.s.items,
        current: this.s.current,
        sourceListId: this.s.sourceListId,
        shuffle: this.s.shuffle,
        resumeTimeSec,
        ...(id && { resumeVideoId: id }),
      });
    }
    // A playlist replaces the queue, and with it any shuffle source.
    this.s.shuffle = null;
    this.s.shuffleExhausted = false;
    const start = items.findIndex((i) => i.videoId === startVideoId);
    this.s.items = items.map((item, index) => ({ ...this.withUid(item), ...(index < start && { played: true as const }) }));
    this.s.current = this.s.items.length === 0 ? null : Math.max(0, start);
    this.s.sourceListId = listId;
    this.s.detourVideoId = null;
  }

  back(): Command {
    const point = this.s.returnStack.pop();
    if (!point) return null;
    if (point.kind === 'queue') {
      this.s.items = point.items;
      this.s.current = point.current;
      this.s.sourceListId = point.sourceListId;
      this.s.shuffle = point.shuffle ?? null;
      this.s.shuffleExhausted = false;
      this.s.detourVideoId = null;
      const id = this.currentVideoId();
      return id ? navigate(id, point.resumeVideoId === id ? point.resumeTimeSec : 0) : null;
    }
    // Returning to a detour's origin: still a detour unless it is the queue's own video.
    const stillDetour = point.videoId !== this.currentVideoId() && this.s.returnStack.length > 0;
    this.s.detourVideoId = stillDetour ? point.videoId : null;
    return navigate(point.videoId, point.timeSec);
  }

  // What extendPlaylist checks against, taken when the full-playlist fetch starts.
  playlistSnapshot(): string {
    return JSON.stringify([this.s.sourceListId, this.s.current, this.s.items.map((i) => i.uid)]);
  }

  startPending(): Command {
    const first = this.pendingIndex();
    return first < 0 ? null : this.jump(this.s.items[first].uid);
  }

  // A manual skip keeps an unfinished entry, behind the remaining pending items.
  next(videoId: string): Command {
    if (videoId === this.s.detourVideoId) return this.back();
    if (videoId === this.removedPlaying) return this.ended(videoId);
    const next = this.pendingIndex();
    if (next < 0) return null;
    this.select(next, videoId === this.currentVideoId());
    this.leaveDetour();
    return navigate(this.currentVideoId()!);
  }

  // Previous: back from a detour to where it started, otherwise the previous queue item;
  // on the first item, restart it.
  previous(videoId: string): Command {
    if (videoId === this.s.detourVideoId) return this.back();
    if (this.s.current === null) return null;
    // Outside the queue: back to where the queue is.
    if (videoId !== this.currentVideoId()) return navigate(this.s.items[this.s.current].videoId);
    if (this.s.current === 0) return navigate(videoId, 0);
    return this.jump(this.s.items[this.s.current - 1].uid);
  }

  // The full playlist arrived (YouTube only sends a window of ~25 items at first). Applies
  // only while the queue is exactly as it was when the fetch started (no edits, same
  // playhead), keeping the current video, including which copy of a repeated one.
  extendPlaylist(listId: string, items: NewItem[], snapshot?: string): boolean {
    if (this.s.sourceListId !== listId) return false;
    if (snapshot !== undefined && snapshot !== this.playlistSnapshot()) return false;
    const currentId = this.currentVideoId();
    let at = -1;
    if (currentId !== null) {
      const copy = this.s.items.slice(0, this.s.current!).filter((i) => i.videoId === currentId).length;
      for (let i = 0, seen = 0; i < items.length && at < 0; i++) {
        if (items[i].videoId === currentId && seen++ === copy) at = i;
      }
      if (at < 0) at = items.findIndex((i) => i.videoId === currentId);
      if (at < 0) return false;
    }
    const current = this.s.current === null ? null : this.s.items[this.s.current];
    this.s.items = items.map((item, index) => index === at && current
      ? { ...current, ...item }
      : { ...this.withUid(item), ...(index < at && { played: true as const }) });
    this.s.current = currentId === null ? null : at;
    return true;
  }

  setShuffle(source: ShuffleSource | null): void {
    this.s.shuffle = source;
    this.s.shuffleExhausted = false;
  }

  markShuffleExhausted(): void {
    this.s.shuffleExhausted = true;
  }

  remainingAfterCurrent(): number {
    return this.s.items.filter((item, index) => index !== this.s.current && !item.played).length;
  }

  appendItems(items: NewItem[]): void {
    for (const item of items) this.s.items.push({ ...this.withUid(item), source: 'shuffle' });
  }

  nextVideoId(): string | null {
    const top = this.s.returnStack[this.s.returnStack.length - 1];
    if (this.s.detourVideoId && top) {
      if (top.kind === 'video') return top.videoId;
      const item = top.current === null ? undefined : top.items[top.current];
      return item?.videoId ?? null;
    }
    if (this.removedPlaying && this.s.current !== null) return this.s.items[this.s.current].videoId;
    const next = this.pendingIndex();
    return this.s.items[next]?.videoId ?? null;
  }
}
