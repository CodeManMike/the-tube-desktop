import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlayerControls } from '../main/desktop/playerControls';

function deps(over: any = {}) {
  const ran: string[] = [];
  const steps: string[] = [];
  let open = false;
  const contents = { executeJavaScript: async (code: string) => { ran.push(code); } };
  const d = {
    activeContents: () => contents as any,
    queue: { step: (dir: 'next' | 'previous') => steps.push(dir) },
    pip: { isOpen: () => open, open: () => { open = true; }, close: () => { open = false; } },
    mainWindow: () => null,
    openSettings: () => {},
    quit: () => {},
    nowPlaying: () => 'Song',
    ...over,
  };
  return { d, ran, steps, isOpen: () => open };
}

test('playPause runs the toggle in the active contents', () => {
  const { d, ran } = deps();
  createPlayerControls(d).playPause();
  assert.equal(ran.length, 1);
  assert.match(ran[0], /getPlayerState\(\) === 1/);
});

test('next and previous step the queue', () => {
  const { d, steps } = deps();
  const c = createPlayerControls(d);
  c.next();
  c.previous();
  assert.deepEqual(steps, ['next', 'previous']);
});

test('togglePip opens when closed and closes when open', () => {
  const { d, isOpen } = deps();
  const c = createPlayerControls(d);
  c.togglePip();
  assert.equal(isOpen(), true);
  c.togglePip();
  assert.equal(isOpen(), false);
});

test('playPause with no player contents does nothing', () => {
  const { d } = deps({ activeContents: () => null });
  assert.doesNotThrow(() => createPlayerControls(d).playPause());
});

import { revealWindow } from '../main/desktop/playerControls';

function fakeWindow(state: { visible: boolean; focused?: boolean; minimized?: boolean }) {
  const calls: string[] = [];
  return {
    calls,
    isVisible: () => state.visible,
    isFocused: () => !!state.focused,
    isMinimized: () => !!state.minimized,
    hide: () => { calls.push('hide'); state.visible = false; },
    show: () => { calls.push('show'); state.visible = true; },
    restore: () => { calls.push('restore'); state.minimized = false; },
    focus: () => calls.push('focus'),
  };
}

test('showHide hides a visible window even when the tray took focus', () => {
  const win = fakeWindow({ visible: true, focused: false });
  const { d } = deps({ mainWindow: () => win as any });
  createPlayerControls(d).showHide();
  assert.deepEqual(win.calls, ['hide']);
});

test('showHide brings back a hidden or minimised window', () => {
  for (const state of [{ visible: false }, { visible: true, minimized: true }]) {
    const win = fakeWindow(state);
    const { d } = deps({ mainWindow: () => win as any });
    createPlayerControls(d).showHide();
    assert.ok(win.calls.includes('show') && win.calls.includes('focus'), JSON.stringify(win.calls));
  }
});

test('revealWindow shows a window hidden in the tray (focus alone does not on Windows)', () => {
  const win = fakeWindow({ visible: false, minimized: true });
  revealWindow(win as any);
  assert.deepEqual(win.calls, ['restore', 'show', 'focus']);
});
