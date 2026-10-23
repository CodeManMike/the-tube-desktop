import { NewItem, Playing } from './model';
import { Candidate } from './shuffle';

// Events from YouTube's page are untrusted: every field is checked, capped or defaulted
// here before it can reach the queue or the files on disk.

export type PageEvent =
  | { type: 'navigated'; videoId: string; from: Playing | null }
  | { type: 'ended'; videoId: string }
  | { type: 'progress'; videoId: string; timeSec: number; durationSec: number; title?: string; channel?: string }
  | {
      type: 'watchData';
      videoId: string;
      playlist: { playlistId: string; items: NewItem[] } | null;
      autoplay: NewItem | null;
      listParam: string | null;
      owner: { channelId: string; name: string } | null;
      playlistMeta: { totalVideos: number | null; isInfinite: boolean } | null;
    }
  | { type: 'fetched'; requestId: string; ok: boolean; items: Candidate[]; continuation: string | null }
  | { type: 'shuffle'; action: 'creator' | 'addCreator' | 'topic' | 'stop'; channelId?: string; name?: string; query?: string }
  | { type: 'action'; action: 'jump' | 'remove' | 'playNext' | 'back' | 'next' | 'previous'; uid?: string; videoId?: string }
  | { type: 'move'; uid: string; toIndex: number };

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const MAX_PLAYLIST = 500;
const ACTIONS = ['jump', 'remove', 'playNext', 'back'] as const;
// Steps relative to the playing video: they name it instead of a queue item.
const STEP_ACTIONS = ['next', 'previous'] as const;
const PIP_EVENT_TYPES = ['navigated', 'progress', 'ended', 'action'];
const SHUFFLE_ACTIONS = ['creator', 'addCreator', 'topic', 'stop'] as const;
const CHANNEL_ID = /^UC[\w-]{22}$/;
const MAX_FETCHED_ITEMS = 200;
const MAX_TOKEN = 4000;

const isObject = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isVideoId = (v: unknown): v is string => typeof v === 'string' && VIDEO_ID.test(v);
const time = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const text = (v: unknown, max: number): string | undefined => (typeof v === 'string' ? v.slice(0, max) : undefined);
const shortId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 100;

// Thumbnails are shown in the panel on every render, so only YouTube's own image hosts
// are accepted (anything else could be a persistent tracking pixel).
export function isYouTubeImage(url: unknown): url is string {
  if (typeof url !== 'string' || url.length > 500) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname.endsWith('.ytimg.com') || u.hostname.endsWith('.ggpht.com'));
  } catch {
    return false;
  }
}

export function sanitiseItem(v: unknown): NewItem | null {
  if (!isObject(v) || !isVideoId(v.videoId)) return null;
  const thumb = isYouTubeImage(v.thumbnail);
  return {
    videoId: v.videoId,
    title: text(v.title, 200) ?? v.videoId,
    channel: text(v.channel, 100) ?? '',
    thumbnail: thumb ? v.thumbnail : `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
    ...(time(v.durationSec) && { durationSec: v.durationSec }),
  };
}

function candidate(v: unknown): Candidate | null {
  const item = sanitiseItem(v);
  if (!item) return null;
  const w = (v as Record<string, unknown>).watchedPercent;
  return typeof w === 'number' && Number.isFinite(w) && w >= 0 && w <= 100 ? { ...item, watchedPercent: w } : item;
}

function owner(v: unknown): { channelId: string; name: string } | null {
  return isObject(v) && typeof v.channelId === 'string' && CHANNEL_ID.test(v.channelId)
    ? { channelId: v.channelId, name: text(v.name, 100) ?? '' }
    : null;
}

function playlistMeta(v: unknown): { totalVideos: number | null; isInfinite: boolean } | null {
  if (!isObject(v)) return null;
  const total = Number.isInteger(v.totalVideos) && v.totalVideos >= 0 ? (v.totalVideos as number) : null;
  return { totalVideos: total, isInfinite: v.isInfinite === true };
}

function playing(v: unknown): Playing | null | undefined {
  if (v === null) return null;
  if (!isObject(v) || !isVideoId(v.videoId) || !time(v.timeSec)) return undefined;
  const title = text(v.title, 200);
  const channel = text(v.channel, 100);
  return { videoId: v.videoId, timeSec: v.timeSec, ...(title !== undefined && { title }), ...(channel !== undefined && { channel }) };
}

export function validateEvent(raw: unknown): PageEvent | null {
  if (!isObject(raw)) return null;
  switch (raw.type) {
    case 'navigated': {
      const from = playing(raw.from);
      return isVideoId(raw.videoId) && from !== undefined ? { type: 'navigated', videoId: raw.videoId, from } : null;
    }
    case 'ended':
      return isVideoId(raw.videoId) ? { type: 'ended', videoId: raw.videoId } : null;
    case 'progress': {
      if (!isVideoId(raw.videoId) || !time(raw.timeSec) || !time(raw.durationSec)) return null;
      const title = text(raw.title, 200);
      const channel = text(raw.channel, 100);
      return {
        type: 'progress',
        videoId: raw.videoId,
        timeSec: raw.timeSec,
        durationSec: raw.durationSec,
        ...(title !== undefined && { title }),
        ...(channel !== undefined && { channel }),
      };
    }
    case 'watchData': {
      if (!isVideoId(raw.videoId)) return null;
      const pl = raw.playlist;
      const playlist =
        isObject(pl) && shortId(pl.playlistId) && Array.isArray(pl.items)
          ? { playlistId: pl.playlistId, items: pl.items.slice(0, MAX_PLAYLIST + 50).map(sanitiseItem).filter((i): i is NewItem => i !== null).slice(0, MAX_PLAYLIST) }
          : null;
      return {
        type: 'watchData',
        videoId: raw.videoId,
        playlist,
        autoplay: sanitiseItem(raw.autoplay),
        listParam: shortId(raw.listParam) ? raw.listParam : null,
        owner: owner(raw.owner),
        playlistMeta: playlistMeta(raw.playlistMeta),
      };
    }
    case 'fetched': {
      if (typeof raw.requestId !== 'string' || raw.requestId.length > 32 || !Array.isArray(raw.items)) return null;
      const token = raw.continuation;
      if (token !== null && token !== undefined && !(typeof token === 'string' && token.length <= MAX_TOKEN)) return null;
      if (raw.items.length > MAX_FETCHED_ITEMS) console.warn(`[shuffle] page had ${raw.items.length} items; keeping the first ${MAX_FETCHED_ITEMS}`);
      return {
        type: 'fetched',
        requestId: raw.requestId,
        ok: raw.ok === true,
        items: raw.items.slice(0, MAX_FETCHED_ITEMS + 50).map(candidate).filter((c): c is Candidate => c !== null).slice(0, MAX_FETCHED_ITEMS),
        continuation: typeof token === 'string' ? token : null,
      };
    }
    case 'shuffle': {
      if (!(SHUFFLE_ACTIONS as readonly unknown[]).includes(raw.action)) return null;
      if (raw.action === 'topic') {
        return typeof raw.query === 'string' && raw.query.trim() && raw.query.length <= 200 ? { type: 'shuffle', action: 'topic', query: raw.query.trim() } : null;
      }
      if (raw.action === 'stop') return { type: 'shuffle', action: 'stop' };
      const o = owner(raw);
      return o ? { type: 'shuffle', action: raw.action, channelId: o.channelId, name: o.name } : null;
    }
    case 'action': {
      if ((STEP_ACTIONS as readonly unknown[]).includes(raw.action)) {
        return isVideoId(raw.videoId) ? { type: 'action', action: raw.action, videoId: raw.videoId } : null;
      }
      if (!(ACTIONS as readonly unknown[]).includes(raw.action)) return null;
      if (raw.uid !== undefined && !(typeof raw.uid === 'string' && raw.uid.length <= 64)) return null;
      return { type: 'action', action: raw.action, ...(raw.uid !== undefined && { uid: raw.uid }) };
    }
    case 'move':
      return typeof raw.uid === 'string' && raw.uid.length <= 64 && Number.isInteger(raw.toIndex) && raw.toIndex >= 0
        ? { type: 'move', uid: raw.uid, toIndex: raw.toIndex }
        : null;
    default:
      return null;
  }
}

// The PiP window only plays: it may report playback and ask for next/previous, nothing else.
export function validatePipEvent(raw: unknown): PageEvent | null {
  const ev = validateEvent(raw);
  if (!ev || !PIP_EVENT_TYPES.includes(ev.type)) return null;
  if (ev.type === 'action' && ev.action !== 'next' && ev.action !== 'previous') return null;
  return ev;
}
