// Entry point: loads the library, restores saved state, and wires the few
// cross-module reactions that don't belong to any single feature (closing the
// annotate/track-info panels and re-rendering the browse list when playback
// changes). Every other module registers its own DOM listeners as a side
// effect of being imported below.
import { el } from './dom.js';
import { loadLibrary } from './library.js';
import * as browse from './browse.js';
import * as player from './player.js';
import { closeAnnotatePanel } from './annotate.js';
import { openTrackInfoPanel, closeTrackInfoPanel } from './track-info.js';
import { showNowPlaying, isShowingNowPlaying } from './view.js';
import './wheel.js';
import './scrub.js';

player.onPlaybackChange(() => {
  closeAnnotatePanel();
  closeTrackInfoPanel();
  browse.render();
});

// From browse, the first tap jumps to Now Playing; a second tap while already
// there (previously a no-op) drills into the full track-info panel instead.
el.miniStatusBtn.addEventListener('click', () => {
  if (!player.getCurrentTrackPath()) return;
  isShowingNowPlaying() ? openTrackInfoPanel() : showNowPlaying();
});

fetch('files.json')
  .then(res => res.json())
  .then(tree => {
    loadLibrary(tree);
    browse.restoreSavedPath();
    player.initResumeState();
    browse.render();
  })
  .catch(() => { el.listing.textContent = 'Failed to load files.json — did you run build-index.js?'; });

// Registering a service worker (even a no-op passthrough) is required for Chrome
// on Android to treat this as an installable PWA — otherwise "Add to Home Screen"
// just makes a bookmark shortcut that opens in a normal browser tab instead of
// respecting manifest.json's fullscreen/standalone display mode.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
