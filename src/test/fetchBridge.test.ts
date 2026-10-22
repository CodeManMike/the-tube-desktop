import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FetchBridge } from '../main/queue/fetchBridge';

const item = { videoId: 'aaaaaaaaaaa', title: 't', channel: 'c', thumbnail: 'https://i.ytimg.com/x.jpg' };

test('resolves the matching request', async () => {
  const sent: any[] = [];
  const bridge = new FetchBridge((req) => sent.push(req));
  const pending = bridge.request('browse', { browseId: 'VLUUx' });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].body, { browseId: 'VLUUx' });
  bridge.resolve({ type: 'fetched', requestId: sent[0].requestId, ok: true, items: [item], continuation: 'tok' });
  assert.deepEqual(await pending, { items: [item], continuation: 'tok' });
});

test('a failed page rejects the request', async () => {
  const sent: any[] = [];
  const bridge = new FetchBridge((req) => sent.push(req));
  const pending = bridge.request('search', { query: 'x' });
  bridge.resolve({ type: 'fetched', requestId: sent[0].requestId, ok: false, items: [], continuation: null });
  await assert.rejects(pending, /page fetch failed/);
});

test('ignores an unknown requestId', () => {
  const bridge = new FetchBridge(() => {});
  assert.doesNotThrow(() => bridge.resolve({ type: 'fetched', requestId: 'r999', ok: true, items: [], continuation: null }));
});

test('times out', async () => {
  const bridge = new FetchBridge(() => {}, 20);
  await assert.rejects(bridge.request('browse', {}), /timed out/);
});
