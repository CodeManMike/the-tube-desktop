import type { BrowserWindow, WebContents } from 'electron';
import type { PlayerControls } from '../../shared/plugin';

const TOGGLE = `(() => {
  const p = document.querySelector('#movie_player');
  if (!p || !p.getPlayerState) return;
  p.getPlayerState() === 1 ? p.pauseVideo() : p.playVideo();
})()`;

// Brings back a window that's minimised or hidden in the tray. On Windows, focus() alone
// doesn't show a hidden window.
export function revealWindow(win: Pick<BrowserWindow, 'isMinimized' | 'restore' | 'show' | 'focus'>): void {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

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
    isPipOpen: () => deps.pip.isOpen(),
    showHide: () => {
      const win = deps.mainWindow();
      if (!win) return;
      // Not "focused": clicking the tray takes focus from the window before this runs.
      if (win.isVisible() && !win.isMinimized()) win.hide();
      else revealWindow(win);
    },
    openSettings: () => deps.openSettings(),
    quit: () => deps.quit(),
    nowPlaying: () => deps.nowPlaying(),
  };
}
