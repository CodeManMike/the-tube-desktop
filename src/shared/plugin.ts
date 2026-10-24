import type { BrowserWindow } from 'electron';
import type { SettingsStore } from '../main/settingsStore';
import { SettingDef } from './settings';

// Where a transform applies: an InnerTube endpoint, or the data embedded in the HTML.
export type Endpoint = 'browse' | 'next' | 'player' | 'search' | 'initialData' | 'initialPlayerResponse';

// Runs inside the page, serialised with toString(): it must not reference anything outside its body.
// What a response is for: its endpoint, and for /browse the page asked for (browseId), which
// tells Home from History or a channel before the URL changes (continuations carry none).
export type TransformContext = { endpoint: string; browseId?: string };
export type Transform = (data: any, settings: Record<string, unknown>, ctx?: TransformContext) => any;

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

// What tray, hotkeys and the like act through: whichever player is active (PiP or main).
export type PlayerControls = {
  playPause(): void;
  next(): void;
  previous(): void;
  togglePip(): void;
  isPipOpen(): boolean;
  showHide(): void;
  openSettings(): void;
  // Opens the Ko-fi page in the default browser.
  support(): void;
  quit(): void;
  nowPlaying(): string | null;
};
// Global shortcuts (Electron's globalShortcut in the app; a fake in tests).
export type ShortcutHost = { register(accel: string, fn: () => void): boolean; unregister(accel: string): void };

export type MainContext = {
  mainWindow: BrowserWindow;
  store: SettingsStore;
  log: (msg: string) => void;
  controls: PlayerControls;
  shortcuts: ShortcutHost;
  // Closing the main window hides it instead (tray "Keep running in the tray when closed").
  setHideOnClose(on: boolean): void;
  // This plugin's own settings, filled in by the registry.
  settings?: Record<string, unknown>;
};

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
  // Settings read from another plugin, so the user sets one number in one place
  // (e.g. Hide watched uses the queue's "Counts as watched at").
  borrows?: Record<string, { plugin: string; key: string }>;
  // Runs at document start, before YouTube's own scripts.
  earlyScript?: (settings: Record<string, unknown>) => void;
  // Self-contained helpers the page script can call as globalThis.__ttdFns[name].
  pageFunctions?: Record<string, Function>;
  // May return a disposer; hooks are restarted (disposed, then run again) on settings changes.
  main?: (ctx: MainContext) => void | (() => void);
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
