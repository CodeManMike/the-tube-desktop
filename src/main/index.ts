import { app, BrowserWindow, Menu, components, screen, session, shell } from 'electron';
import path from 'path';
import { PARTITION } from './config';
import { migrateLegacyProfile } from './migrate';
import { attachPageBundle, PageBundleHandle } from './pageBundle';
import { PluginRegistry } from './pluginRegistry';
import { isInAppUrl, permissionAllowed } from './policy';
import { SettingsStore } from './settingsStore';
import { restoreBounds } from './windowState';
import { ALL_PLUGINS } from '../plugins';

const ICON = path.join(app.getAppPath(), 'assets', 'icons', 'favicon.ico');
const HOME = 'https://www.youtube.com';

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

let mainWindow: BrowserWindow | null = null;
let bundle: PageBundleHandle | null = null;

function configureSession(): void {
  const ses = session.fromPartition(PARTITION);
  ses.webRequest.onBeforeSendHeaders({ urls: SIGNIN_URLS }, (details, callback) => {
    callback({ requestHeaders: { ...details.requestHeaders, 'User-Agent': ELECTRON_UA } });
  });
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(permissionAllowed(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => permissionAllowed(permission));
}

export function createMainWindow(store: SettingsStore): BrowserWindow {
  const saved = store.getWindowState();
  const bounds = restoreBounds(
    saved,
    screen.getAllDisplays().map((d) => d.workArea),
    { x: 0, y: 0, width: 1600, height: 900 },
  );
  const win = new BrowserWindow({
    ...bounds,
    autoHideMenuBar: true,
    icon: ICON,
    title: 'The Tube Desktop',
    webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  if (saved?.maximized) win.maximize();

  win.on('close', () => store.setWindowState({ ...win.getNormalBounds(), maximized: win.isMaximized() }));

  // Only YouTube and Google sign-in load in the signed-in session; other links open in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isInAppUrl(url)) win.loadURL(url);
    else shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (isInAppUrl(url) || url === 'about:blank') return;
    event.preventDefault();
    shell.openExternal(url);
  });
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

  const store = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'));
  const registry = new PluginRegistry(ALL_PLUGINS, store);

  buildMenu();
  configureSession();
  mainWindow = createMainWindow(store);

  // Diagnostic: is the saved session present, and does YouTube accept it?
  mainWindow.webContents.on('did-finish-load', async () => {
    const wc = mainWindow!.webContents;
    const sid = await wc.session.cookies.get({ domain: '.youtube.com', name: 'SID' });
    const loggedIn = await wc
      .executeJavaScript('window.ytcfg ? ytcfg.get("LOGGED_IN") : "no ytcfg"')
      .catch(() => 'n/a');
    console.log('[session]', wc.getURL(), 'SID cookies:', sid.length, 'LOGGED_IN:', loggedIn);
  });

  bundle = await attachPageBundle(mainWindow.webContents, () => registry.pageEntries());
  registry.runMainHooks({ mainWindow, store, log: (msg) => console.log(msg) });

  // YouTube redirects the first load (?themeRefresh=1), which aborts the original navigation.
  mainWindow.loadURL(HOME).catch((err) => {
    if (err.code !== 'ERR_ABORTED') console.error('[load]', err);
  });
});

app.on('window-all-closed', () => app.quit());
