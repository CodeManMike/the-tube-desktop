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
  reg.restartMainHooks({ mainWindow: {} as any, store: store(), log: (m: string) => logs.push(m), controls: null as any, shortcuts: null as any, setHideOnClose: () => {} });
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

test('pip entries include only plugins that declare pip', () => {
  const reg = new PluginRegistry([plugin('a'), plugin('b', { contexts: ['main', 'pip'] }), plugin('c', { contexts: ['pip'] })], store());
  assert.deepEqual(reg.pageEntries('pip').map((e) => e.id), ['b', 'c']);
  assert.deepEqual(reg.pageEntries().map((e) => e.id), ['a', 'b']);
});

test('a plugin disabled for the session is left out of pip entries too', () => {
  const reg = new PluginRegistry([plugin('b', { contexts: ['main', 'pip'] })], store());
  reg.disableForSession('b');
  assert.deepEqual(reg.pageEntries('pip'), []);
});

test('a plugin can borrow another plugin setting', () => {
  const s = store();
  const owner = plugin('queue', { manifest: { id: 'queue', name: 'q', defaultEnabled: true, settings: [{ key: 'watchedPercent', label: 'w', type: 'number', default: 80, min: 50, max: 100 }] } });
  const borrower = plugin('hw', { borrows: { watchedPercent: { plugin: 'queue', key: 'watchedPercent' } } });
  const reg = new PluginRegistry([owner, borrower], s);
  assert.equal(reg.pageEntries().find((e) => e.id === 'hw')!.settings.watchedPercent, 80);
  s.setValue('queue', owner.manifest.settings[0], 90);
  assert.equal(reg.pageEntries().find((e) => e.id === 'hw')!.settings.watchedPercent, 90);
});

const mainCtx = (logs: string[] = []) => ({ mainWindow: null as any, store: null as any, log: (m: string) => logs.push(m), controls: null as any, shortcuts: null as any, setHideOnClose: () => {} });

test('restartMainHooks disposes running hooks before running them again, with their settings', () => {
  const events: string[] = [];
  const p = plugin('t', {
    manifest: { id: 't', name: 't', defaultEnabled: true, settings: [{ key: 'x', label: 'x', type: 'number', default: 1 }] },
    main: (ctx: any) => { events.push('run:' + ctx.settings.x); return () => events.push('dispose'); },
  });
  const reg = new PluginRegistry([p], store());
  reg.restartMainHooks(mainCtx());
  reg.restartMainHooks(mainCtx());
  assert.deepEqual(events, ['run:1', 'dispose', 'run:1']);
});

test("a disabled plugin's hook is disposed and not rerun", () => {
  const events: string[] = [];
  const s = store();
  const reg = new PluginRegistry([plugin('t', { main: () => { events.push('run'); return () => events.push('dispose'); } })], s);
  reg.restartMainHooks(mainCtx());
  s.setEnabled('t', false);
  reg.restartMainHooks(mainCtx());
  assert.deepEqual(events, ['run', 'dispose']);
});

test('a throwing hook or disposer is contained', () => {
  const logs: string[] = [];
  const events: string[] = [];
  const reg = new PluginRegistry([
    plugin('bad', { main: () => { throw new Error('boom'); } }),
    plugin('badDispose', { main: () => () => { throw new Error('dispose boom'); } }),
    plugin('good', { main: () => { events.push('good'); } }),
  ], store());
  reg.restartMainHooks(mainCtx(logs));
  reg.restartMainHooks(mainCtx(logs));
  assert.deepEqual(events, ['good', 'good']);
  assert.ok(logs.some((l) => l.includes('bad') && l.includes('boom')));
  assert.ok(logs.some((l) => l.includes('badDispose') && l.includes('dispose boom')));
});
