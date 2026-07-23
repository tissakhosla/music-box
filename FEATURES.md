# Features

## Current

- **Full Dropbox file browser** — folder navigation, Unix-style slash-separated breadcrumbs (single line, auto-scrolls to the current segment, swipeable to see the rest of a long path)
- **Search** — matches folder names as well as filenames (e.g. searching "Beethoven" finds every track inside a `Beethoven/` folder, not just files with that word in their own name)
- **Streaming playback** via a Cloudflare Worker that proxies Dropbox — the Worker mints short-lived temporary links, audio streams directly from Dropbox's CDN
- **Resume** — current track and playback position persist across reloads (`localStorage`), since iOS often kills backgrounded PWAs
- **iPod Classic–styled UI** — device frame, functional click wheel (drag to scroll the current list, tap zones for Menu/Previous/Next/Play-Pause/Select), flat dark monospace theme
- **Now Playing screen** — full-bleed, never-cropped artwork (blurred backdrop + contained foreground image), gradient scrim behind the track info/scrub bar, wheel-drag scrubs the track instead of scrolling a list while this screen is open
- **Embedded metadata** — title/artist/artwork read directly from MP3 (ID3v2), FLAC (Vorbis comments + picture block), and M4A (MP4 atoms) files, via custom-built parsers (no third-party library — see `README.md` for why)
- **PWA support** — Add to Home Screen for a true fullscreen app with no browser chrome, on both iOS (Safari) and Android (Chrome, via `manifest.json` + a minimal service worker)
- **Reorg-triage annotations** — while listening, tap Select on the Now Playing screen to open a full-screen panel (outside the simulated device frame, so there's real room to work) and attach freeform tags (type-to-add, tap-to-reuse previously-used tags) plus a note to that file. Trash and Favorite get dedicated one-tap toggles that are really just shortcuts for the tags `"trash"`/`"favorite"` — one unified tag list underneath. Explicit Save/Cancel buttons — nothing autosaves. This is a side notebook for the eventual library reorg, not music metadata and not edits to the files themselves; stored in a Cloudflare KV namespace via the Worker (`GET/PUT /annotation`, bulk `GET /annotations` for reviewing everything later on your own machine).

## Wanted / planned

- **Lock screen & Control Center controls** (MediaSession API) — play/pause/skip and track info from the iPhone lock screen, Control Center, AirPods, and car displays, without opening the app. Deferred a few times in favor of other work; no code written yet.

- **Privacy / access gate** — the deployed site is currently public to anyone with the link. A Cloudflare Access login gate (free, gates the Pages URL behind an email/OTP or Google/GitHub login) was scoped but never set up.

- **Protect the annotation write endpoint** — `PUT /annotation` currently has no auth check, so anyone who found the Worker URL could write arbitrary notes/tags into the KV store. Not a new exposure on top of the site already being fully public and readable, but it's now writable too, which is a step further. Worth fixing alongside (or as part of) the privacy/access gate above.

- **Metadata editing** — edit title/artist/album for individual tracks, and bulk-edit multiple files at once. Design direction settled on but not yet built:
  - A fast **overrides store** (Cloudflare KV via the Worker) holds edits keyed by file path. The app prefers an override over the file's actual embedded tag when displaying, so edits are instant, safe, and cheap to bulk-apply — the real audio files are never touched by this layer.
  - A separate, optional **background sync** — a local script using `rclone` (already configured on this machine) plus Python's `mutagen` library (not a hand-rolled binary tag writer) — can later write those overrides into the real files' embedded tags in Dropbox. This is deliberately decoupled from the interactive UI because Dropbox's API has no way to partially modify a file: every real tag write means downloading, modifying, and re-uploading the *entire* file, which is too slow and too risky (a failed upload could corrupt the file) to do synchronously. Dropbox's own version history is the safety net if a sync ever writes something wrong.
  - Considered and rejected: writing tags directly from the browser on every edit (hand-rolled JS tag writers for 3 binary formats, full file re-upload per edit, new Dropbox write scope + re-authorization) — too slow and too risky for something that should feel instant.

- **Sharing** — generate a shareable link for a single track or a whole directory that someone else could open and download, even if the first version is just "generate the link, show a Copy button" with no fancier UI (paste into text/email/whatever). Likely built on Dropbox's own `sharing/create_shared_link_with_settings` API (view-only links, works for both files and folders) — would need a new `sharing.write` Dropbox scope beyond the current read-only setup (meaning a re-authorization, same as the metadata-write scope would need), and a new Worker endpoint. Not yet scoped in detail.

- **Library dedup/cleanup** — 233GB of duplicate files identified across the Dropbox account, dominated by a near-complete mirror in `audio/Music Box II/` (93.5GB, 11,143 files that are exact duplicates of content elsewhere) and redundant copies of a large multitrack recording project ("United We Play," 110.5GB across several version/delivery folders). Paused mid-review — 93 files inside Music Box II were found to have no copy anywhere else and need to be rescued before any deletion. Being worked on separately from app development, not blocking other features.

- **Playlists / favorites** — star tracks or build a manual playlist that persists locally, browsable alongside the real Dropbox folder tree.

- **Offline-friendly caching** — cache `files.json` and recently-viewed artwork (IndexedDB) so the app opens instantly and stays browsable with a flaky connection. Right now every cold load re-downloads the full 5MB+ file index before showing anything.

- **Shuffle / repeat modes** — currently Next/Prev just walks the current folder's file list in listed order; no shuffle or repeat-one/repeat-all.
