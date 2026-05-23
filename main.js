const { app, BrowserWindow, Tray, Menu, Notification, nativeImage, ipcMain } = require('electron');
const path = require('path');

let win;
let tray;
let isQuitting = false;

// Netease Cloud Music API
const { login_qr_key, login_qr_create, login_qr_check, login_refresh, login_status, likelist, song_url, song_detail, cloudsearch, lyric, register_anonimous } = require('NeteaseCloudMusicApi');

// Track whether anonymous device has been registered
let anonimousRegistered = false;

// Store Netease cookie in memory
let neteaseCookie = '';

// Netease API returns cookies as arrays; normalize to string for storage/passing
function normalizeCookie(c) {
  if (Array.isArray(c)) {
    return c
      .filter(item => typeof item === 'string' && item.length > 0)
      .map(item => item.split(';')[0].trim())
      .filter(Boolean)
      .join('; ');
  }
  if (typeof c === 'string') return c;
  return '';
}

// Timeout wrapper for Netease API calls — axios has no default timeout, so requests can hang forever
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`请求超时 (${label}, ${ms / 1000}s)`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function createTrayIcon() {
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAARklEQVQ4T2P8z0ABYKSieQxUNA9dHaqCgoKC/2fOnJkDpBmptjYQ1QiIdQuI+i9gmoOcYhjBDkcg2Cku3zNA/YsYCAAJNRhMN4xQaAAAAABJRU5ErkJggg=='
  );
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('番茄钟运行中');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示窗口', click: () => win.show() },
    { label: '停止播放', click: () => win.webContents.send('pause-music') },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } }
  ]));
  tray.on('double-click', () => win.show());
}

function createWindow() {
  win = new BrowserWindow({
    width: 680,
    height: 820,
    minWidth: 600,
    minHeight: 700,
    resizable: true,
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

// ---- Standard IPC handlers ----

ipcMain.on('set-always-on-top', (_, flag) => {
  win.setAlwaysOnTop(flag);
});

ipcMain.on('minimize', () => win.minimize());
ipcMain.on('close', () => {
  win.webContents.send('pause-music');
  isQuitting = true;
  app.quit();
});

ipcMain.on('notify', (_, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({ title, body, silent: false }).show();
  }
});

ipcMain.on('flash-frame', () => {
  win.flashFrame(true);
});

// ---- Netease Cloud Music IPC handlers ----

function makeNeteaseOptions(cookie) {
  const opts = {};
  if (cookie) {
    opts.cookie = cookie;
  }
  return opts;
}

async function tryRefreshCookie() {
  if (!neteaseCookie) return false;
  try {
    const result = await withTimeout(login_refresh(makeNeteaseOptions(neteaseCookie)), 8000, 'login_refresh');
    if (result.body.code === 200 && result.body.cookie) {
      neteaseCookie = normalizeCookie(result.body.cookie);
      console.log('[netease] Cookie refreshed');
      return true;
    }
  } catch (e) {
    console.log('[netease] Cookie refresh failed:', e.message);
  }
  return false;
}

ipcMain.handle('netease-qr-key', async () => {
  try {
    let anonCookie = '';
    if (!anonimousRegistered) {
      try {
        const anonResult = await withTimeout(register_anonimous(), 10000, 'register_anonimous');
        anonimousRegistered = true;
        anonCookie = normalizeCookie(anonResult.cookie);
      } catch (e) {
        console.log('[netease] register_anonimous failed:', e.message);
      }
    }
    // Pass anonymous cookie to login_qr_key for session continuity
    const qrKeyOpts = anonCookie ? { cookie: anonCookie } : {};
    const result = await withTimeout(login_qr_key(qrKeyOpts), 10000, 'login_qr_key');
    const keyCookie = normalizeCookie(result.cookie);
    const mergedCookie = keyCookie || anonCookie;
    return { success: true, data: result.body.data, cookie: mergedCookie };
  } catch (e) {
    console.log('[netease] netease-qr-key error:', e.message);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('netease-qr-create', async (_, { key, qrimg, cookie }) => {
  try {
    const opts = cookie ? { cookie } : {};
    const result = await login_qr_create({ key, qrimg, ...opts });
    return { success: true, data: result.body.data, cookie: normalizeCookie(result.cookie) || cookie || '' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('netease-qr-check', async (_, { key, cookie }) => {
  try {
    const opts = cookie ? { cookie } : {};
    const result = await withTimeout(login_qr_check({ key, ...opts }), 8000, 'login_qr_check');
    const body = result.body;
    const mergedCookie = normalizeCookie(result.cookie) || cookie || '';
    if (body.code === 801) return { success: true, status: 'waiting', message: '等待扫码', cookie: mergedCookie };
    if (body.code === 802) return { success: true, status: 'scanned', message: '已扫码，请在手机上确认', cookie: mergedCookie };
    if (body.code === 803) {
      neteaseCookie = normalizeCookie(body.cookie) || mergedCookie;
      return { success: true, status: 'authorized', cookie: neteaseCookie, message: '授权成功' };
    }
    if (body.code === 800) return { success: true, status: 'expired', message: '二维码已过期，请重新获取' };
    // Unknown code — treat as expired
    return { success: true, status: 'expired', message: '二维码已过期，请重新获取' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('netease-login-status', async () => {
  try {
    if (!neteaseCookie) return { success: true, loggedIn: false };
    let result = await withTimeout(login_status(makeNeteaseOptions(neteaseCookie)), 8000, 'login_status');
    let body = result.body;

    // If not logged in, try refreshing the cookie first
    if (!(body.data && body.data.account)) {
      const refreshed = await tryRefreshCookie();
      if (refreshed) {
        result = await withTimeout(login_status(makeNeteaseOptions(neteaseCookie)), 8000, 'login_status_retry');
        body = result.body;
      }
    }

    if (body.data && body.data.account) {
      return { success: true, loggedIn: true, profile: body.data.profile, account: body.data.account };
    }
    return { success: true, loggedIn: false };
  } catch (e) {
    return { success: true, loggedIn: false };
  }
});

ipcMain.handle('netease-liked-songs', async (_, { uid, offset = 0, limit = 200 }) => {
  try {
    if (!neteaseCookie) return { success: false, error: '未登录' };
    const opts = makeNeteaseOptions(neteaseCookie);

    // Step 1: Get liked song IDs
    const likeResult = await withTimeout(likelist({ uid, offset, limit, ...opts }), 10000, 'likelist');
    const body = likeResult.body;

    if (body.code !== 200) {
      if (body.code === 301) {
        // Try to refresh cookie and let renderer know
        const refreshed = await tryRefreshCookie();
        if (refreshed) return { success: false, error: 'cookie_refreshed', cookie: neteaseCookie };
        return { success: false, error: '登录已过期，请重新登录' };
      }
      return { success: false, error: body.message || body.msg || '获取歌单失败' };
    }

    const songIds = body.ids || [];
    if (songIds.length === 0) {
      return { success: true, data: { songs: [], total: body.checkPoint || 0 } };
    }

    // Step 2: Get song details in batches of 500
    const batchSize = 500;
    let allSongs = [];
    for (let i = 0; i < songIds.length; i += batchSize) {
      const batch = songIds.slice(i, i + batchSize);
      const detailResult = await withTimeout(song_detail({ ids: batch.join(','), ...opts }), 10000, 'song_detail');
      if (detailResult.body.code === 200 && detailResult.body.songs) {
        allSongs = allSongs.concat(detailResult.body.songs);
      }
    }
    return { success: true, data: { songs: allSongs, total: body.checkPoint } };
  } catch (e) {
    console.log('[netease] likelist error:', e.message);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('netease-search', async (_, { keywords, limit = 30 }) => {
  try {
    const opts = makeNeteaseOptions(neteaseCookie);
    const result = await withTimeout(cloudsearch({ keywords, limit, type: 1, ...opts }), 8000, 'cloudsearch');
    const body = result.body;
    if (body.code === 200 && body.result && body.result.songs) {
      const songs = body.result.songs.map(s => ({
        id: s.id,
        name: s.name || '未知歌曲',
        artist: (s.ar || []).map(a => a.name).join(', ') || '未知歌手',
        album: (s.al || {}).name || '',
        cover: (s.al || {}).picUrl || ''
      }));
      return { success: true, data: { songs, total: body.result.songCount } };
    }
    return { success: false, error: '搜索失败' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('netease-song-url', async (_, { id, br = 320000 }) => {
  try {
    if (!neteaseCookie) return { success: false, error: '未登录' };
    const result = await withTimeout(song_url({ id: String(id), br, ...makeNeteaseOptions(neteaseCookie) }), 8000, 'song_url');
    if (result.body.code === 200 && result.body.data && result.body.data[0]) {
      return { success: true, data: result.body.data[0] };
    }
    return { success: false, error: '无法获取播放地址' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('netease-lyric', async (_, { id }) => {
  try {
    if (!neteaseCookie) return { success: false, error: '未登录' };
    const result = await withTimeout(lyric({ id, ...makeNeteaseOptions(neteaseCookie) }), 8000, 'lyric');
    if (result.body.code === 200) {
      return { success: true, data: result.body.lrc };
    }
    return { success: false, error: '无法获取歌词' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('netease-restore-cookie', async (_, { cookie }) => {
  neteaseCookie = cookie || '';
  try {
    if (!neteaseCookie) return { success: true, loggedIn: false };

    // Try refreshing the cookie first (Netease cookies expire)
    const refreshed = await tryRefreshCookie();
    const activeCookie = refreshed ? neteaseCookie : cookie;

    const result = await withTimeout(login_status(makeNeteaseOptions(activeCookie)), 8000, 'restore_login_status');
    if (result.body.data && result.body.data.account) {
      // If we refreshed, tell the renderer the new cookie
      const response = { success: true, loggedIn: true, profile: result.body.data.profile, account: result.body.data.account };
      if (refreshed) response.cookie = neteaseCookie;
      return response;
    }
    neteaseCookie = '';
    return { success: true, loggedIn: false };
  } catch (e) {
    neteaseCookie = '';
    return { success: true, loggedIn: false };
  }
});
