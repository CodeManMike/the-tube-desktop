import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isInAppUrl, permissionAllowed } from '../main/policy';

test('YouTube and Google sign-in stay in the app', () => {
  assert.equal(isInAppUrl('https://www.youtube.com/watch?v=abc'), true);
  assert.equal(isInAppUrl('https://accounts.google.com/v3/signin'), true);
  assert.equal(isInAppUrl('https://www.google.com/sorry/index'), true);
});

test('everything else opens externally', () => {
  assert.equal(isInAppUrl('https://example.com'), false);
  assert.equal(isInAppUrl('http://www.youtube.com/'), false);
  assert.equal(isInAppUrl('https://www.youtube.com.evil.com/'), false);
  assert.equal(isInAppUrl('https://www.google.com/search?q=x'), false);
  assert.equal(isInAppUrl('not a url'), false);
});

test('permissions: only what playback needs', () => {
  assert.equal(permissionAllowed('fullscreen'), true);
  assert.equal(permissionAllowed('notifications'), false);
  assert.equal(permissionAllowed('geolocation'), false);
});
