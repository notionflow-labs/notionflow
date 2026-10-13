import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.mjs';
import { startConnection,finishConnection,connectedSession,disconnect } from '../src/notion-oauth.mjs';
import { memorySessionStore } from '../src/local-session-store.mjs';
import { sessionStore } from '../src/notion-oauth.mjs';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { SAMPLE_REPORT, notionId } from '../src/document.mjs';
const env=() => ({NOTION_OAUTH_CLIENT_ID:'client',NOTION_OAUTH_CLIENT_SECRET:'secret',NOTION_OAUTH_REDIRECT_URI:'https://preview.example/api/notion/callback',NOTION_SESSION_KEY:'a'.repeat(64),NOTION_SESSION_STORE:memorySessionStore(),DEMO_ACCESS_TOKEN:'access',NOTION_TOKEN:'sandbox',NOTION_PARENT_PAGE_ID:'a'.repeat(32),LIVE_NOTION_ENABLED:'true'});
const req=(path,cookie,body) => new Request(`https://preview.example${path}`,{method:body ? 'POST':'GET',headers:{...(cookie ? {cookie}:{}),...(body ? {authorization:'Bearer access','content-type':'application/json',origin:'https://preview.example'}:{})},...(body ? {body:JSON.stringify(body)}:{})});
async function connect(e,token='visitor-token') {
  const start=await startConnection(req('/api/notion/connect'),e),url=new URL((await start.json()).url),cookie=start.headers.get('set-cookie').split(';')[0];
  const callback=req(`/api/notion/callback?state=${url.searchParams.get('state')}&code=code`,cookie);
  const result=await finishConnection(callback,e,async () => Response.json({access_token:token,workspace_id:'workspace',workspace_name:'My workspace'}));
  return {callback,result,cookie:result.headers.getSetCookie().find(s => s.startsWith('nf_notion=')).split(';')[0]};
}
test('OAuth binds state to the browser, rejects reuse and hides provider tokens',async () => {
  const e=env(),{callback,result,cookie}=await connect(e);
  assert.equal(result.status,303); assert.equal(new URL(result.headers.get('location')).searchParams.get('notion'),'connected');
  assert(!JSON.stringify([...result.headers]).includes('visitor-token'));
  assert.equal((await connectedSession(req('/api/notion/connection',cookie),e)).token,'visitor-token');
  await assert.rejects(finishConnection(callback,e),{status:400});
  await assert.rejects(connectedSession(req('/api/notion/connection','nf_notion='+'b'.repeat(64)),e),{status:401});
  const start=await startConnection(req('/api/notion/connect'),e),url=new URL((await start.json()).url);
  await assert.rejects(finishConnection(req(`/api/notion/callback?state=${url.searchParams.get('state')}&code=x`,'nf_notion_state='+'c'.repeat(64)),e),{status:400});
});
test('Each visitor has an independent token and disconnect removes local access even if revoke fails',async () => {
  const e=env(),a=await connect(e,'token-a'),b=await connect(e,'token-b');
  const request=req('/api/notion/disconnect',a.cookie);
  const result=await disconnect(request,e,async () => new Response('',{status:500}));
  assert.equal((await result.json()).revoked,false);
  await assert.rejects(connectedSession(request,e),{status:401});
  assert.equal((await connectedSession(req('/api/notion/connection',b.cookie),e)).token,'token-b');
});
test('Personal destination never falls back to the sandbox and validates parent access before writing',async () => {
  const e=env(),a=await connect(e); let calls=0;
  const missing=await worker.fetch(req('/api/notion/publish',null,{workspace:'personal',parentPageId:'a'.repeat(32),confirm:true}),e,async () => {calls++;});
  assert.equal(missing.status,401); assert.equal(calls,0);
  const denied=await worker.fetch(req('/api/notion/publish',a.cookie,{workspace:'personal',parentPageId:'a'.repeat(32),confirm:true}),e,async (_url,options) => {
    calls++; assert.equal(options.method,'GET'); assert.equal(options.headers.authorization,'Bearer visitor-token'); return new Response('',{status:403});
  });
  assert.equal(denied.status,502); assert.equal(calls,1);
});
test('Personal publishing uses the selected parent and visitor token, with no write before confirmation',async () => {
  const e=env(),a=await connect(e,'own-workspace-token'),parent='c'.repeat(32),calls=[];
  const fetcher=async (url,options) => {
    calls.push({url,options}); assert.equal(options.headers.authorization,'Bearer own-workspace-token');
    if(options.method==='GET') return Response.json({id:parent,properties:{}});
    const payload=JSON.parse(options.body); assert.equal(payload.parent.page_id,notionId(parent));
    return Response.json({id:'created',url:'https://notion.so/created'});
  };
  const unconfirmed=await worker.fetch(req('/api/notion/publish',a.cookie,{workspace:'personal',parentPageId:parent,report:SAMPLE_REPORT,confirm:false}),e,fetcher);
  assert.equal(unconfirmed.status,400); assert.equal(calls.filter(c => c.options.method==='POST').length,0);
  const confirmed=await worker.fetch(req('/api/notion/publish',a.cookie,{workspace:'personal',parentPageId:parent,report:SAMPLE_REPORT,confirm:true}),e,fetcher);
  assert.equal(confirmed.status,200); assert.equal((await confirmed.json()).pageId,'created');
  assert.equal(calls.filter(c => c.options.method==='POST').length,1);
});
test('OAuth endpoints reject foreign origins, bad callback configuration and unauthorized page listing',async () => {
  const e=env();
  const foreign=new Request('https://preview.example/api/notion/connect',{method:'POST',headers:{origin:'https://evil.example',authorization:'Bearer access'}});
  assert.equal((await worker.fetch(foreign,e)).status,403);
  await assert.rejects(startConnection(req('/api/notion/connect'),{...e,NOTION_OAUTH_REDIRECT_URI:'https://evil.example/api/notion/callback'}),{status:503});
  assert.equal((await worker.fetch(req('/api/notion/pages',null,{}),e)).status,401);
});
test('D1 schema and queries consume state once, reject expired sessions, and store encrypted tokens',async () => {
  const db=new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_notion_sessions.sql',import.meta.url),'utf8'));
  const e={...env(),NOTION_SESSION_STORE:undefined,NOTION_DB:{prepare(sql) { return {bind(...args) {return {run:async () => db.prepare(sql).run(...args),first:async () => db.prepare(sql).get(...args) || null};}};}}};
  try {
    const store=sessionStore(e),a=await connect(e,'private-access-token');
    assert.equal((await connectedSession(req('/api/notion/connection',a.cookie),e)).token,'private-access-token');
    assert(!db.prepare('SELECT value FROM notion_sessions WHERE type=?').get('session').value.includes('private-access-token'));
    await store.put('expired','session','value',1); assert.equal(await store.get('expired','session'),null);
    await store.put('state','state','browser',Math.floor(Date.now()/1000)+10);
    const results=await Promise.all([store.take('state','state'),store.take('state','state')]);
    assert.equal(results.filter(Boolean).length,1);
    await store.cleanup(); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notion_sessions WHERE id=?').get('expired').n,0);
  } finally { db.close(); }
});
