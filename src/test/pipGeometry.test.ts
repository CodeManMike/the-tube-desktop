import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultPipBounds, fitAspect, moveBy, pipBounds, resizeFromCorner } from '../main/pip/geometry';

const AREA = { x: 0, y: 0, width: 1920, height: 1040 };

test('default PiP sits bottom-right with a 24px margin', () =>
  assert.deepEqual(defaultPipBounds(AREA), { x: 1416, y: 746, width: 480, height: 270 }));

test('resize keeps 16:9 and the top-left corner', () =>
  assert.deepEqual(resizeFromCorner({ x: 10, y: 20, width: 480, height: 270 }, 300, 70, 16 / 9, AREA), { x: 10, y: 20, width: 780, height: 439 }));

test('resize never goes below the minimum width', () =>
  assert.equal(resizeFromCorner({ x: 0, y: 0, width: 480, height: 270 }, -900, 0, 16 / 9, AREA).width, 240));

test('resize keeps ratio for 9:16 and clamps to the work area', () => {
  const r = resizeFromCorner({ x: 0, y: 0, width: 270, height: 480 }, 0, 2000, 9 / 16, AREA);
  assert.equal(r.height, 1040);
  assert.equal(r.width, 585);
});

test('fitAspect clamps a tall video to the work area height', () =>
  assert.equal(fitAspect({ x: 0, y: 0, width: 1200, height: 675 }, 9 / 16, AREA).height, 1040));

test('moveBy shifts without resizing', () =>
  assert.deepEqual(moveBy({ x: 10, y: 20, width: 480, height: 270 }, -5, 30), { x: 5, y: 50, width: 480, height: 270 }));

test('pip bounds fall back when the saved monitor is gone', () =>
  assert.deepEqual(pipBounds({ x: 5000, y: 0, width: 480, height: 270, alwaysOnTop: true }, [AREA]), defaultPipBounds(AREA)));

test('pip bounds restore a saved position that is still on screen', () =>
  assert.deepEqual(pipBounds({ x: 100, y: 100, width: 640, height: 360, alwaysOnTop: false }, [AREA]), { x: 100, y: 100, width: 640, height: 360 }));
