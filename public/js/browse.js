// The file browser / search view: renders the folder listing or search
// results, tracks the wheel's cursor position within whatever's on screen,
// and hands off to the player when a track (or shuffle) is activated.
import { el } from './dom.js';
import { getNodeAtPath, getAllFiles } from './library.js';
import * as player from './player.js';
import { showBrowse } from './view.js';

const SEARCH_LIMIT = 300;

let path = [];
let searchQuery = '';
let currentRows = [];   // folders+files currently rendered, for wheel cursor navigation
let cursorIndex = 0;
let lastContextKey = null;
let lastPath = [];

function makeRow(child, subpath) {
  const row = document.createElement('button');
  row.className = 'row';
  if (child.type === 'file' && player.isCurrentTrack(child.path)) row.classList.add('playing');

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
  else { player.exitShuffleMode(); player.playFile(item); }
}

function renderBrowse() {
  el.breadcrumb.innerHTML = '';
  const crumbs = [{ name: 'Music Box', path: [] }, ...path.map((name, i) => ({ name, path: path.slice(0, i + 1) }))];
  crumbs.forEach((c, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'crumb-sep';
      sep.textContent = '/';
      el.breadcrumb.appendChild(sep);
    }
    const btn = document.createElement('button');
    btn.textContent = c.name;
    btn.addEventListener('click', () => { path = c.path; render(); });
    el.breadcrumb.appendChild(btn);
  });

  const node = getNodeAtPath(path);
  el.listing.innerHTML = '';
  currentRows = node.children;
  player.setQueue(node.children.filter(c => c.type === 'file'));

  if (node.children.length === 0) {
    const empty = document.createElement('div');
    empty.id = 'empty';
    empty.textContent = 'Empty folder';
    el.listing.appendChild(empty);
    return;
  }

  node.children.forEach((child, i) => {
    const row = makeRow(child);
    row.addEventListener('click', () => activate(child, i));
    el.listing.appendChild(row);
  });
}

function renderSearch() {
  el.breadcrumb.innerHTML = '';
  const q = searchQuery.toLowerCase();
  // match against the full path, not just the filename — a search for "Beethoven" should
  // also surface tracks inside a Beethoven/ folder whose own filenames don't mention it
  const matches = getAllFiles().filter(f => f.path.toLowerCase().includes(q)).slice(0, SEARCH_LIMIT);
  currentRows = matches;
  player.setQueue(matches);

  const label = document.createElement('span');
  label.className = 'search-label';
  label.textContent = `${matches.length} result${matches.length === 1 ? '' : 's'}`;
  el.breadcrumb.appendChild(label);

  el.listing.innerHTML = '';
  if (matches.length === 0) {
    const empty = document.createElement('div');
    empty.id = 'empty';
    empty.textContent = 'No matches';
    el.listing.appendChild(empty);
    return;
  }

  matches.forEach((file, i) => {
    const slash = file.path.lastIndexOf('/');
    const dir = slash === -1 ? '' : file.path.slice(0, slash);
    const row = makeRow(file, dir);
    row.addEventListener('click', () => activate(file, i));
    el.listing.appendChild(row);
  });
}

function highlightCursor() {
  Array.from(el.listing.children).forEach((rowEl, i) => rowEl.classList.toggle('cursor', i === cursorIndex));
  const rowEl = el.listing.children[cursorIndex];
  if (rowEl) rowEl.scrollIntoView({ block: 'nearest' });
}

export function render() {
  localStorage.setItem('path', JSON.stringify(path));
  const key = searchQuery ? `search:${searchQuery}` : `path:${path.join('/')}`;
  const navigated = key !== lastContextKey;

  // going up a level (Menu, or a breadcrumb tap that jumps back several) should land the
  // cursor back on the folder you just came out of, not reset to the top of the list —
  // detected as: still browsing, path got shorter, and the new path is a prefix of the old
  // one (i.e. we're an ancestor of where we just were, not off on some unrelated folder)
  let restoreFolderName = null;
  if (navigated && !searchQuery && path.length < lastPath.length &&
      lastPath.slice(0, path.length).join('/') === path.join('/')) {
    restoreFolderName = lastPath[path.length];
  }

  if (navigated) {
    cursorIndex = 0;
    lastContextKey = key;
  }
  searchQuery ? renderSearch() : renderBrowse();

  if (restoreFolderName) {
    const idx = currentRows.findIndex(r => r.type === 'folder' && r.name === restoreFolderName);
    if (idx !== -1) cursorIndex = idx;
  }

  highlightCursor();
  // only snap the breadcrumb to the current (rightmost) segment on actual navigation,
  // not on every re-render (e.g. starting playback) — otherwise a manual scroll-back gets undone
  if (navigated) el.breadcrumb.scrollLeft = el.breadcrumb.scrollWidth;

  lastPath = path.slice();
}

export function moveCursor(delta) {
  if (!currentRows.length) return;
  cursorIndex = Math.max(0, Math.min(currentRows.length - 1, cursorIndex + delta));
  highlightCursor();
}

export function activateCursor() {
  const item = currentRows[cursorIndex];
  if (item) activate(item, cursorIndex);
}

// restores the last-browsed folder from localStorage — call once at startup, before the first render()
export function restoreSavedPath() {
  const saved = localStorage.getItem('path');
  if (!saved) return;
  try { path = JSON.parse(saved); } catch {}
}

export function doMenu() {
  // the annotate panel covers the wheel entirely while open, so there's no case where
  // Menu is reachable during annotation — Save/Cancel are the only way out of it
  if (searchQuery) { searchQuery = ''; el.search.value = ''; render(); return; }
  if (path.length) { path = path.slice(0, -1); render(); }
}

// jumps the browser to wherever the currently-playing file actually lives — most useful
// after shuffling, since the track could be buried anywhere in the whole library
export function locateNowPlaying() {
  const trackPath = player.getCurrentTrackPath();
  if (!trackPath) return;
  const slash = trackPath.lastIndexOf('/');
  path = slash === -1 ? [] : trackPath.slice(0, slash).split('/');
  searchQuery = '';
  el.search.value = '';
  showBrowse();
  render();
  const idx = currentRows.findIndex(r => r.type === 'file' && r.path === trackPath);
  if (idx !== -1) { cursorIndex = idx; highlightCursor(); }
}

el.locateBtn.addEventListener('click', locateNowPlaying);
el.search.addEventListener('input', () => {
  searchQuery = el.search.value.trim();
  render();
});
