import { app, BrowserWindow, Menu, components, session } from 'electron';
import path from 'path';
import { PARTITION } from './config';
import { migrateLegacyProfile } from './migrate';
import { attachPageBundle } from './pageBundle';
import { asExpression } from './pluginRegistry';
import { hideShorts } from '../plugins/hideShorts';

const ICON = path.join(app.getAppPath(), 'assets', 'icons', 'favicon.ico');

// YouTube gets a plain Chrome UA. Google sign-in gets the honest Electron UA instead:
// a UA claiming Chrome while client hints say "Chromium" is what trips
// "This browser or app may not be secure".
const ELECTRON_UA = app.userAgentFallback;
app.userAgentFallback = ELECTRON_UA
  .replace(/ Electron\/\S+/, '')
  // Electron adds the product name without spaces ("TheTubeDesktop/0.0.1").
  .replace(/ (TheTubeDesktop|the-tube(-desktop)?)\/\S+/i, '');
const SIGNIN_URLS = ['https://accounts.google.com/*', 'https://accounts.youtube.com/*'];

app.setAppUserModelId('com.thetubedesktop.app');
console.log('[migrate]', migrateLegacyProfile(path.join(app.getPath('appData'), 'Electron'), app.getPath('userData')));

function useHonestUaForSignIn(): void {
  session.fromPartition(PARTITION).webRequest.onBeforeSendHeaders(
    { urls: SIGNIN_URLS },
    (details, callback) => {
      callback({ requestHeaders: { ...details.requestHeaders, 'User-Agent': ELECTRON_UA } });
    },
  );
}

let mainWindow: BrowserWindow | null = null;

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    autoHideMenuBar: true,
    icon: ICON,
    title: 'The Tube Desktop',
    webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  return win;
}

function buildMenu(): void {
  const menu = Menu.buildFromTemplate([
    {
      label: 'TTD',
      submenu: [
        {
          label: 'DevTools',
          accelerator: 'Ctrl+Shift+I',
          click: () => mainWindow?.webContents.toggleDevTools(),
        },
        { role: 'reload' },
        { role: 'quit' },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(async () => {
  await components.whenReady();
  console.log('[widevine]', components.status());
  console.log('[ua]', app.userAgentFallback);

  buildMenu();
  useHonestUaForSignIn();
  mainWindow = createMainWindow();

  // Diagnostic: is the saved session present, and does YouTube accept it?
  mainWindow.webContents.on('did-finish-load', async () => {
    const wc = mainWindow!.webContents;
    const sid = await wc.session.cookies.get({ domain: '.youtube.com', name: 'SID' });
    const loggedIn = await wc
      .executeJavaScript('window.ytcfg ? ytcfg.get("LOGGED_IN") : "no ytcfg"')
      .catch(() => 'n/a');
    console.log('[session]', wc.getURL(), 'SID cookies:', sid.length, 'LOGGED_IN:', loggedIn);
  });

  // Temporary until the plugin registry is wired in (Task 6).
  const shorts = asExpression(hideShorts.transforms!.browse!);
  await attachPageBundle(mainWindow.webContents, () => [
    { id: 'hideShorts', settings: {}, transforms: { browse: shorts, next: shorts, search: shorts, initialData: shorts }, css: hideShorts.css },
  ]);

  // YouTube redirects the first load (?themeRefresh=1), which aborts the original navigation.
  mainWindow.loadURL('https://www.youtube.com').catch((err) => {
    if (err.code !== 'ERR_ABORTED') console.error('[load]', err);
  });
});

app.on('window-all-closed', () => app.quit());
