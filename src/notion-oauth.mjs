import { HttpError } from './document.mjs';
const encoder = new TextEncoder();
const now = () => Math.floor(Date.now() / 1000);
const random = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2,'0')).join('');
const valid = value => /^[a-f0-9]{64}$/.test(value || '');
const cookieValue = (request, name) => request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(name+'='))?.slice(name.length+1);
const cookie = (request,name,value,age) => `${name}=${value}; Path=/api/notion; HttpOnly; SameSite=Lax; Max-Age=${age}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
export const oauthReady = env => Boolean(env.NOTION_OAUTH_CLIENT_ID && env.NOTION_OAUTH_CLIENT_SECRET && env.NOTION_OAUTH_REDIRECT_URI && /^[a-f0-9]{64}$/.test(env.NOTION_SESSION_KEY || '') && (env.NOTION_DB || env.NOTION_SESSION_STORE));

// D1 DELETE RETURNING consumes authorization state atomically, including concurrent callbacks.
export function sessionStore(env) {
  if (env.NOTION_SESSION_STORE) return env.NOTION_SESSION_STORE;
  const db = env.NOTION_DB;
  return {
    async put(id,type,value,expires) { await db.prepare('INSERT INTO notion_sessions (id,type,value,expires) VALUES (?,?,?,?)').bind(id,type,value,expires).run(); },
    async get(id,type) { return db.prepare('SELECT value FROM notion_sessions WHERE id=? AND type=? AND expires>?').bind(id,type,now()).first(); },
    async take(id,type) { return db.prepare('DELETE FROM notion_sessions WHERE id=? AND type=? RETURNING value,expires').bind(id,type).first(); },
    async remove(id) { await db.prepare('DELETE FROM notion_sessions WHERE id=?').bind(id).run(); },
    async cleanup() { await db.prepare('DELETE FROM notion_sessions WHERE expires<=?').bind(now()).run(); }
  };
}
async function key(env) { return crypto.subtle.importKey('raw',Uint8Array.from(env.NOTION_SESSION_KEY.match(/../g),h => parseInt(h,16)), 'AES-GCM',false,['encrypt','decrypt']); }
async function seal(value,env,id) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(id)},await key(env),encoder.encode(JSON.stringify(value))));
  return JSON.stringify({iv:Array.from(iv),data:Array.from(encrypted)});
}
async function unseal(value,env,id) {
  try { const data=JSON.parse(value); return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(data.iv),additionalData:encoder.encode(id)},await key(env),new Uint8Array(data.data)))); }
  catch { throw new HttpError(401,'Reconnect your Notion workspace.'); }
}
async function oauthCall(path,payload,env,fetcher) {
  let response;
  try { response=await fetcher(`https://api.notion.com/v1/oauth/${path}`,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(20000),headers:{authorization:`Basic ${btoa(`${env.NOTION_OAUTH_CLIENT_ID}:${env.NOTION_OAUTH_CLIENT_SECRET}`)}`,'content-type':'application/json','notion-version':'2025-09-03'},body:JSON.stringify(payload)}); }
  catch { throw new HttpError(502,'Notion authorization could not be reached. Try connecting again.'); }
  if(!response.ok) throw new HttpError(502,'Notion authorization failed. Try connecting again.');
  return response.json();
}
export async function connectedSession(request,env) {
  if(!oauthReady(env)) throw new HttpError(503,'Personal Notion connections are not configured.');
  const id=cookieValue(request,'nf_notion');
  if(!valid(id)) throw new HttpError(401,'Connect your Notion workspace first.');
  const row=await sessionStore(env).get(id,'session');
  if(!row) throw new HttpError(401,'Your connection expired. Reconnect your Notion workspace.');
  return {id,...await unseal(row.value,env,id)};
}
export async function startConnection(request,env) {
  if(!oauthReady(env)) throw new HttpError(503,'Personal Notion connections are not configured.');
  const redirect=new URL(env.NOTION_OAUTH_REDIRECT_URI),origin=new URL(request.url).origin;
  if(redirect.origin!==origin || redirect.pathname!=='/api/notion/callback') throw new HttpError(503,'Notion callback configuration does not match this host.');
  const state=random(),browser=random(),store=sessionStore(env);
  await store.cleanup(); await store.put(state,'state',browser,now()+600);
  const url=new URL('https://api.notion.com/v1/oauth/authorize');
  for(const [k,v] of Object.entries({client_id:env.NOTION_OAUTH_CLIENT_ID,redirect_uri:redirect.href,response_type:'code',owner:'user',state})) url.searchParams.set(k,v);
  return new Response(JSON.stringify({url:url.href}),{headers:{'content-type':'application/json','set-cookie':cookie(request,'nf_notion_state',browser,600)}});
}
export async function finishConnection(request,env,fetcher=fetch) {
  if(!oauthReady(env)) throw new HttpError(503,'Personal Notion connections are not configured.');
  const url=new URL(request.url),state=url.searchParams.get('state'),browser=cookieValue(request,'nf_notion_state');
  if(!valid(state)||!valid(browser)) throw new HttpError(400,'Invalid Notion authorization state. Start the connection again.');
  const store=sessionStore(env),candidate=await store.get(state,'state');
  if(!candidate || candidate.value!==browser) throw new HttpError(400,'Notion authorization expired or belongs to another browser.');
  const consumed=await store.take(state,'state');
  if(!consumed || consumed.expires<=now() || consumed.value!==browser) throw new HttpError(400,'Notion authorization was already used or expired.');
  const target=new URL(url.hostname===`api.${env.SITE_DOMAIN || 'notionflow.app'}` ? `https://app.${env.SITE_DOMAIN || 'notionflow.app'}/` : '/app/',url.origin);
  const headers=new Headers({'cache-control':'no-store','referrer-policy':'no-referrer'});
  headers.append('set-cookie',cookie(request,'nf_notion_state','',0));
  if(url.searchParams.has('error')) { target.searchParams.set('notion','cancelled'); }
  else {
    const code=url.searchParams.get('code'); if(!code || code.length>2048) throw new HttpError(400,'Notion did not supply an authorization code.');
    const token=await oauthCall('token',{grant_type:'authorization_code',code,redirect_uri:env.NOTION_OAUTH_REDIRECT_URI},env,fetcher);
    if(!token.access_token || !token.workspace_id) throw new HttpError(502,'Notion returned an incomplete connection.');
    const id=random();
    await store.put(id,'session',await seal({token:token.access_token,workspaceId:token.workspace_id,workspaceName:token.workspace_name || 'Your Notion workspace'},env,id),now()+86400);
    const old=cookieValue(request,'nf_notion'); if(valid(old)) await store.remove(old);
    headers.append('set-cookie',cookie(request,'nf_notion',id,86400)); target.searchParams.set('notion','connected');
  }
  headers.set('location',target.href); return new Response(null,{status:303,headers});
}
export async function disconnect(request,env,fetcher=fetch) {
  const session=await connectedSession(request,env); let revoked=true;
  try { await oauthCall('revoke',{token:session.token},env,fetcher); } catch { revoked=false; }
  await sessionStore(env).remove(session.id);
  return new Response(JSON.stringify({connected:false,revoked,warning:revoked ? null : 'Local connection removed. Remove NotionFlow in Notion Connections to revoke access there.'}),{headers:{'content-type':'application/json','set-cookie':cookie(request,'nf_notion','',0)}});
}
