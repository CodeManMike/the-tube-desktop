import { app } from 'electron';
import { Plugin } from '../shared/plugin';

// Turning the plugin on is the setting: TTD opens when you sign in to Windows.
export function startupHook(setOpenAtLogin: (on: boolean) => void): () => void {
  setOpenAtLogin(true);
  return () => setOpenAtLogin(false);
}

export const startup: Plugin = {
  manifest: { id: 'startup', name: 'Start with Windows', defaultEnabled: false, settings: [] },
  main: () =>
    // Only the installed app registers itself; a dev run would register electron.exe.
    app.isPackaged ? startupHook((on) => app.setLoginItemSettings({ openAtLogin: on })) : undefined,
};
