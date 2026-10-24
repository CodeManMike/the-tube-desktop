import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';

// scripts/vmp-sign.cjs is plain JS for electron-builder; load it from the repo root.
const hook = require(path.join(__dirname, '..', '..', 'scripts', 'vmp-sign.cjs'));

test('buildCommands signs, then verifies, the packed app', () => {
  assert.deepEqual(hook.buildCommands('C:/x/win-unpacked'), [
    ['python', ['-m', 'castlabs_evs.vmp', 'sign-pkg', 'C:/x/win-unpacked']],
    ['python', ['-m', 'castlabs_evs.vmp', 'verify-pkg', 'C:/x/win-unpacked']],
  ]);
});

test('the hook throws when signing fails, so no installer is made', async () => {
  const calls: string[][] = [];
  const run = async (cmd: string, args: string[]) => (calls.push([cmd, ...args]), args.includes('sign-pkg') ? 1 : 0);
  await assert.rejects(hook.signAndVerify('C:/x/win-unpacked', run), /VMP signing failed/);
  assert.equal(calls.length, 1); // verify never runs after a failed sign
});

test('the hook passes when both steps succeed', async () => {
  await hook.signAndVerify('C:/x/win-unpacked', async () => 0);
});
