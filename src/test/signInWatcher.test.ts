import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SignInWatcher } from '../main/account/signInWatcher';

function make(opts: { wasSignedIn?: boolean; hasSid?: boolean } = {}) {
  let now = 0;
  let hasSid = opts.hasSid ?? false;
  const timers: { at: number; fn: () => void }[] = [];
  const saved: boolean[] = [];
  let prompts = 0;
  const w = new SignInWatcher({
    wasSignedIn: opts.wasSignedIn ?? false,
    save: (v: boolean) => saved.push(v),
    prompt: () => prompts++,
    now: () => now,
    setTimer: (fn, ms) => timers.push({ at: now + ms, fn }),
    hasSidCookie: async () => hasSid,
  });
  const advance = async (ms: number) => {
    now += ms;
    const due = timers.filter((t) => t.at <= now);
    for (const t of due) timers.splice(timers.indexOf(t), 1);
    for (const t of due) t.fn();
    await new Promise((r) => setImmediate(r));
  };
  return { w, saved, prompts: () => prompts, advance, setSid: (v: boolean) => (hasSid = v) };
}

test('a signed-in page load remembers the sign-in', () => {
  const m = make();
  m.w.pageLoaded(true);
  assert.deepEqual(m.saved, [true]);
});

test('a signed-out page load after a sign-in prompts once', () => {
  const m = make({ wasSignedIn: true });
  m.w.pageLoaded(false);
  m.w.pageLoaded(false);
  assert.equal(m.prompts(), 1);
});

test('never prompts without a previous sign-in', async () => {
  const m = make();
  m.w.pageLoaded(false);
  m.w.cookieRemoved('SID');
  await m.advance(6000);
  assert.equal(m.prompts(), 0);
});

test('a cookie removed and re-added within 5 s does not prompt', async () => {
  const m = make({ wasSignedIn: true, hasSid: true });
  m.w.cookieRemoved('SID');
  await m.advance(5000);
  assert.equal(m.prompts(), 0);
});

test('a cookie still missing after 5 s prompts', async () => {
  const m = make({ wasSignedIn: true, hasSid: false });
  m.w.cookieRemoved('__Secure-3PSID');
  await m.advance(4999);
  assert.equal(m.prompts(), 0);
  await m.advance(1);
  assert.equal(m.prompts(), 1);
});

test('at most one prompt per 10 minutes', async () => {
  const m = make({ wasSignedIn: true });
  m.w.pageLoaded(false);
  await m.advance(9 * 60_000);
  m.w.pageLoaded(false);
  assert.equal(m.prompts(), 1);
  await m.advance(60_001);
  m.w.pageLoaded(false);
  assert.equal(m.prompts(), 2);
});

test('Not now stops prompts until the next signed-in load', async () => {
  const m = make({ wasSignedIn: true });
  m.w.pageLoaded(false);
  m.w.dismissed();
  await m.advance(11 * 60_000);
  m.w.pageLoaded(false);
  assert.equal(m.prompts(), 1);
  assert.equal(m.saved.at(-1), false);
  m.w.pageLoaded(true);
  await m.advance(11 * 60_000);
  m.w.pageLoaded(false);
  assert.equal(m.prompts(), 2);
});

test('other cookie names and unknown page states are ignored', async () => {
  const m = make({ wasSignedIn: true });
  m.w.cookieRemoved('PREF');
  m.w.pageLoaded(null);
  await m.advance(6000);
  assert.equal(m.prompts(), 0);
});
