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

import { routeUrl } from '../main/policy';

test('routeUrl: dangerous schemes are blocked, never handed to Windows', () => {
  for (const url of ['search-ms:query=x&crumb=location:\\evil\share', 'ms-msdt:/id x', 'file:///C:/x.bat', 'ms-settings:', 'javascript:alert(1)', 'data:text/html,x']) {
    assert.deepEqual(routeUrl(url), { action: 'block' }, url);
  }
});

test('routeUrl: YouTube /redirect links open their real target externally', () => {
  assert.deepEqual(routeUrl('https://www.youtube.com/redirect?event=video_description&q=https%3A%2F%2Fexample.com%2Fpage'), {
    action: 'external',
    url: 'https://example.com/page',
  });
  assert.deepEqual(routeUrl('https://www.youtube.com/redirect?q=search-ms%3Aquery%3Dx'), { action: 'block' });
});

test('routeUrl: in-app, external and blank', () => {
  assert.deepEqual(routeUrl('https://www.youtube.com/watch?v=abc'), { action: 'app' });
  assert.deepEqual(routeUrl('https://example.com'), { action: 'external', url: 'https://example.com/' });
  assert.deepEqual(routeUrl('about:blank'), { action: 'block' });
});

test('routeUrl: TTD queue-add links become queueAdd with a valid id', () => {
  assert.deepEqual(routeUrl('https://www.youtube.com/ttd/queue-add?v=aaaaaaaaaaa'), { action: 'queueAdd', videoId: 'aaaaaaaaaaa' });
  assert.deepEqual(routeUrl('https://www.youtube.com/ttd/queue-add?v=bad'), { action: 'block' });
});

test('media permission is the microphone only (voice search), never the camera', () => {
  assert.equal(permissionAllowed('media', ['audio']), true);
  assert.equal(permissionAllowed('media', ['video']), false);
  assert.equal(permissionAllowed('media', ['audio', 'video']), false);
  assert.equal(permissionAllowed('media', []), false);
});
