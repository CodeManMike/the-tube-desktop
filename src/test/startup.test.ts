import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startupHook } from '../plugins/startup';

test('turning Start with Windows on registers the login item, and the disposer removes it', () => {
  const calls: boolean[] = [];
  const dispose = startupHook((on) => calls.push(on));
  dispose();
  assert.deepEqual(calls, [true, false]);
});
