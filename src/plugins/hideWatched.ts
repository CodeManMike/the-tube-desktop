import { Plugin } from '../shared/plugin';

// Removes videos YouTube marks as watched (its progress bar, which includes phone and TV
// viewing) on the pages the user picked. Transforms run in the page, so the page path says
// which feed a response belongs to. Self-contained: serialised on its own.
export function hideWatchedItems(data: any, settings: Record<string, unknown>): any {
  const path = location.pathname;
  const page = path === '/' ? 'home' : path === '/feed/subscriptions' ? 'subscriptions' : path === '/results' ? 'search' : path === '/watch' ? 'related' : null;
  if (!page || settings[page] !== true) return data;
  const threshold = Number(settings.watchedPercent ?? 80);

  function percent(item: any): number | null {
    const inner = item?.richItemRenderer?.content ?? item;
    const lockup = inner?.lockupViewModel;
    if (lockup) {
      for (const o of lockup.contentImage?.thumbnailViewModel?.overlays ?? []) {
        const p = o?.thumbnailBottomOverlayViewModel?.progressBar?.thumbnailOverlayProgressBarViewModel?.startPercent;
        if (typeof p === 'number') return p;
      }
      return null;
    }
    const video = inner?.videoRenderer ?? inner?.compactVideoRenderer;
    for (const o of video?.thumbnailOverlays ?? []) {
      const p = o?.thumbnailOverlayResumePlaybackRenderer?.percentDurationWatched;
      if (typeof p === 'number') return p;
    }
    return null;
  }

  function walk(node: any): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) {
        const p = percent(node[i]);
        if (p !== null && p >= threshold) node.splice(i, 1);
        else walk(node[i]);
      }
      return;
    }
    for (const key of Object.keys(node)) if (key !== 'playlist') walk(node[key]); // never the playlist panel
  }

  walk(data);
  return data;
}

// TTD's own history (videos watched here, past the threshold), hidden in the DOM because
// the transforms run synchronously and the list lives in the app.
function hideWatchedScript(settings: Record<string, unknown>): void {
  const bridge = (window as any).ttdHistory;
  if (!bridge) return;
  const pages: Record<string, string> = { '/': 'home', '/feed/subscriptions': 'subscriptions', '/results': 'search', '/watch': 'related' };
  const ITEMS = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, yt-lockup-view-model';
  let watched = new Set<string>();
  const sweep = () => {
    const page = pages[location.pathname];
    if (!page || settings[page] !== true || !watched.size) return;
    const scope = page === 'related' ? document.querySelector('#secondary') : document;
    for (const el of scope?.querySelectorAll<HTMLElement>(ITEMS) ?? []) {
      if (el.dataset.ttdWatched || el.closest('ytd-playlist-panel-renderer, .ttd-queue')) continue;
      const href = el.querySelector('a[href*="watch?v="]')?.getAttribute('href') ?? '';
      const id = href.match(/[?&]v=([\w-]{11})/)?.[1];
      if (id && watched.has(id)) {
        el.dataset.ttdWatched = '1';
        el.style.display = 'none';
      }
    }
  };
  let pending = 0;
  const soon = () => {
    if (!pending) pending = window.setTimeout(() => ((pending = 0), sweep()), 250);
  };
  bridge
    .watched(Number(settings.watchedPercent ?? 80))
    .then((ids: unknown) => {
      if (Array.isArray(ids)) watched = new Set(ids.filter((x) => typeof x === 'string'));
      sweep();
    })
    .catch(() => {});
  new MutationObserver(soon).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('yt-navigate-finish', soon);
}

const PAGES: [key: string, label: string][] = [
  ['home', 'Home'],
  ['subscriptions', 'Subscriptions'],
  ['search', 'Search'],
  ['related', 'Up next'],
];

export const hideWatched: Plugin = {
  manifest: {
    id: 'hideWatched',
    name: 'Hide watched',
    hint: "Uses YouTube's own progress bars, which include phone and TV viewing, plus TTD's history.",
    defaultEnabled: false,
    settings: PAGES.map(([key, label]) => ({ key, label, type: 'boolean' as const, default: true })),
  },
  borrows: { watchedPercent: { plugin: 'queue', key: 'watchedPercent' } },
  transforms: { browse: hideWatchedItems, search: hideWatchedItems, next: hideWatchedItems, initialData: hideWatchedItems },
  pageScript: hideWatchedScript,
};
