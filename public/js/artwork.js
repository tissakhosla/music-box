// Now-playing artwork: sizing/centering, the NASA fallback for untagged
// tracks, and a temporary on-screen debug surface for iPhone-only failures.
import { el } from './dom.js';
import { getNasaFallbackImage } from './api.js';
import { setBannerText } from './banner.js';
import { setArtwork as setMediaSessionArtwork } from './media-session.js';

export function setArtwork(url) {
  el.artworkWrap.classList.remove('loading');
  if (url) {
    el.artwork.src = url;
    el.artworkWrap.classList.add('has-art');
  } else {
    el.artwork.removeAttribute('src');
    el.artworkWrap.classList.remove('has-art');
  }
  setMediaSessionArtwork(url);
}

// object-fit: contain lets a small image scale up to fill the box, but the <img>
// element's own box still spans the full 100%x100% — border-radius rounds THAT box, so
// with any letterboxing (aspect ratio mismatch) the rounded corners land on empty space
// instead of the visible picture. Sizing the element itself to the actual rendered
// dimensions fixes it: the box then exactly hugs the picture, and flex centering on
// #artwork-wrap keeps it centered in the area either way.
function fitArtworkToWrap() {
  if (!el.artwork.naturalWidth || !el.artwork.naturalHeight) return;
  const wrapW = el.artworkWrap.clientWidth;
  // #np-overlay (waveform + reserved time-markers space) is a fixed-height sibling
  // below #artwork-wrap, not part of it — centering the image within just the wrap's
  // own box therefore sits it above true center of the whole now-playing screen,
  // leaving more space below the image than above. With align-items: center, giving
  // the image a margin-top equal to the overlay's own height shifts its visible center
  // down by exactly half that (the rest of the math is in the margin-box centering
  // itself) — which is exactly what's needed to rebalance against the full screen
  // instead of just the wrap. Reserving that same amount off the sizing budget keeps
  // the now-taller margin box from overflowing the wrap.
  const overlayH = el.npOverlay.getBoundingClientRect().height;
  const wrapH = el.artworkWrap.clientHeight - overlayH;
  if (!wrapW || wrapH <= 0) return;
  const scale = Math.min(wrapW / el.artwork.naturalWidth, wrapH / el.artwork.naturalHeight);
  el.artwork.style.width = `${el.artwork.naturalWidth * scale}px`;
  el.artwork.style.height = `${el.artwork.naturalHeight * scale}px`;
  el.artwork.style.marginTop = `${overlayH}px`;
}
el.artwork.addEventListener('load', fitArtworkToWrap);
window.addEventListener('resize', fitArtworkToWrap);

// TEMPORARY diagnostic: surfaces the actual error text in the banner instead of silently
// clearing artwork, since we can't get real console output from an iPhone without a Mac.
// Remove once confirmed solid across a few real-device tests.
export function showArtworkDebug(msg) {
  el.artworkWrap.classList.remove('loading');
  setBannerText(`[artwork: ${msg}]`);
}

// no embedded artwork on this track — fall back to a random NASA APOD image rather
// than leaving the screen blank
export async function setFallbackArtwork(forPath, isCurrent) {
  try {
    const data = await getNasaFallbackImage();
    if (!isCurrent(forPath)) return;
    if (data.url) setArtwork(data.url); else el.artworkWrap.classList.remove('loading');
  } catch (e) {
    if (isCurrent(forPath)) el.artworkWrap.classList.remove('loading');
  }
}
