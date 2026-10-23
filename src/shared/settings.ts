export type SettingDef = {
  key: string;
  label: string;
  type: 'boolean' | 'number' | 'enum' | 'stringList';
  default: unknown;
  options?: string[];
  // Shown instead of the raw option value on the settings page.
  optionLabels?: Record<string, string>;
  min?: number;
  max?: number;
};

// Returns the value when it fits the definition, otherwise the default.
// Hand-edited or stale settings files must never break a plugin.
export function validateSetting(def: SettingDef, value: unknown): unknown {
  switch (def.type) {
    case 'boolean':
      return typeof value === 'boolean' ? value : def.default;
    case 'number': {
      const ok =
        typeof value === 'number' &&
        Number.isFinite(value) &&
        (def.min === undefined || value >= def.min) &&
        (def.max === undefined || value <= def.max);
      return ok ? value : def.default;
    }
    case 'enum':
      return typeof value === 'string' && (def.options ?? []).includes(value) ? value : def.default;
    case 'stringList':
      return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : def.default;
  }
}
