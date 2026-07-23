// Hold-and-slide-to-scrub: dragging on the now-playing screen moves playback
// position relative to wherever it currently is (holding still never jumps
// anywhere — only movement does). How far up/down the finger strays from
// where the drag started controls fineness: slide up for slower, more
// precise scrubbing; slide down for faster, coarser scrubbing.
import { el } from './dom.js';
import { getDuration, getCurrentTime, seekTo } from './player.js';
import { beginScrubUI, endScrubUI, updateScrubUI } from './banner.js';

const SCRUB_BASE_LAPS = 1;      // neutral vertical position: a full-width drag covers this many track-lengths
const SCRUB_FINENESS_RANGE = 4; // sliding all the way up/down multiplies/divides the rate by this much

let scrubbing = false;
let scrubTime = 0;
let scrubLastX = 0;
let scrubStartY = 0;
let scrubViewWidth = 0;
let scrubViewHeight = 0;

el.nowPlayingView.addEventListener('pointerdown', (e) => {
  if (!isFinite(getDuration())) return;
  el.nowPlayingView.setPointerCapture(e.pointerId);
  scrubbing = true;
  scrubTime = getCurrentTime();
  scrubLastX = e.clientX;
  scrubStartY = e.clientY;
  const rect = el.nowPlayingView.getBoundingClientRect();
  scrubViewWidth = rect.width;
  scrubViewHeight = rect.height;
  beginScrubUI();
  updateScrubUI();
  e.preventDefault();
});

el.nowPlayingView.addEventListener('pointermove', (e) => {
  if (!scrubbing) return;
  const dx = e.clientX - scrubLastX;
  scrubLastX = e.clientX;
  if (dx === 0) return;
  const dyNorm = (scrubStartY - e.clientY) / Math.max(1, scrubViewHeight); // positive = slid up
  const fineness = Math.pow(SCRUB_FINENESS_RANGE, dyNorm);
  const secondsPerPixel = (getDuration() * SCRUB_BASE_LAPS / scrubViewWidth) / fineness;
  scrubTime = Math.max(0, Math.min(getDuration(), scrubTime + dx * secondsPerPixel));
  seekTo(scrubTime);
  updateScrubUI();
});

function endScrub() {
  if (!scrubbing) return;
  scrubbing = false;
  endScrubUI();
}
el.nowPlayingView.addEventListener('pointerup', endScrub);
el.nowPlayingView.addEventListener('pointercancel', endScrub);
