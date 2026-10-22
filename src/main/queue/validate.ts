import { NewItem, Playing } from './model';

// Events from YouTube's page are untrusted: every field is checked, capped or defaulted
// here before it can reach the queue or the files on disk.

export type PageEvent =
  | { type: 'navigated'; videoId: string; from: Playing | null }
  | { type: 'ended'; videoId: string }
  | { type: 'progress'; videoId: string; timeSec: number; durationSec: number; title?: string; channel?: string }
  | { type: 'watchData'; videoId: string; playlist: { playlistId: string; items: NewItem[] } | null; autoplay: NewItem | null; listParam: string | null }
  | { type: 'action'; action: 'jump' | 'remove' | 'playNext' | 'back'; uid?: string }
  | { type: 'move'; uid: string; toIndex: number };

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const MAX_PLAYLIST = 500;
const ACTIONS = ['jump', 'remove', 'playNext', 'back'] as const;

const isObject = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isVideoId = (v: unknown): v is string => typeof v === 'string' && VIDEO_ID.test(v);
const time = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const text = (v: unknown, max: number): string | undefined => (typeof v === 'string' ? v.slice(0, max) : undefined);
const shortId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 100;

export function sanitiseItem(v: unknown): NewItem | null {
  if (!isObject(v) || !isVideoId(v.videoId)) return null;
  const thumb = typeof v.thumbnail === 'string' && v.thumbnail.startsWith('https://') && v.thumbnail.length <= 500;
  return {
    videoId: v.videoId,
    title: text(v.title, 200) ?? v.videoId,
    channel: text(v.channel, 100) ?? '',
    thumbnail: thumb ? v.thumbnail : `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
    ...(time(v.durationSec) && { durationSec: v.durationSec }),
  };
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
      };
    }
    case 'action': {
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
