import { randomUUID } from 'crypto';

export type QueueItem = { uid: string; videoId: string; title: string; channel: string; thumbnail: string; durationSec?: number };
export type NewItem = Omit<QueueItem, 'uid'>;

export type ReturnPoint =
  | { kind: 'video'; videoId: string; timeSec: number }
  | { kind: 'queue'; items: QueueItem[]; current: number | null; sourceListId: string | null; resumeTimeSec: number };

export type QueueState = {
  items: QueueItem[];
  current: number | null;
  returnStack: ReturnPoint[];
  // The video being watched as a side trip, if any; its end returns to the last saved point.
  detourVideoId: string | null;
  // The playlist/Mix the queue came from, so reloading that playlist doesn't replace it again.
  sourceListId: string | null;
};

export type Command = { navigate: { videoId: string; timeSec: number } } | null;

// What the page last reported as playing.
export type Playing = { videoId: string; timeSec: number; title?: string; channel?: string };

export const MAX_RETURN_POINTS = 10;

const emptyState = (): QueueState => ({ items: [], current: null, returnStack: [], detourVideoId: null, sourceListId: null });
const navigate = (videoId: string, timeSec = 0): Command => ({ navigate: { videoId, timeSec } });

// The app-owned queue as a pure state machine. Items are tracked by uid, never by
// videoId, so the same video can be queued twice.
export class QueueModel {
  private s: QueueState;

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

  add(item: NewItem, playing?: Playing): void {
    if (this.s.items.length === 0 && playing) {
      this.s.items.push(
        this.withUid({
          videoId: playing.videoId,
          title: playing.title ?? playing.videoId,
          channel: playing.channel ?? '',
          thumbnail: `https://i.ytimg.com/vi/${playing.videoId}/mqdefault.jpg`,
        }),
      );
      this.s.current = 0;
    }
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
    this.s.items.splice(idx, 1);
    if (this.s.current === null) return;
    if (idx < this.s.current) this.s.current--;
    else if (idx === this.s.current && this.s.current >= this.s.items.length) this.s.current = null;
  }

  jump(uid: string): Command {
    const idx = this.indexOf(uid);
    if (idx < 0) return null;
    this.s.current = idx;
    this.s.detourVideoId = null;
    return navigate(this.s.items[idx].videoId);
  }

  navigated(videoId: string, from: Playing | null): void {
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
      this.s.detourVideoId = null;
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
    if (videoId !== this.currentVideoId() || this.s.current === null) return null;
    if (this.s.current < this.s.items.length - 1) {
      this.s.current++;
      return navigate(this.s.items[this.s.current].videoId);
    }
    if (!autoplayCandidate) return null;
    // The queue ran out: YouTube's pick joins the queue visibly, then plays.
    this.s.items.push(this.withUid(autoplayCandidate));
    this.s.current = this.s.items.length - 1;
    return navigate(autoplayCandidate.videoId);
  }

  replaceWithPlaylist(listId: string, items: NewItem[], startVideoId: string, resumeTimeSec: number): void {
    if (listId === this.s.sourceListId) return;
    if (this.s.items.length > 0) {
      this.pushReturn({
        kind: 'queue',
        items: this.s.items,
        current: this.s.current,
        sourceListId: this.s.sourceListId,
        resumeTimeSec,
      });
    }
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
      this.s.detourVideoId = null;
      const id = this.currentVideoId();
      return id ? navigate(id, point.resumeTimeSec) : null;
    }
    // Returning to a detour's origin: still a detour unless it is the queue's own video.
    const stillDetour = point.videoId !== this.currentVideoId() && this.s.returnStack.length > 0;
    this.s.detourVideoId = stillDetour ? point.videoId : null;
    return navigate(point.videoId, point.timeSec);
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
