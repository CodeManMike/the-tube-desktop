import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PluginRegistry } from '../main/pluginRegistry';
import { SettingsStore } from '../main/settingsStore';
import { Plugin } from '../shared/plugin';

const store = () => new SettingsStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ttd-reg-')), 's.json'));

const plugin = (id: string, extra: Partial<Plugin> = {}): Plugin => ({
  manifest: { id, name: id, description: '', defaultEnabled: true, settings: [] },
  ...extra,
});

test('duplicate ids throw', () => {
  assert.throws(() => new PluginRegistry([plugin('a'), plugin('a')], store()), /duplicate plugin id: a/);
});

test('disabled plugins are excluded from pageEntries', () => {
  const s = store();
  s.setEnabled('b', false);
  const reg = new PluginRegistry([plugin('a'), plugin('b')], s);
  assert.deepEqual(reg.pageEntries().map((e) => e.id), ['a']);
  assert.deepEqual(reg.list().map((p) => [p.manifest.id, p.enabled]), [['a', true], ['b', false]]);
});

test('defaultEnabled is used when the store has no entry', () => {
  const off = plugin('off');
  off.manifest.defaultEnabled = false;
  const reg = new PluginRegistry([off, plugin('on')], store());
  assert.deepEqual(reg.pageEntries().map((e) => e.id), ['on']);
});

test('pageEntries carries validated settings and evaluable transform source', () => {
  const p = plugin('t', {
    transforms: {
      browse(data: any, settings: Record<string, unknown>) {
        return { ...data, n: settings.n };
      },
    },
  });
  p.manifest.settings = [{ key: 'n', label: 'N', type: 'number', default: 3 }];
  const [entry] = new PluginRegistry([p], store()).pageEntries();
  assert.deepEqual(entry.settings, { n: 3 });
  const fn = new Function('return ' + entry.transforms.browse)();
  assert.deepEqual(fn({ a: 1 }, entry.settings), { a: 1, n: 3 });
});

test('a throwing main hook is logged and other hooks still run', () => {
  const logs: string[] = [];
  let ran = false;
  const reg = new PluginRegistry(
    [plugin('bad', { main: () => { throw new Error('boom'); } }), plugin('good', { main: () => { ran = true; } })],
    store(),
  );
  reg.runMainHooks({ mainWindow: {} as any, store: store(), log: (m) => logs.push(m) });
  assert.equal(ran, true);
  assert.deepEqual(logs, ['[ttd] bad main hook failed: boom']);
});

test('a plugin disabled for the session is left out of pageEntries until restart', () => {
  const reg = new PluginRegistry([plugin('a'), plugin('b')], store());
  reg.disableForSession('a');
  assert.deepEqual(reg.pageEntries().map((e) => e.id), ['b']);
  assert.deepEqual(reg.list().map((p) => [p.manifest.id, p.enabled]), [['a', true], ['b', true]]);
});

test('a list of transforms is serialised as an evaluable array', () => {
  const p = plugin('m', { transforms: { browse: [(d: any) => ({ ...d, a: 1 }), (d: any) => ({ ...d, b: 2 })] } });
  const [entry] = new PluginRegistry([p], store()).pageEntries();
  const fns = new Function('return ' + entry.transforms.browse)();
  assert.equal(fns.length, 2);
  assert.deepEqual(fns[1](fns[0]({}, {}), {}), { a: 1, b: 2 });
});


test('page functions are serialised by name', () => {
  const p = plugin('f', { pageFunctions: { double: (x: number) => x * 2 } });
  const [entry] = new PluginRegistry([p], store()).pageEntries();
  assert.equal(new Function('return ' + entry.functions!.double)()(4), 8);
});
