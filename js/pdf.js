// Génération d'un vrai fichier PDF, sans bibliothèque ni service externe, entièrement sur l'appareil.
// Charte Ade-ci : coquille d'œuf #F6F0E7, canard #045C70, bleu marine #1F497D, gris foncé #444444, noir pour le texte, vert flash #C1FF72 (touche discrète).
// Polices intégrées au PDF : Abhaya Libre Regular (titres) et Open Sans Light / Regular (texte) — licence OFL, fichiers hébergés dans fonts/pdf/.
// Si les polices ne peuvent pas être lues, le PDF est quand même créé avec les polices standard (Helvetica).
import { parseTtf } from './ttf.js';

const PAGE_W = 595.28, PAGE_H = 841.89, MARGIN = 56;
const rgb = (r, g, b) => [r / 255, g / 255, b / 255];
const COL = { canard: rgb(0x04, 0x5c, 0x70), marine: rgb(0x1f, 0x49, 0x7d), gris: rgb(0x44, 0x44, 0x44), noir: [0, 0, 0], flash: rgb(0xc1, 0xff, 0x72), coquille: rgb(0xf6, 0xf0, 0xe7) };

// Unicode -> WinAnsi (cp1252), l'encodage des polices du PDF
const CP1252 = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f };
const UNI_OF = {}; for (const [ch, code] of Object.entries(CP1252)) UNI_OF[code] = ch.codePointAt(0);
const unicodeOfWin = (code) => (code >= 0x80 && code <= 0x9f ? UNI_OF[code] || 0 : code);
function toWin(str) {
  const out = [];
  for (const ch of str.replace(/[     ]/g, ' ')) {
    const c = ch.codePointAt(0);
    if (c === 10 || c === 13 || c === 0x200b || c === 0xfeff) continue;
    if (c === 9) { out.push(32, 32, 32, 32); continue; }
    if (c >= 32 && c < 127) out.push(c);
    else if (c >= 160 && c <= 255) out.push(c);
    else if (CP1252[ch] !== undefined) out.push(CP1252[ch]);
    else if (c === 0x25cf || c === 0x2023) out.push(0x95);
    else if (c === 0x2011 || c === 0x2010 || c === 0x2212) out.push(45);
    else out.push(63);
  }
  return out;
}
const hex = (bytes) => '<' + bytes.map((b) => b.toString(16).padStart(2, '0')).join('') + '>';

// ---------- Polices ----------
const FILES = { title: 'AbhayaLibre-Regular.ttf', body: 'OpenSans-Light.ttf', label: 'OpenSans-Regular.ttf' };
let measureCtx = null;
function stdFont(base, bold) {
  return {
    std: base, encode: toWin,
    measure(str, size) {
      if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
      measureCtx.font = (bold ? 'bold ' : '') + '100px Arial, Helvetica, sans-serif';
      return (measureCtx.measureText(String.fromCharCode(...toWin(str))).width / 100) * size;
    },
  };
}
function ttfFont(name, bytes) {
  const info = parseTtf(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const w = new Array(256).fill(0), k = 1000 / info.upm;
  for (let c = 32; c < 256; c++) { const cp = unicodeOfWin(c); const g = cp ? info.glyphFor(cp) : 0; w[c] = g ? Math.round(info.advance(g) * k) : 0; }
  if (!w[32]) w[32] = 250;
  w[160] = w[160] || w[32];
  const encode = (s) => toWin(s).map((c) => (w[c] > 0 ? c : 63));
  return { name, bytes, info, widths: w, encode, measure: (s, size) => (encode(s).reduce((a, c) => a + w[c], 0) * size) / 1000 };
}
let fontCache = null;
async function loadFonts() {
  if (fontCache) return fontCache;
  try {
    const out = {};
    for (const [key, file] of Object.entries(FILES)) {
      const r = await fetch(new URL('../fonts/pdf/' + file, import.meta.url));
      if (!r.ok) throw new Error('police introuvable : ' + file);
      out[key] = ttfFont(file.replace('.ttf', ''), new Uint8Array(await r.arrayBuffer()));
    }
    fontCache = out;
  } catch { fontCache = { title: stdFont('Helvetica-Bold', true), body: stdFont('Helvetica', false), label: stdFont('Helvetica', false), fallback: true }; }
  return fontCache;
}

// ---------- Mise en page du texte ----------
function wrap(text, font, size, maxW) {
  const lines = [];
  const pieces = (word, avail) => { // mot plus large que la ligne : coupé caractère par caractère (adresses, longues suites)
    const out = []; let cur = '';
    for (const ch of word) { if (cur && font.measure(cur + ch, size) > avail) { out.push(cur); cur = ch; } else cur += ch; }
    if (cur) out.push(cur);
    return out;
  };
  for (const para of text.split('\n')) {
    if (!para.trim()) { lines.push({ t: '', ind: 0, bullet: false }); continue; }
    const m = para.match(/^\s*[-•*]\s+(.*)$/);
    const ind = m ? 14 : 0, avail = maxW - ind;
    let line = '', first = true;
    const flush = () => { lines.push({ t: line, ind, bullet: !!m && first }); first = false; };
    for (const word0 of (m ? m[1] : para.trim()).split(/\s+/)) {
      for (const word of font.measure(word0, size) > avail ? pieces(word0, avail) : [word0]) {
        const t = line ? line + ' ' + word : word;
        if (font.measure(t, size) > avail && line) { flush(); line = word; } else line = t;
      }
    }
    flush();
  }
  return lines;
}
const clip = (s, font, size, maxW) => { if (font.measure(s, size) <= maxW) return s; let t = s; while (t.length > 1 && font.measure(t + '...', size) > maxW) t = t.slice(0, -1); return t.trimEnd() + '...'; };

async function loadEmblem(src) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const S = 112, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0, S, S);
  const d = cx.getImageData(0, 0, S, S).data, rgbBytes = new Uint8Array(S * S * 3);
  for (let i = 0, j = 0; i < d.length; i += 4) { rgbBytes[j++] = d[i]; rgbBytes[j++] = d[i + 1]; rgbBytes[j++] = d[i + 2]; }
  return { size: S, rgb: rgbBytes };
}

// kind : « Compte rendu » ou « Transcription » ; rows : [{ label, value }] (les lignes vides sont ignorées) ; sections : [{ title, content }] (titre vide = pas d'intertitre)
export async function makePdf({ kind = 'Compte rendu', title, rows = [], sections, brand = 'Ade-ci Family Office', footer = 'Document confidentiel', emblemSrc = 'img/emblem-tile.png' }) {
  const fonts = await loadFonts();
  let emblem = null;
  try { emblem = await loadEmblem(emblemSrc); } catch { /* sans emblème */ }
  const FONT_LIST = [['F1', fonts.body], ['F2', fonts.title], ['F3', fonts.label]];

  const pages = [];
  let ops = [], y = 0;
  const color = (c, stroke) => `${c[0].toFixed(3)} ${c[1].toFixed(3)} ${c[2].toFixed(3)} ${stroke ? 'RG' : 'rg'}`;
  const ref = (f) => FONT_LIST.find(([, ff]) => ff === f)[0];
  // espacement entre lettres (tc) : seulement pour les petites capitales de la marque
  const text = (s, x, yy, font, size, col, tc = 0) => ops.push(`BT ${color(col)} ${tc} Tc /${ref(font)} ${size} Tf ${x.toFixed(2)} ${yy.toFixed(2)} Td ${hex(font.encode(s))} Tj ET`);
  const rect = (x, yy, w, h, col) => ops.push(`${color(col)} ${x.toFixed(2)} ${yy.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  const line = (x1, y1, x2, y2, col, wd) => ops.push(`${color(col, true)} ${wd} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  const newPage = () => { ops = []; pages.push(ops); return ops; };
  const maxW = PAGE_W - 2 * MARGIN, bottom = MARGIN + 22;
  const BRAND = brand.toUpperCase(), KIND = kind.toUpperCase();
  const spaced = (s, font, size, tc) => font.measure(s, size) + tc * s.length;

  // ----- Page 1 : en-tête sur bandeau coquille d'œuf -----
  const first = newPage();
  const top = PAGE_H - 40, eSize = 44, tx = MARGIN + (emblem ? eSize + 16 : 0), avail = PAGE_W - MARGIN - tx;
  text(BRAND, tx, top - 10, fonts.label, 8, COL.canard, 1.8);
  text(KIND, PAGE_W - MARGIN - spaced(KIND, fonts.label, 8, 1.2), top - 10, fonts.label, 8, COL.gris, 1.2);
  let ty = top - 36;
  for (const l of wrap(title, fonts.title, 22, avail)) { if (!l.t) continue; text(l.t, tx, ty, fonts.title, 22, COL.marine); ty -= 26; }
  ty -= 4;
  const LABEL_W = 92;
  for (const r of rows) {
    if (!r || !String(r.value || '').trim()) continue;
    text(r.label, tx, ty, fonts.label, 8.5, COL.gris);
    for (const l of wrap(String(r.value), fonts.body, 10, avail - LABEL_W)) { if (!l.t) continue; text(l.t, tx + LABEL_W, ty, fonts.body, 10, COL.noir); ty -= 14; }
  }
  const bandBottom = Math.min(ty, top - eSize) - 4;
  // dessiné d'abord (sous le texte) : bandeau, puis filet canard et petite touche de vert flash
  const bg = [];
  bg.push(`${color(COL.coquille)} 0 ${bandBottom.toFixed(2)} ${PAGE_W} ${(PAGE_H - bandBottom).toFixed(2)} re f`);
  bg.push(`${color(COL.canard)} 0 ${(bandBottom - 1.2).toFixed(2)} ${PAGE_W} 1.2 re f`);
  bg.push(`${color(COL.flash)} ${MARGIN} ${(bandBottom - 3.2).toFixed(2)} 46 3.2 re f`);
  if (emblem) bg.push(`q ${eSize} 0 0 ${eSize} ${MARGIN} ${(top - eSize).toFixed(2)} cm /Im1 Do Q`);
  first.unshift(...bg);
  y = bandBottom - 32;

  // ----- Corps du document -----
  const BODY = 10.5, LH = 15.5;
  const startPage = () => {
    newPage();
    const t = clip(title, fonts.title, 10, maxW - 150);
    text(t, MARGIN, PAGE_H - 34, fonts.title, 10, COL.marine);
    text(BRAND, PAGE_W - MARGIN - spaced(BRAND, fonts.label, 6.5, 1.5), PAGE_H - 33, fonts.label, 6.5, COL.canard, 1.5);
    line(MARGIN, PAGE_H - 42, PAGE_W - MARGIN, PAGE_H - 42, COL.canard, 0.6);
    y = PAGE_H - 42 - 28;
  };
  for (const s of sections) {
    const body = (s.content || '').trim();
    if (!body) continue;
    const lines = wrap(body, fonts.body, BODY, maxW);
    const head = (s.title || '').trim();
    if (head) {
      if (y - 20 - LH * Math.min(2, lines.length) < bottom) startPage();
      text(head, MARGIN, y, fonts.title, 15, COL.canard); y -= 22;
    }
    for (const l of lines) {
      if (y - LH < bottom) startPage();
      if (l.t) {
        if (l.bullet) text('•', MARGIN + 2, y, fonts.body, BODY, COL.canard);
        text(l.t, MARGIN + l.ind, y, fonts.body, BODY, COL.noir);
      }
      y -= l.t ? LH : LH * 0.55;
    }
    y -= 12;
  }
  // ----- Pied de page (toutes les pages) -----
  pages.forEach((p, i) => {
    ops = p;
    line(MARGIN, MARGIN, PAGE_W - MARGIN, MARGIN, COL.gris, 0.4);
    text(footer, MARGIN, MARGIN - 13, fonts.label, 7, COL.gris);
    const pn = `Page ${i + 1}/${pages.length}`;
    text(pn, PAGE_W - MARGIN - fonts.label.measure(pn, 7), MARGIN - 13, fonts.label, 7, COL.gris);
  });

  // ----- Assemblage du fichier -----
  const enc = new TextEncoder();
  const chunks = []; let offset = 0; const offsets = [];
  const push = (data) => { const b = typeof data === 'string' ? enc.encode(data) : data; chunks.push(b); offset += b.length; };
  const obj = (n, body) => { offsets[n] = offset; push(`${n} 0 obj\n${body}\nendobj\n`); };
  const nPages = pages.length;
  let next = 3;
  for (const [, f] of FONT_LIST) { if (f.bytes) { f.nFile = next++; f.nDesc = next++; } f.nFont = next++; }
  const nImg = emblem ? next++ : 0;
  const firstPage = next, infoN = firstPage + 2 * nPages;
  push('%PDF-1.4\n%âãÏÓ\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${firstPage + 2 * i} 0 R`).join(' ')}] /Count ${nPages} >>`);
  for (const [, f] of FONT_LIST) {
    if (f.bytes) {
      const i = f.info, k = 1000 / i.upm;
      offsets[f.nFile] = offset;
      push(`${f.nFile} 0 obj\n<< /Length ${f.bytes.length} /Length1 ${f.bytes.length} >>\nstream\n`); push(f.bytes); push('\nendstream\nendobj\n');
      obj(f.nDesc, `<< /Type /FontDescriptor /FontName /${f.name} /Flags 32 /FontBBox [${i.bbox.map((v) => Math.round(v * k)).join(' ')}] /ItalicAngle ${Math.round(i.italicAngle)} /Ascent ${Math.round(i.ascent * k)} /Descent ${Math.round(i.descent * k)} /CapHeight ${Math.round(i.capHeight * k)} /StemV 80 /FontFile2 ${f.nFile} 0 R >>`);
      obj(f.nFont, `<< /Type /Font /Subtype /TrueType /BaseFont /${f.name} /FirstChar 32 /LastChar 255 /Widths [${f.widths.slice(32).join(' ')}] /FontDescriptor ${f.nDesc} 0 R /Encoding /WinAnsiEncoding >>`);
    } else obj(f.nFont, `<< /Type /Font /Subtype /Type1 /BaseFont /${f.std} /Encoding /WinAnsiEncoding >>`);
  }
  if (emblem) {
    offsets[nImg] = offset;
    push(`${nImg} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${emblem.size} /Height ${emblem.size} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${emblem.rgb.length} >>\nstream\n`);
    push(emblem.rgb); push('\nendstream\nendobj\n');
  }
  const fontRes = FONT_LIST.map(([n, f]) => `/${n} ${f.nFont} 0 R`).join(' ');
  pages.forEach((p, i) => {
    const pn = firstPage + 2 * i, cn = pn + 1, stream = p.join('\n');
    obj(pn, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << ${fontRes} >>${emblem ? ` /XObject << /Im1 ${nImg} 0 R >>` : ''} >> /Contents ${cn} 0 R >>`);
    obj(cn, `<< /Length ${enc.encode(stream).length} >>\nstream\n${stream}\nendstream`);
  });
  const utf16 = (s) => '<FEFF' + [...s].map((c) => c.codePointAt(0).toString(16).padStart(4, '0')).join('') + '>';
  obj(infoN, `<< /Title ${utf16(title)} /Author ${utf16(brand)} /Producer ${utf16('Dictaphone IA')} /Creator ${utf16('Dictaphone IA')} >>`);
  const xref = offset;
  let x = `xref\n0 ${infoN + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= infoN; n++) x += String(offsets[n]).padStart(10, '0') + ' 00000 n \n';
  push(x + `trailer\n<< /Size ${infoN + 1} /Root 1 0 R /Info ${infoN} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const blob = new Blob(chunks, { type: 'application/pdf' });
  blob.pages = nPages; blob.fontsEmbedded = !fonts.fallback;
  return blob;
}
