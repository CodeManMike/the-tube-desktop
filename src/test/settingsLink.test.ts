import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settingsLink } from '../plugins/settingsLink';
import { Transform } from '../shared/plugin';

const guide = settingsLink.transforms!.guide as Transform;

const entry = (title: string) => ({ guideEntryRenderer: { formattedTitle: { simpleText: title } } });
const section = (...titles: string[]) => ({ guideSectionRenderer: { items: titles.map(entry) } });
const titles = (s: any) => s.guideSectionRenderer.items.map((i: any) => i.guideEntryRenderer.formattedTitle.simpleText);

// The shape of YouTube's /youtubei/v1/guide response (October 2026, signed in).
const sample = () => ({
  items: [
    section('Home', 'Shorts'),
    { guideSubscriptionsSectionRenderer: { items: [entry('A channel')] } },
    section('Music', 'Gaming'),
    section('YouTube Music', 'YouTube Kids'),
    section('Report history'),
  ],
});

test('adds TTD settings at the top of the last section', () => {
  const out = guide(sample(), {}, { endpoint: 'guide' });
  assert.deepEqual(titles(out.items[4]), ['TTD settings', 'Report history']);
  const added = out.items[4].guideSectionRenderer.items[0].guideEntryRenderer;
  assert.equal(added.navigationEndpoint.commandMetadata.webCommandMetadata.url, '/ttd-settings');
  assert.equal(added.icon.iconType, 'SETTINGS');
});

test('leaves the other sections alone', () => {
  const out = guide(sample(), {}, { endpoint: 'guide' });
  assert.deepEqual(titles(out.items[0]), ['Home', 'Shorts']);
  assert.deepEqual(titles(out.items[3]), ['YouTube Music', 'YouTube Kids']);
});

test('adds the entry only once, even if the same data is rewritten twice', () => {
  const once = guide(sample(), {}, { endpoint: 'guide' });
  const twice = guide(once, {}, { endpoint: 'guide' });
  assert.deepEqual(titles(twice.items[4]), ['TTD settings', 'Report history']);
});

test('skips the subscriptions section when it comes last', () => {
  const data = { items: [section('Home'), { guideSubscriptionsSectionRenderer: { items: [entry('A channel')] } }] };
  const out = guide(data, {}, { endpoint: 'guide' });
  assert.deepEqual(titles(out.items[0]), ['TTD settings', 'Home']);
});

test('unexpected data passes through untouched', () => {
  for (const data of [null, {}, { items: 'x' }, { items: [] }, { items: [{ somethingElse: {} }] }]) {
    assert.deepEqual(guide(structuredClone(data), {}, { endpoint: 'guide' }), data);
  }
});
