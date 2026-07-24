// FLAC tag reader — VORBIS_COMMENT (title/artist/album) and PICTURE metadata blocks.
import { fetchRange, readU32BE, readU32LE } from './bytes.js';

export async function readFlacTags(url) {
  const PROBE = 2 * 1024 * 1024;
  let buf = await fetchRange(url, 0, PROBE - 1);
  if (buf.length < 4 || String.fromCharCode(...buf.slice(0, 4)) !== 'fLaC') return null;

  const result = {};
  let offset = 4;
  while (offset + 4 <= buf.length) {
    const blockHeader = buf[offset];
    const isLast = !!(blockHeader & 0x80);
    const blockType = blockHeader & 0x7f;
    const blockLen = (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3];
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
      result.picture = parseFlacPicture(buf, blockStart);
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
    else if (key === 'ALBUM') result.album = value;
    else if (key === 'ALBUMARTIST') result.albumArtist = value;
    else if (key === 'GENRE') result.genre = value;
    else if (key === 'DATE') result.year = value.slice(0, 4);
    else if (key === 'TRACKNUMBER') result.track = value;
    else if (key === 'COMPOSER') result.composer = value;
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
