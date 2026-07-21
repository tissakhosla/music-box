const WORKER_URL = 'https://music-box-api.tissa-music.workers.dev'; // update after `wrangler deploy` if your subdomain differs

const audio = document.getElementById('audio');
const listingEl = document.getElementById('listing');
const breadcrumbEl = document.getElementById('breadcrumb');
const searchEl = document.getElementById('search');
const screenTitleEl = document.getElementById('screen-title');
const screenContentEl = document.getElementById('screen-content');
const miniStatusEl = document.getElementById('mini-status');
const npTitleEl = document.getElementById('np-title');
const npArtistEl = document.getElementById('np-artist');
const seekEl = document.getElementById('seek');
const timeCurrentEl = document.getElementById('time-current');
const timeDurationEl = document.getElementById('time-duration');
const artworkWrapEl = document.getElementById('artwork-wrap');
const artworkEl = document.getElementById('artwork');
const themeBtn = document.getElementById('theme-btn');
const wheelMenuBtn = document.getElementById('wheel-menu');
const wheelPrevBtn = document.getElementById('wheel-prev');
const wheelNextBtn = document.getElementById('wheel-next');
const wheelPlayBtn = document.getElementById('wheel-play');
const wheelSelectBtn = document.getElementById('wheel-select');

const SEARCH_LIMIT = 300;
const RESUME_SAVE_INTERVAL_MS = 5000;

let root = null;
let allFiles = [];
let path = [];
let searchQuery = '';
let currentFiles = [];
let currentFileIndex = -1;
let currentTrackPath = null;
let pendingResume = null;
let lastResumeSave = 0;
let currentArtworkUrl = null;

function fmtTime(sec) {
  if (!isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function setNowPlaying(title, artist) {
  miniStatusEl.textContent = artist ? `${title} — ${artist}` : title;
  npTitleEl.textContent = title;
  npArtistEl.textContent = artist || '';
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
      setNowPlaying(t.title || file.name, t.artist || '');
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

function renderBrowse() {
  screenTitleEl.textContent = path.length ? path[path.length - 1] : 'Music Box';

  breadcrumbEl.innerHTML = '';
  const crumbs = [{ name: 'Music Box', path: [] }, ...path.map((name, i) => ({ name, path: path.slice(0, i + 1) }))];
  crumbs.forEach(c => {
    const btn = document.createElement('button');
    btn.textContent = c.name;
    btn.addEventListener('click', () => { path = c.path; render(); });
    breadcrumbEl.appendChild(btn);
  });

  const node = getNodeAtPath(path);
  listingEl.innerHTML = '';
  currentFiles = node.children.filter(c => c.type === 'file');

  if (node.children.length === 0) {
    const empty = document.createElement('div');
    empty.id = 'empty';
    empty.textContent = 'Empty folder';
    listingEl.appendChild(empty);
    return;
  }

  node.children.forEach(child => {
    const row = makeRow(child);
    row.addEventListener('click', () => {
      if (child.type === 'folder') { path = [...path, child.name]; render(); }
      else playFile(child);
    });
    listingEl.appendChild(row);
  });
}

function renderSearch() {
  screenTitleEl.textContent = 'Search';
  breadcrumbEl.innerHTML = '';
  const q = searchQuery.toLowerCase();
  const matches = allFiles.filter(f => f.name.toLowerCase().includes(q));
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

  matches.slice(0, SEARCH_LIMIT).forEach(file => {
    const slash = file.path.lastIndexOf('/');
    const dir = slash === -1 ? '' : file.path.slice(0, slash);
    const row = makeRow(file, dir);
    row.addEventListener('click', () => playFile(file));
    listingEl.appendChild(row);
  });

  if (matches.length > SEARCH_LIMIT) {
    const note = document.createElement('div');
    note.id = 'empty';
    note.textContent = `Showing first ${SEARCH_LIMIT} of ${matches.length} — refine your search`;
    listingEl.appendChild(note);
  }
}

function render() {
  localStorage.setItem('path', JSON.stringify(path));
  searchQuery ? renderSearch() : renderBrowse();
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
  pendingResume = null;
  currentTrackPath = file.path;
  currentFileIndex = currentFiles.findIndex(f => f.path === file.path);
  render();

  setArtwork(null);
  setNowPlaying(`${file.name} — loading…`, '');
  try {
    const url = await streamUrlFor(file);
    setNowPlaying(file.name, '');
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

wheelPlayBtn.addEventListener('click', () => {
  if (audio.src) {
    audio.paused ? audio.play() : audio.pause();
    return;
  }
  if (currentTrackPath) {
    const file = allFiles.find(f => f.path === currentTrackPath);
    if (file) playFile(file, pendingResume ? pendingResume.time : 0);
  }
});
wheelPrevBtn.addEventListener('click', () => playAtIndex(currentFileIndex - 1));
wheelNextBtn.addEventListener('click', () => playAtIndex(currentFileIndex + 1));
wheelSelectBtn.addEventListener('click', () => {
  if (screenContentEl.classList.contains('showing-nowplaying')) { showBrowse(); return; }
  if (currentTrackPath) showNowPlaying();
});
wheelMenuBtn.addEventListener('click', () => {
  if (screenContentEl.classList.contains('showing-nowplaying')) { showBrowse(); return; }
  if (searchQuery) { searchQuery = ''; searchEl.value = ''; render(); return; }
  if (path.length) { path = path.slice(0, -1); render(); }
});
miniStatusEl.addEventListener('click', () => { if (currentTrackPath) showNowPlaying(); });

audio.addEventListener('pause', saveResume);
audio.addEventListener('ended', () => playAtIndex(currentFileIndex + 1));
audio.addEventListener('timeupdate', () => {
  if (!isFinite(audio.duration)) return;
  seekEl.value = (audio.currentTime / audio.duration) * 100;
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
});
window.addEventListener('pagehide', saveResume);

searchEl.addEventListener('input', () => {
  searchQuery = searchEl.value.trim();
  render();
});

themeBtn.addEventListener('click', () => {
  const dark = document.body.classList.toggle('dark');
  localStorage.setItem('theme', dark ? 'dark' : 'light');
});
if (localStorage.getItem('theme') === 'dark') {
  document.body.classList.add('dark');
}

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
