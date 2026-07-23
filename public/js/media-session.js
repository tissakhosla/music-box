// Surfaces the current track (title/artist/album/artwork), transport controls
// (play/pause/prev/next/seek), and playback position to the OS via the
// MediaSession API. This is what makes those controls — and the track info —
// show up on the iPhone lock screen, Control Center, AirPods, and a car's
// CarPlay "Now Playing" screen, without the app needing to be open. There's
// no way to put a browsable list on the CarPlay screen itself from a web
// app — that requires a native app with Apple's CarPlay entitlement — but
// transport control for whatever's already playing works everywhere audio
// does.
const supported = 'mediaSession' in navigator;

// title/artist/album and artwork are set independently (mirroring banner.js's
// setBannerMetadata / artwork.js's setArtwork), but MediaMetadata has to be
// replaced as a whole object each time — so this module keeps its own small
// cache of the last-known values to merge into whichever field changed.
let current = { title: '', artist: '', album: '', artworkUrl: null };

function applyMetadata() {
  if (!supported) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: current.title,
    artist: current.artist,
    album: current.album,
    artwork: current.artworkUrl ? [{ src: current.artworkUrl }] : [],
  });
}

export function setTrackInfo({ title = '', artist = '', album = '' }) {
  current = { ...current, title, artist, album };
  applyMetadata();
}

export function setArtwork(url) {
  current = { ...current, artworkUrl: url || null };
  applyMetadata();
}

export function setPlaybackState(state) {
  if (!supported) return;
  navigator.mediaSession.playbackState = state; // 'playing' | 'paused' | 'none'
}

export function setPositionState({ duration, position, playbackRate }) {
  if (!supported) return;
  // the API throws on non-finite/out-of-range values rather than clamping —
  // easy to hit transiently right as a track loads or ends
  if (!isFinite(duration) || duration <= 0) return;
  if (!isFinite(position) || position < 0 || position > duration) return;
  navigator.mediaSession.setPositionState({ duration, position, playbackRate: playbackRate || 1 });
}

export function registerActionHandlers(handlers) {
  if (!supported) return;
  Object.entries(handlers).forEach(([action, handler]) => {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch (e) {
      // browser doesn't recognize this action (e.g. 'seekto' on older Safari) — skip it
    }
  });
}
