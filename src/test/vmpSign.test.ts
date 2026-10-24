import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';

// scripts/vmp-sign.cjs is plain JS for electron-builder; load it from the repo root.
const hook = require(path.join(__dirname, '..', '..', 'scripts', 'vmp-sign.cjs'));
const quiet = () => {};

// A runner that answers sign-pkg with the given codes in turn, and verify-pkg with 0.
function scripted(signCodes: number[], verifyCode = 0) {
  const calls: { step: string; timeoutMs: number }[] = [];
  const runner = async (_cmd: string, args: string[], timeoutMs: number) => {
    const step = args.includes('sign-pkg') ? 'sign' : 'verify';
    calls.push({ step, timeoutMs });
    return step === 'sign' ? signCodes.shift() ?? 0 : verifyCode;
  };
  return { calls, runner };
}

test('buildCommands signs, then verifies, the packed app', () => {
  assert.deepEqual(hook.buildCommands('C:/x/win-unpacked'), [
    ['python', ['-m', 'castlabs_evs.vmp', 'sign-pkg', 'C:/x/win-unpacked']],
    ['python', ['-m', 'castlabs_evs.vmp', 'verify-pkg', 'C:/x/win-unpacked']],
  ]);
});

test('the hook passes when both steps succeed first time', async () => {
  const { calls, runner } = scripted([0]);
  await hook.signAndVerify('C:/x/win-unpacked', runner, quiet);
  assert.deepEqual(calls.map((c) => c.step), ['sign', 'verify']);
});

test('a stalled or failed upload is retried, then verified', async () => {
  const { calls, runner } = scripted([hook.TIMED_OUT, 1, 0]);
  const lines: string[] = [];
  await hook.signAndVerify('C:/x/win-unpacked', runner, (l: string) => lines.push(l));
  assert.deepEqual(calls.map((c) => c.step), ['sign', 'sign', 'sign', 'verify']);
  assert.match(lines[0], /attempt 1 of 4 timed out, trying again/);
  assert.match(lines[1], /attempt 2 of 4 exited 1, trying again/);
});

test('every signing attempt has a time limit', async () => {
  const { calls, runner } = scripted([0]);
  await hook.signAndVerify('C:/x/win-unpacked', runner, quiet);
  for (const c of calls) assert.ok(c.timeoutMs > 0 && Number.isFinite(c.timeoutMs), `${c.step} has a timeout`);
});

test('the hook throws after the last attempt fails, so no installer is made', async () => {
  const { calls, runner } = scripted(Array(hook.SIGN_ATTEMPTS).fill(hook.TIMED_OUT));
  await assert.rejects(hook.signAndVerify('C:/x/win-unpacked', runner, quiet), /VMP signing failed: .* timed out 4 times/);
  assert.equal(calls.length, hook.SIGN_ATTEMPTS); // verify never runs after a failed sign
});

test('a failed verify fails the build without re-signing', async () => {
  const { calls, runner } = scripted([0], 1);
  await assert.rejects(hook.signAndVerify('C:/x/win-unpacked', runner, quiet), /verify-pkg .*exited 1/);
  assert.deepEqual(calls.map((c) => c.step), ['sign', 'verify']);
});

test('run kills a process that outlives its time limit', async () => {
  const started = Date.now();
  const code = await hook.run(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], 300);
  assert.equal(code, hook.TIMED_OUT);
  assert.ok(Date.now() - started < 5000);
});

test('run returns the exit code of a process that finishes in time', async () => {
  assert.equal(await hook.run(process.execPath, ['-e', 'process.exit(3)'], 10000), 3);
});
