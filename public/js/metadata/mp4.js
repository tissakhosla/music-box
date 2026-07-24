// M4A tag reader — walks MP4 atoms (moov > udta > meta > ilst > ©nam/©ART/covr).
// moov can be positioned anywhere in the file depending on how it was muxed
// (faststart vs. not), so findMoovContent does an incremental top-level atom
// walk — fetching each atom's header and jumping to the next atom's exact
// computed position — rather than guessing a fixed probe window.
import { fetchRange, fetchContentLength, readU32BE } from './bytes.js';

function atomBytes(str) { return Array.from(str).map(c => c.charCodeAt(0)); }
const ATOM_NAM = [0xa9, 0x6e, 0x61, 0x6d]; // ©nam
const ATOM_ART = [0xa9, 0x41, 0x52, 0x54]; // ©ART
const ATOM_ALB = [0xa9, 0x61, 0x6c, 0x62]; // ©alb
const ATOM_GEN = [0xa9, 0x67, 0x65, 0x6e]; // ©gen
const ATOM_DAY = [0xa9, 0x64, 0x61, 0x79]; // ©day
const ATOM_WRT = [0xa9, 0x77, 0x72, 0x74]; // ©wrt
const ATOM_CMT = [0xa9, 0x63, 0x6d, 0x74]; // ©cmt
const ATOM_AART = atomBytes('aART');
const ATOM_TRKN = atomBytes('trkn');

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

function extractTrackNumber(buf, atomInfo) {
  const inner = buf.slice(atomInfo.start, atomInfo.end);
  const data = findAtom(inner, atomBytes('data'));
  if (!data) return null;
  const dataBuf = inner.slice(data.start, data.end);
  // value (after the 8-byte type+locale prefix) is: 2 reserved, track u16, total u16, 2 reserved
  const track = (dataBuf[10] << 8) | dataBuf[11];
  const total = (dataBuf[12] << 8) | dataBuf[13];
  if (!track) return null;
  return total ? `${track}/${total}` : `${track}`;
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

export async function readMp4Tags(url) {
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
  const alb = findAtom(ilstBuf, ATOM_ALB);
  if (alb) result.album = extractDataAtomText(ilstBuf, alb);
  const aart = findAtom(ilstBuf, ATOM_AART);
  if (aart) result.albumArtist = extractDataAtomText(ilstBuf, aart);
  const gen = findAtom(ilstBuf, ATOM_GEN);
  if (gen) result.genre = extractDataAtomText(ilstBuf, gen);
  const day = findAtom(ilstBuf, ATOM_DAY);
  if (day) result.year = extractDataAtomText(ilstBuf, day).slice(0, 4);
  const wrt = findAtom(ilstBuf, ATOM_WRT);
  if (wrt) result.composer = extractDataAtomText(ilstBuf, wrt);
  const cmt = findAtom(ilstBuf, ATOM_CMT);
  if (cmt) result.comment = extractDataAtomText(ilstBuf, cmt);
  const trkn = findAtom(ilstBuf, ATOM_TRKN);
  if (trkn) result.track = extractTrackNumber(ilstBuf, trkn);
  const covr = findAtom(ilstBuf, atomBytes('covr'));
  if (covr) result.picture = extractCoverData(ilstBuf, covr);

  return result;
}
