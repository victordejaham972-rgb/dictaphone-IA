// Exports : copie, fichier texte, PDF (via la fenêtre d'impression, gratuite et sans service externe), partage de fichiers.
import { catLabel } from './defaults.js';
import { reportOf, folderPath } from './store.js';

export const fmtDate = (ms) => new Date(ms).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
export const fmtDateTime = (ms) => new Date(ms).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const safeName = (s) => (s || 'entretien').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\- ]+/g, '_').trim().replace(/\s+/g, '-').slice(0, 60) || 'entretien';

export function metaLine(e, folders) {
  const path = e.folderId ? folderPath(e.folderId, folders).map((f) => f.name).join(' › ') : '';
  return [catLabel(e.category), fmtDate(e.date), path].filter(Boolean).join(' · ');
}

export function reportText(e, folders, templateName) {
  const parts = [e.title, metaLine(e, folders)];
  if (templateName) parts.push('Trame : ' + templateName);
  parts.push('');
  for (const s of reportOf(e)) {
    if (!(s.content || '').trim()) continue;
    parts.push(s.title.toUpperCase(), s.content.trim(), '');
  }
  return parts.join('\n').trim() + '\n';
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  try { // repli : sélection temporaire d'une zone de texte
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

export function downloadBlob(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
export const downloadText = (name, text) => downloadBlob(name, new Blob([text], { type: 'text/plain;charset=utf-8' }));

// iPhone : feuille de partage (« Enregistrer dans Fichiers »). Sinon : téléchargement classique.
export async function shareOrDownload(files, title) {
  if (navigator.canShare && navigator.canShare({ files })) {
    try { await navigator.share({ files, title }); return 'partage'; } catch (err) { if (err && err.name === 'AbortError') return 'annule'; }
  }
  for (const f of files) downloadBlob(f.name, f);
  return 'telechargement';
}

// Vrai fichier PDF (partageable avec les fonctions natives de l'iPhone)
export async function reportPdfFile(e, folders, templateName) {
  const { makePdf } = await import('./pdf.js');
  const blob = await makePdf({ title: e.title, meta: metaLine(e, folders) + (templateName ? ' · Trame : ' + templateName : ''), sections: reportOf(e) });
  return new File([blob], safeName(e.title) + '-compte-rendu.pdf', { type: 'application/pdf' });
}

// Envoi par mail : on prépare un lien « mailto: » ; la messagerie de l'appareil s'ouvre avec le message prêt.
// Rien n'est envoyé par Dictaphone IA : l'utilisateur relit puis envoie lui-même depuis Mail, Outlook, etc.
export const validEmail = (a) => /^[^\s@<>(),;]+@[^\s@<>(),;]+\.[^\s@<>(),;]{2,}$/.test(a);
export const splitAddresses = (s) => s.split(/[;,\s]+/).map((x) => x.trim()).filter(Boolean);
export function mailtoHref({ to, subject, body }) {
  const addrs = splitAddresses(to).map((a) => encodeURIComponent(a).replace(/%40/g, '@')).join(',');
  return 'mailto:' + addrs + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body.replace(/\r?\n/g, '\r\n'));
}
export function openMailto(href) {
  const a = document.createElement('a');
  a.href = href; a.rel = 'noopener'; a.style.display = 'none';
  document.body.appendChild(a); a.click(); a.remove();
}

// PDF : la page d'impression est construite puis imprimée ; l'utilisateur choisit « Enregistrer en PDF ».
export function printReport(e, folders, templateName) {
  const root = document.getElementById('print-root');
  root.textContent = '';
  const h = document.createElement('div'); h.className = 'p-head';
  const img = document.createElement('img'); img.src = 'img/emblem-tile.png'; img.alt = ''; img.width = 56; img.height = 56;
  const t = document.createElement('div');
  const b = document.createElement('div'); b.className = 'p-brand'; b.textContent = 'Ade-ci Family Office';
  const ti = document.createElement('h1'); ti.textContent = e.title;
  const me = document.createElement('p'); me.className = 'p-meta'; me.textContent = metaLine(e, folders) + (templateName ? ' · Trame : ' + templateName : '');
  t.append(b, ti, me); h.append(img, t); root.appendChild(h);
  for (const s of reportOf(e)) {
    if (!(s.content || '').trim()) continue;
    const sec = document.createElement('section');
    const hh = document.createElement('h2'); hh.textContent = s.title;
    const pp = document.createElement('p'); pp.textContent = s.content.trim();
    sec.append(hh, pp); root.appendChild(sec);
  }
  const foot = document.createElement('p'); foot.className = 'p-foot'; foot.textContent = 'Document confidentiel – compte rendu rédigé et relu par l\'utilisateur.';
  root.appendChild(foot);
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); root.textContent = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
}
