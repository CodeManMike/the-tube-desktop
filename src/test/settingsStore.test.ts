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

test('wrong-shaped plugin entries fall back and can still be saved', () => {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({ plugins: { a: 'x', b: { enabled: 'yes', values: 'x' } } }));
  const store = new SettingsStore(file);
  assert.equal(store.isEnabled('a', true), true);
  store.setEnabled('a', false);
  store.setValue('b', DEFS[0], 7);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.plugins.a.enabled, false);
  assert.equal(saved.plugins.b.values.n, 7);
});

test('plugins as an array is reset instead of silently dropping writes', () => {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({ plugins: [] }));
  new SettingsStore(file).setEnabled('a', false);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).plugins.a.enabled, false);
});

test('invalid window state is ignored', () => {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({ plugins: {}, window: { x: 1, y: 2, width: 'big', height: 600, maximized: 'false' } }));
  assert.equal(new SettingsStore(file).getWindowState(), undefined);
});

test('a failed write is logged, not thrown', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttd-settings-'));
  const file = path.join(dir, 'settings.json');
  fs.mkdirSync(file); // the target is a directory, so the rename must fail
  const store = new SettingsStore(file);
  assert.doesNotThrow(() => store.setEnabled('a', false));
  assert.equal(store.isEnabled('a', true), false);
});

test('PiP state round-trips and a bad stored value reads as undefined', () => {
  const file = tmpFile();
  const store = new SettingsStore(file);
  store.setPipState({ x: 1, y: 2, width: 480, height: 270, alwaysOnTop: false });
  assert.deepEqual(new SettingsStore(file).getPipState(), { x: 1, y: 2, width: 480, height: 270, alwaysOnTop: false });
  fs.writeFileSync(file, JSON.stringify({ plugins: {}, pip: { x: 'a' } }));
  assert.equal(new SettingsStore(file).getPipState(), undefined);
});

import { validateSetting } from '../shared/settings';

test('a text setting keeps strings up to maxLength and falls back otherwise', () => {
  const def = { key: 'css', label: 'CSS', type: 'text' as const, default: '', maxLength: 10 };
  assert.equal(validateSetting(def, 'a { }'), 'a { }');
  assert.equal(validateSetting(def, 'x'.repeat(11)), '');
  assert.equal(validateSetting(def, 42), '');
});
