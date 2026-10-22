import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rewriteDocument } from '../rewrite/cdp';

test('rewritten ytInitialData cannot close the inline script', () => {
  const html = '<script>var ytInitialData = {"title":"\u003c/script\u003e\u003cscript\u003ealert(1)"};</script><p>rest</p>';
  const { body } = rewriteDocument(html, [{ name: 'noop', transform: (d) => d }]);
  assert.equal(body.split('</script>').length, 2, body);
  assert.ok(body.endsWith('<p>rest</p>'));
});
