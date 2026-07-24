// Full-screen track info panel: every embedded tag plus basic file info
// (name, path, format, size, duration) for the currently playing track.
// Reached by tapping the now-playing bar a second time while already on the
// Now Playing screen — see main.js. Read-only, no annotate-panel-style save
// flow needed, just a Close button.
import { el } from './dom.js';
import { getCurrentTrackPath, getDuration } from './player.js';
import { getLastTags } from './track-metadata.js';
import { fmtTime } from './banner.js';
import { getStreamUrl } from './api.js';
import { fetchContentLength } from './metadata/bytes.js';

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

export function closeTrackInfoPanel() {
  el.trackInfoPanel.classList.remove('open');
}

export function openTrackInfoPanel() {
  const path = getCurrentTrackPath();
  if (!path) return;

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

  const slash = path.lastIndexOf('/');
  const fileName = slash === -1 ? path : path.slice(slash + 1);
  const folder = slash === -1 ? '' : path.slice(0, slash);
  const ext = fileName.slice(fileName.lastIndexOf('.') + 1).toUpperCase();

  addRow('File', fileName);
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
