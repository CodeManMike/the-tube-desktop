import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lowPower } from '../plugins/lowPower';

test('lowPower early script reports vp9, vp8 and av01 as unsupported, leaves H.264 alone', () => {
  const g: any = globalThis;
  const seen: string[] = [];
  g.MediaSource = { isTypeSupported: (t: string) => (seen.push(t), true) };
  g.HTMLMediaElement = function () {};
  g.HTMLMediaElement.prototype.canPlayType = () => 'probably';
  lowPower.earlyScript!({});
  assert.equal(g.MediaSource.isTypeSupported('video/webm; codecs="vp9"'), false);
  assert.equal(g.MediaSource.isTypeSupported('video/webm; codecs="vp09.00.51.08"'), false);
  assert.equal(g.MediaSource.isTypeSupported('video/mp4; codecs="av01.0.08M.08"'), false);
  assert.equal(g.MediaSource.isTypeSupported('video/webm; codecs="vp8"'), false);
  assert.equal(g.MediaSource.isTypeSupported('video/mp4; codecs="avc1.640028"'), true);
  assert.deepEqual(seen, ['video/mp4; codecs="avc1.640028"']);
  assert.equal(g.HTMLMediaElement.prototype.canPlayType('video/webm; codecs="vp9"'), '');
  assert.equal(g.HTMLMediaElement.prototype.canPlayType('video/mp4; codecs="avc1.4d401f"'), 'probably');
});

test('lowPower is off by default and runs in PiP too', () => {
  assert.equal(lowPower.manifest.defaultEnabled, false);
  assert.deepEqual(lowPower.contexts, ['main', 'pip']);
});
