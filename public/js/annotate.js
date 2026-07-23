// Reorg-triage notes/tags panel for the currently-playing track — not music
// metadata, just a side notebook for the eventual library reorg. Full-screen
// and outside #device on purpose (see index.html): it covers the wheel too,
// so while it's open the only way out is the explicit Save/Cancel buttons.
//
// annotatingPath is captured once when the panel opens and used for every
// fetch/save call below instead of the live current-track path — if the
// track finishes and auto-advances while you're mid-note, edits must still
// land on the file you were actually describing, not whatever started
// playing next.
import { el } from './dom.js';
import { getAnnotation, getAllAnnotations, putAnnotation } from './api.js';
import { getCurrentTrackPath } from './player.js';

let annotatingPath = null;
let currentAnnotation = { note: '', tags: [] };
let suggestedTagsCache = [];
let loadToken = 0; // guards against a slow fetch resolving after the track changed

export function closeAnnotatePanel() {
  el.annotatePanel.classList.remove('open');
  annotatingPath = null;
}

export async function openAnnotatePanel() {
  const trackPath = getCurrentTrackPath();
  if (!trackPath) return;
  annotatingPath = trackPath;
  el.annotatePanel.classList.add('open');
  el.annotatePath.textContent = annotatingPath;

  const token = ++loadToken;
  currentAnnotation = { note: '', tags: [] };
  renderAnnotateUI([]); // clear stale UI immediately, suggestions fill in once fetched

  try {
    const data = await getAnnotation(trackPath);
    if (token !== loadToken) return; // a newer open happened, discard
    currentAnnotation = { note: data.note || '', tags: Array.isArray(data.tags) ? data.tags : [] };
  } catch (e) {
    if (token === loadToken) el.annotatePath.textContent = `${trackPath} (failed to load: ${e.message})`;
  }

  suggestedTagsCache = [];
  try {
    const all = await getAllAnnotations();
    const counts = {};
    Object.values(all).forEach(rec => (rec.tags || []).forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
    suggestedTagsCache = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  } catch (e) {
    // suggestions are a nicety — a failure here shouldn't block editing this file's own tags
  }
  if (token !== loadToken) return;
  renderAnnotateUI(suggestedTagsCache);
}

function renderAnnotateUI(suggestedTags) {
  el.annotateNote.value = currentAnnotation.note;
  el.tagTrashBtn.classList.toggle('active', currentAnnotation.tags.includes('trash'));
  el.tagFavoriteBtn.classList.toggle('active', currentAnnotation.tags.includes('favorite'));

  el.annotateCurrentTags.innerHTML = '';
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
    el.annotateCurrentTags.appendChild(chip);
  });

  el.annotateSuggestedTags.innerHTML = '';
  suggestedTags.filter(t => !currentAnnotation.tags.includes(t)).forEach(tag => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'tag-chip suggested';
    const label = document.createElement('span');
    label.textContent = tag;
    chip.appendChild(label);
    chip.addEventListener('click', () => addTag(tag));
    el.annotateSuggestedTags.appendChild(chip);
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
    await putAnnotation(path, currentAnnotation.note, currentAnnotation.tags);
  } catch (e) {
    el.annotatePath.textContent = `${path} (save failed: ${e.message})`;
    throw e; // let the Save button know it didn't actually save
  }
}

el.tagTrashBtn.addEventListener('click', () => {
  currentAnnotation.tags.includes('trash') ? removeTag('trash') : addTag('trash');
});
el.tagFavoriteBtn.addEventListener('click', () => {
  currentAnnotation.tags.includes('favorite') ? removeTag('favorite') : addTag('favorite');
});
el.annotateNote.addEventListener('input', () => {
  currentAnnotation.note = el.annotateNote.value;
});
el.annotateTagInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  addTag(el.annotateTagInput.value);
  el.annotateTagInput.value = '';
});

el.annotateCancelBtn.addEventListener('click', () => closeAnnotatePanel());
el.annotateSaveBtn.addEventListener('click', async () => {
  const originalLabel = el.annotateSaveBtn.textContent;
  el.annotateSaveBtn.textContent = 'Saving…';
  el.annotateSaveBtn.disabled = true;
  try {
    await saveAnnotation();
    closeAnnotatePanel();
  } catch (e) {
    // saveAnnotation() already surfaced the error in #annotate-path — leave the panel open
  } finally {
    el.annotateSaveBtn.textContent = originalLabel;
    el.annotateSaveBtn.disabled = false;
  }
});
