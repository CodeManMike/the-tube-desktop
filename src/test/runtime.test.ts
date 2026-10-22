import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'vm';
import { pageRuntime } from '../page/runtime';
import { buildPageBundle } from '../main/pageBundle';
import { PageEntry } from '../shared/plugin';

// Minimal fakes of the browser globals the runtime touches. Installed on
// globalThis for the whole test because the runtime reads them lazily.
function fakePage(hostname = 'www.youtube.com', body = '{"n":1}') {
  class FakeXHR {
    readyState = 4;
    responseType = '';
    body = body;
    open(_m: string, _u: string) {}
    get responseText() {
      if (this.responseType !== '' && this.responseType !== 'text') throw new Error('InvalidStateError');
      return this.body;
    }
    get response(): any {
      return this.responseType === 'json' ? JSON.parse(this.body) : this.body;
    }
  }
  const responses: Response[] = [];
  const origFetch = async () => {
    const r = new Response(body, { status: 200 });
    responses.push(r);
    return r;
  };
  const g: any = { location: { hostname, href: `https://${hostname}/` }, fetch: origFetch, XMLHttpRequest: FakeXHR };
  g.window = g;
  Object.assign(globalThis, g);
  (globalThis as any).window = globalThis;
  return { origFetch, FakeXHR, responses };
}

const entry = (id: string, transforms: PageEntry['transforms'], settings = {}): PageEntry => ({ id, settings, transforms });
const BROWSE = 'https://www.youtube.com/youtubei/v1/browse?key=1';

test('does nothing off www.youtube.com', () => {
  const { origFetch } = fakePage('accounts.google.com');
  pageRuntime([entry('a', { browse: '(d) => d' })]);
  assert.equal((globalThis as any).fetch, origFetch);
});

test('exact endpoint match', async () => {
  fakePage();
  pageRuntime([entry('a', { browse: '(d) => ({ ...d, hit: true })' })]);
  assert.equal((await (await fetch(BROWSE)).json()).hit, true);
  assert.equal((await (await fetch('https://www.youtube.com/youtubei/v1/browse/edit_playlist')).json()).hit, undefined);
});

test('settings reach the transform', async () => {
  fakePage();
  pageRuntime([entry('a', { browse: '(d, s) => ({ ...d, s: s.flag })' }, { flag: true })]);
  assert.equal((await (await fetch(BROWSE)).json()).s, true);
});

test('three failures disable the entry and later responses pass through untouched', async () => {
  fakePage();
  (globalThis as any).__calls = 0;
  pageRuntime([entry('bad', { browse: '() => { globalThis.__calls++; throw new Error("x"); }' })]);
  for (let i = 0; i < 4; i++) assert.deepEqual(await (await fetch(BROWSE)).json(), { n: 1 });
  assert.equal((globalThis as any).__calls, 3);
});

test('one failing entry does not stop another', async () => {
  fakePage();
  pageRuntime([
    entry('bad', { browse: '() => { throw new Error("x"); }' }),
    entry('good', { browse: '(d) => ({ ...d, good: true })' }),
  ]);
  assert.equal((await (await fetch(BROWSE)).json()).good, true);
});

test('non-JSON fetch response passes through', async () => {
  const { responses } = fakePage('www.youtube.com', '<html>');
  pageRuntime([entry('a', { browse: '(d) => d' })]);
  const res = await fetch(BROWSE);
  assert.equal(res, responses[0]);
});

test('JSON-typed XHR to youtubei is rewritten', () => {
  const { FakeXHR } = fakePage();
  pageRuntime([entry('a', { browse: '(d) => ({ ...d, marked: true })' })]);
  const xhr: any = new FakeXHR();
  xhr.open('POST', BROWSE);
  xhr.responseType = 'json';
  assert.deepEqual(xhr.response, { n: 1, marked: true });
});

test('reused XHR does not return the previous rewrite', () => {
  const { FakeXHR } = fakePage();
  pageRuntime([entry('a', { browse: '(d) => ({ ...d, marked: true })' })]);
  const xhr: any = new FakeXHR();
  xhr.open('POST', BROWSE);
  assert.equal(JSON.parse(xhr.responseText).n, 1);
  xhr.body = '{"n":2}';
  xhr.open('POST', BROWSE);
  assert.equal(JSON.parse(xhr.responseText).n, 2);
});

test('ytInitialPlayerResponse assignment is transformed for initialPlayerResponse entries', () => {
  fakePage();
  pageRuntime([entry('a', { initialPlayerResponse: '(d) => ({ ...d, ads: [] })' })]);
  (globalThis as any).ytInitialPlayerResponse = { ads: [1, 2] };
  assert.deepEqual((globalThis as any).ytInitialPlayerResponse, { ads: [] });
});

test('bundle source runs standalone in a fresh context', () => {
  const sandbox: any = { location: { hostname: 'www.youtube.com', href: 'https://www.youtube.com/' }, console };
  sandbox.window = sandbox;
  vm.runInNewContext(buildPageBundle([entry('a', { initialData: '(d) => ({ ...d, ok: true })' })]), sandbox);
  vm.runInNewContext('ytInitialData = { v: 1 }', sandbox);
  assert.deepEqual({ ...sandbox.ytInitialData }, { v: 1, ok: true });
});
