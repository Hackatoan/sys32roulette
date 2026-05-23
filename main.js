'use strict';
const { app, BrowserWindow, shell, Menu, globalShortcut, ipcMain, dialog } = require('electron');
const { execFile, execFileSync } = require('child_process');
const path = require('path');
const { deleteLoseTarget, LOSE_TARGET } = require('./lose-action');

const GAME_URL = 'https://sys32.hackatoa.com/play';

// ── Admin / elevation helpers ─────────────────────────────────────────────────
function isElevated() {
  if (process.platform === 'win32') {
    try { execFileSync('net', ['session'], { stdio: 'pipe' }); return true; }
    catch { return false; }
  }
  if (process.platform === 'linux') return process.getuid() === 0;
  return true; // macOS: skip elevation requirement
}

async function requestElevation() {
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Relaunch as Administrator', 'Quit'],
    defaultId: 0,
    title: 'Administrator Rights Required',
    message: 'System 32 Roulette needs administrator privileges to enforce the lose condition.',
    detail: `When you lose, the following file will be permanently deleted:\n\n${LOSE_TARGET}`,
  });

  if (response !== 0) { app.quit(); return; }

  if (process.platform === 'win32') {
    const exe = process.execPath.replace(/"/g, '\\"');
    const scriptArgs = app.isPackaged
      ? ''
      : `-ArgumentList ${process.argv.slice(1).map(a => `"${a.replace(/"/g, '\\"')}"`).join(',')}`;
    execFile('powershell.exe', ['-Command',
      `Start-Process -FilePath "${exe}" ${scriptArgs} -Verb RunAs`
    ]);
  } else if (process.platform === 'linux') {
    const args = app.isPackaged
      ? [process.execPath]
      : [process.execPath, ...process.argv.slice(1)];
    execFile('pkexec', args);
  }

  app.quit();
}
// ─────────────────────────────────────────────────────────────────────────────

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
      preload: path.join(__dirname, 'preload.js'),
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

app.whenReady().then(async () => {
  if (!isElevated()) {
    await requestElevation();
    return; // current instance quits inside requestElevation
  }

  ipcMain.handle('player-lost', () => {
    const result = deleteLoseTarget();
    console.log('[lose]', result);
    return result;
  });

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
