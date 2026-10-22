import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { migrateLegacyProfile } from '../main/migrate';

function dirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ttd-migrate-'));
  return { legacy: path.join(root, 'legacy'), next: path.join(root, 'new') };
}

const cookies = (base: string) => path.join(base, 'Partitions', 'tube', 'Network', 'Cookies');

test('copies Partitions/tube when the new profile has none', () => {
  const { legacy, next } = dirs();
  fs.mkdirSync(path.dirname(cookies(legacy)), { recursive: true });
  fs.writeFileSync(cookies(legacy), 'x');
  assert.equal(migrateLegacyProfile(legacy, next), 'migrated');
  assert.equal(fs.readFileSync(cookies(next), 'utf8'), 'x');
});

test('skips when the new profile already has a session', () => {
  const { legacy, next } = dirs();
  for (const [base, body] of [[legacy, 'old'], [next, 'current']] as const) {
    fs.mkdirSync(path.dirname(cookies(base)), { recursive: true });
    fs.writeFileSync(cookies(base), body);
  }
  assert.equal(migrateLegacyProfile(legacy, next), 'skipped');
  assert.equal(fs.readFileSync(cookies(next), 'utf8'), 'current');
});

test('skips when there is no legacy profile', () => {
  const { legacy, next } = dirs();
  assert.equal(migrateLegacyProfile(legacy, next), 'skipped');
  assert.equal(fs.existsSync(next), false);
});
