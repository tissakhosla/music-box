// Playback engine: owns the <audio> element, the current track/queue, resume
// state, and shuffle-all. Doesn't know anything about the file browser or the
// annotate panel — anything that needs to react to a track change subscribes
// via onPlaybackChange() instead of being imported directly, so there's no
// circular dependency with browse.js/annotate.js.
import { el } from './dom.js';
import { getAllFiles } from './library.js';
import { showNowPlaying } from './view.js';
import { setArtwork } from './artwork.js';
import { setNowPlaying, setPlayingState, updateScrubUI } from './banner.js';
import { resetWaveformUI, loadWaveformForTrack } from './waveform.js';
import { loadTrackMetadata } from './track-metadata.js';
import { getStreamUrl } from './api.js';

const PLAY_ICON = '<svg class="icon" viewBox="0 0 24 24"><path d="M8 5l12 7-12 7z" fill="currentColor"/></svg>';
const PAUSE_ICON = '<svg class="icon" viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>';
const RESUME_SAVE_INTERVAL_MS = 5000;

let currentFiles = [];  // the active playback queue — whatever's currently browsed, or a shuffled copy of everything
let currentFileIndex = -1;
let currentTrackPath = null;
let pendingResume = null;
let shuffleMode = false;
let lastResumeSave = 0;

const changeListeners = [];
// fired whenever something needs the browse list re-rendered or the annotate
// panel closed as a side effect of playback state changing
function notifyPlaybackChanged() {
  changeListeners.forEach(fn => fn());
}
export function onPlaybackChange(fn) {
  changeListeners.push(fn);
}

export function getCurrentTrackPath() {
  return currentTrackPath;
}
export function isCurrentTrack(path) {
  return currentTrackPath === path;
}
export function isShuffling() {
  return shuffleMode;
}
export function getDuration() {
  return el.audio.duration;
}
export function getCurrentTime() {
  return el.audio.currentTime;
}
export function seekTo(time) {
  el.audio.currentTime = Math.max(0, Math.min(el.audio.duration, time));
}

// picking a specific track from the browse/search list silently drops out of
// shuffle-all (distinct from the shuffle button's own toggle-off, which also
// triggers a re-render — here playFile() is always called right after, and
// its own notifyPlaybackChanged() covers that)
export function exitShuffleMode() {
  shuffleMode = false;
  el.shuffleAllBtn.classList.remove('active');
}

// whatever file list is currently visible (a browsed folder or a search result set)
// becomes the prev/next queue — but only while not shuffling, since shuffle pins
// the queue to its own shuffled copy of the whole library regardless of what
// folder you're just looking at
export function setQueue(files) {
  if (shuffleMode) return;
  currentFiles = files;
  syncFileIndex();
}

function syncFileIndex() {
  currentFileIndex = currentFiles.findIndex(f => f.path === currentTrackPath);
}

function saveResume() {
  if (!currentTrackPath) return;
  localStorage.setItem('resume', JSON.stringify({ trackPath: currentTrackPath, time: el.audio.currentTime }));
}

// restores the last-played track (as a "tap play to resume" prompt, not auto-play)
// from localStorage — call once at startup, after the library has loaded
export function initResumeState() {
  try {
    const saved = JSON.parse(localStorage.getItem('resume') || 'null');
    if (saved && saved.trackPath) pendingResume = saved;
  } catch {}

  if (pendingResume) {
    const file = getAllFiles().find(f => f.path === pendingResume.trackPath);
    if (file) {
      currentTrackPath = file.path;
      setNowPlaying(`${file.name} — tap play to resume`, '');
    } else {
      pendingResume = null;
    }
  }
}

export async function playFile(file, resumeTime = 0) {
  showNowPlaying();
  pendingResume = null;
  currentTrackPath = file.path;
  syncFileIndex();
  notifyPlaybackChanged();

  setArtwork(null);
  setNowPlaying(`${file.name} — loading…`, '');
  resetWaveformUI();
  try {
    const url = await getStreamUrl(file.path);
    setPlayingState(file);
    el.audio.src = url;
    if (resumeTime > 0) {
      const onLoaded = () => {
        el.audio.currentTime = resumeTime;
        el.audio.removeEventListener('loadedmetadata', onLoaded);
      };
      el.audio.addEventListener('loadedmetadata', onLoaded);
    }
    // playback URL is already resolved and play() has fired — only now do the artwork
    // and waveform get their own separate temp-link fetches, so they never compete with
    // the actual audio stream for bandwidth/worker time on the way to first sound
    el.audio.play();
    loadTrackMetadata(file, isCurrentTrack);
    loadWaveformForTrack(file.path, isCurrentTrack);
  } catch (e) {
    setNowPlaying(`${file.name} — failed to load (${e.message})`, '');
    el.audio.pause();
    el.audio.removeAttribute('src');
  }
}

export function playAtIndex(i) {
  if (i < 0 || i >= currentFiles.length) return;
  playFile(currentFiles[i]);
}
export function playNext() { playAtIndex(currentFileIndex + 1); }
export function playPrev() { playAtIndex(currentFileIndex - 1); }

export function togglePlayPause() {
  if (el.audio.src) {
    el.audio.paused ? el.audio.play() : el.audio.pause();
    return;
  }
  if (currentTrackPath) {
    const file = getAllFiles().find(f => f.path === currentTrackPath);
    if (file) playFile(file, pendingResume ? pendingResume.time : 0);
  }
}

export function toggleShuffleAll() {
  if (shuffleMode) {
    // turn off without touching playback — just stop pinning Next/Prev to the shuffle queue
    shuffleMode = false;
    el.shuffleAllBtn.classList.remove('active');
    notifyPlaybackChanged(); // lets the browse view recompute its own queue from what's visible
    return;
  }
  const allFiles = getAllFiles();
  if (!allFiles.length) return;
  const shuffled = allFiles.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  shuffleMode = true;
  el.shuffleAllBtn.classList.add('active');
  currentFiles = shuffled;
  playFile(shuffled[0]);
}

export function seekBy(steps) {
  if (!isFinite(el.audio.duration) || !el.audio.src) return;
  const stepSeconds = Math.max(2, el.audio.duration * 0.005);
  seekTo(el.audio.currentTime + steps * stepSeconds);
}

el.audio.addEventListener('play', () => { el.wheelPlayBtn.innerHTML = PAUSE_ICON; });
el.audio.addEventListener('pause', () => { el.wheelPlayBtn.innerHTML = PLAY_ICON; saveResume(); });
el.audio.addEventListener('ended', playNext);
el.audio.addEventListener('timeupdate', () => {
  updateScrubUI();
  const now = Date.now();
  if (now - lastResumeSave > RESUME_SAVE_INTERVAL_MS) {
    lastResumeSave = now;
    saveResume();
  }
});
window.addEventListener('pagehide', saveResume);
el.shuffleAllBtn.addEventListener('click', toggleShuffleAll);
