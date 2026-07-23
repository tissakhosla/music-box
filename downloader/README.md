# YouTube → Dropbox Importer

A small standalone service: paste a YouTube video or playlist URL, review/edit the
title, artist, album, genre, track #, year, and cover art for each track (individually
or in bulk), then save the finished MP3s (or original MP4s, for non-music links)
straight into a Dropbox folder — by default a separate `YouTube Downloads/` inbox,
kept apart from the curated library `public/files.json` is built from. Run
`node ../build-index.js` again (after regenerating `audio_files.txt`) once you've
moved anything you want the player to see into the real library tree.

Deliberately decoupled from the Cloudflare Pages/Worker frontend in `../public` and
`../worker` — those can't run `yt-dlp`/`ffmpeg`/`mutagen` (no subprocess, no
filesystem), so this piece runs as a real Python container instead.

## Architecture

| Path | Role |
|------|------|
| `app/main.py` | FastAPI app — routes, request/response wiring |
| `app/ytdlp_service.py` | Wraps `yt-dlp`: fast flat-playlist resolution, per-track audio/video download |
| `app/tagging.py` | Writes ID3v2 tags (title/artist/album/genre/track/disc/year) and embeds cover art via `mutagen` |
| `app/title_parse.py` | Best-effort "Artist - Title" splitting from the raw YouTube title (strips junk like `(Official Video)`), plus filename sanitizing |
| `app/dropbox_upload.py` | Shells out to `rclone copyto` to land the finished file in Dropbox |
| `app/auth.py` | Single shared-password gate (stateless HMAC session cookie) — this app costs real compute/Dropbox storage per use, so it isn't left open |
| `static/` | Frontend — same dark monospace theme as the rest of this repo (and `dashboard`/`honesty`) |

## How it works

1. Paste a URL, click **Resolve** — `yt-dlp` lists the video (or every entry in the
   playlist) without downloading anything yet. Each row is pre-filled with a guessed
   title/artist (split from the video title, or the uploader's channel name for
   auto-generated "Artist - Topic" YouTube Music channels) and the YouTube thumbnail
   as a starting cover image.
2. Edit metadata per track, or select several and use the bulk bar to apply
   Artist/Album/Genre/Year or a single piece of artwork to all of them at once.
   Default format is **Audio (MP3)** with tags written; switch a row to
   **Video (MP4)** to keep it as a plain video with no tag editing.
3. Click **Download & Save Selected** — each selected track is downloaded, tagged
   (audio only), and uploaded to the destination folder in order, with live
   per-row status.

## Setup

### 1. rclone config (reused from the existing `rclone`/Dropbox setup)

This service shells out to `rclone`, reusing the same Dropbox remote already
configured on your machine for the file index / planned background tag-sync (see
`../README.md`). Grab your existing config and base64-encode it:

```
base64 -w0 ~/.config/rclone/rclone.conf > rclone.conf.b64
```

If that file has remotes beyond `dropbox` you don't want baked into this service,
copy just the `[dropbox]` block into a fresh file first and encode that instead.

### 2. Deploy to Cloud Run

```
cd downloader
gcloud run deploy music-box-importer \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --memory 1Gi \
  --timeout 600 \
  --set-env-vars APP_PASSWORD='choose-a-password' \
  --set-env-vars RCLONE_CONF_B64="$(cat rclone.conf.b64)"
```

- `--allow-unauthenticated` is required so the browser UI can reach it directly —
  `APP_PASSWORD` is what actually gates access (the page shows a password screen
  until you unlock it; the session cookie is stateless so it works fine no matter
  how many Cloud Run instances end up running).
- `--timeout 600` gives large playlist tracks room to download; individual
  `/api/download` calls are one track at a time.
- Env vars are visible to anyone with console access to the GCP project. For
  stronger isolation, move `RCLONE_CONF_B64` and `APP_PASSWORD` into
  [Secret Manager](https://cloud.google.com/run/docs/configuring/secrets) and swap
  `--set-env-vars` for `--set-secrets` — not done here to keep first deploy simple.

Cloud Run's free tier covers light personal use (it scales to zero between uses, so
idle time costs nothing); a big playlist import is the main thing that consumes
paid compute time.

### Local development

```
cd downloader
pip install -r requirements.txt
export RCLONE_CONF_B64=$(base64 -w0 ~/.config/rclone/rclone.conf)
export APP_PASSWORD=devpassword
python -m app.main
```

Open `http://localhost:8080`. `ffmpeg` and `rclone` must be installed locally for
audio extraction and upload to work outside the container.

## Known limitations

- **One track at a time.** Downloads in a batch run sequentially from the browser,
  not in parallel server-side — simplest thing that works with Cloud Run's
  request/response model, no server-side job queue needed.
- **MP3 only for tagged audio.** Extracted audio is always transcoded to MP3 via
  `ffmpeg` for consistent, broad ID3v2 support; original higher-efficiency codecs
  (Opus/AAC) aren't preserved.
- **No dedup check against the existing library** — this is a separate inbox by
  design (see the top-level `FEATURES.md` "Metadata editing" entry for the related
  but distinct plan for editing tags on files already in the library).
