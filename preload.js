const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wavequen', {
  catalog: () => ipcRenderer.invoke('lib:catalog'),
  saveDuration: (file, sec) => ipcRenderer.invoke('lib:duration', { file, sec }),
  fetchCovers: () => ipcRenderer.invoke('covers:fetchMissing'),
  getPlaylists: () => ipcRenderer.invoke('playlists:get'),
  savePlaylists: (data) => ipcRenderer.invoke('playlists:save', data),
  getStats: () => ipcRenderer.invoke('stats:get'),
  recordPlay: (id, sec) => ipcRenderer.invoke('stats:play', { id, sec }),

  getConfig: () => ipcRenderer.invoke('config:get'),
  pickMusicDir: () => ipcRenderer.invoke('config:pickMusicDir'),
  setMusicDir: (dir) => ipcRenderer.invoke('config:setMusicDir', dir),
  setDiscord: (on) => ipcRenderer.invoke('config:setDiscord', on),
  setDiscordId: (id) => ipcRenderer.invoke('config:setDiscordId', id),
  importData: () => ipcRenderer.invoke('config:importData'),

  openMusicFolder: () => ipcRenderer.invoke('shell:showMusic'),
  openDataFolder: () => ipcRenderer.invoke('shell:showData'),

  setPresence: (p) => ipcRenderer.invoke('presence:update', p),
  clearPresence: () => ipcRenderer.invoke('presence:clear'),

  onCoverUpdate: (cb) => ipcRenderer.on('covers:update', (e, d) => cb(d)),
  onLibChanged: (cb) => ipcRenderer.on('lib:changed', () => cb()),
  onMedia: (cb) => ipcRenderer.on('media', (e, action) => cb(action)),
  onMaxState: (cb) => ipcRenderer.on('win:maxstate', (e, v) => cb(v)),

  winMin: () => ipcRenderer.send('win:min'),
  winMax: () => ipcRenderer.send('win:max'),
  winClose: () => ipcRenderer.send('win:close'),
});
