import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SettingsStore } from '../main/settingsStore';
import { SettingDef } from '../shared/settings';

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ttd-settings-')), 'settings.json');

const DEFS: SettingDef[] = [
  { key: 'n', label: 'N', type: 'number', default: 5, min: 0, max: 10 },
  { key: 'e', label: 'E', type: 'enum', default: 'a', options: ['a', 'b'] },
  { key: 'b', label: 'B', type: 'boolean', default: false },
  { key: 'l', label: 'L', type: 'stringList', default: [] },
];

function storeWith(values: Record<string, unknown>) {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({ plugins: { p: { enabled: true, values } } }));
  return new SettingsStore(file);
}

test('missing file gives defaults', () => {
  const store = new SettingsStore(tmpFile());
  assert.equal(store.isEnabled('x', true), true);
  assert.equal(store.isEnabled('x', false), false);
  assert.deepEqual(store.values('x', DEFS), { n: 5, e: 'a', b: false, l: [] });
});

test('corrupt file gives defaults and a valid file is rewritten on next write', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{not json');
  const store = new SettingsStore(file);
  assert.equal(store.isEnabled('x', true), true);
  store.setEnabled('x', false);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).plugins.x.enabled, false);
});

test('persists across instances', () => {
  const file = tmpFile();
  const a = new SettingsStore(file);
  a.setEnabled('p', false);
  a.setValue('p', DEFS[0], 7);
  a.setWindowState({ x: 1, y: 2, width: 800, height: 600, maximized: true });
  const b = new SettingsStore(file);
  assert.equal(b.isEnabled('p', true), false);
  assert.equal(b.values('p', DEFS).n, 7);
  assert.deepEqual(b.getWindowState(), { x: 1, y: 2, width: 800, height: 600, maximized: true });
});

test('invalid stored values fall back per key', () => {
  const store = storeWith({ n: 'abc', e: 'nope', b: true });
  assert.deepEqual(store.values('p', DEFS), { n: 5, e: 'a', b: true, l: [] });
});

test('number outside min/max falls back', () => {
  assert.equal(storeWith({ n: 99 }).values('p', DEFS).n, 5);
});

test('stringList keeps only strings', () => {
  assert.deepEqual(storeWith({ l: ['a', 1, 'b'] }).values('p', DEFS).l, ['a', 'b']);
  assert.deepEqual(storeWith({ l: 'a' }).values('p', DEFS).l, []);
});

test('setValue with an invalid value stores the default, not the bad value', () => {
  const file = tmpFile();
  const store = new SettingsStore(file);
  store.setValue('p', DEFS[0], 'abc');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).plugins.p.values.n, 5);
});
