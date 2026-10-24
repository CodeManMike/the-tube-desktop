import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hotkeys } from '../plugins/hotkeys';

function run(settings: Record<string, unknown>, refuse: string[] = []) {
  const registered = new Map<string, () => void>();
  const unregistered: string[] = [];
  const calls: string[] = [];
  const logs: string[] = [];
  const controls: any = { playPause: () => calls.push('playPause'), next: () => calls.push('next'), previous: () => calls.push('previous'), togglePip: () => calls.push('pip') };
  const shortcuts = {
    register: (a: string, fn: () => void) => (refuse.includes(a) ? false : (registered.set(a, fn), true)),
    unregister: (a: string) => unregistered.push(a),
  };
  const dispose = hotkeys.main!({ mainWindow: null as any, store: null as any, log: (m: string) => logs.push(m), controls, shortcuts, setHideOnClose: () => {}, settings }) as () => void;
  return { registered, unregistered, calls, logs, dispose };
}
const DEFAULTS = Object.fromEntries(hotkeys.manifest.settings.map((d) => [d.key, d.default]));

test('defaults register the four shortcuts', () => {
  assert.deepEqual([...run(DEFAULTS).registered.keys()].sort(), ['Control+Alt+Left', 'Control+Alt+P', 'Control+Alt+Right', 'Control+Alt+Space']);
});

test('pressing a shortcut calls the matching control', () => {
  const r = run(DEFAULTS);
  r.registered.get('Control+Alt+Space')!();
  r.registered.get('Control+Alt+Right')!();
  r.registered.get('Control+Alt+Left')!();
  r.registered.get('Control+Alt+P')!();
  assert.deepEqual(r.calls, ['playPause', 'next', 'previous', 'pip']);
});

test('an empty or invalid setting registers nothing for that action', () => {
  const r = run({ ...DEFAULTS, playPause: '', next: 'Banana' });
  assert.deepEqual([...r.registered.keys()].sort(), ['Control+Alt+Left', 'Control+Alt+P']);
});

test('a refused shortcut is logged and the rest still register', () => {
  const r = run(DEFAULTS, ['Control+Alt+Space']);
  assert.equal(r.registered.size, 3);
  assert.ok(r.logs.some((l) => l.includes('Control+Alt+Space')));
});

test('the disposer unregisters everything it registered', () => {
  const r = run(DEFAULTS, ['Control+Alt+P']);
  r.dispose();
  assert.deepEqual(r.unregistered.sort(), ['Control+Alt+Left', 'Control+Alt+Right', 'Control+Alt+Space']);
});
