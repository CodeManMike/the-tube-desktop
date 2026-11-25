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
  assert.deepEqual(m.ended(E), { navigate: { videoId: A, timeSec: 123 } });
  assert.deepEqual(m.state().returnStack, []);
  assert.equal(m.state().detourVideoId, null);
});

test('a detour within a detour unwinds in LIFO order', () => {
  const m = model();
  m.add(v(B), { videoId: A, timeSec: 0 });
  m.navigated(D, { videoId: A, timeSec: 60 });
  m.navigated(E, { videoId: D, timeSec: 15 });
  assert.equal(m.state().detourVideoId, E);
  assert.deepEqual(m.ended(E), { navigate: { videoId: D, timeSec: 15 } });
  m.navigated(D, null);
  assert.equal(m.state().detourVideoId, D);
  assert.deepEqual(m.ended(D), { navigate: { videoId: A, timeSec: 60 } });
});

test('a third detour keeps the original return point and queue until cleared explicitly', () => {
  const m = model();
  m.add(v(B), { videoId: A, timeSec: 0 });
  m.navigated(C, { videoId: A, timeSec: 32 });
  m.navigated(D, { videoId: C, timeSec: 18 });
  m.navigated(E, { videoId: D, timeSec: 6 });
  assert.equal(m.state().detourVideoId, D);
  assert.deepEqual(m.back(), { navigate: { videoId: C, timeSec: 18 } });
  assert.deepEqual(m.back(), { navigate: { videoId: A, timeSec: 32 } });
  assert.deepEqual(ids(m), [A, B]);
});

test('ending the current item advances to the next', () => {
  const m = model();
  m.add(v(B), { videoId: A, timeSec: 0 });
  assert.deepEqual(m.ended(A), { navigate: { videoId: B, timeSec: 0 } });
  assert.equal(currentId(m), B);
});

test('ending a short final track removes it and leaves native autoplay to YouTube', () => {
  const m = model();
  m.add(v(A));
  m.jump(m.state().items[0].uid);
  assert.equal(m.ended(A), null);
  assert.deepEqual(ids(m), []);
});

test('replaceWithPlaylist saves the old queue; back() restores it at its position and time', () => {
  const m = model();
  m.add(v(B), { videoId: A, timeSec: 0 });
  m.replaceWithPlaylist('PLx', [v(C), v(D)], D, { videoId: A, timeSec: 77 });
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
  m.replaceWithPlaylist('PLx', [v(C), v(D)], C, null);
  m.add(v(E));
  m.replaceWithPlaylist('PLx', [v(C), v(D)], C, null);
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

test('removing the playing item: when it ends, the new current item plays', () => {
  const m = model();
  m.add(v(B), { videoId: A, timeSec: 0 });
  m.add(v(C));
  m.remove(m.state().items[0].uid); // A is still playing on screen
  assert.deepEqual(m.ended(A), { navigate: { videoId: B, timeSec: 0 } });
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
  assert.deepEqual(m.ended(E), { navigate: { videoId: C, timeSec: 0 } });
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
  m.replaceWithPlaylist('PLx', [v(C), v(D)], C, { videoId: A, timeSec: 7 });
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
  m.replaceWithPlaylist('PLx', [v(C)], C, null);
  assert.equal(m.state().shuffle, null);
  m.back();
  assert.deepEqual(m.state().shuffle, CREATOR);
});


test('extendPlaylist replaces items and keeps current when the list still matches', () => {
  const m = model();
  m.replaceWithPlaylist('PLx', [v(B), v(C)], C, null);
  assert.equal(m.extendPlaylist('PLx', [v(A), v(B), v(C), v(D)]), true);
  assert.deepEqual(ids(m), [A, B, C, D]);
  assert.equal(currentId(m), C);
});

test('extendPlaylist is a no-op after the queue moved on', () => {
  const m = model();
  m.replaceWithPlaylist('PLx', [v(B), v(C)], B, null);
  m.replaceWithPlaylist('PLy', [v(D)], D, null);
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


test('extendPlaylist is dropped if the queue changed since the fetch started', () => {
  const m = model();
  m.replaceWithPlaylist('PLx', [v(B), v(C)], B, null);
  const snapshot = m.playlistSnapshot();
  m.add(v(E)); // user edits while the rest of the playlist loads
  assert.equal(m.extendPlaylist('PLx', [v(A), v(B), v(C), v(D)], snapshot), false);
  assert.deepEqual(ids(m), [B, C, E]);
});

test('extendPlaylist keeps the playhead on the right copy of a repeated video', () => {
  const m = model();
  m.replaceWithPlaylist('PLx', [v(B), v(C), v(B)], B, null);
  m.jump(m.state().items[2].uid); // the second B
  const snapshot = m.playlistSnapshot();
  assert.equal(m.extendPlaylist('PLx', [v(B), v(C), v(B), v(D)], snapshot), true);
  assert.equal(m.state().current, 2);
});

test('next keeps an unfinished video behind the other pending tracks', () => {
  const m = model(); m.add(v(A)); m.add(v(B)); m.jump(m.state().items[0].uid);
  assert.deepEqual(m.next(A), { navigate: { videoId: B, timeSec: 0 } });
  assert.deepEqual(ids(m), [B, A]);
  assert.equal(currentId(m), B);
});

test('next at the end of the queue does nothing', () => {
  const m = model(); m.add(v(A)); m.jump(m.state().items[0].uid);
  assert.equal(m.next(A), null);
});

test('previous goes to the previous item', () => {
  const m = model(); m.add(v(A)); m.add(v(B)); m.jump(m.state().items[1].uid);
  assert.deepEqual(m.previous(B), { navigate: { videoId: A, timeSec: 0 } });
  assert.equal(m.state().current, 0);
});

test('previous on the first item restarts it', () => {
  const m = model(); m.add(v(A)); m.jump(m.state().items[0].uid);
  assert.deepEqual(m.previous(A), { navigate: { videoId: A, timeSec: 0 } });
});

test('previous on a detour returns to where it started', () => {
  const m = model(); m.add(v(A)); m.jump(m.state().items[0].uid);
  m.navigated(E, { videoId: A, timeSec: 42 });
  assert.deepEqual(m.previous(E), { navigate: { videoId: A, timeSec: 42 } });
});

test('next from a video outside the queue goes to the queue item after the current one', () => {
  const m = model(); m.add(v(A)); m.add(v(B)); m.add(v(C)); m.jump(m.state().items[0].uid);
  m.navigated(E, null); // browsing: not a detour
  assert.deepEqual(m.next(E), { navigate: { videoId: B, timeSec: 0 } });
  assert.equal(m.state().current, 1);
});

test('previous from a video outside the queue goes back to the current queue item', () => {
  const m = model(); m.add(v(A)); m.add(v(B)); m.jump(m.state().items[1].uid);
  m.navigated(E, null);
  assert.deepEqual(m.previous(E), { navigate: { videoId: B, timeSec: 0 } });
  assert.equal(m.state().current, 1);
});

test('next or previous outside an empty queue does nothing', () => {
  const m = model();
  assert.equal(m.next(E), null);
  assert.equal(m.previous(E), null);
});

test('clear empties the queue, shuffle, playlist and return points', () => {
  const m = model();
  m.add(v(B), { videoId: A, timeSec: 0 });
  m.add(v(C));
  m.setShuffle({ kind: 'topic', query: 'lofi' });
  m.navigated(D, { videoId: A, timeSec: 42 }); // a detour leaves a return point
  m.clear();
  const s = m.state();
  assert.deepEqual(s.items, []);
  assert.equal(s.current, null);
  assert.equal(s.shuffle, null);
  assert.equal(s.sourceListId, null);
  assert.equal(s.detourVideoId, null);
  assert.deepEqual(s.returnStack, []);
});

test('after clear, the video that was playing ending does nothing', () => {
  const m = model();
  m.add(v(B), { videoId: A, timeSec: 0 });
  m.clear();
  assert.equal(m.ended(A), null);
  assert.deepEqual(ids(m), []);
});

test('a new queue starts normally after clear', () => {
  const m = model();
  m.add(v(B), { videoId: A, timeSec: 0 });
  m.clear();
  m.add(v(D), { videoId: C, timeSec: 0 });
  assert.deepEqual(ids(m), [C, D]);
  assert.equal(currentId(m), C);
});
test('moving the playing item to the bottom keeps the edited pending order', () => {
  const m = model();
  m.add(v(B), { videoId: A, timeSec: 0 });
  m.add(v(C));
  m.move(m.state().items[2].uid, 0);
  m.move(m.state().items[1].uid, 2);
  assert.deepEqual(ids(m), [C, B, A]);
  assert.equal(m.nextVideoId(), C);
  assert.deepEqual(m.ended(A), { navigate: { videoId: C, timeSec: 0 } });
  assert.deepEqual(ids(m), [C, B]);
  assert.deepEqual(m.next(C), { navigate: { videoId: B, timeSec: 0 } });
});

test('adding the currently playing video to an empty queue adds it once', () => {
  const m = model();
  m.add(v(A), { videoId: A, timeSec: 23 });
  assert.deepEqual(ids(m), [A]);
  assert.equal(currentId(m), A);
});

test('Next starts a pending queue built from Home', () => {
  const m = model();
  m.add(v(B));
  m.add(v(C));
  assert.equal(m.nextVideoId(), B);
  assert.deepEqual(m.next(A), { navigate: { videoId: B, timeSec: 0 } });
});

test('opening a mix from the same video restores the previous lineup and exact position', () => {
  const m = model();
  m.add(v(A), { videoId: A, timeSec: 37 });
  m.add(v(B));
  m.add(v(C));
  const original = m.state().items;
  m.navigated(A, { videoId: A, timeSec: 37 });
  m.replaceWithPlaylist('RD' + A, [v(A), v(D), v(E)], A, { videoId: A, timeSec: 37 });
  assert.deepEqual(ids(m), [A, D, E]);
  assert.deepEqual(m.back(), { navigate: { videoId: A, timeSec: 37 } });
  assert.deepEqual(m.state().items, original);
  assert.equal(m.nextVideoId(), B);
});

test('returning from nested recommendations keeps new queue picks and resumes the original video', () => {
  const m = model();
  m.add(v(A), { videoId: A, timeSec: 0 });
  m.add(v(B));
  m.navigated(D, { videoId: A, timeSec: 72 });
  m.navigated(E, { videoId: D, timeSec: 16 });
  m.add(v(C));
  assert.deepEqual(m.back(), { navigate: { videoId: D, timeSec: 16 } });
  assert.deepEqual(m.back(), { navigate: { videoId: A, timeSec: 72 } });
  assert.deepEqual(ids(m), [A, B, C]);
  assert.equal(m.nextVideoId(), B);
});

test('Previous keeps a sampled video for replay and drops one with five minutes of playback', () => {
  const m = model();
  m.add(v(A));
  m.add(v(B));
  m.add(v(C));
  const uid = m.state().items[1].uid;
  m.jump(uid);
  m.creditPlayback(uid, 120);
  m.previous(B);
  assert.deepEqual(m.ended(A), { navigate: { videoId: B, timeSec: 0 } });
  m.creditPlayback(uid, 180);
  assert.deepEqual(m.next(B), { navigate: { videoId: C, timeSec: 0 } });
  assert.deepEqual(ids(m), [C]);
});

test('a Mix opened in a nested detour restores the timestamp of the original video', () => {
  const m = model();
  m.add(v(B), { videoId: A, timeSec: 0 });
  m.navigated(C, { videoId: A, timeSec: 82 });
  m.navigated(D, { videoId: C, timeSec: 13 });
  m.replaceWithPlaylist('RD' + D, [v(D), v(E)], D, { videoId: D, timeSec: 4 });
  assert.deepEqual(m.back(), { navigate: { videoId: A, timeSec: 82 } });
  assert.deepEqual(ids(m), [A, B]);
  assert.deepEqual(m.state().returnStack, []);
});
