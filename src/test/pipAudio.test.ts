import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAudioScript, audioOf } from '../main/pip/audio';

test('audioOf reads mute and volume from a player report', () => {
  assert.deepEqual(audioOf({ videoId: 'x', muted: true, volume: 35 }), { muted: true, volume: 35 });
  assert.deepEqual(audioOf({ muted: false, volume: 100 }), { muted: false, volume: 100 });
});

test('audioOf rejects anything malformed', () => {
  assert.equal(audioOf(null), null);
  assert.equal(audioOf({ muted: 'yes', volume: 10 }), null);
  assert.equal(audioOf({ muted: true, volume: 140 }), null);
  assert.equal(audioOf({ muted: true, volume: NaN }), null);
});

test('applyAudioScript sets the volume and mutes or unmutes the player', () => {
  const muted = applyAudioScript({ muted: true, volume: 35 });
  assert.match(muted, /setVolume\(35\)/);
  assert.match(muted, /\.mute\(\)/);
  assert.match(applyAudioScript({ muted: false, volume: 80 }), /\.unMute\(\)/);
});
