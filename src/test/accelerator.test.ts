import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseAccelerator } from '../main/desktop/accelerator';

test('modifiers and keys are put in canonical form', () => {
  assert.equal(normaliseAccelerator('ctrl+alt+space'), 'Control+Alt+Space');
  assert.equal(normaliseAccelerator('Ctrl + Alt + Right'), 'Control+Alt+Right');
  assert.equal(normaliseAccelerator('win+shift+p'), 'Shift+Super+P');
  assert.equal(normaliseAccelerator('Control+F5'), 'Control+F5');
});

test('empty or invalid input gives null', () => {
  assert.equal(normaliseAccelerator(' '), null);
  assert.equal(normaliseAccelerator('P'), null); // no modifier
  assert.equal(normaliseAccelerator('Ctrl+Ctrl+P'), null);
  assert.equal(normaliseAccelerator('Ctrl+Alt+'), null);
  assert.equal(normaliseAccelerator('Ctrl+Alt+Banana'), null);
  assert.equal(normaliseAccelerator('Ctrl+P+Q'), null); // two keys
});

test('F13 to F24 need no modifier', () => assert.equal(normaliseAccelerator('F13'), 'F13'));

test('media keys are never taken (YouTube and Windows handle them)', () => {
  assert.equal(normaliseAccelerator('Ctrl+Alt+MediaPlayPause'), null);
  assert.equal(normaliseAccelerator('MediaNextTrack'), null);
});
