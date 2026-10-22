export type ParsedVideo = {
  videoId: string;
  title: string;
  channel: string;
  channelId?: string;
  thumbnail: string;
  durationSec?: number;
  watchedPercent?: number;
};

// Read the videos and the next continuation token from any InnerTube list page: creator
// uploads and playlists (lockupViewModel), search (videoRenderer) and classic playlists
// (playlistVideoRenderer), first pages or continuation responses alike. Runs inside the
// page, serialised with toString(), so it is self-contained.
export function parseVideoPage(json: any): { items: ParsedVideo[]; continuation: string | null } {
  const text = (t: any): string => t?.simpleText ?? t?.content ?? (Array.isArray(t?.runs) ? t.runs.map((r: any) => r.text).join('') : '');
  const duration = (s: unknown): number | undefined => {
    if (typeof s !== 'string' || !/^\d+(:\d{1,2}){1,2}$/.test(s)) return undefined;
    return s.split(':').reduce((total, part) => total * 60 + Number(part), 0);
  };
  const thumb = (url: unknown, id: string): string =>
    typeof url === 'string' && url.startsWith('https://') ? url.split('?')[0] : `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
  const resume = (overlays: any): number | undefined => {
    for (const o of Array.isArray(overlays) ? overlays : []) {
      const p = o?.thumbnailOverlayResumePlaybackRenderer?.percentDurationWatched;
      if (typeof p === 'number') return p;
    }
    return undefined;
  };

  const items: ParsedVideo[] = [];
  const seen = new Set<string>();
  let continuation: string | null = null;
  const add = (v: ParsedVideo) => {
    // Live streams and premieres have no duration; they don't belong in a shuffle.
    if (!/^[A-Za-z0-9_-]{11}$/.test(v.videoId) || v.durationSec === undefined || seen.has(v.videoId)) return;
    seen.add(v.videoId);
    items.push(v);
  };

  const fromLockup = (l: any) => {
    if (l.contentType && l.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO') return; // shorts, playlists, channels
    const id = l.contentId;
    if (typeof id !== 'string') return;
    const meta = l.metadata?.lockupMetadataViewModel;
    // The channel is the first metadata part that links to a channel. Uploads lists have
    // no such part (their first part is the view count), so the channel stays empty.
    let part: any = null;
    let channelId: unknown;
    for (const row of meta?.metadata?.contentMetadataViewModel?.metadataRows ?? []) {
      for (const p of row?.metadataParts ?? []) {
        const id = p?.text?.commandRuns?.[0]?.onTap?.innertubeCommand?.browseEndpoint?.browseId;
        if (!part && typeof id === 'string') {
          part = p.text;
          channelId = id;
        }
      }
    }
    let length: string | undefined;
    for (const o of l.contentImage?.thumbnailViewModel?.overlays ?? []) {
      for (const b of o?.thumbnailBottomOverlayViewModel?.badges ?? []) length ??= b?.thumbnailBadgeViewModel?.text;
    }
    add({
      videoId: id,
      title: text(meta?.title),
      channel: text(part),
      ...(typeof channelId === 'string' && { channelId }),
      thumbnail: thumb(l.contentImage?.thumbnailViewModel?.image?.sources?.[0]?.url, id),
      durationSec: duration(length),
    });
  };

  const fromVideoRenderer = (v: any) => {
    const watched = resume(v.thumbnailOverlays);
    const channelId = v.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId;
    add({
      videoId: v.videoId,
      title: text(v.title),
      channel: text(v.ownerText ?? v.shortBylineText ?? v.longBylineText),
      ...(typeof channelId === 'string' && { channelId }),
      thumbnail: thumb(v.thumbnail?.thumbnails?.[0]?.url, v.videoId),
      durationSec: duration(text(v.lengthText)),
      ...(watched !== undefined && { watchedPercent: watched }),
    });
  };

  const fromPlaylistVideo = (v: any) => {
    const watched = resume(v.thumbnailOverlays);
    const seconds = Number(v.lengthSeconds);
    add({
      videoId: v.videoId,
      title: text(v.title),
      channel: text(v.shortBylineText),
      thumbnail: thumb(v.thumbnail?.thumbnails?.[0]?.url, v.videoId),
      durationSec: Number.isFinite(seconds) && seconds > 0 ? seconds : duration(text(v.lengthText)),
      ...(watched !== undefined && { watchedPercent: watched }),
    });
  };

  const walk = (node: any, depth: number): void => {
    if (!node || typeof node !== 'object' || depth > 60) return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n, depth + 1);
      return;
    }
    if (node.lockupViewModel) return fromLockup(node.lockupViewModel);
    if (node.videoRenderer) return fromVideoRenderer(node.videoRenderer);
    if (node.playlistVideoRenderer) return fromPlaylistVideo(node.playlistVideoRenderer);
    if (continuation === null && typeof node.continuationCommand?.token === 'string') continuation = node.continuationCommand.token;
    for (const key of Object.keys(node)) walk(node[key], depth + 1);
  };
  walk(json, 0);
  return { items, continuation };
}
