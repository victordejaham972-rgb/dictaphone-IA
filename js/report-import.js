// Import du compte rendu collé depuis ChatGPT : reconnaissance des rubriques de la trame (titres Markdown, numérotés,
// « Titre : », gras, accents ou pluriels différents), sous-rubriques, tableaux Markdown convertis en listes.
// Module pur (aucun accès au DOM ni au stockage) : le texte reçu n'est jamais perdu, rien n'est placé en silence dans une seule rubrique.

export const normTitle = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/œ/g, 'oe')
  .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Formulations proches que ChatGPT emploie volontiers à la place du titre demandé (clé = titre normalisé de la trame).
const ALIASES = {
  'patrimoine': ['situation patrimoniale', 'patrimoine du client', 'patrimoine du foyer'],
  'financier': ['patrimoine financier', 'actifs financiers', 'placements financiers', 'placements', 'epargne financiere'],
  'immobilier': ['patrimoine immobilier', 'biens immobiliers', 'actifs immobiliers'],
  'professionnel': ['patrimoine professionnel', 'epargne salariale et retraite', 'epargne salariale', 'retraite', 'professionnel epargne salariale et retraite'],
  'situation': ['situation familiale et professionnelle', 'situation personnelle', 'situation du client', 'situation familiale', 'situation professionnelle'],
  'besoins': ['besoin', 'besoins et objectifs', 'objectifs', 'objectifs et besoins', 'objectifs du client', 'besoins du client'],
  'interets': ['interet', 'centres d interet', 'solutions envisagees', 'pistes envisagees', 'pistes', 'solutions et pistes'],
  'actions': ['action', 'actions a realiser', 'actions a mener', 'plan d action', 'prochaines etapes', 'actions et suivi', 'to do'],
  'a garder en memoire': ['a retenir', 'points a retenir', 'a garder a l esprit', 'memoire', 'a garder en tete', 'points de vigilance et suivi', 'suivi', 'points en attente'],
};

const BULLET = /^(\s*)(?:[-*•▪◦‣–—+])\s+/;

function cellsOf(row) {
  let s = row.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.replace(/<br\s*\/?>/gi, ' ; ').replace(/\s+/g, ' ').trim());
}
const isSep = (row) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(row) && row.includes('-');
const isTableRow = (row) => /^\s*\|.*\|?\s*$/.test(row) && (row.match(/\|/g) || []).length >= 2;
const emptyCell = (c) => !c || /^[-–—.]+$/.test(c) || /^non (évoqué|evoque|précisé|precise)\.?$/i.test(c);

// Remplace les tableaux Markdown (valides ou non) par des listes à puces lisibles. Les titres de lignes de type
// « Rubrique | Contenu » deviennent de vrais titres.
export function tablesToBullets(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  for (let i = 0; i < lines.length;) {
    if (!isTableRow(lines[i])) { out.push(lines[i]); i++; continue; }
    const block = [];
    while (i < lines.length && isTableRow(lines[i])) block.push(lines[i++]);
    const sepAt = block.findIndex(isSep);
    const valid = sepAt === 1;
    const head = valid ? cellsOf(block[0]) : null;
    const rows = block.filter((_, k) => !isSep(block[k]) && !(valid && k === 0)).map(cellsOf).filter((r) => r.some((c) => c));
    const headTitleCol = head && head.length === 2 && /^(rubrique|section|theme|titre|categorie|sujet)s?$/.test(normTitle(head[0]));
    for (const r of rows) {
      const filled = r.map((c, k) => ({ c, h: head ? head[k] : '' })).filter((x) => !emptyCell(x.c));
      if (!filled.length) continue;
      if (headTitleCol) {
        out.push('', '## ' + r[0], ...r[1].split(/\s*;\s*/).filter((x) => x && !emptyCell(x)).map((x) => '- ' + x));
        continue;
      }
      if (r.length === 1) { out.push('- ' + r[0]); continue; }
      const first = r[0];
      const rest = filled.filter((x) => x.c !== first);
      if (!rest.length) { out.push('- ' + first); continue; }
      if (rest.length === 1 && (!rest[0].h || r.length === 2)) out.push(`- ${first} : ${rest[0].c}`);
      else out.push(`- ${first} : ` + rest.map((x) => (x.h && !/^(détail|detail|commentaire|information|description|contenu)s?$/i.test(x.h) ? x.h + ' ' : '') + x.c).join(' ; '));
    }
    out.push('');
  }
  return out.join('\n');
}

// Nettoyage du contenu d'une rubrique : puces uniformes, pas de marqueurs de gras, pas de filets horizontaux.
export function cleanContent(lines) {
  const out = [];
  for (let ln of lines) {
    if (/^\s*([-*_=])\1{2,}\s*$/.test(ln)) continue;
    ln = ln.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/`([^`]+)`/g, '$1');
    ln = ln.replace(BULLET, (m, sp) => sp.replace(/\t/g, '  ') + '- ');
    out.push(ln.replace(/\s+$/, ''));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');
}

// Index de la rubrique de la trame correspondant à un titre détecté (-1 si aucune), avec le mode de correspondance.
function matchTitle(head, keys, used, loose = true) {
  const h = normTitle(head).replace(/^(?:\d+(?:\s\d+)*\s+)/, '').replace(/^(?:rubrique|section|partie)\s+/, '');
  if (!h) return null;
  let idx = keys.findIndex((k, i) => k && !used.has(i) && k === h);
  if (idx >= 0) return { idx, how: 'exact' };
  idx = keys.findIndex((k, i) => k && k === h);
  if (idx >= 0 && !used.has(idx)) return { idx, how: 'exact' };
  for (let i = 0; i < keys.length; i++) {
    if (!keys[i] || used.has(i)) continue;
    const al = ALIASES[keys[i]]; if (al && al.includes(h)) return { idx: i, how: 'proche' };
  }
  // le titre détecté commence par le titre de la trame (« Financier et placements ») ou inversement (mots entiers, 4 lettres au moins)
  const cand = [];
  if (loose) keys.forEach((k, i) => { if (k && k.length >= 4 && !used.has(i) && (h.startsWith(k + ' ') || k.startsWith(h + ' ')) && h.length >= 4) cand.push(i); });
  if (cand.length === 1) return { idx: cand[0], how: 'proche' };
  return null;
}

// Détecte si une ligne est un titre. Retourne { title, rest, kind } ou null.
function headingOf(raw, keys, used) {
  const line = raw.trim();
  if (!line) return null;
  let kind = null, body = line;
  let m;
  if ((m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line))) { kind = 'md'; body = m[2]; }
  else if ((m = /^(?:\d+(?:\.\d+)*)[.)]?\s+(.+)$/.exec(line))) { kind = 'num'; body = m[1]; }
  else if (BULLET.test(line)) { kind = 'bullet'; body = line.replace(BULLET, ''); }
  else if ((m = /^\*\*(.+?)\*\*\s*:?\s*(.*)$/.exec(line)) || (m = /^__(.+?)__\s*:?\s*(.*)$/.exec(line))) { kind = 'bold'; body = m[1] + (m[2] ? ' : ' + m[2] : ''); }
  else kind = 'plain';
  body = body.replace(/\*\*|__|`/g, '').replace(/^\s*[\p{Extended_Pictographic}️]+\s*/u, '').trim();
  // « Titre : texte » ou « Titre » seul
  const ci = body.search(/[:：]/);
  const left = (ci >= 0 ? body.slice(0, ci) : body).replace(/[\s.:：—–-]+$/, '').trim();
  const rest = ci >= 0 ? body.slice(ci + 1).trim() : '';
  if (!left || left.length > 90) return null;
  const mt = matchTitle(left, keys, used, ci < 0 && kind !== 'bullet');
  if (mt) {
    // une ligne longue sans deux-points ni marque de titre est du texte, pas un titre (ex. phrase commençant par « Actions »)
    if (kind === 'plain' && ci < 0 && body.length > 60) return null;
    if ((kind === 'num' || kind === 'bullet') && ci < 0 && /[.;]$/.test(body)) return null;
    return { title: left, rest, kind, match: mt };
  }
  // titre inconnu : seulement s'il porte une marque de titre explicite et ne contient pas de phrase
  const words = left.split(/\s+/).length;
  if (kind === 'md' && ci < 0 && left.length <= 80) return { title: left, rest: '', kind, match: null };
  if (kind === 'bold' && !rest && words <= 8) return { title: left, rest: '', kind, match: null };
  if (kind === 'plain' && ci === line.replace(/\*\*|__/g, '').trim().length - 1 && words <= 6 && !rest) return { title: left, rest: '', kind, match: null };
  return null;
}

// ---------- Texte « aplati » (retours à la ligne perdus au collage) ----------
// Retrouve les titres de la trame au milieu d'une ligne (« Maj du 261012 Patrimoine : - … Financier : - … ») et remet des lignes.
// Prudence : seuls les titres EXACTS de la trame (ou leurs formulations proches), écrits avec une majuscule et suivis de deux-points,
// sont retenus ; « les actions : » ou « sa situation : » dans une phrase ne coupent rien. Les parties retrouvées sont marquées pour vérification.
const STOP = new Set(['le', 'la', 'les', 'des', 'de', 'du', 'd', 'un', 'une', 'ces', 'vos', 'nos', 'aux', 'au', 'sur', 'en', 'dans', 'par', 'pour', 'ses', 'leurs', 'mes', 'mon', 'ma', 'ton', 'ta', 'sa', 'son', 'notre', 'votre', 'leur', 'cette', 'cet', 'ce', 'et', 'ou', 'a', 'sans', 'avec']);
const BUL = '[-–•*]';
const foldLen = (s) => { let o = ''; for (let i = 0; i < s.length; i++) { const c = s[i]; const d = c.normalize('NFD'); const b = d.length > 1 ? d[0] : c; const l = b.toLowerCase(); o += l.length === 1 ? l : b; } return o; };
const rxEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const RX_TRAIL_BUL = new RegExp('\\s+' + BUL + '\\s*$');
const RX_LEAD_BUL = new RegExp('^' + BUL + '\\s+');
const RX_SPLIT_BUL = new RegExp('(?<!\\d)\\s+' + BUL + '\\s+|\\s+' + BUL + '\\s+(?!\\d)');   // pas de coupure entre deux chiffres (« 2026 - 2027 »)
function splitBullets(body) {
  let b = body.replace(RX_TRAIL_BUL, '').trim();
  const lead = RX_LEAD_BUL.test(b);
  b = b.replace(RX_LEAD_BUL, '');
  const parts = b.split(RX_SPLIT_BUL).map((x) => x.trim()).filter(Boolean);
  return lead || parts.length > 1 ? parts.map((x) => '- ' + x) : (b ? [b] : []);
}
function reflowLine(line, rx, needColon = true) {
  const f = foldLen(line);
  const cuts = [];
  for (const m of f.matchAll(rx)) {
    const start = m.index + m[1].length;
    if (!/\p{Lu}/u.test(line[start] || '')) continue;
    const before = line.slice(0, start);
    if (before.replace(/[\s\-–•*]+/g, '') === '') continue;                    // déjà en début de ligne (ou derrière une puce)
    const w = /([\p{L}']+)[\s\-–•*:]*$/u.exec(foldLen(before));
    if (w && STOP.has(w[1].replace(/'$/, ''))) continue;                       // « les Actions : » dans une phrase
    cuts.push({ start, end: start + m[2].length });
  }
  if (!cuts.length) return null;
  const out = [];
  const pre = line.slice(0, cuts[0].start).replace(RX_TRAIL_BUL, '').trim();
  if (pre) out.push({ t: pre, inline: false });
  cuts.forEach((c, i) => {
    const title = line.slice(c.start, c.end).trim();
    const bodyEnd = i + 1 < cuts.length ? cuts[i + 1].start : line.length;
    const body = line.slice(c.end, bodyEnd).replace(/^\s*[:：]\s*/, '');
    const items = splitBullets(body);
    if (items.length === 1 && !items[0].startsWith('- ')) out.push({ t: `${title} : ${items[0]}`, inline: true });
    else { out.push({ t: `${title} :`, inline: true }); items.forEach((x) => out.push({ t: x, inline: false })); }
  });
  return out;
}
function titleRegex(tsec, colon) {
  const alts = new Set();
  for (const s of tsec) {
    const ft = foldLen(s.title.trim());
    alts.add(rxEsc(ft).replace(/\s+/g, '\\s+'));
    const al = ALIASES[normTitle(s.title)];
    if (al) al.forEach((a) => alts.add(rxEsc(a).replace(/ /g, "[\\s'’\\-]+")));
  }
  const list = [...alts].filter(Boolean).sort((a, b) => b.length - a.length);
  if (!list.length) return null;
  return new RegExp('(^|[\\s(\\[\\-–•*])(' + list.join('|') + ')' + (colon ? '\\s*[:：]' : '(?![\\p{L}\\p{N}])'), 'gu');
}
// Retourne les lignes (éventuellement redécoupées) : [{ t, inline }]
export function reflow(lines, tsec) {
  const asIs = lines.map((t) => ({ t, inline: false }));
  if (!tsec || !tsec.length) return { lines: asIs, reflowed: 0 };
  const rx = titleRegex(tsec, true);
  let n = 0; const out = [];
  for (const ln of lines) {
    const r = rx && ln.length > 8 ? reflowLine(ln, rx) : null;
    if (r) { n += r.filter((x) => x.inline).length; out.push(...r); } else out.push({ t: ln, inline: false });
  }
  // Texte entièrement aplati et sans deux-points : on accepte seulement une suite d'au moins 3 titres de rubriques, dans l'ordre de la trame
  const flat = lines.filter((l) => l.trim()).length <= 2 && lines.join(' ').length > 150;
  if (n < 2 && flat) {
    const rx2 = titleRegex(tsec.filter((s) => s.level !== 2), false);
    const text = lines.join(' ');
    const f = foldLen(text); const hits = [];
    if (rx2) for (const m of f.matchAll(rx2)) { const st = m.index + m[1].length; if (/\p{Lu}/u.test(text[st] || '')) hits.push({ start: st, end: st + m[2].length }); }
    const order = tsec.filter((s) => s.level !== 2).map((s) => foldLen(s.title.trim()));
    let last = -1, ok = 0;
    for (const h of hits) { const i = order.findIndex((o, k) => k > last && f.slice(h.start, h.end).replace(/\s+/g, ' ') === o); if (i >= 0) { last = i; ok++; } }
    if (ok >= 3) {
      const res = []; const pre = text.slice(0, hits[0].start).trim(); if (pre) res.push({ t: pre, inline: false });
      hits.forEach((h, i) => { const body = text.slice(h.end, i + 1 < hits.length ? hits[i + 1].start : text.length).trim(); const items = splitBullets(body); res.push({ t: text.slice(h.start, h.end) + ' :', inline: true }); items.forEach((x) => res.push({ t: x, inline: false })); });
      return { lines: res, reflowed: hits.length, noColon: true };
    }
  }
  return { lines: out, reflowed: n };
}

// Analyse : retourne { raw, preamble, blocks: [{title, level, content, match:{idx,how}|null, kind}], found }
export function parseReport(text, templateSections = []) {
  const raw = String(text || '').replace(/\r\n?/g, '\n');
  const keys = templateSections.map((s) => normTitle(s.title));
  const rf = reflow(tablesToBullets(raw).split('\n'), templateSections);
  const used = new Set();
  const blocks = []; const pre = [];
  let cur = null;
  for (const { t: ln, inline } of rf.lines) {
    const hd = headingOf(ln, keys, used);
    if (hd) {
      if (hd.match) used.add(hd.match.idx);
      cur = { title: hd.match ? templateSections[hd.match.idx].title : hd.title, detected: hd.title, match: hd.match, kind: hd.kind, inline, lines: hd.rest ? [hd.rest] : [] };
      blocks.push(cur);
    } else (cur ? cur.lines : pre).push(ln);
  }
  const out = blocks.map((b) => ({ title: b.title, detected: b.detected, level: b.match ? (templateSections[b.match.idx].level === 2 ? 2 : 1) : 1, kind: b.kind, inline: !!b.inline, match: b.match, content: cleanContent(b.lines) }));
  const topTitles = templateSections.filter((s) => s.level !== 2);
  const missing = templateSections.filter((s, i) => !out.some((b) => b.match && b.match.idx === i)).map((s) => s.title);
  return { raw, preamble: cleanContent(pre), blocks: out, found: out.filter((b) => b.match).length, reflowed: rf.reflowed, noColon: !!rf.noColon, missing, nTop: topTitles.length };
}

// Construit les rubriques du compte rendu à partir de l'analyse et du choix de l'utilisateur.
// mapping[i] : 't:<n>' (rubrique n de la trame) | 'new' (nouvelle rubrique au titre détecté) | 'prev' (à la suite de la précédente).
export function buildSections(parsed, templateSections, mapping, uid, { keepEmpty = true } = {}) {
  const tpl = templateSections || [];
  const bucket = tpl.map(() => []); const extra = []; // extra : { afterIdx, title, content }
  let lastIdx = -1, lastExtra = null;
  parsed.blocks.forEach((b, i) => {
    const m = (mapping && mapping[i]) || (b.match ? 't:' + b.match.idx : 'new');
    if (m.startsWith('t:')) {
      const n = Number(m.slice(2));
      if (bucket[n] && b.content) bucket[n].push(b.content); else if (!bucket[n]) extra.push({ afterIdx: lastIdx, title: b.title, content: b.content });
      lastIdx = n; lastExtra = null;
    } else if (m === 'prev') {
      if (lastExtra) lastExtra.content = [lastExtra.content, b.title && b.content ? b.content : b.content].filter(Boolean).join('\n');
      else if (lastIdx >= 0 && bucket[lastIdx]) bucket[lastIdx].push(b.content);
      else { lastExtra = { afterIdx: -1, title: b.title, content: b.content }; extra.push(lastExtra); }
    } else { lastExtra = { afterIdx: lastIdx, title: b.title, content: b.content, level: b.level }; extra.push(lastExtra); }
  });
  const sections = [];
  if (parsed.preamble) sections.push({ id: uid('r'), title: 'Introduction', content: parsed.preamble, level: 1 });
  extra.filter((x) => x.afterIdx === -1).forEach((x) => sections.push({ id: uid('r'), title: x.title, content: x.content, level: 1 }));
  tpl.forEach((ts, n) => {
    const content = bucket[n].join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (content || keepEmpty) sections.push({ id: uid('r'), title: ts.title, content, level: ts.level === 2 ? 2 : 1 });
    extra.filter((x) => x.afterIdx === n).forEach((x) => sections.push({ id: uid('r'), title: x.title, content: x.content, level: x.level === 2 ? 2 : 1 }));
  });
  return sections;
}
