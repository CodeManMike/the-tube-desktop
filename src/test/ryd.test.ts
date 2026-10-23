import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RydClient } from '../main/ryd';
import { compactCount } from '../plugins/ryd';

const RICK = 'dQw4w9WgXcQ';
const REPLY = { id: RICK, likes: 19492749, rawDislikes: 6699, rawLikes: 130084, dislikes: 521581, rating: 4.89, viewCount: 1829666086, deleted: false };

test('votes parses the API reply', async () => {
  const urls: string[] = [];
  const c = new RydClient(async (u) => (urls.push(u), REPLY));
  assert.deepEqual(await c.votes(RICK), { likes: 19492749, dislikes: 521581 });
  assert.equal(urls[0], `https://returnyoutubedislikeapi.com/votes?videoId=${RICK}`);
});

test('rejects a reply for another id or non-numbers', async () => {
  assert.equal(await new RydClient(async () => ({ ...REPLY, id: 'otherVideo1' })).votes(RICK), null);
  assert.equal(await new RydClient(async () => ({ ...REPLY, dislikes: 'lots' })).votes(RICK), null);
});

test('a failed lookup returns null and is cached for 2 minutes', async () => {
  let now = 0, calls = 0;
  const c = new RydClient(async () => { calls++; throw new Error('offline'); }, () => now);
  assert.equal(await c.votes(RICK), null);
  now = 119_000; await c.votes(RICK);
  assert.equal(calls, 1);
  now = 120_001; await c.votes(RICK);
  assert.equal(calls, 2);
});

test('cached for 10 minutes', async () => {
  let now = 0, calls = 0;
  const c = new RydClient(async () => (calls++, REPLY), () => now);
  await c.votes(RICK); now = 599_000; await c.votes(RICK);
  assert.equal(calls, 1);
  now = 600_001; await c.votes(RICK);
  assert.equal(calls, 2);
});

test("compactCount formats like YouTube's like count", () => {
  assert.equal(compactCount(521581), '521K');
  assert.equal(compactCount(19492749), '19M');
  assert.equal(compactCount(1650), '1.6K');
  assert.equal(compactCount(1234567), '1.2M');
  assert.equal(compactCount(999), '999');
  assert.equal(compactCount(12000), '12K');
});
