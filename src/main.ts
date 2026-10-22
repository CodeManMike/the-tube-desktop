import { app, BrowserWindow, Menu, components, session } from 'electron';
import { attachCdpRewrite } from './rewrite/cdp';
import { attachPageRewrite } from './rewrite/page';
import { Rule } from './rewrite/types';
import { hideShorts } from './rules/hideShorts';
import { PARTITION } from './config';
import { closePip, getPip, isPipOpen, openPip } from './pip/pipWindow';

export { PARTITION };

// Spike switches: TUBE_REWRITE=cdp|page|off picks the rewrite candidate;
// TUBE_BREAK=1 adds a rule that always throws, to prove the fail-safe.
const REWRITE = process.env.TUBE_REWRITE ?? 'page';
const RULES: Rule[] = [hideShorts];
if (process.env.TUBE_BREAK === '1') {
  RULES.push({ name: 'alwaysThrows', transform: () => { throw new Error('deliberate'); } });
}

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
        {
          label: 'Picture-in-picture',
          accelerator: 'Ctrl+Shift+P',
          click: () => (isPipOpen() ? closePip() : mainWindow && openPip(mainWindow)),
        },
        {
          label: 'Probe native PiP',
          accelerator: 'Ctrl+Shift+D',
          click: () => mainWindow && probeNativePip(mainWindow),
        },
        { role: 'reload' },
        { role: 'quit' },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

// Spike: what native PiP does Electron offer? Runs with a user gesture so
// requestPictureInPicture() is allowed.
async function probeNativePip(win: BrowserWindow): Promise<void> {
  const result = await win.webContents.executeJavaScript(`(async () => {
    const out = { documentPiP: 'documentPictureInPicture' in window };
    const v = document.querySelector('#movie_player video');
    if (!v) return { ...out, video: false };
    try {
      await v.requestPictureInPicture();
      out.standardPiP = !!document.pictureInPictureElement;
    } catch (e) {
      out.standardPiP = 'error: ' + e.message;
    }
    return out;
  })()`, true);
  console.log('[pip-native]', JSON.stringify(result));
}

// Spike self-check for PiP: no-video guard, native PiP, our window, handoff.
async function pipProbe(win: BrowserWindow): Promise<void> {
  const wc = win.webContents;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const js = (target: Electron.WebContents, code: string) => target.executeJavaScript(code);
  for (let i = 0; i < 40 && (await js(wc, `document.querySelectorAll('ytd-rich-item-renderer').length`)) < 10; i++) {
    await wait(500);
  }
  await openPip(win); // on the home page: expect "[pip] no video"
  console.log('[pip-probe] open on home -> pip open?', isPipOpen());

  await js(wc, `document.querySelector('ytd-rich-item-renderer a[href^="/watch"]').click()`);
  await wait(8000);
  await probeNativePip(win);
  await wait(2000);
  await js(wc, `document.pictureInPictureElement && document.exitPictureInPicture()`).catch(() => {});
  await wait(1000);

  const mainBefore = await js(wc, `document.querySelector('#movie_player').getCurrentTime()`);
  await openPip(win);
  await wait(10000);
  const pip = getPip();
  if (!pip) return console.log('[pip-probe] FAIL: no pip window');
  const pc = pip.webContents;
  const state = await js(pc, `(() => ({
    url: location.pathname + location.search,
    time: document.querySelector('#movie_player').getCurrentTime(),
    overlay: !!document.getElementById('tube-pip'),
    bridge: typeof window.tube,
  }))()`);
  const mainState = await js(wc, `document.querySelector('#movie_player').getPlayerState()`);
  console.log('[pip-probe] main was at', mainBefore.toFixed(1), 'main state', mainState, 'pip', JSON.stringify(state),
    'onTop', pip.isAlwaysOnTop(), 'bounds', JSON.stringify(pip.getBounds()));
  require('fs').writeFileSync(require('path').join(__dirname, '..', '.superpowers', 'pip.png'), (await pc.capturePage()).toPNG());

  await js(pc, `window.tube.toggleOnTop()`);
  await wait(500);
  console.log('[pip-probe] after toggle onTop', pip.isAlwaysOnTop());

  const pipTime = await js(pc, `document.querySelector('#movie_player').getCurrentTime()`);
  await js(pc, `window.tube.close(${pipTime})`);
  await wait(3000);
  const back = await js(wc, `(() => { const p = document.querySelector('#movie_player'); return { time: p.getCurrentTime(), state: p.getPlayerState() }; })()`);
  console.log('[pip-probe] pip closed at', pipTime.toFixed(1), 'main now', JSON.stringify(back), 'pip open?', isPipOpen());
  console.log('[pip-probe] done');
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
  await wc.loadURL('https://www.youtube.com/results?search_query=minecraft').catch(() => {});
  await wait(6000);
  console.log('[probe] search', JSON.stringify(await wc.executeJavaScript(`({
    videos: document.querySelectorAll('ytd-video-renderer').length,
    shorts: document.querySelectorAll('ytd-reel-shelf-renderer, ytm-shorts-lockup-view-model, grid-shelf-view-model').length,
  })`)));
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
  if (process.env.TUBE_PIPPROBE === '1') mainWindow.webContents.once('did-finish-load', () => pipProbe(mainWindow!));
  console.log('[rewrite] candidate:', REWRITE);

  // Spike perf runs: TUBE_PLAY=<videoId> TUBE_QUALITY=hd1080|hd2160 opens a video at a pinned quality.
  const play = process.env.TUBE_PLAY;
  if (play) {
    const quality = process.env.TUBE_QUALITY ?? 'hd1080';
    mainWindow.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 6000));
      const got = await mainWindow!.webContents.executeJavaScript(`(() => {
        const p = document.querySelector('#movie_player');
        p.setPlaybackQualityRange('${quality}', '${quality}');
        p.playVideo();
        return p.getPlaybackQuality();
      })()`);
      console.log('[perf] requested', quality, 'was', got);
      await new Promise((r) => setTimeout(r, 8000));
      const now = await mainWindow!.webContents.executeJavaScript(`(() => {
        const p = document.querySelector('#movie_player');
        const v = p.querySelector('video');
        const q = v.getVideoPlaybackQuality();
        return { quality: p.getPlaybackQuality(), w: v.videoWidth, h: v.videoHeight, dropped: q.droppedVideoFrames, total: q.totalVideoFrames };
      })()`);
      console.log('[perf] playing', play, JSON.stringify(now));
    });
  }

  // YouTube redirects the first load (?themeRefresh=1), which aborts the original navigation.
  mainWindow.loadURL(play ? `https://www.youtube.com/watch?v=${play}` : 'https://www.youtube.com').catch((err) => {
    if (err.code !== 'ERR_ABORTED') console.error('[load]', err);
  });
});

app.on('window-all-closed', () => app.quit());
