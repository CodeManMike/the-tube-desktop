import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripAds } from '../plugins/skip/stripAds';

test('stripAds removes the four ad fields and keeps the rest', () => {
  const data = {
    playerAds: [{ playerLegacyDesktopWatchAdsRenderer: {} }],
    adPlacements: [{ adPlacementRenderer: {} }],
    adSlots: [{}],
    adBreakHeartbeatParams: 'Q0FB',
    streamingData: { formats: [1] },
    videoDetails: { videoId: 'x' },
  };
  assert.deepEqual(stripAds(data), { streamingData: { formats: [1] }, videoDetails: { videoId: 'x' } });
});

test('stripAds passes unknown shapes through', () => {
  assert.deepEqual(stripAds({ a: 1 }), { a: 1 });
  assert.equal(stripAds(null), null);
});

test('stripAds leaves the data alone when ad skipping is off', () => {
  assert.deepEqual(stripAds({ adPlacements: [1] }, { mode: 'off' }), { adPlacements: [1] });
});
