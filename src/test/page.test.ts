import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageHooks } from '../rewrite/page';

// Minimal fake of the browser globals pageHooks touches.
function fakePage(hostname: string) {
  class FakeXHR {
    readyState = 4;
    responseType = '';
    body = '{"n":1}';
    open(_m: string, _u: string) {}
    get responseText() {
      if (this.responseType !== '' && this.responseType !== 'text') throw new Error('InvalidStateError');
      return this.body;
    }
    get response(): any {
      return this.responseType === 'json' ? JSON.parse(this.body) : this.body;
    }
  }
  const origFetch = async () => new Response('{}');
  const g: any = { location: { hostname, href: `https://${hostname}/` }, fetch: origFetch, XMLHttpRequest: FakeXHR };
  g.window = g;
  return { g, origFetch, FakeXHR };
}

// Installs the fakes as globals for the rest of the test (pageHooks reads them lazily).
function run(g: any, transforms: [string, (d: any) => any][]) {
  Object.assign(globalThis, g);
  pageHooks(transforms);
  g.fetch = (globalThis as any).fetch;
}

test('JSON-typed XHR to youtubei is rewritten without throwing', () => {
  const { g, FakeXHR } = fakePage('www.youtube.com');
  run(g, [['mark', (d) => ({ ...d, marked: true })]]);
  const xhr: any = new FakeXHR();
  xhr.open('POST', 'https://www.youtube.com/youtubei/v1/browse?key=x');
  xhr.responseType = 'json';
  assert.deepEqual(xhr.response, { n: 1, marked: true });
});

test('hooks do nothing outside www.youtube.com (e.g. Google sign-in)', () => {
  const { g, origFetch } = fakePage('accounts.google.com');
  run(g, [['mark', (d) => d]]);
  assert.equal(g.fetch, origFetch);
  assert.equal(Object.getOwnPropertyDescriptor(g, 'ytInitialData'), undefined);
});
