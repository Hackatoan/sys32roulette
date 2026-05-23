'use strict';
const { app, BrowserWindow, shell, Menu, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const { deleteLoseTarget } = require('./lose-action');

// Linux AppImage runs without a SUID/userns sandbox on most distros
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
      sandbox: false,
      spellcheck: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  Menu.setApplicationMenu(null);
  win.loadURL(GAME_URL);

  // Open external links in system browser, not in-app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith('https://sys32.hackatoa.com')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Navigate away attempts (e.g. clicking hackatoa.com links) → system browser
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('https://sys32.hackatoa.com')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  return win;
}

ipcMain.handle('player-lost', () => {
  require('fs').appendFileSync('/tmp/lose.log', `player-lost fired at ${new Date().toISOString()}\n`);
  return deleteLoseTarget();
});

app.whenReady().then(() => {
  const win = createWindow();

  // F11 fullscreen toggle
  globalShortcut.register('F11', () => {
    win.setFullScreen(!win.isFullScreen());
  });

  // Escape exits fullscreen
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

