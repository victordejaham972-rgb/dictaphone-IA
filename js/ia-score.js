// Notation automatique d'un compte rendu généré, sur des transcriptions FICTIVES de test (jamais sur des données réelles).
// Utilisée par le banc d'essai sur ordinateur et par la sonde IA de l'iPhone : mêmes critères, résultats comparables.
import { verifyReport } from './ia-verify.js';

const hasNegation = /aucun|pas |non |sans|hypoth|piste|étud|envisag|simulation|report|attend|idée|à valider|à vérifier|éventuel/i;

export function scoreCase(g, sections, transcript, stats) {
  const content = sections.map((s) => s.content).join('\n');
  const missed = [], hit = [];
  for (const [label, pat] of g.facts) (new RegExp(pat, 'i').test(content) ? hit : missed).push(label);
  const hallu = verifyReport(sections, transcript).unverified.map((u) => u.value + ' [' + u.section + ']');
  const promoted = [];
  for (const h of g.hypotheses || []) {
    const re = new RegExp(h.pattern, 'i');
    for (const s of sections.filter((x) => /décision|solution|piste/i.test(x.title))) {
      for (const line of s.content.split('\n')) if (re.test(line) && !hasNegation.test(line)) { promoted.push(h.label); break; }
    }
  }
  let uncertainOk = null;
  if (g.uncertain) {
    const re = new RegExp(g.uncertain.pattern, 'i'), cue = new RegExp(g.uncertain.cue, 'i');
    const lines = content.split('\n').filter((l) => re.test(l));
    uncertainOk = lines.length > 0 && lines.some((l) => cue.test(l));
  }
  let staleBad = null;
  if (g.stale) {
    const re = new RegExp(g.stale.pattern, 'i'), cue = new RegExp(g.stale.cue, 'i'), fresh = new RegExp(g.stale.fresh, 'i');
    const lines = content.split('\n').filter((l) => re.test(l));
    staleBad = lines.some((l) => !cue.test(l)) || !fresh.test(content);
  }
  // Classement : chaque information doit se trouver dans la bonne rubrique et pas dans une rubrique inadaptée
  let placeHit = 0, placeTotal = 0; const placeViolations = [], placeMissing = [];
  for (const [title, spec] of Object.entries(g.sections || {})) {
    const sec = sections.find((s) => s.title === title);
    const text = sec ? sec.content : '';
    for (const re of spec.must || []) { placeTotal++; if (new RegExp(re, 'i').test(text)) placeHit++; else placeMissing.push(title + ' ← ' + re); }
    for (const re of spec.mustNot || []) {
      const r = new RegExp(re, 'i');
      if (text.split('\n').some((l) => r.test(l) && !hasNegation.test(l))) placeViolations.push(title + ' ✗ ' + re);
    }
  }
  const placement = placeTotal ? +Math.max(0, (placeHit - placeViolations.length) / placeTotal).toFixed(2) : null;
  // Recopie : part des mots de la réponse qui sont des phrases (8 mots et plus) copiées mot pour mot dans la transcription
  const sq = (s) => s.toLowerCase().replace(/[^a-z0-9àâçéèêëîïôûùüÿœ]+/g, '');
  const tsq = sq(transcript); let copied = 0, totalW = 0;
  for (const sent of content.match(/[^.!?\n]+[.!?]*/g) || []) {
    const w = sent.trim().split(/\s+/).filter(Boolean); totalW += w.length;
    if (w.length >= 8 && tsq.includes(sq(sent.replace(/^[\s*\-•]+/, '')))) copied += w.length;
  }
  const copyRatio = totalW ? +(copied / totalW).toFixed(2) : 0;
  // Doublons : lignes du compte rendu qui disent la même chose (mêmes mots racines, mêmes nombres)
  const STOPW = new Set('dans pour avec cette sont plus tout tous leur leurs mais comme entre aussi client clients'.split(' '));
  const stems = (l) => new Set(l.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => (w.length >= 4 || /^\d+$/.test(w)) && !STOPW.has(w)).map((w) => (/^\d+$/.test(w) ? w : w.slice(0, 5))));
  const lines = sections.flatMap((s) => (s.content || '').split('\n').map((l) => l.replace(/^[\s\-•*]+/, '').trim()).filter((l) => l.length > 15 && !/^non évoqué/i.test(l)));
  const sets = lines.map(stems); let dupes = 0; const dupeList = [];
  for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) {
    const A = sets[i], B = sets[j]; if (Math.min(A.size, B.size) < 3) continue;
    let c = 0; for (const w of A) if (B.has(w)) c++;
    const numA = [...A].filter((w) => /^\d+$/.test(w)).join(','), numB = [...B].filter((w) => /^\d+$/.test(w)).join(',');
    if (c / Math.min(A.size, B.size) >= 0.7 && numA === numB) { dupes++; if (dupeList.length < 6) dupeList.push(lines[i].slice(0, 70) + '  ≈  ' + lines[j].slice(0, 70)); }
  }
  // Anecdotes sans intérêt patrimonial qui ne doivent pas figurer dans le compte rendu
  const fillerHits = (g.filler || []).filter((w) => new RegExp(w, 'i').test(content));
  const preamble = sections.filter((s) => /^\s*(voici|bien sûr|certainement|d'accord|je vais)/i.test(s.content || '')).length;
  const filled = sections.filter((s) => s.content && s.content.trim() && s.content !== 'Non évoqué').length;
  const words = content.toLowerCase().split(/\s+/);
  const en = words.filter((w) => ['the', 'and', 'of', 'is', 'with', 'that', 'this', 'for'].includes(w)).length;
  return {
    dupes, dupeList, fillerHits,
    recall: +(hit.length / g.facts.length).toFixed(2), placement, placeViolations, placeMissing, copyRatio, preamble, compression: +(content.length / transcript.length).toFixed(2), missed,
    hallucinatedNumbers: hallu, promotedHypotheses: promoted, uncertainOk, staleBad, filled, total: sections.length, englishLeak: en > 2, chars: content.length,
    seconds: +stats.seconds.toFixed(1), calls: stats.calls, completionTokens: stats.completionTokens,
    tokPerSec: stats.completionTokens && stats.seconds ? +(stats.completionTokens / stats.seconds).toFixed(1) : null, chunks: stats.chunks,
  };
}
