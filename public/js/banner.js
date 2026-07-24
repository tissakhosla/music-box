// The mini-status banner (track/album/artist text, scroll edge-fades) and the
// scrub-progress UI (border bar + time markers) shared by both scrub gestures
// (artwork drag, wheel-rotate).
import { el } from './dom.js';
import { updateWaveformProgress } from './waveform.js';

export function fmtTime(sec) {
  if (!isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function beginScrubUI() {
  el.miniStatus.classList.add('scrubbing');
  el.npTimeMarkers.classList.add('visible');
}

export function endScrubUI() {
  el.miniStatus.classList.remove('scrubbing');
  el.npTimeMarkers.classList.remove('visible');
}

export function updateScrubUI() {
  if (!isFinite(el.audio.duration)) return;
  const pct = (el.audio.currentTime / el.audio.duration) * 100;
  document.documentElement.style.setProperty('--progress', `${pct}%`);
  el.timeCurrent.textContent = fmtTime(el.audio.currentTime);
  el.timeDuration.textContent = fmtTime(el.audio.duration);
  updateWaveformProgress(pct);
}

// each mini-status line's edge fade is computed from its actual scroll position rather
// than a static CSS gradient — left fade only once you've slid past the start, right
// fade only while there's still more to slide to (neither, if it never overflows at all)
const MINI_LINE_FADE_PX = 14;
const miniStatusLineEls = [el.miniStatusText, el.miniStatusAlbum, el.miniStatusArtist];

function updateEdgeFade(lineEl) {
  const showLeft = lineEl.scrollLeft > 1;
  const showRight = lineEl.scrollLeft + lineEl.clientWidth < lineEl.scrollWidth - 1;
  const left = showLeft ? `transparent 0, #000 ${MINI_LINE_FADE_PX}px` : '#000 0';
  const right = showRight ? `#000 calc(100% - ${MINI_LINE_FADE_PX}px), transparent 100%` : '#000 100%';
  const mask = `linear-gradient(to right, ${left}, ${right})`;
  lineEl.style.webkitMaskImage = mask;
  lineEl.style.maskImage = mask;
}

function refreshEdgeFades() {
  requestAnimationFrame(() => miniStatusLineEls.forEach(updateEdgeFade));
}

miniStatusLineEls.forEach(lineEl => lineEl.addEventListener('scroll', () => updateEdgeFade(lineEl)));

// all 3 lines are always reserved (see CSS) so the banner's height never changes as
// content loads in — a field with nothing to show is just a blank line, not collapsed.
// Status messages (loading/error/resume-prompt) and the bare filename before real
// metadata resolves only ever populate the first line; the other two stay blank.
export function setBannerText(text) {
  el.miniStatusText.textContent = text;
  el.miniStatusText.scrollLeft = 0;
  el.miniStatusAlbum.textContent = '';
  el.miniStatusArtist.textContent = '';
  refreshEdgeFades();
}

// once real embedded metadata is available: track / album / artist, each field left
// blank if that tag doesn't exist on this file
export function setBannerMetadata(title, album, artist) {
  el.miniStatusText.textContent = title;
  el.miniStatusText.scrollLeft = 0;
  el.miniStatusAlbum.textContent = album || '';
  el.miniStatusAlbum.scrollLeft = 0;
  el.miniStatusArtist.textContent = artist || '';
  el.miniStatusArtist.scrollLeft = 0;
  refreshEdgeFades();
}

// status messages (loading/error/resume-prompt) — these aren't "the track name", they're
// operational feedback, so they only show on the mini-status banner; the full-screen
// artwork view doesn't need its own copy of the same text
export function setNowPlaying(title, artist) {
  setBannerText(artist ? `${title} — ${artist}` : title);
}

// once a track is actually playing, the banner shows the real track name (updated again
// with title/album/artist once embedded metadata resolves) — the full-screen view stays
// artwork-only, no redundant text copy
export function setPlayingState(file) {
  setBannerText(file.name);
}
