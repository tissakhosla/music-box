// The click wheel: drag anywhere on the ring to scroll the list (or scrub,
// while now-playing is open), tap a zone to trigger Menu/Previous/Next/
// Play-Pause/Select.
import { el } from './dom.js';
import { isShowingNowPlaying, showBrowse } from './view.js';
import { moveCursor, activateCursor, doMenu } from './browse.js';
import { seekBy, togglePlayPause, playPrev, playNext } from './player.js';
import { openAnnotatePanel } from './annotate.js';
import { beginScrubUI, endScrubUI } from './banner.js';

const DEGREES_PER_STEP = 20; // wheel drag distance per list move, mimics the physical click wheel's detents

let dragging = false;
let lastAngle = 0;
let accumAngle = 0;
let totalMove = 0;
let downX = 0, downY = 0;

function angleFromCenter(clientX, clientY) {
  const rect = el.wheel.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  return Math.atan2(clientY - cy, clientX - cx) * (180 / Math.PI);
}

function zoneFromPoint(clientX, clientY) {
  const rect = el.wheel.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = clientX - cx, dy = clientY - cy;
  if (Math.hypot(dx, dy) < rect.width * 0.21) return 'select'; // center button radius (42% diameter)
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  if (angle > -135 && angle <= -45) return 'menu';
  if (angle > 45 && angle <= 135) return 'play';
  if (angle > -45 && angle <= 45) return 'next';
  return 'prev';
}

el.wheel.addEventListener('pointerdown', (e) => {
  el.wheel.setPointerCapture(e.pointerId);
  dragging = true;
  totalMove = 0;
  downX = e.clientX;
  downY = e.clientY;
  lastAngle = angleFromCenter(e.clientX, e.clientY);
  accumAngle = 0;
  e.preventDefault();
});

el.wheel.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  totalMove += Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY);
  const angle = angleFromCenter(e.clientX, e.clientY);
  let delta = angle - lastAngle;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  accumAngle += delta;
  lastAngle = angle;
  const nowPlaying = isShowingNowPlaying();
  const step = nowPlaying ? seekBy : moveCursor;
  if (nowPlaying) beginScrubUI();
  while (accumAngle >= DEGREES_PER_STEP) { step(1); accumAngle -= DEGREES_PER_STEP; }
  while (accumAngle <= -DEGREES_PER_STEP) { step(-1); accumAngle += DEGREES_PER_STEP; }
});

el.wheel.addEventListener('pointerup', (e) => {
  dragging = false;
  endScrubUI();
  if (totalMove >= 10) return; // was a drag, not a tap
  const zone = zoneFromPoint(e.clientX, e.clientY);
  if (zone === 'select') {
    isShowingNowPlaying() ? openAnnotatePanel() : activateCursor();
  } else if (zone === 'menu') {
    // the annotate panel covers the wheel entirely while open, so there's no case where
    // Menu is reachable during annotation — Save/Cancel are the only way out of it
    isShowingNowPlaying() ? showBrowse() : doMenu();
  } else if (zone === 'play') togglePlayPause();
  else if (zone === 'prev') playPrev();
  else if (zone === 'next') playNext();
});
el.wheel.addEventListener('pointercancel', () => { dragging = false; endScrubUI(); });
