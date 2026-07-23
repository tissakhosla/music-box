// All network calls to the Cloudflare Worker live here — every other module
// talks to the backend only through these functions, never via a raw fetch().
const WORKER_URL = 'https://music-box-api.tissa-music.workers.dev'; // update after `wrangler deploy` if your subdomain differs

export async function getStreamUrl(path) {
  const res = await fetch(`${WORKER_URL}/stream?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error(`Worker error: ${res.status}`);
  const data = await res.json();
  return data.url;
}

// NASA's Astronomy Picture of the Day archive has a built-in random-pick feature
// (count=N), so we ask for a few and filter out the occasional video-of-the-day
// entry rather than searching for one ourselves.
export async function getNasaFallbackImage() {
  const res = await fetch(`${WORKER_URL}/nasa-image`);
  if (!res.ok) throw new Error(`NASA image fetch failed: ${res.status}`);
  return res.json(); // { url, title }
}

export async function getAnnotation(path) {
  const res = await fetch(`${WORKER_URL}/annotation?path=${encodeURIComponent(path)}`);
  return res.json(); // { note, tags }
}

export async function getAllAnnotations() {
  const res = await fetch(`${WORKER_URL}/annotations`);
  return res.json(); // { [path]: { note, tags } }
}

export async function putAnnotation(path, note, tags) {
  await fetch(`${WORKER_URL}/annotation`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, note, tags }),
  });
}
