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
