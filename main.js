const {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  shell,
  dialog,
  protocol,
} = require('electron');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const {
  AUDIO_RE,
  scanLibrary,
  countLibrary,
  resolveInside,
} = require('./lib/scan');
const { fetchTrackInfo, isUnknownArtist } = require('./lib/cover');
const { Client: DiscordClient } = require('@xhayper/discord-rpc');

const USER_DIR = app.getPath('userData');
const CONFIG_FILE = path.join(USER_DIR, 'config.json');
const DATA_DIR = path.join(USER_DIR, 'data');
const COVERS_FILE = path.join(DATA_DIR, 'covers.json');
const OVERRIDES_FILE = path.join(DATA_DIR, 'overrides.json');
const PLAYLISTS_FILE = path.join(DATA_DIR, 'playlists.json');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');
const DATA_FILES = [
  'covers.json',
  'overrides.json',
  'playlists.json',
  'stats.json',
];

const MIME = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
};

let win = null;
let catalogCache = null;

function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    return true;
  } catch {
    return false;
  }
}

let config = readJSON(CONFIG_FILE, {});

function musicDir() {
  return config.musicDir || null;
}

function discordAppId() {
  return String(config.discordAppId || '').trim();
}

function saveConfig(patch) {
  config = { ...config, ...patch };
  writeJSON(CONFIG_FILE, config);
}

function buildCatalog() {
  const dir = musicDir();
  if (!dir || !fs.existsSync(dir)) {
    catalogCache = { songs: [], folderPlaylists: [] };
    return catalogCache;
  }

  const { songs, folderPlaylists } = scanLibrary(dir);
  const covers = readJSON(COVERS_FILE, {});
  const overrides = readJSON(OVERRIDES_FILE, {});

  const lib = songs.map((s) => {
    const base = path.basename(s.file);
    const ov = overrides[s.file] || overrides[base] || {};
    return {
      ...s,
      title: ov.title || s.title,
      artist: ov.artist || s.artist,
      cover: ov.cover || covers[base] || null,
      duration: ov.duration != null ? ov.duration : s.duration,
      folder: s.file.includes('/') ? s.file.split('/')[0] : null,
    };
  });

  catalogCache = { songs: lib, folderPlaylists };
  return catalogCache;
}

let coverFetchRunning = false;

async function fetchMissingCovers() {
  if (coverFetchRunning) return;
  coverFetchRunning = true;
  try {
    const cat = catalogCache || buildCatalog();
    const covers = readJSON(COVERS_FILE, {});
    const overrides = readJSON(OVERRIDES_FILE, {});
    for (const s of cat.songs) {
      const base = path.basename(s.file);
      const ov = overrides[s.file] || overrides[base] || {};
      const needCover = !s.cover && !covers[base];
      const needArtist = isUnknownArtist(s.artist) && !ov.artist;
      if (!needCover && !needArtist) continue;

      const info = await fetchTrackInfo(s.artist, s.title);
      if (!info) continue;

      const patch = {};
      if (needCover && info.cover) {
        covers[base] = info.cover;
        writeJSON(COVERS_FILE, covers);
        s.cover = info.cover;
        patch.url = info.cover;
      }
      if (needArtist && info.artist && !isUnknownArtist(info.artist)) {
        overrides[base] = { ...(overrides[base] || {}), artist: info.artist };
        writeJSON(OVERRIDES_FILE, overrides);
        s.artist = info.artist;
        patch.artist = info.artist;
      }
      if ((patch.url || patch.artist) && win && !win.isDestroyed()) {
        win.webContents.send('covers:update', { id: s.id, ...patch });
      }
    }
  } catch {}
  coverFetchRunning = false;
}

let watcher = null;
let watchTimer = null;

function notifyChanged() {
  clearTimeout(watchTimer);
  watchTimer = setTimeout(() => {
    catalogCache = null;
    if (win && !win.isDestroyed()) win.webContents.send('lib:changed');
    fetchMissingCovers();
  }, 1500);
}

function setupWatcher() {
  try {
    watcher && watcher.close();
  } catch {}
  watcher = null;
  const dir = musicDir();
  if (!dir) return;
  try {
    watcher = fs.watch(dir, { recursive: true }, (ev, name) => {
      if (name && AUDIO_RE.test(name)) notifyChanged();
    });
  } catch {}
}

function fileResponse(file, range) {
  const size = fs.statSync(file).size;
  const type =
    MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());

  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    start = Math.max(0, Math.min(start, size - 1));
    end = Math.max(start, Math.min(end, size - 1));
    return new Response(
      Readable.toWeb(fs.createReadStream(file, { start, end })),
      {
        status: 206,
        headers: {
          'Content-Type': type,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes',
        },
      },
    );
  }

  return new Response(Readable.toWeb(fs.createReadStream(file)), {
    status: 200,
    headers: {
      'Content-Type': type,
      'Content-Length': String(size),
      'Accept-Ranges': 'bytes',
    },
  });
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'wq',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

function registerProtocol() {
  protocol.handle('wq', (request) => {
    const dir = musicDir();
    if (!dir) return new Response('No library', { status: 404 });

    let rel;
    try {
      rel = decodeURIComponent(new URL(request.url).pathname).replace(
        /^\/+/,
        '',
      );
    } catch {
      return new Response('Bad request', { status: 400 });
    }

    const full = resolveInside(dir, rel);
    if (!full || !AUDIO_RE.test(full) || !fs.existsSync(full)) {
      return new Response('Not found', { status: 404 });
    }

    try {
      return fileResponse(full, request.headers.get('range'));
    } catch {
      return new Response('Read error', { status: 500 });
    }
  });
}

ipcMain.handle('lib:catalog', () => catalogCache || buildCatalog());

ipcMain.handle('lib:duration', (e, { file, sec }) => {
  const s = Number(sec);
  if (!file || !Number.isFinite(s) || s <= 0) return false;
  const base = path.basename(file);
  const overrides = readJSON(OVERRIDES_FILE, {});
  if (overrides[base] && overrides[base].duration != null) return false;
  overrides[base] = { ...(overrides[base] || {}), duration: Math.round(s) };
  const cached =
    catalogCache && catalogCache.songs.find((x) => x.file === file);
  if (cached) cached.duration = Math.round(s);
  return writeJSON(OVERRIDES_FILE, overrides);
});

ipcMain.handle('covers:fetchMissing', () => {
  fetchMissingCovers();
  return true;
});

ipcMain.handle('playlists:get', () => readJSON(PLAYLISTS_FILE, { liked: [] }));
ipcMain.handle('playlists:save', (e, data) =>
  writeJSON(PLAYLISTS_FILE, {
    liked: Array.isArray(data.liked) ? data.liked : [],
  }),
);

ipcMain.handle('stats:get', () =>
  readJSON(STATS_FILE, { plays: [], listenSeconds: 0 }),
);
ipcMain.handle('stats:play', (e, { id, sec }) => {
  const stats = readJSON(STATS_FILE, { plays: [], listenSeconds: 0 });
  const rec = { id, ts: Date.now() };
  const s = Number(sec);
  if (Number.isFinite(s) && s > 0) {
    rec.sec = Math.round(s);
    stats.listenSeconds += rec.sec;
  }
  stats.plays.push(rec);
  return writeJSON(STATS_FILE, stats);
});

ipcMain.handle('config:get', () => ({
  musicDir: musicDir(),
  discordRpc: config.discordRpc !== false,
  discordAppId: discordAppId(),
  dataDir: DATA_DIR,
  version: app.getVersion(),
}));

ipcMain.handle('config:pickMusicDir', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose your music folder',
    defaultPath: musicDir() || app.getPath('music'),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const dir = r.filePaths[0];
  return { dir, ...countLibrary(dir) };
});

ipcMain.handle('config:setMusicDir', (e, dir) => {
  if (!dir || !fs.existsSync(dir)) return false;
  saveConfig({ musicDir: dir });
  catalogCache = null;
  setupWatcher();
  fetchMissingCovers();
  return true;
});

ipcMain.handle('config:setDiscord', (e, on) => {
  saveConfig({ discordRpc: !!on });
  if (on) connectDiscord();
  else disconnectDiscord();
  return true;
});

ipcMain.handle('config:setDiscordId', (e, id) => {
  const clean = String(id || '').trim();
  if (clean && !/^\d{15,25}$/.test(clean)) return false;
  saveConfig({ discordAppId: clean });
  disconnectDiscord();
  connectDiscord();
  return true;
});

ipcMain.handle('config:importData', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose a folder holding data from an older install',
    properties: ['openDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let copied = 0;
  for (const name of DATA_FILES) {
    const src = path.join(r.filePaths[0], name);
    if (!fs.existsSync(src)) continue;
    try {
      JSON.parse(fs.readFileSync(src, 'utf8'));
      fs.copyFileSync(src, path.join(DATA_DIR, name));
      copied++;
    } catch {}
  }
  catalogCache = null;
  return { copied };
});

ipcMain.handle(
  'shell:showMusic',
  () => musicDir() && shell.openPath(musicDir()),
);
ipcMain.handle('shell:showData', () => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  return shell.openPath(DATA_DIR);
});

let rpc = null;
let rpcReady = false;
let rpcReconnectTimer = null;
let lastPresence = null;

function connectDiscord() {
  if (rpc || config.discordRpc === false || !discordAppId()) return;
  rpc = new DiscordClient({ clientId: discordAppId() });
  rpc.on('ready', () => {
    rpcReady = true;
    if (lastPresence) applyPresence(lastPresence);
  });
  const drop = () => {
    rpcReady = false;
    try {
      rpc && rpc.destroy();
    } catch {}
    rpc = null;
    if (!rpcReconnectTimer && config.discordRpc !== false && discordAppId()) {
      rpcReconnectTimer = setTimeout(() => {
        rpcReconnectTimer = null;
        connectDiscord();
      }, 15000);
    }
  };
  rpc.on('disconnected', drop);
  rpc.login().catch(drop);
}

function disconnectDiscord() {
  clearTimeout(rpcReconnectTimer);
  rpcReconnectTimer = null;
  rpcReady = false;
  try {
    rpc && rpc.destroy();
  } catch {}
  rpc = null;
}

function applyPresence(p) {
  if (!rpc || !rpcReady) return;
  if (!p) {
    rpc.user && rpc.user.clearActivity().catch(() => {});
    return;
  }
  const activity = {
    type: 2,
    details: (p.title || 'Unknown track').slice(0, 128),
    state: (p.artist || 'Unknown artist').slice(0, 128),
    instance: false,
    largeImageKey: p.cover || 'wavequen',
    largeImageText: (p.album || 'Wavequen').slice(0, 128),
    smallImageKey: p.paused ? 'pause' : 'play',
    smallImageText: p.paused ? 'Paused' : 'Playing',
  };
  if (!p.paused && p.duration > 0 && p.position >= 0) {
    const now = Date.now();
    activity.startTimestamp = now - Math.round(p.position * 1000);
    activity.endTimestamp = now + Math.round((p.duration - p.position) * 1000);
  }
  rpc.user && rpc.user.setActivity(activity).catch(() => {});
}

ipcMain.handle('presence:update', (e, p) => {
  lastPresence = p;
  applyPresence(p);
});

ipcMain.handle('presence:clear', () => {
  lastPresence = null;
  if (rpc && rpcReady && rpc.user) rpc.user.clearActivity().catch(() => {});
});

ipcMain.on('win:min', () => win && win.minimize());
ipcMain.on('win:max', () => {
  if (!win) return;
  win.isMaximized() ? win.unmaximize() : win.maximize();
});
ipcMain.on('win:close', () => win && win.close());

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 760,
    minHeight: 520,
    frame: false,
    backgroundColor: '#060606',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.on('maximize', () => win.webContents.send('win:maxstate', true));
  win.on('unmaximize', () => win.webContents.send('win:maxstate', false));
}

app.whenReady().then(() => {
  registerProtocol();
  createWindow();
  setupWatcher();
  fetchMissingCovers();
  connectDiscord();

  const keys = {
    MediaPlayPause: 'playpause',
    MediaNextTrack: 'next',
    MediaPreviousTrack: 'prev',
  };
  for (const [key, action] of Object.entries(keys)) {
    try {
      globalShortcut.register(
        key,
        () => win && win.webContents.send('media', action),
      );
    } catch {}
  }
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
