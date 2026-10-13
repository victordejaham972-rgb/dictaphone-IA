// Pseudonymisation locale d'une transcription. Aucune IA générative, aucun réseau : règles, contrôles de validité, dictionnaires et indices de contexte.
// Principe : le RÔLE d'un nom dans la phrase décide (employeur → masqué ; titre, assureur, gestionnaire → conservé). L'incertain est masqué et signalé.
// Ce module est isolé : aucun écran ne l'appelle encore. Il ne promet PAS une anonymisation parfaite : la relecture humaine reste obligatoire.
//
// Convention technique : les indices de contexte sont cherchés dans une copie « repliée » du texte (minuscules, sans accents, MÊME longueur),
// puis les noms propres sont lus dans le texte d'origine (initiale majuscule exigée). On n'utilise jamais l'option « i » avec \p{Lu}.
import { fold, luhnOk, ibanOk, nirOk, RX, DATE_RE, MONTHS, MONTHS_FR } from './patterns.js';
import { PRENOMS, NOT_NAME, COMMON_WORDS, ISOLATED_DENY, GEO_NAMES, CUE, REALLY_COMMON, LIFE_EVENT_LEFT, buildLexicon } from './lexicon.js';
let engineGeo = null;

const WEAK_FIN = /\b(assurances?|contrats?|fonds|placements?|epargne|versements?|rachats?|arbitrages?|rendements?|portefeuilles?|titres|actions|obligations|pea|per|scpi|livrets?|banques?|comptes?|frais|gestion|supports?|unites de compte|capitalisation|etfs?|sicav|dividendes?)\b/;
const FIN_ROLES = new Set(['assureur', 'banque', 'gestionnaire', 'fonds_produit', 'courtier_plateforme']);
const isNumTok = (t) => t.split('-').every((p) => NUMWORDS.has(p));
const MONTHS_FOLD = new Set(['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre']);
const DETERMINERS = new Set(['le', 'la', 'les', 'un', 'une', 'ce', 'cette', 'ces', 'notre', 'votre', 'mon', 'ma', 'son', 'sa', 'leur', 'du', 'des', 'au', 'aux', 'chez', 'via', 'par', 'pour', 'avec', 'sans', 'sous', 'dans']);
const RANK = { structured: 100, sheet: 90, title: 80, person: 75, employer: 70, orgform: 60, lexicon: 50, firstname: 40, extra: 30 };
const KINSHIP_F = '(?:mari|femme|epous[ea]|epoux|fils|fille|frere|s(?:oe|o)ur|pere|mere|conjoint(?:e)?|compagnon|compagne|ami(?:e)?|collegue|neveu|niece|cousin(?:e)?|beau-frere|belle-s(?:oe|o)ur|gendre|belle-fille|petit-fils|petite-fille|associe(?:e)?|voisin(?:e)?|patron(?:ne)?|comptable|notaire|avocat(?:e)?|banquier|conseiller|conseillere|medecin|gerant(?:e)?|expert-comptable|heritier|heritiere|famille)';
// Fonctions très identifiantes (généralisées en niveau Renforcé) ; les autres titres ne servent qu'à repérer « directeur DE <société> ».
const HIGH_JOB_F = "(?:directeur\\s+financier|directrice\\s+financiere|directeur\\s+general|directrice\\s+generale|president(?:e)?[-\\s]directeur\\s+general|vice-president(?:e)?|pdg|daf|drh|dsi|ceo|cfo|coo)";
const PRONOUN_STOP = new Set(['lui', 'elle', 'eux', 'nous', 'vous', 'moi', 'toi', 'un', 'une', 'son', 'sa', 'ses', 'mon', 'ma', 'mes', 'le', 'la', 'les', 'des', 'du', 'de', 'ce', 'cet', 'cette', 'ces', 'leur', 'leurs', 'notre', 'votre', 'autre', 'autres', 'quelqu', 'personne', 'eux-memes', 'plusieurs', 'differents', 'meme', 'l', 'd']);
const ANY_JOB_F = "(?:" + HIGH_JOB_F.slice(3, -1) + "|president(?:e)?|fondateur|fondatrice|directeur|directrice|gerant(?:e)?|dirigeant(?:e)?|associe(?:e)?[-\\s]gerant(?:e)?|associe(?:e)?|chef\\s+d'entreprise|responsable)";
const COMPANY_NOUNS = 'Studio|Conseil|Conseils|Consulting|Participations|Holding|Immobilier|Patrimoine|Invest|Investissement|Capital|Group|Groupe|Industries|Industrie|Transports|Transport|Menuiserie|Boulangerie|Entreprise|Finance|Gestion|Partners|Associés|Associes|Cie|Fils|Frères|Freres|Production|Productions|Services|Technologies|Solutions|Design|Agency|Labs|Ventures|Distribution|Construction|Bâtiment|Batiment|Immo|Pharma|Auto|Garage|Restaurant|Hôtel|Hotel|Cabinet|Architecture|Architectes|Avocats|Notaires|Expertise|Compagnie';
const okSeq = (seq) => seq && (!NOT_NAME.has(fold(seq.text.split(/\s+/)[0])) || seq.text.split(/\s+/).length >= 2);
const NUMWORDS = new Set(['zero', 'un', 'une', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'cent', 'quatre-vingt', 'quatre-vingts', 'et']);
const ORGFORM_UPPER = new Set(['sas', 'sarl', 'sasu', 'sci', 'sa', 'eurl']);
const CONNECTORS = /\s+(?:(?:de|du|des|la|le|von|van|&)\s+|d'|et\s+(?=(?:Fils|Fille|Filles|Associ[ée]s?|Cie|Compagnie|Fr[èe]res?|Partenaires)\b))?(?=\p{Lu})/uy;

const endsWithAny = (rxs, s) => rxs.some((r) => r.test(s));
const phon = (s) => s.replace(/ph/g, 'f').replace(/ou/g, 'u').replace(/y/g, 'i').replace(/(.)\1+/g, '$1').replace(/[sx]$/, '');   // clé phonétique grossière (Sophie ≈ Sofie)
function lev1(a, b) {                                      // distance de Levenshtein ≤ 1
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

// Lit une suite de mots capitalisés à partir de la position i (espaces éventuels ignorés). Renvoie null si le premier mot n'est pas capitalisé.
function capSeqAt(text, i, maxWords = 4, withNumber = false) {
  let p = i; while (p < text.length && /[ \t]/.test(text[p])) p++;
  const first = /\p{Lu}[\p{L}'’\-]*/uy; first.lastIndex = p;
  let m = first.exec(text); if (!m) return null;
  const start = p; let end = p + m[0].length, words = 1;
  while (words < maxWords) {
    CONNECTORS.lastIndex = end; const c = CONNECTORS.exec(text); if (!c) break;
    const w = /\p{Lu}[\p{L}'’\-]*/uy; w.lastIndex = end + c[0].length; m = w.exec(text); if (!m) break;
    end = end + c[0].length + m[0].length; words++;
  }
  if (withNumber) { const n = /\s+\d{1,2}(?![\d\p{L}])/uy; n.lastIndex = end; const nm = n.exec(text); if (nm) end += nm[0].length; }   // « Rennes 2 », « Paris 8 »
  return { start, end, text: text.slice(start, end) };
}

// Découpage en phrases (positions de fin), sans couper sur les décimales ni sur les abréviations de civilité.
function sentenceEnds(f) {
  const ends = []; const re = /[!?…\n]|\./g; let m;
  while ((m = re.exec(f))) {
    if (m[0] === '.') {
      if (/\d/.test(f[m.index - 1] || '') && /\d/.test(f[m.index + 1] || '')) continue;
      if (/(?:^|[^a-z])(?:m|mme|mlle|dr|pr|me|st|ste|cf|etc|n|no|art)$/.test(f.slice(Math.max(0, m.index - 5), m.index))) continue;
    }
    ends.push(m.index);
  }
  return ends;
}
function makeCtx(f) {
  const ends = sentenceEnds(f);
  const lower = (i) => { let lo = 0, hi = ends.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (ends[mid] < i) lo = mid + 1; else hi = mid; } return lo; };
  return (s, e) => {
    const a = lower(s), ss = a ? ends[a - 1] + 1 : 0;
    const b = lower(e), se = b < ends.length ? ends[b] : f.length;
    return { left: f.slice(Math.max(ss, s - 110), s), right: f.slice(e, Math.min(se, e + 80)), sentence: f.slice(ss, se) };
  };
}

export const DEFAULT_OPTIONS = { level: 'renforce', sheet: {}, lexicon: null, alwaysMask: [], neverMask: [], extraFirstNames: [] };

// sheet = { persons:[{name, role:'client'|'conjoint'|'proche'|'tiers', gender:'F'|'M'|''}], employers:[], companies:[], cities:[], addresses:[], others:[] }
export function protect(text, options = {}) {
  const o = { ...DEFAULT_OPTIONS, ...options };
  const renf = o.level === 'renforce';
  const f = fold(text);
  const ctxOf = makeCtx(f);
  const lex = o.lexicon && o.lexicon.aliasMap ? o.lexicon : (o.lexicon ? buildLexicon(o.lexicon) : { entries: [], aliasMap: new Map(), rx: null });
  const sheet = o.sheet || {};
  const first = new Set([...PRENOMS, ...(o.extraFirstNames || []).map((s) => fold(s))]);
  const cands = [];
  const add = (c) => cands.push({ certainty: 'sure', decision: 'mask', ...c });
  const isUpper = (i) => /\p{Lu}/u.test(text[i] || '');
  const fmatches = (rx) => f.matchAll(new RegExp(rx, 'g'));                        // recherche dans le texte replié

  // ---------- 1. Identifiants structurés ----------
  for (const m of text.matchAll(RX.email)) add({ start: m.index, end: m.index + m[0].length, cat: 'EMAIL', reason: 'adresse e-mail', rank: RANK.structured });
  for (const m of text.matchAll(RX.phone)) add({ start: m.index, end: m.index + m[0].length, cat: 'TELEPHONE', reason: 'numéro de téléphone', rank: RANK.structured });
  for (const m of text.matchAll(RX.iban)) {
    const ok = ibanOk(m[0]);
    if (ok || /^FR\d{2}/.test(m[0])) add({ start: m.index, end: m.index + m[0].length, cat: 'IBAN', reason: ok ? 'IBAN valide' : 'IBAN (clé invalide : à vérifier)', certainty: ok ? 'sure' : 'maybe', rank: RANK.structured });
  }
  for (const m of text.matchAll(RX.nir)) if (nirOk(m[0])) add({ start: m.index, end: m.index + m[0].length, cat: 'NIR', reason: 'numéro de sécurité sociale valide', rank: RANK.structured });
  for (const m of text.matchAll(RX.card)) {
    const d = m[0].replace(/[\s-]/g, '');
    if (d.length >= 13 && d.length <= 19 && luhnOk(d)) add({ start: m.index, end: m.index + m[0].length, cat: 'CARTE', reason: 'numéro de carte valide', rank: RANK.structured });
  }
  for (const m of text.matchAll(RX.siren)) {
    const d = m[0].replace(/\s/g, ''); const cx = ctxOf(m.index, m.index + m[0].length);
    if ((d.length === 9 || d.length === 14) && luhnOk(d) && /(siren|siret|immatricul|rcs)/.test(cx.left.slice(-40))) add({ start: m.index, end: m.index + m[0].length, cat: 'SIREN', reason: 'numéro SIREN/SIRET', rank: RANK.structured });
  }
  for (const m of text.matchAll(RX.plaque)) add({ start: m.index, end: m.index + m[0].length, cat: 'PLAQUE', reason: "plaque d'immatriculation", rank: RANK.structured });
  for (const m of f.matchAll(/\b(?:contrat|police|dossier|reference|numero|n°|compte)(?:\s+[a-z']{1,12}){0,7}?\s*[:=]?\s+([a-z]{0,4}[-\/ ]?\d[\d\-\/ ]{3,20}\d)/g)) {
    const s = m.index + m[0].length - m[1].length; const val = text.slice(s, s + m[1].length);
    const digits = (val.match(/\d/g) || []).length;
    if (digits < 5) continue;
    if (/^(?:\+?33\s?|0)[1-9](?:[\s.\-]?\d{2}){4}$/.test(val.trim())) continue;        // un numéro de téléphone n'est pas un numéro de contrat
    if (/^\d{1,3}(?:\s\d{3})+\s*$/.test(val.trim())) continue;                         // « 240 000 » est un montant, pas un numéro
    if (/^(?:(?:19|20)\d{2}[\s\/.\-]*)+$/.test(val.trim())) continue;                  // années
    if (!/^[a-z]/.test(f.slice(s, s + 1)) && digits < 6) continue;                      // sans préfixe de lettres : au moins 6 chiffres
    if (/^\s*(?:euros?|€|%|pour cent)/.test(f.slice(s + val.length, s + val.length + 12))) continue;   // c'est un montant
    add({ start: s, end: s + val.trimEnd().length, cat: 'CONTRAT', reason: 'numéro de contrat ou de compte', rank: RANK.structured });
  }
  // numéro de téléphone dicté en toutes lettres (« zéro six douze trente-quatre… ») : toujours « à vérifier »
  { const tokRe = /[a-z\-]+/g; const toks = [...f.matchAll(tokRe)];
    for (let i = 0; i < toks.length; i++) {
      if (toks[i][0] !== 'zero') continue;
      let j = i, n = 0; while (j < toks.length && isNumTok(toks[j][0]) && toks[j + 1] !== undefined && toks[j + 1].index - (toks[j].index + toks[j][0].length) <= 2) { if (toks[j][0] !== 'et') n++; j++; }
      if (j < toks.length && isNumTok(toks[j][0])) { if (toks[j][0] !== 'et') n++; j++; }
      // un numéro français dicté compte « zéro six » + quatre paires : au moins 6 mots-nombres, le premier chiffre étant 1 à 9
      const secondOk = toks[i + 1] !== undefined && /^(?:un|deux|trois|quatre|cinq|six|sept|huit|neuf)$/.test(toks[i + 1][0]);
      if (n >= 7 || (n >= 6 && secondOk)) { add({ start: toks[i].index, end: toks[j - 1].index + toks[j - 1][0].length, cat: 'TELEPHONE', certainty: 'maybe', reason: 'suite de nombres dictés : numéro de téléphone possible', rank: RANK.structured - 20 }); i = j; }
    } }
  // date dictée en toutes lettres (« le quatorze février mille neuf cent soixante-huit ») : naissance ou événement de vie
  { const toks = [...f.matchAll(/[a-z0-9\-]+/g)];
    const gap = (a, b) => b.index - (a.index + a[0].length) <= 2;
    for (let i = 0; i < toks.length; i++) {
      if (!MONTHS_FOLD.has(toks[i][0])) continue;
      let a = i; while (a > 0 && i - a < 3 && (isNumTok(toks[a - 1][0]) || toks[a - 1][0] === 'premier') && gap(toks[a - 1], toks[a])) a--;
      if (a === i || (toks[a][0] === 'et')) continue;
      let e = i; while (e + 1 < toks.length && e - i < 9 && (isNumTok(toks[e + 1][0]) || toks[e + 1][0] === 'mille' || /^(?:19|20)\d{2}$/.test(toks[e + 1][0])) && gap(toks[e], toks[e + 1])) e++;
      if (e === i) continue;                                                     // jour et mois seuls : pas d'année, pas un identifiant
      const s = toks[a].index, en = toks[e].index + toks[e][0].length;
      const left = f.slice(Math.max(0, s - 60), s);
      if (/(?:nee?\s+(?:le\s+)?|date\s+de\s+naissance\b[^.;!?]{0,30})$/.test(left)) add({ start: s, end: en, cat: 'NAISSANCE', decision: 'generalize', replacement: '[date de naissance]', reason: 'date de naissance dictée en toutes lettres', rank: RANK.structured - 8 });
      else if (renf && LIFE_EVENT_LEFT.test(left.slice(-60))) add({ start: s, end: en, cat: 'DATE_VIE', decision: 'generalize', certainty: 'maybe', replacement: '[date]', reason: "date d'un événement de vie dictée en toutes lettres", rank: RANK.extra });
      i = e;
    } }
  for (const m of text.matchAll(RX.address)) add({ start: m.index, end: m.index + m[0].length, cat: 'ADRESSE', reason: 'adresse postale', rank: RANK.structured - 5 });
  for (const m of text.matchAll(RX.postalCity)) {
    const cx = ctxOf(m.index, m.index + m[0].length);
    if (!/(euros?|€|%)\s*$/.test(cx.left.slice(-8))) add({ start: m.index, end: m.index + m[0].length, cat: 'ADRESSE', reason: 'code postal et commune', rank: RANK.structured - 10 });
  }
  for (const m of text.matchAll(new RegExp(DATE_RE, 'giu'))) {
    const cx = ctxOf(m.index, m.index + m[0].length);
    const isFull = /^\d{1,2}(?:er)?\s+[a-zéûô]+\s+\d{4}$/i.test(m[0]) || /^\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}$/.test(m[0]);     // une date avec jour ; « mars 2012 » est déjà généralisé
    if (isFull && /(?:nee?\s+le|date\s+de\s+naissance(?:\s+(?:est|:))?(?:\s+le)?)\s*$/.test(cx.left.slice(-45))) {
      const y = (m[0].match(/(?:19|20)\d{2}/) || [''])[0];
      const art = /\ble\s+$/.exec(f.slice(Math.max(0, m.index - 4), m.index));                 // « né le 4 avril 1971 » → « né en 1971 »
      add({ start: m.index - (art ? art[0].length : 0), end: m.index + m[0].length, cat: 'NAISSANCE', decision: 'generalize', replacement: y ? 'en ' + y : '[date de naissance]', reason: 'date de naissance précise', rank: RANK.structured });
    } else if (renf && isFull && LIFE_EVENT_LEFT.test(cx.left.slice(-60))) {
      const mo = fold(m[0]).match(new RegExp(MONTHS.join('|'))); const y = (m[0].match(/(?:19|20)\d{2}/) || [''])[0];
      const art = /\ble\s+$/.exec(f.slice(Math.max(0, m.index - 4), m.index));
      add({ start: m.index - (art ? art[0].length : 0), end: m.index + m[0].length, cat: 'DATE_VIE', decision: 'generalize', replacement: mo && y ? `en ${MONTHS_FR[MONTHS.indexOf(mo[0])]} ${y}` : (y ? 'en ' + y : '[date]'), reason: "date précise d'un événement de vie", rank: RANK.extra });
    }
  }

  // ---------- 2. Fiche d'identité du client ----------
  const sheetPersons = (sheet.persons || []).filter((p) => p && p.name);
  const sheetEntries = [];
  for (const p of sheetPersons) {
    const toks = p.name.trim().split(/\s+/);
    const variants = new Set([p.name.trim()]);
    if (toks.length > 1) { variants.add(toks[0]); variants.add(toks[toks.length - 1]); variants.add(toks.slice(1).join(' ') + ' ' + toks[0]); }
    for (const v of variants) if (v.length >= 3) sheetEntries.push({ v, kind: 'person', p });
  }
  for (const v of sheet.employers || []) if (v && v.trim().length >= 2) sheetEntries.push({ v: v.trim(), kind: 'employer' });
  for (const v of sheet.companies || []) if (v && v.trim().length >= 2) sheetEntries.push({ v: v.trim(), kind: 'company' });
  for (const v of sheet.cities || []) if (v && v.trim().length >= 2) sheetEntries.push({ v: v.trim(), kind: 'city' });
  for (const v of sheet.addresses || []) if (v && v.trim().length >= 4) sheetEntries.push({ v: v.trim(), kind: 'address' });
  for (const v of [...(o.alwaysMask || []), ...(sheet.others || [])]) if (v && v.trim().length >= 2) sheetEntries.push({ v: v.trim(), kind: 'other' });
  const escRx = (s) => fold(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  sheetEntries.sort((a, b) => b.v.length - a.v.length);
  for (const e of sheetEntries) {
    const rx = new RegExp('(?<![\\p{L}\\p{N}])' + escRx(e.v) + '(?![\\p{L}\\p{N}])', 'gu');
    for (const m of f.matchAll(rx)) {
      const s = m.index, en = s + m[0].length;
      const cx = ctxOf(s, en);
      if (e.kind === 'person' && !/\s/.test(e.v.trim()) && isUpper(s)) {
        // nom du client dans le nom d'une entreprise (« Perrot Studio », « Transports Lopez ») : société du client
        const after = new RegExp('^\\s+(' + COMPANY_NOUNS + ')(?![\\p{L}])', 'iu').exec(text.slice(en));
        const winStart = Math.max(0, s - 24);
        const before = new RegExp('(?<![\\p{L}])(' + COMPANY_NOUNS + ')\\s+$', 'iu').exec(text.slice(winStart, s));
        if (after && /^\p{Lu}/u.test(after[1])) add({ start: s, end: en + after[0].length, cat: 'SOCIETE', reason: 'société portant le nom du client', rank: RANK.sheet + 1, key: fold(text.slice(s, en + after[0].length)) });
        else if (before && /^\p{Lu}/u.test(before[1])) { const bs = winStart + before.index; add({ start: bs, end: en, cat: 'SOCIETE', reason: 'société portant le nom du client', rank: RANK.sheet + 1, key: fold(text.slice(bs, en)) }); }
      }
      if (e.kind === 'person') {
        const single = !/\s/.test(e.v.trim());
        if (single && !isUpper(s)) {                                            // « petit », « blanc » : mots courants ; sinon variante en minuscules à vérifier
          const civLeft = /(?:^|\s)(?:m\.?|mme|mlle|madame|monsieur|mademoiselle)\s+$/.test(cx.left);
          if (COMMON_WORDS.has(fold(e.v)) && !civLeft) continue;
          add({ start: s, end: en, cat: 'PERSONNE', certainty: 'maybe', reason: 'nom de la fiche client écrit en minuscules', rank: RANK.sheet - 5, person: e.p, key: fold(e.p.name) });
        } else add({ start: s, end: en, cat: 'PERSONNE', reason: 'nom de la fiche client', rank: RANK.sheet, person: e.p, key: fold(e.p.name) });
      }
      else if (e.kind === 'employer') {
        const emp = endsWithAny(CUE.employerLeft, cx.left) || endsWithAny(CUE.employerRight, cx.right);
        const fin = endsWithAny(CUE.financeLeft, cx.left) || endsWithAny(CUE.financeRight, cx.right);
        if (fin && !emp && renf) add({ start: s, end: en, cat: 'EMPLOYEUR', certainty: 'maybe', reason: "titre ou produit du même nom que l'employeur du client : peut révéler l'employeur (niveau Renforcé)", rank: RANK.sheet, key: fold(e.v) });
        else if (fin && !emp) add({ start: s, end: en, cat: 'ETABLISSEMENT', decision: 'keep', certainty: 'info', reason: "titre ou produit du même nom que l'employeur du client (conservé en niveau Standard)", rank: RANK.sheet, key: fold(e.v) });
        else add({ start: s, end: en, cat: 'EMPLOYEUR', reason: 'employeur de la fiche client', rank: RANK.sheet, key: fold(e.v) });
      } else if (e.kind === 'company') add({ start: s, end: en, cat: 'SOCIETE', reason: 'société du client (fiche)', rank: RANK.sheet, key: fold(e.v) });
      else if (e.kind === 'city') { if (renf) add({ start: s, end: en, cat: 'VILLE', reason: 'commune de la fiche client', rank: RANK.sheet, key: fold(e.v) }); }
      else if (e.kind === 'address') add({ start: s, end: en, cat: 'ADRESSE', reason: 'adresse de la fiche client', rank: RANK.sheet, key: fold(e.v) });
      else add({ start: s, end: en, cat: 'AUTRE', reason: 'terme à toujours masquer', rank: RANK.sheet, key: fold(e.v) });
    }
  }
  // variantes proches d'un nom de la fiche (faute de transcription) : toujours « à vérifier »
  const nameToks = new Map();
  for (const p of sheetPersons) for (const t of p.name.trim().split(/\s+/)) if (t.length >= 6) nameToks.set(fold(t), p);
  if (nameToks.size) for (const m of text.matchAll(/\p{Lu}[\p{L}'’\-]+/gu)) {
    const t = fold(m[0]); if (nameToks.has(t)) continue;
    if (NOT_NAME.has(t) || ISOLATED_DENY.has(t) || t.length < 5) continue;
    for (const [nt, p] of nameToks) if (t[0] === nt[0] && (phon(t) === phon(nt) && t.length >= 5 || (t.length >= 7 && lev1(t, nt)))) { add({ start: m.index, end: m.index + m[0].length, cat: 'PERSONNE', certainty: 'maybe', reason: 'orthographe proche du nom de la fiche client', rank: RANK.sheet - 5, person: p, key: fold(p.name) }); break; }
  }

  const sheetTokens = new Set();
  for (const p of sheetPersons) for (const t of p.name.trim().split(/\s+/)) if (t.length >= 3) sheetTokens.add(fold(t));

  // ---------- 3. Personnes ----------
  for (const m of fmatches('(?<![a-z])(m\\.|mme|mlle|monsieur|madame|mademoiselle|maitre|me|docteur|dr|professeur|pr)\\s+')) {
    const t0 = text.slice(m.index, m.index + m[1].length);
    if (/^(?:me|dr|pr|m\.)$/.test(m[1]) && !/^\p{Lu}/u.test(t0)) continue;           // « me » pronom, « dr » : initiale majuscule exigée
    const seq = capSeqAt(text, m.index + m[0].length, 3);
    if (!seq) {                                                                        // « madame duval » en minuscules : seulement si c'est un nom de la fiche
      const w = /^([a-zà-ÿ][a-zà-ÿ'’\-]{2,})/.exec(text.slice(m.index + m[0].length));
      if (w && sheetTokens.has(fold(w[1]))) add({ start: m.index, end: m.index + m[0].length + w[1].length, cat: 'PERSONNE', certainty: 'maybe', confirmed: true, reason: 'civilité + nom de la fiche client écrit en minuscules', rank: RANK.title });
      continue;
    }
    if (NOT_NAME.has(fold(seq.text.split(/\s+/)[0]))) continue;
    add({ start: m.index, end: seq.end, cat: 'PERSONNE', confirmed: true, reason: 'civilité + nom', rank: RANK.title });
  }
  for (const m of text.matchAll(/(?<![\p{L}])(\p{Lu}[\p{L}'’\-]+)\s+((?:(?:de la|de|du|des|le|la|d')\s*)?\p{Lu}[\p{L}'’\-]+)/gu)) {
    const fn = fold(m[1]); const lastWord = m[2].split(/\s+/).pop(); const ln = fold(lastWord);
    if (!first.has(fn) || NOT_NAME.has(ln) || NOT_NAME.has(fold(m[2].split(/\s+/)[0]))) continue;
    add({ start: m.index, end: m.index + m[0].length, cat: 'PERSONNE', reason: 'prénom + nom', rank: RANK.person });
  }
  for (const m of fmatches(`\\b(?:mon|ma|mes|son|sa|ses|notre|nos|votre|vos|leur|leurs)\\s+${KINSHIP_F}(?:\\s+(?:s'appelle|se nomme|prenomme\\w*|nomme\\w*|appele\\w*))?(?:\\s*,)?[ \\t]+`)) {
    const seq = capSeqAt(text, m.index + m[0].length, 3);
    if (!seq) {                                                                        // transcription bruitée : « son mari thierry »
      const w = /^([a-zà-ÿ][a-zà-ÿ'’\-]{2,})/.exec(text.slice(m.index + m[0].length));
      if (w && first.has(fold(w[1])) && !COMMON_WORDS.has(fold(w[1])) && !NOT_NAME.has(fold(w[1])) && !PRONOUN_STOP.has(fold(w[1])))
        add({ start: m.index + m[0].length, end: m.index + m[0].length + w[1].length, cat: 'PERSONNE', certainty: 'maybe', reason: "prénom d'un proche écrit en minuscules (transcription bruitée)", rank: RANK.firstname + 8 });
      continue;
    }
    const fw0 = fold(seq.text.split(/\s+/)[0]);
    const common = NOT_NAME.has(fw0);
    // « votre associé, Blanc » : après un lien de parenté ou de fonction, un mot courant à majuscule reste un nom (à vérifier)
    if (common && (PRONOUN_STOP.has(fw0) || DETERMINERS.has(fw0) || lex.aliasMap.has(fold(seq.text)) || MONTHS_FOLD.has(fw0))) continue;
    add({ start: seq.start, end: seq.end, cat: 'PERSONNE', certainty: common ? 'maybe' : 'sure', confirmed: true, reason: "nom d'un proche ou d'un tiers (lien de parenté ou de fonction)", rank: RANK.person });
  }
  // « la famille Lambert », « le dossier Rousseau », « le couple Martin »
  for (const m of fmatches("\\b(?:famille|couple|menage|foyer|dossier)\\s+(?:de\\s+|du\\s+|d')?(?:monsieur\\s+|madame\\s+|mme\\s+)?")) {
    const seq = capSeqAt(text, m.index + m[0].length, 2);
    if (!seq || NOT_NAME.has(fold(seq.text.split(/\s+/)[0]))) continue;
    if (lex.aliasMap.has(fold(seq.text))) continue;                                  // « dossier Generali » : établissement, pas une famille
    add({ start: seq.start, end: seq.end, cat: 'PERSONNE', reason: 'nom de famille introduit par « famille / dossier / couple »', rank: RANK.person });
  }
  // « vos enfants Léa et Hugo », « ses neveux Paul, Lucas et Emma »
  for (const m of fmatches("\\b(?:vos|mes|ses|nos|leurs)\\s+(?:(?:deux|trois|quatre|cinq|six|\\d+)\\s+)?(?:enfants|petits-enfants|filles|fils|neveux|nieces|freres|soeurs|cousins|cousines|parents|grands-parents)(?:\\s*,)?[ \\t]+")) {
    let p = m.index + m[0].length;
    for (let k = 0; k < 4; k++) {
      const seq = capSeqAt(text, p, 1); if (!seq || NOT_NAME.has(fold(seq.text))) break;
      add({ start: seq.start, end: seq.end, cat: 'PERSONNE', reason: "prénom d'un proche (liste d'enfants ou de proches)", rank: RANK.person });
      const sep = /^\s*(?:,|\bet\b)\s*/.exec(text.slice(seq.end)); if (!sep) break; p = seq.end + sep[0].length;
    }
  }
  for (const m of fmatches("\\b(?:s'appelle|se nomme|prenomme\\w*|nomme\\w*|appele\\w*)[ \\t]+")) {
    const seq = capSeqAt(text, m.index + m[0].length, 3);
    if (!seq || NOT_NAME.has(fold(seq.text.split(/\s+/)[0]))) continue;
    add({ start: seq.start, end: seq.end, cat: 'PERSONNE', reason: "nom introduit par « s'appelle »", rank: RANK.person });
  }
  for (const m of text.matchAll(/(?<![\p{L}'’\-])(\p{Lu}[\p{L}'’\-]+)(?![\p{L}'’\-])/gu)) {
    const w = fold(m[1]); if (NOT_NAME.has(w) || ISOLATED_DENY.has(w)) continue;
    if (m[1].length <= 5 && m[1] === m[1].toUpperCase() && m[1].length > 1) continue;      // sigles (IBAN, BIC, PEA…) : pas des prénoms
    if (!first.has(w) && !(w.includes('-') && w.split('-').every((p) => first.has(p)))) continue;     // « Marie-Claire »
    add({ start: m.index, end: m.index + m[0].length, cat: 'PERSONNE', certainty: 'maybe', reason: 'prénom isolé (liste de prénoms courants)', rank: RANK.firstname });
  }
  // « vous détenez aussi Bati Concept, non cotée » : verbe de détention ou de direction suivi directement d'un nom propre inconnu = société du client (à vérifier)
  for (const m of fmatches("\\b(?:deten\\w+|detien\\w+|possed\\w+|dirig\\w+|fond\\w+|creez|cree\\w*|rachet\\w+|achet\\w+\\s+(?:la\\s+societe|l'entreprise))\\s+(?:aussi\\s+|egalement\\s+|encore\\s+|maintenant\\s+)?(?:la\\s+|le\\s+|l')?")) {
    const seq = capSeqAt(text, m.index + m[0].length, 3);
    if (!seq || seq.text.length < 4 || !okSeq(seq)) continue;
    const fs = fold(seq.text);
    if (lex.aliasMap.has(fs) || first.has(fs) || PRONOUN_STOP.has(fs) || COMMON_WORDS.has(fs)) continue;
    { let known = false; for (const k of lex.aliasMap.keys()) if (fs === k || fs.startsWith(k + ' ')) { known = true; break; } if (known) continue; }   // « Amundi Actions Monde » : fonds connu, pas une société du client
    if (!/^\s*(?:,|\.|\s+(?:non\s+cotee|sas|sarl|eurl|sci|a\s+\d|dont|qui|avec|et\b))/.test(f.slice(seq.end, seq.end + 20)) && !/\p{Lu}/u.test(seq.text.slice(1))) continue;
    add({ start: seq.start, end: seq.end, cat: 'SOCIETE', certainty: 'maybe', reason: 'société détenue ou dirigée par le client (verbe de détention) : à vérifier', rank: RANK.orgform - 5, key: fs });
  }
  // « Rose, ma sœur, … », « Delcourt est mon associé » : un nom suivi d'un lien de parenté ou de fonction est une personne,
  // même si c'est aussi un mot courant (Rose, Blanc, Lebon)
  for (const m of fmatches(`(?:\\s*,\\s*|\\s+est\\s+)(?:mon|ma|mes|son|sa|ses|notre|nos|votre|vos|leur|leurs)\\s+${KINSHIP_F}\\b`)) {
    const w = /(\p{Lu}[\p{L}'’\-]+)$/u.exec(text.slice(Math.max(0, m.index - 40), m.index)); if (!w) continue;
    const ws = m.index - w[1].length, fw = fold(w[1]);
    const initial = /(?:^|[.!?…\n])\s*$/.test(f.slice(Math.max(0, ws - 3), ws));
    if (PRONOUN_STOP.has(fw) || lex.aliasMap.has(fw)) continue;
    if (!(first.has(fw) || (!initial && !NOT_NAME.has(fw) && !COMMON_WORDS.has(fw)))) continue;
    add({ start: ws, end: m.index, cat: 'PERSONNE', reason: 'nom suivi d\'un lien de parenté ou de fonction', rank: RANK.person });
  }
  // « c'est Delcourt qui détient… » : nom propre inconnu désigné comme sujet
  for (const m of fmatches("\\bc'est\\s+")) {
    const seq = capSeqAt(text, m.index + m[0].length, 2);
    if (!seq || !/^\s+(?:qui|que)\b/.test(f.slice(seq.end, seq.end + 8))) continue;
    const fw = fold(seq.text.split(/\s+/)[0]);
    if (NOT_NAME.has(fw) || ISOLATED_DENY.has(fw) || COMMON_WORDS.has(fw) || PRONOUN_STOP.has(fw) || lex.aliasMap.has(fold(seq.text))) continue;
    add({ start: seq.start, end: seq.end, cat: 'PERSONNE', certainty: 'maybe', reason: 'nom propre désigné comme sujet (« c\'est … qui »)', rank: RANK.extra });
  }

  // ---------- 4. Entreprises : le rôle dans la phrase décide ----------
  // Au moins deux établissements financiers distincts dans la même phrase = énumération de produits ou d'acteurs, pas d'employeur.
  const finList = (sentence) => {
    if (!lex.rx) return false;
    const keys = new Set();
    for (const mm of sentence.matchAll(lex.rx)) { const e2 = lex.aliasMap.get(mm[0].replace(/\s+/g, ' ').trim()); if (e2 && FIN_ROLES.has(e2.role)) keys.add(e2.name); }
    return keys.size >= 2;
  };
  if (lex.rx) for (const m of f.matchAll(lex.rx)) {
    const s = m.index, en = s + m[0].length;
    const entry = lex.aliasMap.get(m[0].replace(/\s+/g, ' ').trim());
    if (!entry) continue;
    const cx = ctxOf(s, en);
    // « mon conseiller chez LCL » : l'établissement de l'interlocuteur financier, pas l'employeur du client
    // seulement si c'est LE conseiller du client (possessif) : « mon conseiller chez LCL » ; « il est conseiller chez LCL » est son métier (employeur)
    const advisor = /(?:\b(?:mon|ma|mes|notre|nos|votre|vos|son|sa|ses|leur|leurs)\s+(?:nouveau\s+|ancien\s+|ex-)?)(?:conseill\w+|banquier|charge\w*\s+de\s+clientele|gestionnaire|courtier|interlocuteu\w+|agent)\s+(?:chez|a|de\s+la|de\s+l'|du)\s*(?:la\s+|le\s+|l')?$/.test(cx.left);
    // « est juriste chez Amundi », « êtes responsable à la BNP » : un métier suivi de « chez » = employeur (et non un produit placé chez)
    const jm = /\b(?:est|etes|suis|sont|etait|etais|devient|reste)\s+((?:(?:un|une|le|la|l')\s*)?(?:[a-z\-]+\s+){0,4}?)(?:chez|a la|a l'|au|aux|pour)\s*(?:la\s+|le\s+|l')?$/.exec(cx.left);
    const jobChez = !!jm && jm[1].trim().length > 2 && !/\b(?:ouvert\w*|place\w*|souscrit\w*|domicili\w*|detenu\w*|gere\w*|investi\w*|loge\w*|heberge\w*|depose\w*|verse\w*|compte|contrat|assurance|placement|epargne|pea|livret|per|fonds|actions?)\b/.test(jm[1]);
    // « son mari est chez Michelin », « il est chez Vinci » : sujet = une personne (jamais « mon compte est chez Boursorama »)
    const estChez = /\b(?:est|etait|sera|reste|bosse|travaille)\s+chez\s+$/.test(cx.left) && (
      /\b(?:il|elle|mari|femme|epou[sx]e?|fils|fille|frere|soeur|pere|mere|conjoint(?:e)?|compagn(?:on|e)|collegue|associe(?:e)?|voisin(?:e)?|ami(?:e)?|moi|je)\s+(?:est|etait|sera|reste|bosse|travaille)\s+chez\s+$/.test(cx.left)
      || /\p{Lu}[\p{L}'’\-]+\s+(?:est|etait|sera|reste|bosse|travaille)\s+chez\s+$/u.test(text.slice(Math.max(0, s - cx.left.length), s))
      || (() => { const w = /([a-z'’\-]{3,})\s+(?:est|etait|sera|reste|bosse|travaille)\s+chez\s+$/.exec(cx.left); return !!w && first.has(w[1]); })())
      && (entry.employerFrequent || !FIN_ROLES.has(entry.role));        // un établissement purement financier n'est pas un employeur : « il est chez Natixis » = le plan
    const emp = !advisor && (estChez || jobChez || endsWithAny(CUE.employerLeft, cx.left) || endsWithAny(CUE.employerRight, cx.right));
    const fin = advisor || endsWithAny(CUE.financeLeft, cx.left) || endsWithAny(CUE.financeRight, cx.right);
    const own = endsWithAny(CUE.ownCompanyLeft, cx.left);
    const key = fold(entry.name);
    const upper = isUpper(s) || /^[A-Z0-9&]+$/.test(text.slice(s, en));
    if (!upper && !emp && !fin && !own) continue;                                   // sans majuscule, seul un indice fort fait retenir le nom (transcription bruitée)
    const sentenceInitial = /^\s*$/.test(cx.left);
    if (REALLY_COMMON.has(key) && !emp && !fin && !own && (!upper || sentenceInitial)) continue;   // « Total des frais », « orange » : mot courant sans indice
    if (entry.role === 'fonds_produit') { add({ start: s, end: en, cat: 'PRODUIT', decision: 'keep', reason: 'produit ou indice financier', rank: RANK.lexicon, silent: true }); continue; }
    if (own) add({ start: s, end: en, cat: 'SOCIETE', reason: 'société du client (« ma société … »)', rank: RANK.employer, key });
    else if (emp) add({ start: s, end: en, cat: 'EMPLOYEUR', reason: "indice d'employeur dans la phrase", rank: RANK.employer, key });
    else if (fin) add({ start: s, end: en, cat: 'ETABLISSEMENT', decision: 'keep', reason: 'indice financier dans la phrase (titre, contrat, fonds…)', rank: RANK.lexicon, key });
    else if (WEAK_FIN.test(cx.sentence)) add({ start: s, end: en, cat: 'ETABLISSEMENT', decision: 'keep', certainty: 'info', reason: 'contexte financier dans la phrase, rôle non précisé', rank: RANK.lexicon, key });
    else if (entry.employerFrequent && finList(cx.sentence)) add({ start: s, end: en, cat: 'ETABLISSEMENT', decision: 'keep', certainty: 'info', reason: 'énumération d\'établissements financiers dans la phrase', rank: RANK.lexicon, key });
    else if (entry.employerFrequent) add({ start: s, end: en, cat: 'EMPLOYEUR', certainty: 'maybe', reason: "entreprise pouvant être l'employeur : rôle non précisé", rank: RANK.lexicon, key });
    else add({ start: s, end: en, cat: 'ETABLISSEMENT', decision: 'keep', certainty: 'info', reason: 'établissement financier, rôle non précisé', rank: RANK.lexicon, key });
  }
  // employeur introduit par un indice, même inconnu du dictionnaire
  for (const m of fmatches("(?:travaill\\w*|bosse\\w*|salari\\w*|employ\\w*|ingenieu\\w*|cadre|embauch\\w*|recrut\\w*|stagiaire|licenci\\w*)\\b[^.;:!?]{0,40}?\\b(?:chez|pour|par|au sein de|au sein d'|au sein du)\\s+(?:la\\s+|le\\s+|l')?(?:societe\\s+|entreprise\\s+|groupe\\s+)?")) {
    const seq = capSeqAt(text, m.index + m[0].length, 4);
    if (seq && okSeq(seq)) { add({ start: seq.start, end: seq.end, cat: 'EMPLOYEUR', reason: "indice d'employeur dans la phrase", rank: RANK.employer, key: fold(seq.text) }); continue; }
    // transcription bruitée : le nom propre est écrit en minuscules (« elle bosse chez decathlon ») → à vérifier
    const w = /^[ \t]*([a-zà-ÿ][a-zà-ÿ0-9'’\-]{2,})/.exec(text.slice(m.index + m[0].length));
    if (w && !PRONOUN_STOP.has(fold(w[1])) && !NOT_NAME.has(fold(w[1]))) {
      const s = m.index + m[0].length + w[0].length - w[1].length;
      add({ start: s, end: s + w[1].length, cat: 'EMPLOYEUR', certainty: 'maybe', reason: "employeur probable écrit en minuscules (transcription bruitée)", rank: RANK.employer - 5, key: fold(w[1]) });
    }
  }
  // « retraité de la SNCF », « ancien salarié d'EDF », « ex-employé de … »
  for (const m of fmatches("(?:retrait\\w*|ancien(?:ne)?s?\\s+(?:salarie|employe|cadre|agent|collaborat)\\w*|ex[- ](?:salarie|employe|cadre|agent)\\w*)\\s+(?:de|du|d'|des|chez)\\s*(?:la\\s+|le\\s+|l')?")) {
    const seq = capSeqAt(text, m.index + m[0].length, 4);
    if (!okSeq(seq)) continue;
    // « la retraite de Bernard » (nom commun, sans accent) : le prénom qui suit est le titulaire, pas un ancien employeur
    if (/^retraites?\b/i.test(text.slice(m.index, m.index + m[0].length)) && first.has(fold(seq.text))) continue;
    add({ start: seq.start, end: seq.end, cat: 'EMPLOYEUR', reason: "ancien employeur (« retraité de … »)", rank: RANK.employer, key: fold(seq.text) });
  }
  for (const m of fmatches("\\b(?:mon|son|sa|notre|leur)\\s+(?:employeur|entreprise|societe|boite)\\s*(?:actuel(?:le)?\\s*)?(?:est|c'est|s'appelle|:|,)\\s+(?:la\\s+|le\\s+|l')?")) {
    const seq = capSeqAt(text, m.index + m[0].length, 4);
    if (!seq || NOT_NAME.has(fold(seq.text.split(/\s+/)[0]))) continue;
    add({ start: seq.start, end: seq.end, cat: 'EMPLOYEUR', reason: '« son employeur est … »', rank: RANK.employer, key: fold(seq.text) });
  }
  for (const m of fmatches(`\\b${ANY_JOB_F}\\s+(?:de|du|d'|des|chez)\\s*(?:la\\s+|le\\s+|l')?(?:societe\\s+|groupe\\s+)?`)) {
    const seq = capSeqAt(text, m.index + m[0].length, 4);
    if (!okSeq(seq)) continue;
    add({ start: seq.start, end: seq.end, cat: 'SOCIETE', reason: 'société dirigée ou détenue (fonction + nom)', rank: RANK.employer, key: fold(seq.text) });
  }
  for (const m of fmatches("\\b(societe|sas|sarl|sasu|sci|sa|eurl|holding|cabinet|groupe|laboratoires?|association|fondation|clinique|hopital|entreprise(?:\\s+familiale)?|maison|etablissements|ets|agence|boutique|magasin|etude(?:\\s+notariale)?|office\\s+notarial|gaec|earl)\\s*[,:]?\\s+(?:de\\s+|du\\s+|d'|des\\s+)?")) {
    if (ORGFORM_UPPER.has(m[1]) && text.slice(m.index, m.index + m[1].length) !== m[1].toUpperCase()) continue;
    const seq = capSeqAt(text, m.index + m[0].length, 4);
    if (!okSeq(seq)) continue;                                                      // « SCI Les Tilleuls » : l'article fait partie du nom
    add({ start: seq.start, end: seq.end, cat: 'SOCIETE', certainty: 'maybe', reason: 'nom de société (forme juridique)', rank: RANK.orgform, key: fold(seq.text) });
  }
  // société citée comme client, fournisseur ou partenaire (« on fournit surtout Bati Concept », « Bati Concept, c'est notre premier client »)
  for (const m of fmatches("(?:fourni\\w+|livr\\w+|factur\\w+|travaill\\w+\\s+avec|collabor\\w+\\s+avec|(?:notre|mon|son|leur)\\s+(?:premier\\s+|principal\\s+|seul\\s+|plus\\s+gros\\s+)?(?:client|fournisseur|partenaire|sous-traitant)\\s*(?:est|c'est|:|,)?)\\s+(?:surtout\\s+|principalement\\s+|essentiellement\\s+|beaucoup\\s+|notamment\\s+|egalement\\s+)?(?:la\\s+|le\\s+|l')?")) {
    const seq = capSeqAt(text, m.index + m[0].length, 3);
    if (!seq || seq.text.length < 3 || !okSeq(seq) || lex.aliasMap.has(fold(seq.text)) || PRONOUN_STOP.has(fold(seq.text.split(/\s+/)[0])) || first.has(fold(seq.text))) continue;
    add({ start: seq.start, end: seq.end, cat: 'SOCIETE', certainty: 'maybe', reason: 'société citée comme client, fournisseur ou partenaire : à vérifier', rank: RANK.orgform - 4, key: fold(seq.text) });
  }
  for (const m of fmatches(",\\s*c'est\\s+(?:notre|mon|son|leur)\\s+(?:premier\\s+|principal\\s+|seul\\s+|plus\\s+gros\\s+)?(?:client|fournisseur|partenaire|sous-traitant)")) {
    const w = /(\p{Lu}[\p{L}\p{N}&'’\-]*(?:\s+\p{Lu}[\p{L}\p{N}&'’\-]*){0,2})$/u.exec(text.slice(Math.max(0, m.index - 50), m.index));
    if (!w) continue;
    const st = m.index - w[1].length; const fs = fold(w[1]);
    if (NOT_NAME.has(fs.split(' ')[0]) || lex.aliasMap.has(fs) || first.has(fs)) continue;
    add({ start: st, end: m.index, cat: 'SOCIETE', certainty: 'maybe', reason: 'société citée comme client ou fournisseur : à vérifier', rank: RANK.orgform - 4, key: fs });
  }
  // « salarié de X », « ingénieur de X », « collaboratrice chez X »
  for (const m of fmatches("\\b(?:salarie|employe|ingenieur|technicien|commercial|collaborateur|collaboratrice)(?:e|s|es)?\\s+(?:de|d'|du|chez)\\s*(?:la\\s+|le\\s+|l')?")) {
    const seq = capSeqAt(text, m.index + m[0].length, 4);
    if (!seq || !okSeq(seq) || first.has(fold(seq.text))) continue;
    add({ start: seq.start, end: seq.end, cat: 'EMPLOYEUR', reason: "indice d'employeur (« salarié de … »)", rank: RANK.employer, key: fold(seq.text) });
  }
  // société sans forme juridique mais dont le dernier mot est un nom d'activité (« TM Invest », « Delcourt Conseil »)
  for (const m of text.matchAll(new RegExp("(?<![\\p{L}\\p{N}])(\\p{Lu}[\\p{L}\\p{N}&'’\\-]*)(?:\\s+(?:et|&)\\s+(\\p{Lu}[\\p{L}\\p{N}&'’\\-]*))?\\s+(" + COMPANY_NOUNS + ")(?![\\p{L}\\p{N}])", 'gu'))) {
    const fw = fold(m[1]);
    if (DETERMINERS.has(fw) || NOT_NAME.has(fw) || COMMON_WORDS.has(fw) || lex.aliasMap.has(fw) || PRONOUN_STOP.has(fw)) continue;
    if (new RegExp('^(?:' + COMPANY_NOUNS.toLowerCase() + ')$').test(fw)) continue;      // « Finance Gestion » : deux mots d'activité, pas un nom propre
    add({ start: m.index, end: m.index + m[0].length, cat: 'SOCIETE', certainty: 'maybe', reason: "nom propre + mot d'activité (société probable)", rank: RANK.orgform - 6, key: fold(m[0]) });
  }
  // titre ou fonds après un indice financier : conservé s'il commence par un nom connu du dictionnaire, sinon à vérifier
  // organisateur, éditeur, présentateur : société citée mais jamais certaine
  for (const m of fmatches("\\b(?:organise\\w*|propose\\w*|anime\\w*|presente\\w*|publie\\w*|edite\\w*|realise\\w*|diffuse\\w*|men[ée]\\w*|financ[ée]\\w*|soutenu\\w*|accompagn[ée]\\w*|gere\\w*|conseill[ée]\\w*)\\s+par\\s+(?:la\\s+|le\\s+|l')?")) {
    const seq = capSeqAt(text, m.index + m[0].length, 4);
    if (!okSeq(seq)) continue;
    const fs = fold(seq.text); let known = false;
    for (const k of lex.aliasMap.keys()) if (fs === k || fs.startsWith(k + ' ')) { known = true; break; }
    if (known) { add({ start: seq.start, end: seq.end, cat: 'ETABLISSEMENT', decision: 'keep', reason: 'établissement ou gestionnaire connu du dictionnaire', rank: RANK.orgform - 2, key: fs, silent: true }); continue; }
    add({ start: seq.start, end: seq.end, cat: 'SOCIETE', certainty: 'maybe', reason: "nom d'organisation (« organisé par … »)", rank: RANK.orgform - 3, key: fs });
  }
  for (const m of fmatches("\\b(?:actions?|titres?|parts?|obligations?|fonds|sicav|scpi|contrats?|assurance[- ]vie)\\s+(?:de\\s+|d'|du\\s+|chez\\s+)?")) {
    if (/\p{Lu}/u.test(text[m.index] || '')) continue;                               // « Actions Monde » : partie d'un nom de fonds, pas un indice
    let seq = capSeqAt(text, m.index + m[0].length, 4);
    if (!seq || NOT_NAME.has(fold(seq.text.split(/\s+/)[0]))) continue;
    // « contrat Afer de Colette » : le titulaire (prénom connu après « de ») n'appartient pas au nom du produit
    const hold = /\s+(?:de|du|des|d')\s*(?=\p{Lu})(\p{Lu}[\p{L}'’\-]*)/u.exec(seq.text);
    if (hold && hold.index > 0 && first.has(fold(hold[1]))) seq = { start: seq.start, end: seq.start + hold.index, text: seq.text.slice(0, hold.index) };
    const fn = fold(seq.text);
    let known = false; for (const k of lex.aliasMap.keys()) if (fn === k || fn.startsWith(k + ' ')) { known = true; break; }
    if (known) add({ start: seq.start, end: seq.end, cat: 'ETABLISSEMENT', decision: 'keep', reason: 'nom commençant par un établissement ou un fonds connu', rank: RANK.lexicon - 5, key: fn, silent: true });
    else if (!first.has(fn.split(' ')[0])) add({ start: seq.start, end: seq.end, cat: 'SOCIETE', certainty: 'maybe', reason: 'titre ou société inconnu du dictionnaire : à vérifier', rank: RANK.orgform - 5, key: fn });
  }

  // lieu de naissance (« né le 2 octobre 1962 à Lyon », « née à Lille ») : identifiant direct, masqué dans les deux niveaux
  for (const m of fmatches("\\bnee?\\s+(?:le\\s+[^.;!?]{0,28}?\\s)?(?:a|au|en|dans)\\s+(?:la\\s+|le\\s+|l')?")) {
    const seq = capSeqAt(text, m.index + m[0].length, 3);
    if (!okSeq(seq)) continue;
    add({ start: seq.start, end: seq.end, cat: 'VILLE', reason: 'lieu de naissance', rank: RANK.structured - 15, key: fold(seq.text) });
  }
  // nom de rue sans numéro (« rue de la République ») : à vérifier ; la commune qui suit est masquée en Renforcé
  for (const m of fmatches("\\b(?:rue|avenue|boulevard|quai|impasse|allee)\\s+(?:de\\s+la\\s+|de\\s+l'|du\\s+|des\\s+|de\\s+|d')?")) {
    if (/\d/.test(f.slice(Math.max(0, m.index - 6), m.index))) continue;               // adresse numérotée : déjà traitée
    const seq = capSeqAt(text, m.index + m[0].length, 4); if (!okSeq(seq)) continue;
    const full = { start: m.index, end: seq.end };
    // numéro dicté (« vingt-deux rue Victor Hugo », « douze bis avenue … ») : de 1 à 3 mots-nombres juste avant la voie
    const back = /((?:[a-z\-]+\s+){1,3})$/.exec(f.slice(Math.max(0, m.index - 40), m.index));
    if (back) {
      const parts = back[1].trim().split(/\s+/); let k = parts.length; const ok = [];
      while (k > 0 && (isNumTok(parts[k - 1]) || /^(?:bis|ter|premier)$/.test(parts[k - 1]))) { ok.unshift(parts[k - 1]); k--; }
      if (ok.length && ok.some((t) => isNumTok(t) && !['et', 'un', 'une'].includes(t))) {
        const st = m.index - (back[1].length - back[1].lastIndexOf(ok[0]));
        full.start = Math.max(0, st);
        add({ start: full.start, end: full.end, cat: 'ADRESSE', reason: 'adresse dictée avec numéro en toutes lettres', rank: RANK.structured - 6, key: fold(text.slice(full.start, full.end)) });
        continue;
      }
    }
    add({ start: full.start, end: full.end, cat: 'ADRESSE', certainty: 'maybe', reason: 'nom de rue : à vérifier', rank: RANK.structured - 25, key: fold(text.slice(full.start, full.end)) });
    if (renf) {
      const town = /^\s+(?:a|à)\s+/.exec(text.slice(seq.end));
      if (town) { const c = capSeqAt(text, seq.end + town[0].length, 3); if (okSeq(c)) add({ start: c.start, end: c.end, cat: 'VILLE', reason: 'commune (niveau Renforcé)', rank: RANK.extra, key: fold(c.text) }); }
    }
  }

  // ---------- 5. Renforcé : communes, établissements, fonctions ----------
  if (renf) {
    // régions et départements (initiale majuscule exigée)
    if (!engineGeo) engineGeo = new RegExp('(?<![\\p{L}\\p{N}])(?:' + GEO_NAMES.map((g) => fold(g).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')).join('|') + ')(?![\\p{L}\\p{N}])', 'gu');
    for (const m of f.matchAll(engineGeo)) if (isUpper(m.index)) add({ start: m.index, end: m.index + m[0].length, cat: 'VILLE', reason: 'région ou département (niveau Renforcé)', rank: RANK.extra - 2, key: fold(m[0]) });
    // communes de France (liste Insee) : retenues seulement dans un contexte de lieu, ou si le nom est long et sans ambiguïté
    if (o.communes && o.communes.size) {
      const PLACE_LEFT = /(?:\b(?:a|au|aux|en|dans|vers|pres de|proche de|autour de|sur|de|d'|entre|ville de|commune de|habite|habitons|vit|vivons|reside|installe\w*|domicilie\w*|situe\w*|base\w*|nee?|originaire de|depuis|jusqu'a|pour)\s+(?:la\s+|le\s+|l'|les\s+)?)$/;
      const SEQ = /\p{Lu}[\p{L}'’]*(?:(?:-|\s+)(?:(?:de|du|des|la|le|les|sur|sous|en|lès|aux|l'|d')(?:-|\s+)?)?\p{Lu}[\p{L}'’]*){0,4}/gu;
      const ambiguous = (k) => first.has(k) || NOT_NAME.has(k) || COMMON_WORDS.has(k) || ISOLATED_DENY.has(k) || REALLY_COMMON.has(k) || lex.aliasMap.has(k);
      for (const m of text.matchAll(SEQ)) {
        const toks = []; const tr = /[\p{L}'’]+/gu; let t;
        while ((t = tr.exec(m[0]))) toks.push({ w: fold(t[0]), s: m.index + t.index, e: m.index + t.index + t[0].length });
        for (let k = toks.length; k >= 1; k--) {
          const name = toks.slice(0, k).map((x) => x.w).join(' ');
          if (name.length < 4 || !o.communes.has(name)) continue;
          const s = toks[0].s, en = toks[k - 1].e;
          const left = f.slice(Math.max(0, s - 40), s);
          const cue = PLACE_LEFT.test(left);
          const sentenceInitial = /(?:^|[.!?…\n])\s*$/.test(f.slice(Math.max(0, s - 3), s));
          const multi = k > 1;
          if (!cue) {
            if (sentenceInitial) break;
            if (!multi && (name.length < 7 || ambiguous(name))) break;
            if (multi && ambiguous(name)) break;
          } else if (!multi && ambiguous(name) && ((NOT_NAME.has(name) && name !== 'paris') || REALLY_COMMON.has(name) && !/\b(?:a|au|en|dans)\s+$/.test(left))) break;
          add({ start: s, end: en, cat: 'VILLE', certainty: cue ? 'sure' : 'maybe', reason: cue ? 'commune (liste Insee), contexte de lieu' : 'nom de commune (liste Insee) sans indice de lieu : à vérifier', rank: RANK.extra - 1, key: name });
          break;
        }
      }
    }
    // « puis à Houston », « et à Genève » : lieu cité sans verbe de résidence
    for (const m of fmatches("\\b(?:puis|ensuite|et|aussi|avant)\\s+(?:a|au|en)\\s+(?:la\\s+|le\\s+|l')?")) {
      const seq = capSeqAt(text, m.index + m[0].length, 3); if (!okSeq(seq)) continue;
      add({ start: seq.start, end: seq.end, cat: 'VILLE', certainty: 'maybe', reason: 'lieu cité (niveau Renforcé) : à vérifier', rank: RANK.extra - 3, key: fold(seq.text) });
    }
    for (const m of fmatches("\\b(?:habit\\w+|vit|vivons|vivent|reside\\w*|installe\\w*|domicilie\\w*|demeur\\w+|nee?|maison|appartement|immeuble|local|terrain|studio|villa|chalet|parking|cabinet|bureau|bureaux|agence|magasin|commerce|boutique|siege|exploitation|agricole|exploitant|ferme|domaine|vignoble|elevage|residence(?:\\s+(?:principale|secondaire))?|bien)(?:\\s+(?:situe\\w*|locatif|professionnel))?\\s+(?:a|au|aux|en|dans|sur|pres\\s+de|proche\\s+de)\\s+(?:la\\s+|le\\s+|l'|les\\s+)?")) {
      const seq = capSeqAt(text, m.index + m[0].length, 3);
      if (!seq || NOT_NAME.has(fold(seq.text.split(/\s+/)[0]))) continue;
      add({ start: seq.start, end: seq.end, cat: 'VILLE', reason: 'commune ou lieu précis (niveau Renforcé)', rank: RANK.extra, key: fold(seq.text) });
    }
    for (const m of fmatches("\\b(?:ecole|lycee|college|universite|faculte|institut|iut|cfa|business school|clinique|hopital|centre hospitalier|chu)\\s+(?:de\\s+|du\\s+|d')?")) {
      const seq = capSeqAt(text, m.index + m[0].length, 3, true);
      if (!seq || NOT_NAME.has(fold(seq.text.split(/\s+/)[0]))) continue;
      add({ start: seq.start, end: seq.end, cat: 'ETABLISSEMENT_LIEU', certainty: 'maybe', reason: 'école ou établissement de santé (niveau Renforcé)', rank: RANK.extra, key: fold(seq.text) });
    }
    for (const m of fmatches(`\\b${HIGH_JOB_F}\\b(?:\\s+(?:du|de la|de l'|des|d'|de)\\s*(?:groupe|societe|entreprise|l'entreprise))?`)) {
      add({ start: m.index, end: m.index + m[0].length, cat: 'FONCTION', decision: 'generalize', certainty: 'maybe', replacement: 'une fonction de direction', reason: 'fonction très identifiante (niveau Renforcé)', rank: RANK.extra - 5 });
    }
    for (const m of fmatches(`\\b${ANY_JOB_F}\\s+(?:du|de la|de l'|des)\\s*(?:groupe|societe|entreprise|l'entreprise)\\b`)) {
      add({ start: m.index, end: m.index + m[0].length, cat: 'FONCTION', decision: 'generalize', certainty: 'maybe', replacement: 'une fonction de direction', reason: "fonction + entreprise (niveau Renforcé)", rank: RANK.extra - 6 });
    }
  }

  // ---------- 5 bis. Cohérence entre rôles ----------
  // Une entreprise citée comme EMPLOYEUR (du client ou d'un proche) et aussi comme titre ou produit : le titre peut révéler l'employeur.
  { const empKeys = new Set(cands.filter((c) => c.cat === 'EMPLOYEUR' && c.decision === 'mask' && (c.certainty === 'sure' || c.certainty === 'maybe') && c.key).map((c) => c.key));
    for (const c of cands) {
      if (c.cat !== 'ETABLISSEMENT' || c.decision !== 'keep' || c.silent || !c.key || !empKeys.has(c.key)) continue;
      if (renf) { c.cat = 'EMPLOYEUR'; c.decision = 'mask'; c.certainty = 'maybe'; c.reason = "titre ou produit du même nom qu'un employeur cité : peut révéler l'employeur (niveau Renforcé)"; }
      else { c.certainty = 'info'; c.reason = "titre ou produit du même nom qu'un employeur cité (conservé en niveau Standard)"; }
    } }
  // Un titre ou un fonds conservé dont le NOM CONTIENT celui d'un employeur ou d'une société masqués (« Amundi Actions Monde » alors que le
  // client ou son conjoint travaille chez Amundi) : le fonds est utile au compte rendu, mais il peut révéler l'employeur. Décision explicite.
  { const names = [];                                           // { n: nom replié, s, e : position de l'élément d'où il vient (-1 : fiche d'identité) }
    for (const v of [...(sheet.employers || []), ...(sheet.companies || [])]) if (v && v.trim().length >= 4) names.push({ n: fold(v).trim(), s: -1, e: -1 });
    for (const c of cands) if ((c.cat === 'EMPLOYEUR' || c.cat === 'SOCIETE') && c.decision === 'mask' && (c.certainty === 'sure' || c.certainty === 'maybe')) {
      const t = fold(text.slice(c.start, c.end)).trim(); if (t.length >= 4) names.push({ n: t, s: c.start, e: c.end });
    }
    for (const c of cands) {
      if (c.decision !== 'keep' || (c.cat !== 'ETABLISSEMENT' && c.cat !== 'PRODUIT')) continue;
      const ft = fold(text.slice(c.start, c.end)).trim();
      for (const { n, s: ns, e: ne } of names) {
        if (ns >= 0 && ns < c.end && ne > c.start) continue;           // un candidat concurrent du même passage n'est pas un nom « ailleurs »
        if (ft === n || ft.length <= n.length) continue;
        if (!new RegExp('(?<![a-z0-9])' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+') + '(?![a-z0-9])').test(ft)) continue;
        if (renf) { c.cat = 'EMPLOYEUR'; c.decision = 'mask'; c.certainty = 'maybe'; c.silent = false; c.reason = `nom de fonds ou de titre contenant « ${n} », nom masqué ailleurs (employeur ou société) : peut révéler l'employeur (niveau Renforcé)`; c.key = c.key || ft; }
        else { c.certainty = 'info'; c.silent = false; c.reason = `nom de fonds ou de titre contenant « ${n} », nom masqué ailleurs (conservé en niveau Standard)`; }
        break;
      }
    } }
  // Un nom de famille déjà reconnu avec certitude est reconnu partout ailleurs dans le texte (« Delcourt » seul, plus loin).
  { const known = new Map();                                     // nom de personne -> « confirmé par un indice » (peut être un mot courant)
    const TITLE = /^(?:m\.|mme|mlle|monsieur|madame|mademoiselle|ma[iî]tre|me|docteur|dr|professeur|pr)\s+/iu;
    const addKnown = (t, confirmed) => {
      if (!/^\p{Lu}[\p{L}'’\-]{3,}$/u.test(t)) return;
      const ft = fold(t); const common = COMMON_WORDS.has(ft) || NOT_NAME.has(ft) || lex.aliasMap.has(ft);
      if (common && !confirmed) return;
      if (lex.aliasMap.has(ft)) return;
      known.set(t, (known.get(t) || false) || common);
    };
    for (const c of cands) {
      if (c.cat !== 'PERSONNE' || c.decision !== 'mask' || c.person || !(c.certainty === 'sure' || c.confirmed)) continue;
      let t = text.slice(c.start, c.end).replace(TITLE, '');
      const parts = t.split(/\s+/);
      if (parts.length === 1) addKnown(t, !!c.confirmed);
      else if (parts.length === 2 && first.has(fold(parts[0]))) addKnown(parts[1], !!c.confirmed);    // « Joseph Sauvage » : « Sauvage » seul plus loin
    }
    const initialAt = (i) => /(?:^|[.!?…\n])\s*$/.test(f.slice(Math.max(0, i - 3), i));
    for (const [t, common] of known) {
      for (const m of text.matchAll(new RegExp('(?<![\\p{L}\\p{N}\'’\\-])' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}\'’\\-])', 'gu'))) {
        if (common && initialAt(m.index)) continue;                  // « Blanc comme neige » en début de phrase : adjectif
        add({ start: m.index, end: m.index + t.length, cat: 'PERSONNE', certainty: common ? 'maybe' : 'sure', reason: 'même nom que plus haut dans le texte', rank: RANK.firstname + 5 });
      }
    }
    // même société ou même employeur cité plusieurs fois (« Bati Concept » : client, puis employeur du conjoint)
    const orgs = new Map();
    for (const c of cands) {
      if ((c.cat !== 'SOCIETE' && c.cat !== 'EMPLOYEUR') || c.decision !== 'mask') continue;
      const t = text.slice(c.start, c.end);
      if (t.length < 4 || lex.aliasMap.has(fold(t)) || !/^\p{Lu}/u.test(t)) continue;
      if (!orgs.has(t)) orgs.set(t, c);
    }
    for (const [t, c] of orgs) {
      for (const m of text.matchAll(new RegExp('(?<![\\p{L}\\p{N}\'’\\-])' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}\'’\\-])', 'gu'))) {
        add({ start: m.index, end: m.index + t.length, cat: c.cat, certainty: c.certainty, reason: 'même société que plus haut dans le texte', rank: c.rank - 1, key: c.key || fold(t) });
      }
    } }

  // ---------- 6. Chevauchements ----------
  const never = (o.neverMask || []).map((s) => fold(s).trim()).filter(Boolean);
  // Le mention la plus longue l'emporte (« Madame Martin » sur « Martin », « Transports Lopez » sur « Lopez »), à longueur égale la plus sûre ;
  // la mention retenue hérite de la fiche client des mentions plus courtes qu'elle contient.
  const byPrio = cands.slice().sort((a, b) => ((b.end - b.start) - (a.end - a.start)) || (b.rank - a.rank) || (a.start - b.start));
  const taken = [];
  for (const c of byPrio) {
    if (c.start >= c.end) continue;
    if (taken.some((t) => c.start < t.end && c.end > t.start)) continue;
    taken.push(c);
  }
  for (const t of taken) {
    if (t.cat !== 'PERSONNE' || t.person) continue;
    const inner = cands.find((c) => c.person && c.start >= t.start && c.end <= t.end);
    if (inner) { t.person = inner.person; t.key = inner.key; }
  }
  taken.sort((a, b) => a.start - b.start);
  const spans = [];
  for (const c of taken) {
    c.text = text.slice(c.start, c.end);
    if (never.includes(fold(c.text).trim()) && c.decision !== 'keep') { c.decision = 'keep'; c.certainty = 'sure'; c.reason = 'terme déclaré « jamais masquer »'; }
    spans.push(c);
  }

  // ---------- 6 bis. Décisions de l'utilisateur (conserver / masquer / étiquette), sur une occurrence ou sur toutes ----------
  const ov = o.overrides || {}; const ovText = ov.byText || {}, ovPos = ov.byPos || {}, ovLabels = ov.labels || {};
  const ovKey = (t) => fold(t).trim().replace(/^(?:m\.|mme|mlle|monsieur|madame|mademoiselle|maitre|me|docteur|dr|professeur|pr)\s+/, '');
  spans.forEach((s, i) => {
    s.id = i; s.k = ovKey(s.text);
    let act = null; const p = ovPos[`${s.start}:${s.end}`];
    if (p && p.text === s.text) act = p.action; else if (ovText[s.k]) act = ovText[s.k];
    if (act === 'keep' && s.decision !== 'keep') { s.decision = 'keep'; s.certainty = 'decided'; s.reason += ' — conservé sur votre décision'; }
    else if (act === 'mask' && s.decision === 'keep') {
      s.decision = 'mask'; s.certainty = 'decided'; s.reason += ' — masqué sur votre décision';
      if (s.cat === 'PRODUIT') s.prod = true;
      s.cat = s.cat === 'ETABLISSEMENT' ? 'EMPLOYEUR' : (s.cat === 'PRODUIT' ? 'AUTRE' : s.cat); s.silent = false;
    } else if (act && s.certainty === 'maybe') s.certainty = 'decided';
  });

  // ---------- 7. Étiquettes cohérentes (même entité = même étiquette) ----------
  const letters = (n) => { let s = ''; n++; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
  const counters = {}; const entities = [];
  const FAM = { PERSONNE: 'pers', EMPLOYEUR: 'ent', SOCIETE: 'soc', VILLE: 'ville', ETABLISSEMENT_LIEU: 'lieu', ADRESSE: 'adr', TELEPHONE: 'tel', EMAIL: 'mail', IBAN: 'iban', CARTE: 'carte', NIR: 'nir', SIREN: 'siren', PLAQUE: 'plaque', CONTRAT: 'contrat', AUTRE: 'autre' };
  const LABEL = { ent: 'Entreprise', soc: 'Société', ville: 'Ville', lieu: 'Établissement', adr: 'Adresse', tel: 'Téléphone', mail: 'E-mail', iban: 'IBAN', carte: 'Carte', nir: 'Numéro de sécurité sociale', siren: 'Numéro SIREN', plaque: 'Plaque', contrat: 'Numéro de contrat', autre: 'Information masquée', prod: 'Produit' };
  // Étiquettes lisibles : un terme masqué sans catégorie précise (« Terme masqué A ») devient « Ville A » s'il suit une préposition de lieu,
  // « Produit A » s'il s'agit d'un produit masqué sur décision, sinon « Information masquée A ». Un article en majuscule qui fait partie
  // du nom (« à La Baule ») est absorbé dans l'élément masqué : on ne laisse pas « La Ville A ».
  const PLACE_PREP = /(?:^|[\s(,;:])(?:a|au|aux|en|dans|vers|pres de|autour de|sur|a cote de|proche de|region de|ville de)\s+$/;
  const placeKeys = new Set();
  for (const s of spans) {
    if (s.decision !== 'mask') continue;
    if (['AUTRE', 'VILLE', 'ETABLISSEMENT_LIEU'].includes(s.cat) && !s.prod) {
      const win = text.slice(Math.max(0, s.start - 8), s.start);
      const am = /(?:^|\s)(La|Le|Les|L['’])\s*$/.exec(win);
      if (am) {
        const artStart = Math.max(0, s.start - 8) + am.index + (am[0].length - am[0].trimStart().length);
        const before = fold(text.slice(Math.max(0, artStart - 40), artStart));
        const prevEnd = spans.reduce((m, x) => (x !== s && x.end <= artStart ? Math.max(m, x.end) : m), 0);
        if ((PLACE_PREP.test(before) || /^\s*$/.test(before)) && artStart >= prevEnd) { s.start = artStart; s.text = text.slice(s.start, s.end); }
      }
    }
    if (s.cat === 'AUTRE' && !s.prod) {
      const b = fold(text.slice(Math.max(0, s.start - 30), s.start));
      if (PLACE_PREP.test(b) || /(?:^|\s)(?:a|au|en|dans)\s+(?:la|le|les|l')\s*$/.test(b)) placeKeys.add(s.key || fold(s.text).replace(/\s+/g, ' ').trim());
    }
  }
  const stripTitle = (t) => fold(t).replace(/^(?:m\.|mme|mlle|monsieur|madame|mademoiselle|maitre|me|docteur|dr|professeur|pr)\s+/, '').trim();
  for (const s of spans) {
    if (s.decision === 'keep' || s.decision === 'generalize') continue;
    const fam = (s.cat === 'AUTRE' ? (s.prod ? 'prod' : placeKeys.has(s.key || fold(s.text).replace(/\s+/g, ' ').trim()) ? 'ville' : 'autre') : FAM[s.cat]) || 'autre';
    const key = s.key || (fam === 'pers' ? stripTitle(s.text) : fold(s.text).replace(/\s+/g, ' ').trim());
    if (fam === 'pers') {
      const pk = s.person ? stripTitle(s.person.name) : stripTitle(s.text); const toks = pk.split(/\s+/).filter(Boolean);
      let ent = entities.find((e) => e.fam === 'pers' && (e.keys.has(pk) || (toks.length && toks.every((t) => e.toks.has(t))) || (e.toks.size && [...e.toks].every((t) => toks.includes(t)))));
      if (!ent) { ent = { fam, keys: new Set(), toks: new Set(), n: counters[fam] = (counters[fam] ?? -1) + 1, gender: '', sheet: null }; entities.push(ent); }
      ent.keys.add(pk); toks.forEach((t) => ent.toks.add(t));
      if (s.person) { ent.sheet = ent.sheet || s.person; if (s.person.gender) ent.gender = ent.gender || s.person.gender; }
      const t = fold(s.text);
      if (/^(?:mme|mlle|madame|mademoiselle)\s/.test(t)) ent.gender = ent.gender && ent.gender !== 'F' ? 'X' : (ent.gender || 'F');
      else if (/^(?:m\.|monsieur)\s/.test(t)) ent.gender = ent.gender && ent.gender !== 'M' ? 'X' : (ent.gender || 'M');
      s.ent = ent;
    } else {
      let ent = entities.find((e) => e.fam === fam && e.keys.has(key));
      if (!ent) { ent = { fam, keys: new Set([key]), toks: new Set(), n: counters[fam] = (counters[fam] ?? -1) + 1 }; entities.push(ent); }
      s.ent = ent;
    }
  }
  // Lettres des personnes : le client de la fiche en premier, puis l'ordre d'apparition
  const pers = entities.filter((e) => e.fam === 'pers').sort((a, b) => ((b.sheet && b.sheet.role === 'client' ? 1 : 0) - (a.sheet && a.sheet.role === 'client' ? 1 : 0)) || (a.n - b.n));
  pers.forEach((e, i) => { e.n = i; });
  const personLabel = (ent) => {
    const isClient = ent.sheet && ent.sheet.role === 'client';
    const g = ent.gender;
    const base = isClient && g === 'F' ? 'Cliente' : isClient && g === 'M' ? 'Client' : 'Personne';   // genre inconnu ou contradictoire : « Personne »
    return `${base} ${letters(ent.n)}`;
  };
  for (const s of spans) {
    if (s.decision === 'mask') s.label = s.ent.fam === 'pers' ? personLabel(s.ent) : `${LABEL[s.ent.fam]} ${letters(s.ent.n)}`;
    else if (s.decision === 'generalize') s.label = s.replacement;
    if (ovLabels[s.k] && s.decision !== 'keep') s.label = ovLabels[s.k];
  }

  // ---------- 8. Texte protégé ----------
  let out = '', pos = 0;
  for (const s of spans) {
    if (s.decision === 'keep') continue;
    out += text.slice(pos, s.start) + s.label; pos = s.end;
  }
  out += text.slice(pos);
  const visible = spans.filter((s) => !s.silent);
  const stats = {
    chars: text.length, masked: visible.filter((s) => s.decision === 'mask').length, generalized: visible.filter((s) => s.decision === 'generalize').length,
    kept: visible.filter((s) => s.decision === 'keep').length, toReview: visible.filter((s) => s.certainty === 'maybe' && s.decision !== 'keep').length,
    decided: visible.filter((s) => s.certainty === 'decided').length,
  };
  return { protectedText: out, spans, stats, level: o.level };
}

// Contrôle de fuite PRÉCIS, appliqué au texte d'origine et aux éléments détectés (jamais aux consignes ni à la trame) :
// pour chaque nom masqué ou nom de la fiche (personne, employeur, société, adresse), repère les occurrences qui ne sont PAS masquées.
//  - occurrence sans aucun élément détecté        -> « oubli » : bloque la copie tant que non corrigée (masquer partout) ou reconnue non confidentielle par l'utilisateur ;
//  - occurrence dans un élément conservé          -> « conserve » : décision visible (jamais bloquante ici ; en Renforcé, l'élément est déjà « à décider »).
// acks : termes que l'utilisateur a reconnus non confidentiels pour cette fiche (décision explicite et enregistrée).
export function leakReport(text, spans, sheet = {}, { acks = [] } = {}) {
  const f = fold(text);
  const ackSet = new Set((acks || []).map((a) => fold(String(a)).trim()));
  const terms = new Map();
  const addTerm = (t, why, cat) => { const k = fold(String(t || '')).trim(); if (k.length < 4 || terms.has(k) || ackSet.has(k)) return; terms.set(k, { text: String(t).trim(), why, cat }); };
  const CIV = /^(?:M\.|Mme|Mlle|Monsieur|Madame|Mademoiselle|Maître|Maitre|Me|Docteur|Dr|Professeur|Pr)\s+/i;
  const catLabel = { PERSONNE: 'une personne', EMPLOYEUR: 'un employeur', SOCIETE: 'une société', VILLE: 'un lieu', ADRESSE: 'une adresse', ETABLISSEMENT_LIEU: 'un établissement' };
  for (const s of spans) if (s.decision === 'mask' || s.decision === 'generalize') addTerm(s.text.replace(CIV, ''), `masqué ailleurs dans le texte comme ${catLabel[s.cat] || 'une information confidentielle'}`, s.cat);
  for (const p of sheet.persons || []) { addTerm(p.name, 'nom d\'une personne de la fiche d\'identité', 'PERSONNE'); for (const t of String(p.name || '').split(/\s+/)) addTerm(t, 'nom ou prénom d\'une personne de la fiche d\'identité', 'PERSONNE'); }
  for (const v of sheet.employers || []) addTerm(v, 'employeur indiqué dans la fiche d\'identité', 'EMPLOYEUR');
  for (const v of sheet.companies || []) addTerm(v, 'société indiquée dans la fiche d\'identité', 'SOCIETE');
  for (const v of sheet.addresses || []) addTerm(v, 'adresse indiquée dans la fiche d\'identité', 'ADRESSE');
  const items = [];
  for (const [k, t] of terms) {
    const wantUpper = /\p{Lu}/u.test(t.text[0] || '');
    const rx = new RegExp('(?<![\\p{L}\\p{N}])' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+') + '(?![\\p{L}\\p{N}])', 'gu');
    const occ = [];
    for (const m of f.matchAll(rx)) {
      const s0 = m.index, e0 = s0 + m[0].length;
      if (/\p{Lu}/u.test(text[s0] || '') !== wantUpper) continue;                       // « petit » (adjectif) n'est pas « Petit » (nom)
      const cover = spans.find((s) => s.start <= s0 && s.end >= e0);
      if (cover && (cover.decision === 'mask' || cover.decision === 'generalize')) continue;
      const para = text.slice(0, s0).split(/\n\s*\n/).length;
      occ.push({ start: s0, end: e0, kind: cover ? 'conserve' : 'oubli', paragraph: para, inside: cover ? cover.text : null, insideReason: cover ? cover.reason : null,
        context: text.slice(Math.max(0, s0 - 60), Math.min(text.length, e0 + 60)).replace(/\s+/g, ' ') });
    }
    if (occ.length) items.push({ term: t.text, key: k, cat: t.cat, why: t.why, kind: occ.some((o) => o.kind === 'oubli') ? 'oubli' : 'conserve', occurrences: occ });
  }
  items.sort((a, b) => a.occurrences[0].start - b.occurrences[0].start);
  return { items, blocking: items.filter((i) => i.kind === 'oubli') };
}

// Contrôle de fuite (ancienne version, sur texte déjà protégé) : renvoie les textes originaux masqués (et les noms de la fiche) qui figurent encore dans le texte à copier.
// kind « conserve » : le même texte est volontairement conservé ailleurs (ex. employeur Airbus masqué, actions Airbus conservées) ; kind « oubli » : à corriger.
export function leakCheck(protectedText, spans, sheet = {}) {
  const low = fold(protectedText); const leaks = new Map();
  const keptTexts = new Set(spans.filter((s) => s.decision === 'keep').map((s) => fold(s.text).trim()));
  const probe = (v) => {
    const k = fold(String(v || '')).trim();
    if (k.length < 4 || leaks.has(k)) return;
    const wantUpper = /\p{Lu}/u.test(String(v)[0] || '');
    const rx = new RegExp('(?<![\\p{L}\\p{N}])' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}])', 'gu');
    for (const m of low.matchAll(rx)) {
      if (/\p{Lu}/u.test(protectedText[m.index] || '') !== wantUpper) continue;       // « petit » (adjectif) n'est pas « Petit » (nom)
      leaks.set(k, { text: String(v), kind: keptTexts.has(k) ? 'conserve' : 'oubli' }); break;
    }
  };
  for (const s of spans) if (s.decision === 'mask' || s.decision === 'generalize') probe(s.text.replace(/^(?:M\.|Mme|Mlle|Monsieur|Madame|Mademoiselle)\s+/, ''));
  for (const p of sheet.persons || []) { probe(p.name); for (const t of p.name.split(/\s+/)) probe(t); }
  for (const v of [...(sheet.employers || []), ...(sheet.companies || []), ...(sheet.addresses || [])]) probe(v);
  return [...leaks.values()];
}
