import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { HistoryStore } from '../main/history/historyStore';
import { QueueModel } from '../main/queue/model';
import { QueueService } from '../main/queue/queueService';
import { QueueStore } from '../main/queue/queueStore';

const A = 'aaaaaaaaaaa', B = 'bbbbbbbbbbb', C = 'ccccccccccc';
const item = (videoId: string) => ({ videoId, title: `T-${videoId}`, channel: 'c', thumbnail: 'https://i.ytimg.com/x.jpg' });

// A WebContents stand-in that records what it was sent.
function fakeWc(url: string) {
  const sent: { channel: string; payload: any }[] = [];
  return { sent, url, send: (channel: string, payload: any) => sent.push({ channel, payload }), isDestroyed: () => false, getURL() { return this.url; } };
}

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttd-service-'));
  let n = 0;
  const model = new QueueModel(undefined, () => `u${++n}`);
  model.add(item(A)); model.add(item(B));
  model.jump(model.state().items[0].uid);
  const service = new QueueService(model, new QueueStore(path.join(dir, 'queue.json')), new HistoryStore(path.join(dir, 'history.json')), async () => ({}));
  const main = fakeWc(`https://www.youtube.com/watch?v=${A}`);
  (service as any).wc = main; // attach() also registers IPC; tests only need the target
  const pipWc = fakeWc(`https://www.youtube.com/watch?v=${A}`);
  const pipCommands: any[] = [];
  return { model, service, main, pipWc, pipCommands, player: { webContents: pipWc as any, navigate: (cmd: any) => pipCommands.push(cmd) } };
}
const lastState = (wc: ReturnType<typeof fakeWc>) => [...wc.sent].reverse().find((s) => s.channel === 'queue:state')?.payload;

test('while PiP is the player, commands go to PiP and state still goes to main', () => {
  const { service, main, pipCommands, player } = setup();
  service.setPlayer(player);
  service.handlePip({ type: 'ended', videoId: A });
  assert.deepEqual(pipCommands, [{ navigate: { videoId: B, timeSec: 0 } }]);
  assert.equal(lastState(main).command, null);
  assert.equal(lastState(main).state.current, 1);
});

test('PiP events outside its allowed set are dropped', () => {
  const { service, model, player } = setup();
  service.setPlayer(player);
  service.handlePip({ type: 'action', action: 'remove', uid: 'u1' });
  assert.equal(model.state().items.length, 2);
});

test('main playback while PiP is the player calls onTakeover', () => {
  for (const ev of [
    { type: 'progress', videoId: C, timeSec: 3, durationSec: 100 } as const,
    { type: 'navigated', videoId: C, from: null } as const,
  ]) {
    const { service, player, pipCommands } = setup();
    let takeovers = 0;
    service.setPlayer(player, () => takeovers++);
    service.handle(ev);
    assert.equal(takeovers, 1);
    service.handlePip({ type: 'ended', videoId: A }); // PiP no longer drives commands
    assert.deepEqual(pipCommands, []);
  }
});

test('resumeInMain sends the handoff to main as a navigate command', () => {
  const { service, main, player } = setup();
  service.setPlayer(player);
  service.resumeInMain({ videoId: B, timeSec: 61 });
  assert.deepEqual(lastState(main).command, { navigate: { videoId: B, timeSec: 61 } });
});

test('watching() follows the player URL while PiP is open', () => {
  const { service, player, pipWc } = setup();
  pipWc.url = `https://www.youtube.com/watch?v=${C}`;
  service.setPlayer(player);
  assert.equal((service as any).watching()?.videoId, C);
});

test("step('next') with PiP as the player sends the command to PiP", () => {
  const { service, pipCommands, player } = setup();
  service.setPlayer(player);
  service.step('next');
  assert.deepEqual(pipCommands, [{ navigate: { videoId: B, timeSec: 0 } }]);
});

test('step does nothing without a watched video', () => {
  const { service, main } = setup();
  main.url = 'https://www.youtube.com/';
  const before = main.sent.length;
  service.step('next');
  assert.equal(main.sent.length, before);
});
