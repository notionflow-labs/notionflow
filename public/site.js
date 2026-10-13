const appHost = location.hostname === 'notionflow.app' || location.hostname === 'www.notionflow.app';
if (appHost) document.querySelectorAll('[data-app-link]').forEach(a => { a.href = 'https://app.notionflow.app/'; });
document.querySelectorAll('[data-example]').forEach(button => button.addEventListener('click',() => {
  document.querySelectorAll('[data-example]').forEach(b => b.setAttribute('aria-selected',String(b === button)));
  const views = {
    meeting: ['Launch review','Meeting notes','Launch the website on November 6. Keep the customer portal outside the first release.','Send approved homepage copy','Maya · Oct 16','Test the contact form on mobile','Eli · Oct 23'],
    brief: ['Website launch','Project brief','First release: homepage, service pages and a contact form. Customer portal excluded.','Prepare homepage content','Maya · Oct 16','Confirm analytics requirements','Unassigned · No date'],
    tasks: ['Website action items','Task list','Two dated assignments and one open task. Missing owners and dates stay blank.','Send approved homepage copy','Maya · Oct 16','Confirm analytics requirements','Unassigned · No date']
  };
  const value = views[button.dataset.example];
  ['example-title','example-kind','example-summary','task-one','owner-one','task-two','owner-two'].forEach((id,i) => { document.getElementById(id).textContent = value[i]; });
}));
