const fs = require('fs');
const path = require('path');

const AUDIO_RE = /\.(wav|mp3|m4a|flac|ogg|opus|aac)$/i;

const JUNK = /\b(video|audio|official|oficial|officiel|visualizer|lyric|lyrics|music\s*video|videoclip|hd|4k|remix\s*oficial|prod\.?)\b/i;

function stripBrackets(s) {
  return s.replace(/[([{][^)\]}]*[)\]}]/g, (m) => (JUNK.test(m) ? '' : m));
}

function clean(s) {
  return s
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[｜|].*/g, '')
    .replace(/#\S+/g, '')
    .replace(/@\S+/g, '')
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}←-⇿⬀-⯿✀-➿]/gu, '')
    .replace(/[?？]/g, '')
    .replace(/＂/g, '"')
    .replace(/[​-‏‪-‮⁠﻿]/g, '')
    .replace(/\s+l\s+/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s\-–—_,]+$/g, '')
    .replace(/^[\s\-–—_,]+/g, '')
    .trim();
}

function parseName(filename) {
  const base = filename.replace(/\.[a-z0-9]+$/i, '');
  let artist = '';
  let title = base;

  const sepMatch = base.match(/\s[-–—]\s/);
  if (sepMatch) {
    const idx = base.indexOf(sepMatch[0]);
    artist = base.slice(0, idx);
    title = base.slice(idx + sepMatch[0].length);
  } else {
    const tight = base.match(/^([^-–—]{2,40})[-–—](.{2,})$/);
    if (tight) {
      artist = tight[1];
      title = tight[2];
    } else {
      const byMatch = base.match(/^(.{2,})\s+by\s+(.{2,})$/i);
      if (byMatch) {
        title = byMatch[1];
        artist = byMatch[2];
      }
    }
  }

  artist = clean(stripBrackets(artist));
  title = clean(stripBrackets(title));

  if (!title) title = clean(base) || base.trim();
  if (!artist) artist = 'Unknown artist';

  return { artist, title };
}

function wavDuration(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(12);
    fs.readSync(fd, header, 0, 12, 0);
    if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') {
      return null;
    }
    let offset = 12;
    let byteRate = null;
    let dataSize = null;
    const chunkHead = Buffer.alloc(8);
    const fileSize = fs.fstatSync(fd).size;

    while (offset + 8 <= fileSize) {
      fs.readSync(fd, chunkHead, 0, 8, offset);
      const id = chunkHead.toString('ascii', 0, 4);
      const size = chunkHead.readUInt32LE(4);
      if (id === 'fmt ') {
        const fmt = Buffer.alloc(16);
        fs.readSync(fd, fmt, 0, 16, offset + 8);
        byteRate = fmt.readUInt32LE(8);
      } else if (id === 'data') {
        dataSize = size;
        break;
      }
      offset += 8 + size + (size % 2);
    }

    if (byteRate && dataSize) return Math.round(dataSize / byteRate);
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
}

function fileToId(file) {
  return file
    .replace(/\.[a-z0-9]+$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'track';
}

// Resolves rel against root and returns null when it escapes root.
function resolveInside(root, rel) {
  const base = path.resolve(root);
  const full = path.resolve(base, rel);
  if (full !== base && !full.startsWith(base + path.sep)) return null;
  return full;
}

function makeSong(musicDir, relFile) {
  const base = path.basename(relFile);
  const { artist, title } = parseName(base);
  return {
    id: fileToId(base),
    file: relFile.replace(/\\/g, '/'),
    title,
    artist,
    duration: wavDuration(path.join(musicDir, relFile)) || null,
    cover: null,
  };
}

function scanLibrary(musicDir) {
  const songs = [];
  const seen = new Set();
  const folderPlaylists = [];

  let rootEntries = [];
  try {
    rootEntries = fs.readdirSync(musicDir, { withFileTypes: true });
  } catch {
    return { songs, folderPlaylists };
  }

  rootEntries
    .filter((d) => d.isFile() && AUDIO_RE.test(d.name))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b))
    .forEach((f) => {
      const s = makeSong(musicDir, f);
      if (!seen.has(s.id)) { seen.add(s.id); songs.push(s); }
    });

  rootEntries
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b))
    .forEach((folder) => {
      let files = [];
      try { files = fs.readdirSync(path.join(musicDir, folder)); } catch { return; }
      const plSongIds = [];
      files
        .filter((f) => AUDIO_RE.test(f))
        .sort((a, b) => a.localeCompare(b))
        .forEach((f) => {
          const s = makeSong(musicDir, path.join(folder, f));
          if (!seen.has(s.id)) { seen.add(s.id); songs.push(s); }
          plSongIds.push(s.id);
        });
      if (plSongIds.length) {
        folderPlaylists.push({
          id: 'folder_' + fileToId(folder),
          name: folder,
          songs: plSongIds,
        });
      }
    });

  return { songs, folderPlaylists };
}

function countLibrary(musicDir) {
  const { songs, folderPlaylists } = scanLibrary(musicDir);
  return { tracks: songs.length, folders: folderPlaylists.length };
}

module.exports = { AUDIO_RE, scanLibrary, countLibrary, parseName, wavDuration, fileToId, resolveInside };
