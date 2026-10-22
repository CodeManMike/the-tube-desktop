import { WebContents } from 'electron';
import { Rule } from './types';

// Turn a transform's source into an expression. Method shorthand
// ("transform(data) {...}") is only valid inside an object literal.
function asExpression(fn: Function): string {
  const src = fn.toString();
  const isMethod = /^[A-Za-z_$][\w$]*\s*\(/.test(src) && !src.startsWith('function');
  return isMethod ? `({${src}})[${JSON.stringify(fn.name)}]` : `(${src})`;
}

// Runs in the page's main world before any YouTube script.
function pageHooks(transforms: [string, (data: any) => any][]): void {
  const isTarget = (url: unknown) => typeof url === 'string' && url.includes('/youtubei/v1/browse');
  const pathOf = (url: string) => new URL(url, location.href).pathname;

  const apply = (data: any, label: string) => {
    const t0 = performance.now();
    for (const [name, fn] of transforms) {
      try {
        data = fn(data);
      } catch (err) {
        console.warn(`[rewrite] ${name} failed: ${(err as Error).message}`);
      }
    }
    console.log(`[page] ${label} ${(performance.now() - t0).toFixed(1)}ms`);
    return data;
  };

  // Initial data: YouTube assigns `var ytInitialData = {...}` in an inline script.
  let initial: any;
  Object.defineProperty(window, 'ytInitialData', {
    configurable: true,
    get: () => initial,
    set: (v) => {
      initial = v && typeof v === 'object' ? apply(v, 'ytInitialData') : v;
    },
  });

  const origFetch = window.fetch;
  window.fetch = async function (this: any, input: RequestInfo | URL, init?: RequestInit) {
    const res = await origFetch.call(this, input, init);
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!isTarget(url) || !res.ok) return res;
    try {
      const data = apply(await res.clone().json(), pathOf(url));
      return new Response(JSON.stringify(data), {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    } catch {
      return res;
    }
  };

  const proto = XMLHttpRequest.prototype as any;
  const origOpen = proto.open;
  proto.open = function (this: any, _method: string, url: string) {
    this.__tubeUrl = String(url);
    return origOpen.apply(this, arguments as any);
  };
  const textDesc = Object.getOwnPropertyDescriptor(proto, 'responseText')!;
  const respDesc = Object.getOwnPropertyDescriptor(proto, 'response')!;
  const rewritten = (xhr: any): string | undefined => {
    if (xhr.readyState !== 4 || !isTarget(xhr.__tubeUrl)) return undefined;
    if (xhr.__tubeText === undefined) {
      const raw = textDesc.get!.call(xhr);
      try {
        xhr.__tubeText = JSON.stringify(apply(JSON.parse(raw), pathOf(xhr.__tubeUrl)));
      } catch {
        xhr.__tubeText = raw;
      }
    }
    return xhr.__tubeText;
  };
  Object.defineProperty(proto, 'responseText', {
    get(this: any) {
      return rewritten(this) ?? textDesc.get!.call(this);
    },
  });
  Object.defineProperty(proto, 'response', {
    get(this: any) {
      if (this.responseType === 'json' || this.responseType === '' || this.responseType === 'text') {
        const text = rewritten(this);
        if (text !== undefined) return this.responseType === 'json' ? JSON.parse(text) : text;
      }
      return respDesc.get!.call(this);
    },
  });
}

// Candidate 2: wrap fetch/XHR and trap ytInitialData inside the page.
export async function attachPageRewrite(wc: WebContents, rules: Rule[]): Promise<void> {
  const list = rules.map((r) => `[${JSON.stringify(r.name)}, ${asExpression(r.transform)}]`).join(',');
  const source = `(${pageHooks.toString()})([${list}]);`;

  wc.debugger.attach('1.3');
  await wc.debugger.sendCommand('Page.enable');
  await wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source });

  wc.on('console-message', (event: any, _level?: number, legacyMessage?: string) => {
    const message: string = event.message ?? legacyMessage ?? '';
    if (message.startsWith('[page]') || message.startsWith('[rewrite]')) console.log(message);
  });
}
