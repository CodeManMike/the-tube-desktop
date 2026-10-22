import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capturePlaylistAndAutoplay, interceptAddToQueue, pointAutoplayAtQueue } from '../plugins/queue/transforms';

const g = globalThis as any;
const ID = (c: string) => c.repeat(11);

const queueSignal = (videoId: string) => ({
  signalServiceEndpoint: { signal: 'CLIENT_SIGNAL', actions: [{ addToPlaylistCommand: { openMiniplayer: true, videoId, listType: 'PLAYLIST_EDIT_LIST_TYPE_QUEUE' } }] },
});

function homeFeed() {
  return {
    contents: { richGridRenderer: { contents: [{ richItemRenderer: { content: { lockupViewModel: {
      contentImage: { overlays: [{ buttons: [{ buttonViewModel: { onTap: { innertubeCommand: queueSignal(ID('a')) } } }] }] },
      metadata: { menuButton: { listItems: [
        { onTap: { innertubeCommand: queueSignal(ID('a')) } },
        { onTap: { innertubeCommand: { signalServiceEndpoint: { actions: [{ addToPlaylistCommand: { listType: 'PLAYLIST_EDIT_LIST_TYPE_WATCH_LATER', videoId: ID('a') } }] } } } },
      ] } },
    } } } }] } },
  };
}

function watchResponse(selfId = 'w'.repeat(11)) {
  const thumb = (id: string) => ({ thumbnails: [{ url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg?x=1`, width: 168, height: 94 }] });
  return {
    contents: { twoColumnWatchNextResults: {
      playlist: { playlist: { playlistId: 'PLx', title: 'My list', isInfinite: false, contents: [
        { playlistPanelVideoRenderer: { videoId: ID('p'), title: { simpleText: 'First' }, shortBylineText: { runs: [{ text: 'Chan P' }] }, lengthText: { simpleText: '4:13' }, thumbnail: thumb(ID('p')) } },
        { playlistPanelVideoRenderer: { videoId: ID('q'), title: { runs: [{ text: 'Sec' }, { text: 'ond' }] }, shortBylineText: { runs: [{ text: 'Chan Q' }] }, lengthText: { simpleText: '1:02:03' }, thumbnail: thumb(ID('q')) } },
        { playlistPanelVideoRenderer: { videoId: ID('r'), title: { simpleText: 'Live' }, shortBylineText: { runs: [{ text: 'Chan R' }] }, lengthText: { simpleText: 'LIVE' }, thumbnail: thumb(ID('r')) } },
      ] } },
      autoplay: { autoplay: { sets: [{ autoplayVideo: { watchEndpoint: { videoId: ID('z') } }, nextButtonVideo: { watchEndpoint: { videoId: ID('z') } } }] } },
      secondaryResults: { secondaryResults: { results: [{ itemSectionRenderer: { contents: [{ lockupViewModel: {
        contentId: ID('z'),
        metadata: { lockupMetadataViewModel: { title: { content: 'Auto Title' }, metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: 'Auto Channel' } }] }] } } } },
      } }] } }] } },
    } },
    playerOverlays: { playerOverlayRenderer: { autoplay: { playerOverlayAutoplayRenderer: { videoId: ID('z') } } } },
    currentVideoEndpoint: { watchEndpoint: { videoId: selfId } },
  };
}

test('rewrites both hover-button and menu-sheet QUEUE commands; leaves other signals alone', () => {
  const out = interceptAddToQueue(homeFeed(), {});
  const lockup = out.contents.richGridRenderer.contents[0].richItemRenderer.content.lockupViewModel;
  const expected = {
    commandMetadata: { webCommandMetadata: { url: `/ttd/queue-add?v=${ID('a')}`, webPageType: 'WEB_PAGE_TYPE_UNKNOWN', rootVe: 83769 } },
    urlEndpoint: { url: `https://www.youtube.com/ttd/queue-add?v=${ID('a')}` },
  };
  assert.deepEqual(lockup.contentImage.overlays[0].buttons[0].buttonViewModel.onTap.innertubeCommand, expected);
  assert.deepEqual(lockup.metadata.menuButton.listItems[0].onTap.innertubeCommand, expected);
  assert.equal(
    lockup.metadata.menuButton.listItems[1].onTap.innertubeCommand.signalServiceEndpoint.actions[0].addToPlaylistCommand.listType,
    'PLAYLIST_EDIT_LIST_TYPE_WATCH_LATER',
  );
});

test('pointAutoplayAtQueue overwrites autoplay, next button and overlay ids when a next video is set', () => {
  g.__ttdQueue = { nextVideoId: ID('n') };
  const out = pointAutoplayAtQueue(watchResponse(), {});
  const set = out.contents.twoColumnWatchNextResults.autoplay.autoplay.sets[0];
  assert.equal(set.autoplayVideo.watchEndpoint.videoId, ID('n'));
  assert.equal(set.nextButtonVideo.watchEndpoint.videoId, ID('n'));
  assert.equal(out.playerOverlays.playerOverlayRenderer.autoplay.playerOverlayAutoplayRenderer.videoId, ID('n'));
  delete g.__ttdQueue;
});

test('pointAutoplayAtQueue is a no-op without queue state', () => {
  delete g.__ttdQueue;
  assert.deepEqual(pointAutoplayAtQueue(watchResponse(), {}), watchResponse());
  g.__ttdQueue = { nextVideoId: null };
  assert.deepEqual(pointAutoplayAtQueue(watchResponse(), {}), watchResponse());
  delete g.__ttdQueue;
});

test('capture extracts playlist items and the autoplay candidate', () => {
  delete g.__ttdLastWatchData;
  const data = watchResponse();
  assert.deepEqual(capturePlaylistAndAutoplay(data, {}), watchResponse());
  const { playlist, autoplay } = g.__ttdLastWatchData;
  assert.equal(playlist.playlistId, 'PLx');
  assert.deepEqual(playlist.items[0], {
    videoId: ID('p'), title: 'First', channel: 'Chan P', thumbnail: `https://i.ytimg.com/vi/${ID('p')}/hqdefault.jpg`, durationSec: 253,
  });
  assert.equal(playlist.items[1].title, 'Second');
  assert.equal(playlist.items[1].durationSec, 3723);
  assert.equal('durationSec' in playlist.items[2], false); // "LIVE"
  assert.deepEqual(autoplay, { videoId: ID('z'), title: 'Auto Title', channel: 'Auto Channel', thumbnail: `https://i.ytimg.com/vi/${ID('z')}/mqdefault.jpg` });
});

test('capture handles a watch response with no playlist', () => {
  const data = watchResponse() as any;
  delete data.contents.twoColumnWatchNextResults.playlist;
  capturePlaylistAndAutoplay(data, {});
  assert.equal(g.__ttdLastWatchData.playlist, null);
  assert.equal(g.__ttdLastWatchData.autoplay.videoId, ID('z'));
});

test('every transform returns non-watch data unchanged', () => {
  g.__ttdQueue = { nextVideoId: ID('n') };
  g.__ttdLastWatchData = 'untouched';
  const feed = { contents: { richGridRenderer: { contents: [{ x: 1 }] } } };
  assert.deepEqual(interceptAddToQueue(structuredClone(feed), {}), feed);
  assert.deepEqual(pointAutoplayAtQueue(structuredClone(feed), {}), feed);
  assert.deepEqual(capturePlaylistAndAutoplay(structuredClone(feed), {}), feed);
  assert.equal(g.__ttdLastWatchData, 'untouched');
  delete g.__ttdQueue;
  delete g.__ttdLastWatchData;
});

import vm from 'vm';
import { asExpression } from '../main/pluginRegistry';

test('each transform runs standalone in a fresh context (self-contained)', () => {
  for (const fn of [interceptAddToQueue, pointAutoplayAtQueue, capturePlaylistAndAutoplay]) {
    const sandbox: any = {};
    sandbox.globalThis = sandbox;
    const standalone = vm.runInNewContext(asExpression(fn), sandbox);
    assert.doesNotThrow(() => standalone(watchResponse(), {}), fn.name);
  }
});

import { queuePageScript } from '../plugins/queue/pageScript';

test('the queue page script serialises and exits quietly without the bridge', () => {
  const sandbox: any = { window: {} };
  sandbox.globalThis = sandbox;
  const standalone = vm.runInNewContext(asExpression(queuePageScript), sandbox);
  assert.doesNotThrow(() => standalone({}));
});

test('pointAutoplayAtQueue never points a video at itself (stale queue state)', () => {
  g.__ttdQueue = { nextVideoId: ID('w') };
  assert.deepEqual(pointAutoplayAtQueue(watchResponse(ID('w')), {}), watchResponse(ID('w')));
  delete g.__ttdQueue;
});

test('captured watch data is tagged with its own video id', () => {
  capturePlaylistAndAutoplay(watchResponse(ID('w')), {});
  assert.equal(g.__ttdLastWatchData.videoId, ID('w'));
});

test("the queue plugin captures YouTube's real pick before redirecting autoplay", async () => {
  const { queue } = await import('../plugins/queue');
  const fns = queue.transforms!.next as Function[];
  assert.ok(fns.indexOf(capturePlaylistAndAutoplay) < fns.indexOf(pointAutoplayAtQueue));
});

test('capture registers itself so the page script can run it on in-app navigations', () => {
  delete g.__ttdCaptureWatch;
  capturePlaylistAndAutoplay({ contents: {} }, {});
  assert.equal(typeof g.__ttdCaptureWatch, 'function');
  g.__ttdCaptureWatch(watchResponse(ID('w')), {});
  assert.equal(g.__ttdLastWatchData.videoId, ID('w'));
  delete g.__ttdCaptureWatch;
});
