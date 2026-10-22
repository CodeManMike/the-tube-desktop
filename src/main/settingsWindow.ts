import { app, BrowserWindow, ipcMain, IpcMainInvokeEvent } from 'electron';
import path from 'path';
import { PluginRegistry } from './pluginRegistry';
import { SettingsStore } from './settingsStore';

let win: BrowserWindow | null = null;

export function openSettingsWindow(): void {
  if (win) {
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 760,
    height: 680,
    title: 'TTD Settings',
    icon: path.join(app.getAppPath(), 'assets', 'icons', 'favicon.ico'),
    autoHideMenuBar: true,
    backgroundColor: '#0f0f0f',
    webPreferences: {
      preload: path.join(__dirname, '..', 'settings', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile(path.join(app.getAppPath(), 'static', 'settings.html'));
  win.on('closed', () => {
    win = null;
  });
}

// Registered once at startup. Only the settings window may call these.
export function registerSettingsIpc(registry: PluginRegistry, store: SettingsStore, onChange: () => void): void {
  const fromSettings = (event: IpcMainInvokeEvent) => {
    if (!win || event.sender !== win.webContents) throw new Error('settings IPC from unexpected sender');
  };
  const pluginById = (id: string) => {
    const p = registry.list().find((x) => x.manifest.id === id);
    if (!p) throw new Error(`unknown plugin: ${id}`);
    return p;
  };

  ipcMain.handle('settings:list', (event) => {
    fromSettings(event);
    return registry.list().map((p) => ({ ...p, values: store.values(p.manifest.id, p.manifest.settings) }));
  });
  ipcMain.handle('settings:setEnabled', (event, id: string, on: boolean) => {
    fromSettings(event);
    pluginById(id);
    store.setEnabled(id, on === true);
    onChange();
  });
  ipcMain.handle('settings:setValue', (event, id: string, key: string, value: unknown) => {
    fromSettings(event);
    const def = pluginById(id).manifest.settings.find((d) => d.key === key);
    if (!def) throw new Error(`unknown setting: ${id}.${key}`);
    store.setValue(id, def, value);
    onChange();
  });
}
