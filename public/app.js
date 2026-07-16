const WORKER_URL = 'https://music-box-api.tissa-music.workers.dev'; // update after `wrangler deploy` if your subdomain differs

const audio = document.getElementById('audio');
const listingEl = document.getElementById('listing');
const breadcrumbEl = document.getElementById('breadcrumb');
const nowPlayingEl = document.getElementById('now-playing');
const seekEl = document.getElementById('seek');
const timeCurrentEl = document.getElementById('time-current');
const timeDurationEl = document.getElementById('time-duration');
const playBtn = document.getElementById('play-btn');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const themeBtn = document.getElementById('theme-btn');

const PLAY_ICON = '<svg class="icon" viewBox="0 0 24 24"><path d="M8 5l12 7-12 7z" fill="currentColor"/></svg>';
const PAUSE_ICON = '<svg class="icon" viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>';
const FOLDER_ICON = '<svg class="icon" viewBox="0 0 24 24"><path d="M3 6h6l2 2h10v10H3z" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
const FILE_ICON = '<svg class="icon" viewBox="0 0 24 24"><circle cx="8" cy="17" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M11 17V5l9-2v12" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

let root = null;
let path = [];
let currentFiles = [];
let currentFileIndex = -1;
let currentTrackPath = null;

function fmtTime(sec) {
  if (!isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
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

function renderBreadcrumb() {
  breadcrumbEl.innerHTML = '';
  const crumbs = [{ name: 'Music Box', path: [] }, ...path.map((name, i) => ({ name, path: path.slice(0, i + 1) }))];
  crumbs.forEach(c => {
    const btn = document.createElement('button');
    btn.textContent = c.name;
    btn.addEventListener('click', () => { path = c.path; render(); });
    breadcrumbEl.appendChild(btn);
  });
}

function render() {
  localStorage.setItem('path', JSON.stringify(path));
  const node = getNodeAtPath(path);
  renderBreadcrumb();
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
    const row = document.createElement('button');
    row.className = 'row';
    if (child.type === 'file' && child.path === currentTrackPath) row.classList.add('playing');
    row.innerHTML = (child.type === 'folder' ? FOLDER_ICON : FILE_ICON) + `<span class="name"></span>`;
    row.querySelector('.name').textContent = child.name;

    row.addEventListener('click', () => {
      if (child.type === 'folder') { path = [...path, child.name]; render(); }
      else playFile(child);
    });
    listingEl.appendChild(row);
  });
}

async function streamUrlFor(file) {
  const res = await fetch(`${WORKER_URL}/stream?path=${encodeURIComponent(file.path)}`);
  if (!res.ok) throw new Error(`Worker error: ${res.status}`);
  const data = await res.json();
  return data.url;
}

async function playFile(file) {
  currentTrackPath = file.path;
  currentFileIndex = currentFiles.findIndex(f => f.path === file.path);
  render();

  nowPlayingEl.textContent = `${file.name} — loading…`;
  try {
    const url = await streamUrlFor(file);
    nowPlayingEl.textContent = file.name;
    audio.src = url;
    audio.play();
  } catch (e) {
    nowPlayingEl.textContent = `${file.name} — failed to load (${e.message})`;
    audio.pause();
    audio.removeAttribute('src');
    playBtn.innerHTML = PLAY_ICON;
  }
}

function playAtIndex(i) {
  if (i < 0 || i >= currentFiles.length) return;
  playFile(currentFiles[i]);
}

playBtn.addEventListener('click', () => {
  if (!audio.src) return;
  audio.paused ? audio.play() : audio.pause();
});
prevBtn.addEventListener('click', () => playAtIndex(currentFileIndex - 1));
nextBtn.addEventListener('click', () => playAtIndex(currentFileIndex + 1));

audio.addEventListener('play', () => { playBtn.innerHTML = PAUSE_ICON; });
audio.addEventListener('pause', () => { playBtn.innerHTML = PLAY_ICON; });
audio.addEventListener('ended', () => playAtIndex(currentFileIndex + 1));
audio.addEventListener('timeupdate', () => {
  if (!isFinite(audio.duration)) return;
  seekEl.value = (audio.currentTime / audio.duration) * 100;
  timeCurrentEl.textContent = fmtTime(audio.currentTime);
  timeDurationEl.textContent = fmtTime(audio.duration);
});
seekEl.addEventListener('input', () => {
  if (!isFinite(audio.duration)) return;
  audio.currentTime = (seekEl.value / 100) * audio.duration;
});

themeBtn.addEventListener('click', () => {
  const light = document.body.classList.toggle('light');
  themeBtn.textContent = light ? 'dark' : 'light';
  localStorage.setItem('theme', light ? 'light' : 'dark');
});
if (localStorage.getItem('theme') === 'light') {
  document.body.classList.add('light');
  themeBtn.textContent = 'dark';
}

fetch('files.json')
  .then(res => res.json())
  .then(tree => {
    root = tree;
    const saved = localStorage.getItem('path');
    if (saved) { try { path = JSON.parse(saved); } catch {} }
    render();
  })
  .catch(() => { listingEl.textContent = 'Failed to load files.json — did you run build-index.js?'; });
