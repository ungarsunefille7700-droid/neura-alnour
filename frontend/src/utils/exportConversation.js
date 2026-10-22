// Export of a conversation (Mongo and above): plain text, or a page printed to PDF by the
// browser ("Enregistrer au format PDF") — nothing is sent to any service.
export const EXPORT_PLANS = ['mongo', 'pro', 'developer', 'neura_plus', 'neura_ultra'];

export const canExport = (user) => Boolean(user && (user.is_vip || EXPORT_PLANS.includes(user.subscription)));

const who = (role) => (role === 'user' ? 'Toi' : 'NEURA AL-NOUR');
const when = (iso) => {
  const day = new Date(iso);
  return Number.isNaN(day.getTime()) ? '' : day.toLocaleString('fr-FR');
};

export const conversationText = (messages, title = 'Conversation') => {
  const lines = [`${title}`, `Exportée le ${new Date().toLocaleString('fr-FR')} depuis NEURA AL-NOUR`, ''];
  (messages || []).filter((m) => m.role === 'user' || m.role === 'assistant').forEach((m) => {
    lines.push(`— ${who(m.role)}${m.created_at ? ` (${when(m.created_at)})` : ''}`);
    lines.push(String(m.content || '').trim(), '');
  });
  return lines.join('\n');
};

const escapeHtml = (text) => String(text)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const conversationHtml = (messages, title = 'Conversation') => {
  const rows = (messages || []).filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => (
    `<section class="${m.role}"><h2>${who(m.role)}<small>${escapeHtml(when(m.created_at))}</small></h2>`
    + `<pre>${escapeHtml(String(m.content || '').trim())}</pre></section>`
  )).join('');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>`
    + '<style>body{font-family:system-ui,sans-serif;margin:32px;color:#111}h1{font-size:20px}'
    + 'section{margin:16px 0;padding:12px 16px;border-radius:12px;background:#f4f6f8}section.user{background:#e8f5ee}'
    + 'h2{font-size:13px;margin:0 0 6px}small{font-weight:normal;color:#666;margin-left:8px}'
    + 'pre{white-space:pre-wrap;font:14px/1.5 system-ui,sans-serif;margin:0}</style></head><body>'
    + `<h1>${escapeHtml(title)}</h1><p>Exportée le ${escapeHtml(new Date().toLocaleString('fr-FR'))} depuis NEURA AL-NOUR</p>`
    + `${rows}</body></html>`;
};

export const downloadText = (messages, title) => {
  const blob = new Blob([conversationText(messages, title)], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${(title || 'conversation').replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 60) || 'conversation'}.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// Printed from a hidden frame: the browser's print window offers "Enregistrer au format PDF".
export const printPdf = (messages, title) => {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(conversationHtml(messages, title));
  doc.close();
  setTimeout(() => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 1000);
  }, 200);
};
