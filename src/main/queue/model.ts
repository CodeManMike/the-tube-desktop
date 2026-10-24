import { randomUUID } from 'crypto';

export type QueueItem = { uid: string; videoId: string; title: string; channel: string; thumbnail: string; durationSec?: number };
export type NewItem = Omit<QueueItem, 'uid'>;

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
    while (this.s.returnStack.length > MAX_RETURN_POINTS) this.s.returnStack.shift();
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

  add(item: NewItem, playing?: Playing): void {
    if (playing) this.adoptPlaying(playing);
    this.s.items.push(this.withUid(item));
  }

  playNext(item: NewItem, playing?: Playing): void {
    if (this.s.items.length === 0) return this.add(item, playing);
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

  jump(uid: string): Command {
    const idx = this.indexOf(uid);
    if (idx < 0) return null;
    this.s.current = idx;
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
      this.s.detourVideoId = null;
      return;
    }
    if (videoId === this.s.detourVideoId) return;

    // Picking another queued video is a jump within the queue, not a detour.
    const start = this.s.current ?? -1;
    const after = this.s.items.findIndex((i, n) => n > start && i.videoId === videoId);
    const idx = after >= 0 ? after : this.s.items.findIndex((i) => i.videoId === videoId);
    if (idx >= 0) {
      this.s.current = idx;
      this.leaveDetour();
      return;
    }

    // Leaving the queue's video (or a detour) for something else starts a (nested) detour.
    if (from && (from.videoId === currentId || from.videoId === this.s.detourVideoId)) {
      this.pushReturn({ kind: 'video', videoId: from.videoId, timeSec: from.timeSec });
      this.s.detourVideoId = videoId;
    }
  }

  ended(videoId: string, autoplayCandidate: NewItem | null): Command {
    if (videoId === this.s.detourVideoId) return this.back();
    if (videoId === this.removedPlaying) {
      this.removedPlaying = null;
      const id = this.currentVideoId();
      return id ? navigate(id) : null;
    }
    if (videoId !== this.currentVideoId() || this.s.current === null) return null;
    if (this.s.current < this.s.items.length - 1) {
      this.s.current++;
      return navigate(this.s.items[this.s.current].videoId);
    }
    // A candidate equal to the video that just ended would replay it forever.
    if (!autoplayCandidate || autoplayCandidate.videoId === videoId) return null;
    // The queue ran out: YouTube's pick joins the queue visibly, then plays.
    this.s.items.push(this.withUid(autoplayCandidate));
    this.s.current = this.s.items.length - 1;
    return navigate(autoplayCandidate.videoId);
  }

  replaceWithPlaylist(listId: string, items: NewItem[], startVideoId: string, resumeTimeSec: number): void {
    if (listId === this.s.sourceListId) return;
    // Opening the playlist looked like a detour from the queue until its data arrived:
    // that return point becomes the saved queue's playhead instead of a second entry.
    const top = this.s.returnStack[this.s.returnStack.length - 1];
    if (this.s.detourVideoId === startVideoId && top?.kind === 'video') {
      this.s.returnStack.pop();
      resumeTimeSec = top.timeSec;
    }
    if (this.s.items.length > 0) {
      this.pushReturn({
        kind: 'queue',
        items: this.s.items,
        current: this.s.current,
        sourceListId: this.s.sourceListId,
        shuffle: this.s.shuffle,
        resumeTimeSec,
      });
    }
    // A playlist replaces the queue, and with it any shuffle source.
    this.s.shuffle = null;
    this.s.shuffleExhausted = false;
    this.s.items = items.map((i) => this.withUid(i));
    const start = this.s.items.findIndex((i) => i.videoId === startVideoId);
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
      return id ? navigate(id, point.resumeTimeSec) : null;
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

  // Next (PiP or panel): exactly what the video ending would do, so detours return.
  next(videoId: string): Command {
    // Watching something outside the queue (browsing, not a detour): go to the queue item
    // after the current one, as YouTube's own Next button does in TTD.
    if (videoId !== this.s.detourVideoId && videoId !== this.currentVideoId() && this.s.current !== null) {
      if (this.s.current + 1 >= this.s.items.length) return null;
      this.s.current++;
      this.leaveDetour();
      return navigate(this.s.items[this.s.current].videoId);
    }
    return this.ended(videoId, null);
  }

  // Previous: back from a detour to where it started, otherwise the previous queue item;
  // on the first item, restart it.
  previous(videoId: string): Command {
    if (videoId === this.s.detourVideoId) return this.back();
    if (this.s.current === null) return null;
    // Outside the queue: back to where the queue is.
    if (videoId !== this.currentVideoId()) return navigate(this.s.items[this.s.current].videoId);
    if (this.s.current === 0) return navigate(videoId, 0);
    this.s.current--;
    this.leaveDetour();
    return navigate(this.s.items[this.s.current].videoId);
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
    this.s.items = items.map((i) => this.withUid(i));
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
    return this.s.current === null ? this.s.items.length : this.s.items.length - this.s.current - 1;
  }

  appendItems(items: NewItem[]): void {
    for (const item of items) this.s.items.push(this.withUid(item));
  }

  nextVideoId(): string | null {
    const top = this.s.returnStack[this.s.returnStack.length - 1];
    if (this.s.detourVideoId && top) {
      if (top.kind === 'video') return top.videoId;
      const item = top.current === null ? undefined : top.items[top.current];
      return item?.videoId ?? null;
    }
    if (this.s.current !== null && this.s.current + 1 < this.s.items.length) return this.s.items[this.s.current + 1].videoId;
    return null;
  }
}
