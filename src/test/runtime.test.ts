import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'vm';
import { pageRuntime } from '../page/runtime';
import { buildPageBundle } from '../main/pageBundle';
import { PageEntry } from '../shared/plugin';
import { RuntimeEntry } from '../page/runtime';

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

// Bundle-level entries carry source text; pageRuntime itself receives functions.
const entry = (id: string, transforms: PageEntry['transforms'], settings = {}): PageEntry => ({ id, settings, transforms });
const live = (e: PageEntry): RuntimeEntry => ({
  id: e.id,
  settings: e.settings,
  css: null,
  script: null,
  transforms: Object.fromEntries(Object.entries(e.transforms).map(([k, src]) => [k, new Function('return ' + src)()])),
});
const BROWSE = 'https://www.youtube.com/youtubei/v1/browse?key=1';

test('does nothing off www.youtube.com', () => {
  const { origFetch } = fakePage('accounts.google.com');
  pageRuntime([entry('a', { browse: '(d) => d' })].map(live));
  assert.equal((globalThis as any).fetch, origFetch);
});

test('exact endpoint match', async () => {
  fakePage();
  pageRuntime([entry('a', { browse: '(d) => ({ ...d, hit: true })' })].map(live));
  assert.equal((await (await fetch(BROWSE)).json()).hit, true);
  assert.equal((await (await fetch('https://www.youtube.com/youtubei/v1/browse/edit_playlist')).json()).hit, undefined);
});

test('settings reach the transform', async () => {
  fakePage();
  pageRuntime([entry('a', { browse: '(d, s) => ({ ...d, s: s.flag })' }, { flag: true })].map(live));
  assert.equal((await (await fetch(BROWSE)).json()).s, true);
});

test('three failures disable the entry and later responses pass through untouched', async () => {
  fakePage();
  (globalThis as any).__calls = 0;
  pageRuntime([entry('bad', { browse: '() => { globalThis.__calls++; throw new Error("x"); }' })].map(live));
  for (let i = 0; i < 4; i++) assert.deepEqual(await (await fetch(BROWSE)).json(), { n: 1 });
  assert.equal((globalThis as any).__calls, 3);
});

test('one failing entry does not stop another', async () => {
  fakePage();
  pageRuntime([
    entry('bad', { browse: '() => { throw new Error("x"); }' }),
    entry('good', { browse: '(d) => ({ ...d, good: true })' }),
  ].map(live));
  assert.equal((await (await fetch(BROWSE)).json()).good, true);
});

test('non-JSON fetch response passes through', async () => {
  const { responses } = fakePage('www.youtube.com', '<html>');
  pageRuntime([entry('a', { browse: '(d) => d' })].map(live));
  const res = await fetch(BROWSE);
  assert.equal(res, responses[0]);
});

test('JSON-typed XHR to youtubei is rewritten', () => {
  const { FakeXHR } = fakePage();
  pageRuntime([entry('a', { browse: '(d) => ({ ...d, marked: true })' })].map(live));
  const xhr: any = new FakeXHR();
  xhr.open('POST', BROWSE);
  xhr.responseType = 'json';
  assert.deepEqual(xhr.response, { n: 1, marked: true });
});

test('reused XHR does not return the previous rewrite', () => {
  const { FakeXHR } = fakePage();
  pageRuntime([entry('a', { browse: '(d) => ({ ...d, marked: true })' })].map(live));
  const xhr: any = new FakeXHR();
  xhr.open('POST', BROWSE);
  assert.equal(JSON.parse(xhr.responseText).n, 1);
  xhr.body = '{"n":2}';
  xhr.open('POST', BROWSE);
  assert.equal(JSON.parse(xhr.responseText).n, 2);
});

test('ytInitialPlayerResponse assignment is transformed for initialPlayerResponse entries', () => {
  fakePage();
  pageRuntime([entry('a', { initialPlayerResponse: '(d) => ({ ...d, ads: [] })' })].map(live));
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

test('bundle works where the page forbids eval (strict CSP)', () => {
  const sandbox: any = { location: { hostname: 'www.youtube.com', href: 'https://www.youtube.com/' }, console };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(buildPageBundle([entry('a', { initialData: '(d) => ({ ...d, ok: true })' })]), context);
  vm.runInContext('ytInitialData = { v: 1 }', context);
  assert.deepEqual({ ...sandbox.ytInitialData }, { v: 1, ok: true });
});

test('an endpoint can carry several transforms, applied in order', async () => {
  fakePage();
  const e: RuntimeEntry = {
    id: 'multi', settings: {}, css: null, script: null,
    transforms: { browse: [(d: any) => ({ ...d, steps: ['a'] }), (d: any) => ({ ...d, steps: [...d.steps, 'b'] })] as any },
  };
  pageRuntime([e]);
  assert.deepEqual((await (await fetch(BROWSE)).json()).steps, ['a', 'b']);
});


test('page functions are installed on globalThis.__ttdFns', () => {
  fakePage();
  delete (globalThis as any).__ttdFns;
  pageRuntime([{ id: 'f', settings: {}, css: null, script: null, transforms: {}, functions: { triple: (x: number) => x * 3 } } as any]);
  assert.equal((globalThis as any).__ttdFns.triple(2), 6);
});

test('page functions survive the bundle', () => {
  const sandbox: any = { location: { hostname: 'www.youtube.com', href: 'https://www.youtube.com/' }, console };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(buildPageBundle([{ id: 'f', settings: {}, transforms: {}, functions: { inc: '((x) => x + 1)' } }]), sandbox);
  assert.equal(vm.runInNewContext('globalThis.__ttdFns.inc(1)', sandbox), 2);
});

test('early scripts run straight away, with their settings, before anything else', () => {
  fakePage();
  const order: string[] = [];
  (globalThis as any).__order = order;
  pageRuntime([
    { ...live(entry('a', {})), early: (s: any) => (globalThis as any).__order.push('early:' + s.x) } as any,
  ].map((e) => ({ ...e, settings: { x: 1 } })));
  assert.deepEqual(order, ['early:1']);
});

test('a throwing early script is contained and named in the log', () => {
  fakePage();
  const logs: string[] = [];
  const warn = console.warn;
  console.warn = (m: string) => logs.push(String(m));
  const ran: string[] = [];
  (globalThis as any).__ran = ran;
  try {
    pageRuntime([
      { ...live(entry('bad', {})), early: () => { throw new Error('boom'); } } as any,
      { ...live(entry('good', {})), early: () => (globalThis as any).__ran.push('good') } as any,
    ]);
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(ran, ['good']);
  assert.ok(logs.some((l) => l.includes('bad') && l.includes('boom')), logs.join('|'));
});
