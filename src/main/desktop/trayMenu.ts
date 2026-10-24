import type { MenuItemConstructorOptions } from 'electron';
import type { PlayerControls } from '../../shared/plugin';

const APP = 'The Tube Desktop';
const MAX_TITLE = 60;

// The tray menu for the current window and PiP state (spec §2.9). Pure, so it's testable.
export function trayMenuTemplate(state: { visible: boolean; pipOpen: boolean }, c: PlayerControls): MenuItemConstructorOptions[] {
  return [
    { label: `${state.visible ? 'Hide' : 'Show'} ${APP}`, click: () => c.showHide() },
    { type: 'separator' },
    { label: 'Play/pause', click: () => c.playPause() },
    { label: 'Next', click: () => c.next() },
    { label: 'Previous', click: () => c.previous() },
    { label: state.pipOpen ? 'Close picture-in-picture' : 'Picture-in-picture', click: () => c.togglePip() },
    { type: 'separator' },
    { label: 'Settings', click: () => c.openSettings() },
    { label: 'Quit', click: () => c.quit() },
  ];
}

export function trayTooltip(title: string | null): string {
  if (!title) return APP;
  const t = title.length > MAX_TITLE ? title.slice(0, MAX_TITLE - 1) + '…' : title;
  return `${APP} — ${t}`;
}
