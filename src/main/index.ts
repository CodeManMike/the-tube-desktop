import { app, BrowserWindow, Menu, components, screen, session, shell } from 'electron';
import path from 'path';
import { PARTITION } from './config';
import { migrateLegacyProfile } from './migrate';
import { attachPageBundle, PageBundleHandle } from './pageBundle';
import { PluginRegistry } from './pluginRegistry';
import { permissionAllowed, routeUrl } from './policy';
import { SettingsStore } from './settingsStore';
import { closeSettingsWindow, openSettingsWindow, registerSettingsIpc } from './settingsWindow';
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

let mainWindow: BrowserWindow | null = null;
let bundle: PageBundleHandle | null = null;

// Two instances on one profile can't share the cookie database, so a second one
// would start signed out. Hand over to the running window instead.
const isPrimary = app.requestSingleInstanceLock();
if (!isPrimary) {
  console.log('[ttd] already running; focusing the existing window');
  app.quit();
} else {
  console.log('[migrate]', migrateLegacyProfile(path.join(app.getPath('appData'), 'Electron'), app.getPath('userData')));
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

function openInBrowser(url: string): void {
  shell.openExternal(url).catch((err) => console.warn('[open]', err.message));
}

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

  // Only YouTube and Google sign-in load in the signed-in session. Web links open in the
  // default browser; every other scheme is dropped (see routeUrl).
  win.webContents.setWindowOpenHandler(({ url }) => {
    const route = routeUrl(url);
    if (route.action === 'app') win.loadURL(url).catch(() => {});
    else if (route.action === 'external') openInBrowser(route.url);
    return { action: 'deny' };
  });
  const guard = (event: Electron.Event, url: string) => {
    const route = routeUrl(url);
    if (route.action === 'app') return;
    event.preventDefault();
    if (route.action === 'external') openInBrowser(route.url);
  };
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== 'about:blank') guard(event, url);
  });
  // Server-side redirects (e.g. an in-app URL bouncing to another site) skip will-navigate.
  win.webContents.on('will-redirect', (event, url, _inPlace, isMainFrame) => {
    if (isMainFrame) guard(event, url);
  });
  win.on('closed', () => {
    mainWindow = null;
    closeSettingsWindow();
  });
  return win;
}

function buildMenu(): void {
  const menu = Menu.buildFromTemplate([
    {
      label: 'TTD',
      submenu: [
        { label: 'Settings', accelerator: 'Ctrl+,', click: () => openSettingsWindow() },
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

if (isPrimary) app.whenReady().then(async () => {
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
    const page = await wc
      .executeJavaScript(
        '({ loggedIn: window.ytcfg ? ytcfg.get("LOGGED_IN") : "no ytcfg",' +
          ' rewrite: !!(Object.getOwnPropertyDescriptor(window, "ytInitialData") || {}).get })',
      )
      .catch(() => ({ loggedIn: 'n/a', rewrite: 'n/a' }));
    console.log('[session]', wc.getURL(), 'SID cookies:', sid.length, 'LOGGED_IN:', page.loggedIn, 'rewrite active:', page.rewrite);
  });

  // A plugin the page turned off after repeated failures stays off for this session.
  // Dev-only research hook: TTD_DEV_EVAL=<file> runs that script in the page after each
  // load and logs what it returns. Never set in normal use.
  const devEval = process.env.TTD_DEV_EVAL;
  if (devEval) {
    mainWindow.webContents.on('did-finish-load', async () => {
      const wc = mainWindow!.webContents;
      if (!wc.getURL().startsWith('https://www.youtube.com/')) return;
      const result = await wc
        .executeJavaScript(require('fs').readFileSync(devEval, 'utf8'))
        .catch((err: Error) => `error: ${err.message}`);
      console.log('[dev-eval]', JSON.stringify(result));
    });
  }

  bundle = await attachPageBundle(
    mainWindow.webContents,
    () => registry.pageEntries(),
    (id) => {
      registry.disableForSession(id);
      bundle?.refresh().catch((err) => console.warn('[bundle] refresh failed:', err.message));
    },
  );

  // A settings change rebuilds the page bundle and reloads YouTube; debounced so a
  // burst of edits causes one reload.
  let reloadTimer: NodeJS.Timeout | undefined;
  registerSettingsIpc(registry, store, () => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(async () => {
      try {
        await bundle?.refresh();
        mainWindow?.webContents.reload();
      } catch (err) {
        console.warn('[settings] apply failed:', (err as Error).message);
      }
    }, 400);
  });
  registry.runMainHooks({ mainWindow, store, log: (msg) => console.log(msg) });

  // YouTube redirects the first load (?themeRefresh=1), which aborts the original navigation.
  mainWindow.loadURL(HOME).catch((err) => {
    if (err.code !== 'ERR_ABORTED') console.error('[load]', err);
  });
});

app.on('window-all-closed', () => app.quit());
