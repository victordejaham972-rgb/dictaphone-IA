// Contrôle indépendant du modèle : tout montant écrit dans un compte rendu doit figurer dans la transcription.
// Ce contrôle protège contre les « hallucinations » chiffrées, quel que soit le moteur d'IA (ou la rédaction manuelle).

const NUM = /\d{1,3}(?:[\s  .]\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?/g;

// "120 000" -> "120000" ; "2,5" -> "2.5"
const norm = (s) => s.replace(/[\s  ]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');

export function numbersIn(text) {
  const out = [];
  for (const m of text.matchAll(NUM)) {
    const raw = m[0], v = norm(raw);
    const after = text.slice(m.index + raw.length, m.index + raw.length + 12);
    const unit = /^\s?(€|euros?|%|pour\s?cent|k€|m€|millions?)/i.test(after);
    out.push({ raw, value: v, index: m.index, unit, digits: v.replace(/\D/g, '').length });
  }
  return out;
}

// Montants à contrôler : au moins 3 chiffres, ou suivis d'une unité (€, %, euros…). Les petits nombres (jours, âges) ne sont pas contrôlés.
export function verifyReport(sections, transcript) {
  const known = new Set(numbersIn(transcript).map((n) => n.value));
  const unverified = [];
  for (const s of sections) {
    const text = s.content || '';
    for (const n of numbersIn(text)) {
      if (!(n.digits >= 3 || n.unit)) continue;
      if (known.has(n.value)) continue;
      unverified.push({ section: s.title, value: n.raw.trim(), context: text.slice(Math.max(0, n.index - 30), n.index + n.raw.length + 20).replace(/\s+/g, ' ') });
    }
  }
  return { unverified, checked: sections.reduce((a, s) => a + numbersIn(s.content || '').filter((n) => n.digits >= 3 || n.unit).length, 0) };
}
