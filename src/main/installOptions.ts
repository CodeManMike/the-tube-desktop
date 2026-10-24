import fs from 'fs';
import { Plugin } from '../shared/plugin';
import { SettingsStore } from './settingsStore';

// What the installer's "Choose your settings" page offered (build/installer.nsh writes the
// answers to install-options.json in the app's data folder on a fresh install).
export type InstallOptions = Partial<Record<'startWithWindows' | 'closeToTray' | 'hideWatched' | 'sponsorBlock' | 'showDislikes', boolean>>;
const KEYS = ['startWithWindows', 'closeToTray', 'hideWatched', 'sponsorBlock', 'showDislikes'] as const;

export function parseInstallOptions(json: unknown): InstallOptions | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const out: InstallOptions = {};
  for (const key of KEYS) {
    const v = (json as Record<string, unknown>)[key];
    if (typeof v === 'boolean') out[key] = v;
  }
  return out;
}

// On first run after a fresh install: turn the installer's choices into settings, once.
// The file is removed either way, so a later launch never overrides what the user changed.
export function consumeInstallOptions(file: string, store: SettingsStore, plugins: Plugin[]): boolean {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return false;
  }
  try {
    fs.unlinkSync(file);
  } catch {}
  let options: InstallOptions | null = null;
  try {
    options = parseInstallOptions(JSON.parse(text));
  } catch {}
  if (!options) {
    console.warn('[install] ignored an unreadable install-options.json');
    return false;
  }
  const enable = (id: string, on: boolean | undefined) => {
    if (on !== undefined && plugins.some((p) => p.manifest.id === id)) store.setEnabled(id, on);
  };
  enable('startup', options.startWithWindows);
  enable('hideWatched', options.hideWatched);
  enable('sponsorBlock', options.sponsorBlock);
  enable('ryd', options.showDislikes);
  const closeToTray = plugins.find((p) => p.manifest.id === 'tray')?.manifest.settings.find((d) => d.key === 'closeToTray');
  if (closeToTray && options.closeToTray !== undefined) store.setValue('tray', closeToTray, options.closeToTray);
  console.log(`[install] applied the installer's choices: ${JSON.stringify(options)}`);
  return true;
}
