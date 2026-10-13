import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { sessionToken } from '../src/preview-worker.mjs';
const password = 'a-test-password-at-least-24-characters';
const env = { PREVIEW_PASSWORD: password, ASSETS: { fetch: () => new Response('protected-site') } };
const req = (path='/', options={}) => new Request('https://preview.example' + path, { ...options, headers: { 'User-Agent':'Mozilla/5.0', ...options.headers } });
test('All unauthenticated paths are locked, even direct assets and forged cookies', async () => {
  for (const path of ['/', '/assets/index-DH4I4395.js', '/vendor/fonts.css', '/sitemap.xml']) {
    const response = await worker.fetch(req(path), env);
    assert.equal(response.status, 401);
    assert.match(response.headers.get('x-robots-tag'), /noindex/);
    assert.equal(response.headers.get('referrer-policy'), 'same-origin');
    assert.doesNotMatch(await response.text(), /protected-site/);
  }
  assert.equal((await worker.fetch(req('/', { headers: { Cookie:'__Host-preview=' + '0'.repeat(64) } }), env)).status, 401);
  assert.equal((await worker.fetch(req(), { ...env, PREVIEW_PASSWORD:'' })).status, 503);
});
test('Crawlers remain blocked with an authenticated cookie; robots disallows every path', async () => {
  const cookie = '__Host-preview=' + await sessionToken(password);
  for (const ua of ['ClaudeBot','Claude-SearchBot','Claude-User','Googlebot','Bingbot','python-requests/2.32','curl/8','UnknownCrawler']) {
    assert.equal((await worker.fetch(req('/', { headers: { 'User-Agent':ua, Cookie:cookie } }), env)).status, 403);
  }
  const robots = await worker.fetch(req('/robots.txt'), env);
  assert.equal(await robots.text(), 'User-agent: *\nDisallow: /\n');
});
test('Same-origin login creates private secure cookie and authenticated assets retain noindex', async () => {
  const response = await worker.fetch(req('/__preview', { method:'POST', headers:{ Origin:'https://preview.example', 'Content-Type':'application/x-www-form-urlencoded' }, body:new URLSearchParams({ password }) }), env);
  assert.equal(response.status, 303);
  assert.match(response.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Strict/);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const asset = await worker.fetch(req('/assets/index-DH4I4395.js', { headers:{ Cookie:cookie } }), env);
  assert.equal(await asset.text(), 'protected-site');
  assert.match(asset.headers.get('cache-control'), /no-store/);
  assert.equal((await worker.fetch(req('/__preview', { method:'POST', headers:{Origin:'https://other.example'}, body:'password=x' }), env)).status, 403);
});
test('Login handles pasted whitespace and gives a useful incorrect-password message', async () => {
  const make = value => req('/__preview', { method:'POST', headers:{ Origin:'https://preview.example', 'Content-Type':'application/x-www-form-urlencoded' }, body:new URLSearchParams({password:value}) });
  assert.equal((await worker.fetch(make('  '+password+'\n'), env)).status, 303);
  const wrong = await worker.fetch(make('wrong'), env);
  assert.equal(wrong.status, 401);
  assert.match(await wrong.text(), /Incorrect password/);
  assert.equal((await worker.fetch(req('/__preview', {method:'POST', headers:{Origin:'null', 'Content-Type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({password})}), env)).status, 403);
});

test('Authenticated API POST reaches the app while anonymous API POST stays locked', async () => {
  const options = { method:'POST', headers:{ 'Content-Type':'application/json', Origin:'https://preview.example' }, body:JSON.stringify({kind:'meeting',text:'A document long enough for a valid input.'}) };
  assert.equal((await worker.fetch(req('/api/generate',options),env)).status,401);
  const cookie = '__Host-preview=' + await sessionToken(password);
  const result = await worker.fetch(req('/api/generate',{...options,headers:{...options.headers,Cookie:cookie,Authorization:'Bearer app-test-code'}}),{...env,DEMO_ACCESS_TOKEN:'app-test-code',LIVE_DEMO_ENABLED:'false'});
  assert.equal(result.status,503);
  assert.match((await result.json()).error,/Live Claude access is not configured/);
  assert.match(result.headers.get('x-robots-tag'),/noindex/);
});
