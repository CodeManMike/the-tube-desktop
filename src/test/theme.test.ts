import { test } from 'node:test';
import assert from 'node:assert/strict';
import { themeCss, theme } from '../plugins/theme';

test("the default preset with no custom CSS adds nothing", () => assert.equal(themeCss('default', ''), ''));

test('pure black sets the base background to black in dark mode', () => {
  const css = themeCss('black', '');
  assert.match(css, /html\[dark\]/);
  assert.match(css, /--yt-spec-base-background:\s*#000/);
});

test('custom CSS comes after the preset', () => {
  const css = themeCss('dim', 'ytd-app { color: red }');
  assert.ok(css.indexOf('ytd-app { color: red }') > css.indexOf('--yt-spec-base-background'));
});

test('theme settings: preset with labels, custom CSS as text', () => {
  const [preset, custom] = theme.manifest.settings;
  assert.deepEqual(preset.options, ['default', 'black', 'dim']);
  assert.equal(custom.type, 'text');
});
