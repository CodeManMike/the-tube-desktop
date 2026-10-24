import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trayMenuTemplate, trayTooltip } from '../main/desktop/trayMenu';

function controls() {
  const calls: string[] = [];
  const c: any = {};
  for (const k of ['playPause', 'next', 'previous', 'togglePip', 'showHide', 'openSettings', 'quit']) c[k] = () => calls.push(k);
  return { c, calls };
}
const labels = (t: any[]) => t.filter((i) => i.type !== 'separator').map((i) => i.label);

test('menu labels follow window and PiP state', () => {
  const { c } = controls();
  assert.deepEqual(labels(trayMenuTemplate({ visible: true, pipOpen: false }, c)), ['Hide The Tube Desktop', 'Play/pause', 'Next', 'Previous', 'Picture-in-picture', 'Settings', 'Quit']);
  assert.deepEqual(labels(trayMenuTemplate({ visible: false, pipOpen: true }, c)), ['Show The Tube Desktop', 'Play/pause', 'Next', 'Previous', 'Close picture-in-picture', 'Settings', 'Quit']);
});

test('each item calls its control', () => {
  const { c, calls } = controls();
  for (const item of trayMenuTemplate({ visible: true, pipOpen: false }, c)) (item as any).click?.();
  assert.deepEqual(calls, ['showHide', 'playPause', 'next', 'previous', 'togglePip', 'openSettings', 'quit']);
});

test('tooltip adds the title, cut to 60 characters', () => {
  assert.equal(trayTooltip(null), 'The Tube Desktop');
  assert.equal(trayTooltip('Song'), 'The Tube Desktop — Song');
  const long = trayTooltip('x'.repeat(100));
  assert.equal(long, 'The Tube Desktop — ' + 'x'.repeat(59) + '…');
});
