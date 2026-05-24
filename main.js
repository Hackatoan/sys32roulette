'use strict';
const { app, BrowserWindow, shell, Menu, globalShortcut, ipcMain, systemPreferences, dialog } = require('electron');
const path = require('path');
const { deleteLoseTarget } = require('./lose-action');

// Linux AppImage requires no-sandbox in environments without user namespaces
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox');
}

const GAME_URL = 'https://sys32.hackatoa.com/play';

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 820,
    minHeight: 580,
    backgroundColor: '#060a06',
    title: 'System 32 Roulette',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  Menu.setApplicationMenu(null);
  win.loadURL(GAME_URL);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith('https://sys32.hackatoa.com')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('https://sys32.hackatoa.com')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  return win;
}

async function checkMacPermissions(win) {
  if (!systemPreferences.isTrustedAccessibilityClient(false)) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      buttons: ['Open Settings', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Enable Keyboard Shortcuts',
      message: 'Grant Accessibility access for F11 fullscreen',
      detail: 'Without it, the F11 fullscreen shortcut won\'t work.\n\nSystem Settings → Privacy & Security → Accessibility → toggle on System 32 Roulette\n\nFull guide: sys32.hackatoa.com/macos',
    });
    if (response === 0) {
      systemPreferences.isTrustedAccessibilityClient(true);
    }
  }
}

app.whenReady().then(async () => {
  const win = createWindow();

  if (process.platform === 'darwin') {
    await checkMacPermissions(win);
  }

  globalShortcut.register('F11', () => {
    win.setFullScreen(!win.isFullScreen());
  });

  globalShortcut.register('Escape', () => {
    if (win.isFullScreen()) win.setFullScreen(false);
  });
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('player-lost', () => deleteLoseTarget());
