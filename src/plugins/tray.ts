import { app, Menu, Tray } from 'electron';
import path from 'path';
import { trayMenuTemplate, trayTooltip } from '../main/desktop/trayMenu';
import { Plugin } from '../shared/plugin';

// Tray icon (spec §2.9): a left click shows or hides TTD, the menu holds the player controls.
export const tray: Plugin = {
  manifest: {
    id: 'tray',
    name: 'Tray icon',
    defaultEnabled: true,
    settings: [{ key: 'closeToTray', label: 'Keep running in the tray when closed', type: 'boolean', default: false }],
  },
  main: (ctx) => {
    const icon = new Tray(path.join(app.getAppPath(), 'assets', 'icons', 'favicon.ico'));
    const menu = () =>
      Menu.buildFromTemplate(
        trayMenuTemplate({ visible: !!ctx.mainWindow?.isVisible() && !ctx.mainWindow.isMinimized(), pipOpen: ctx.controls.isPipOpen() }, ctx.controls),
      );
    icon.setToolTip(trayTooltip(null));
    icon.on('click', () => ctx.controls.showHide());
    icon.on('right-click', () => icon.popUpContextMenu(menu()));
    let lastTip = '';
    const tip = setInterval(() => {
      const t = trayTooltip(ctx.controls.nowPlaying());
      if (t !== lastTip && !icon.isDestroyed()) icon.setToolTip((lastTip = t));
    }, 5000);
    ctx.setHideOnClose(ctx.settings?.closeToTray === true);
    return () => {
      clearInterval(tip);
      ctx.setHideOnClose(false);
      icon.destroy();
      // Without its tray icon, a window hidden in the tray would be unreachable: bring it back.
      if (ctx.mainWindow && !ctx.mainWindow.isDestroyed() && !ctx.mainWindow.isVisible()) ctx.mainWindow.show();
    };
  },
};
