import { Plugin } from '../shared/plugin';

// Adds "TTD settings" to YouTube's left sidebar, at the top of its last section (where
// YouTube's own Settings entry used to sit, above Report history).
// Helpers live inside the function so its toString() is runnable on its own.
function addSettingsEntry(data: any): any {
  // Clicks on this URL never reach YouTube (see the page script), so it only has to be
  // something YouTube itself never links to.
  const url = '/ttd-settings';
  const sections = data && Array.isArray(data.items) ? data.items : null;
  if (!sections) return data;
  const isOurs = (item: any) => item?.guideEntryRenderer?.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url === url;
  const plain = sections.filter((s: any) => s && s.guideSectionRenderer && Array.isArray(s.guideSectionRenderer.items));
  if (plain.some((s: any) => s.guideSectionRenderer.items.some(isOurs))) return data;
  const last = plain[plain.length - 1];
  if (!last) return data;
  last.guideSectionRenderer.items.unshift({
    guideEntryRenderer: {
      navigationEndpoint: { commandMetadata: { webCommandMetadata: { url } }, urlEndpoint: { url } },
      icon: { iconType: 'SETTINGS' },
      formattedTitle: { simpleText: 'TTD settings' },
      accessibility: { accessibilityData: { label: 'TTD settings' } },
    },
  });
  return data;
}

// A click on the entry opens TTD's Settings window instead of navigating. Listening on
// window in the capture phase runs before any of YouTube's own handlers.
function settingsLinkScript(): void {
  const api = (window as any).ttd;
  if (!api?.settings) return;
  window.addEventListener(
    'click',
    (event) => {
      const target = event.target as Element | null;
      if (!target?.closest?.('a[href="/ttd-settings"]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      api.settings.open();
    },
    true,
  );
}

export const settingsLink: Plugin = {
  manifest: {
    id: 'settingsLink',
    name: 'TTD settings in the sidebar',
    hint: 'Ctrl+, and the tray icon open Settings too.',
    defaultEnabled: true,
    settings: [],
  },
  transforms: { guide: addSettingsEntry },
  pageScript: settingsLinkScript,
};
