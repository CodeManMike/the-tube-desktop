import { test } from 'node:test';
import assert from 'node:assert/strict';
import { disabledPluginId } from '../main/pageBundle';

test('recognises the runtime\'s disable message', () => {
  assert.equal(disabledPluginId('[ttd] hideShorts disabled after repeated failures'), 'hideShorts');
  assert.equal(disabledPluginId('[ttd] hideShorts failed on browse: x'), undefined);
  assert.equal(disabledPluginId('something else'), undefined);
});
