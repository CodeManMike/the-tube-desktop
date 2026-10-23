import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseQuality } from '../plugins/pinnedQuality';

const ALL = ['hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny', 'auto'];

test('highest picks the top level', () => assert.equal(chooseQuality(ALL, 'highest'), 'hd2160'));
test('an offered level is used', () => assert.equal(chooseQuality(ALL, 'hd1080'), 'hd1080'));
test('missing level falls back lower', () => assert.equal(chooseQuality(['hd1080', 'hd720', 'auto'], 'hd1440'), 'hd1080'));
test('nothing lower falls back to the lowest offered', () => assert.equal(chooseQuality(['hd1080', 'hd720'], 'medium'), 'hd720'));
test('empty or auto-only gives null', () => {
  assert.equal(chooseQuality([], 'highest'), null);
  assert.equal(chooseQuality(['auto'], 'hd1080'), null);
});
test('unknown levels are ignored', () => assert.equal(chooseQuality(['highres', 'hd720'], 'highest'), 'hd720'));
