# Music Box

A fullscreen, iPod Classic–styled music player that streams your entire Dropbox account. Built to run as a home-screen web app on iPhone (Safari "Add to Home Screen") or Android (Chrome "Add to Home Screen" / "Install app"), with a functional click wheel, full-bleed album art, and metadata read directly from your files' embedded tags.

## Usage

**iPhone:** open the deployed URL in Safari, then **Share → Add to Home Screen** and launch it from the icon for a true fullscreen experience (no address bar).

**Android:** open the deployed URL in Chrome, then use the **⋮ menu → Add to Home Screen** (or the "Install app" prompt if Chrome offers it) and launch from the icon — `manifest.json` + a minimal service worker (`sw.js`, network-only, no caching) make this a real installable PWA rather than a plain bookmark shortcut, launching `display: fullscreen` with no address bar or system status bar.

Either way: browse your Dropbox folder tree, search across it (matches folder names too, not just filenames), tap a track to play. The click wheel works like the real thing: drag anywhere on the ring to scroll the current list, tap Menu/Previous/Next/Play-Pause/Select to trigger those actions. While Now Playing is open, dragging the wheel scrubs the track instead of scrolling a list.

Playback position and the current track persist across reloads (`localStorage`), so reopening the app after iOS kills it in the background picks up roughly where you left off.

## Architecture

| Path | Role |
|------|------|
| `public/index.html` | Page structure — device frame, screen (browse/search or Now Playing), click wheel |
| `public/style.css` | All styling — flat dark monospace theme, custom click wheel, custom scrub bar, blurred-backdrop artwork |
| `public/js/` | Client logic as ES modules (loaded via `<script type="module" src="js/main.js">`, no bundler) — see below |
| `public/files.json` | Generated folder/file tree the browser reads to render the file explorer — **not committed** (gitignored, same as `audio_files.txt`), regenerate with `node build-index.js` |
| `public/manifest.json` | Web App Manifest — name, icons, `display: fullscreen` — what makes Android Chrome's "Add to Home Screen" a real install instead of a bookmark shortcut |
| `public/sw.js` | Minimal service worker (network-only passthrough, no caching) — its only job is satisfying Chrome's installability requirement for a registered service worker |
| `public/icons/` | Click-wheel glyph icons (192/512px + iOS apple-touch-icon) referenced by `manifest.json` and `index.html` |
| `build-index.js` | Converts `audio_files.txt` (flat list of Dropbox paths) into the nested `public/files.json` tree |
| `audio_files.txt` | Flat list of every audio file path in the Dropbox account, one per line — **not committed** (contains your private file listing), produced via `rclone lsf -R --files-only dropbox:` (or similar) |
| `worker/worker.js` | Cloudflare Worker — proxies Dropbox: exchanges a stored refresh token for a short-lived access token, then returns a temporary streaming URL for a given file path via `GET /stream?path=...` |
| `worker/wrangler.toml` | Worker config — deployed as `music-box-api` |

### `public/js/` module layout

Plain ES modules, no build step — each file is a single, focused concern with a small exported public API. Dependencies run one direction only (browse/annotate/wheel/scrub depend on player; player never depends on them), so there's nothing circular to trace through:

| Module | Role |
|---|---|
| `dom.js` | Every `getElementById` call, in one place, as a single `el` object |
| `api.js` | All network calls to the Cloudflare Worker |
| `view.js` | Which of the two full-screen views (browse vs. now-playing) is showing |
| `library.js` | The loaded file tree — shared read-only data for both browsing and playback |
| `metadata/` | Embedded tag parsers (see below) — pure functions, no DOM or app-state dependencies |
| `artwork.js` | Now-playing artwork sizing/centering, the NASA fallback image, an on-screen debug surface |
| `waveform.js` | Waveform bars, which double as the progress bar |
| `banner.js` | Mini-status text/edge-fades and the shared scrub-progress UI |
| `track-metadata.js` | Orchestrates loading a track's tags + artwork once playback starts |
| `media-session.js` | Surfaces track info + transport controls to the OS — lock screen, Control Center, AirPods, and a car's CarPlay "Now Playing" screen |
| `player.js` | Playback engine — the `<audio>` element, queue, resume, shuffle |
| `browse.js` | Folder browsing, search, the wheel's cursor position |
| `annotate.js` | The reorg-triage notes/tags panel |
| `scrub.js` | Hold-and-slide-to-scrub gesture on the now-playing artwork |
| `wheel.js` | Click wheel drag/tap gesture handling |
| `main.js` | Entry point — loads the library, restores saved state, wires the couple of cross-module reactions (closing the annotate panel / re-rendering the browse list on playback change) that don't belong to any single module |

Metadata parsing (`metadata/`) reads embedded track tags (title/artist/artwork) directly in the browser via `fetch()` + `ArrayBuffer` — no third-party library. This replaced an initial attempt using `jsmediatags`, which turned out to rely on a legacy XHR technique (`overrideMimeType('text/plain; charset=x-user-defined')`) that fails outright on iOS WebKit (confirmed on a real iPhone, both Safari and Chrome for iOS, since they share the same WebKit engine):

- **MP3** (`metadata/id3.js`) — ID3v2.2/2.3/2.4 frames (`TIT2`/`TPE1`/`APIC`)
- **FLAC** (`metadata/flac.js`) — `VORBIS_COMMENT` and `PICTURE` metadata blocks
- **M4A** (`metadata/mp4.js`) — walks MP4 atoms (`moov > udta > meta > ilst > ©nam/©ART/covr`); `moov` can be positioned anywhere in the file depending on how it was muxed (faststart vs. not), so this does an incremental top-level atom walk — fetching each atom's header and jumping to the next atom's exact computed position — rather than guessing a fixed probe window

Other formats (WAV, AIFF, WMA, MIDI, etc.) fall back to filename-only, same as untagged files.

## Setup

### Dropbox API app

1. [Dropbox App Console](https://www.dropbox.com/developers/apps) → **Create app** → Scoped access → **Full Dropbox** access (needed since files span multiple top-level folders, not one app-specific folder)
2. **Permissions** tab → enable `files.metadata.read`, `files.content.read` → **Submit**
3. **Settings** tab → note the **App key** and **App secret**
4. Generate a refresh token (one-time):
   ```
   https://www.dropbox.com/oauth2/authorize?client_id=YOUR_APP_KEY&response_type=code&token_access_type=offline
   ```
   Log in, click Allow, copy the code shown, then:
   ```
   curl https://api.dropboxapi.com/oauth2/token \
     -d code=THE_CODE \
     -d grant_type=authorization_code \
     -d client_id=YOUR_APP_KEY \
     -d client_secret=YOUR_APP_SECRET
   ```
   Save the `refresh_token` from the response — scopes are baked in at authorization time, so if you ever add a new permission (e.g. for sharing or write access), you'll need to redo this step to get a token that actually includes it.

### Cloudflare Worker

```
cd worker
npx wrangler secret put DROPBOX_APP_KEY
npx wrangler secret put DROPBOX_APP_SECRET
npx wrangler secret put DROPBOX_REFRESH_TOKEN
npx wrangler deploy
```

If the deploy prints a different subdomain than `music-box-api.tissa-music.workers.dev`, update `WORKER_URL` at the top of `public/js/api.js` to match, and update `ALLOWED_ORIGIN` in `worker/worker.js` to match your actual Pages URL (CORS is locked to that one origin).

### File index

```
node build-index.js
```

Requires `audio_files.txt` in the project root — a flat list of every audio path in your Dropbox, one per line (no leading slash), e.g. generated with `rclone lsf -R --files-only dropbox:`. Regenerate whenever your Dropbox contents change.

### Deploy the frontend

```
node build-index.js
npx wrangler pages deploy public --project-name=music-box
```

### Local development

```
node build-index.js
cd public && python3 -m http.server 8000
```

Open `http://localhost:8000` in a **private/incognito window** — plain `http.server` doesn't send cache-busting headers, and repeat visits to the same local URL can otherwise serve stale JS/CSS. Folder browsing, breadcrumbs, search, and the click wheel all work fully locally. **Actual playback won't** — the Worker's CORS is locked to the deployed Pages origin (see `ALLOWED_ORIGIN` above), so a local origin's `/stream` and `/nasa-image` requests get blocked with `Failed to fetch`. That's expected, not a bug: the app's own error handling catches it and shows a "failed to load" message rather than crashing.

## Known limitations

- **Public by default.** The Cloudflare Pages URL has no access control — anyone with the link can browse your file listing and stream your audio. A Cloudflare Access login gate was discussed but never set up.
- **Read-only.** No metadata editing yet — see `FEATURES.md`.
- **No accessibility support for the click wheel.** It's a raw pointer-gesture surface (drag to scroll, tap zones for the five buttons), not real `<button>` elements, so it isn't operable via VoiceOver or keyboard. Acceptable for a personal single-user app, but worth knowing.
- Metadata parsing covers MP3/FLAC/M4A only; other formats show filename only.
