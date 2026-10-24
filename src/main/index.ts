import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, components, net, screen, session, shell } from 'electron';
import path from 'path';
import { PARTITION } from './config';
import { migrateLegacyProfile } from './migrate';
import { attachPageBundle, PageBundleHandle } from './pageBundle';
import { PluginRegistry } from './pluginRegistry';
import { permissionAllowed, Route, routeUrl } from './policy';
import { SettingsStore } from './settingsStore';
import { closeSettingsWindow, openSettingsWindow, registerSettingsIpc } from './settingsWindow';
import { restoreBounds } from './windowState';
import { ALL_PLUGINS } from '../plugins';
import { HistoryStore } from './history/historyStore';
import { QueueModel } from './queue/model';
import { QueueService } from './queue/queueService';
import { QueueStore } from './queue/queueStore';
import { PipWindow } from './pip/pipWindow';
import { SponsorBlockClient } from './skip/sponsorBlock';
import { createPlayerControls, revealWindow } from './desktop/playerControls';
import { SignInWatcher } from './account/signInWatcher';
import { consumeInstallOptions } from './installOptions';
import { KOFI_URL } from '../shared/links';
import { RydClient } from './ryd';

const ICON = path.join(app.getAppPath(), 'assets', 'icons', 'favicon.ico');
const HOME = 'https://www.youtube.com';

// YouTube gets a plain Chrome UA. Google sign-in gets the honest Electron UA instead:
// a UA claiming Chrome while client hints say "Chromium" is what trips
// "This browser or app may not be secure".
const ELECTRON_UA = app.userAgentFallback;
app.userAgentFallback = ELECTRON_UA
  .replace(/ Electron\/\S+/, '')
  // Electron adds the product name without spaces ("TheTubeDesktop/1.0.0").
  .replace(/ (TheTubeDesktop|the-tube(-desktop)?)\/\S+/i, '');
const SIGNIN_URLS = ['https://accounts.google.com/*', 'https://accounts.youtube.com/*'];

app.setAppUserModelId('com.thetubedesktop.app');

let mainWindow: BrowserWindow | null = null;
let bundle: PageBundleHandle | null = null;
let queueService: QueueService | null = null;
let pipWindow: PipWindow | null = null;
// Tray "Keep running in the tray when closed": closing hides the window until a real quit.
let hideOnClose = false;
let quitting = false;

// Two instances on one profile can't share the cookie database, so a second one
// would start signed out. Hand over to the running window instead.
const isPrimary = app.requestSingleInstanceLock();
if (!isPrimary) {
  console.log('[ttd] already running; focusing the existing window');
  app.quit();
} else {
  console.log('[migrate]', migrateLegacyProfile(path.join(app.getPath('appData'), 'Electron'), app.getPath('userData')));
  app.on('second-instance', () => {
    // Opening TTD again brings it back, even when it's hidden in the tray.
    if (mainWindow) revealWindow(mainWindow);
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
  ses.setPermissionRequestHandler((_wc, permission, callback, details: any) => {
    const ok = permissionAllowed(permission, details?.mediaTypes);
    console.log(`[permission] ${permission}${details?.mediaTypes ? ` (${details.mediaTypes.join(', ')})` : ''} ${ok ? 'allowed' : 'denied'}`);
    callback(ok);
  });
  ses.setPermissionCheckHandler((_wc, permission, _origin, details: any) =>
    permissionAllowed(permission, details?.mediaType ? [details.mediaType] : undefined),
  );
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
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, '..', 'preload', 'main.js'),
    },
  });
  win.setMenuBarVisibility(false);
  if (saved?.maximized) win.maximize();

  win.on('close', (event) => {
    if (hideOnClose && !quitting) {
      event.preventDefault();
      win.hide();
      return;
    }
    store.setWindowState({ ...win.getNormalBounds(), maximized: win.isMaximized() });
  });

  // Only YouTube and Google sign-in load in the signed-in session. Web links open in the
  // default browser; every other scheme is dropped (see routeUrl).
  win.webContents.setWindowOpenHandler(({ url }) => {
    const route = routeUrl(url);
    if (route.action === 'app') win.loadURL(url).catch(() => {});
    else if (route.action === 'external') openInBrowser(route.url);
    else if (route.action === 'queueAdd') queueService?.addById(route.videoId);
    else if (route.action === 'blockChannel') blockChannel(route);
    return { action: 'deny' };
  });
  const guard = (event: Electron.Event, url: string) => {
    const route = routeUrl(url);
    if (route.action === 'app') return;
    event.preventDefault();
    if (route.action === 'external') openInBrowser(route.url);
    else if (route.action === 'queueAdd') queueService?.addById(route.videoId);
    else if (route.action === 'blockChannel') blockChannel(route);
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
    pipWindow?.dismiss();
    closeSettingsWindow();
  });
  return win;
}

// "Block channel" from a video's ⋮ menu (plugins/channelBlocklist.ts): add it to the list,
// rebuild the page bundle for future pages, and hide it now. No reload, so playback goes on.
let settingsStore: SettingsStore | null = null;
function blockChannel(route: Extract<Route, { action: 'blockChannel' }>): void {
  const def = ALL_PLUGINS.find((p) => p.manifest.id === 'channelBlocklist')?.manifest.settings.find((d) => d.key === 'channels');
  if (!def || !settingsStore) return;
  const list = (settingsStore.values('channelBlocklist', [def]).channels as string[]) ?? [];
  if (!list.some((line) => line.includes(route.channelId))) {
    settingsStore.setValue('channelBlocklist', def, [...list, `${route.name} (${route.channelId})`]);
    console.log(`[blocklist] blocked ${route.channelId}`);
  }
  bundle?.refresh().catch((err) => console.warn('[bundle] refresh failed:', err.message));
  mainWindow?.webContents.send('blocklist:added', { channelId: route.channelId, handle: route.handle, name: route.name });
}

function buildMenu(): void {
  const menu = Menu.buildFromTemplate([
    {
      label: 'TTD',
      submenu: [
        { label: 'Settings', accelerator: 'Ctrl+,', click: () => openSettingsWindow() },
        {
          label: 'Picture-in-picture',
          accelerator: 'Ctrl+Shift+P',
          click: () => (pipWindow?.isOpen() ? pipWindow.close() : pipWindow?.open()),
        },
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
  settingsStore = store;
  // A fresh install leaves the installer's "Choose your settings" answers for the first run.
  consumeInstallOptions(path.join(app.getPath('userData'), 'install-options.json'), store, ALL_PLUGINS);
  const registry = new PluginRegistry(ALL_PLUGINS, store);

  buildMenu();
  configureSession();
  mainWindow = createMainWindow(store);

  // The queue is owned here, persisted on every change, and survives restarts.
  const userData = app.getPath('userData');
  const queueStore = new QueueStore(path.join(userData, 'queue.json'));
  const history = new HistoryStore(path.join(userData, 'history.json'));
  const queueDefs = ALL_PLUGINS.find((p) => p.manifest.id === 'queue')?.manifest.settings ?? [];
  queueService = new QueueService(
    new QueueModel(queueStore.load()),
    queueStore,
    history,
    async (url) => {
      const res = await net.fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    () => {
      const v = store.values('queue', queueDefs);
      return { batchSize: Number(v.batchSize ?? 10), watchedPercent: Number(v.watchedPercent ?? 80) };
    },
  );
  queueService.attach(mainWindow.webContents);
  pipWindow = new PipWindow(mainWindow, queueService, store, ICON, () => registry.pageEntries('pip'));
  // The player's PiP button (plugins/pip.ts), from YouTube in the main window only.
  ipcMain.on('pip:open', (event) => {
    if (event.sender !== mainWindow?.webContents || !/^https:\/\/www\.youtube\.com\//.test(event.senderFrame?.url ?? '')) return;
    pipWindow?.open();
  });
  // The sidebar's "TTD settings" entry (plugins/settingsLink.ts), likewise main window only.
  ipcMain.on('settings:open', (event) => {
    if (event.sender !== mainWindow?.webContents || !/^https:\/\/www\.youtube\.com\//.test(event.senderFrame?.url ?? '')) return;
    openSettingsWindow();
  });
  // SponsorBlock lookups for the main window and PiP (plugins/sponsorBlock.ts). Made here,
  // on the default session, so no YouTube cookies go with them.
  const sponsorBlock = new SponsorBlockClient(async (url) => {
    const res = await net.fetch(url, { signal: AbortSignal.timeout(5000) });
    if (res.status === 404) return []; // SponsorBlock's answer for "nothing in this bucket"
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });
  ipcMain.handle('skip:segments', (event, videoId: unknown) => {
    const fromApp = event.sender === mainWindow?.webContents || !!pipWindow?.ownsSender(event.sender);
    const fromYouTube = /^https:\/\/www\.youtube\.com\//.test(event.senderFrame?.url ?? '');
    if (!fromApp || !fromYouTube || typeof videoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
      console.warn('[sponsorblock] ignored an invalid lookup request');
      return [];
    }
    return sponsorBlock.segments(videoId);
  });
  // Show dislikes (plugins/ryd.ts): Return YouTube Dislike counts, for the main window only.
  const ryd = new RydClient(async (url) => {
    const res = await net.fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });
  ipcMain.handle('ryd:votes', (event, videoId: unknown) => {
    const ok = event.sender === mainWindow?.webContents && /^https:\/\/www\.youtube\.com\//.test(event.senderFrame?.url ?? '');
    if (!ok || typeof videoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
      console.warn('[ryd] ignored an invalid lookup request');
      return null;
    }
    return ryd.votes(videoId);
  });
  // Hide watched (plugins/hideWatched.ts): TTD's own history, for the main window only.
  ipcMain.handle('history:watched', (event, threshold: unknown) => {
    const ok = event.sender === mainWindow?.webContents && /^https:\/\/www\.youtube\.com\//.test(event.senderFrame?.url ?? '');
    if (!ok || typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 50 || threshold > 100) {
      console.warn('[history] ignored an invalid watched-list request');
      return [];
    }
    return history.watchedIds(threshold);
  });
  setInterval(() => history.flush(), 30_000);
  app.on('before-quit', () => queueService?.flush());

  // Sign-out detection (spec §2.1): one prompt when someone who was signed in gets signed out.
  const SIGN_IN_URL =
    'https://accounts.google.com/ServiceLogin?service=youtube&passive=true&continue=https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue%26next%3D%252F';
  const signIn = new SignInWatcher({
    wasSignedIn: store.getAccount().wasSignedIn,
    save: (v) => store.setAccount({ wasSignedIn: v }),
    hasSidCookie: async () => (await session.fromPartition(PARTITION).cookies.get({ domain: '.youtube.com', name: 'SID' })).length > 0,
    prompt: async () => {
      if (!mainWindow) return;
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'The Tube Desktop',
        message: "You've been signed out of YouTube",
        buttons: ['Sign in', 'Reload', 'Not now'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      });
      if (response === 0) mainWindow?.loadURL(SIGN_IN_URL).catch(() => {});
      else if (response === 1) mainWindow?.webContents.reload();
      else signIn.dismissed();
    },
  });
  session.fromPartition(PARTITION).cookies.on('changed', (_event, cookie, cause, removed) => {
    if (removed && cause !== 'overwrite' && cookie.domain === '.youtube.com') signIn.cookieRemoved(cookie.name);
  });

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
    if (wc.getURL().startsWith('https://www.youtube.com/')) signIn.pageLoaded(typeof page.loggedIn === 'boolean' ? page.loggedIn : null);
  });

  // A plugin the page turned off after repeated failures stays off for this session.
  // Dev-only research hook: TTD_DEV_EVAL=<file> runs that script in the page after each
  // load and logs what it returns. Never set in normal use.
  const devEval = process.env.TTD_DEV_EVAL;
  if (devEval) {
    // Scripted test runs play lots of video: keep them silent.
    mainWindow.webContents.setAudioMuted(true);
    // Research scripts can ask for a screenshot of the page: console.log('[ttd-dev] capture <name>').
    mainWindow.webContents.on('console-message', async (event: any, _level?: number, legacy?: string) => {
      const m = String(event.message ?? legacy ?? '').match(/^\[ttd-dev\] capture ([\w-]+)$/);
      if (!m) return;
      const shot = await mainWindow!.webContents.capturePage().catch((err: Error) => console.warn('[dev-capture] failed:', err.message));
      if (!shot) return;
      require('fs').writeFileSync(path.join(path.dirname(devEval), `${m[1]}.png`), shot.toPNG());
      console.log('[dev-capture]', m[1]);
    });
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
  // Tray, hotkeys and anything else with main-process parts act through these controls.
  const controls = createPlayerControls({
    activeContents: () => pipWindow?.contents() ?? mainWindow?.webContents ?? null,
    queue: { step: (dir) => queueService?.step(dir) },
    pip: { isOpen: () => !!pipWindow?.isOpen(), open: () => void pipWindow?.open(), close: () => pipWindow?.close() },
    mainWindow: () => mainWindow,
    openSettings: () => openSettingsWindow(),
    support: () => openInBrowser(KOFI_URL),
    quit: () => app.quit(),
    nowPlaying: () => queueService?.nowPlaying() ?? null,
  });
  const hookContext = {
    mainWindow,
    store,
    log: (msg: string) => console.log(msg),
    controls,
    shortcuts: { register: (a: string, fn: () => void) => globalShortcut.register(a, fn), unregister: (a: string) => globalShortcut.unregister(a) },
    setHideOnClose: (on: boolean) => (hideOnClose = on),
  };
  registerSettingsIpc(registry, store, (pluginId) => {
    // Only the changed plugin's main hook restarts (the tray icon isn't recreated for, say, a theme change).
    registry.restartMainHooks(hookContext, pluginId);
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
  registry.restartMainHooks(hookContext);

  // YouTube redirects the first load (?themeRefresh=1), which aborts the original navigation.
  mainWindow.loadURL(HOME).catch((err) => {
    if (err.code !== 'ERR_ABORTED') console.error('[load]', err);
  });
});

app.on('before-quit', () => (quitting = true));
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
