// ID3v2.2/2.3/2.4 (MP3) tag reader — written from scratch. Replaces an initial
// attempt using jsmediatags, which relied on the legacy
// xhr.overrideMimeType('text/plain; charset=x-user-defined') technique for
// binary XHR (pre-dating responseType='arraybuffer'). Confirmed via a real
// iPhone that technique fails outright on iOS WebKit ("Generic XHR error") in
// both Safari and Chrome for iOS (same engine), while working fine on desktop
// Chrome — hence every parser in this folder uses only fetch()+ArrayBuffer.
import { fetchRange } from './bytes.js';

export async function readId3v2(url) {
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
      ? ((buf[offset] & 0x7f) << 21) | ((buf[offset + 1] & 0x7f) << 14) | ((buf[offset + 2] & 0x7f) << 7) | (buf[offset + 3] & 0x7f)
      : (buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3];
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
      frameSize = (buf[offset + 3] << 16) | (buf[offset + 4] << 8) | buf[offset + 5];
    } else if (majorVersion >= 4) {
      frameSize = ((buf[offset + 4] & 0x7f) << 21) | ((buf[offset + 5] & 0x7f) << 14) | ((buf[offset + 6] & 0x7f) << 7) | (buf[offset + 7] & 0x7f);
    } else {
      frameSize = (buf[offset + 4] << 24) | (buf[offset + 5] << 16) | (buf[offset + 6] << 8) | buf[offset + 7];
    }

    const frameDataStart = offset + frameHeaderLen;
    const frameDataEnd = frameDataStart + frameSize;
    if (frameSize <= 0 || frameDataEnd > buf.length) break;
    const frameData = buf.slice(frameDataStart, frameDataEnd);

    if (frameId === 'TIT2' || frameId === 'TT2') result.title = decodeId3Text(frameData);
    else if (frameId === 'TPE1' || frameId === 'TP1') result.artist = decodeId3Text(frameData);
    else if (frameId === 'TALB' || frameId === 'TAL') result.album = decodeId3Text(frameData);
    else if (frameId === 'TPE2') result.albumArtist = decodeId3Text(frameData);
    else if (frameId === 'TCON' || frameId === 'TCO') result.genre = decodeId3Text(frameData);
    else if (frameId === 'TYER' || frameId === 'TYE') result.year = decodeId3Text(frameData).slice(0, 4);
    else if (frameId === 'TDRC') result.year = decodeId3Text(frameData).slice(0, 4);
    else if (frameId === 'TRCK' || frameId === 'TRK') result.track = decodeId3Text(frameData);
    else if (frameId === 'TCOM' || frameId === 'TCM') result.composer = decodeId3Text(frameData);
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
    const fmt = String.fromCharCode(frameData[offset], frameData[offset + 1], frameData[offset + 2]);
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
    while (end + 1 < frameData.length && !(frameData[end] === 0 && frameData[end + 1] === 0)) end += 2;
    offset = end + 2;
  } else {
    let end = offset;
    while (end < frameData.length && frameData[end] !== 0) end++;
    offset = end + 1;
  }
  return { format: mime, data: frameData.slice(offset) };
}
