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
  description: string;
  defaultEnabled: boolean;
  settings: SettingDef[];
};

export type MainContext = { mainWindow: BrowserWindow; store: SettingsStore; log: (msg: string) => void };

export type Plugin = {
  manifest: PluginManifest;
  transforms?: Partial<Record<Endpoint, Transform>>;
  css?: string;
  pageScript?: (settings: Record<string, unknown>) => void;
  main?: (ctx: MainContext) => void;
};

// What the page runtime receives for one enabled plugin: functions travel as source text.
export type PageEntry = {
  id: string;
  settings: Record<string, unknown>;
  transforms: Partial<Record<Endpoint, string>>;
  css?: string;
  script?: string;
};
