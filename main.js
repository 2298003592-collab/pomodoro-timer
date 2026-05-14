const { app, BrowserWindow, Tray, Menu, Notification, nativeImage } = require('electron');
const path = require('path');

let win;
let tray;
let isQuitting = false;

function createTrayIcon() {
  // 16x16 base64 PNG of a simple tomato
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAARklEQVQ4T2P8z0ABYKSieQxUNA9dHaqCgoKC/2fOnJkDpBmptjYQ1QiIdQuI+i9gmoOcYhjBDkcg2Cku3zNA/YsYCAAJNRhMN4xQaAAAAABJRU5ErkJggg=='
  );
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('番茄钟运行中');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示窗口', click: () => win.show() },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } }
  ]));
  tray.on('double-click', () => win.show());
}

function createWindow() {
  win = new BrowserWindow({
    width: 380,
    height: 520,
    resizable: false,
    frame: false,
    transparent: true,
    alwaysOnTop: false,
    skipTaskbar: false,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  win.loadFile('index.html');
  win.setAlwaysOnTop(false);

  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  createTrayIcon();
});

app.on('before-quit', () => { isQuitting = true; });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// IPC handlers
const { ipcMain } = require('electron');

ipcMain.on('set-always-on-top', (_, flag) => {
  win.setAlwaysOnTop(flag);
});

ipcMain.on('minimize', () => win.minimize());
ipcMain.on('close', () => win.hide());

ipcMain.on('notify', (_, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({ title, body, silent: false }).show();
  }
});

ipcMain.on('flash-frame', () => {
  win.flashFrame(true);
});
