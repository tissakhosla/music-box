const state = { entries: [], playlistTitle: null };

const $ = (id) => document.getElementById(id);

// ---------- theme ----------
function applyTheme(light) {
  document.body.classList.toggle('light', light);
  $('theme-btn').textContent = light ? 'dark' : 'light';
}
$('theme-btn').addEventListener('click', () => {
  const light = !document.body.classList.contains('light');
  localStorage.setItem('ytbox-theme', light ? 'light' : 'dark');
  applyTheme(light);
});
applyTheme(localStorage.getItem('ytbox-theme') === 'light');

// ---------- auth ----------
async function checkSession() {
  try {
    const res = await fetch('/api/whoami');
    if (res.ok) {
      $('login-overlay').classList.add('hidden');
      $('app').classList.remove('hidden');
    }
  } catch (e) { /* stay on login screen */ }
}

$('login-card').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-error').textContent = '';
  const password = $('login-password').value;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) throw new Error('Wrong password');
    $('login-overlay').classList.add('hidden');
    $('app').classList.remove('hidden');
  } catch (e) {
    $('login-error').textContent = e.message;
  }
});

checkSession();

// ---------- resolve ----------
function setStatus(msg, isError) {
  const el = $('status-msg');
  el.textContent = msg;
  el.classList.toggle('error', !!isError);
}

$('resolve-btn').addEventListener('click', resolveUrl);
$('url-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') resolveUrl(); });

async function resolveUrl() {
  const url = $('url-input').value.trim();
  if (!url) return;
  setStatus('Resolving…');
  $('resolve-btn').disabled = true;
  try {
    const res = await fetch('/api/resolve?url=' + encodeURIComponent(url));
    if (!res.ok) throw new Error((await res.json()).detail || 'Failed to resolve URL');
    const data = await res.json();
    state.playlistTitle = data.playlist_title;
    state.entries = data.entries.map((e) => ({
      id: e.id,
      url: e.url,
      thumbnail: e.thumbnail,
      artworkDataUrl: null,
      title: e.suggested_title || '',
      artist: e.suggested_artist || '',
      album: data.playlist_title || '',
      genre: '',
      track: e.suggested_track || null,
      year: e.suggested_year || '',
      format: 'audio',
      include: true,
      status: '',
      statusClass: '',
    }));
    $('dest-folder').value = data.playlist_title
      ? `YouTube Downloads/${data.playlist_title}`
      : 'YouTube Downloads';
    setStatus(
      data.type === 'playlist'
        ? `Playlist "${data.playlist_title}" — ${state.entries.length} track(s)`
        : '1 video resolved'
    );
    $('bulk-panel').classList.toggle('hidden', state.entries.length === 0);
    renderTracks();
  } catch (e) {
    setStatus(e.message, true);
  } finally {
    $('resolve-btn').disabled = false;
  }
}

// ---------- track rendering ----------
function renderTracks() {
  const container = $('tracks');
  container.innerHTML = '';
  state.entries.forEach((entry, idx) => container.appendChild(renderTrack(entry, idx)));
  updateSummary();
}

function renderTrack(entry, idx) {
  const card = document.createElement('div');
  card.className = 'track' + (entry.include ? '' : ' excluded');

  const artworkWrap = document.createElement('div');
  artworkWrap.className = 'artwork-wrap';
  const img = document.createElement('img');
  img.className = 'artwork';
  img.src = entry.artworkDataUrl || entry.thumbnail || '';
  img.alt = '';
  const hint = document.createElement('div');
  hint.className = 'artwork-hint';
  hint.textContent = 'change artwork';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.className = 'hidden';
  artworkWrap.append(img, hint, fileInput);
  artworkWrap.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      entry.artworkDataUrl = reader.result;
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  const fields = document.createElement('div');
  fields.className = 'fields';

  const grid = document.createElement('div');
  grid.className = 'fields-grid';
  grid.append(
    makeField('Title', entry.title, 'title-field', (v) => (entry.title = v)),
    makeField('Artist', entry.artist, 'artist-field', (v) => (entry.artist = v)),
    makeField('Album', entry.album, '', (v) => (entry.album = v)),
    makeField('Genre', entry.genre, '', (v) => (entry.genre = v)),
    makeField('Track #', entry.track ?? '', '', (v) => (entry.track = v ? Number(v) : null)),
    makeField('Year', entry.year, '', (v) => (entry.year = v)),
  );

  const metaRow = document.createElement('div');
  metaRow.className = 'meta-row';

  const includeLabel = document.createElement('label');
  includeLabel.className = 'include-toggle';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = entry.include;
  checkbox.addEventListener('change', () => {
    entry.include = checkbox.checked;
    card.classList.toggle('excluded', !entry.include);
    updateSummary();
  });
  includeLabel.append(checkbox, document.createTextNode(' include'));

  const pillGroup = document.createElement('div');
  pillGroup.className = 'pillgroup';
  ['audio', 'video'].forEach((fmt) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = fmt === 'audio' ? 'Audio (MP3)' : 'Video (MP4)';
    btn.className = entry.format === fmt ? 'active' : '';
    btn.addEventListener('click', () => {
      entry.format = fmt;
      pillGroup.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
    pillGroup.appendChild(btn);
  });

  const status = document.createElement('span');
  status.className = 'status';
  status.textContent = entry.status;
  entry._statusEl = status;

  metaRow.append(includeLabel, pillGroup, status);
  fields.append(grid, metaRow);
  card.append(artworkWrap, fields);
  return card;
}

function makeField(labelText, value, extraClass, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'field' + (extraClass ? ' ' + extraClass : '');
  const label = document.createElement('label');
  label.textContent = labelText;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.addEventListener('input', () => onChange(input.value));
  wrap.append(label, input);
  return wrap;
}

// ---------- bulk actions ----------
$('select-all-btn').addEventListener('click', () => setAllIncluded(true));
$('select-none-btn').addEventListener('click', () => setAllIncluded(false));
function setAllIncluded(val) {
  state.entries.forEach((e) => (e.include = val));
  renderTracks();
}

$('bulk-apply-btn').addEventListener('click', () => {
  const artist = $('bulk-artist').value.trim();
  const album = $('bulk-album').value.trim();
  const genre = $('bulk-genre').value.trim();
  const year = $('bulk-year').value.trim();
  state.entries.forEach((e) => {
    if (!e.include) return;
    if (artist) e.artist = artist;
    if (album) e.album = album;
    if (genre) e.genre = genre;
    if (year) e.year = year;
  });
  renderTracks();
});

$('bulk-artwork-btn').addEventListener('click', () => $('bulk-artwork-input').click());
$('bulk-artwork-input').addEventListener('change', () => {
  const file = $('bulk-artwork-input').files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    state.entries.forEach((e) => {
      if (e.include) e.artworkDataUrl = reader.result;
    });
    $('bulk-artwork-preview').src = reader.result;
    $('bulk-artwork-preview').classList.remove('hidden');
    renderTracks();
  };
  reader.readAsDataURL(file);
});

// ---------- download ----------
function updateSummary() {
  const total = state.entries.filter((e) => e.include).length;
  const done = state.entries.filter((e) => e.include && e.statusClass === 'ok').length;
  const errored = state.entries.filter((e) => e.include && e.statusClass === 'error').length;
  $('summary').textContent = total
    ? `${done}/${total} saved${errored ? `, ${errored} failed` : ''}`
    : 'No tracks selected';
}

$('download-btn').addEventListener('click', async () => {
  const destFolder = $('dest-folder').value.trim() || 'YouTube Downloads';
  const selected = state.entries.filter((e) => e.include);
  if (!selected.length) return;

  $('download-btn').disabled = true;
  for (const entry of selected) {
    setEntryStatus(entry, 'downloading…', 'working');
    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: entry.url,
          format: entry.format,
          title: entry.title,
          artist: entry.artist,
          album: entry.album,
          genre: entry.genre,
          track: entry.track,
          year: entry.year,
          artwork_b64: entry.artworkDataUrl || undefined,
          artwork_url: entry.artworkDataUrl ? undefined : entry.thumbnail,
          dest_folder: destFolder,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed');
      setEntryStatus(entry, 'saved ✓', 'ok');
    } catch (e) {
      setEntryStatus(entry, 'error: ' + e.message, 'error');
    }
    updateSummary();
  }
  $('download-btn').disabled = false;
});

function setEntryStatus(entry, text, cls) {
  entry.status = text;
  entry.statusClass = cls;
  if (entry._statusEl) {
    entry._statusEl.textContent = text;
    entry._statusEl.className = 'status ' + cls;
  }
}
