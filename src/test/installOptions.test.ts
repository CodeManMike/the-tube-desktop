import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { consumeInstallOptions, parseInstallOptions } from '../main/installOptions';
import { SettingsStore } from '../main/settingsStore';
import { ALL_PLUGINS } from '../plugins';

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ttd-install-'));
const ALL_ON = { startWithWindows: true, closeToTray: true, hideWatched: true, sponsorBlock: true, showDislikes: true };

test('parseInstallOptions keeps the known switches and ignores the rest', () => {
  assert.deepEqual(parseInstallOptions({ ...ALL_ON, desktopShortcut: true, junk: 1 }), ALL_ON);
  assert.deepEqual(parseInstallOptions({ hideWatched: true }), { hideWatched: true });
  assert.deepEqual(parseInstallOptions({ hideWatched: 'yes' }), {});
  assert.equal(parseInstallOptions('nope'), null);
});

test('the installer choices become settings on first run, then the file is gone', () => {
  const d = dir();
  const file = path.join(d, 'install-options.json');
  fs.writeFileSync(file, JSON.stringify({ startWithWindows: true, closeToTray: true, hideWatched: true, sponsorBlock: false, showDislikes: false }));
  const store = new SettingsStore(path.join(d, 'settings.json'));
  assert.equal(consumeInstallOptions(file, store, ALL_PLUGINS), true);
  assert.equal(fs.existsSync(file), false);
  assert.equal(store.isEnabled('startup', false), true);
  assert.equal(store.isEnabled('hideWatched', false), true);
  assert.equal(store.isEnabled('sponsorBlock', true), false);
  assert.equal(store.isEnabled('ryd', true), false);
  const tray = ALL_PLUGINS.find((p) => p.manifest.id === 'tray')!;
  assert.equal(store.values('tray', tray.manifest.settings).closeToTray, true);
});

test('no file means nothing changes', () => {
  const d = dir();
  const store = new SettingsStore(path.join(d, 'settings.json'));
  assert.equal(consumeInstallOptions(path.join(d, 'install-options.json'), store, ALL_PLUGINS), false);
  assert.equal(store.isEnabled('hideWatched', false), false);
});

test('a broken file is removed and ignored', () => {
  const d = dir();
  const file = path.join(d, 'install-options.json');
  fs.writeFileSync(file, '{not json');
  const store = new SettingsStore(path.join(d, 'settings.json'));
  assert.equal(consumeInstallOptions(file, store, ALL_PLUGINS), false);
  assert.equal(fs.existsSync(file), false);
});
