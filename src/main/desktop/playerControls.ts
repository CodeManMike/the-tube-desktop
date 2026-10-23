import type { BrowserWindow, WebContents } from 'electron';
import type { PlayerControls } from '../../shared/plugin';

const TOGGLE = `(() => {
  const p = document.querySelector('#movie_player');
  if (!p || !p.getPlayerState) return;
  p.getPlayerState() === 1 ? p.pauseVideo() : p.playVideo();
})()`;

// The one place tray and hotkeys act through. Play/pause goes to whichever player is active
// (PiP if open, else the main window); next/previous step the queue like PiP's buttons.
export function createPlayerControls(deps: {
  activeContents(): Pick<WebContents, 'executeJavaScript'> | null;
  queue: { step(direction: 'next' | 'previous'): void };
  pip: { isOpen(): boolean; open(): void; close(): void };
  mainWindow(): BrowserWindow | null;
  openSettings(): void;
  quit(): void;
  nowPlaying(): string | null;
}): PlayerControls {
  return {
    playPause: () => {
      deps.activeContents()?.executeJavaScript(TOGGLE).catch(() => {});
    },
    next: () => deps.queue.step('next'),
    previous: () => deps.queue.step('previous'),
    togglePip: () => (deps.pip.isOpen() ? deps.pip.close() : deps.pip.open()),
    showHide: () => {
      const win = deps.mainWindow();
      if (!win) return;
      if (win.isVisible() && win.isFocused()) win.hide();
      else {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      }
    },
    openSettings: () => deps.openSettings(),
    quit: () => deps.quit(),
    nowPlaying: () => deps.nowPlaying(),
  };
}
