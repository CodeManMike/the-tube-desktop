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
