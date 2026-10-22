import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QueueModel } from '../main/queue/model';
import { ShuffleRunner } from '../main/queue/shuffleRunner';
import { Candidate } from '../main/queue/shuffle';

const id = (n: number) => `v${String(n).padStart(10, '0')}`;
const cand = (n: number, extra: Partial<Candidate> = {}): Candidate => ({ videoId: id(n), title: `T${n}`, channel: '', thumbnail: 'https://i.ytimg.com/x.jpg', ...extra });
const plain = (c: Candidate) => ({ videoId: c.videoId, title: c.title, channel: c.channel, thumbnail: c.thumbnail });
const RICK = { channelId: 'UC' + 'r'.repeat(22), name: 'Rick' };
const BEN = { channelId: 'UC' + 'b'.repeat(22), name: 'Ben' };
type Page = { items: Candidate[]; continuation: string | null };

// A fake InnerTube: pages keyed by browseId / query / continuation token.
function fakeRequest(pages: Record<string, Page>) {
  const calls: string[] = [];
  const request = async (_endpoint: 'browse' | 'search', body: any): Promise<Page> => {
    const key = body.continuation ?? body.browseId ?? body.query;
    calls.push(key);
    const page = pages[key];
    if (!page) throw new Error(`no page ${key}`);
    return page;
  };
  return { request, calls };
}

function shuffling(source: Parameters<QueueModel['setShuffle']>[0]) {
  let n = 0;
  const m = new QueueModel(undefined, () => `u${++n}`);
  m.setShuffle(source);
  return m;
}
const ids = (m: QueueModel) => m.state().items.map((i) => i.videoId);

test('does nothing when 3 or more items remain after current', async () => {
  const m = shuffling({ kind: 'topic', query: 'lofi' });
  m.appendItems([cand(1), cand(2), cand(3), cand(4)].map(plain));
  m.jump(m.state().items[0].uid);
  const { request, calls } = fakeRequest({});
  assert.equal(await new ShuffleRunner(request, () => false, () => 0).refill(m, 10), false);
  assert.equal(calls.length, 0);
});

test('adds a batch of unwatched, unqueued videos and fills in the creator name', async () => {
  const m = shuffling({ kind: 'creators', creators: [RICK] });
  const { request } = fakeRequest({ ['VLUU' + RICK.channelId.slice(2)]: { items: [cand(1), cand(2, { watchedPercent: 95 }), cand(3)], continuation: null } });
  const runner = new ShuffleRunner(request, (c) => (c.watchedPercent ?? 0) >= 80, () => 0);
  assert.equal(await runner.refill(m, 10), true);
  assert.deepEqual([...ids(m)].sort(), [id(1), id(3)]);
  assert.equal(m.state().items[0].channel, 'Rick');
});

test('combines several creators into one pool', async () => {
  const m = shuffling({ kind: 'creators', creators: [RICK, BEN] });
  const { request, calls } = fakeRequest({
    ['VLUU' + RICK.channelId.slice(2)]: { items: [cand(1)], continuation: null },
    ['VLUU' + BEN.channelId.slice(2)]: { items: [cand(2)], continuation: null },
  });
  await new ShuffleRunner(request, () => false, () => 0).refill(m, 10);
  assert.deepEqual([...ids(m)].sort(), [id(1), id(2)]);
  assert.equal(calls.length, 2);
});

test('follows continuations until enough eligible items exist, at most 5 pages', async () => {
  const m = shuffling({ kind: 'topic', query: 'lofi' });
  const pages: Record<string, Page> = { lofi: { items: [cand(0)], continuation: 'c1' } };
  for (let p = 1; p < 10; p++) pages[`c${p}`] = { items: [cand(p)], continuation: `c${p + 1}` };
  const { request, calls } = fakeRequest(pages);
  await new ShuffleRunner(request, () => false, () => 0).refill(m, 10);
  assert.equal(calls.length, 5);
  assert.equal(ids(m).length, 5);
});

test('already-queued videos are never added again', async () => {
  const m = shuffling({ kind: 'topic', query: 'lofi' });
  m.appendItems([plain(cand(1))]);
  const { request } = fakeRequest({ lofi: { items: [cand(1), cand(2)], continuation: null } });
  await new ShuffleRunner(request, () => false, () => 0).refill(m, 10);
  assert.deepEqual(ids(m), [id(1), id(2)]);
});

test('marks the source exhausted when nothing eligible remains, then stops requesting', async () => {
  const m = shuffling({ kind: 'topic', query: 'tiny' });
  const { request, calls } = fakeRequest({ tiny: { items: [cand(1, { watchedPercent: 100 })], continuation: null } });
  const runner = new ShuffleRunner(request, (c) => (c.watchedPercent ?? 0) >= 80, () => 0);
  assert.equal(await runner.refill(m, 10), false);
  assert.equal(m.state().shuffleExhausted, true);
  const before = calls.length;
  assert.equal(await runner.refill(m, 10), false);
  assert.equal(calls.length, before);
});

test('a concurrent refill returns false without requesting', async () => {
  const m = shuffling({ kind: 'topic', query: 'slow' });
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let calls = 0;
  const request = async (): Promise<Page> => {
    calls++;
    await gate;
    return { items: [cand(1)], continuation: null };
  };
  const runner = new ShuffleRunner(request, () => false, () => 0);
  const first = runner.refill(m, 10);
  assert.equal(await runner.refill(m, 10), false);
  release();
  assert.equal(await first, true);
  assert.equal(calls, 1);
});

test('a failed fetch leaves the queue as it was and does not mark the source exhausted', async () => {
  const m = shuffling({ kind: 'topic', query: 'broken' });
  const runner = new ShuffleRunner(async () => {
    throw new Error('offline');
  }, () => false, () => 0);
  assert.equal(await runner.refill(m, 10), false);
  assert.deepEqual(ids(m), []);
  assert.equal(m.state().shuffleExhausted, false);
});


test('a forced refill adds a batch even when plenty remain', async () => {
  const m = shuffling({ kind: 'topic', query: 'lofi' });
  m.appendItems([cand(1), cand(2), cand(3), cand(4)].map(plain));
  m.jump(m.state().items[0].uid);
  const { request } = fakeRequest({ lofi: { items: [cand(5), cand(6)], continuation: null } });
  assert.equal(await new ShuffleRunner(request, () => false, () => 0).refill(m, 10, { force: true }), true);
  assert.equal(ids(m).length, 6);
});
