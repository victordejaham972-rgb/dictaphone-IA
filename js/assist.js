// Assistant de structuration SANS intelligence artificielle : classe les phrases de la transcription par rubrique de la trame.
// Il fonctionne partout (iPhone compris), instantanément, et n'invente rien : chaque ligne proposée est une phrase de la transcription,
// recopiée telle quelle. C'est une aide au tri, pas une rédaction : l'utilisateur choisit ce qu'il garde.
import { segment, assignSection, consolidate, bulletOf, normText, DECISION_CUE, HYPO_CUE, UNSURE_CUE, ACTION_CUE } from './ia-pipeline.js';
import { numbersIn } from './ia-verify.js';

const SMALL_TALK = /^(bonjour|bonsoir|merci|d'accord|tr[èe]s bien|parfait|au revoir|bonne|oui|non|ok|alors|voil[àa]|exactement|tout [àa] fait|je vous en prie|c'est not[ée]|bien s[ûu]r)\b/i;
const TOPIC = /(assurance|pea\b|per\b|scpi|sci\b|livret|immobili|appartement|maison|r[ée]sidence|cr[ée]dit|pr[êe]t|imp[ôo]t|fiscal|ifi\b|donation|succession|transmission|clause|notaire|retraite|objectif|projet|salaire|revenu|loyer|dividende|soci[ée]t[ée]|document|avis d|relev[ée]|rendez-vous|d[ée]cid|simulation|enfant|mari[ée]|[ée]pou[sx]|conjoint|risque|vigilance|placement|[ée]pargne|bilan|contrat)/i;
const hasAmount = (t) => numbersIn(t).some((n) => n.digits >= 3 || n.unit);
const hasDate = (t) => /\b\d{1,2}\s+(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[ûu]t|septembre|octobre|novembre|d[ée]cembre)\b/i.test(t);

const clean = (t) => t.replace(/^(alors|oui|d'accord|tr[èe]s bien|donc|ensuite|bon|eh bien|et puis)[\s,]+/i, '').replace(/\s+/g, ' ').trim().replace(/^./, (c) => c.toUpperCase());
function guessType(t) {
  if (DECISION_CUE.test(t) && !HYPO_CUE.test(t)) return 'DECISION';
  if (HYPO_CUE.test(t)) return 'HYPOTHESE';
  if (ACTION_CUE.test(t) && /\b(je vous|vous me|avant le|doit|doivent|vous envoie|nous envoyons|je vous envoie|je prends|je reviens)\b/i.test(t)) return 'ACTION';
  if (UNSURE_CUE.test(t)) return 'A_CONFIRMER';
  return 'FAIT';
}
export function assistReport(template, transcript) {
  const t0 = Date.now();
  const segs = segment(transcript);
  const facts = [];
  for (const s of segs) {
    const t = s.text;
    if (t.length < 35 && SMALL_TALK.test(t)) continue;
    if (!(hasAmount(t) || hasDate(t) || TOPIC.test(normText(t)) || TOPIC.test(t))) continue;
    if (SMALL_TALK.test(t) && t.length < 60) continue;
    const f = { sec: -1, type: guessType(t), text: clean(t), refs: [s.n] };
    f.sec = assignSection(f, template, 'rules');
    facts.push(f);
  }
  const { facts: kept, flags } = consolidate(facts, template);
  const sections = template.sections.map((sec, k) => {
    const mine = kept.filter((f) => f.sec === k).sort((a, b) => a.refs[0] - b.refs[0]);
    const byN = new Map(segs.map((s) => [s.n, s]));
    return { title: sec.title, content: mine.length ? mine.map(bulletOf).join('\n') : '', items: mine.map((f) => ({ text: bulletOf(f).replace(/^- /, ''), type: f.type, n: f.refs[0] })), evidence: mine.map((f) => ({ t: f.text, st: f.type, q: [byN.get(f.refs[0]).text.slice(0, 280)], n: [f.refs[0]] })) };
  });
  return { sections, flags, stats: { segments: segs.length, kept: kept.length, seconds: (Date.now() - t0) / 1000 } };
}
