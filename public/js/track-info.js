// Full-screen track info panel: every embedded tag plus basic file info
// (name, path, format, size, duration) for the currently playing track.
// Reached by tapping the now-playing bar a second time while already on the
// Now Playing screen — see main.js. Read-only, no annotate-panel-style save
// flow needed, just a Close button.
import { el } from './dom.js';
import { getCurrentTrackPath, getDuration } from './player.js';
import { getLastTags } from './track-metadata.js';
import { fmtTime } from './banner.js';
import { getStreamUrl, getShareLink } from './api.js';
import { fetchContentLength } from './metadata/bytes.js';

const ARTWORK_SWIPE_DISMISS_PX = 70; // downward drag distance on the expanded artwork that counts as "swipe to go back"
const TAP_MOVE_TOLERANCE_PX = 10;    // pointer movement below this still counts as a tap, not a drag
const COPY_FEEDBACK_MS = 1200;

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    return false;
  }
}

function fmtBytes(bytes) {
  if (!bytes) return null;
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

function addRow(label, value) {
  if (!value) return;
  const row = document.createElement('div');
  row.className = 'info-row';
  const l = document.createElement('div');
  l.className = 'info-label';
  l.textContent = label;
  const v = document.createElement('div');
  v.className = 'info-value';
  v.textContent = value;
  row.append(l, v);
  el.infoFields.appendChild(row);
}

// Tapping the filename copies just the name (not the full path) — Dropbox's
// in-app search matches filenames, not full paths, so this is the fallback
// that actually works for "search for this file" (a full-path copy failed
// that use case in testing).
function addCopyableRow(label, value) {
  if (!value) return;
  const row = document.createElement('div');
  row.className = 'info-row';
  const l = document.createElement('div');
  l.className = 'info-label';
  l.textContent = label;
  const v = document.createElement('div');
  v.className = 'info-value info-value-copyable';
  v.textContent = value;
  v.addEventListener('click', async () => {
    const ok = await copyToClipboard(value);
    v.textContent = ok ? 'Copied!' : 'Copy failed';
    setTimeout(() => { v.textContent = value; }, COPY_FEEDBACK_MS);
  });
  row.append(l, v);
  el.infoFields.appendChild(row);
}

let currentPath = null;

export function closeTrackInfoPanel() {
  el.trackInfoPanel.classList.remove('open', 'artwork-expanded');
}

export function openTrackInfoPanel() {
  const path = getCurrentTrackPath();
  if (!path) return;
  currentPath = path;

  el.infoArtwork.src = el.artwork.src;
  el.infoFields.innerHTML = '';

  const tags = getLastTags(path) || {};
  addRow('Title', tags.title);
  addRow('Artist', tags.artist);
  addRow('Album', tags.album);
  addRow('Album Artist', tags.albumArtist);
  addRow('Genre', tags.genre);
  addRow('Year', tags.year);
  addRow('Track', tags.track);
  addRow('Composer', tags.composer);
  addRow('Comments', tags.comment);

  const slash = path.lastIndexOf('/');
  const fileName = slash === -1 ? path : path.slice(slash + 1);
  const folder = slash === -1 ? '' : path.slice(0, slash);
  const ext = fileName.slice(fileName.lastIndexOf('.') + 1).toUpperCase();

  addCopyableRow('File', fileName);
  addRow('Folder', folder);
  addRow('Format', ext);
  addRow('Duration', fmtTime(getDuration()));

  el.trackInfoPanel.classList.add('open');

  const sizeToken = path;
  getStreamUrl(path)
    .then(fetchContentLength)
    .then(bytes => {
      if (getCurrentTrackPath() !== sizeToken || !el.trackInfoPanel.classList.contains('open')) return;
      addRow('Size', fmtBytes(bytes));
    })
    .catch(() => {}); // file size is a nicety — a failed lookup shouldn't block the rest of the panel
}

el.infoCloseBtn.addEventListener('click', closeTrackInfoPanel);

// The button's resting state is icon-only (copy/eye/link) — captured once here
// so the transient text states below (loading/success/failure) have something
// to restore to afterward.
const shareLinkBtnIcons = el.infoShareLinkBtn.innerHTML;

el.infoShareLinkBtn.addEventListener('click', async () => {
  if (!currentPath) return;
  const path = currentPath;
  el.infoShareLinkBtn.textContent = 'Generating…';
  el.infoShareLinkBtn.disabled = true;
  try {
    const url = await getShareLink(path);
    const ok = await copyToClipboard(url);
    el.infoShareLinkBtn.textContent = ok ? 'Copied!' : 'Link ready (copy failed)';
  } catch (e) {
    el.infoShareLinkBtn.textContent = 'Failed';
  } finally {
    el.infoShareLinkBtn.disabled = false;
    setTimeout(() => { el.infoShareLinkBtn.innerHTML = shareLinkBtnIcons; }, COPY_FEEDBACK_MS);
  }
});

// Tap the artwork to toggle a full-bleed, uncropped view; while expanded, a
// downward swipe dismisses it too — same "tap or slide back" affordance as a
// native photo viewer, on top of tapping again (mirrors scrub.js's pointer
// capture pattern used for the Now Playing scrub gesture).
let artPointerId = null;
let artDownX = 0;
let artDownY = 0;
let artMoved = false;

el.infoArtwork.addEventListener('pointerdown', (e) => {
  artPointerId = e.pointerId;
  artDownX = e.clientX;
  artDownY = e.clientY;
  artMoved = false;
  el.infoArtwork.setPointerCapture(e.pointerId);
});

el.infoArtwork.addEventListener('pointermove', (e) => {
  if (e.pointerId !== artPointerId) return;
  const dx = e.clientX - artDownX;
  const dy = e.clientY - artDownY;
  if (Math.hypot(dx, dy) > TAP_MOVE_TOLERANCE_PX) artMoved = true;
  if (el.trackInfoPanel.classList.contains('artwork-expanded') && dy > ARTWORK_SWIPE_DISMISS_PX) {
    el.trackInfoPanel.classList.remove('artwork-expanded');
  }
});

el.infoArtwork.addEventListener('pointerup', (e) => {
  if (e.pointerId !== artPointerId) return;
  artPointerId = null;
  if (!artMoved) el.trackInfoPanel.classList.toggle('artwork-expanded');
});

el.infoArtwork.addEventListener('pointercancel', () => { artPointerId = null; });
