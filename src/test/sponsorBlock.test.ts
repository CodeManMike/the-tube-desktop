import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPrefix, parseSegments, segmentsUrl, SponsorBlockClient } from '../main/skip/sponsorBlock';

const RICK = 'dQw4w9WgXcQ';
const seg = (extra: object) => ({ category: 'sponsor', actionType: 'skip', segment: [10, 20], UUID: 'u1', videoDuration: 100, ...extra });
const BUCKET = [
  { videoID: 'otherVideo1', segments: [seg({ UUID: 'x' })] },
  { videoID: RICK, segments: [seg({ UUID: 'b', segment: [50, 60] }), seg({ UUID: 'a', category: 'intro', segment: [0, 6.532] })] },
];

test('hashPrefix is the first 4 hex of the sha256', () => assert.equal(hashPrefix(RICK), '5f6b'));

test('segmentsUrl asks for every category, skip actions only', () => {
  const url = segmentsUrl('5f6b');
  assert.match(url, /^https:\/\/sponsor\.ajay\.app\/api\/skipSegments\/5f6b\?/);
  const q = new URL(url).searchParams;
  assert.deepEqual(JSON.parse(q.get('categories')!), ['sponsor', 'selfpromo', 'interaction', 'intro', 'outro', 'preview', 'filler', 'music_offtopic']);
  assert.deepEqual(JSON.parse(q.get('actionTypes')!), ['skip']);
});

test('parseSegments keeps only the asked-for video, sorted by start', () => {
  assert.deepEqual(parseSegments(BUCKET, RICK), [
    { uuid: 'a', category: 'intro', start: 0, end: 6.532 },
    { uuid: 'b', category: 'sponsor', start: 50, end: 60 },
  ]);
});

test('parseSegments drops anything malformed or unasked-for', () => {
  const bad = [{ videoID: RICK, segments: [
    seg({ actionType: 'mute' }), seg({ category: 'chapter' }), seg({ segment: [20, 10] }), seg({ segment: [NaN, 5] }),
    seg({ UUID: 'u'.repeat(200) }), seg({ segment: [-1, 5] }), seg({ UUID: 'ok' }),
  ] }];
  assert.deepEqual(parseSegments(bad, RICK).map((s) => s.uuid), ['ok']);
  assert.deepEqual(parseSegments('nope', RICK), []);
  assert.deepEqual(parseSegments([{ videoID: RICK, segments: 'x' }], RICK), []);
});

test('segments() caches a result for an hour', async () => {
  let now = 0, calls = 0;
  const client = new SponsorBlockClient(async () => { calls++; return BUCKET; }, () => now);
  assert.equal((await client.segments(RICK)).length, 2);
  await client.segments(RICK);
  assert.equal(calls, 1);
  now = 3_600_001;
  await client.segments(RICK);
  assert.equal(calls, 2);
});

test('a failed lookup caches an empty list for 2 minutes', async () => {
  let now = 0, calls = 0;
  const client = new SponsorBlockClient(async () => { calls++; throw new Error('offline'); }, () => now);
  assert.deepEqual(await client.segments(RICK), []);
  now = 119_000;
  await client.segments(RICK);
  assert.equal(calls, 1);
  now = 120_001;
  await client.segments(RICK);
  assert.equal(calls, 2);
});

test('concurrent lookups share one request', async () => {
  let calls = 0;
  const client = new SponsorBlockClient(async () => { calls++; return BUCKET; });
  const [a, b] = await Promise.all([client.segments(RICK), client.segments(RICK)]);
  assert.equal(calls, 1);
  assert.deepEqual(a, b);
});
