import type { BrowserWindow } from 'electron';
import type { SettingsStore } from '../main/settingsStore';
import { SettingDef } from './settings';

// Where a transform applies: an InnerTube endpoint, or the data embedded in the HTML.
export type Endpoint = 'browse' | 'next' | 'player' | 'search' | 'initialData' | 'initialPlayerResponse';

// Runs inside the page, serialised with toString(): it must not reference anything outside its body.
export type Transform = (data: any, settings: Record<string, unknown>) => any;

export type PluginManifest = {
  id: string;
  name: string;
  // Only for test plugins; shipped plugins say what they are by name (see hint).
  description?: string;
  // A tooltip (ⓘ) for what the user can't see but needs to know.
  hint?: string;
  defaultEnabled: boolean;
  settings: SettingDef[];
};

export type MainContext = { mainWindow: BrowserWindow; store: SettingsStore; log: (msg: string) => void };

// Where a plugin's page parts run: the main window, the PiP window, or both.
export type PageContext = 'main' | 'pip';

export type Plugin = {
  manifest: PluginManifest;
  // Defaults to ['main']. Playback plugins (skipping) also declare 'pip'.
  contexts?: PageContext[];
  // One transform, or several applied in order (each with its own fail-safe count).
  transforms?: Partial<Record<Endpoint, Transform | Transform[]>>;
  css?: string;
  pageScript?: (settings: Record<string, unknown>) => void;
  // Runs at document start, before YouTube's own scripts.
  earlyScript?: (settings: Record<string, unknown>) => void;
  // Self-contained helpers the page script can call as globalThis.__ttdFns[name].
  pageFunctions?: Record<string, Function>;
  main?: (ctx: MainContext) => void;
};

// What the page runtime receives for one enabled plugin: functions travel as source text.
export type PageEntry = {
  id: string;
  settings: Record<string, unknown>;
  transforms: Partial<Record<Endpoint, string>>;
  css?: string;
  script?: string;
  early?: string;
  functions?: Record<string, string>;
};
