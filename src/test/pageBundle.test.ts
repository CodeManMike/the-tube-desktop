import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPageBundle, disabledPluginId } from '../main/pageBundle';

test('recognises the runtime\'s disable message', () => {
  assert.equal(disabledPluginId('[ttd] hideShorts disabled after repeated failures'), 'hideShorts');
  assert.equal(disabledPluginId('[ttd] hideShorts failed on browse: x'), undefined);
  assert.equal(disabledPluginId('something else'), undefined);
});

import { ALL_PLUGINS } from '../plugins';
import { PluginRegistry as RealRegistry } from '../main/pluginRegistry';
import { SettingsStore as RealStore } from '../main/settingsStore';

test('every real plugin serialises into a bundle that parses, for the main window and PiP', () => {
  const dir = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'ttd-bundle-'));
  const reg = new RealRegistry(ALL_PLUGINS, new RealStore(require('path').join(dir, 's.json')));
  for (const ctx of ['main', 'pip'] as const) {
    const bundle = buildPageBundle(reg.pageEntries(ctx));
    assert.doesNotThrow(() => new Function(bundle), ctx);
  }
  assert.deepEqual(reg.pageEntries('pip').map((e) => e.id), ['sponsorBlock', 'adSkip', 'pinnedQuality']);
});
