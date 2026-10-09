// Extraction du texte d'un PDF, entièrement sur l'appareil (pdf.js, hébergé dans vendor/pdfjs, licence Apache 2.0).
// Chaque page est lue séparément ; les pages sans texte (document scanné, image) sont signalées, jamais ignorées en silence.
// Il n'y a pas de reconnaissance de caractères (OCR) : un PDF qui n'est qu'une image donnera « aucun texte ».
const MAX_PAGES = 500;

let lib = null;
async function load() {
  if (!lib) {
    lib = await import('../vendor/pdfjs/pdf.min.mjs');
    lib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  }
  return lib;
}

export class ImportError extends Error {}

export function describePdfError(err) {
  const name = (err && err.name) || '', msg = String((err && err.message) || err || '');
  if (/PasswordException/i.test(name) || /password/i.test(msg)) return 'Ce PDF est protégé par un mot de passe : retirez la protection puis réessayez.';
  if (/InvalidPDF/i.test(name) || /Invalid PDF|not a PDF|Missing PDF/i.test(msg)) return 'Ce fichier PDF est invalide ou endommagé : aucun texte n\'a pu être lu.';
  if (/timeout|délai/i.test(msg)) return 'La lecture du PDF a pris trop de temps : essayez un fichier plus petit.';
  return 'Lecture du PDF impossible : ' + msg.slice(0, 120);
}

// Assemble les fragments d'une page en lignes de texte
function pageText(items) {
  let out = '', lastY = null, lastEnd = null, lastH = 10;
  for (const it of items) {
    if (!('str' in it)) continue;
    const s = it.str;
    const y = it.transform ? it.transform[5] : 0, x = it.transform ? it.transform[4] : 0, h = Math.abs(it.height || (it.transform ? it.transform[3] : 10)) || 10;
    if (lastY !== null && Math.abs(y - lastY) > Math.max(2, lastH * 0.5)) out += '\n';
    else if (out && lastEnd !== null && x - lastEnd > h * 0.18 && !/\s$/.test(out) && !/^\s/.test(s)) out += ' ';
    out += s;
    if (it.hasEOL) out += '\n';
    lastY = y; lastEnd = x + (it.width || 0); lastH = h;
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function extractPdf(arrayBuffer, { onProgress } = {}) {
  const pdfjs = await load();
  let doc;
  try {
    doc = await Promise.race([
      pdfjs.getDocument({ data: new Uint8Array(arrayBuffer), isEvalSupported: false, verbosity: 0, useSystemFonts: false }).promise,
      new Promise((_, rej) => setTimeout(() => rej(new Error('délai dépassé')), 60000)),
    ]);
  } catch (err) { throw new ImportError(describePdfError(err)); }
  try {
    const total = doc.numPages, limit = Math.min(total, MAX_PAGES);
    const pages = [], emptyPages = [], failedPages = [];
    for (let p = 1; p <= limit; p++) {
      onProgress && onProgress(p, limit);
      try {
        const page = await doc.getPage(p);
        const tc = await page.getTextContent();
        const txt = pageText(tc.items);
        if (txt.replace(/\s/g, '').length < 3) { emptyPages.push(p); pages.push(''); } else pages.push(txt);
        page.cleanup();
      } catch { failedPages.push(p); pages.push(''); }
    }
    const readable = pages.filter((x) => x).length;
    const text = pages.filter((x) => x).join('\n\n');
    return { text, total, limit, readable, emptyPages, failedPages, truncated: total > limit, scanned: readable === 0 && failedPages.length < limit };
  } finally { try { doc.destroy(); } catch {} }
}
