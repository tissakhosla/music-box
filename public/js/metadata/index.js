// Dispatches to the right embedded-tag parser by file extension. Other formats
// (WAV, AIFF, WMA, MIDI, etc.) fall back to filename-only, same as untagged files.
import { readId3v2 } from './id3.js';
import { readFlacTags } from './flac.js';
import { readMp4Tags } from './mp4.js';

// returns { title?, artist?, album?, picture? } or null
export async function readTags(url, filePath) {
  const ext = filePath.slice(filePath.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'mp3') return readId3v2(url);
  if (ext === 'flac') return readFlacTags(url);
  if (ext === 'm4a') return readMp4Tags(url);
  return null;
}
