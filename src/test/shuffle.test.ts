import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWatched, pickBatch } from '../main/queue/shuffle';

const ID = (c: string) => c.repeat(11);
const item = (id: string) => ({ videoId: id, title: 't', channel: 'c', thumbnail: 'https://i.ytimg.com/x.jpg' });
const history = (entries: Record<string, { watchedSec: number; durationSec: number }>) => ({ get: (id: string) => entries[id] });

test('watched by YouTube marker at or above the threshold', () => {
  assert.equal(isWatched({ videoId: ID('a'), watchedPercent: 80 }, history({}), 80), true);
  assert.equal(isWatched({ videoId: ID('a'), watchedPercent: 79 }, history({}), 80), false);
});

test('watched by local history ratio at or above the threshold', () => {
  assert.equal(isWatched({ videoId: ID('a') }, history({ [ID('a')]: { watchedSec: 90, durationSec: 100 } }), 80), true);
  assert.equal(isWatched({ videoId: ID('a') }, history({ [ID('a')]: { watchedSec: 50, durationSec: 100 } }), 80), false);
});

test('unknown duration in history counts as not watched', () => {
  assert.equal(isWatched({ videoId: ID('a') }, history({ [ID('a')]: { watchedSec: 500, durationSec: 0 } }), 80), false);
});

test('pickBatch never returns excluded or duplicate ids', () => {
  const pool = [item(ID('a')), item(ID('b')), item(ID('a')), item(ID('c')), item(ID('d'))];
  const out = pickBatch(pool, new Set([ID('b')]), 10, () => 0.5);
  const ids = out.map((i) => i.videoId);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.includes(ID('b')), false);
  assert.deepEqual([...ids].sort(), [ID('a'), ID('c'), ID('d')]);
});

test('pickBatch returns at most n', () => {
  const pool = 'abcdefgh'.split('').map((c) => item(ID(c)));
  assert.equal(pickBatch(pool, new Set(), 3, Math.random).length, 3);
});

test('pickBatch is deterministic for a seeded random and strips watchedPercent', () => {
  const seeded = () => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };
  const pool = 'abcdef'.split('').map((c) => ({ ...item(ID(c)), watchedPercent: 10 }));
  const a = pickBatch(pool, new Set(), 4, seeded());
  const b = pickBatch(pool, new Set(), 4, seeded());
  assert.deepEqual(a, b);
  assert.equal('watchedPercent' in a[0], false);
});
