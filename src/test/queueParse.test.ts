import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'vm';
import { parseVideoPage } from '../plugins/queue/parse';
import { asExpression } from '../main/pluginRegistry';

const ID = (c: string) => c.repeat(11);
const CH = 'UC' + 'x'.repeat(22);

const lockup = (id: string, opts: { duration?: string; title?: string; channel?: string; type?: string } = {}) => ({
  lockupViewModel: {
    contentId: id,
    contentType: opts.type ?? 'LOCKUP_CONTENT_TYPE_VIDEO',
    contentImage: { thumbnailViewModel: {
      image: { sources: [{ url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg?sqp=abc&rs=xyz`, width: 168 }] },
      overlays: opts.duration === undefined ? [] : [{ thumbnailBottomOverlayViewModel: { badges: [{ thumbnailBadgeViewModel: { text: opts.duration } }] } }],
    } },
    metadata: { lockupMetadataViewModel: {
      title: { content: opts.title ?? `Lockup ${id[0]}` },
      metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: {
        content: opts.channel ?? 'Chan L',
        commandRuns: [{ onTap: { innertubeCommand: { browseEndpoint: { browseId: CH } } } }],
      } }] }] } },
    } },
  },
});

const videoRenderer = (id: string, watched?: number) => ({
  videoRenderer: {
    videoId: id,
    title: { runs: [{ text: 'Search ' }, { text: 'Hit' }] },
    ownerText: { runs: [{ text: 'Chan S', navigationEndpoint: { browseEndpoint: { browseId: CH } } }] },
    lengthText: { simpleText: '1:02:03' },
    thumbnail: { thumbnails: [{ url: `https://i.ytimg.com/vi/${id}/hq720.jpg?x=1` }] },
    thumbnailOverlays: watched === undefined ? [] : [{ thumbnailOverlayResumePlaybackRenderer: { percentDurationWatched: watched } }],
  },
});

const playlistVideo = (id: string) => ({
  playlistVideoRenderer: {
    videoId: id,
    title: { runs: [{ text: 'PL item' }] },
    shortBylineText: { runs: [{ text: 'Chan P' }] },
    lengthSeconds: '253',
    thumbnail: { thumbnails: [{ url: `https://i.ytimg.com/vi/${id}/default.jpg` }] },
    thumbnailOverlays: [{ thumbnailOverlayResumePlaybackRenderer: { percentDurationWatched: 40 } }],
  },
});

const tokenItem = (token: string) => ({
  continuationItemViewModel: { continuationCommand: { innertubeCommand: { continuationCommand: { token, request: 'CONTINUATION_REQUEST_TYPE_BROWSE' } } } },
});

test('parses lockup items (uploads/playlist) with title, channel, duration and thumbnail', () => {
  const page = { contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [
    { itemSectionRenderer: { contents: [lockup(ID('a'), { duration: '3:34' }), tokenItem('TOKEN1')] } },
  ] } } } }] } } };
  const { items, continuation } = parseVideoPage(page);
  assert.deepEqual(items, [{
    videoId: ID('a'), title: 'Lockup a', channel: 'Chan L', channelId: CH, thumbnail: `https://i.ytimg.com/vi/${ID('a')}/hqdefault.jpg`, durationSec: 214,
  }]);
  assert.equal(continuation, 'TOKEN1');
});

test('parses search videoRenderer items with the resume percentage', () => {
  const page = { contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [
    { itemSectionRenderer: { contents: [videoRenderer(ID('b'), 85), videoRenderer(ID('c'))] } },
    { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'TOKEN2' } } } },
  ] } } } } };
  const { items, continuation } = parseVideoPage(page);
  assert.deepEqual(items[0], {
    videoId: ID('b'), title: 'Search Hit', channel: 'Chan S', channelId: CH, thumbnail: `https://i.ytimg.com/vi/${ID('b')}/hq720.jpg`, durationSec: 3723, watchedPercent: 85,
  });
  assert.equal('watchedPercent' in items[1], false);
  assert.equal(continuation, 'TOKEN2');
});

test('parses classic playlistVideoRenderer items', () => {
  const { items } = parseVideoPage({ contents: [playlistVideo(ID('d'))] });
  assert.deepEqual(items, [{
    videoId: ID('d'), title: 'PL item', channel: 'Chan P', thumbnail: `https://i.ytimg.com/vi/${ID('d')}/default.jpg`, durationSec: 253, watchedPercent: 40,
  }]);
});

test('reads items and the next token from a continuation response', () => {
  const page = { onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: [
    { itemSectionRenderer: { contents: [lockup(ID('e'), { duration: '10:00' })] } }, tokenItem('TOKEN3'),
  ] } }] };
  const { items, continuation } = parseVideoPage(page);
  assert.deepEqual(items.map((i) => i.videoId), [ID('e')]);
  assert.equal(continuation, 'TOKEN3');
});

test('skips shorts, live (no duration) and items without ids; no token gives null', () => {
  const page = { contents: [
    lockup(ID('f'), { duration: '1:00', type: 'LOCKUP_CONTENT_TYPE_SHORTS' }),
    lockup(ID('g')), // live: no duration badge
    lockup(ID('h'), { duration: 'LIVE' }),
    { lockupViewModel: { contentImage: {} } },
    { shortsLockupViewModel: { entityId: 'x' } },
    lockup(ID('i'), { duration: '2:00' }),
  ] };
  const { items, continuation } = parseVideoPage(page);
  assert.deepEqual(items.map((i) => i.videoId), [ID('i')]);
  assert.equal(continuation, null);
});

test('the same video appearing twice in a page is returned once', () => {
  const { items } = parseVideoPage({ contents: [lockup(ID('j'), { duration: '1:00' }), lockup(ID('j'), { duration: '1:00' })] });
  assert.equal(items.length, 1);
});

test('parseVideoPage is self-contained', () => {
  const sandbox: any = {};
  const standalone = vm.runInNewContext(asExpression(parseVideoPage), sandbox);
  assert.equal(standalone({ contents: [lockup(ID('k'), { duration: '1:00' })] }).items.length, 1);
});
