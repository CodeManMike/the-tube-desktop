import fs from 'fs';
import { SettingDef, validateSetting } from '../shared/settings';

export type WindowState = { x: number; y: number; width: number; height: number; maximized: boolean };

type PluginState = { enabled?: boolean; values?: Record<string, unknown> };
type SettingsFile = { plugins: Record<string, PluginState>; window?: WindowState };

export class SettingsStore {
  private data: SettingsFile;

  constructor(private readonly file: string) {
    this.data = this.load();
  }

  private load(): SettingsFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (parsed && typeof parsed === 'object' && parsed.plugins && typeof parsed.plugins === 'object') {
        return parsed as SettingsFile;
      }
      console.warn('[settings] reset: unexpected shape');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`[settings] reset: ${(err as Error).message}`);
      }
    }
    return { plugins: {} };
  }

  // Write to a temp file then rename, so a crash mid-write never leaves a torn file.
  private save(): void {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  private plugin(id: string): PluginState {
    return (this.data.plugins[id] ??= {});
  }

  isEnabled(id: string, defaultEnabled: boolean): boolean {
    const enabled = this.data.plugins[id]?.enabled;
    return typeof enabled === 'boolean' ? enabled : defaultEnabled;
  }

  setEnabled(id: string, on: boolean): void {
    this.plugin(id).enabled = on;
    this.save();
  }

  values(id: string, defs: SettingDef[]): Record<string, unknown> {
    const stored = this.data.plugins[id]?.values ?? {};
    return Object.fromEntries(defs.map((def) => [def.key, validateSetting(def, stored[def.key])]));
  }

  setValue(id: string, def: SettingDef, value: unknown): void {
    (this.plugin(id).values ??= {})[def.key] = validateSetting(def, value);
    this.save();
  }

  getWindowState(): WindowState | undefined {
    return this.data.window;
  }

  setWindowState(state: WindowState): void {
    this.data.window = state;
    this.save();
  }
}
