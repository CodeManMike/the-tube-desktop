// A hotkey typed in Settings, in Electron's canonical form ("Control+Alt+Space"), or null
// when it's empty or not a usable global shortcut. Media keys are refused: YouTube and the
// Windows media overlay already handle them.
const MODIFIERS: Record<string, string> = { ctrl: 'Control', control: 'Control', alt: 'Alt', shift: 'Shift', super: 'Super', win: 'Super' };
const NAMED = ['Space', 'Left', 'Right', 'Up', 'Down', 'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete', 'Plus'];
const ORDER = ['Control', 'Alt', 'Shift', 'Super'];

function key(part: string): string | null {
  if (/^[a-z0-9]$/i.test(part)) return part.toUpperCase();
  const f = part.match(/^f([1-9]|1[0-9]|2[0-4])$/i);
  if (f) return 'F' + f[1];
  return NAMED.find((n) => n.toLowerCase() === part.toLowerCase()) ?? null;
}

export function normaliseAccelerator(input: string): string | null {
  const parts = input.split('+').map((p) => p.trim());
  if (parts.length === 0 || parts.some((p) => !p)) return null;
  const mods = new Set<string>();
  let k: string | null = null;
  for (const part of parts) {
    const mod = MODIFIERS[part.toLowerCase()];
    if (mod) {
      if (mods.has(mod)) return null;
      mods.add(mod);
      continue;
    }
    if (k) return null; // one key only
    k = key(part);
    if (!k) return null;
  }
  if (!k) return null;
  const highF = /^F(1[3-9]|2[0-4])$/.test(k);
  if (!mods.size && !highF) return null;
  return [...ORDER.filter((m) => mods.has(m)), k].join('+');
}
