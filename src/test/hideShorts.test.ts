import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hideShorts } from '../plugins/hideShorts';

const video = (id: string) => ({ videoRenderer: { videoId: id } });

test('search results keep their videos when a Shorts shelf sits beside them', () => {
  const data = {
    contents: { sectionListRenderer: { contents: [
      { itemSectionRenderer: { contents: [video('a'), { reelShelfRenderer: { items: [] } }, video('b')] } },
    ] } },
  };
  const out = hideShorts.transforms!.browse!(data, {});
  const items = out.contents.sectionListRenderer.contents[0].itemSectionRenderer.contents;
  assert.deepEqual(items, [video('a'), video('b')]);
});

test('home Shorts shelf is removed, videos stay', () => {
  const shelf = { richSectionRenderer: { content: { richShelfRenderer: { isShorts: true, contents: [] } } } };
  const item = { richItemRenderer: { content: video('c') } };
  const out = hideShorts.transforms!.browse!({ contents: [item, shelf] }, {});
  assert.deepEqual(out.contents, [item]);
});

test('a shelf made only of Shorts lockups is removed even without isShorts', () => {
  const short = { richItemRenderer: { content: { shortsLockupViewModel: {} } } };
  const shelf = { richSectionRenderer: { content: { richShelfRenderer: { contents: [short, short] } } } };
  const item = { richItemRenderer: { content: video('d') } };
  const out = hideShorts.transforms!.browse!({ contents: [shelf, item] }, {});
  assert.deepEqual(out.contents, [item]);
});

test('watch-page sidebar section keeps its videos', () => {
  const data = { secondaryResults: { results: [
    { itemSectionRenderer: { contents: [video('e'), { reelShelfRenderer: {} }, video('f')] } },
  ] } };
  const out = hideShorts.transforms!.browse!(data, {});
  assert.deepEqual(out.secondaryResults.results[0].itemSectionRenderer.contents, [video('e'), video('f')]);
});

test('the plugin manifest is valid', () => {
  const { manifest, transforms } = hideShorts;
  assert.equal(manifest.id, 'hideShorts');
  assert.equal(manifest.defaultEnabled, true);
  const fns = ['browse', 'next', 'search', 'initialData'].map((e) => transforms![e as 'browse']);
  assert.ok(fns.every((f) => typeof f === 'function' && f === fns[0]));
});
