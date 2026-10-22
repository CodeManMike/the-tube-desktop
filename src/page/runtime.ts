
// Runs in YouTube's main world before any page script. It is serialised with
// toString() into the page bundle, so it must not reference anything outside its body.
export type RuntimeEntry = {
  id: string;
  settings: Record<string, unknown>;
  transforms: Partial<Record<string, (data: any, settings: Record<string, unknown>) => any>>;
  css: string | null;
  script: ((settings: Record<string, unknown>) => void) | null;
};

export function pageRuntime(entries: RuntimeEntry[]): void {
  // The bundle is registered for every document in the window, Google sign-in included.
  if (location.hostname !== 'www.youtube.com') return;

  const MAX_FAILURES = 3;
  type Fn = (data: any, settings: Record<string, unknown>) => any;
  type Live = { id: string; settings: Record<string, unknown>; fns: Record<string, Fn>; failures: number; off: boolean };

  const live: Live[] = entries.map((e) => ({
    id: e.id,
    settings: e.settings,
    fns: e.transforms as Record<string, Fn>,
    failures: 0,
    off: false,
  }));
  const wants = (endpoint: string) => live.some((p) => p.fns[endpoint]);

  // One quiet notice per disabled plugin. DOM APIs only: YouTube enforces Trusted Types.
  const toast = (text: string) => {
    if (typeof document === 'undefined') return;
    const show = () => {
      const el = document.createElement('div');
      el.textContent = text;
      el.style.cssText =
        'position:fixed;bottom:24px;left:24px;z-index:99999;padding:10px 14px;border-radius:8px;' +
        'background:rgba(30,30,30,.92);color:#fff;font:13px Roboto,Arial,sans-serif;pointer-events:none';
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 6000);
    };
    if (document.body) show();
    else addEventListener('DOMContentLoaded', show, { once: true });
  };

  // Fail safe: a throwing transform leaves the data as it was; three strikes and the
  // plugin is off for this page. (Transforms that mutate in place before throwing can
  // still leave partial edits; plugins should avoid that.)
  const apply = (endpoint: string, data: any) => {
    for (const p of live) {
      const fn = p.fns[endpoint];
      if (!fn || p.off) continue;
      try {
        const out = fn(data, p.settings);
        if (out !== undefined) data = out;
      } catch (err) {
        p.failures++;
        console.warn(`[ttd] ${p.id} failed on ${endpoint}: ${(err as Error).message}`);
        if (p.failures >= MAX_FAILURES) {
          p.off = true;
          console.warn(`[ttd] ${p.id} disabled after repeated failures`);
          toast(`TTD: ${p.id} was turned off for this page`);
        }
      }
    }
    return data;
  };

  const endpointOf = (url: unknown): string | undefined => {
    if (typeof url !== 'string') return undefined;
    try {
      const m = new URL(url, location.href).pathname.match(/^\/youtubei\/v1\/(browse|next|player|search)$/);
      return m && wants(m[1]) ? m[1] : undefined;
    } catch {
      return undefined;
    }
  };

  // Data embedded in the HTML: YouTube assigns `var ytInitialData = {...}` in inline scripts.
  for (const [name, endpoint] of [['ytInitialData', 'initialData'], ['ytInitialPlayerResponse', 'initialPlayerResponse']]) {
    if (!wants(endpoint)) continue;
    let value: any;
    Object.defineProperty(window, name, {
      configurable: true,
      get: () => value,
      set: (v) => {
        value = v && typeof v === 'object' ? apply(endpoint, v) : v;
      },
    });
  }

  if (typeof fetch === 'function') {
    const origFetch = fetch;
    window.fetch = async function (this: any, input: RequestInfo | URL, init?: RequestInit) {
      const res = await origFetch.call(this, input, init);
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const endpoint = endpointOf(url);
      if (!endpoint || !res.ok) return res;
      try {
        const data = apply(endpoint, await res.clone().json());
        return new Response(JSON.stringify(data), { status: res.status, statusText: res.statusText, headers: res.headers });
      } catch {
        return res;
      }
    };
  }

  if (typeof XMLHttpRequest !== 'undefined') {
    const proto = XMLHttpRequest.prototype as any;
    const origOpen = proto.open;
    proto.open = function (this: any, _method: string, url: string) {
      this.__ttdUrl = String(url);
      this.__ttdText = undefined; // a reused XHR must not serve the previous rewrite
      return origOpen.apply(this, arguments as any);
    };
    const textDesc = Object.getOwnPropertyDescriptor(proto, 'responseText')!;
    const respDesc = Object.getOwnPropertyDescriptor(proto, 'response')!;
    const rewritten = (xhr: any): string | undefined => {
      if (xhr.readyState !== 4) return undefined;
      const endpoint = endpointOf(xhr.__ttdUrl);
      if (!endpoint) return undefined;
      if (xhr.__ttdText === undefined) {
        try {
          // The native responseText getter throws for responseType 'json'; read the object instead.
          const parsed = xhr.responseType === 'json' ? respDesc.get!.call(xhr) : JSON.parse(textDesc.get!.call(xhr));
          xhr.__ttdText = JSON.stringify(apply(endpoint, parsed));
        } catch {
          xhr.__ttdText = null;
        }
      }
      return xhr.__ttdText ?? undefined;
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

  // Plugin CSS and page scripts, once the document exists.
  if (typeof document !== 'undefined') {
    const decorate = () => {
      for (const e of entries) {
        if (e.css) {
          const style = document.createElement('style');
          style.textContent = e.css;
          document.head.appendChild(style);
        }
        if (e.script) {
          try {
            e.script(e.settings);
          } catch (err) {
            console.warn(`[ttd] ${e.id} page script failed: ${(err as Error).message}`);
          }
        }
      }
    };
    if (document.readyState === 'loading') addEventListener('DOMContentLoaded', decorate, { once: true });
    else decorate();
  }
}
