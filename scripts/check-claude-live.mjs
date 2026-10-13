import { mkdir, writeFile } from 'node:fs/promises';
import worker from '../src/worker.mjs';
import { SAMPLE_SOURCE } from '../src/document.mjs';
import assert from 'node:assert/strict';
const key = process.env.ANTHROPIC_API_KEY;
if (!key) throw Error('Set ANTHROPIC_API_KEY server-side before running paid checks');
await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
const env = { ANTHROPIC_API_KEY:key, DEMO_ACCESS_TOKEN:'local-live-validation-only', LIVE_DEMO_ENABLED:'true', CLAUDE_MODEL:'claude-sonnet-4-6' };
const results = [];
for (const kind of ['meeting','brief','tasks']) {
  const response = await worker.fetch(new Request('http://127.0.0.1:4320/api/generate', { method:'POST', headers:{'content-type':'application/json',authorization:'Bearer '+env.DEMO_ACCESS_TOKEN,origin:'http://127.0.0.1:4320'}, body:JSON.stringify({kind,text:SAMPLE_SOURCE}) }),env);
  const data = await response.json();
  assert.equal(response.status,200,JSON.stringify(data));
  assert.equal(data.mode,'live');
  assert.ok(data.report.tasks.length >= 2);
  assert.ok(data.report.decisions.length >= 1);
  for (const t of data.report.tasks) {
    assert.ok(SAMPLE_SOURCE.replace(/\s+/g,' ').includes(t.evidence.replace(/\s+/g,' ')));
    assert.notEqual(t.owner,'Invented Person');
  }
  assert.ok(data.report.tasks.some(t => t.owner === 'Maya' && t.due === '2026-10-16'));
  assert.ok(data.report.tasks.some(t => t.owner === 'Eli' && t.due === '2026-10-23'));
  results.push({kind,status:response.status,...data});
  console.log(JSON.stringify({kind,status:response.status,model:data.model,tasks:data.report.tasks.length,decisions:data.report.decisions.length,warnings:data.warnings,usage:data.usage}));
}
await writeFile(new URL('../test-results/claude-live.json',import.meta.url), JSON.stringify({at:new Date().toISOString(),source:SAMPLE_SOURCE,results},null,2)+'\n');
