import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPageBundle } from '../main/pageBundle';
import { pipEntry, stripAutoplay } from '../pip/page';

test('stripAutoplay removes both autoplay picks and leaves the rest', () => {
  const data = {
    contents: { twoColumnWatchNextResults: { autoplay: { x: 1 }, results: { y: 2 } } },
    playerOverlays: { playerOverlayRenderer: { autoplay: { z: 3 }, endScreen: {} } },
  };
  const out = stripAutoplay(data);
  assert.equal(out.contents.twoColumnWatchNextResults.autoplay, undefined);
  assert.deepEqual(out.contents.twoColumnWatchNextResults.results, { y: 2 });
  assert.equal(out.playerOverlays.playerOverlayRenderer.autoplay, undefined);
  assert.deepEqual(out.playerOverlays.playerOverlayRenderer.endScreen, {});
});

test('stripAutoplay passes unknown shapes through', () => assert.deepEqual(stripAutoplay({ a: 1 }), { a: 1 }));

test('the pip entry serialises into a bundle that parses', () => {
  const bundle = buildPageBundle([pipEntry()]);
  assert.match(bundle, /"pip"/);
  assert.doesNotThrow(() => new Function(bundle));
});
