const WORKER_URL = 'https://music-box-api.tissa-music.workers.dev'; // update after `wrangler deploy` if your subdomain differs

const audio = document.getElementById('audio');
const listingEl = document.getElementById('listing');
const breadcrumbEl = document.getElementById('breadcrumb');
const searchEl = document.getElementById('search');
const screenTitleEl = document.getElementById('screen-title');
const screenContentEl = document.getElementById('screen-content');
const miniStatusEl = document.getElementById('mini-status');
const miniStatusTextEl = document.getElementById('mini-status-text');
const npTitleEl = document.getElementById('np-title');
const npArtistEl = document.getElementById('np-artist');
const seekEl = document.getElementById('seek');
const timeCurrentEl = document.getElementById('time-current');
const timeDurationEl = document.getElementById('time-duration');
const artworkWrapEl = document.getElementById('artwork-wrap');
const artworkEl = document.getElementById('artwork');
const wheelEl = document.getElementById('wheel');
const wheelPlayBtn = document.getElementById('wheel-play');

const PLAY_ICON = '<svg class="icon" viewBox="0 0 24 24"><path d="M8 5l12 7-12 7z" fill="currentColor"/></svg>';
const PAUSE_ICON = '<svg class="icon" viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>';

const SEARCH_LIMIT = 300;
const RESUME_SAVE_INTERVAL_MS = 5000;
const DEGREES_PER_STEP = 20; // wheel drag distance per list move, mimics the physical click wheel's detents

let root = null;
let allFiles = [];
let path = [];
let searchQuery = '';
let currentRows = [];   // folders+files currently rendered, for wheel cursor navigation
let currentFiles = [];  // files only, for prev/next track skipping
let currentFileIndex = -1;
let currentTrackPath = null;
let pendingResume = null;
let lastResumeSave = 0;
let currentArtworkUrl = null;
let cursorIndex = 0;
let lastContextKey = null;

function fmtTime(sec) {
  if (!isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function setNowPlaying(title, artist) {
  miniStatusTextEl.textContent = artist ? `${title} — ${artist}` : title;
  npTitleEl.textContent = title;
  npArtistEl.textContent = artist || '';

  miniStatusTextEl.classList.remove('marquee');
  miniStatusTextEl.style.removeProperty('--marquee-distance');
  requestAnimationFrame(() => {
    const style = getComputedStyle(miniStatusEl);
    const available = miniStatusEl.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const overflow = miniStatusTextEl.scrollWidth - available;
    if (overflow > 0) {
      miniStatusTextEl.style.setProperty('--marquee-distance', `-${overflow}px`);
      miniStatusTextEl.classList.add('marquee');
    }
  });
}

function setArtwork(url) {
  if (currentArtworkUrl) URL.revokeObjectURL(currentArtworkUrl);
  currentArtworkUrl = url;
  if (url) {
    artworkEl.src = url;
    artworkWrapEl.classList.add('has-art');
  } else {
    artworkEl.removeAttribute('src');
    artworkWrapEl.classList.remove('has-art');
  }
}

function fetchMetadata(file, url) {
  if (!window.jsmediatags) return;
  window.jsmediatags.read(url, {
    onSuccess: (tag) => {
      if (currentTrackPath !== file.path) return;
      const t = tag.tags || {};
      // title/artist are intentionally not displayed — artwork only
      if (t.picture) {
        const { data, format } = t.picture;
        setArtwork(URL.createObjectURL(new Blob([new Uint8Array(data)], { type: format })));
      } else {
        setArtwork(null);
      }
    },
    onError: () => { if (currentTrackPath === file.path) setArtwork(null); },
  });
}

function showNowPlaying() { screenContentEl.classList.add('showing-nowplaying'); }
function showBrowse() { screenContentEl.classList.remove('showing-nowplaying'); }

function flatten(node, acc) {
  node.children.forEach(child => {
    if (child.type === 'folder') flatten(child, acc);
    else acc.push(child);
  });
  return acc;
}

function getNodeAtPath(p) {
  let node = root;
  for (const part of p) {
    const next = node.children.find(c => c.type === 'folder' && c.name === part);
    if (!next) return root;
    node = next;
  }
  return node;
}

function makeRow(child, subpath) {
  const row = document.createElement('button');
  row.className = 'row';
  if (child.type === 'file' && child.path === currentTrackPath) row.classList.add('playing');

  const text = document.createElement('div');
  text.className = 'row-text';
  const nameSpan = document.createElement('span');
  nameSpan.className = 'name';
  nameSpan.textContent = child.name;
  text.appendChild(nameSpan);
  if (subpath) {
    const sub = document.createElement('span');
    sub.className = 'subpath';
    sub.textContent = subpath;
    text.appendChild(sub);
  }
  row.appendChild(text);

  if (child.type === 'folder') {
    const chevron = document.createElement('span');
    chevron.className = 'chevron';
    chevron.textContent = '›';
    row.appendChild(chevron);
  }
  return row;
}

function activate(item, index) {
  cursorIndex = index;
  if (item.type === 'folder') { path = [...path, item.name]; render(); }
  else playFile(item);
}

function renderBrowse() {
  screenTitleEl.textContent = path.length ? path[path.length - 1] : 'Music Box';

  breadcrumbEl.innerHTML = '';
  const crumbs = [{ name: 'Music Box', path: [] }, ...path.map((name, i) => ({ name, path: path.slice(0, i + 1) }))];
  crumbs.forEach((c, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'crumb-sep';
      sep.textContent = '/';
      breadcrumbEl.appendChild(sep);
    }
    const btn = document.createElement('button');
    btn.textContent = c.name;
    btn.addEventListener('click', () => { path = c.path; render(); });
    breadcrumbEl.appendChild(btn);
  });

  const node = getNodeAtPath(path);
  listingEl.innerHTML = '';
  currentRows = node.children;
  currentFiles = node.children.filter(c => c.type === 'file');

  if (node.children.length === 0) {
    const empty = document.createElement('div');
    empty.id = 'empty';
    empty.textContent = 'Empty folder';
    listingEl.appendChild(empty);
    return;
  }

  node.children.forEach((child, i) => {
    const row = makeRow(child);
    row.addEventListener('click', () => activate(child, i));
    listingEl.appendChild(row);
  });
}

function renderSearch() {
  screenTitleEl.textContent = 'Search';
  breadcrumbEl.innerHTML = '';
  const q = searchQuery.toLowerCase();
  const matches = allFiles.filter(f => f.name.toLowerCase().includes(q)).slice(0, SEARCH_LIMIT);
  currentRows = matches;
  currentFiles = matches;

  const label = document.createElement('span');
  label.className = 'search-label';
  label.textContent = `${matches.length} result${matches.length === 1 ? '' : 's'}`;
  breadcrumbEl.appendChild(label);

  listingEl.innerHTML = '';
  if (matches.length === 0) {
    const empty = document.createElement('div');
    empty.id = 'empty';
    empty.textContent = 'No matches';
    listingEl.appendChild(empty);
    return;
  }

  matches.forEach((file, i) => {
    const slash = file.path.lastIndexOf('/');
    const dir = slash === -1 ? '' : file.path.slice(0, slash);
    const row = makeRow(file, dir);
    row.addEventListener('click', () => activate(file, i));
    listingEl.appendChild(row);
  });
}

function highlightCursor() {
  Array.from(listingEl.children).forEach((el, i) => el.classList.toggle('cursor', i === cursorIndex));
  const el = listingEl.children[cursorIndex];
  if (el) el.scrollIntoView({ block: 'nearest' });
}

function render() {
  localStorage.setItem('path', JSON.stringify(path));
  const key = searchQuery ? `search:${searchQuery}` : `path:${path.join('/')}`;
  const navigated = key !== lastContextKey;
  if (navigated) {
    cursorIndex = 0;
    lastContextKey = key;
  }
  searchQuery ? renderSearch() : renderBrowse();
  highlightCursor();
  // only snap the breadcrumb to the current (rightmost) segment on actual navigation,
  // not on every re-render (e.g. starting playback) — otherwise a manual scroll-back gets undone
  if (navigated) breadcrumbEl.scrollLeft = breadcrumbEl.scrollWidth;
}

function moveCursor(delta) {
  if (!currentRows.length) return;
  cursorIndex = Math.max(0, Math.min(currentRows.length - 1, cursorIndex + delta));
  highlightCursor();
}

function activateCursor() {
  const item = currentRows[cursorIndex];
  if (item) activate(item, cursorIndex);
}

function seekBy(steps) {
  if (!isFinite(audio.duration) || !audio.src) return;
  const stepSeconds = Math.max(2, audio.duration * 0.005);
  audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + steps * stepSeconds));
}

async function streamUrlFor(file) {
  const res = await fetch(`${WORKER_URL}/stream?path=${encodeURIComponent(file.path)}`);
  if (!res.ok) throw new Error(`Worker error: ${res.status}`);
  const data = await res.json();
  return data.url;
}

function saveResume() {
  if (!currentTrackPath) return;
  localStorage.setItem('resume', JSON.stringify({ trackPath: currentTrackPath, time: audio.currentTime }));
}

async function playFile(file, resumeTime = 0) {
  showNowPlaying();
  pendingResume = null;
  currentTrackPath = file.path;
  currentFileIndex = currentFiles.findIndex(f => f.path === file.path);
  render();

  setArtwork(null);
  setNowPlaying(`${file.name} — loading…`, '');
  try {
    const url = await streamUrlFor(file);
    setNowPlaying('', ''); // clear the "loading…" status once ready — track name isn't displayed
    audio.src = url;
    if (resumeTime > 0) {
      const onLoaded = () => {
        audio.currentTime = resumeTime;
        audio.removeEventListener('loadedmetadata', onLoaded);
      };
      audio.addEventListener('loadedmetadata', onLoaded);
    }
    audio.play();
    fetchMetadata(file, url);
  } catch (e) {
    setNowPlaying(`${file.name} — failed to load (${e.message})`, '');
    audio.pause();
    audio.removeAttribute('src');
  }
}

function playAtIndex(i) {
  if (i < 0 || i >= currentFiles.length) return;
  playFile(currentFiles[i]);
}

function togglePlayPause() {
  if (audio.src) {
    audio.paused ? audio.play() : audio.pause();
    return;
  }
  if (currentTrackPath) {
    const file = allFiles.find(f => f.path === currentTrackPath);
    if (file) playFile(file, pendingResume ? pendingResume.time : 0);
  }
}

function doMenu() {
  if (screenContentEl.classList.contains('showing-nowplaying')) { showBrowse(); return; }
  if (searchQuery) { searchQuery = ''; searchEl.value = ''; render(); return; }
  if (path.length) { path = path.slice(0, -1); render(); }
}

miniStatusEl.addEventListener('click', () => { if (currentTrackPath) showNowPlaying(); });

audio.addEventListener('play', () => { wheelPlayBtn.innerHTML = PAUSE_ICON; });
audio.addEventListener('pause', () => { wheelPlayBtn.innerHTML = PLAY_ICON; saveResume(); });
audio.addEventListener('ended', () => playAtIndex(currentFileIndex + 1));
audio.addEventListener('timeupdate', () => {
  if (!isFinite(audio.duration)) return;
  const pct = (audio.currentTime / audio.duration) * 100;
  seekEl.value = pct;
  seekEl.style.setProperty('--progress', `${pct}%`);
  timeCurrentEl.textContent = fmtTime(audio.currentTime);
  timeDurationEl.textContent = fmtTime(audio.duration);
  const now = Date.now();
  if (now - lastResumeSave > RESUME_SAVE_INTERVAL_MS) {
    lastResumeSave = now;
    saveResume();
  }
});
seekEl.addEventListener('input', () => {
  if (!isFinite(audio.duration)) return;
  audio.currentTime = (seekEl.value / 100) * audio.duration;
  seekEl.style.setProperty('--progress', `${seekEl.value}%`);
});
window.addEventListener('pagehide', saveResume);

searchEl.addEventListener('input', () => {
  searchQuery = searchEl.value.trim();
  render();
});

// ---------- click wheel: drag anywhere on the ring to scroll the list, tap a zone to trigger it ----------

let dragging = false;
let lastAngle = 0;
let accumAngle = 0;
let totalMove = 0;
let downX = 0, downY = 0;

function angleFromCenter(clientX, clientY) {
  const rect = wheelEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  return Math.atan2(clientY - cy, clientX - cx) * (180 / Math.PI);
}

function zoneFromPoint(clientX, clientY) {
  const rect = wheelEl.getBoundingClientRect();
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

wheelEl.addEventListener('pointerdown', (e) => {
  wheelEl.setPointerCapture(e.pointerId);
  dragging = true;
  totalMove = 0;
  downX = e.clientX;
  downY = e.clientY;
  lastAngle = angleFromCenter(e.clientX, e.clientY);
  accumAngle = 0;
  e.preventDefault();
});

wheelEl.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  totalMove += Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY);
  const angle = angleFromCenter(e.clientX, e.clientY);
  let delta = angle - lastAngle;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  accumAngle += delta;
  lastAngle = angle;
  const step = screenContentEl.classList.contains('showing-nowplaying') ? seekBy : moveCursor;
  while (accumAngle >= DEGREES_PER_STEP) { step(1); accumAngle -= DEGREES_PER_STEP; }
  while (accumAngle <= -DEGREES_PER_STEP) { step(-1); accumAngle += DEGREES_PER_STEP; }
});

wheelEl.addEventListener('pointerup', (e) => {
  dragging = false;
  if (totalMove >= 10) return; // was a drag, not a tap
  const zone = zoneFromPoint(e.clientX, e.clientY);
  if (zone === 'select') { if (!screenContentEl.classList.contains('showing-nowplaying')) activateCursor(); }
  else if (zone === 'menu') doMenu();
  else if (zone === 'play') togglePlayPause();
  else if (zone === 'prev') playAtIndex(currentFileIndex - 1);
  else if (zone === 'next') playAtIndex(currentFileIndex + 1);
});
wheelEl.addEventListener('pointercancel', () => { dragging = false; });

fetch('files.json')
  .then(res => res.json())
  .then(tree => {
    root = tree;
    allFiles = flatten(root, []);

    const savedPath = localStorage.getItem('path');
    if (savedPath) { try { path = JSON.parse(savedPath); } catch {} }

    try {
      const saved = JSON.parse(localStorage.getItem('resume') || 'null');
      if (saved && saved.trackPath) pendingResume = saved;
    } catch {}

    if (pendingResume) {
      const file = allFiles.find(f => f.path === pendingResume.trackPath);
      if (file) {
        currentTrackPath = file.path;
        setNowPlaying(`${file.name} — tap play to resume`, '');
      } else {
        pendingResume = null;
      }
    }

    render();
    if (currentTrackPath) currentFileIndex = currentFiles.findIndex(f => f.path === currentTrackPath);
  })
  .catch(() => { listingEl.textContent = 'Failed to load files.json — did you run build-index.js?'; });
