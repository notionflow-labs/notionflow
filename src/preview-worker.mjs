import app from './worker.mjs';
const headers = {
  'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet, noimageindex',
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  // Same-origin form POSTs must retain their Origin for the login CSRF check.
  'Referrer-Policy': 'same-origin',
};
const bot = /bot|crawler|spider|slurp|scrapy|headless|curl|python|wget|httpclient|Claude-User/i;
const login = '<!doctype html><html lang="en"><meta name="robots" content="noindex,nofollow"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private preview</title><style>body{font:16px system-ui;background:#0a0e27;color:white;max-width:360px;margin:15vh auto;padding:24px}input,button{box-sizing:border-box;width:100%;padding:12px;margin:8px 0}button{background:#00d4ff;border:0;border-radius:6px}</style><h1>Private preview</h1><p>Enter the preview password to view this website.</p><form method="post" action="/__preview"><label for="password">Preview password</label><input id="password" name="password" type="password" required autocomplete="current-password"><button>Open preview</button></form></html>';
function reply(body, status = 200, extra = {}) {
  return new Response(body, { status, headers: { ...headers, ...extra } });
}
export async function sessionToken(password) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('notionflow-debug-session:' + password));
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function equal(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/robots.txt' && ['GET', 'HEAD'].includes(request.method)) {
      return reply(request.method === 'HEAD' ? null : 'User-agent: *\nDisallow: /\n', 200, { 'Content-Type': 'text/plain' });
    }
    if (bot.test(request.headers.get('User-Agent') || '') || request.cf?.botManagement?.verifiedBot) {
      return reply('Private preview: crawlers are blocked.', 403);
    }
    if (!env.PREVIEW_PASSWORD || env.PREVIEW_PASSWORD.length < 24) return reply('Preview is locked.', 503);
    if (url.pathname === '/__preview' && request.method === 'POST') {
      if (request.headers.get('Origin') !== url.origin) return reply('Forbidden', 403);
      if (!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded')) return reply('Unsupported form', 415);
      if (Number(request.headers.get('Content-Length') || 0) > 2048) return reply('Form too large', 413);
      const text = await request.text();
      if (text.length > 2048) return reply('Form too large', 413);
      if (!equal((new URLSearchParams(text).get('password') || '').trim(), env.PREVIEW_PASSWORD)) {
        return reply(login.replace('<form ', '<p role="alert">Incorrect password. Please try again.</p><form '), 401, { 'Content-Type': 'text/html; charset=utf-8' });
      }
      return reply(null, 303, { Location: '/', 'Set-Cookie': `__Host-preview=${await sessionToken(env.PREVIEW_PASSWORD)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400` });
    }
    const cookie = request.headers.get('Cookie')?.match(/(?:^|;\s*)__Host-preview=([a-f0-9]{64})(?:;|$)/)?.[1] || '';
    if (!equal(cookie, await sessionToken(env.PREVIEW_PASSWORD))) {
      return reply(request.method === 'HEAD' ? null : login, 401, { 'Content-Type': 'text/html; charset=utf-8' });
    }
    const asset = await app.fetch(request, env);
    const result = new Response(asset.body, asset);
    for (const [key, value] of Object.entries(headers)) result.headers.set(key, value);
    return result;
  },
};
