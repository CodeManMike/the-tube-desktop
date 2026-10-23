import { WebContents } from 'electron';
import { pageRuntime } from '../page/runtime';
import { PageEntry } from '../shared/plugin';

// Plugin functions are pasted in as code, not strings: the page never needs eval, so a
// stricter YouTube CSP can't silently stop every plugin. (Data stays JSON-encoded.)
export function buildPageBundle(entries: PageEntry[]): string {
  const literal = entries.map((e) => {
    const transforms = Object.entries(e.transforms).map(([endpoint, src]) => `${JSON.stringify(endpoint)}:${src}`);
    const functions = Object.entries(e.functions ?? {}).map(([name, src]) => `${JSON.stringify(name)}:${src}`);
    return (
      `{id:${JSON.stringify(e.id)},settings:${JSON.stringify(e.settings)},` +
      `css:${JSON.stringify(e.css ?? null)},script:${e.script ?? 'null'},early:${e.early ?? 'null'},` +
      `transforms:{${transforms.join(',')}},functions:{${functions.join(',')}}}`
    );
  });
  return `(${pageRuntime.toString()})([${literal.join(',')}]);`;
}

const DISABLED = /^\[ttd\] (\S+) disabled after repeated failures$/;

export function disabledPluginId(message: string): string | undefined {
  return message.match(DISABLED)?.[1];
}

export type PageBundleHandle = { refresh(): Promise<void> };

// Registers the bundle to run before YouTube's own scripts in every document.
// refresh() swaps in a bundle built from the current entries (e.g. after a settings change).
export async function attachPageBundle(
  wc: WebContents,
  getEntries: () => PageEntry[],
  onDisabled: (id: string) => void = () => {},
): Promise<PageBundleHandle> {
  // The Page domain needs a live renderer; a fresh window has none until something loads.
  if (!wc.getURL()) await wc.loadURL('about:blank');
  if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
  await wc.debugger.sendCommand('Page.enable');

  let identifier: string | undefined;
  const register = async () => {
    if (identifier) await wc.debugger.sendCommand('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    ({ identifier } = await wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
      source: buildPageBundle(getEntries()),
    }));
  };
  await register();

  wc.on('console-message', (event: any, _level?: number, legacyMessage?: string) => {
    const message: string = event.message ?? legacyMessage ?? '';
    if (!message.startsWith('[ttd]')) return;
    console.log(message);
    const id = disabledPluginId(message);
    if (id) onDisabled(id);
  });

  return { refresh: register };
}
