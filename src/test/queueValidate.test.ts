import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEvent } from '../main/queue/validate';

const A = 'aaaaaaaaaaa';
const item = (over: object = {}) => ({ videoId: A, title: 'T', channel: 'C', thumbnail: 'https://i.ytimg.com/vi/a/mqdefault.jpg', ...over });

test('rejects a bad videoId and unknown types', () => {
  assert.equal(validateEvent({ type: 'ended', videoId: 'nope' }), null);
  assert.equal(validateEvent({ type: 'explode', videoId: A }), null);
  assert.equal(validateEvent(null), null);
  assert.equal(validateEvent('ended'), null);
});

test('caps title length and defaults a non-https thumbnail', () => {
  const ev = validateEvent({ type: 'watchData', videoId: A, listParam: null, playlist: null, autoplay: item({ title: 'x'.repeat(500), thumbnail: 'http://evil/x.jpg' }) });
  assert.ok(ev && ev.type === 'watchData' && ev.autoplay);
  assert.equal(ev.autoplay.title.length, 200);
  assert.equal(ev.autoplay.thumbnail, `https://i.ytimg.com/vi/${A}/mqdefault.jpg`);
});

test('truncates playlists to 500 items and drops invalid ones', () => {
  const items = [...Array.from({ length: 600 }, () => item()), item({ videoId: 'bad' })];
  const ev = validateEvent({ type: 'watchData', videoId: A, listParam: 'PLx', playlist: { playlistId: 'PLx', items }, autoplay: null });
  assert.ok(ev && ev.type === 'watchData' && ev.playlist);
  assert.equal(ev.playlist.items.length, 500);
});

test('accepts each valid event shape', () => {
  assert.deepEqual(validateEvent({ type: 'navigated', videoId: A, from: { videoId: A, timeSec: 3, title: 'T' } }), {
    type: 'navigated', videoId: A, from: { videoId: A, timeSec: 3, title: 'T' },
  });
  assert.deepEqual(validateEvent({ type: 'navigated', videoId: A, from: null }), { type: 'navigated', videoId: A, from: null });
  assert.deepEqual(validateEvent({ type: 'ended', videoId: A }), { type: 'ended', videoId: A });
  assert.deepEqual(validateEvent({ type: 'progress', videoId: A, timeSec: 10, durationSec: 200, title: 'T', channel: 'C' }), {
    type: 'progress', videoId: A, timeSec: 10, durationSec: 200, title: 'T', channel: 'C',
  });
  assert.deepEqual(validateEvent({ type: 'action', action: 'remove', uid: 'u1' }), { type: 'action', action: 'remove', uid: 'u1' });
  assert.deepEqual(validateEvent({ type: 'action', action: 'back' }), { type: 'action', action: 'back' });
  assert.deepEqual(validateEvent({ type: 'move', uid: 'u1', toIndex: 2 }), { type: 'move', uid: 'u1', toIndex: 2 });
});

test('rejects bad actions, negative indexes and non-finite times', () => {
  assert.equal(validateEvent({ type: 'action', action: 'deleteEverything' }), null);
  assert.equal(validateEvent({ type: 'move', uid: 'u1', toIndex: -1 }), null);
  assert.equal(validateEvent({ type: 'progress', videoId: A, timeSec: Infinity, durationSec: 1 }), null);
});

test('thumbnails are only accepted from YouTube image hosts', () => {
  const ev = (thumbnail: string) => validateEvent({ type: 'watchData', videoId: A, listParam: null, playlist: null, autoplay: item({ thumbnail }) });
  const thumb = (t: string) => { const e = ev(t); return e && e.type === 'watchData' ? e.autoplay!.thumbnail : null; };
  assert.equal(thumb('https://i.ytimg.com/vi/x/hqdefault.jpg'), 'https://i.ytimg.com/vi/x/hqdefault.jpg');
  assert.equal(thumb('https://yt3.ggpht.com/abc'), 'https://yt3.ggpht.com/abc');
  assert.equal(thumb('https://tracker.example.com/pixel.gif'), `https://i.ytimg.com/vi/${A}/mqdefault.jpg`);
  assert.equal(thumb('https://i.ytimg.com.evil.com/x.jpg'), `https://i.ytimg.com/vi/${A}/mqdefault.jpg`);
});


test('accepts a fetched page; truncates to 200; drops bad items; rejects a long token', () => {
  const items = [...Array.from({ length: 250 }, () => item({ watchedPercent: 50 })), item({ videoId: 'bad' })];
  const ev = validateEvent({ type: 'fetched', requestId: 'r1', ok: true, items, continuation: 'tok' });
  assert.ok(ev && ev.type === 'fetched');
  assert.equal(ev.items.length, 200);
  assert.equal(ev.items[0].watchedPercent, 50);
  assert.equal(validateEvent({ type: 'fetched', requestId: 'r1', ok: true, items: [], continuation: 'x'.repeat(5000) }), null);
  const odd = validateEvent({ type: 'fetched', requestId: 'r1', ok: true, items: [item({ watchedPercent: 500 })], continuation: null });
  assert.ok(odd && odd.type === 'fetched' && !('watchedPercent' in odd.items[0]));
});

test('accepts shuffle actions; rejects a bad channelId or an over-long query', () => {
  const ch = 'UC' + 'r'.repeat(22);
  assert.deepEqual(validateEvent({ type: 'shuffle', action: 'creator', channelId: ch, name: 'Rick' }), { type: 'shuffle', action: 'creator', channelId: ch, name: 'Rick' });
  assert.deepEqual(validateEvent({ type: 'shuffle', action: 'topic', query: 'lofi' }), { type: 'shuffle', action: 'topic', query: 'lofi' });
  assert.deepEqual(validateEvent({ type: 'shuffle', action: 'stop' }), { type: 'shuffle', action: 'stop' });
  assert.equal(validateEvent({ type: 'shuffle', action: 'creator', channelId: 'nope', name: 'x' }), null);
  assert.equal(validateEvent({ type: 'shuffle', action: 'topic', query: 'x'.repeat(201) }), null);
  assert.equal(validateEvent({ type: 'shuffle', action: 'topic', query: '   ' }), null);
});

test('watchData carries the creator and playlist size when valid', () => {
  const ev = validateEvent({ type: 'watchData', videoId: A, listParam: null, playlist: null, autoplay: null,
    owner: { channelId: 'UC' + 'r'.repeat(22), name: 'Rick' }, playlistMeta: { totalVideos: 76, isInfinite: false } });
  assert.ok(ev && ev.type === 'watchData');
  assert.deepEqual(ev.owner, { channelId: 'UC' + 'r'.repeat(22), name: 'Rick' });
  assert.deepEqual(ev.playlistMeta, { totalVideos: 76, isInfinite: false });
  const bad = validateEvent({ type: 'watchData', videoId: A, listParam: null, playlist: null, autoplay: null, owner: { channelId: 'x', name: 'y' }, playlistMeta: 'z' });
  assert.ok(bad && bad.type === 'watchData' && bad.owner === null && bad.playlistMeta === null);
});
