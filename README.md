# Wavequen

A minimal desktop music player for the files you already own. Point it at a folder, and every
subfolder becomes a genre playlist. Black and white interface, the only colour comes from album art.

Nothing is uploaded, nothing is streamed, nothing is moved or renamed on your disk.

## Features

- **Folder playlists** — each subfolder of your music folder is a genre, picked up automatically
- **Live visualiser** — waveform strip in the player bar, full screen view on the album art
- **Listening stats** — hours, plays, streak, top tracks, artists and genres
- **Album art** — fetched from Deezer and iTunes and cached locally, no API key needed
- **Discord Rich Presence** — shows what you are playing, with a progress bar
- **Queue, shuffle, repeat, liked tracks, sleep timer** and hardware media keys
- **Live folder watching** — drop a file in, it shows up without a restart
- Formats: `wav`, `mp3`, `m4a`, `flac`, `ogg`, `opus`, `aac`

## Install

Grab the installer or the portable build from
[Releases](https://github.com/Dinouseg/wavequen/releases), or run from source:

```bash
git clone https://github.com/Dinouseg/wavequen.git
cd wavequen
npm install
npm start
```

On the first run Wavequen asks for your music folder. That is the whole setup.

## Where things live

| What | Where |
|---|---|
| Your music | the folder you chose during setup (Settings → Change) |
| Settings, stats, liked tracks, cached covers | `%APPDATA%/Wavequen` · `~/.config/Wavequen` · `~/Library/Application Support/Wavequen` |

Track titles and artists are read from file names (`Artist - Title.wav`). Missing artists are filled
in from Deezer or iTunes when a match is found, and stored in `data/overrides.json` — edit that file
if a guess is wrong.

## Keyboard

| Key | Action |
|---|---|
| `Space` | play / pause |
| `←` `→` | seek 5 seconds |
| `/` | search |
| `Esc` | close now playing or queue |

## Build

```bash
npm run dist          # installer + portable .exe on Windows
npm run dist:linux    # AppImage
npm run dist:mac      # dmg
```

Artefacts land in `dist/`. Cross-building for macOS requires a Mac.

Pushing a `v*` tag builds all three platforms on GitHub Actions and attaches them to a Release
(`.github/workflows/release.yml`).

On Windows, electron-builder unpacks a signing toolchain that contains symlinks, which needs
**Developer Mode** on (Settings → Privacy & security → For developers) or an elevated terminal.
Without it the build stops at `Cannot create symbolic link`. If you only want a quick test build,
`npx electron-builder --win --config.win.signAndEditExecutable=false` skips that step, at the cost of
the executable keeping Electron's default icon and version metadata.

## Discord Rich Presence

Wavequen ships without a Discord application of its own, so you use your own:

1. Open [discord.com/developers/applications](https://discord.com/developers/applications) and create
   an application (any name — that name is what shows up on your profile).
2. Copy its **Application ID**.
3. Paste it into Settings → Discord Rich Presence.

Presence stays off until an ID is set, and is silently skipped when the Discord desktop app is not
running. Upload images named `wavequen`, `play` and `pause` to the application's Rich Presence assets
if you want the fallback artwork and the play/pause badge.

## Development

```bash
npm test    # file name parsing and library path guard
npm start
```

- `main.js` — window, config, library scan, the `wq://` file protocol, Discord presence
- `preload.js` — the IPC surface exposed to the renderer
- `app.js` — renderer: views, playback, queue, visualiser
- `lib/scan.js` — folder scan, file name parsing, WAV duration
- `lib/cover.js` — album art and artist lookup

The renderer runs with context isolation and web security on; audio is served through the custom
`wq://` protocol, which only ever reads audio files inside your music folder.

## License

MIT — see [LICENSE](LICENSE).
