// Génération d'un vrai fichier PDF (texte, polices standard Helvetica, emblème Ade-ci), sans bibliothèque ni service externe.
// Le fichier est ensuite partagé avec la feuille de partage native de l'iPhone (Mail, Outlook, Fichiers…).
const PAGE_W = 595.28, PAGE_H = 841.89, MARGIN = 56;
const TEAL = [0.016, 0.361, 0.439], NAVY = [0.031, 0.161, 0.322], GRAY = [0.42, 0.42, 0.42], INK = [0.13, 0.12, 0.12];

// Unicode -> WinAnsi (cp1252), l'encodage des polices standard du PDF
const CP1252 = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f };
function toWin(str) {
  const out = [];
  for (const ch of str.replace(/[   ]/g, ' ')) {
    const c = ch.codePointAt(0);
    if (c === 10 || c === 13) continue;
    if (c === 9) { out.push(32, 32, 32, 32); continue; }
    if (c >= 32 && c < 127) out.push(c);
    else if (c >= 160 && c <= 255) out.push(c);
    else if (CP1252[ch] !== undefined) out.push(CP1252[ch]);
    else if (c === 0x2022 || c === 0x25cf) out.push(0x95);
    else out.push(63);
  }
  return out;
}
const hex = (bytes) => '<' + bytes.map((b) => b.toString(16).padStart(2, '0')).join('') + '>';
const winString = (s) => String.fromCharCode(...toWin(s));

let measureCtx = null;
function width(text, bold, size) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = (bold ? 'bold ' : '') + '100px Arial, Helvetica, sans-serif'; // Arial a les mêmes largeurs que Helvetica
  return (measureCtx.measureText(winString(text)).width / 100) * size;
}
function wrap(text, bold, size, maxW) {
  const lines = [];
  for (const para of text.split('\n')) {
    if (!para.trim()) { lines.push({ t: '', ind: 0, bullet: false }); continue; }
    const m = para.match(/^\s*[-•*]\s+(.*)$/);          // puces : le texte est décalé de 14 pt
    const ind = m ? 14 : 0, avail = maxW - ind;
    let line = '', first = true;
    for (const word of (m ? m[1] : para.trim()).split(/\s+/)) {
      const t = line ? line + ' ' + word : word;
      if (width(t, bold, size) > avail && line) { lines.push({ t: line, ind, bullet: !!m && first }); line = word; first = false; }
      else line = t;
    }
    lines.push({ t: line, ind, bullet: !!m && first });
  }
  return lines;
}

async function loadEmblem(src) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const S = 112, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0, S, S);
  const d = cx.getImageData(0, 0, S, S).data, rgb = new Uint8Array(S * S * 3);
  for (let i = 0, j = 0; i < d.length; i += 4) { rgb[j++] = d[i]; rgb[j++] = d[i + 1]; rgb[j++] = d[i + 2]; }
  return { size: S, rgb };
}

export async function makePdf({ title, meta, brand = 'Ade-ci Family Office', sections, footer = 'Document confidentiel – compte rendu rédigé et relu par l\'utilisateur', emblemSrc = 'img/emblem-tile.png' }) {
  let emblem = null;
  try { emblem = await loadEmblem(emblemSrc); } catch { /* sans emblème */ }
  const pages = [];
  let ops = [], y = 0;
  const color = (c, stroke) => `${c[0].toFixed(3)} ${c[1].toFixed(3)} ${c[2].toFixed(3)} ${stroke ? 'RG' : 'rg'}`;
  const text = (s, x, yy, font, size, col) => { ops.push(`BT ${color(col)} /${font} ${size} Tf ${x.toFixed(2)} ${yy.toFixed(2)} Td ${hex(toWin(s))} Tj ET`); };
  const newPage = () => { ops = []; y = PAGE_H - MARGIN; pages.push(ops); };
  const maxW = PAGE_W - 2 * MARGIN, bottom = MARGIN + 18;

  newPage();
  // En-tête : emblème, marque, titre, métadonnées, filet
  const eSize = 46;
  if (emblem) ops.push(`q ${eSize} 0 0 ${eSize} ${MARGIN} ${PAGE_H - MARGIN - eSize} cm /Im1 Do Q`);
  const tx = MARGIN + (emblem ? eSize + 14 : 0);
  text(brand.toUpperCase(), tx, PAGE_H - MARGIN - 12, 'F2', 8.5, TEAL);
  let ty = PAGE_H - MARGIN - 32;
  for (const l of wrap(title, true, 17, PAGE_W - MARGIN - tx)) { if (!l.t) continue; text(l.t, tx, ty, 'F2', 17, NAVY); ty -= 21; }
  for (const l of wrap(meta, false, 9, PAGE_W - MARGIN - tx)) { if (!l.t) continue; text(l.t, tx, ty, 'F1', 9, GRAY); ty -= 12; }
  y = Math.min(ty, PAGE_H - MARGIN - eSize) - 6;
  ops.push(`${color(TEAL, true)} 1.2 w ${MARGIN} ${y.toFixed(2)} m ${PAGE_W - MARGIN} ${y.toFixed(2)} l S`);
  y -= 24;

  const LH = 14.5;
  for (const s of sections) {
    const body = (s.content || '').trim();
    if (!body) continue;
    const lines = wrap(body, false, 10.5, maxW);
    if (y - 18 - LH * Math.min(2, lines.length) < bottom) { newPage(); }
    text(s.title, MARGIN, y, 'F2', 12, TEAL); y -= 18;
    for (const l of lines) {
      if (y - LH < bottom) { newPage(); }
      if (l.t) {
        if (l.bullet) text('•', MARGIN + 2, y, 'F1', 10.5, INK);
        text(l.t, MARGIN + l.ind, y, 'F1', 10.5, INK);
      }
      y -= l.t ? LH : LH * 0.55;
    }
    y -= 10;
  }
  // Pied de page
  pages.forEach((p, i) => {
    p.push(`${color(GRAY, true)} 0.5 w ${MARGIN} ${MARGIN} m ${PAGE_W - MARGIN} ${MARGIN} l S`);
    const save = ops; ops = p;
    text(footer, MARGIN, MARGIN - 13, 'F3', 7.5, GRAY);
    const pn = `Page ${i + 1}/${pages.length}`;
    text(pn, PAGE_W - MARGIN - width(pn, false, 7.5), MARGIN - 13, 'F1', 7.5, GRAY);
    ops = save;
  });

  // ----- assemblage du fichier -----
  const enc = new TextEncoder();
  const chunks = []; let offset = 0; const offsets = [];
  const push = (data) => { const b = typeof data === 'string' ? enc.encode(data) : data; chunks.push(b); offset += b.length; };
  const obj = (n, body) => { offsets[n] = offset; push(`${n} 0 obj\n${body}\nendobj\n`); };
  push('%PDF-1.4\n%âãÏÓ\n');
  const nPages = pages.length, first = 7;               // objets 1..6 fixes, puis (page, contenu) par page
  const kids = pages.map((_, i) => `${first + 2 * i} 0 R`).join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${nPages} >>`);
  const font = (name) => `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`;
  obj(3, font('Helvetica')); obj(4, font('Helvetica-Bold')); obj(5, font('Helvetica-Oblique'));
  if (emblem) {
    offsets[6] = offset;
    push(`6 0 obj\n<< /Type /XObject /Subtype /Image /Width ${emblem.size} /Height ${emblem.size} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${emblem.rgb.length} >>\nstream\n`);
    push(emblem.rgb); push('\nendstream\nendobj\n');
  } else obj(6, '<< /Type /XObject /Subtype /Form /BBox [0 0 1 1] /Length 0 >>\nstream\n\nendstream');
  pages.forEach((p, i) => {
    const pn = first + 2 * i, cn = pn + 1, stream = p.join('\n');
    obj(pn, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> /XObject << /Im1 6 0 R >> >> /Contents ${cn} 0 R >>`);
    obj(cn, `<< /Length ${enc.encode(stream).length} >>\nstream\n${stream}\nendstream`);
  });
  const infoN = first + 2 * nPages;
  const utf16 = (s) => '<FEFF' + [...s].map((c) => c.codePointAt(0).toString(16).padStart(4, '0')).join('') + '>';
  obj(infoN, `<< /Title ${utf16(title)} /Producer ${utf16('Dictaphone IA')} /Creator ${utf16('Dictaphone IA')} >>`);
  const xref = offset;
  let x = `xref\n0 ${infoN + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= infoN; n++) x += String(offsets[n]).padStart(10, '0') + ' 00000 n \n';
  push(x + `trailer\n<< /Size ${infoN + 1} /Root 1 0 R /Info ${infoN} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}
