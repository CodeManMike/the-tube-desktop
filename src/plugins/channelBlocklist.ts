import { Plugin } from '../shared/plugin';

// One blocklist line: "Name (UC…)", "@handle" or a bare channel id.
export function parseBlockEntry(line: string): { id?: string; handle?: string } | null {
  const id = line.match(/\b(UC[\w-]{22})\b/)?.[1];
  if (id) return { id };
  const handle = line.trim().match(/^@[\w.-]{1,100}$/)?.[0];
  return handle ? { handle: handle.toLowerCase() } : null;
}

// Removes videos from blocked channels from feeds, search and Up next. Never on a channel's
// own page. Self-contained: serialised on its own.
export function removeBlocked(data: any, settings: Record<string, unknown>): any {
  if (/^\/(@|channel\/|c\/|user\/)/.test(location.pathname)) return data;
  const ids = new Set<string>();
  const handles = new Set<string>();
  for (const line of Array.isArray(settings.channels) ? settings.channels : []) {
    if (typeof line !== 'string') continue;
    const id = line.match(/\b(UC[\w-]{22})\b/)?.[1];
    if (id) ids.add(id);
    else if (/^@[\w.-]{1,100}$/.test(line.trim())) handles.add(line.trim().toLowerCase());
  }
  if (!ids.size && !handles.size) return data;

  // The first channel link inside an item is its channel (avatar or byline).
  function channelOf(node: any, depth = 0): { id: string; handle: string } | null {
    if (!node || typeof node !== 'object' || depth > 12) return null;
    const b = node.browseEndpoint;
    if (b && typeof b.browseId === 'string' && b.browseId.startsWith('UC')) {
      return { id: b.browseId, handle: String(b.canonicalBaseUrl ?? '').replace(/^\//, '').toLowerCase() };
    }
    for (const key of Object.keys(node)) {
      if (key === 'menuButton' || key === 'menu') continue;
      const found = channelOf(node[key], depth + 1);
      if (found) return found;
    }
    return null;
  }
  const isVideoItem = (n: any) => {
    const inner = n?.richItemRenderer?.content ?? n;
    return !!(inner?.lockupViewModel || inner?.videoRenderer || inner?.compactVideoRenderer);
  };
  function walk(node: any): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) {
        if (isVideoItem(node[i])) {
          const c = channelOf(node[i]);
          if (c && (ids.has(c.id) || handles.has(c.handle))) {
            node.splice(i, 1);
            continue;
          }
        }
        walk(node[i]);
      }
      return;
    }
    for (const key of Object.keys(node)) if (key !== 'playlist') walk(node[key]);
  }
  walk(data);
  return data;
}

// Adds "Block channel" after "Don't recommend channel" in each video's ⋮ menu. It becomes
// a URL the app intercepts (like "Add to queue"). Self-contained: serialised on its own.
export function addBlockMenuItem(data: any, _settings: Record<string, unknown>): any {
  function walk(node: any): void {
    if (!node || typeof node !== 'object') return;
    const lockup = node.lockupViewModel;
    if (lockup) {
      const meta = lockup.metadata?.lockupMetadataViewModel;
      const ch = meta?.image?.decoratedAvatarViewModel?.rendererContext?.commandContext?.onTap?.innertubeCommand?.browseEndpoint;
      const items = meta?.menuButton?.buttonViewModel?.onTap?.innertubeCommand?.showSheetCommand?.panelLoadingStrategy?.inlineContent?.sheetViewModel?.content?.listViewModel?.listItems;
      const name = String(meta?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]?.text?.content ?? '');
      if (ch && typeof ch.browseId === 'string' && ch.browseId.startsWith('UC') && Array.isArray(items)) {
        const at = items.findIndex((i: any) => i?.listItemViewModel?.title?.content === "Don't recommend channel");
        const already = items.some((i: any) => i?.listItemViewModel?.title?.content === 'Block channel');
        if (at >= 0 && !already) {
          const item = JSON.parse(JSON.stringify(items[at]));
          const handle = String(ch.canonicalBaseUrl ?? '').replace(/^\//, '');
          const path = `/ttd/block-channel?c=${ch.browseId}&h=${encodeURIComponent(handle)}&n=${encodeURIComponent(name)}`;
          item.listItemViewModel.title = { content: 'Block channel' };
          item.listItemViewModel.rendererContext = {
            ...(item.listItemViewModel.rendererContext ?? {}),
            commandContext: { onTap: { innertubeCommand: {
              commandMetadata: { webCommandMetadata: { url: path, webPageType: 'WEB_PAGE_TYPE_UNKNOWN', rootVe: 83769 } },
              urlEndpoint: { url: 'https://www.youtube.com' + path },
            } } },
          };
          items.splice(at + 1, 0, item);
        }
      }
    }
    for (const key of Object.keys(node)) walk(node[key]);
  }
  walk(data);
  return data;
}

// A channel blocked from the menu disappears at once, without reloading the page.
function blocklistScript(_settings: Record<string, unknown>): void {
  const bridge = (window as any).ttdBlock;
  if (!bridge) return;
  const ITEMS = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, yt-lockup-view-model';
  bridge.onAdded((c: { channelId?: string; handle?: string }) => {
    const handle = String(c?.handle ?? '').toLowerCase();
    for (const el of document.querySelectorAll<HTMLElement>(ITEMS)) {
      const hrefs = [...el.querySelectorAll('a[href]')].map((a) => (a.getAttribute('href') ?? '').toLowerCase());
      if (hrefs.some((h) => (c.channelId && h.includes('/channel/' + c.channelId.toLowerCase())) || (handle && (h === '/' + handle || h.startsWith('/' + handle + '/'))))) {
        el.style.display = 'none';
      }
    }
  });
}

export const channelBlocklist: Plugin = {
  manifest: {
    id: 'channelBlocklist',
    name: 'Channel blocklist',
    hint: "Add channels from a video's ⋮ menu → Block channel.",
    defaultEnabled: true,
    settings: [{ key: 'channels', label: 'Blocked channels', type: 'stringList', default: [] }],
  },
  transforms: {
    browse: [removeBlocked, addBlockMenuItem],
    search: [removeBlocked, addBlockMenuItem],
    next: [removeBlocked, addBlockMenuItem],
    initialData: [removeBlocked, addBlockMenuItem],
  },
  pageScript: blocklistScript,
};
