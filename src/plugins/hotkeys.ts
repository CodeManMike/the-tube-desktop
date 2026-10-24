import { normaliseAccelerator } from '../main/desktop/accelerator';
import { PlayerControls, Plugin } from '../shared/plugin';
import { SettingDef } from '../shared/settings';

// Global shortcuts (spec §2.9). Defaults are the builder's call (spec §8). Media keys are
// never registered: YouTube and the Windows media overlay already handle them.
const ACTIONS: [key: string, label: string, def: string, run: (c: PlayerControls) => void][] = [
  ['playPause', 'Play/pause', 'Ctrl+Alt+Space', (c) => c.playPause()],
  ['next', 'Next', 'Ctrl+Alt+Right', (c) => c.next()],
  ['previous', 'Previous', 'Ctrl+Alt+Left', (c) => c.previous()],
  ['pip', 'Picture-in-picture', 'Ctrl+Alt+P', (c) => c.togglePip()],
];

export const hotkeys: Plugin = {
  manifest: {
    id: 'hotkeys',
    name: 'Global hotkeys',
    hint: "Work even when TTD isn't focused.",
    defaultEnabled: true,
    settings: ACTIONS.map(([key, label, def]): SettingDef => ({ key, label, type: 'text', default: def, maxLength: 40 })),
  },
  main: (ctx) => {
    const registered: string[] = [];
    for (const [key, , , run] of ACTIONS) {
      const accel = normaliseAccelerator(String(ctx.settings?.[key] ?? ''));
      if (!accel) continue;
      // Windows refuses a shortcut another app already holds; skip it, keep the rest.
      if (ctx.shortcuts.register(accel, () => run(ctx.controls))) registered.push(accel);
      else ctx.log(`[hotkeys] ${accel} is taken by another app; skipped`);
    }
    return () => {
      for (const accel of registered) ctx.shortcuts.unregister(accel);
    };
  },
};
