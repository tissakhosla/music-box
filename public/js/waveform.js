// Waveform display, which doubles as the now-playing progress bar.
//
// Decoding is done on a throwaway OfflineAudioContext, which never touches the browser's
// live audio session or the playing <audio> element in any way — unlike a regular
// AudioContext wired up with createMediaElementSource (what an earlier EQ feature used),
// which rerouted actual playback through the Web Audio graph and went silent when the
// context failed to resume. This version can only ever affect what these bars look like.
import { el } from './dom.js';
import { getStreamUrl } from './api.js';

const WAVEFORM_BARS = 100;
const waveformCache = new Map(); // track path -> Float32Array of per-bar peak levels (0-1)
let waveformBarEls = [];

function buildWaveformBars() {
  if (waveformBarEls.length) return;
  for (let i = 0; i < WAVEFORM_BARS; i++) {
    const bar = document.createElement('div');
    bar.className = 'wf-bar';
    el.npWaveform.appendChild(bar);
  }
  waveformBarEls = Array.from(el.npWaveform.children);
}
// built immediately (not lazily on first decode) so the waveform always shows as flat
// dots rather than being blank while nothing has loaded yet
buildWaveformBars();

export function updateWaveformProgress(pct) {
  if (!waveformBarEls.length) return;
  const playedCount = Math.round((pct / 100) * WAVEFORM_BARS);
  for (let i = 0; i < waveformBarEls.length; i++) {
    waveformBarEls[i].classList.toggle('played', i < playedCount);
  }
}

// bars rise from flat dots up to their real height with a left-to-right cascade,
// rather than snapping in all at once
function renderWaveform(peaks) {
  for (let i = 0; i < WAVEFORM_BARS; i++) {
    const bar = waveformBarEls[i];
    bar.style.transition = `height 0.3s ease ${Math.min(i * 3, 200)}ms`;
    bar.style.height = `${Math.max(6, peaks[i] * 100)}%`;
  }
  const pct = isFinite(el.audio.duration) ? (el.audio.currentTime / el.audio.duration) * 100 : 0;
  updateWaveformProgress(pct);
}

// resets bars back to flat dots (CSS min-height) for the new track, while its own
// waveform decodes in the background — instant, not animated, so it doesn't fight with
// the next renderWaveform()'s rise-up transition
export function resetWaveformUI() {
  for (const bar of waveformBarEls) {
    bar.style.transition = 'none';
    bar.style.height = '';
    bar.classList.remove('played');
  }
  void el.npWaveform.offsetHeight; // force layout so the 'none' transition actually commits
}

function decodeArrayBufferForWaveform(arrayBuffer) {
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new Ctx(1, 1, 44100); // dummy params — only decodeAudioData() is ever used, never rendered
  return ctx.decodeAudioData(arrayBuffer);
}

function computeWaveformPeaks(audioBuffer) {
  const data = audioBuffer.getChannelData(0);
  const blockSize = Math.max(1, Math.floor(data.length / WAVEFORM_BARS));
  const peaks = new Float32Array(WAVEFORM_BARS);
  for (let i = 0; i < WAVEFORM_BARS; i++) {
    let max = 0;
    const start = i * blockSize;
    const end = Math.min(data.length, start + blockSize);
    for (let j = start; j < end; j++) {
      const v = Math.abs(data[j]);
      if (v > max) max = v;
    }
    peaks[i] = max;
  }
  return peaks;
}

// fetches its own separate temp link and decodes the whole file to build a real
// peak-per-segment waveform — cached per track so replays/revisits are instant.
// `isCurrent(path)` lets the caller veto rendering if a different track started
// playing while this was still loading, without this module needing to know
// anything about player state itself.
export async function loadWaveformForTrack(path, isCurrent) {
  if (waveformCache.has(path)) {
    if (isCurrent(path)) renderWaveform(waveformCache.get(path));
    return;
  }
  try {
    const url = await getStreamUrl(path);
    const res = await fetch(url);
    const arrayBuf = await res.arrayBuffer();
    const decoded = await decodeArrayBufferForWaveform(arrayBuf);
    const peaks = computeWaveformPeaks(decoded);
    waveformCache.set(path, peaks);
    if (isCurrent(path)) renderWaveform(peaks);
  } catch (e) {
    // couldn't build a waveform for this track — the mini-status border-bar just
    // stays put as the progress indicator instead, not fatal
  }
}
