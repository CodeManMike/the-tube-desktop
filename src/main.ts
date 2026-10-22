import { app, BrowserWindow, Menu, components, session } from 'electron';
import { attachCdpRewrite } from './rewrite/cdp';
import { attachPageRewrite } from './rewrite/page';
import { Rule } from './rewrite/types';
import { hideShorts } from './rules/hideShorts';

// Spike switches: TUBE_REWRITE=cdp|page|off picks the rewrite candidate;
// TUBE_BREAK=1 adds a rule that always throws, to prove the fail-safe.
const REWRITE = process.env.TUBE_REWRITE ?? 'page';
const RULES: Rule[] = [hideShorts];
if (process.env.TUBE_BREAK === '1') {
  RULES.push({ name: 'alwaysThrows', transform: () => { throw new Error('deliberate'); } });
}

export const PARTITION = 'persist:tube';

// YouTube gets a plain Chrome UA. Google sign-in gets the honest Electron UA instead:
// a UA claiming Chrome while client hints say "Chromium" is what trips
// "This browser or app may not be secure".
const ELECTRON_UA = app.userAgentFallback;
app.userAgentFallback = ELECTRON_UA
  .replace(/ Electron\/\S+/, '')
  .replace(/ the-tube\/\S+/, '');
const SIGNIN_URLS = ['https://accounts.google.com/*', 'https://accounts.youtube.com/*'];

function useHonestUaForSignIn(): void {
  session.fromPartition(PARTITION).webRequest.onBeforeSendHeaders(
    { urls: SIGNIN_URLS },
    (details, callback) => {
      callback({ requestHeaders: { ...details.requestHeaders, 'User-Agent': ELECTRON_UA } });
    },
  );
}

// YouTube's service worker fetches on the page's behalf, which hides those
// requests from page-level CDP Fetch interception. YouTube only uses it for
// push and offline caching, so clear it and stop it re-registering.
async function disableServiceWorker(): Promise<void> {
  const ses = session.fromPartition(PARTITION);
  await ses.clearStorageData({ storages: ['serviceworkers'] });
  ses.webRequest.onBeforeRequest({ urls: ['https://www.youtube.com/sw.js*'] }, (_details, callback) =>
    callback({ cancel: true }),
  );
}

let mainWindow: BrowserWindow | null = null;

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    autoHideMenuBar: true,
    webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  return win;
}

function buildMenu(): void {
  const menu = Menu.buildFromTemplate([
    {
      label: 'Tube',
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

// Spike self-check: count Shorts on the home feed across first load, scroll
// continuations and an in-app Home -> Watch -> Home round trip.
async function probe(win: BrowserWindow): Promise<void> {
  const wc = win.webContents;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const count = async (label: string) => {
    const result = await wc.executeJavaScript(`({
      shorts: document.querySelectorAll('ytd-rich-shelf-renderer[is-shorts], ytd-reel-shelf-renderer, ytm-shorts-lockup-view-model, ytd-reel-item-renderer').length,
      videos: document.querySelectorAll('ytd-rich-item-renderer').length,
    })`);
    console.log(`[probe] ${label}`, JSON.stringify(result));
  };
  for (let i = 0; i < 40; i++) {
    const n = await wc.executeJavaScript(`document.querySelectorAll('ytd-rich-item-renderer').length`);
    if (n >= 10) break;
    await wait(500);
  }
  await wait(1500);
  await count('first load');
  for (let i = 0; i < 4; i++) {
    await wc.executeJavaScript('window.scrollTo(0, document.documentElement.scrollHeight)');
    await wait(2500);
  }
  await count('after scroll');
  await wc.executeJavaScript(`document.querySelector('ytd-rich-item-renderer a[href^="/watch"]').click()`);
  await wait(5000);
  console.log('[probe] now at', wc.getURL());
  await wc.executeJavaScript(`document.querySelector('ytd-topbar-logo-renderer a').click()`);
  await wait(5000);
  await count('back home (SPA)');
  wc.openDevTools({ mode: 'detach' });
  await wait(3000);
  console.log('[probe] devtools opened:', wc.isDevToolsOpened(), 'debugger attached:', wc.debugger.isAttached());
  console.log('[probe] done');
}

app.whenReady().then(async () => {
  await components.whenReady();
  console.log('[widevine]', components.status());

  buildMenu();
  useHonestUaForSignIn();
  if (REWRITE === 'cdp') await disableServiceWorker();
  mainWindow = createMainWindow();
  // Spike diagnostic: is the saved session present, and does YouTube accept it?
  mainWindow.webContents.on('did-finish-load', async () => {
    const wc = mainWindow!.webContents;
    const sid = await wc.session.cookies.get({ domain: '.youtube.com', name: 'SID' });
    const loggedIn = await wc
      .executeJavaScript('window.ytcfg ? ytcfg.get("LOGGED_IN") : "no ytcfg"')
      .catch(() => 'n/a');
    console.log('[session]', wc.getURL(), 'SID cookies:', sid.length, 'LOGGED_IN:', loggedIn);
  });

  if (REWRITE === 'cdp') await attachCdpRewrite(mainWindow.webContents, RULES);
  if (REWRITE === 'page') {
    // The Page domain needs a live renderer; a fresh window has none until something loads.
    await mainWindow.loadURL('about:blank');
    await attachPageRewrite(mainWindow.webContents, RULES);
  }
  if (process.env.TUBE_PROBE === '1') mainWindow.webContents.once('did-finish-load', () => probe(mainWindow!));
  console.log('[rewrite] candidate:', REWRITE);

  // YouTube redirects the first load (?themeRefresh=1), which aborts the original navigation.
  mainWindow.loadURL('https://www.youtube.com').catch((err) => {
    if (err.code !== 'ERR_ABORTED') console.error('[load]', err);
  });
});

app.on('window-all-closed', () => app.quit());
