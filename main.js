'use strict';
const { app, BrowserWindow, shell, Menu, globalShortcut } = require('electron');
const path = require('path');

const GAME_URL = 'https://sys32.hackatoa.com/play';

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 820,
    minHeight: 580,
    backgroundColor: '#060a06',
    title: 'System 32 Roulette',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: false,
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
