const WORKER_URL = 'https://music-box-api.tissa-music.workers.dev'; // update after `wrangler deploy` if your subdomain differs

const audio = document.getElementById('audio');
const listingEl = document.getElementById('listing');
const breadcrumbEl = document.getElementById('breadcrumb');
const searchEl = document.getElementById('search');
const screenContentEl = document.getElementById('screen-content');
const miniStatusEl = document.getElementById('mini-status');
const miniStatusBtnEl = document.getElementById('mini-status-btn');
const miniStatusTextEl = document.getElementById('mini-status-text');
const npTimeMarkersEl = document.getElementById('np-time-markers');
const timeCurrentEl = document.getElementById('time-current');
const timeDurationEl = document.getElementById('time-duration');
const nowPlayingViewEl = document.getElementById('nowplaying-view');
const artworkWrapEl = document.getElementById('artwork-wrap');
const artworkEl = document.getElementById('artwork');
const wheelEl = document.getElementById('wheel');
const wheelPlayBtn = document.getElementById('wheel-play');
const annotatePanelEl = document.getElementById('annotate-panel');
const annotatePathEl = document.getElementById('annotate-path');
const tagTrashBtn = document.getElementById('tag-trash-btn');
const tagFavoriteBtn = document.getElementById('tag-favorite-btn');
const annotateNoteEl = document.getElementById('annotate-note');
const annotateTagInputEl = document.getElementById('annotate-tag-input');
const annotateCurrentTagsEl = document.getElementById('annotate-current-tags');
const annotateSuggestedTagsEl = document.getElementById('annotate-suggested-tags');
const annotateCancelBtn = document.getElementById('annotate-cancel-btn');
const annotateSaveBtn = document.getElementById('annotate-save-btn');
const shuffleAllBtn = document.getElementById('shuffle-all-btn');
const locateBtn = document.getElementById('locate-btn');
const npWaveformEl = document.getElementById('np-waveform');

const PLAY_ICON = '<svg class="icon" viewBox="0 0 24 24"><path d="M8 5l12 7-12 7z" fill="currentColor"/></svg>';
const PAUSE_ICON = '<svg class="icon" viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>';

const SEARCH_LIMIT = 300;
const RESUME_SAVE_INTERVAL_MS = 5000;
const DEGREES_PER_STEP = 20; // wheel drag distance per list move, mimics the physical click wheel's detents
const WAVEFORM_BARS = 100;

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
let cursorIndex = 0;
let lastContextKey = null;
let lastPath = [];
let shuffleMode = false;
let currentAnnotation = { note: '', tags: [] };
let suggestedTagsCache = [];
let annotationLoadToken = 0; // guards against a slow fetch resolving after the track changed
const waveformCache = new Map(); // track path -> Float32Array of per-bar peak levels (0-1)
let waveformBarEls = [];

function fmtTime(sec) {
  if (!isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// shared by both scrub gestures (artwork drag, wheel-rotate) — the mini-status
// border-scrub-bar grows a play-position cursor and the time markers appear
function beginScrubUI() {
  miniStatusEl.classList.add('scrubbing');
  npTimeMarkersEl.classList.add('visible');
}
function endScrubUI() {
  miniStatusEl.classList.remove('scrubbing');
  npTimeMarkersEl.classList.remove('visible');
}
function updateScrubUI() {
  if (!isFinite(audio.duration)) return;
  const pct = (audio.currentTime / audio.duration) * 100;
  document.documentElement.style.setProperty('--progress', `${pct}%`);
  timeCurrentEl.textContent = fmtTime(audio.currentTime);
  timeDurationEl.textContent = fmtTime(audio.duration);
  updateWaveformProgress(pct);
}

// sets the banner text only (mini-status) — used both for status messages
// (loading/error/resume-prompt) and for real track info once playing. No auto-scroll —
// overflow just sits there for the user to slide over themselves if they want to read it.
function setBannerText(text) {
  miniStatusTextEl.textContent = text;
  miniStatusBtnEl.scrollLeft = 0;
}

// status messages (loading/error/resume-prompt) — these aren't "the track name", they're
// operational feedback, so they only show on the mini-status banner; the full-screen
// artwork view doesn't need its own copy of the same text
function setNowPlaying(title, artist) {
  setBannerText(artist ? `${title} — ${artist}` : title);
}

// once a track is actually playing, the banner shows the real track name (updated again
// with title/artist once embedded metadata resolves) — the full-screen view stays
// artwork-only, no redundant text copy
function setPlayingState(file) {
  setBannerText(file.name);
}

function setArtwork(url) {
  artworkWrapEl.classList.remove('loading');
  if (url) {
    artworkEl.src = url;
    artworkWrapEl.classList.add('has-art');
  } else {
    artworkEl.removeAttribute('src');
    artworkWrapEl.classList.remove('has-art');
  }
}

// Metadata readers below use only fetch()+ArrayBuffer+TextDecoder — replaces jsmediatags,
// which relied on the legacy xhr.overrideMimeType('text/plain; charset=x-user-defined')
// technique for binary XHR (pre-dating responseType='arraybuffer'). Confirmed via a real
// iPhone that technique fails outright on iOS WebKit ("Generic XHR error") in both Safari
// and Chrome for iOS (same engine), while working fine on desktop Chrome.

async function fetchRange(url, start, end) {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
  if (!res.ok) throw new Error(`range fetch failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function fetchContentLength(url) {
  const res = await fetch(url, { headers: { Range: 'bytes=0-0' } });
  const range = res.headers.get('content-range');
  const m = range && range.match(/\/(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

function readU32BE(buf, o) {
  return ((buf[o] << 24) | (buf[o+1] << 16) | (buf[o+2] << 8) | buf[o+3]) >>> 0;
}
function readU32LE(buf, o) {
  return (buf[o] | (buf[o+1] << 8) | (buf[o+2] << 16) | (buf[o+3] << 24)) >>> 0;
}

// dispatches by extension, returns { title?, artist?, picture? } or null
async function readTags(url, filePath) {
  const ext = filePath.slice(filePath.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'mp3') return readId3v2(url);
  if (ext === 'flac') return readFlacTags(url);
  if (ext === 'm4a') return readMp4Tags(url);
  return null;
}

async function readId3v2(url) {
  const headerBuf = await fetchRange(url, 0, 9);
  if (headerBuf.length < 10 || headerBuf[0] !== 0x49 || headerBuf[1] !== 0x44 || headerBuf[2] !== 0x33) {
    return null; // no "ID3" signature
  }
  const majorVersion = headerBuf[3];
  const flags = headerBuf[5];
  const tagSize = ((headerBuf[6] & 0x7f) << 21) | ((headerBuf[7] & 0x7f) << 14) | ((headerBuf[8] & 0x7f) << 7) | (headerBuf[9] & 0x7f);
  const extendedHeaderPresent = !!(flags & 0x40);

  const buf = await fetchRange(url, 0, 10 + tagSize - 1);

  let offset = 10;
  if (extendedHeaderPresent) {
    const extSize = majorVersion >= 4
      ? ((buf[offset] & 0x7f) << 21) | ((buf[offset+1] & 0x7f) << 14) | ((buf[offset+2] & 0x7f) << 7) | (buf[offset+3] & 0x7f)
      : (buf[offset] << 24) | (buf[offset+1] << 16) | (buf[offset+2] << 8) | buf[offset+3];
    offset += (majorVersion >= 4 ? extSize : extSize + 4);
  }

  const result = {};
  const isV22 = majorVersion === 2;
  const frameIdLen = isV22 ? 3 : 4;
  const frameHeaderLen = isV22 ? 6 : 10;

  while (offset + frameHeaderLen <= buf.length) {
    const frameId = String.fromCharCode(...buf.slice(offset, offset + frameIdLen));
    if (!frameId || frameId.charCodeAt(0) === 0) break; // padding reached

    let frameSize;
    if (isV22) {
      frameSize = (buf[offset+3] << 16) | (buf[offset+4] << 8) | buf[offset+5];
    } else if (majorVersion >= 4) {
      frameSize = ((buf[offset+4] & 0x7f) << 21) | ((buf[offset+5] & 0x7f) << 14) | ((buf[offset+6] & 0x7f) << 7) | (buf[offset+7] & 0x7f);
    } else {
      frameSize = (buf[offset+4] << 24) | (buf[offset+5] << 16) | (buf[offset+6] << 8) | buf[offset+7];
    }

    const frameDataStart = offset + frameHeaderLen;
    const frameDataEnd = frameDataStart + frameSize;
    if (frameSize <= 0 || frameDataEnd > buf.length) break;
    const frameData = buf.slice(frameDataStart, frameDataEnd);

    if (frameId === 'TIT2' || frameId === 'TT2') result.title = decodeId3Text(frameData);
    else if (frameId === 'TPE1' || frameId === 'TP1') result.artist = decodeId3Text(frameData);
    else if (frameId === 'APIC' || frameId === 'PIC') result.picture = decodeApicFrame(frameData, isV22);

    offset = frameDataEnd;
  }

  return result;
}

function decodeId3Text(frameData) {
  const encoding = frameData[0];
  const textBytes = frameData.slice(1);
  let text;
  if (encoding === 0) text = new TextDecoder('iso-8859-1').decode(textBytes);
  else if (encoding === 1) text = new TextDecoder('utf-16').decode(textBytes);
  else if (encoding === 2) text = new TextDecoder('utf-16be').decode(textBytes);
  else text = new TextDecoder('utf-8').decode(textBytes);
  return text.replace(/\0+$/, '').trim();
}

function decodeApicFrame(frameData, isV22) {
  let offset = 0;
  const encoding = frameData[offset]; offset += 1;
  let mime;
  if (isV22) {
    const fmt = String.fromCharCode(frameData[offset], frameData[offset+1], frameData[offset+2]);
    offset += 3;
    mime = fmt.toUpperCase() === 'PNG' ? 'image/png' : 'image/jpeg';
  } else {
    let end = offset;
    while (end < frameData.length && frameData[end] !== 0) end++;
    mime = new TextDecoder('iso-8859-1').decode(frameData.slice(offset, end)) || 'image/jpeg';
    offset = end + 1;
  }
  offset += 1; // picture type byte
  if (encoding === 1 || encoding === 2) {
    let end = offset;
    while (end + 1 < frameData.length && !(frameData[end] === 0 && frameData[end+1] === 0)) end += 2;
    offset = end + 2;
  } else {
    let end = offset;
    while (end < frameData.length && frameData[end] !== 0) end++;
    offset = end + 1;
  }
  return { format: mime, data: frameData.slice(offset) };
}

async function readFlacTags(url) {
  const PROBE = 2 * 1024 * 1024;
  let buf = await fetchRange(url, 0, PROBE - 1);
  if (buf.length < 4 || String.fromCharCode(...buf.slice(0, 4)) !== 'fLaC') return null;

  const result = {};
  let offset = 4;
  while (offset + 4 <= buf.length) {
    const blockHeader = buf[offset];
    const isLast = !!(blockHeader & 0x80);
    const blockType = blockHeader & 0x7f;
    const blockLen = (buf[offset+1] << 16) | (buf[offset+2] << 8) | buf[offset+3];
    const blockStart = offset + 4;
    let blockEnd = blockStart + blockLen;

    if (blockEnd > buf.length) {
      const more = await fetchRange(url, buf.length, blockEnd - 1);
      const merged = new Uint8Array(buf.length + more.length);
      merged.set(buf);
      merged.set(more, buf.length);
      buf = merged;
    }

    if (blockType === 4) {
      parseVorbisComment(buf, blockStart, blockEnd, result);
    } else if (blockType === 6 && !result.picture) {
      result.picture = parseFlacPicture(buf, blockStart, blockEnd);
    }

    offset = blockEnd;
    if (isLast) break;
  }
  return result;
}

function parseVorbisComment(buf, start, end, result) {
  let o = start;
  const vendorLen = readU32LE(buf, o); o += 4 + vendorLen;
  const count = readU32LE(buf, o); o += 4;
  for (let i = 0; i < count && o < end; i++) {
    const len = readU32LE(buf, o); o += 4;
    const str = new TextDecoder('utf-8').decode(buf.slice(o, o + len));
    o += len;
    const eq = str.indexOf('=');
    if (eq === -1) continue;
    const key = str.slice(0, eq).toUpperCase();
    const value = str.slice(eq + 1);
    if (key === 'TITLE') result.title = value;
    else if (key === 'ARTIST') result.artist = value;
  }
}

function parseFlacPicture(buf, start) {
  let o = start;
  o += 4; // picture type
  const mimeLen = readU32BE(buf, o); o += 4;
  const mime = new TextDecoder('ascii').decode(buf.slice(o, o + mimeLen)); o += mimeLen;
  const descLen = readU32BE(buf, o); o += 4;
  o += descLen;
  o += 16; // width, height, depth, colors used
  const dataLen = readU32BE(buf, o); o += 4;
  return { format: mime, data: buf.slice(o, o + dataLen) };
}

function atomBytes(str) { return Array.from(str).map(c => c.charCodeAt(0)); }
const ATOM_NAM = [0xa9, 0x6e, 0x61, 0x6d]; // ©nam
const ATOM_ART = [0xa9, 0x41, 0x52, 0x54]; // ©ART

// walks CHILD atoms within an already-fetched buffer (moov/udta/meta/ilst content is always
// small, unlike top-level atoms which can include a multi-hundred-MB mdat)
function findAtom(buf, typeBytes) {
  let offset = 0;
  while (offset + 8 <= buf.length) {
    let size = readU32BE(buf, offset);
    const atomType = buf.slice(offset + 4, offset + 8);
    let headerLen = 8;
    if (size === 1) {
      headerLen = 16;
      const hi = readU32BE(buf, offset + 8);
      const lo = readU32BE(buf, offset + 12);
      size = hi * 4294967296 + lo;
    }
    if (size < headerLen) break;
    const matches = atomType.length === 4 && Array.from(atomType).every((b, i) => b === typeBytes[i]);
    if (matches) return { start: offset + headerLen, end: offset + size };
    offset += size;
  }
  return null;
}

// walks TOP-LEVEL atoms by fetching just each atom's header and jumping to the next atom's
// exact computed position, rather than guessing a fixed probe window — moov can be
// positioned anywhere, including after a huge extended-size mdat atom
async function findMoovContent(url, fileSize) {
  let pos = 0;
  const HEADER_CHUNK = 65536;
  while (pos + 8 <= fileSize) {
    const headerBuf = await fetchRange(url, pos, Math.min(pos + HEADER_CHUNK, fileSize) - 1);
    if (headerBuf.length < 8) break;
    let size = readU32BE(headerBuf, 0);
    const type = String.fromCharCode(headerBuf[4], headerBuf[5], headerBuf[6], headerBuf[7]);
    let headerLen = 8;
    if (size === 1) {
      headerLen = 16;
      const hi = readU32BE(headerBuf, 8);
      const lo = readU32BE(headerBuf, 12);
      size = hi * 4294967296 + lo;
    }
    if (size < headerLen) break;
    if (type === 'moov') return await fetchRange(url, pos + headerLen, pos + size - 1);
    pos += size;
  }
  return null;
}

function extractDataAtomText(buf, atomInfo) {
  const inner = buf.slice(atomInfo.start, atomInfo.end);
  const data = findAtom(inner, atomBytes('data'));
  if (!data) return null;
  const dataBuf = inner.slice(data.start, data.end);
  return new TextDecoder('utf-8').decode(dataBuf.slice(8));
}

function extractCoverData(buf, atomInfo) {
  const inner = buf.slice(atomInfo.start, atomInfo.end);
  const data = findAtom(inner, atomBytes('data'));
  if (!data) return null;
  const dataBuf = inner.slice(data.start, data.end);
  const typeFlag = readU32BE(dataBuf, 0);
  const format = typeFlag === 14 ? 'image/png' : 'image/jpeg';
  return { format, data: dataBuf.slice(8) };
}

async function readMp4Tags(url) {
  const fileSize = await fetchContentLength(url);
  if (!fileSize) return null;

  const moovBuf = await findMoovContent(url, fileSize);
  if (!moovBuf) return null;

  const udta = findAtom(moovBuf, atomBytes('udta'));
  if (!udta) return null;
  const udtaBuf = moovBuf.slice(udta.start, udta.end);
  const meta = findAtom(udtaBuf, atomBytes('meta'));
  if (!meta) return null;
  const metaBuf = udtaBuf.slice(meta.start + 4, meta.end); // meta has a 4-byte version/flags field
  const ilst = findAtom(metaBuf, atomBytes('ilst'));
  if (!ilst) return null;
  const ilstBuf = metaBuf.slice(ilst.start, ilst.end);

  const result = {};
  const nam = findAtom(ilstBuf, ATOM_NAM);
  if (nam) result.title = extractDataAtomText(ilstBuf, nam);
  const art = findAtom(ilstBuf, ATOM_ART);
  if (art) result.artist = extractDataAtomText(ilstBuf, art);
  const covr = findAtom(ilstBuf, atomBytes('covr'));
  if (covr) result.picture = extractCoverData(ilstBuf, covr);

  return result;
}

// TEMPORARY diagnostic: surfaces the actual error text in the banner instead of silently
// clearing artwork, since we can't get real console output from an iPhone without a Mac.
// Remove once confirmed solid across a few real-device tests.
function showArtworkDebug(msg) {
  artworkWrapEl.classList.remove('loading');
  setBannerText(`[artwork: ${msg}]`);
}

// no embedded artwork on this track — fall back to a random NASA APOD image rather
// than leaving the screen blank
async function setFallbackArtwork(forPath) {
  try {
    const res = await fetch(`${WORKER_URL}/nasa-image`);
    if (!res.ok) throw new Error(`NASA image fetch failed: ${res.status}`);
    const data = await res.json();
    if (currentTrackPath !== forPath) return;
    if (data.url) setArtwork(data.url); else artworkWrapEl.classList.remove('loading');
  } catch (e) {
    if (currentTrackPath === forPath) artworkWrapEl.classList.remove('loading');
  }
}

// ---------- waveform, doubling as the progress bar ----------
//
// Decoding is done on a throwaway OfflineAudioContext, which never touches the browser's
// live audio session or the playing <audio> element in any way — unlike a regular
// AudioContext wired up with createMediaElementSource (what the EQ used to do), which
// rerouted actual playback through the Web Audio graph and went silent when the context
// failed to resume. This version can only ever affect what these bars look like.
function decodeArrayBufferForWaveform(arrayBuffer) {
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new Ctx(1, 1, 44100); // dummy params — only decodeAudioData() is ever used, never rendered
  return ctx.decodeAudioData(arrayBuffer);
}

function buildWaveformBars() {
  if (waveformBarEls.length) return;
  for (let i = 0; i < WAVEFORM_BARS; i++) {
    const bar = document.createElement('div');
    bar.className = 'wf-bar';
    npWaveformEl.appendChild(bar);
  }
  waveformBarEls = Array.from(npWaveformEl.children);
}

function updateWaveformProgress(pct) {
  if (!waveformBarEls.length) return;
  const playedCount = Math.round((pct / 100) * WAVEFORM_BARS);
  for (let i = 0; i < waveformBarEls.length; i++) {
    waveformBarEls[i].classList.toggle('played', i < playedCount);
  }
}

function renderWaveform(peaks) {
  buildWaveformBars();
  for (let i = 0; i < WAVEFORM_BARS; i++) {
    waveformBarEls[i].style.height = `${Math.max(6, peaks[i] * 100)}%`;
  }
  updateWaveformProgress(isFinite(audio.duration) ? (audio.currentTime / audio.duration) * 100 : 0);
  miniStatusEl.classList.add('waveform-ready');
}

function resetWaveformUI() {
  miniStatusEl.classList.remove('waveform-ready');
  for (const bar of waveformBarEls) { bar.style.height = ''; bar.classList.remove('played'); }
}

function computeWaveformPeaks(audioBuffer) {
  const data = audioBuffer.getChannelData(0);
  const blockSize = Math.max(1, Math.floor(data.length / WAVEFORM_BARS));
  const peaks = new Float32Array(WAVEFORM_BARS);
  for (let i = 0; i < WAVEFORM_BARS; i++) {
    let max = 0;
    const start = i * blockSize;
    const end = Math.min(data.length, start + blockSize);
    for (let j = start; j < end; j++) {
      const v = Math.abs(data[j]);
      if (v > max) max = v;
    }
    peaks[i] = max;
  }
  return peaks;
}

// fetches its own separate temp link and decodes the whole file to build a real
// peak-per-segment waveform — cached per track so replays/revisits are instant
async function loadWaveformForCurrentTrack(path) {
  if (waveformCache.has(path)) {
    if (currentTrackPath === path) renderWaveform(waveformCache.get(path));
    return;
  }
  try {
    const url = await streamUrlFor({ path });
    const res = await fetch(url);
    const arrayBuf = await res.arrayBuffer();
    const decoded = await decodeArrayBufferForWaveform(arrayBuf);
    const peaks = computeWaveformPeaks(decoded);
    waveformCache.set(path, peaks);
    if (currentTrackPath === path) renderWaveform(peaks);
  } catch (e) {
    // couldn't build a waveform for this track — the mini-status border-bar just
    // stays put as the progress indicator instead, not fatal
  }
}

async function fetchMetadata(file) {
  artworkWrapEl.classList.add('loading');

  // fetch a separate temp link rather than reusing the one <audio> is actively streaming
  // from — avoids two concurrent different-Range requests to the exact same URL
  let metaUrl;
  try {
    metaUrl = await streamUrlFor(file);
  } catch (e) {
    showArtworkDebug(`stream url fetch failed: ${e.message}`);
    setFallbackArtwork(file.path);
    return;
  }
  if (currentTrackPath !== file.path) { artworkWrapEl.classList.remove('loading'); return; }

  let tags;
  try {
    tags = await readTags(metaUrl, file.path);
  } catch (e) {
    if (currentTrackPath === file.path) showArtworkDebug(`tag parse failed: ${e.message}`);
    setFallbackArtwork(file.path);
    return;
  }
  if (currentTrackPath !== file.path) { artworkWrapEl.classList.remove('loading'); return; }

  if (!tags) { setFallbackArtwork(file.path); return; }

  if (tags.title || tags.artist) {
    setBannerText(tags.artist ? `${tags.title || file.name} — ${tags.artist}` : tags.title);
  }
  if (tags.picture) {
    const blob = new Blob([tags.picture.data], { type: tags.picture.format });
    const reader = new FileReader();
    reader.onload = () => { if (currentTrackPath === file.path) setArtwork(reader.result); };
    reader.onerror = () => showArtworkDebug(`FileReader error: ${reader.error && reader.error.message}`);
    reader.readAsDataURL(blob);
  } else {
    setFallbackArtwork(file.path);
  }
}

function showNowPlaying() { screenContentEl.classList.add('showing-nowplaying'); }
function showBrowse() { screenContentEl.classList.remove('showing-nowplaying'); }

// ---------- annotate panel: reorg-triage notes/tags for a track, not music metadata ----------
// Full-screen and outside #device on purpose — it covers the wheel too, so while it's open
// the only way out is the explicit Save/Cancel buttons (nothing to disambiguate from Menu/
// Select, since the wheel is physically unreachable underneath it).
//
// annotatingPath is captured once when the panel opens and used for every fetch/save call
// below instead of the live currentTrackPath — if the track finishes and auto-advances while
// you're mid-note, edits must still land on the file you were actually describing, not
// whatever started playing next.

let annotatingPath = null;

function closeAnnotatePanel() {
  annotatePanelEl.classList.remove('open');
  annotatingPath = null;
}

async function openAnnotatePanel() {
  if (!currentTrackPath) return;
  annotatingPath = currentTrackPath;
  annotatePanelEl.classList.add('open');
  annotatePathEl.textContent = annotatingPath;

  const token = ++annotationLoadToken;
  const path = annotatingPath;
  currentAnnotation = { note: '', tags: [] };
  renderAnnotateUI([]); // clear stale UI immediately, suggestions fill in once fetched

  try {
    const res = await fetch(`${WORKER_URL}/annotation?path=${encodeURIComponent(path)}`);
    const data = await res.json();
    if (token !== annotationLoadToken) return; // a newer open happened, discard
    currentAnnotation = { note: data.note || '', tags: Array.isArray(data.tags) ? data.tags : [] };
  } catch (e) {
    if (token === annotationLoadToken) annotatePathEl.textContent = `${path} (failed to load: ${e.message})`;
  }

  suggestedTagsCache = [];
  try {
    const res = await fetch(`${WORKER_URL}/annotations`);
    const all = await res.json();
    const counts = {};
    Object.values(all).forEach(rec => (rec.tags || []).forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
    suggestedTagsCache = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  } catch (e) {
    // suggestions are a nicety — a failure here shouldn't block editing this file's own tags
  }
  if (token !== annotationLoadToken) return;
  renderAnnotateUI(suggestedTagsCache);
}

function renderAnnotateUI(suggestedTags) {
  annotateNoteEl.value = currentAnnotation.note;
  tagTrashBtn.classList.toggle('active', currentAnnotation.tags.includes('trash'));
  tagFavoriteBtn.classList.toggle('active', currentAnnotation.tags.includes('favorite'));

  annotateCurrentTagsEl.innerHTML = '';
  currentAnnotation.tags.forEach(tag => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'tag-chip';
    const label = document.createElement('span');
    label.textContent = tag;
    const remove = document.createElement('span');
    remove.className = 'remove';
    remove.textContent = '×';
    chip.append(label, remove);
    chip.addEventListener('click', () => removeTag(tag));
    annotateCurrentTagsEl.appendChild(chip);
  });

  annotateSuggestedTagsEl.innerHTML = '';
  suggestedTags.filter(t => !currentAnnotation.tags.includes(t)).forEach(tag => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'tag-chip suggested';
    const label = document.createElement('span');
    label.textContent = tag;
    chip.appendChild(label);
    chip.addEventListener('click', () => addTag(tag));
    annotateSuggestedTagsEl.appendChild(chip);
  });
}

// all of these just stage local edits — nothing reaches the server until Save is tapped
function addTag(rawTag) {
  const tag = rawTag.trim().toLowerCase();
  if (!tag || currentAnnotation.tags.includes(tag)) return;
  currentAnnotation.tags.push(tag);
  if (!suggestedTagsCache.includes(tag)) suggestedTagsCache.push(tag);
  renderAnnotateUI(suggestedTagsCache);
}

function removeTag(tag) {
  currentAnnotation.tags = currentAnnotation.tags.filter(t => t !== tag);
  renderAnnotateUI(suggestedTagsCache);
}

async function saveAnnotation() {
  const path = annotatingPath;
  if (!path) return;
  try {
    await fetch(`${WORKER_URL}/annotation`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, note: currentAnnotation.note, tags: currentAnnotation.tags }),
    });
  } catch (e) {
    annotatePathEl.textContent = `${path} (save failed: ${e.message})`;
    throw e; // let the Save button know it didn't actually save
  }
}

tagTrashBtn.addEventListener('click', () => {
  currentAnnotation.tags.includes('trash') ? removeTag('trash') : addTag('trash');
});
tagFavoriteBtn.addEventListener('click', () => {
  currentAnnotation.tags.includes('favorite') ? removeTag('favorite') : addTag('favorite');
});
annotateNoteEl.addEventListener('input', () => {
  currentAnnotation.note = annotateNoteEl.value;
});
annotateTagInputEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  addTag(annotateTagInputEl.value);
  annotateTagInputEl.value = '';
});

annotateCancelBtn.addEventListener('click', () => closeAnnotatePanel());
annotateSaveBtn.addEventListener('click', async () => {
  const originalLabel = annotateSaveBtn.textContent;
  annotateSaveBtn.textContent = 'Saving…';
  annotateSaveBtn.disabled = true;
  try {
    await saveAnnotation();
    closeAnnotatePanel();
  } catch (e) {
    // saveAnnotation() already surfaced the error in #annotate-path — leave the panel open
  } finally {
    annotateSaveBtn.textContent = originalLabel;
    annotateSaveBtn.disabled = false;
  }
});

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
  else { shuffleMode = false; shuffleAllBtn.classList.remove('active'); playFile(item); }
}

function renderBrowse() {
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
  // while shuffling, Next/Prev stay on the shuffle queue regardless of what folder you're
  // just looking at — only tapping a specific row (activate()) ends shuffle mode
  if (!shuffleMode) currentFiles = node.children.filter(c => c.type === 'file');

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
  breadcrumbEl.innerHTML = '';
  const q = searchQuery.toLowerCase();
  // match against the full path, not just the filename — a search for "Beethoven" should
  // also surface tracks inside a Beethoven/ folder whose own filenames don't mention it
  const matches = allFiles.filter(f => f.path.toLowerCase().includes(q)).slice(0, SEARCH_LIMIT);
  currentRows = matches;
  if (!shuffleMode) currentFiles = matches;

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
  if (navigated) breadcrumbEl.scrollLeft = breadcrumbEl.scrollWidth;

  lastPath = path.slice();
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
  updateScrubUI();
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
  closeAnnotatePanel();
  pendingResume = null;
  currentTrackPath = file.path;
  currentFileIndex = currentFiles.findIndex(f => f.path === file.path);
  render();

  setArtwork(null);
  setNowPlaying(`${file.name} — loading…`, '');
  resetWaveformUI();
  try {
    const url = await streamUrlFor(file);
    setPlayingState(file);
    audio.src = url;
    if (resumeTime > 0) {
      const onLoaded = () => {
        audio.currentTime = resumeTime;
        audio.removeEventListener('loadedmetadata', onLoaded);
      };
      audio.addEventListener('loadedmetadata', onLoaded);
    }
    // playback URL is already resolved and play() has fired — only now do the artwork
    // and waveform get their own separate temp-link fetches, so they never compete with
    // the actual audio stream for bandwidth/worker time on the way to first sound
    audio.play();
    fetchMetadata(file);
    loadWaveformForCurrentTrack(file.path);
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

function toggleShuffleAll() {
  if (shuffleMode) {
    // turn off without touching playback — just stop pinning Next/Prev to the shuffle queue
    shuffleMode = false;
    shuffleAllBtn.classList.remove('active');
    render();
    return;
  }
  if (!allFiles.length) return;
  const shuffled = allFiles.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  shuffleMode = true;
  shuffleAllBtn.classList.add('active');
  currentFiles = shuffled;
  playFile(shuffled[0]);
}

// jumps the browser to wherever the currently-playing file actually lives — most useful
// after shuffling, since the track could be buried anywhere in the whole library
function locateNowPlaying() {
  if (!currentTrackPath) return;
  const slash = currentTrackPath.lastIndexOf('/');
  path = slash === -1 ? [] : currentTrackPath.slice(0, slash).split('/');
  searchQuery = '';
  searchEl.value = '';
  showBrowse();
  render();
  const idx = currentRows.findIndex(r => r.type === 'file' && r.path === currentTrackPath);
  if (idx !== -1) { cursorIndex = idx; highlightCursor(); }
}

shuffleAllBtn.addEventListener('click', toggleShuffleAll);
locateBtn.addEventListener('click', locateNowPlaying);

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
  // the annotate panel covers the wheel entirely while open, so there's no case where
  // Menu is reachable during annotation — Save/Cancel are the only way out of it
  if (screenContentEl.classList.contains('showing-nowplaying')) { showBrowse(); return; }
  if (searchQuery) { searchQuery = ''; searchEl.value = ''; render(); return; }
  if (path.length) { path = path.slice(0, -1); render(); }
}

miniStatusBtnEl.addEventListener('click', () => { if (currentTrackPath) showNowPlaying(); });

audio.addEventListener('play', () => { wheelPlayBtn.innerHTML = PAUSE_ICON; });
audio.addEventListener('pause', () => { wheelPlayBtn.innerHTML = PLAY_ICON; saveResume(); });
audio.addEventListener('ended', () => playAtIndex(currentFileIndex + 1));
audio.addEventListener('timeupdate', () => {
  updateScrubUI();
  const now = Date.now();
  if (now - lastResumeSave > RESUME_SAVE_INTERVAL_MS) {
    lastResumeSave = now;
    saveResume();
  }
});
window.addEventListener('pagehide', saveResume);

// ---------- hold-and-slide-to-scrub: drag on the now playing screen moves playback
// position relative to wherever it currently is (holding still never jumps anywhere —
// only movement does). How far up/down the finger strays from where the drag started
// controls fineness: slide up for slower, more precise scrubbing; slide down for
// faster, coarser scrubbing. ----------

let scrubbing = false;
let scrubTime = 0;
let scrubLastX = 0;
let scrubStartY = 0;
let scrubViewWidth = 0;
let scrubViewHeight = 0;

const SCRUB_BASE_LAPS = 1;      // neutral vertical position: a full-width drag covers this many track-lengths
const SCRUB_FINENESS_RANGE = 4; // sliding all the way up/down multiplies/divides the rate by this much

nowPlayingViewEl.addEventListener('pointerdown', (e) => {
  if (!isFinite(audio.duration)) return;
  nowPlayingViewEl.setPointerCapture(e.pointerId);
  scrubbing = true;
  scrubTime = audio.currentTime;
  scrubLastX = e.clientX;
  scrubStartY = e.clientY;
  const rect = nowPlayingViewEl.getBoundingClientRect();
  scrubViewWidth = rect.width;
  scrubViewHeight = rect.height;
  beginScrubUI();
  updateScrubUI();
  e.preventDefault();
});
nowPlayingViewEl.addEventListener('pointermove', (e) => {
  if (!scrubbing) return;
  const dx = e.clientX - scrubLastX;
  scrubLastX = e.clientX;
  if (dx === 0) return;
  const dyNorm = (scrubStartY - e.clientY) / Math.max(1, scrubViewHeight); // positive = slid up
  const fineness = Math.pow(SCRUB_FINENESS_RANGE, dyNorm);
  const secondsPerPixel = (audio.duration * SCRUB_BASE_LAPS / scrubViewWidth) / fineness;
  scrubTime = Math.max(0, Math.min(audio.duration, scrubTime + dx * secondsPerPixel));
  audio.currentTime = scrubTime;
  updateScrubUI();
});
function endScrub() {
  if (!scrubbing) return;
  scrubbing = false;
  endScrubUI();
}
nowPlayingViewEl.addEventListener('pointerup', endScrub);
nowPlayingViewEl.addEventListener('pointercancel', endScrub);

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
  const nowPlaying = screenContentEl.classList.contains('showing-nowplaying');
  const step = nowPlaying ? seekBy : moveCursor;
  if (nowPlaying) beginScrubUI();
  while (accumAngle >= DEGREES_PER_STEP) { step(1); accumAngle -= DEGREES_PER_STEP; }
  while (accumAngle <= -DEGREES_PER_STEP) { step(-1); accumAngle += DEGREES_PER_STEP; }
});

wheelEl.addEventListener('pointerup', (e) => {
  dragging = false;
  endScrubUI();
  if (totalMove >= 10) return; // was a drag, not a tap
  const zone = zoneFromPoint(e.clientX, e.clientY);
  if (zone === 'select') {
    if (screenContentEl.classList.contains('showing-nowplaying')) { openAnnotatePanel(); }
    else { activateCursor(); }
  }
  else if (zone === 'menu') doMenu();
  else if (zone === 'play') togglePlayPause();
  else if (zone === 'prev') playAtIndex(currentFileIndex - 1);
  else if (zone === 'next') playAtIndex(currentFileIndex + 1);
});
wheelEl.addEventListener('pointercancel', () => { dragging = false; endScrubUI(); });

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
