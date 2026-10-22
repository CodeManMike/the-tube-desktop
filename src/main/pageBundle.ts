import { WebContents } from 'electron';
import { pageRuntime } from '../page/runtime';
import { PageEntry } from '../shared/plugin';

export function buildPageBundle(entries: PageEntry[]): string {
  return `(${pageRuntime.toString()})(${JSON.stringify(entries)});`;
}

export type PageBundleHandle = { refresh(): Promise<void> };

// Registers the bundle to run before YouTube's own scripts in every document.
// refresh() swaps in a bundle built from the current entries (e.g. after a settings change).
export async function attachPageBundle(wc: WebContents, getEntries: () => PageEntry[]): Promise<PageBundleHandle> {
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
    if (message.startsWith('[ttd]')) console.log(message);
  });

  return { refresh: register };
}
