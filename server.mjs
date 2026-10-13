import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import worker, { MAX_BODY } from './src/worker.mjs';
import { memorySessionStore } from './src/local-session-store.mjs';
const sessions=memorySessionStore();
const root = fileURLToPath(new URL('./public/',import.meta.url));
const types = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json','.xml':'application/xml','.txt':'text/plain' };
const assets = { async fetch(request) {
  let pathname; try { pathname = decodeURIComponent(new URL(request.url).pathname); } catch { return new Response('Bad URL',{ status:400 }); }
  if (pathname.endsWith('/')) pathname += 'index.html'; else if (!path.extname(pathname)) pathname += '/index.html';
  const target = path.resolve(root,'.'+pathname);
  if (!target.startsWith(path.resolve(root)+path.sep)) return new Response('Forbidden',{ status:403 });
  try { return new Response(await readFile(target),{ headers:{ 'content-type':types[path.extname(target)] || 'application/octet-stream' } }); } catch { return new Response('Page not found',{ status:404 }); }
} };
const port = Number(process.env.PORT || 4320);
http.createServer(async (req,res) => {
  try {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) { res.writeHead(413); res.end('Document too large'); return; } chunks.push(chunk); }
    const request = new Request(`http://127.0.0.1:${port}${req.url}`,{ method:req.method,headers:req.headers,...(chunks.length ? { body:Buffer.concat(chunks) } : {}) });
    const response = await worker.fetch(request,{ ...process.env,ASSETS:assets,NOTION_SESSION_STORE:sessions });
    const headers=Object.fromEntries(response.headers); delete headers['set-cookie'];
    const cookies=response.headers.getSetCookie(); if(cookies.length) headers['set-cookie']=cookies;
    res.writeHead(response.status,headers); res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(500); res.end('Server error'); }
}).listen(port,'127.0.0.1',() => console.log(`NotionFlow local preview: http://127.0.0.1:${port}`));
