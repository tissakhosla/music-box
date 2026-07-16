const DROPBOX_TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const DROPBOX_TEMP_LINK_URL = 'https://api.dropboxapi.com/2/files/get_temporary_link';
const ALLOWED_ORIGIN = 'https://music-box.pages.dev';

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
  if (!res.ok) throw new Error(`Dropbox get_temporary_link failed: ${res.status}`);
  const data = await res.json();
  return data.link;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);
    if (url.pathname !== '/stream') {
      return new Response('Not found', { status: 404, headers: corsHeaders() });
    }

    const path = url.searchParams.get('path');
    if (!path) {
      return new Response(JSON.stringify({ error: 'Missing path' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }

    try {
      const link = await getStreamUrl(env, path);
      return new Response(JSON.stringify({ url: link }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }
  },
};
