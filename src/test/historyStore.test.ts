import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { HistoryStore } from '../main/history/historyStore';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ttd-history-')), 'history.json');

test('watchedSec only grows', () => {
  const h = new HistoryStore(tmp(), () => 1000);
  h.record({ videoId: 'aaaaaaaaaaa', title: 'A', channel: 'C', durationSec: 300, timeSec: 120 });
  h.record({ videoId: 'aaaaaaaaaaa', timeSec: 30 });
  assert.equal(h.get('aaaaaaaaaaa')!.watchedSec, 120);
  assert.equal(h.get('aaaaaaaaaaa')!.title, 'A');
});

test('persists across instances after flush', () => {
  const file = tmp();
  const h = new HistoryStore(file, () => 5);
  h.record({ videoId: 'aaaaaaaaaaa', title: 'A', channel: 'C', durationSec: 300, timeSec: 10 });
  assert.equal(h.flush(), true);
  assert.deepEqual(new HistoryStore(file).get('aaaaaaaaaaa'), {
    videoId: 'aaaaaaaaaaa', title: 'A', channel: 'C', durationSec: 300, watchedSec: 10, lastWatched: 5,
  });
});

test('evicts the least recently watched past the cap', () => {
  let now = 0;
  const h = new HistoryStore(tmp(), () => ++now, 3);
  for (const id of ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc']) h.record({ videoId: id, timeSec: 1 });
  h.record({ videoId: 'aaaaaaaaaaa', timeSec: 2 }); // a is now most recent
  h.record({ videoId: 'ddddddddddd', timeSec: 1 });
  assert.equal(h.get('bbbbbbbbbbb'), undefined);
  assert.ok(h.get('aaaaaaaaaaa') && h.get('ccccccccccc') && h.get('ddddddddddd'));
});

test('corrupt history file starts empty', () => {
  const file = tmp();
  fs.writeFileSync(file, 'nope');
  assert.equal(new HistoryStore(file).get('aaaaaaaaaaa'), undefined);
});
