import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.mjs';
const env={PUBLIC_SITE_ENABLED:'true',SITE_DOMAIN:'notionflow.app',ASSETS:{fetch:request=>new Response(new URL(request.url).pathname)}};
test('Prepared public routing serves app assets, canonical hosts and exact credentialed CORS',async () => {
  const app=await worker.fetch(new Request('https://app.notionflow.app/'),env);
  assert.equal(await app.text(),'/app/'); assert.match(app.headers.get('x-robots-tag'),/noindex/);
  const old=await worker.fetch(new Request('https://notionflow.app/app/'),env);
  assert.equal(old.headers.get('location'),'https://app.notionflow.app/');
  const www=await worker.fetch(new Request('https://www.notionflow.app/docs/'),env);
  assert.equal(www.headers.get('location'),'https://notionflow.app/docs/');
  const api=await worker.fetch(new Request('https://api.notionflow.app/api/status',{headers:{origin:'https://app.notionflow.app'}}),env);
  assert.equal(api.headers.get('access-control-allow-origin'),'https://app.notionflow.app');
  assert.equal(api.headers.get('access-control-allow-credentials'),'true');
  assert.match(api.headers.get('x-robots-tag'),/noindex/);
  assert.equal((await worker.fetch(new Request('https://api.notionflow.app/api/status',{headers:{origin:'https://evil.example'}}),env)).status,403);
});
test('Only the enabled public homepage permits indexing; preview and app robots stay closed',async () => {
  const homepage=await worker.fetch(new Request('https://notionflow.app/robots.txt'),env);
  assert.match(await homepage.text(),/Sitemap: https:\/\/notionflow.app\/sitemap.xml/);
  for(const host of ['app.notionflow.app','private.workers.dev']) {
    assert.equal(await (await worker.fetch(new Request(`https://${host}/robots.txt`),env)).text(),'User-agent: *\nDisallow: /\n');
  }
  assert.equal(await (await worker.fetch(new Request('https://notionflow.app/robots.txt'),{...env,PUBLIC_SITE_ENABLED:'false'})).text(),'User-agent: *\nDisallow: /\n');
});
