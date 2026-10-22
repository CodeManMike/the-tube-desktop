import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restoreBounds } from '../main/windowState';

const PRIMARY = { x: 0, y: 0, width: 2560, height: 1400 };
const SECOND = { x: -1680, y: 0, width: 1680, height: 1010 };
const FALLBACK = { x: 0, y: 0, width: 1600, height: 900 };
const saved = (x: number, y: number, width: number, height: number) => ({ x, y, width, height, maximized: false });

test('a window fully on a work area is restored unchanged', () => {
  assert.deepEqual(restoreBounds(saved(-1600, 50, 1200, 700), [PRIMARY, SECOND], FALLBACK), { x: -1600, y: 50, width: 1200, height: 700 });
});

test('a window on a disconnected monitor falls back, centred on the first work area', () => {
  assert.deepEqual(restoreBounds(saved(-3000, 0, 1200, 700), [PRIMARY], FALLBACK), { x: 480, y: 250, width: 1600, height: 900 });
});

test('an oversized window is clamped to its work area', () => {
  assert.deepEqual(restoreBounds(saved(-1680, 0, 3000, 2000), [PRIMARY, SECOND], FALLBACK), { x: -1680, y: 0, width: 1680, height: 1010 });
});

test('no saved state falls back, centred', () => {
  assert.deepEqual(restoreBounds(undefined, [PRIMARY], FALLBACK), { x: 480, y: 250, width: 1600, height: 900 });
});
