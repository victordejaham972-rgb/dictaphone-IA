// Rétablissement LOCAL des informations pseudonymisées dans un compte rendu (« Client B » → nom d'origine).
// Module pur : aucun accès au réseau, au stockage ni à la page. Remplacements exacts uniquement (étiquette entière, mêmes majuscules) ;
// une étiquette reformulée ou modifiée n'est jamais devinée : elle est signalée et laissée telle quelle.

const SP = '[ \\u00A0\\u202F]';                                          // espace normale, insécable ou fine insécable
const rxEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const labelRx = (label) => rxEsc(label.trim()).replace(/\s+/g, SP + '+');
const BEFORE = '(?<![\\p{L}\\p{N}])', AFTER = '(?![\\p{L}\\p{N}])';

// Familles d'étiquettes produites par le moteur de pseudonymisation (pour signaler une étiquette inconnue de la fiche)
const FAMILIES = 'Client|Cliente|Personne|Entreprise|Société|Ville|Établissement|Adresse|E-mail|Téléphone|IBAN|Carte|Produit|Information masquée|Numéro de sécurité sociale|Numéro SIREN|Numéro de contrat|Plaque';
const LIKE = new RegExp(BEFORE + '(?:' + FAMILIES.replace(/ /g, SP + '+') + ')' + SP + '+[A-Z]{1,2}' + AFTER, 'gu');

// Étiquettes de personnes (Client A, Cliente B, Personne C) : jamais rétablies par défaut, seulement sur validation de l'utilisateur
const PERS_LABEL = /^(?:Client|Cliente|Personne)\s+[A-Z]{1,2}$/u;
export const isPerson = (pair) => pair[2] === 'pers';

export function cleanPairs(pairs) {
  const seen = new Set(); const out = [];
  for (const p of Array.isArray(pairs) ? pairs : []) {
    const label = Array.isArray(p) ? p[0] : p && p.label, orig = Array.isArray(p) ? p[1] : p && p.original;
    const kind = Array.isArray(p) ? p[2] : p && p.kind;
    if (typeof label !== 'string' || typeof orig !== 'string') continue;
    const l = label.trim(), o = orig.trim();
    if (!l || !o || l === o || seen.has(l)) continue;
    seen.add(l); out.push([l, o, kind === 'pers' || PERS_LABEL.test(l) && kind !== 'info' ? 'pers' : 'info']);
  }
  return out.sort((a, b) => b[0].length - a[0].length);                      // les étiquettes les plus longues d'abord
}

// text : compte rendu pseudonymisé ; pairs : [[étiquette, original], …]
// Retourne { text, restored: [{label, original, n}], total, unmatched: [étiquettes absentes], ambiguous: [textes trouvés], unknown: [étiquettes inconnues] }
// opts.known : étiquettes connues de la fiche mais volontairement non rétablies (pour ne pas les signaler comme « inconnues »)
export function applyRestore(text, pairs, opts = {}) {
  const src = String(text || '');
  const list = cleanPairs(pairs);
  const known = new Set((opts.known || []).map((l) => String(l).replace(/\s+/g, ' ')));
  const res = { text: src, restored: [], total: 0, unmatched: [], ambiguous: [], unknown: [] };
  if (!list.length) { res.unknown = findUnknown(src, known); return res; }
  const map = new Map(list.map(([l, o]) => [l.replace(/\s+/g, ' '), o]));
  const alt = list.map(([l]) => labelRx(l)).join('|');
  const rx = new RegExp(BEFORE + '(' + alt + ')' + AFTER, 'gu');
  const counts = new Map();
  res.text = src.replace(rx, (m) => {
    const key = m.replace(/[   ]+/g, ' ');
    const orig = map.get(key);
    if (orig === undefined) return m;
    counts.set(key, (counts.get(key) || 0) + 1);
    return orig;
  });
  for (const [l, o] of list) { const n = counts.get(l.replace(/\s+/g, ' ')) || 0; if (n) { res.restored.push({ label: l, original: o, n }); res.total += n; } else res.unmatched.push(l); }
  // variantes de casse (« client B », « CLIENT B ») : jamais remplacées, signalées
  const ci = new RegExp(BEFORE + '(' + alt + ')' + AFTER, 'giu');
  const exact = new Set(list.map(([l]) => l.replace(/\s+/g, ' '))); known.forEach((k) => exact.add(k));
  const amb = new Set();
  for (const m of src.matchAll(ci)) { const k = m[0].replace(/[   ]+/g, ' '); if (!exact.has(k)) amb.add(m[0]); }
  res.ambiguous = [...amb];
  res.unknown = findUnknown(src, exact);
  return res;
}

// Étiquettes qui ressemblent à des pseudonymes mais ne figurent pas dans la table de la fiche (reformulées ou venant d'ailleurs)
function findUnknown(src, exact) {
  const out = new Set();
  for (const m of src.matchAll(LIKE)) { const k = m[0].replace(/[   ]+/g, ' '); if (!exact.has(k)) out.add(m[0]); }
  return [...out];
}

// Cumule les résultats de plusieurs textes (rubriques) pour un résumé unique
export function mergeResults(list) {
  const out = { restored: new Map(), total: 0, unmatched: null, ambiguous: new Set(), unknown: new Set() };
  for (const r of list) {
    out.total += r.total;
    for (const x of r.restored) { const cur = out.restored.get(x.label) || { label: x.label, original: x.original, n: 0 }; cur.n += x.n; out.restored.set(x.label, cur); }
    r.ambiguous.forEach((a) => out.ambiguous.add(a)); r.unknown.forEach((u) => out.unknown.add(u));
  }
  const all = list.length ? list[0].unmatched.concat(list[0].restored.map((x) => x.label)) : [];
  out.unmatched = all.filter((l) => !out.restored.has(l));
  return { restored: [...out.restored.values()], total: out.total, unmatched: out.unmatched, ambiguous: [...out.ambiguous], unknown: [...out.unknown] };
}
