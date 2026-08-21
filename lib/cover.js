const https = require('https');

function httpsGetJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Wavequen/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return httpsGetJSON(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(new Error('timeout')); });
  });
}

function isUnknownArtist(a) {
  return !a || /^unknown artist$/i.test(a.trim());
}

function primaryArtist(artist) {
  return (artist || '').split(/[,&/]|ft\.?|feat\.?|\bx\b/i)[0].trim();
}

async function tryDeezer(term) {
  if (!term) return null;
  try {
    const json = await httpsGetJSON(`https://api.deezer.com/search?q=${encodeURIComponent(term)}&limit=1`);
    const r = json.data && json.data[0];
    if (r) {
      const a = r.album || {};
      return {
        artist: (r.artist && r.artist.name) || null,
        cover: a.cover_xl || a.cover_big || a.cover_medium || a.cover || null,
      };
    }
  } catch {}
  return null;
}

async function tryITunes(term) {
  if (!term) return null;
  try {
    const json = await httpsGetJSON(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=1`);
    const r = json.results && json.results[0];
    if (r) return {
      artist: r.artistName || null,
      cover: r.artworkUrl100 ? r.artworkUrl100.replace(/\/\d+x\d+bb\./, '/600x600bb.') : null,
    };
  } catch {}
  return null;
}

async function fetchTrackInfo(artist, title) {
  const art = isUnknownArtist(artist) ? '' : primaryArtist(artist);
  const ttl = (title || '').trim();
  if (!ttl && !art) return null;
  const both = art && ttl ? `${art} ${ttl}` : '';
  return (
    (both && (await tryDeezer(both))) ||
    (ttl && (await tryDeezer(ttl))) ||
    (both && (await tryITunes(both))) ||
    (ttl && (await tryITunes(ttl))) ||
    null
  );
}

module.exports = { fetchTrackInfo, isUnknownArtist };
