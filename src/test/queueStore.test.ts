import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { QueueStore } from '../main/queue/queueStore';
import { QueueState } from '../main/queue/model';
import { writeFileAtomic } from '../main/atomicFile';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ttd-queue-')), 'queue.json');
const item = (uid: string, videoId: string) => ({ uid, videoId, title: 't', channel: 'c', thumbnail: 'https://i.ytimg.com/x.jpg' });
const STATE: QueueState = {
  items: [item('u1', 'aaaaaaaaaaa'), item('u2', 'bbbbbbbbbbb')],
  current: 1,
  returnStack: [{ kind: 'video', videoId: 'ccccccccccc', timeSec: 42 }],
  detourVideoId: 'ddddddddddd',
  sourceListId: 'PLx',
  shuffle: { kind: 'creators', creators: [{ channelId: 'UC' + 'r'.repeat(22), name: 'Rick' }] },
  shuffleExhausted: false,
};

test('round-trips state, including the return stack', () => {
  const file = tmp();
  assert.equal(new QueueStore(file).save(STATE), true);
  assert.deepEqual(new QueueStore(file).load(), STATE);
});

test('missing file loads an empty queue', () => {
  assert.deepEqual(new QueueStore(tmp()).load().items, []);
});

test('corrupt file gives an empty state and keeps a .bad copy', () => {
  const file = tmp();
  fs.writeFileSync(file, '{oops');
  const s = new QueueStore(file).load();
  assert.deepEqual(s, { items: [], current: null, returnStack: [], detourVideoId: null, sourceListId: null, shuffle: null, shuffleExhausted: false });
  assert.equal(fs.readFileSync(`${file}.bad`, 'utf8'), '{oops');
});

test('drops items with invalid ids and clamps current', () => {
  const file = tmp();
  fs.writeFileSync(file, JSON.stringify({ ...STATE, items: [item('u1', 'bad'), item('u2', 'bbbbbbbbbbb')], current: 5 }));
  const s = new QueueStore(file).load();
  assert.deepEqual(s.items.map((i) => i.uid), ['u2']);
  assert.equal(s.current, null);
});

test('caps the return stack at 10', () => {
  const file = tmp();
  const stack = Array.from({ length: 14 }, (_, i) => ({ kind: 'video', videoId: 'ccccccccccc', timeSec: i }));
  fs.writeFileSync(file, JSON.stringify({ ...STATE, returnStack: stack }));
  const s = new QueueStore(file).load();
  assert.equal(s.returnStack.length, 10);
  assert.equal((s.returnStack[9] as { timeSec: number }).timeSec, 13);
});

test('writeFileAtomic logs a failed write instead of throwing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttd-atomic-'));
  const target = path.join(dir, 'x.json');
  fs.mkdirSync(target);
  assert.equal(writeFileAtomic(target, '{}'), false);
});

test('round-trips a topic source; an invalid shuffle source loads as null', () => {
  const file = tmp();
  new QueueStore(file).save({ ...STATE, shuffle: { kind: 'topic', query: 'lofi' } });
  assert.deepEqual(new QueueStore(file).load().shuffle, { kind: 'topic', query: 'lofi' });
  fs.writeFileSync(file, JSON.stringify({ ...STATE, shuffle: { kind: 'creators', creators: [{ channelId: 'nope', name: 'x' }] } }));
  assert.equal(new QueueStore(file).load().shuffle, null);
  fs.writeFileSync(file, JSON.stringify({ ...STATE, shuffle: { kind: 'topic', query: 'x'.repeat(500) } }));
  assert.equal(new QueueStore(file).load().shuffle, null);
});
