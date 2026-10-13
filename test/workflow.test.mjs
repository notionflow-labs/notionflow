import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { generate, readNotion, publish } from '../src/worker.mjs';
import { SAMPLE_SOURCE, SAMPLE_REPORT, groundReport, validDate, notionId, pagePayload, markdown } from '../src/document.mjs';
const parent='12345678-1234-1234-1234-123456789abc';
const env={ LIVE_DEMO_ENABLED:'true', ANTHROPIC_API_KEY:'mock-only', DEMO_ACCESS_TOKEN:'test-code', LIVE_NOTION_ENABLED:'true', NOTION_TOKEN:'mock-notion', NOTION_PARENT_PAGE_ID:parent };
function req(path,body,headers={}) { return new Request(`http://127.0.0.1:4320${path}`,{ method:body ? 'POST':'GET',headers:{ ...(body ? { 'content-type':'application/json' }:{}),...headers },...(body ? { body:JSON.stringify(body) }: {}) }); }
const response = data => new Response(JSON.stringify(data),{ headers:{ 'content-type':'application/json' } });
test('sample is fixed, editable output without upstream calls',async () => {
  const result=await worker.fetch(req('/api/sample'),{},() => { throw new Error('Must not call upstream'); });
  assert.equal(result.status,200); const data=await result.json(); assert.equal(data.mode,'sample'); assert.equal(data.source,SAMPLE_SOURCE); assert.equal(data.report.tasks[2].owner,'');
});
test('protected endpoints require an access code and live configuration',async () => {
  assert.equal((await worker.fetch(req('/api/generate',{kind:'meeting',text:SAMPLE_SOURCE}),env)).status,401);
  assert.equal((await worker.fetch(req('/api/generate',{kind:'meeting',text:SAMPLE_SOURCE},{authorization:'Bearer test-code'}),{...env,LIVE_DEMO_ENABLED:'false'})).status,503);
});
test('cross-origin requests are rejected; only app-to-api preflight is accepted',async () => {
  assert.equal((await worker.fetch(req('/api/sample',null,{origin:'https://untrusted.example'}),env)).status,403);
  const request=new Request('https://api.notionflow.app/api/generate',{method:'OPTIONS',headers:{origin:'https://app.notionflow.app','access-control-request-method':'POST','access-control-request-headers':'authorization,content-type'}});
  const r=await worker.fetch(request,env); assert.equal(r.status,204); assert.equal(r.headers.get('access-control-allow-origin'),'https://app.notionflow.app');
});
test('invalid inputs are rejected before sending content to Claude',async () => {
  for(const value of [{kind:'wrong',text:SAMPLE_SOURCE},{kind:'meeting',text:'short'},{kind:'meeting',pdf:btoa('not a pdf')}]) await assert.rejects(generate(value,env,() => { throw new Error('Unexpected upstream'); }),{status:400});
});
test('Claude request uses schema output and returns usage with verified text excerpts',async () => {
  const result=await generate({kind:'meeting',text:SAMPLE_SOURCE},env,async (url,options) => {
    assert.equal(url,'https://api.anthropic.com/v1/messages'); const body=JSON.parse(options.body); assert.equal(body.output_config.format.type,'json_schema'); assert.equal(body.messages[0].content[0].type,'text');
    return response({stop_reason:'end_turn',model:'test-model',usage:{input_tokens:250,output_tokens:120},content:[{type:'text',text:JSON.stringify(SAMPLE_REPORT)}]});
  });
  assert.equal(result.mode,'live'); assert.equal(result.evidenceCheck,'text-match'); assert.equal(result.report.tasks.length,3); assert.equal(result.usage.input_tokens,250);
});
test('ungrounded items are omitted; unsupported owners are cleared',() => {
  const r=structuredClone(SAMPLE_REPORT); r.decisions.push({text:'Invented',evidence:'We approved a million-dollar budget.'}); r.tasks[0].owner='Invented Person';
  const result=groundReport(r,SAMPLE_SOURCE); assert.equal(result.report.decisions.length,2); assert.equal(result.report.tasks[0].owner,''); assert.equal(result.warnings.length,2);
});
test('PDF uses a document block and does not claim automatic excerpt verification',async () => {
  const result=await generate({kind:'tasks',pdf:btoa('%PDF-1.4\nmock fixture')},env,async (_,options) => {
    const b=JSON.parse(options.body); assert.equal(b.messages[0].content[0].source.media_type,'application/pdf');
    return response({stop_reason:'end_turn',model:'test',content:[{type:'text',text:JSON.stringify(SAMPLE_REPORT)}]});
  }); assert.equal(result.evidenceCheck,'review-pdf'); assert.match(result.warnings[0],/original PDF/);
});
test('truncated or refusal responses do not become successful drafts',async () => {
  await assert.rejects(generate({kind:'meeting',text:SAMPLE_SOURCE},env,async () => response({stop_reason:'max_tokens',content:[]})),{status:502});
  await assert.rejects(generate({kind:'meeting',text:SAMPLE_SOURCE},env,async () => new Response('{}',{status:429})),{status:429});
});
test('invalid calendar dates and malformed Notion IDs are rejected',() => {
  assert.equal(validDate('2026-02-30'),false); assert.equal(validDate('2026-02-28'),true); assert.equal(validDate(''),true);
  assert.throws(() => notionId('https://other.example/page'),{status:400}); assert.equal(notionId(parent.replaceAll('-','')),parent);
});
test('Notion import paginates, reads rich text and reports unsupported blocks',async () => {
  let calls=0;
  const result=await readNotion(parent,env,async (url) => {
    calls++; if(url.includes('/pages/')) return response({properties:{Name:{type:'title',title:[{plain_text:'Launch notes'}]}}});
    if(!url.includes('start_cursor')) return response({results:[{type:'paragraph',paragraph:{rich_text:[{plain_text:'Document text'}]}},{type:'image',image:{}}],has_more:true,next_cursor:'next'});
    return response({results:[{type:'paragraph',paragraph:{rich_text:[{plain_text:'Second page text'}]}}],has_more:false});
  }); assert.equal(calls,3); assert.match(result.text,/Second page text/); assert.equal(result.truncated,true);
});
test('publishing requires explicit confirmation and creates page plus data-source tasks',async () => {
  await assert.rejects(publish({report:SAMPLE_REPORT},env),{status:400});
  const calls=[];
  const result=await publish({report:SAMPLE_REPORT,confirm:true,createDatabase:true},env,async (url,options) => {
    const b=JSON.parse(options.body); calls.push({url,body:b});
    if(calls.length===1) return response({id:parent,url:'https://www.notion.so/test'});
    if(url.endsWith('/databases')) return response({id:'db',data_sources:[{id:'source'}],url:'https://www.notion.so/db'});
    assert.equal(b.parent.data_source_id,'source'); return response({id:'task'});
  }); assert.equal(result.tasksCreated,3); assert.equal(calls.length,5); assert.ok(calls[1].body.initial_data_source.properties.Task.title); assert.equal(calls[4].body.properties.Due.date,null);
});
test('a partial database failure preserves the created page and reports completed tasks',async () => {
  let calls=0;
  const result=await publish({report:SAMPLE_REPORT,confirm:true,createDatabase:true},env,async () => {
    if(++calls===1) return response({id:parent,url:'https://www.notion.so/test'});
    if(calls===2) return response({id:'db',data_sources:[{id:'source'}]});
    if(calls===3) return response({id:'first-task'});
    return new Response('{}',{status:429});
  }); assert.equal(result.pageId,parent); assert.equal(result.tasksCreated,1); assert.match(result.warning,/incomplete/);
});
test('Markdown and Notion payloads contain reviewed edits without dropping summary text',() => {
  const r=structuredClone(SAMPLE_REPORT); r.title='Edited title'; r.summary='a'.repeat(4000);
  assert.match(markdown(r),/^# Edited title/); const p=pagePayload(r,parent); assert.equal(p.properties.title.title[0].text.content,'Edited title');
  const summary=p.children.filter(b => b.type==='paragraph').slice(0,-1).map(b => b.paragraph.rich_text[0].text.content).join(''); assert.equal(summary,r.summary);
});
test('body and method limits fail cleanly; HEAD has no body',async () => {
  const unknown=await worker.fetch(req('/api/missing'),env); assert.equal(unknown.status,404);
  assert.equal((await worker.fetch(req('/api/generate'),env)).status,405);
  const head=await worker.fetch(new Request('http://127.0.0.1:4320/api/sample',{method:'HEAD'}),env); assert.equal(head.status,200); assert.equal(await head.text(),'');
  const big=await worker.fetch(req('/api/generate',{kind:'meeting',text:'a'.repeat(1500001)},{authorization:'Bearer test-code'}),env); assert.equal(big.status,413);
});
