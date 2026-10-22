import fs from 'fs';
import { writeFileAtomic } from '../atomicFile';
import { MAX_RETURN_POINTS, QueueItem, QueueState, ReturnPoint } from './model';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const isObject = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isVideoId = (v: unknown): v is string => typeof v === 'string' && VIDEO_ID.test(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const empty = (): QueueState => ({ items: [], current: null, returnStack: [], detourVideoId: null, sourceListId: null });

function item(v: unknown): QueueItem | null {
  if (!isObject(v) || typeof v.uid !== 'string' || !v.uid || !isVideoId(v.videoId)) return null;
  return {
    uid: v.uid,
    videoId: v.videoId,
    title: typeof v.title === 'string' ? v.title : v.videoId,
    channel: typeof v.channel === 'string' ? v.channel : '',
    thumbnail:
      typeof v.thumbnail === 'string' && v.thumbnail.startsWith('https://') ? v.thumbnail : `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
    ...(finite(v.durationSec) && { durationSec: v.durationSec }),
  };
}

function items(v: unknown): QueueItem[] {
  return Array.isArray(v) ? v.map(item).filter((i): i is QueueItem => i !== null) : [];
}

const current = (v: unknown, list: QueueItem[]) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < list.length ? (v as number) : null);
const listId = (v: unknown) => (typeof v === 'string' && v.length <= 100 ? v : null);

function returnPoint(v: unknown): ReturnPoint | null {
  if (!isObject(v)) return null;
  if (v.kind === 'video' && isVideoId(v.videoId) && finite(v.timeSec)) return { kind: 'video', videoId: v.videoId, timeSec: v.timeSec };
  if (v.kind === 'queue' && finite(v.resumeTimeSec)) {
    const list = items(v.items);
    return { kind: 'queue', items: list, current: current(v.current, list), sourceListId: listId(v.sourceListId), resumeTimeSec: v.resumeTimeSec };
  }
  return null;
}

// Rebuild a valid state from whatever is on disk, dropping only the parts that are broken.
function sanitise(raw: unknown): QueueState {
  if (!isObject(raw)) throw new Error('not an object');
  const list = items(raw.items);
  const stack = Array.isArray(raw.returnStack) ? raw.returnStack.map(returnPoint).filter((p): p is ReturnPoint => p !== null) : [];
  return {
    items: list,
    current: current(raw.current, list),
    returnStack: stack.slice(-MAX_RETURN_POINTS),
    detourVideoId: isVideoId(raw.detourVideoId) ? raw.detourVideoId : null,
    sourceListId: listId(raw.sourceListId),
  };
}

export class QueueStore {
  constructor(private readonly file: string) {}

  // Losing the queue counts as breakage: a file that can't be read is kept as .bad, not overwritten.
  load(): QueueState {
    let text: string;
    try {
      text = fs.readFileSync(this.file, 'utf8');
    } catch {
      return empty();
    }
    try {
      return sanitise(JSON.parse(text));
    } catch (err) {
      console.warn(`[queue] reset: ${(err as Error).message}`);
      try {
        fs.renameSync(this.file, `${this.file}.bad`);
      } catch {
        // keep going with an empty queue
      }
      return empty();
    }
  }

  save(state: QueueState): boolean {
    return writeFileAtomic(this.file, JSON.stringify(state, null, 2));
  }
}
