import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hideWatchedItems } from '../plugins/hideWatched';

const ON = { home: true, subscriptions: true, search: true, related: true, watchedPercent: 80 };
const at = (pathname: string) => ((globalThis as any).location = { pathname, hostname: 'www.youtube.com' });
const lockup = (id: string, pct?: number) => ({ richItemRenderer: { content: { lockupViewModel: { contentId: id, contentImage: { thumbnailViewModel: { overlays: pct === undefined ? [] : [{ thumbnailBottomOverlayViewModel: { progressBar: { thumbnailOverlayProgressBarViewModel: { startPercent: pct } } } }] } } } } } });
const home = (...items: any[]) => ({ contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { content: { richGridRenderer: { contents: items } } } }] } } });
const ids = (d: any) => d.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.richGridRenderer.contents.map((x: any) => x.richItemRenderer?.content.lockupViewModel.contentId ?? Object.keys(x)[0]);

test('a lockup at or over the threshold is removed on home', () => {
  at('/');
  assert.deepEqual(ids(hideWatchedItems(home(lockup('a', 85), lockup('b')), ON)), ['b']);
});

test('a lockup under the threshold stays', () => {
  at('/');
  assert.deepEqual(ids(hideWatchedItems(home(lockup('a', 40)), ON)), ['a']);
});

test('a search videoRenderer with percentDurationWatched 90 is removed', () => {
  at('/results');
  const v = (id: string, pct: number) => ({ videoRenderer: { videoId: id, thumbnailOverlays: [{ thumbnailOverlayResumePlaybackRenderer: { percentDurationWatched: pct } }] } });
  const data = { contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: [v('a', 90), v('b', 10)] } }] } } } } };
  const out = hideWatchedItems(data, ON).contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents[0].itemSectionRenderer.contents;
  assert.deepEqual(out.map((x: any) => x.videoRenderer.videoId), ['b']);
});

test('nothing is removed outside the enabled pages', () => {
  for (const path of ['/@channel', '/playlist', '/feed/history']) {
    at(path);
    assert.deepEqual(ids(hideWatchedItems(home(lockup('a', 95)), ON)), ['a'], path);
  }
  at('/');
  assert.deepEqual(ids(hideWatchedItems(home(lockup('a', 95)), { ...ON, home: false })), ['a']);
});

test('removal keeps continuation items', () => {
  at('/');
  const out = hideWatchedItems(home(lockup('a', 95), { continuationItemRenderer: { token: 't' } }), ON);
  assert.deepEqual(ids(out), ['continuationItemRenderer']);
});
