import fs from 'fs';
import { SettingDef, validateSetting } from '../shared/settings';
import { writeFileAtomic } from './atomicFile';

export type WindowState = { x: number; y: number; width: number; height: number; maximized: boolean };

type PluginState = { enabled?: boolean; values?: Record<string, unknown> };
type SettingsFile = { plugins: Record<string, PluginState>; window?: WindowState };

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function validWindowState(v: unknown): WindowState | undefined {
  if (!isPlainObject(v)) return undefined;
  const { x, y, width, height, maximized } = v;
  const nums = [x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n));
  return nums && typeof maximized === 'boolean' ? (v as WindowState) : undefined;
}

// Keep only well-formed entries, so a hand-edited file can never wedge later writes.
function sanitise(parsed: unknown): SettingsFile {
  if (!isPlainObject(parsed) || !isPlainObject(parsed.plugins)) throw new Error('unexpected shape');
  const plugins: Record<string, PluginState> = {};
  for (const [id, entry] of Object.entries(parsed.plugins)) {
    if (!isPlainObject(entry)) continue;
    plugins[id] = {
      ...(typeof entry.enabled === 'boolean' && { enabled: entry.enabled }),
      ...(isPlainObject(entry.values) && { values: entry.values }),
    };
  }
  return { plugins, window: validWindowState(parsed.window) };
}

export class SettingsStore {
  private data: SettingsFile;

  constructor(private readonly file: string) {
    this.data = this.load();
  }

  private load(): SettingsFile {
    try {
      return sanitise(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`[settings] reset: ${(err as Error).message}`);
      }
      return { plugins: {} };
    }
  }

  private save(): void {
    writeFileAtomic(this.file, JSON.stringify(this.data, null, 2));
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
