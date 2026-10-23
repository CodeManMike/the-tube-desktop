import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideSkip } from '../plugins/skip/decide';

const s = (uuid: string, category: string, start: number, end: number) => ({ uuid, category, start, end });
const ACTIONS = { sponsor: 'auto', intro: 'button', outro: 'notify', filler: 'ignore' } as const;
const decide = (segs: any[], prev: number, now: number, opts: { duration?: number; seeked?: boolean; handled?: string[] } = {}) =>
  decideSkip(segs, ACTIONS as any, prev, now, opts.duration ?? 300, opts.seeked ?? false, opts.handled ?? []);

test('entering an auto segment skips to its end', () => {
  assert.deepEqual(decide([s('a', 'sponsor', 10, 30)], 9.8, 10.1), { kind: 'skip', segment: s('a', 'sponsor', 10, 30), to: 30 });
});

test('starting inside the first second skips', () => {
  assert.equal(decide([s('a', 'sponsor', 0, 6.5)], 0, 0.4)?.kind, 'skip');
});

test('seeking into a segment offers a button instead', () => {
  assert.equal(decide([s('a', 'sponsor', 10, 30)], 5, 15, { seeked: true })?.kind, 'button');
});

test('undo marks the segment handled', () => {
  assert.equal(decide([s('a', 'sponsor', 10, 30)], 9.8, 10.1, { handled: ['a'] }), null);
  assert.equal(decide([s('a', 'sponsor', 10, 30)], 12, 12.3, { handled: ['a'] }), null);
});

test('button and notify categories', () => {
  assert.equal(decide([s('i', 'intro', 0, 8)], 0, 0.3)?.kind, 'button');
  assert.equal(decide([s('o', 'outro', 200, 220)], 199.9, 200.2)?.kind, 'notify');
  assert.equal(decide([s('o', 'outro', 200, 220)], 205, 205.3), null); // only once, on entering
});

test('ignore gives nothing', () => assert.equal(decide([s('f', 'filler', 10, 30)], 9.8, 10.1), null));

test('near the end of a segment does nothing', () => assert.equal(decide([s('a', 'sponsor', 10, 30)], 29.4, 29.6, { seeked: true }), null));

test('a segment that runs to the end skips to just before the end', () => {
  assert.equal((decide([s('a', 'sponsor', 100, 120)], 99.9, 100.1, { duration: 120 }) as any)?.to, 119.75);
});

test('no decision without a finite duration', () => {
  assert.equal(decide([s('a', 'sponsor', 10, 30)], 9.8, 10.1, { duration: Infinity }), null);
  assert.equal(decide([s('a', 'sponsor', 10, 30)], 9.8, 10.1, { duration: 0 }), null);
});

test('outside every segment gives nothing', () => assert.equal(decide([s('a', 'sponsor', 10, 30)], 40, 40.3), null));
