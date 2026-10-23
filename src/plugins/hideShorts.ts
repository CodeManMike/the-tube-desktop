import { Plugin } from '../shared/plugin';

// Helpers live inside the function so its toString() is runnable on its own.
function hideShortsTransform(data: any, _settings: Record<string, unknown>): any {
  // Only an element that *is* a Shorts item or shelf is removed. Containers that
  // merely hold one (search sections, the watch sidebar) are kept and recursed into.
  function isShortsItem(el: any): boolean {
    if (!el || typeof el !== 'object' || Array.isArray(el)) return false;
    if (el.reelShelfRenderer || el.reelItemRenderer || el.shortsLockupViewModel) return true;
    const item = el.richItemRenderer && el.richItemRenderer.content;
    if (item && (item.shortsLockupViewModel || item.reelItemRenderer)) return true;
    const section = el.richSectionRenderer && el.richSectionRenderer.content;
    if (section && section.reelShelfRenderer) return true;
    const shelf = section && section.richShelfRenderer;
    if (shelf && shelf.isShorts) return true;
    return !!(shelf && Array.isArray(shelf.contents) && shelf.contents.length > 0 && shelf.contents.every(isShortsItem));
  }

  function walk(node: any): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) {
        if (isShortsItem(node[i])) node.splice(i, 1);
        else walk(node[i]);
      }
      return;
    }
    for (const key of Object.keys(node)) walk(node[key]);
  }

  walk(data);
  return data;
}

export const hideShorts: Plugin = {
  manifest: {
    id: 'hideShorts',
    name: 'Hide Shorts',
    defaultEnabled: true,
    settings: [],
  },
  transforms: {
    browse: hideShortsTransform,
    next: hideShortsTransform,
    search: hideShortsTransform,
    initialData: hideShortsTransform,
  },
  css: 'ytd-guide-entry-renderer:has(a[title="Shorts"]), ytd-mini-guide-entry-renderer[aria-label="Shorts"] { display: none !important; }',
};
