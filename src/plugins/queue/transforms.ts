// Queue transforms. Each runs inside YouTube's page, serialised with toString(), so each
// must be self-contained: helpers live inside the function. Live queue state is read
// only from globalThis.__ttdQueue (set by the queue page script).

// YouTube's "Add to queue" (hover button and ⋮ menu) becomes a URL the main process
// intercepts in will-navigate, so the video lands in TTD's queue instead of YouTube's.
export function interceptAddToQueue(data: any, _settings: Record<string, unknown>): any {
  const walk = (node: any): void => {
    if (!node || typeof node !== 'object') return;
    for (const key of Object.keys(node)) {
      const value = node[key];
      const add = value?.signalServiceEndpoint?.actions?.[0]?.addToPlaylistCommand;
      if (add && add.listType === 'PLAYLIST_EDIT_LIST_TYPE_QUEUE' && typeof add.videoId === 'string') {
        const path = '/ttd/queue-add?v=' + encodeURIComponent(add.videoId);
        node[key] = {
          commandMetadata: { webCommandMetadata: { url: path, webPageType: 'WEB_PAGE_TYPE_UNKNOWN', rootVe: 83769 } },
          urlEndpoint: { url: 'https://www.youtube.com' + path },
        };
        continue;
      }
      walk(value);
    }
  };
  walk(data);
  return data;
}

// Point YouTube's autoplay, next button and end-screen at TTD's next video, so its own
// controls follow the queue.
export function pointAutoplayAtQueue(data: any, _settings: Record<string, unknown>): any {
  const next = (globalThis as any).__ttdQueue?.nextVideoId;
  if (typeof next !== 'string') return data;
  const set = data?.contents?.twoColumnWatchNextResults?.autoplay?.autoplay?.sets?.[0];
  if (set?.autoplayVideo?.watchEndpoint) set.autoplayVideo.watchEndpoint.videoId = next;
  if (set?.nextButtonVideo?.watchEndpoint) set.nextButtonVideo.watchEndpoint.videoId = next;
  const overlay = data?.playerOverlays?.playerOverlayRenderer?.autoplay?.playerOverlayAutoplayRenderer;
  if (overlay) overlay.videoId = next;
  return data;
}

// Remember the watch page's playlist window and YouTube's autoplay pick for the page
// script to report. Leaves the data itself untouched.
export function capturePlaylistAndAutoplay(data: any, _settings: Record<string, unknown>): any {
  const watch = data?.contents?.twoColumnWatchNextResults;
  if (!watch) return data;

  const text = (t: any): string => t?.simpleText ?? (Array.isArray(t?.runs) ? t.runs.map((r: any) => r.text).join('') : '');
  const duration = (s: string): number | undefined => {
    if (!/^\d+(:\d{1,2}){1,2}$/.test(s)) return undefined;
    return s.split(':').reduce((total, part) => total * 60 + Number(part), 0);
  };
  const thumb = (t: any, id: string): string => {
    const url = t?.thumbnails?.[0]?.url;
    return typeof url === 'string' && url.startsWith('https://') ? url.split('?')[0] : `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
  };

  const list = watch.playlist?.playlist;
  const playlist =
    list && typeof list.playlistId === 'string' && Array.isArray(list.contents)
      ? {
          playlistId: list.playlistId,
          items: list.contents
            .map((c: any) => c?.playlistPanelVideoRenderer)
            .filter((v: any) => v && typeof v.videoId === 'string')
            .map((v: any) => {
              const d = duration(text(v.lengthText));
              return {
                videoId: v.videoId,
                title: text(v.title),
                channel: text(v.shortBylineText),
                thumbnail: thumb(v.thumbnail, v.videoId),
                ...(d !== undefined && { durationSec: d }),
              };
            }),
        }
      : null;

  const autoplayId = watch.autoplay?.autoplay?.sets?.[0]?.autoplayVideo?.watchEndpoint?.videoId;
  let autoplay = null;
  if (typeof autoplayId === 'string') {
    // Its title and channel come from the matching related-video lockup, when present.
    let lockup: any = null;
    const find = (node: any): void => {
      if (lockup || !node || typeof node !== 'object') return;
      if (node.lockupViewModel?.contentId === autoplayId) lockup = node.lockupViewModel;
      else for (const key of Object.keys(node)) find(node[key]);
    };
    find(watch.secondaryResults);
    const meta = lockup?.metadata?.lockupMetadataViewModel;
    autoplay = {
      videoId: autoplayId,
      title: meta?.title?.content ?? autoplayId,
      channel: meta?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]?.text?.content ?? '',
      thumbnail: `https://i.ytimg.com/vi/${autoplayId}/mqdefault.jpg`,
    };
  }

  (globalThis as any).__ttdLastWatchData = { playlist, autoplay };
  return data;
}
