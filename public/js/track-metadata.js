// Orchestrates loading a track's embedded metadata (title/artist/album/artwork)
// once playback has already started — kept separate from the tag parsers
// themselves, which know nothing about the DOM or which track is "current".
import { el } from './dom.js';
import { getStreamUrl } from './api.js';
import { readTags } from './metadata/index.js';
import { setBannerMetadata } from './banner.js';
import { setArtwork, setFallbackArtwork, showArtworkDebug } from './artwork.js';

// `isCurrent(path)` lets the caller veto banner/artwork updates if a different
// track started playing while this was still loading.
export async function loadTrackMetadata(file, isCurrent) {
  el.artworkWrap.classList.add('loading');

  // fetch a separate temp link rather than reusing the one <audio> is actively streaming
  // from — avoids two concurrent different-Range requests to the exact same URL
  let metaUrl;
  try {
    metaUrl = await getStreamUrl(file.path);
  } catch (e) {
    showArtworkDebug(`stream url fetch failed: ${e.message}`);
    setFallbackArtwork(file.path, isCurrent);
    return;
  }
  if (!isCurrent(file.path)) { el.artworkWrap.classList.remove('loading'); return; }

  let tags;
  try {
    tags = await readTags(metaUrl, file.path);
  } catch (e) {
    if (isCurrent(file.path)) showArtworkDebug(`tag parse failed: ${e.message}`);
    setFallbackArtwork(file.path, isCurrent);
    return;
  }
  if (!isCurrent(file.path)) { el.artworkWrap.classList.remove('loading'); return; }

  if (!tags) { setFallbackArtwork(file.path, isCurrent); return; }

  if (tags.title || tags.album || tags.artist) {
    setBannerMetadata(tags.title || file.name, tags.album, tags.artist);
  }
  if (tags.picture) {
    const blob = new Blob([tags.picture.data], { type: tags.picture.format });
    const reader = new FileReader();
    reader.onload = () => { if (isCurrent(file.path)) setArtwork(reader.result); };
    reader.onerror = () => showArtworkDebug(`FileReader error: ${reader.error && reader.error.message}`);
    reader.readAsDataURL(blob);
  } else {
    setFallbackArtwork(file.path, isCurrent);
  }
}
