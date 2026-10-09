// Importation de texte (fichier .txt, PDF, presse-papiers) avec aperçu OBLIGATOIRE avant tout changement.
// Principe : rien n'est remplacé sans aperçu, jamais par un contenu vide ou illisible, et l'ancien texte est conservé
// dans l'historique des versions tant que le nouveau n'est pas enregistré et relu avec succès.
import { h, icon, sheet, confirmDialog } from './ui.js';
import { extractPdf, ImportError } from './pdfread.js';

export const cleanText = (t) => t.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\n{4,}/g, '\n\n\n');
export const words = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0);
const squeeze = (t) => t.toLowerCase().replace(/[^a-z0-9àâçéèêëîïôûùüÿœ]+/g, '');

const MAX_TXT = 8 * 1024 * 1024, MAX_PDF = 40 * 1024 * 1024;
const startsWith = (b, sig) => sig.every((v, i) => b[i] === v);

export function pickFile() {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept: '.txt,.text,.md,.pdf,text/plain,application/pdf', style: { display: 'none' } });
    inp.addEventListener('change', () => { resolve(inp.files[0] || null); setTimeout(() => inp.remove(), 0); });
    inp.addEventListener('cancel', () => { resolve(null); inp.remove(); });
    document.body.append(inp); inp.click(); setTimeout(() => inp.remove(), 120000);
  });
}

// Lit un fichier : renvoie { text, kind, name, info } ou lève ImportError avec un message clair
export async function readImport(file, { onProgress } = {}) {
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 8));
  const asc = String.fromCharCode(...head);
  const isPdf = /%PDF-/.test(String.fromCharCode(...new Uint8Array(buf.slice(0, 1024))));
  if (isPdf) {
    if (file.size > MAX_PDF) throw new ImportError('PDF trop volumineux (40 Mo maximum).');
    const r = await extractPdf(buf, { onProgress });
    return { kind: 'pdf', name: file.name, text: cleanText(r.text), info: r };
  }
  if (file.size > MAX_TXT) throw new ImportError('Fichier trop volumineux (8 Mo maximum).');
  if (asc.startsWith('{\\rtf')) throw new ImportError('Format RTF non pris en charge : enregistrez la transcription au format texte (.txt), en PDF, ou collez-la.');
  if (startsWith(head, [0x50, 0x4b])) throw new ImportError('Les fichiers Word (.docx) ne sont pas pris en charge : exportez-les en PDF ou copiez le texte puis collez-le.');
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47]) || startsWith(head, [0xff, 0xd8, 0xff]) || /^GIF8|^RIFF/.test(asc) || /ftyp/.test(String.fromCharCode(...head.slice(4, 8)))) throw new ImportError('Ce fichier est une image ou une vidéo : il ne contient pas de texte lisible.');
  let text;
  if (head[0] === 0xff && head[1] === 0xfe) text = new TextDecoder('utf-16le').decode(buf);
  else if (head[0] === 0xfe && head[1] === 0xff) text = new TextDecoder('utf-16be').decode(buf);
  else text = new TextDecoder('utf-8').decode(buf);
  const bad = (text.match(/[\u0000-\u0008\u000E-\u001F�]/g) || []).length;
  if (text.length && bad / text.length > 0.02) throw new ImportError('Ce fichier ne semble pas être du texte : il ne sera pas importé.');
  return { kind: 'txt', name: file.name, text: cleanText(text), info: null };
}

// Analyse avant décision
export function analyze(existing, incoming) {
  const ex = existing.trim(), inc = incoming.trim();
  const exW = words(ex), incW = words(inc);
  const usable = inc.replace(/\s/g, '').length >= 20 && incW >= 3;
  const duplicate = !!inc && !!ex && squeeze(ex).includes(squeeze(inc));
  const muchShorter = exW >= 20 && incW < exW * 0.5;
  return { exW, incW, usable, duplicate, muchShorter };
}

const nf = (n) => n.toLocaleString('fr-FR');

// Fenêtre d'aperçu. Résout 'append' | 'replace' | 'import' | null (annulé).
export function previewImport({ existing = '', incoming, name = 'Texte collé', kind = 'txt', info = null }) {
  const a = analyze(existing, incoming);
  const hasExisting = existing.trim().length > 0;
  return new Promise((resolve) => {
    let done = false;
    const finish = (v, close) => { if (!done) { done = true; resolve(v); } close && close(); };
    const s = sheet({ title: 'Aperçu avant import', build(body, close) {
      body.append(h('div', { class: 'card', style: { marginBottom: '12px' } },
        h('div', { class: 'kv' }, h('span', { text: 'Source' }), h('span', { text: name })),
        kind === 'pdf' && info ? h('div', { class: 'kv' }, h('span', { text: 'Pages lues' }), h('span', { text: `${info.readable} sur ${info.total}` })) : null,
        h('div', { class: 'kv' }, h('span', { text: 'Contenu à importer' }), h('span', { text: `${nf(a.incW)} mot${a.incW > 1 ? 's' : ''}` })),
        hasExisting ? h('div', { class: 'kv' }, h('span', { text: 'Texte actuel' }), h('span', { text: `${nf(a.exW)} mot${a.exW > 1 ? 's' : ''}` })) : null));

      const warn = (txt) => body.append(h('div', { class: 'banner warn', style: { marginTop: '8px' } }, icon('info'), h('div', { text: txt })));
      if (info) {
        if (info.scanned) warn('Aucun texte n\'a été trouvé : ce PDF semble être un document scanné (une image). L\'application ne sait pas lire les images. Copiez le texte depuis une autre source, ou collez-le.');
        else if (info.emptyPages.length || info.failedPages.length) {
          const list = (arr) => arr.slice(0, 20).join(', ') + (arr.length > 20 ? '…' : '');
          if (info.emptyPages.length) warn(`${info.emptyPages.length} page(s) sans texte lisible (page${info.emptyPages.length > 1 ? 's' : ''} ${list(info.emptyPages)}) : scannée(s) ou image(s). Leur contenu n'est PAS importé.`);
          if (info.failedPages.length) warn(`${info.failedPages.length} page(s) illisible(s) (page${info.failedPages.length > 1 ? 's' : ''} ${list(info.failedPages)}). Leur contenu n'est PAS importé.`);
        }
        if (info.truncated) warn(`Ce PDF compte ${info.total} pages : seules les ${info.limit} premières ont été lues.`);
      }
      if (!a.usable && !info?.scanned) warn('Le contenu à importer est vide ou trop court : il ne sera pas importé.');
      if (a.duplicate) warn('Ce contenu semble déjà présent dans la transcription : l\'ajouter créerait un doublon.');
      if (hasExisting && a.usable && a.muchShorter) warn(`Le nouveau contenu (${nf(a.incW)} mots) est beaucoup plus court que le texte actuel (${nf(a.exW)} mots).`);

      if (a.usable) {
        const prev = incoming.length > 1500 ? incoming.slice(0, 1500) + '\n… (la suite n\'est pas affichée ici)' : incoming;
        body.append(h('div', { class: 'lbl', text: 'Début du contenu à importer' }), h('pre', { style: { maxHeight: '200px', overflow: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'var(--sans)', fontSize: '14px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: '12px', padding: '10px 12px' }, text: prev }));
      }
      const actions = h('div', { class: 'sheet-actions' });
      if (a.usable && hasExisting) {
        actions.append(
          h('button', { class: 'btn primary', disabled: a.duplicate, onclick: () => finish('append', close) }, icon('plus'), h('span', { text: 'Ajouter au texte existant' })),
          h('button', { class: 'btn danger-ghost', onclick: async () => {
            if (a.muchShorter && !(await confirmDialog({ title: 'Remplacer par un texte bien plus court ?', message: `Le texte actuel (${nf(a.exW)} mots) sera remplacé par ${nf(a.incW)} mots. Vous pourrez le rétablir ensuite (« Versions précédentes »).`, confirmLabel: 'Remplacer quand même', danger: true }))) return;
            finish('replace', close);
          } }, icon('edit'), h('span', { text: 'Remplacer le texte actuel' })),
          h('p', { class: 'hint', style: { margin: '0' }, text: 'Le texte actuel est conservé dans « Versions précédentes » : un remplacement peut toujours être annulé.' }));
      } else if (a.usable) {
        actions.append(h('button', { class: 'btn primary', onclick: () => finish('import', close) }, icon('check'), h('span', { text: 'Importer ce texte' })));
      }
      actions.append(h('button', { class: 'btn', text: a.usable ? 'Annuler' : 'Fermer', onclick: () => finish(null, close) }));
      body.append(actions);
    } });
    s.body.parentElement.parentElement.addEventListener('click', (e) => { if (e.target.classList.contains('overlay')) finish(null); });
  });
}
