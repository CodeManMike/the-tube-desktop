import { app, BrowserWindow, Menu, components, session } from 'electron';

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

app.whenReady().then(async () => {
  await components.whenReady();
  console.log('[widevine]', components.status());

  buildMenu();
  useHonestUaForSignIn();
  mainWindow = createMainWindow();
  // YouTube redirects the first load (?themeRefresh=1), which aborts the original navigation.
  mainWindow.loadURL('https://www.youtube.com').catch((err) => {
    if (err.code !== 'ERR_ABORTED') console.error('[load]', err);
  });
});

app.on('window-all-closed', () => app.quit());
