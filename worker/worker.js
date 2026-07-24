const DROPBOX_TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const DROPBOX_TEMP_LINK_URL = 'https://api.dropboxapi.com/2/files/get_temporary_link';
const DROPBOX_CREATE_SHARED_LINK_URL = 'https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings';
const DROPBOX_LIST_SHARED_LINKS_URL = 'https://api.dropboxapi.com/2/sharing/list_shared_links';
const NASA_APOD_URL = 'https://api.nasa.gov/planetary/apod';
const ALLOWED_ORIGIN = 'https://music-box-43b.pages.dev';

let cachedAccessToken = null;
let cachedAccessTokenExpiry = 0;

async function getAccessToken(env) {
  const now = Date.now();
  if (cachedAccessToken && now < cachedAccessTokenExpiry) return cachedAccessToken;

  const res = await fetch(DROPBOX_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: env.DROPBOX_REFRESH_TOKEN,
      client_id: env.DROPBOX_APP_KEY,
      client_secret: env.DROPBOX_APP_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`Dropbox token refresh failed: ${res.status}`);
  const data = await res.json();
  cachedAccessToken = data.access_token;
  cachedAccessTokenExpiry = now + (data.expires_in - 60) * 1000;
  return cachedAccessToken;
}

async function getStreamUrl(env, path) {
  const accessToken = await getAccessToken(env);
  const res = await fetch(DROPBOX_TEMP_LINK_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path: `/${path}` }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Dropbox get_temporary_link failed: ${res.status} ${body}`);
  }
  const data = await res.json();
  return data.link;
}

// View-only shared link for a file, for the track info page's "Copy View Only
// Link" button — requires the sharing.write scope (and sharing.read for the
// list_shared_links fallback below), which is not part of this app's original
// files.metadata.read/files.content.read authorization; see README's Setup
// section for the re-authorization steps that add it.
async function getShareLink(env, path) {
  const accessToken = await getAccessToken(env);
  const dropboxPath = `/${path}`;

  const createRes = await fetch(DROPBOX_CREATE_SHARED_LINK_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: dropboxPath,
      settings: { requested_visibility: 'public', audience: 'public', access: 'viewer' },
    }),
  });
  if (createRes.ok) {
    const data = await createRes.json();
    return data.url;
  }

  // A link already exists for this file (a prior share, or a re-tap of this same
  // button) — look it up instead of treating the 409 as a failure.
  const errBody = await createRes.json().catch(() => null);
  if (createRes.status === 409 && errBody?.error?.['.tag'] === 'shared_link_already_exists') {
    const listRes = await fetch(DROPBOX_LIST_SHARED_LINKS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: dropboxPath, direct_only: true }),
    });
    if (listRes.ok) {
      const listData = await listRes.json();
      if (listData.links && listData.links[0]) return listData.links[0].url;
    }
  }
  throw new Error(`Dropbox create_shared_link_with_settings failed: ${createRes.status} ${JSON.stringify(errBody)}`);
}

// Fallback artwork for tracks with no embedded picture — NASA's Astronomy Picture of
// the Day archive has a built-in random-pick feature (count=N), so we ask for a few and
// filter out the occasional video-of-the-day entry rather than searching for one ourselves.
async function getRandomNasaImage(env) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${NASA_APOD_URL}?api_key=${env.NASA_API_KEY}&count=5`);
    if (!res.ok) throw new Error(`NASA APOD request failed: ${res.status}`);
    const items = await res.json();
    const images = items.filter(item => item.media_type === 'image' && item.url);
    if (images.length) {
      const pick = images[Math.floor(Math.random() * images.length)];
      return { url: pick.url || pick.hdurl, title: pick.title };
    }
  }
  throw new Error('No image-type APOD entries found');
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

// Reorg-triage annotations (note + freeform tags, e.g. "trash", "favorite", "mjg",
// "rename") — separate from actual music metadata, not edits to the files themselves.
// Stored in KV keyed by Dropbox path, meant to be reviewed later on your own machine
// (GET /annotations) rather than acted on automatically from here.
async function getAllAnnotations(kv) {
  const result = {};
  let cursor;
  do {
    const list = await kv.list({ cursor });
    for (const key of list.keys) {
      const raw = await kv.get(key.name);
      if (raw) result[key.name] = JSON.parse(raw);
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);
  return result;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);

    if (url.pathname === '/stream') {
      const path = url.searchParams.get('path');
      if (!path) return json({ error: 'Missing path' }, 400);
      try {
        const link = await getStreamUrl(env, path);
        return json({ url: link });
      } catch (e) {
        return json({ error: e.message }, 502);
      }
    }

    if (url.pathname === '/share') {
      const path = url.searchParams.get('path');
      if (!path) return json({ error: 'Missing path' }, 400);
      try {
        const link = await getShareLink(env, path);
        return json({ url: link });
      } catch (e) {
        return json({ error: e.message }, 502);
      }
    }

    if (url.pathname === '/annotation') {
      const path = url.searchParams.get('path');
      if (request.method === 'GET') {
        if (!path) return json({ error: 'Missing path' }, 400);
        const raw = await env.ANNOTATIONS.get(path);
        return json(raw ? JSON.parse(raw) : {});
      }
      if (request.method === 'PUT') {
        let body;
        try {
          body = await request.json();
        } catch (e) {
          return json({ error: 'Invalid JSON body' }, 400);
        }
        if (!body.path) return json({ error: 'Missing path' }, 400);
        const note = typeof body.note === 'string' ? body.note : '';
        const tags = Array.isArray(body.tags) ? body.tags.filter(t => typeof t === 'string' && t) : [];
        if (!note && tags.length === 0) {
          // nothing left to say about this file — remove the record entirely
          await env.ANNOTATIONS.delete(body.path);
          return json({ note: '', tags: [] });
        }
        const record = { note, tags, updatedAt: Date.now() };
        await env.ANNOTATIONS.put(body.path, JSON.stringify(record));
        return json(record);
      }
      return json({ error: 'Method not allowed' }, 405);
    }

    if (url.pathname === '/annotations' && request.method === 'GET') {
      const all = await getAllAnnotations(env.ANNOTATIONS);
      return json(all);
    }

    if (url.pathname === '/nasa-image' && request.method === 'GET') {
      try {
        const image = await getRandomNasaImage(env);
        return json(image);
      } catch (e) {
        return json({ error: e.message }, 502);
      }
    }

    return json({ error: 'Not found' }, 404);
  },
};
