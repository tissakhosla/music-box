// Tracks which of the two full-screen views (file browser vs. now-playing) is
// showing. Everything else that cares — the wheel's tap/drag behavior, the
// mini-status banner tap target, locating the current track — reads or sets
// this through here instead of touching the screen-content class directly.
import { el } from './dom.js';

export function showNowPlaying() {
  el.screenContent.classList.add('showing-nowplaying');
}

export function showBrowse() {
  el.screenContent.classList.remove('showing-nowplaying');
}

export function isShowingNowPlaying() {
  return el.screenContent.classList.contains('showing-nowplaying');
}
