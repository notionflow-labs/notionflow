export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const KINDS = ['meeting', 'brief', 'tasks'];
export const SAMPLE_SOURCE = `Harbor Studio — website launch review\nOctober 9, 2026\n\nWe agreed to launch the new website on November 6, 2026. The first release will include the homepage, service pages and a contact form. The customer portal is outside this release.\n\nMaya will send the approved homepage copy by October 16, 2026. Eli will test the contact form on mobile by October 23, 2026. Someone needs to confirm the analytics requirements; no owner or deadline was agreed.\n\nWe still need to decide who will maintain the website after launch. The budget for ongoing maintenance has not been confirmed.`;
export const SAMPLE_REPORT = {
  title: 'Harbor Studio · launch review',
  summary: 'The team agreed on a November 6 website launch covering the homepage, service pages and contact form. The customer portal is excluded. Copy and mobile testing have owners and dates; analytics and ongoing maintenance need clarification.',
  decisions: [
    { text: 'Launch the website on November 6, 2026.', evidence: 'We agreed to launch the new website on November 6, 2026.' },
    { text: 'Keep the customer portal outside the first release.', evidence: 'The customer portal is outside this release.' }
  ],
  tasks: [
    { title: 'Send approved homepage copy', owner: 'Maya', due: '2026-10-16', evidence: 'Maya will send the approved homepage copy by October 16, 2026.' },
    { title: 'Test the contact form on mobile', owner: 'Eli', due: '2026-10-23', evidence: 'Eli will test the contact form on mobile by October 23, 2026.' },
    { title: 'Confirm analytics requirements', owner: '', due: '', evidence: 'Someone needs to confirm the analytics requirements; no owner or deadline was agreed.' }
  ],
  questions: ['Who will maintain the website after launch?', 'What is the ongoing maintenance budget?', 'Who owns analytics requirements, and when are they due?']
};
export const REPORT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['title', 'summary', 'decisions', 'tasks', 'questions'], properties: {
    title: { type: 'string' }, summary: { type: 'string' },
    decisions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text','evidence'], properties: { text: { type: 'string' }, evidence: { type: 'string' } } } },
    tasks: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title','owner','due','evidence'], properties: { title: { type: 'string' }, owner: { type: 'string' }, due: { type: 'string' }, evidence: { type: 'string' } } } },
    questions: { type: 'array', items: { type: 'string' } }
  }
};
function bounded(value, length, field) {
  if (typeof value !== 'string' || value.length > length) throw new HttpError(400, `Invalid ${field}.`);
  return value.trim();
}
export function validDate(value) {
  if (value === '') return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
export function validateReport(report) {
  if (!report || !Array.isArray(report.decisions) || !Array.isArray(report.tasks) || !Array.isArray(report.questions) || report.decisions.length > 15 || report.tasks.length > 20 || report.questions.length > 15) throw new HttpError(400, 'Invalid report structure.');
  return {
    title: bounded(report.title, 180, 'title') || 'Untitled document', summary: bounded(report.summary, 5000, 'summary'),
    decisions: report.decisions.map(d => ({ text: bounded(d?.text, 1500, 'decision'), evidence: bounded(d?.evidence, 2000, 'evidence') })),
    tasks: report.tasks.map(t => {
      const due = bounded(t?.due, 10, 'due date');
      if (!validDate(due)) throw new HttpError(400, 'Due dates must be real dates in YYYY-MM-DD format or blank.');
      return { title: bounded(t?.title, 300, 'task'), owner: bounded(t?.owner, 100, 'owner'), due, evidence: bounded(t?.evidence, 2000, 'evidence') };
    }), questions: report.questions.map(q => bounded(q, 1000, 'question'))
  };
}
function containsQuote(source, quote) {
  return quote.length > 0 && source.replace(/\s+/g, ' ').includes(quote.replace(/\s+/g, ' '));
}
export function groundReport(input, source, pdf = false) {
  let report;
  try { report = validateReport(input); } catch { throw new HttpError(502, 'Claude returned an incomplete or invalid document. Try again.'); }
  const warnings = [];
  if (!pdf) {
    report.decisions = report.decisions.filter(d => { const ok = containsQuote(source,d.evidence); if (!ok) warnings.push('A decision was omitted because its excerpt did not match the source.'); return ok; });
    report.tasks = report.tasks.filter(t => { const ok = containsQuote(source,t.evidence); if (!ok) warnings.push('A task was omitted because its excerpt did not match the source.'); return ok; });
  } else warnings.push('PDF excerpts are model-reported. Check them against the original PDF before publishing.');
  for (const t of report.tasks) {
    if (!pdf && t.owner && !containsQuote(t.evidence, t.owner)) { t.owner = ''; warnings.push('An owner was cleared because the name was absent from the task excerpt.'); }
  }
  return { report, warnings, evidenceCheck: pdf ? 'review-pdf' : 'text-match' };
}
export function markdown(report) {
  const r = validateReport(report);
  return `# ${r.title}\n\n${r.summary}\n\n## Decisions\n\n${r.decisions.map(d => `- ${d.text}\n  > ${d.evidence}`).join('\n')}\n\n## Tasks\n\n${r.tasks.map(t => `- [ ] ${t.title} — ${t.owner || 'Unassigned'}${t.due ? ` · ${t.due}` : ''}\n  > ${t.evidence}`).join('\n')}\n\n## Open questions\n\n${r.questions.map(q => `- ${q}`).join('\n')}\n`;
}
export function notionId(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'Enter a Notion page ID.');
  const id = value.replace(/-/g,'');
  if (!/^[a-f\d]{32}$/i.test(id)) throw new HttpError(400, 'Use the 32-character Notion page ID, with or without hyphens.');
  return `${id.slice(0,8)}-${id.slice(8,12)}-${id.slice(12,16)}-${id.slice(16,20)}-${id.slice(20)}`;
}
const rich = value => [{ type: 'text', text: { content: value.slice(0,1900) } }];
const block = (type, text) => ({ object: 'block', type, [type]: { rich_text: rich(text) } });
export function pagePayload(report, parent) {
  const r = validateReport(report);
  return { parent: { type: 'page_id', page_id: notionId(parent) }, properties: { title: { type: 'title', title: rich(r.title) } }, children: [
    ...r.summary.match(/.{1,1800}(?:\s|$)|.{1,1800}/gs)?.map(t => block('paragraph',t)) || [],
    block('heading_2','Decisions'), ...r.decisions.flatMap(d => [block('bulleted_list_item',d.text),block('quote',d.evidence)]),
    block('heading_2','Tasks'), ...r.tasks.map(t => ({ object: 'block', type: 'to_do', to_do: { rich_text: rich(`${t.title} · ${t.owner || 'Unassigned'}${t.due ? ` · ${t.due}` : ''}`), checked: false } })),
    block('heading_2','Open questions'), ...r.questions.map(q => block('bulleted_list_item',q)),
    block('paragraph','Created with NotionFlow. AI-assisted draft reviewed by the user before export.')
  ] };
}
