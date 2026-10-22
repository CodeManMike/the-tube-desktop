import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QueueModel, QueueState } from '../main/queue/model';

const v = (id: string) => ({ videoId: id, title: `T-${id}`, channel: `C-${id}`, thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` });
const ID = (c: string) => c.repeat(11); // valid-looking 11-char ids: 'aaaaaaaaaaa', ...
const A = ID('a'), B = ID('b'), C = ID('c'), D = ID('d'), E = ID('e');

function model(state?: QueueState) {
  let n = 0;
  return new QueueModel(state, () => `u${++n}`);
}
const ids = (m: QueueModel) => m.state().items.map((i) => i.videoId);
const currentId = (m: QueueModel) => {
  const s = m.state();
  return s.current === null ? null : s.items[s.current].videoId;
};

test('add to an empty queue while watching makes the playing video current item 0', () => {
  const m = model();
  m.add(v(B), { videoId: A, timeSec: 30 });
  assert.deepEqual(ids(m), [A, B]);
  assert.equal(currentId(m), A);
});

test('add appends; playNext inserts after current', () => {
  const m = model();
  m.add(v(B), { videoId: A, timeSec: 0 });
  m.add(v(C));
  m.playNext(v(D));
  assert.deepEqual(ids(m), [A, D, B, C]);
});

test('move keeps current on the same item', () => {
  const m = model();
  m.add(v(B), { videoId: A, timeSec: 0 });
  m.add(v(C));
  const uidA = m.state().items[0].uid;
  m.move(uidA, 2);
  assert.deepEqual(ids(m), [B, C, A]);
  assert.equal(currentId(m), A);
});

test('remove current moves current to the next item; removing the last sets null', () => {
  const m = model();
  m.add(v(B), { videoId: A, timeSec: 0 });
  m.remove(m.state().items[0].uid);
  assert.equal(currentId(m), B);
  m.remove(m.state().items[0].uid);
  assert.equal(m.state().current, null);
  assert.deepEqual(ids(m), []);
});

test('the same video queued twice: removing one copy keeps the other', () => {
  const m = model();
  m.add(v(B), { videoId: A, timeSec: 0 });
  m.add(v(B));
  const [, first, second] = m.state().items;
  m.remove(first.uid);
  assert.deepEqual(m.state().items.map((i) => i.uid), [m.state().items[0].uid, second.uid]);
  assert.deepEqual(ids(m), [A, B]);
});

test('jump navigates to the item at 0 and makes it current', () => {
  const m = model();
  m.add(v(B), { videoId: A, timeSec: 0 });
  const cmd = m.jump(m.state().items[1].uid);
  assert.deepEqual(cmd, { navigate: { videoId: B, timeSec: 0 } });
  assert.equal(currentId(m), B);
});

test('navigating to a queued item jumps (no return point)', () => {
  const m = model();
  m.add(v(B), { videoId: A, timeSec: 0 });
  m.navigated(B, { videoId: A, timeSec: 40 });
  assert.equal(currentId(m), B);
  assert.deepEqual(m.state().returnStack, []);
});

test('navigating away from the current item is a detour; when it ends, play returns to the saved time', () => {
  const m = model();
  m.add(v(B), { videoId: A, timeSec: 0 });
  m.navigated(E, { videoId: A, timeSec: 123 });
  assert.equal(m.state().detourVideoId, E);
  assert.equal(currentId(m), A);
  assert.deepEqual(m.ended(E, null), { navigate: { videoId: A, timeSec: 123 } });
  assert.deepEqual(m.state().returnStack, []);
  assert.equal(m.state().detourVideoId, null);
});

test('a detour within a detour unwinds in LIFO order', () => {
  const m = model();
  m.add(v(B), { videoId: A, timeSec: 0 });
  m.navigated(D, { videoId: A, timeSec: 60 });
  m.navigated(E, { videoId: D, timeSec: 15 });
  assert.equal(m.state().detourVideoId, E);
  assert.deepEqual(m.ended(E, null), { navigate: { videoId: D, timeSec: 15 } });
  m.navigated(D, null);
  assert.equal(m.state().detourVideoId, D);
  assert.deepEqual(m.ended(D, null), { navigate: { videoId: A, timeSec: 60 } });
});

test('the return stack is capped at 10', () => {
  const m = model();
  m.add(v(B), { videoId: A, timeSec: 0 });
  let from = A;
  for (let i = 0; i < 12; i++) {
    const next = `x${String(i).padStart(10, '0')}`;
    m.navigated(next, { videoId: from, timeSec: i });
    from = next;
  }
  assert.equal(m.state().returnStack.length, 10);
});

test('ending the current item advances to the next', () => {
  const m = model();
  m.add(v(B), { videoId: A, timeSec: 0 });
  assert.deepEqual(m.ended(A, null), { navigate: { videoId: B, timeSec: 0 } });
  assert.equal(currentId(m), B);
});

test('ending the last item with an autoplay candidate appends it visibly and plays it', () => {
  const m = model();
  m.add(v(B), { videoId: A, timeSec: 0 });
  m.jump(m.state().items[1].uid);
  assert.deepEqual(m.ended(B, v(C)), { navigate: { videoId: C, timeSec: 0 } });
  assert.deepEqual(ids(m), [A, B, C]);
  assert.equal(currentId(m), C);
});

test('ending the last item without a candidate returns null', () => {
  const m = model();
  m.add(v(B), { videoId: A, timeSec: 0 });
  m.jump(m.state().items[1].uid);
  assert.equal(m.ended(B, null), null);
});

test('replaceWithPlaylist saves the old queue; back() restores it at its position and time', () => {
  const m = model();
  m.add(v(B), { videoId: A, timeSec: 0 });
  m.replaceWithPlaylist('PLx', [v(C), v(D)], D, 77);
  assert.deepEqual(ids(m), [C, D]);
  assert.equal(currentId(m), D);
  assert.equal(m.state().sourceListId, 'PLx');
  assert.deepEqual(m.back(), { navigate: { videoId: A, timeSec: 77 } });
  assert.deepEqual(ids(m), [A, B]);
  assert.equal(currentId(m), A);
  assert.equal(m.state().sourceListId, null);
});

test('replaceWithPlaylist with the same listId again is a no-op', () => {
  const m = model();
  m.replaceWithPlaylist('PLx', [v(C), v(D)], C, 0);
  m.add(v(E));
  m.replaceWithPlaylist('PLx', [v(C), v(D)], C, 0);
  assert.deepEqual(ids(m), [C, D, E]);
  assert.deepEqual(m.state().returnStack, []);
});

test('nextVideoId prefers the detour return, then the next item', () => {
  const m = model();
  m.add(v(B), { videoId: A, timeSec: 0 });
  assert.equal(m.nextVideoId(), B);
  m.navigated(E, { videoId: A, timeSec: 5 });
  assert.equal(m.nextVideoId(), A);
});

test('state() is a deep copy', () => {
  const m = model();
  m.add(v(B), { videoId: A, timeSec: 0 });
  const s = m.state();
  const before = s.items[0].title;
  s.items[0].title = 'changed';
  s.items.pop();
  assert.equal(m.state().items.length, 2);
  assert.equal(m.state().items[0].title, before);
});

test('an autoplay candidate equal to the video that just ended is ignored (no replay loop)', () => {
  const m = model();
  m.add(v(B), { videoId: A, timeSec: 0 });
  m.jump(m.state().items[1].uid);
  assert.equal(m.ended(B, v(B)), null);
  assert.deepEqual(ids(m), [A, B]);
});

test('removing the playing item: when it ends, the new current item plays', () => {
  const m = model();
  m.add(v(B), { videoId: A, timeSec: 0 });
  m.add(v(C));
  m.remove(m.state().items[0].uid); // A is still playing on screen
  assert.deepEqual(m.ended(A, null), { navigate: { videoId: B, timeSec: 0 } });
  assert.equal(currentId(m), B);
});

test('adding while watching a detour makes it current and ends the detour', () => {
  const m = model();
  m.add(v(B), { videoId: A, timeSec: 0 });
  m.navigated(E, { videoId: A, timeSec: 10 });
  m.remove(m.state().items[0].uid);
  m.remove(m.state().items[0].uid); // queue now empty, still watching detour E
  m.add(v(C), { videoId: E, timeSec: 5 });
  assert.deepEqual(ids(m), [E, C]);
  assert.equal(m.state().detourVideoId, null);
  assert.deepEqual(m.ended(E, null), { navigate: { videoId: C, timeSec: 0 } });
});

test('jumping into the queue drops the abandoned detour\'s return points', () => {
  const m = model();
  m.add(v(B), { videoId: A, timeSec: 0 });
  m.navigated(E, { videoId: A, timeSec: 100 });
  m.jump(m.state().items[1].uid);
  assert.deepEqual(m.state().returnStack, []);
});

test('starting a playlist from the queue saves the old queue once, at the playhead', () => {
  const m = model();
  m.add(v(B), { videoId: A, timeSec: 0 });
  m.navigated(C, { videoId: A, timeSec: 42 }); // looks like a detour until the playlist data arrives
  m.replaceWithPlaylist('PLx', [v(C), v(D)], C, 7);
  assert.equal(m.state().returnStack.length, 1);
  assert.deepEqual(m.back(), { navigate: { videoId: A, timeSec: 42 } });
});


const CREATOR = { kind: 'creators' as const, creators: [{ channelId: 'UC' + 'r'.repeat(22), name: 'Rick' }] };

test('setShuffle persists in state and resets exhausted', () => {
  const m = model();
  m.setShuffle(CREATOR);
  m.markShuffleExhausted();
  assert.equal(m.state().shuffleExhausted, true);
  m.setShuffle({ kind: 'topic', query: 'lofi' });
  assert.deepEqual(m.state().shuffle, { kind: 'topic', query: 'lofi' });
  assert.equal(m.state().shuffleExhausted, false);
});

test('remainingAfterCurrent counts items after current; appendItems adds to the end', () => {
  const m = model();
  m.add(v(B), { videoId: A, timeSec: 0 });
  assert.equal(m.remainingAfterCurrent(), 1);
  m.appendItems([v(C), v(D)]);
  assert.equal(m.remainingAfterCurrent(), 3);
  assert.equal(model().remainingAfterCurrent(), 0);
});

test('a playlist replace clears shuffle; back restores the old queue with its shuffle', () => {
  const m = model();
  m.add(v(B), { videoId: A, timeSec: 0 });
  m.setShuffle(CREATOR);
  m.replaceWithPlaylist('PLx', [v(C)], C, 0);
  assert.equal(m.state().shuffle, null);
  m.back();
  assert.deepEqual(m.state().shuffle, CREATOR);
});


test('extendPlaylist replaces items and keeps current when the list still matches', () => {
  const m = model();
  m.replaceWithPlaylist('PLx', [v(B), v(C)], C, 0);
  assert.equal(m.extendPlaylist('PLx', [v(A), v(B), v(C), v(D)]), true);
  assert.deepEqual(ids(m), [A, B, C, D]);
  assert.equal(currentId(m), C);
});

test('extendPlaylist is a no-op after the queue moved on', () => {
  const m = model();
  m.replaceWithPlaylist('PLx', [v(B), v(C)], B, 0);
  m.replaceWithPlaylist('PLy', [v(D)], D, 0);
  assert.equal(m.extendPlaylist('PLx', [v(A), v(B), v(C)]), false);
  assert.deepEqual(ids(m), [D]);
});


test('adoptPlaying makes the playing video current when the queue is empty', () => {
  const m = model();
  m.adoptPlaying({ videoId: A, timeSec: 12, title: 'Now' });
  assert.deepEqual(ids(m), [A]);
  assert.equal(currentId(m), A);
  assert.equal(m.state().items[0].title, 'Now');
  m.adoptPlaying({ videoId: B, timeSec: 0 });
  assert.deepEqual(ids(m), [A]); // a non-empty queue is left alone
});
