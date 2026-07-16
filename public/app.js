const WORKER_URL = 'https://music-box-api.tissa-music.workers.dev'; // update after `wrangler deploy` if your subdomain differs

const audio = document.getElementById('audio');
const listingEl = document.getElementById('listing');
const breadcrumbEl = document.getElementById('breadcrumb');
const searchEl = document.getElementById('search');
const nowPlayingEl = document.getElementById('now-playing');
const seekEl = document.getElementById('seek');
const timeCurrentEl = document.getElementById('time-current');
const timeDurationEl = document.getElementById('time-duration');
const playBtn = document.getElementById('play-btn');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const themeBtn = document.getElementById('theme-btn');
const expandedEl = document.getElementById('expanded');
const expandedTitleEl = document.getElementById('expanded-title');
const collapseBtn = document.getElementById('collapse-btn');
const transportEl = document.getElementById('transport');
const playerEl = document.getElementById('player');
const vizCanvas = document.getElementById('viz');
const vizCtx = vizCanvas.getContext('2d');

const PLAY_ICON = '<svg class="icon" viewBox="0 0 24 24"><path d="M8 5l12 7-12 7z" fill="currentColor"/></svg>';
const PAUSE_ICON = '<svg class="icon" viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>';
const FOLDER_ICON = '<svg class="icon" viewBox="0 0 24 24"><path d="M3 6h6l2 2h10v10H3z" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
const FILE_ICON = '<svg class="icon" viewBox="0 0 24 24"><circle cx="8" cy="17" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M11 17V5l9-2v12" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

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

let audioCtx = null;
let analyser = null;
let vizBuf = null;
let vizRafId = null;

function fmtTime(sec) {
  if (!isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function setNowPlayingText(text) {
  nowPlayingEl.textContent = text;
  expandedTitleEl.textContent = text;
}

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

  const main = document.createElement('div');
  main.className = 'row-main';
  main.innerHTML = child.type === 'folder' ? FOLDER_ICON : FILE_ICON;
  const nameSpan = document.createElement('span');
  nameSpan.className = 'name';
  nameSpan.textContent = child.name;
  main.appendChild(nameSpan);
  row.appendChild(main);

  if (subpath) {
    const sub = document.createElement('div');
    sub.className = 'subpath';
    sub.textContent = subpath;
    row.appendChild(sub);
  }
  return row;
}

function renderBrowse() {
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

function ensureAudioGraph() {
  if (audioCtx) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return;
  }
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  audioCtx = new AudioCtor();
  const source = audioCtx.createMediaElementSource(audio);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  analyser.connect(audioCtx.destination);
}

async function playFile(file, resumeTime = 0) {
  ensureAudioGraph();
  pendingResume = null;
  currentTrackPath = file.path;
  currentFileIndex = currentFiles.findIndex(f => f.path === file.path);
  render();

  setNowPlayingText(`${file.name} — loading…`);
  try {
    const url = await streamUrlFor(file);
    setNowPlayingText(file.name);
    audio.src = url;
    if (resumeTime > 0) {
      const onLoaded = () => {
        audio.currentTime = resumeTime;
        audio.removeEventListener('loadedmetadata', onLoaded);
      };
      audio.addEventListener('loadedmetadata', onLoaded);
    }
    audio.play();
  } catch (e) {
    setNowPlayingText(`${file.name} — failed to load (${e.message})`);
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
  if (audio.src) {
    audio.paused ? audio.play() : audio.pause();
    return;
  }
  if (currentTrackPath) {
    const file = allFiles.find(f => f.path === currentTrackPath);
    if (file) playFile(file, pendingResume ? pendingResume.time : 0);
  }
});
prevBtn.addEventListener('click', () => playAtIndex(currentFileIndex - 1));
nextBtn.addEventListener('click', () => playAtIndex(currentFileIndex + 1));

audio.addEventListener('play', () => { playBtn.innerHTML = PAUSE_ICON; });
audio.addEventListener('pause', () => { playBtn.innerHTML = PLAY_ICON; saveResume(); });
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

function resizeViz() {
  const dpr = window.devicePixelRatio || 1;
  const rect = vizCanvas.getBoundingClientRect();
  vizCanvas.width = Math.round(rect.width * dpr);
  vizCanvas.height = Math.round(rect.height * dpr);
  vizCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawViz() {
  vizRafId = requestAnimationFrame(drawViz);
  const dpr = window.devicePixelRatio || 1;
  const w = vizCanvas.width / dpr;
  const h = vizCanvas.height / dpr;
  const lineColor = document.body.classList.contains('light') ? 'rgb(0,120,140)' : '#eeeeee';
  vizCtx.clearRect(0, 0, w, h);

  if (!analyser) {
    vizCtx.beginPath();
    vizCtx.strokeStyle = lineColor;
    vizCtx.globalAlpha = 0.3;
    vizCtx.lineWidth = 1.5;
    vizCtx.moveTo(0, h / 2);
    vizCtx.lineTo(w, h / 2);
    vizCtx.stroke();
    vizCtx.globalAlpha = 1;
    return;
  }

  if (!vizBuf) vizBuf = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteTimeDomainData(vizBuf);

  vizCtx.beginPath();
  vizCtx.strokeStyle = lineColor;
  vizCtx.lineWidth = 1.5;
  const sliceW = w / vizBuf.length;
  vizBuf.forEach((sample, i) => {
    const y = (sample / 128) * (h / 2);
    i === 0 ? vizCtx.moveTo(0, y) : vizCtx.lineTo(i * sliceW, y);
  });
  vizCtx.stroke();
}

function setExpanded(open) {
  if (open) {
    expandedEl.appendChild(transportEl);
    expandedEl.classList.add('open');
    resizeViz();
    if (!vizRafId) drawViz();
  } else {
    expandedEl.classList.remove('open');
    playerEl.appendChild(transportEl);
    if (vizRafId) { cancelAnimationFrame(vizRafId); vizRafId = null; }
  }
}
nowPlayingEl.addEventListener('click', () => { if (currentTrackPath) setExpanded(true); });
collapseBtn.addEventListener('click', () => setExpanded(false));
window.addEventListener('resize', () => { if (expandedEl.classList.contains('open')) resizeViz(); });

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
        setNowPlayingText(`${file.name} — tap play to resume`);
      } else {
        pendingResume = null;
      }
    }

    render();
    if (currentTrackPath) currentFileIndex = currentFiles.findIndex(f => f.path === currentTrackPath);
  })
  .catch(() => { listingEl.textContent = 'Failed to load files.json — did you run build-index.js?'; });
