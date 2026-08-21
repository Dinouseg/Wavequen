'use strict';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const audio = $('#audio');

const S = {
  songs: [],
  byId: new Map(),
  genres: [],
  liked: new Set(),
  stats: { plays: [], listenSeconds: 0 },
  config: {},
  view: 'home',
  viewArg: null,
  baseList: [],
  queue: [],
  qIndex: -1,
  shuffle: localStorage.wq_shuffle === '1',
  repeat: Number(localStorage.wq_repeat || 0),
  playing: false,
  listened: 0,
  lastT: 0,
  sleepUntil: null,
  sleepTrack: false,
  search: '',
  sort: 'title',
  volume: 0.8,
};

function trackUrl(song) {
  return 'wq://library/' + song.file.split('/').map(encodeURIComponent).join('/');
}

function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '-:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtHours(sec) {
  return (sec / 3600).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 2900);
}

function coverHtml(song, cls) {
  const initial = esc((song.title || '?').trim()[0] || '?').toUpperCase();
  const img = song.cover ? `<img data-src="${esc(song.cover)}" alt="">` : '';
  return `<div class="cover ${cls}${song.cover ? ' skeleton' : ''}" data-cid="${esc(song.id)}">${initial}${img}</div>`;
}

function hydrateCovers(root) {
  $$('.cover img[data-src]', root).forEach((img) => {
    img.addEventListener('load', () => {
      img.classList.add('ok');
      img.parentElement.classList.remove('skeleton');
    });
    img.addEventListener('error', () => {
      img.remove();
      img.parentElement && img.parentElement.classList.remove('skeleton');
    });
    img.src = img.dataset.src;
    img.removeAttribute('data-src');
  });
}

function isUnknownArtist(a) {
  return !a || /^unknown artist$/i.test(a.trim());
}

function computeStats() {
  const plays = S.stats.plays || [];
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const counts = {};
  const monthCounts = {};
  let monthSec = 0;
  let monthSecKnown = 0;
  let monthPlays = 0;

  for (const p of plays) {
    counts[p.id] = (counts[p.id] || 0) + 1;
    if (p.ts >= monthStart) {
      monthCounts[p.id] = (monthCounts[p.id] || 0) + 1;
      monthPlays++;
      if (p.sec) {
        monthSec += p.sec;
        monthSecKnown++;
      }
    }
  }
  if (monthPlays > monthSecKnown && plays.length > 0) {
    const avg = (S.stats.listenSeconds || 0) / plays.length;
    monthSec += Math.round(avg * (monthPlays - monthSecKnown));
  }

  const artists = {};
  const genres = {};
  for (const [id, c] of Object.entries(counts)) {
    const s = S.byId.get(id);
    if (!s) continue;
    if (s.artist && !isUnknownArtist(s.artist)) artists[s.artist] = (artists[s.artist] || 0) + c;
    if (s.folder) genres[s.folder] = (genres[s.folder] || 0) + c;
  }

  const days = new Set(plays.map((p) => new Date(p.ts).toDateString()));
  let streak = 0;
  const d = new Date();
  if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1);
  while (days.has(d.toDateString())) {
    streak++;
    d.setDate(d.getDate() - 1);
  }

  const top = (obj, n) =>
    Object.entries(obj)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n);

  return {
    totalPlays: plays.length,
    totalSec: S.stats.listenSeconds || 0,
    monthSec,
    monthPlays,
    streak,
    topSongs: top(counts, 10),
    topMonthSongs: top(monthCounts, 6),
    topArtists: top(artists, 8),
    topGenres: top(genres, 8),
    counts,
  };
}

let computeCache = { counts: {} };

function songRow(song, idx) {
  const st = computeCache.counts[song.id] || 0;
  const playingHere = S.queue[S.qIndex] === song.id;
  const idxCell = playingHere
    ? `<span class="eq${S.playing ? '' : ' paused'}"><i></i><i></i><i></i></span>`
    : `<span>${idx + 1}</span>`;
  return `
  <div class="song-row${playingHere ? ' playing' : ''}" data-id="${esc(song.id)}" role="button" tabindex="0">
    <div class="s-idx">${idxCell}</div>
    ${coverHtml(song, 's-cover')}
    <div class="s-main">
      <div class="s-title">${esc(song.title)}</div>
      <div class="s-artist">${esc(song.artist)}</div>
    </div>
    <div class="s-genre">${esc(song.folder || '')}</div>
    <div class="s-plays">${st ? st + '&times;' : ''}</div>
    <div class="s-time">${song.duration ? fmtTime(song.duration) : ''}</div>
    <button class="icon-btn like-btn${S.liked.has(song.id) ? ' liked' : ''}" data-like="${esc(song.id)}" aria-label="Liked">
      <svg viewBox="0 0 24 24"><path d="M12 20.5C7 16.5 3.5 13.3 3.5 9.6 3.5 7 5.5 5 8 5c1.6 0 3.1.8 4 2.1C12.9 5.8 14.4 5 16 5c2.5 0 4.5 2 4.5 4.6 0 3.7-3.5 6.9-8.5 10.9z"/></svg>
    </button>
  </div>`;
}

function cardHtml(song) {
  const c = computeCache.counts[song.id] || 0;
  return `
  <button class="card" data-id="${esc(song.id)}">
    ${coverHtml(song, 'cover')}
    <div class="c-title">${esc(song.title)}</div>
    <div class="c-sub">${esc(song.artist)}</div>
    ${c ? `<div class="c-plays">played ${c}&times;</div>` : ''}
  </button>`;
}

function greeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Good morning';
  if (h >= 12 && h < 18) return 'Good afternoon';
  if (h >= 18 && h < 23) return 'Good evening';
  return 'Still awake';
}

function viewHome() {
  const st = computeCache;
  const recentIds = [];
  for (let i = (S.stats.plays || []).length - 1; i >= 0 && recentIds.length < 8; i--) {
    const id = S.stats.plays[i].id;
    if (!recentIds.includes(id) && S.byId.has(id)) recentIds.push(id);
  }
  const monthTop = st.topMonthSongs.filter(([id]) => S.byId.has(id)).slice(0, 6);
  const dateStr = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return `
    <div class="eyebrow">${esc(dateStr)} · ${S.songs.length} tracks · ${fmtHours(st.totalSec)} h listened</div>
    <h1 class="view-title">${greeting()}</h1>
    <div class="view-sub">WAVEQUEN</div>

    ${
      recentIds.length
        ? `
    <div class="section-head"><span class="section-title">Pick up where you left off</span></div>
    <div class="card-grid">${recentIds.map((id) => cardHtml(S.byId.get(id))).join('')}</div>`
        : `
    <div class="empty"><div class="e-big">Welcome to Wavequen</div>Play the first track and the stats start counting themselves.</div>`
    }

    ${
      monthTop.length
        ? `
    <div class="section-head"><span class="section-title">Most played this month</span></div>
    <div class="card-grid">${monthTop.map(([id]) => cardHtml(S.byId.get(id))).join('')}</div>`
        : ''
    }

    ${
      S.genres.length
        ? `
    <div class="section-head"><span class="section-title">Genres</span></div>
    <div class="genre-grid">
      ${S.genres
        .map(
          (g) => `
        <button class="genre-tile" data-genre="${esc(g.name)}">
          <span class="gt-ghost">${esc(g.name[0])}</span>
          <span class="gt-name">${esc(g.name)}</span>
          <span class="gt-count">${g.songs.length} tracks</span>
        </button>`,
        )
        .join('')}
    </div>`
        : ''
    }`;
}

function currentList() {
  let list;
  if (S.view === 'genre') {
    const g = S.genres.find((x) => x.name === S.viewArg);
    list = g ? g.songs.map((id) => S.byId.get(id)).filter(Boolean) : [];
  } else if (S.view === 'liked') {
    list = S.songs.filter((s) => S.liked.has(s.id));
  } else {
    list = [...S.songs];
  }
  if (S.search) {
    const q = S.search.toLowerCase();
    list = list.filter((s) => (s.title + ' ' + s.artist).toLowerCase().includes(q));
  }
  const c = computeCache.counts;
  const sorters = {
    title: (a, b) => a.title.localeCompare(b.title),
    artist: (a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title),
    plays: (a, b) => (c[b.id] || 0) - (c[a.id] || 0),
    duration: (a, b) => (b.duration || 0) - (a.duration || 0),
  };
  list.sort(sorters[S.sort] || sorters.title);
  return list;
}

function viewList(title, eyebrow) {
  const list = currentList();
  const totalSec = list.reduce((a, s) => a + (s.duration || 0), 0);

  return `
    <div class="eyebrow">${esc(eyebrow)}</div>
    <h1 class="view-title">${esc(title)}</h1>
    <div class="view-sub">${list.length} tracks <span class="t-mono">· ${fmtHours(totalSec)} h</span></div>

    <div class="lib-tools">
      <div class="search-wrap">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>
        <input id="searchInput" type="text" placeholder="Search a track or artist…" value="${esc(S.search)}" autocomplete="off">
      </div>
      <select id="sortSel" class="select" aria-label="Sort by">
        <option value="title"${S.sort === 'title' ? ' selected' : ''}>By title</option>
        <option value="artist"${S.sort === 'artist' ? ' selected' : ''}>By artist</option>
        <option value="plays"${S.sort === 'plays' ? ' selected' : ''}>Most played</option>
        <option value="duration"${S.sort === 'duration' ? ' selected' : ''}>Longest</option>
      </select>
      <button class="pill-btn" data-playall>
        <svg viewBox="0 0 24 24"><path d="M8 5l12 7-12 7z" class="fill"/></svg> Play
      </button>
      <button class="pill-btn ghost" data-shuffleall>
        <svg viewBox="0 0 24 24"><path d="M3 7h3.5c1.5 0 2.6.7 3.5 2l4 6c.9 1.3 2 2 3.5 2H21"/><path d="M3 17h3.5c1.5 0 2.6-.7 3.5-2l4-6c.9-1.3 2-2 3.5-2H21"/><path d="M18 4l3 3-3 3"/><path d="M18 14l3 3-3 3"/></svg> Shuffle
      </button>
    </div>

    <div class="song-list" id="songList">
      ${list.map((s, i) => songRow(s, i)).join('')}
      ${
        !list.length
          ? `<div class="empty"><div class="e-big">Nothing here</div>${
              S.search ? 'Try a different search.' : 'Drop audio files into your music folder.'
            }</div>`
          : ''
      }
    </div>`;
}

function viewStats() {
  const st = computeCache;
  const maxArtist = st.topArtists[0]?.[1] || 1;
  const maxGenre = st.topGenres[0]?.[1] || 1;

  return `
    <div class="eyebrow">Listening data · since you started</div>
    <h1 class="view-title">Stats</h1>
    <div class="view-sub">What you play when nobody is looking.</div>

    <div class="stat-grid">
      <div class="stat-tile"><div class="stat-num">${fmtHours(st.totalSec)}<small>h</small></div><div class="stat-label">Hours total</div></div>
      <div class="stat-tile"><div class="stat-num">${fmtHours(st.monthSec)}<small>h</small></div><div class="stat-label">This month</div></div>
      <div class="stat-tile"><div class="stat-num">${st.totalPlays.toLocaleString()}</div><div class="stat-label">Plays</div></div>
      <div class="stat-tile"><div class="stat-num">${S.songs.length}</div><div class="stat-label">Tracks in library</div></div>
      <div class="stat-tile"><div class="stat-num">${st.streak}<small>${st.streak === 1 ? 'day' : 'days'}</small></div><div class="stat-label">Listening streak</div></div>
    </div>

    ${
      st.topSongs.length
        ? `
    <div class="section-head"><span class="section-title">Most played tracks</span></div>
    <div class="rank-list">
      ${st.topSongs
        .filter(([id]) => S.byId.has(id))
        .map(([id, c], i) => {
          const s = S.byId.get(id);
          return `
        <div class="rank-row" data-id="${esc(id)}" role="button" tabindex="0">
          <div class="rank-n">${i + 1}</div>
          ${coverHtml(s, 's-cover')}
          <div class="s-main">
            <div class="s-title">${esc(s.title)}</div>
            <div class="s-artist">${esc(s.artist)}</div>
          </div>
          <div class="rank-count">${c}&times; · ${fmtHours(c * (s.duration || 180))} h</div>
        </div>`;
        })
        .join('')}
    </div>`
        : `<div class="empty"><div class="e-big">No data yet</div>Stats show up after the first few plays.</div>`
    }

    ${
      st.topArtists.length || st.topGenres.length
        ? `
    <div class="section-head"><span class="section-title">Breakdown</span></div>
    <div class="stats-cols">
      ${
        st.topArtists.length
          ? `
      <div>
        <div class="eyebrow" style="margin-bottom:12px">Top artists</div>
        <div class="bar-list">
          ${st.topArtists
            .map(
              ([a, c]) => `
            <div class="bar-item">
              <div class="b-head"><span class="b-name">${esc(a)}</span><span class="b-val">${c}&times;</span></div>
              <div class="b-track"><div class="b-fill" style="width:${Math.round((c / maxArtist) * 100)}%"></div></div>
            </div>`,
            )
            .join('')}
        </div>
      </div>`
          : ''
      }
      ${
        st.topGenres.length
          ? `
      <div>
        <div class="eyebrow" style="margin-bottom:12px">Top genres</div>
        <div class="bar-list">
          ${st.topGenres
            .map(
              ([g, c]) => `
            <div class="bar-item">
              <div class="b-head"><span class="b-name">${esc(g)}</span><span class="b-val">${c}&times;</span></div>
              <div class="b-track"><div class="b-fill" style="width:${Math.round((c / maxGenre) * 100)}%"></div></div>
            </div>`,
            )
            .join('')}
        </div>
      </div>`
          : ''
      }
    </div>`
        : ''
    }`;
}

function viewSettings() {
  const c = S.config;
  return `
    <div class="eyebrow">Wavequen ${esc(c.version || '')}</div>
    <h1 class="view-title">Settings</h1>
    <div class="view-sub">Everything lives on your own disk.</div>

    <div class="set-list">
      <div class="set-row">
        <div class="set-main">
          <div class="set-name">Music folder</div>
          <div class="set-val t-mono">${esc(c.musicDir || 'not set')}</div>
        </div>
        <button class="pill-btn ghost" id="setPickDir">Change</button>
      </div>

      <div class="set-row set-col">
        <div class="set-head">
          <div class="set-main">
            <div class="set-name">Discord Rich Presence</div>
            <div class="set-val">Shows what you are listening to on your Discord profile. Needs the Discord desktop app running.</div>
          </div>
          <button class="pill-btn ghost${c.discordRpc ? ' on' : ''}" id="setDiscord">${c.discordRpc ? 'On' : 'Off'}</button>
        </div>
        <label class="set-field">
          <span class="set-field-label">Your Discord application ID</span>
          <input id="setDiscordId" class="set-input t-mono" type="text" inputmode="numeric" spellcheck="false"
                 placeholder="paste the ID here" value="${esc(c.discordAppId || '')}">
          <span class="set-hint">Create an application at discord.com/developers/applications, copy its Application ID and paste it here. Presence stays off until you do.</span>
        </label>
      </div>

      <div class="set-row">
        <div class="set-main">
          <div class="set-name">Data folder</div>
          <div class="set-val t-mono">${esc(c.dataDir || '')}</div>
        </div>
        <button class="pill-btn ghost" id="setOpenData">Open</button>
      </div>

      <div class="set-row">
        <div class="set-main">
          <div class="set-name">Import data from an older install</div>
          <div class="set-val">Copies stats, liked tracks and cached covers from another Wavequen data folder.</div>
        </div>
        <button class="pill-btn ghost" id="setImport">Import</button>
      </div>
    </div>`;
}

function wireSettings() {
  $('#setPickDir')?.addEventListener('click', chooseMusicDir);
  $('#setOpenData')?.addEventListener('click', () => window.wavequen.openDataFolder());
  $('#setImport')?.addEventListener('click', async () => {
    const r = await window.wavequen.importData();
    if (!r) return;
    toast(r.copied ? `Imported ${r.copied} file(s)` : 'No Wavequen data found there');
    if (r.copied) await reloadAll();
  });
  $('#setDiscord')?.addEventListener('click', async () => {
    S.config.discordRpc = !S.config.discordRpc;
    await window.wavequen.setDiscord(S.config.discordRpc);
    render();
  });
  $('#setDiscordId')?.addEventListener('change', async (e) => {
    const id = e.target.value.trim();
    const ok = await window.wavequen.setDiscordId(id);
    if (!ok) {
      toast('That does not look like a Discord application ID');
      e.target.value = S.config.discordAppId || '';
      return;
    }
    S.config.discordAppId = id;
    toast(id ? 'Discord application ID saved' : 'Discord application ID cleared');
  });
}

async function chooseMusicDir() {
  const picked = await window.wavequen.pickMusicDir();
  if (!picked) return;
  await window.wavequen.setMusicDir(picked.dir);
  S.config.musicDir = picked.dir;
  await reloadAll();
  toast(`Library: ${picked.tracks} tracks, ${picked.folders} genres`);
}

function render() {
  computeCache = computeStats();
  const view = $('#view');
  if (S.view === 'home') view.innerHTML = viewHome();
  else if (S.view === 'library') view.innerHTML = viewList('Library', 'All your music');
  else if (S.view === 'liked') view.innerHTML = viewList('Liked', 'Your favourites');
  else if (S.view === 'genre') view.innerHTML = viewList(S.viewArg, 'Genre');
  else if (S.view === 'stats') view.innerHTML = viewStats();
  else if (S.view === 'settings') view.innerHTML = viewSettings();
  hydrateCovers(view);

  $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === S.view));
  $$('.genre-btn').forEach((b) =>
    b.classList.toggle('active', S.view === 'genre' && b.dataset.genre === S.viewArg),
  );

  if (S.view === 'settings') wireSettings();

  const si = $('#searchInput');
  if (si) {
    si.addEventListener('input', () => {
      S.search = si.value;
      const listEl = $('#songList');
      if (!listEl) return;
      const list = currentList();
      listEl.innerHTML =
        list.map((s, i) => songRow(s, i)).join('') +
        (!list.length
          ? `<div class="empty"><div class="e-big">Nothing found</div>Try a different search.</div>`
          : '');
      hydrateCovers(listEl);
    });
  }

  const ss = $('#sortSel');
  if (ss) {
    ss.addEventListener('change', () => {
      S.sort = ss.value;
      render();
    });
  }
}

function go(view, arg = null) {
  if (S.view !== view || S.viewArg !== arg) S.search = '';
  S.view = view;
  S.viewArg = arg;
  render();
  $('#view').scrollTop = 0;
}

function renderSidebar() {
  $('#genreList').innerHTML = S.genres
    .map(
      (g) => `
    <button class="genre-btn" data-genre="${esc(g.name)}">
      <span>${esc(g.name)}</span><span class="g-count">${g.songs.length}</span>
    </button>`,
    )
    .join('');
}

let actx = null;
let analyser = null;
let freq = null;
let gainNode = null;

function ensureAudioGraph() {
  if (actx) {
    if (actx.state === 'suspended') actx.resume();
    return;
  }
  actx = new AudioContext();
  const src = actx.createMediaElementSource(audio);
  analyser = actx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.82;
  gainNode = actx.createGain();
  src.connect(analyser);
  analyser.connect(gainNode);
  gainNode.connect(actx.destination);
  freq = new Uint8Array(analyser.frequencyBinCount);
  audio.volume = 1;
  gainNode.gain.value = S.volume;
}

function buildQueue(list, startId) {
  S.baseList = list.map((s) => s.id);
  let q = [...S.baseList];
  if (S.shuffle) {
    q = q.filter((id) => id !== startId);
    for (let i = q.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [q[i], q[j]] = [q[j], q[i]];
    }
    q.unshift(startId);
    S.qIndex = 0;
  } else {
    S.qIndex = Math.max(0, q.indexOf(startId));
  }
  S.queue = q;
}

function flushListen() {
  const id = S.queue[S.qIndex];
  if (!id) {
    S.listened = 0;
    return;
  }
  const dur = audio.duration || S.byId.get(id)?.duration || 0;
  if (dur > 0 && S.listened >= dur * 0.8) {
    const sec = Math.round(S.listened);
    window.wavequen.recordPlay(id, sec);
    S.stats.plays.push({ id, ts: Date.now(), sec });
    S.stats.listenSeconds += sec;
  }
  S.listened = 0;
}

function playIndex(i) {
  const id = S.queue[i];
  const song = S.byId.get(id);
  if (!song) return;
  flushListen();
  S.qIndex = i;
  ensureAudioGraph();
  audio.src = trackUrl(song);
  audio.play().catch(() => toast('That file will not play'));
  S.lastT = 0;
  updatePlayerUI();
  renderQueue();
  render();
}

function playContext(list, startId) {
  if (!list.length) return;
  buildQueue(list, startId ?? list[0].id);
  playIndex(S.qIndex);
}

function next(auto = false) {
  if (!S.queue.length) return;
  if (auto && S.repeat === 2) {
    audio.currentTime = 0;
    audio.play();
    return;
  }
  let i = S.qIndex + 1;
  if (i >= S.queue.length) {
    if (S.repeat === 1 || !auto) i = 0;
    else {
      S.playing = false;
      updatePlayerUI();
      return;
    }
  }
  playIndex(i);
}

function prev() {
  if (!S.queue.length) return;
  if (audio.currentTime > 4) {
    audio.currentTime = 0;
    return;
  }
  playIndex(S.qIndex > 0 ? S.qIndex - 1 : 0);
}

function togglePlay() {
  if (!S.queue.length) {
    const list = currentList();
    playContext(list.length ? list : S.songs, null);
    return;
  }
  if (audio.paused) {
    ensureAudioGraph();
    audio.play();
  } else {
    audio.pause();
  }
}

function currentSong() {
  return S.byId.get(S.queue[S.qIndex]);
}

function pushPresence() {
  const s = currentSong();
  if (!s) {
    window.wavequen.clearPresence();
    return;
  }
  window.wavequen.setPresence({
    title: s.title,
    artist: s.artist,
    album: s.folder || null,
    cover: s.cover || null,
    duration: audio.duration || s.duration || 0,
    position: audio.currentTime || 0,
    paused: audio.paused,
  });
}

function updatePlayerUI() {
  const s = currentSong();
  $('#pbTitle').textContent = s ? s.title : 'Nothing playing';
  $('#pbArtist').textContent = s ? s.artist : 'Pick a track';
  const pc = $('#pbCover');
  pc.innerHTML = '';
  if (s) {
    pc.textContent = (s.title[0] || '?').toUpperCase();
    if (s.cover) {
      const img = document.createElement('img');
      img.onload = () => img.classList.add('ok');
      img.src = s.cover;
      pc.appendChild(img);
    }
  }
  const like = $('#pbLike');
  like.disabled = !s;
  like.classList.toggle('liked', !!s && S.liked.has(s.id));

  $('#iconPlay').toggleAttribute('hidden', S.playing);
  $('#iconPause').toggleAttribute('hidden', !S.playing);
  $('#btnShuffle').classList.toggle('on', S.shuffle);
  const rep = $('#btnRepeat');
  rep.classList.toggle('on', S.repeat > 0);
  rep.classList.toggle('one', S.repeat === 2);
  $('#repeatOne').toggleAttribute('hidden', S.repeat !== 2);

  if (!$('#nowplaying').hidden && s) {
    $('#npTitle').textContent = s.title;
    $('#npArtist').textContent = s.artist;
    $('#npCover').style.backgroundImage = s.cover ? `url("${s.cover}")` : 'none';
    $('#npBackdrop').style.backgroundImage = s.cover ? `url("${s.cover}")` : 'none';
  }
  document.title = s ? `${s.title} — Wavequen` : 'Wavequen';
}

function renderQueue() {
  if ($('#queuePanel').hidden) return;
  const el = $('#queueList');
  const upcoming = S.queue.slice(Math.max(0, S.qIndex), S.qIndex + 60);
  el.innerHTML =
    upcoming
      .map((id, k) => {
        const s = S.byId.get(id);
        if (!s) return '';
        const abs = Math.max(0, S.qIndex) + k;
        return `
    <button class="qp-row${abs === S.qIndex ? ' current' : ''}" data-qi="${abs}">
      ${coverHtml(s, 's-cover')}
      <div class="s-main">
        <div class="s-title" style="font-size:13px">${esc(s.title)}</div>
        <div class="s-artist">${esc(s.artist)}</div>
      </div>
    </button>`;
      })
      .join('') || '<div class="empty" style="margin:10px">The queue is empty.</div>';
  hydrateCovers(el);
}

const strip = $('#wavestrip');
const npViz = $('#npViz');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function resizeCanvases() {
  strip.width = strip.clientWidth * devicePixelRatio;
  strip.height = 34 * devicePixelRatio;
  if (!$('#nowplaying').hidden) {
    npViz.width = npViz.clientWidth * devicePixelRatio;
    npViz.height = 150 * devicePixelRatio;
  }
}
addEventListener('resize', resizeCanvases);

function drawViz() {
  requestAnimationFrame(drawViz);
  const ctx = strip.getContext('2d');
  const W = strip.width;
  const H = strip.height;
  ctx.clearRect(0, 0, W, H);

  let data = null;
  if (analyser && S.playing && !reducedMotion) {
    analyser.getByteFrequencyData(freq);
    data = freq;
  }

  if (data) {
    const N = 120;
    const gap = W / N;
    ctx.fillStyle = 'rgba(242,242,242,0.85)';
    for (let i = 0; i < N; i++) {
      const v = data[Math.floor((i / N) * data.length * 0.72)] / 255;
      const h = Math.max(devicePixelRatio, v * H * 0.92);
      ctx.fillRect(i * gap + gap * 0.3, H - h, gap * 0.4, h);
    }
  }

  if (!$('#nowplaying').hidden) {
    const c2 = npViz.getContext('2d');
    const W2 = npViz.width;
    const H2 = npViz.height;
    c2.clearRect(0, 0, W2, H2);
    const N2 = 90;
    const gap2 = W2 / N2;
    for (let i = 0; i < N2; i++) {
      const v = data ? data[Math.floor((i / N2) * data.length * 0.72)] / 255 : 0;
      const h = Math.max(devicePixelRatio, v * H2 * 0.95);
      c2.fillStyle = `rgba(242,242,242,${0.25 + v * 0.65})`;
      c2.fillRect(i * gap2 + gap2 * 0.28, H2 - h, gap2 * 0.44, h);
    }
    if (data && !reducedMotion) {
      let bass = 0;
      for (let i = 0; i < 8; i++) bass += data[i];
      bass /= 8 * 255;
      const np = $('#npCover');
      np.style.setProperty('--pulse', `${Math.round(bass * 46)}px`);
      np.style.setProperty('--pulse-a', (bass * 0.28).toFixed(3));
    }
  }
}

const SLEEP_STEPS = [null, 15, 30, 60, 90, 'track'];
let sleepStep = 0;

function cycleSleep() {
  sleepStep = (sleepStep + 1) % SLEEP_STEPS.length;
  const v = SLEEP_STEPS[sleepStep];
  S.sleepTrack = v === 'track';
  S.sleepUntil = typeof v === 'number' ? Date.now() + v * 60000 : null;
  $('#btnSleep').classList.toggle('on', v != null);
  if (v == null) toast('Sleep timer off');
  else if (v === 'track') toast('Stopping after this track');
  else toast(`Stopping in ${v} minutes`);
  updateSleepLabel();
}

function updateSleepLabel() {
  const el = $('#sleepLeft');
  if (S.sleepUntil) {
    const left = Math.max(0, S.sleepUntil - Date.now());
    el.hidden = false;
    el.textContent = fmtTime(left / 1000);
    if (left <= 0) {
      audio.pause();
      S.sleepUntil = null;
      sleepStep = 0;
      $('#btnSleep').classList.remove('on');
      el.hidden = true;
      toast('Good night');
    }
  } else if (S.sleepTrack) {
    el.hidden = false;
    el.textContent = 'end of track';
  } else {
    el.hidden = true;
  }
}
setInterval(updateSleepLabel, 1000);

audio.addEventListener('play', () => {
  S.playing = true;
  updatePlayerUI();
  syncEq();
  pushPresence();
});

audio.addEventListener('pause', () => {
  S.playing = false;
  updatePlayerUI();
  syncEq();
  pushPresence();
});

audio.addEventListener('loadedmetadata', () => {
  const s = currentSong();
  if (s && !s.duration && Number.isFinite(audio.duration) && audio.duration > 0) {
    s.duration = Math.round(audio.duration);
    window.wavequen.saveDuration(s.file, audio.duration);
  }
  pushPresence();
});

audio.addEventListener('ended', () => {
  if (S.sleepTrack) {
    S.sleepTrack = false;
    sleepStep = 0;
    $('#btnSleep').classList.remove('on');
    flushListen();
    toast('Good night');
    return;
  }
  next(true);
});

audio.addEventListener('timeupdate', () => {
  const t = audio.currentTime;
  const d = t - S.lastT;
  if (d > 0 && d < 2) S.listened += d;
  S.lastT = t;
  $('#tCur').textContent = fmtTime(t);
  $('#tTotal').textContent = fmtTime(audio.duration);
  const pct = audio.duration ? (t / audio.duration) * 100 : 0;
  $('#seekFill').style.width = pct + '%';
  $('#seekBar').setAttribute('aria-valuenow', Math.round(pct));
});

function syncEq() {
  $$('.eq').forEach((e) => e.classList.toggle('paused', !S.playing));
}

$('#view').addEventListener('click', (e) => {
  const like = e.target.closest('[data-like]');
  if (like) {
    e.stopPropagation();
    toggleLike(like.dataset.like, like);
    return;
  }
  if (e.target.closest('select') || e.target.closest('.set-row')) return;
  const genre = e.target.closest('[data-genre]');
  if (genre) {
    go('genre', genre.dataset.genre);
    return;
  }
  if (e.target.closest('[data-playall]')) {
    playContext(currentList(), null);
    return;
  }
  if (e.target.closest('[data-shuffleall]')) {
    const list = currentList();
    if (!list.length) return;
    S.shuffle = true;
    localStorage.wq_shuffle = '1';
    playContext(list, list[Math.floor(Math.random() * list.length)].id);
    return;
  }
  const row = e.target.closest('[data-id]');
  if (row) {
    const id = row.dataset.id;
    if (S.view === 'home' || S.view === 'stats') playContext(S.songs, id);
    else playContext(currentList(), id);
  }
});

$('#view').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const row = e.target.closest('[data-id]');
    if (row) row.click();
  }
});

function toggleLike(id, btn) {
  if (S.liked.has(id)) {
    S.liked.delete(id);
  } else {
    S.liked.add(id);
    btn && btn.classList.add('pop');
    setTimeout(() => btn && btn.classList.remove('pop'), 350);
  }
  window.wavequen.savePlaylists({ liked: [...S.liked] });
  $$(`[data-like="${CSS.escape(id)}"]`).forEach((b) => b.classList.toggle('liked', S.liked.has(id)));
  const cur = currentSong();
  if (cur && cur.id === id) $('#pbLike').classList.toggle('liked', S.liked.has(id));
  if (S.view === 'liked') render();
}

$('#mainNav').addEventListener('click', (e) => {
  const b = e.target.closest('.nav-btn');
  if (b) go(b.dataset.view);
});

$('#genreList').addEventListener('click', (e) => {
  const b = e.target.closest('.genre-btn');
  if (b) go('genre', b.dataset.genre);
});

$('#openFolder').addEventListener('click', () => window.wavequen.openMusicFolder());

$('#btnPlay').addEventListener('click', togglePlay);
$('#btnNext').addEventListener('click', () => next(false));
$('#btnPrev').addEventListener('click', prev);

$('#btnShuffle').addEventListener('click', () => {
  S.shuffle = !S.shuffle;
  localStorage.wq_shuffle = S.shuffle ? '1' : '0';
  if (S.queue.length) {
    const curId = S.queue[S.qIndex];
    const list = S.baseList.map((id) => S.byId.get(id)).filter(Boolean);
    buildQueue(list, curId);
  }
  updatePlayerUI();
  renderQueue();
});

$('#btnRepeat').addEventListener('click', () => {
  S.repeat = (S.repeat + 1) % 3;
  localStorage.wq_repeat = S.repeat;
  updatePlayerUI();
});

$('#btnSleep').addEventListener('click', cycleSleep);

$('#pbLike').addEventListener('click', () => {
  const s = currentSong();
  if (s) toggleLike(s.id, $('#pbLike'));
});

function barDrag(bar, onRatio) {
  const apply = (e) => {
    const r = bar.getBoundingClientRect();
    onRatio(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
  };
  bar.addEventListener('pointerdown', (e) => {
    bar.setPointerCapture(e.pointerId);
    apply(e);
    const move = (ev) => apply(ev);
    const up = () => {
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
  });
}

barDrag($('#seekBar'), (r) => {
  if (audio.duration) {
    audio.currentTime = r * audio.duration;
    S.lastT = audio.currentTime;
    pushPresence();
  }
});

barDrag($('#volBar'), (r) => setVolume(r));

function setVolume(v) {
  S.volume = v;
  if (gainNode) gainNode.gain.value = v;
  else audio.volume = v;
  localStorage.wq_vol = v;
  $('#volFill').style.width = v * 100 + '%';
  $('#volBar').setAttribute('aria-valuenow', Math.round(v * 100));
  $('#volWave').style.opacity = v === 0 ? 0.2 : 1;
}

let preMute = 0.8;
$('#btnVol').addEventListener('click', () => {
  if (S.volume > 0) {
    preMute = S.volume;
    setVolume(0);
  } else {
    setVolume(preMute || 0.8);
  }
});

$('#btnQueue').addEventListener('click', () => {
  const qp = $('#queuePanel');
  qp.hidden = !qp.hidden;
  renderQueue();
});

$('#queueClose').addEventListener('click', () => {
  $('#queuePanel').hidden = true;
});

$('#queueList').addEventListener('click', (e) => {
  const r = e.target.closest('[data-qi]');
  if (r) playIndex(Number(r.dataset.qi));
});

$('#pbCover').addEventListener('click', () => {
  if (!currentSong()) return;
  $('#nowplaying').hidden = false;
  updatePlayerUI();
  resizeCanvases();
});

$('#npClose').addEventListener('click', () => {
  $('#nowplaying').hidden = true;
});

$('#winMin').addEventListener('click', () => window.wavequen.winMin());
$('#winMax').addEventListener('click', () => window.wavequen.winMax());
$('#winClose').addEventListener('click', () => {
  flushListen();
  window.wavequen.winClose();
});

addEventListener('keydown', (e) => {
  if (!$('#onboarding').hidden) return;
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  if (e.code === 'Space') {
    e.preventDefault();
    togglePlay();
  } else if (e.key === 'ArrowRight') {
    audio.currentTime = Math.min((audio.currentTime || 0) + 5, audio.duration || 0);
    pushPresence();
  } else if (e.key === 'ArrowLeft') {
    audio.currentTime = Math.max((audio.currentTime || 0) - 5, 0);
    pushPresence();
  } else if (e.key === '/') {
    e.preventDefault();
    const si = $('#searchInput');
    if (si) si.focus();
    else {
      go('library');
      $('#searchInput')?.focus();
    }
  } else if (e.key === 'Escape') {
    $('#nowplaying').hidden = true;
    $('#queuePanel').hidden = true;
  }
});

window.wavequen.onMedia((action) => {
  if (action === 'playpause') togglePlay();
  else if (action === 'next') next(false);
  else if (action === 'prev') prev();
});

window.wavequen.onCoverUpdate(({ id, url, artist }) => {
  const s = S.byId.get(id);
  if (s) {
    if (url) s.cover = url;
    if (artist) s.artist = artist;
  }
  if (url) {
    $$(`.cover[data-cid="${CSS.escape(id)}"]`).forEach((c) => {
      if ($('img', c)) return;
      const img = document.createElement('img');
      img.onload = () => {
        img.classList.add('ok');
        c.classList.remove('skeleton');
      };
      img.src = url;
      c.appendChild(img);
    });
  }
  if (artist) {
    $$(`[data-id="${CSS.escape(id)}"] .s-artist`).forEach((e) => (e.textContent = artist));
    $$(`.card[data-id="${CSS.escape(id)}"] .c-sub`).forEach((e) => (e.textContent = artist));
  }
  const cur = currentSong();
  if (cur && cur.id === id) {
    updatePlayerUI();
    pushPresence();
  }
});

window.wavequen.onLibChanged(() => {
  reloadLibrary();
  toast('Library updated');
});

addEventListener('beforeunload', () => flushListen());

let obDir = null;

function showOnboarding() {
  const ob = $('#onboarding');
  ob.hidden = false;

  $('#obPick').addEventListener('click', async () => {
    const picked = await window.wavequen.pickMusicDir();
    if (!picked) return;
    obDir = picked.dir;
    const box = $('#obPicked');
    box.hidden = false;
    box.innerHTML = `
      <div class="ob-path t-mono">${esc(picked.dir)}</div>
      <div class="ob-count">${picked.tracks} tracks · ${picked.folders} genre folders</div>`;
    $('#obDone').disabled = false;
  });

  $('#obImport').addEventListener('click', async () => {
    const r = await window.wavequen.importData();
    if (!r) return;
    toast(r.copied ? `Imported ${r.copied} file(s)` : 'No Wavequen data found there');
  });

  $('#obDone').addEventListener('click', async () => {
    if (!obDir) return;
    await window.wavequen.setMusicDir(obDir);
    ob.hidden = true;
    await reloadAll();
    window.wavequen.fetchCovers();
  });
}

async function reloadLibrary() {
  const cat = await window.wavequen.catalog();
  S.songs = cat.songs;
  S.genres = cat.folderPlaylists;
  S.byId = new Map(cat.songs.map((s) => [s.id, s]));
  renderSidebar();
  render();
}

async function reloadAll() {
  const [cat, pls, stats, cfg] = await Promise.all([
    window.wavequen.catalog(),
    window.wavequen.getPlaylists(),
    window.wavequen.getStats(),
    window.wavequen.getConfig(),
  ]);
  S.songs = cat.songs;
  S.genres = cat.folderPlaylists;
  S.byId = new Map(cat.songs.map((s) => [s.id, s]));
  S.liked = new Set(pls.liked || []);
  S.stats = { plays: stats.plays || [], listenSeconds: stats.listenSeconds || 0 };
  S.config = cfg;
  renderSidebar();
  render();
}

async function init() {
  setVolume(Number(localStorage.wq_vol ?? 0.8));
  await reloadAll();
  resizeCanvases();
  drawViz();
  if (!S.config.musicDir) showOnboarding();
  else window.wavequen.fetchCovers();
}

init();
