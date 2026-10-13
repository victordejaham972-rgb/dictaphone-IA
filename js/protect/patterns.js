// Pseudonymisation locale : contrôles de validité et utilitaires de texte. Aucune dépendance, aucun accès réseau.
// Ce module est isolé : il n'est chargé par aucun écran tant que la fonction « Protéger » n'est pas branchée.

// Texte sans accents ni majuscules, MÊME LONGUEUR que l'original (les positions restent valables).
export function fold(s) {
  let out = '';
  for (const ch of s) {
    const d = ch.normalize('NFD');
    let c = d[0].toLowerCase();
    if (c === 'œ' || c === 'æ') c = 'o';
    out += c;
    for (let k = 1; k < ch.length; k++) out += ' ';   // caractère hors plan de base : garde la longueur en unités UTF-16
  }
  return out.replace(/[’‘`´]/g, "'");
}

export function luhnOk(digits) {
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d; alt = !alt;
  }
  return digits.length > 0 && sum % 10 === 0;
}

// IBAN : déplacement des 4 premiers caractères puis modulo 97 (calcul par blocs, sans grands entiers).
export function ibanOk(iban) {
  const s = iban.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const r = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const c of r) {
    const v = c >= 'A' && c <= 'Z' ? String(c.charCodeAt(0) - 55) : c;
    for (const d of v) rem = (rem * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return rem === 1;
}

// Numéro de sécurité sociale : 13 caractères + clé de 2 chiffres (97 − n mod 97 ; Corse 2A → 19, 2B → 18).
export function nirOk(raw) {
  const s = raw.replace(/\s+/g, '').toUpperCase();
  if (!/^[12]\d{4}(?:\d{2}|2A|2B)\d{6}\d{2}$/.test(s)) return false;
  const base = s.slice(0, 13).replace('2A', '19').replace('2B', '18');
  const key = +s.slice(13);
  let rem = 0;
  for (const d of base) rem = (rem * 10 + (d.charCodeAt(0) - 48)) % 97;
  return 97 - rem === key;
}

export const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
export const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MONTH_RE = '(?:janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)';
export const DATE_RE = '(?:\\d{1,2}(?:er)?\\s+' + MONTH_RE + '\\s+(?:19|20)\\d{2}|\\d{1,2}[\\/.\\-]\\d{1,2}[\\/.\\-](?:19|20)?\\d{2}|' + MONTH_RE + '\\s+(?:19|20)\\d{2}|(?:19|20)\\d{2})';

// Expressions régulières de repérage (le texte brut est analysé ; la validité est vérifiée ensuite par les fonctions ci-dessus).
export const RX = {
  email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
  phone: /(?<![\d])(?:(?:\+|00)\s?33\s?[1-9]|0[1-9])(?:[\s.\-]?\d{2}){4}(?![\d])/g,
  iban: /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/g,
  card: /(?<![\d])\d(?:[\s-]?\d){12,18}(?![\d])/g,
  nir: /(?<![\d])[12](?:\s?\d{2}){2}\s?(?:\d{2}|2[AB])\s?\d{3}\s?\d{3}\s?\d{2}(?![\d])/g,
  siren: /(?<![\d])\d{3}\s?\d{3}\s?\d{3}(?:\s?\d{5})?(?![\d])/g,
  plaque: /\b[A-Z]{2}[-\s]?\d{3}[-\s]?[A-Z]{2}\b/g,
  address: /\b\d{1,3}\s?(?:bis|ter)?,?\s+(?:rue|avenue|av\.|boulevard|bd|chemin|impasse|all[ée]e|place|route|quai|cours|passage|square|lotissement|r[ée]sidence|villa|hameau)\s+[\p{L}'’\- ]{2,45}?(?=,|\.|;|\s+\d{5}|\s+(?:à|a|et|qui|que|où|est|sont|pour|avec|chez)\b|$)(?:,?\s*\d{5}\s+\p{Lu}[\p{L}'’\-]+(?:[\s-]\p{Lu}[\p{L}'’\-]+)*)?/gu,
  postalCity: /(?<![\d])\d{5}\s+\p{Lu}[\p{L}'’\-]+(?:[\s-]\p{Lu}[\p{L}'’\-]+)*/gu,
};
