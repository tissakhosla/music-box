// Small shared byte-level helpers used by every tag-format parser below.
export async function fetchRange(url, start, end) {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
  if (!res.ok) throw new Error(`range fetch failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function fetchContentLength(url) {
  const res = await fetch(url, { headers: { Range: 'bytes=0-0' } });
  const range = res.headers.get('content-range');
  const m = range && range.match(/\/(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

export function readU32BE(buf, o) {
  return ((buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3]) >>> 0;
}

export function readU32LE(buf, o) {
  return (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;
}
