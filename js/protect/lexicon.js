// Pseudonymisation locale : lexiques et indices de contexte. Tout est modifiable ; rien n'est téléchargé.
import { fold } from './patterns.js';

// Prénoms courants (liste intégrée, volontairement courte : à compléter avec le fichier INSEE des prénoms après autorisation).
// Les prénoms qui sont aussi des noms communs (Rose, Marin, Pierre, Olive, Fleur…) sont exclus pour éviter les faux positifs.
const PRENOMS_TXT = `
adele adeline adrien agathe agnes aimee alain alexandra alexandre alexis alice alicia aline alix amandine amelie anais andre andrea anne annie anthony antoine antonin apolline arnaud arthur aude audrey aurelie aurelien axel
barbara baptiste benjamin benoit bernard bertrand brigitte bruno camille capucine carine carole caroline catherine cecile cedric celine chantal charles charlotte christelle christian christiane christine christophe claire clara claude claudine clement clementine colette corinne cyril cyrille
damien daniel danielle david delphine denis denise didier dominique dorothee edouard eleonore elisa elisabeth elise elodie emeline emile emilie emma emmanuel emmanuelle eric erwan estelle etienne eugenie eva fabien fabienne fabrice felix florence florent florian francois francoise frederic frederique gabriel gabrielle gaelle gaetan genevieve geoffrey georges gerard gilbert gilles ghislaine gregoire gregory guillaume gustave guy
helene henri herve hugo hugues ines irene isabelle jacqueline jacques jean jeanne jeremie jerome joel johan jonathan joseph josephine jules julia julie julien juliette justine karine kevin laetitia laura laure laurence laurent lea leo leon leonie liliane lionel lise louis louise luc lucas lucie lucile ludovic lydie
madeleine magali manon marc marcel marguerite maria marianne marie marielle marine marion martine mathieu mathilde matthieu maurice maxime melanie melissa michel michele mickael mireille monique morgane
nadia nadine nathalie nathan nicolas nicole noemie odette olivia olivier oriane pascal pascale patrice patricia patrick paul paulette pauline philippe pierrick quentin rachel raphael raymond raymonde regis remi remy renaud rene richard robert rodolphe roger romain romane ronan sabine sabrina samuel sandra sandrine sebastien serge severine simon simone solange sonia sophie stanislas stephane stephanie suzanne sylvain sylvie
tanguy teddy thibault thierry thomas timothee tiphaine valentin valerie vanessa veronique victor victoire victorine vincent violette virginie vivien xavier yann yannick yvan yves yvette yvonne zoe
abdel ahmed amine amir ali fatima farid hassan karim khadija leila mehdi mohamed mohammed nadir nora omar rachid samir sofia yasmine youssef
anna carlos elena giovanni giulia john jose juan laura luca marco maria mario michael peter sara thomas william
`;
export const PRENOMS = new Set(PRENOMS_TXT.split(/\s+/).filter(Boolean));

// Prénoms qui sont aussi des mots courants souvent écrits avec une majuscule en début de phrase : jamais retenus seuls (« Grâce à… », « Rose »),
// mais acceptés après une civilité ou suivis d'un nom (« Rose Lenoir »).
export const ISOLATED_DENY = new Set(['ben', 'grace', 'rose', 'blanche', 'marin', 'olive', 'fleur', 'prune', 'constant', 'victoire', 'noel', 'france', 'ange', 'honore', 'lilas', 'violette', 'marguerite', 'paris',
  'lorraine', 'prince', 'innocent', 'fidele', 'ocean', 'aurore', 'jade', 'sage', 'romain', 'avril', 'mai', 'florence', 'nancy', 'eden', 'amour', 'bella', 'clemence', 'patience', 'prudence', 'felicite',
  'joyeux', 'colin', 'regis', 'germain']);

// Noms de famille qui sont aussi des mots courants : écrits en minuscules, ils ne sont pas pris pour un nom (« un petit portefeuille »)
export const COMMON_WORDS = new Set(['petit', 'petite', 'blanc', 'blanche', 'roux', 'brun', 'fort', 'joly', 'jolie', 'gros', 'grand', 'bon', 'clerc', 'maitre', 'meunier', 'boulanger', 'marchand', 'berger', 'boucher',
  'charpentier', 'vigneron', 'chevalier', 'noir', 'rouge', 'vert', 'blond', 'lenoir', 'legrand', 'lebrun', 'leblanc', 'francois', 'martin', 'noel', 'clair', 'doux', 'lecomte', 'prince', 'roy', 'masson', 'fontaine', 'devaux', 'moulin', 'perrin', 'garnier', 'dupont']);

// Mots capitalisés qui ne sont pas des noms de personnes
export const NOT_NAME = new Set(['le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'ou', 'en', 'au', 'aux', 'ce', 'cet', 'cette', 'ces', 'mon', 'ma', 'mes', 'son', 'sa', 'ses', 'notre', 'nos', 'votre', 'vos', 'leur', 'leurs',
  'oui', 'non', 'bonjour', 'merci', 'alors', 'donc', 'mais', 'pour', 'avec', 'dans', 'sur', 'sous', 'chez', 'par', 'sans', 'tres', 'bien', 'voila', 'parfait', 'dac', 'ok', 'madame', 'monsieur', 'mademoiselle',
  'janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche',
  'france', 'europe', 'paris', 'euro', 'euros', 'ifi', 'pea', 'per', 'scpi', 'sci', 'sas', 'sarl', 'tva', 'csg', 'crds', 'tmi', 'livret', 'assurance', 'premierement', 'deuxiemement', 'troisiemement', 'enfin', 'ensuite', 'sinon']);

// Mots d'état civil et de relation qui précèdent souvent un nom propre
export const TITLES_RE = '(?:M\\.|Mme|Mlle|Monsieur|Madame|Mademoiselle|Ma[iî]tre|Me|Docteur|Dr|Professeur|Pr)';
export const KINSHIP_RE = '(?:mari|femme|[ée]pous[ea]|[ée]poux|fils|fille|fr[èe]re|s[œo]eur|p[èe]re|m[èe]re|conjoint(?:e)?|compagnon|compagne|ami(?:e)?|coll[èe]gue|neveu|ni[èe]ce|cousin(?:e)?|beau-fr[èe]re|belle-s[œo]eur|gendre|belle-fille|petit-fils|petite-fille|associ[ée](?:e)?|voisin(?:e)?|patron(?:ne)?|comptable|notaire|avocat(?:e)?|banquier|conseiller|conseill[èe]re|m[ée]decin|g[ée]rant(?:e)?|expert-comptable|h[ée]ritier|h[ée]riti[èe]re)';

// ---------- Indices de rôle d'une entreprise (appliqués au texte SANS accents ni majuscules, voir fold()) ----------
// Contexte gauche : mots situés juste avant le nom (se termine par la préposition qui introduit le nom).
export const CUE = {
  employerLeft: [
    /(?:travaill\w*|salari\w*|employ\w*|ingenieu\w*|cadre|embauch\w*|recrut\w*|licenci\w*|retrait\w*|stagiair\w*|alternan\w*|detache\w*|muté\w*|mute\w*|collaborat\w*|poste|carriere|mission\w*)\b[^.;:!?]{0,40}\b(?:chez|pour|par|a|au|aux|dans|au sein de|au sein du|au sein d)\s+(?:la\s+|le\s+|l'|les\s+)?(?:societe\s+|entreprise\s+|groupe\s+|boite\s+)?$/,
    /(?:directeu\w*|directri\w*|responsable|president\w*|pdg|gerant\w*|fondateu\w*|fondatri\w*|dirigeant\w*|associe\w*|ceo|cfo|daf|drh|manager|chef)\b[^.;:!?]{0,35}\b(?:de|d'|du|chez)\s*(?:la\s+|le\s+|l'|les\s+)?(?:societe\s+|groupe\s+|entreprise\s+)?$/,
    /\b(?:mon|son|sa|notre|leur|ton|ta)\s+(?:employeur|entreprise|societe|boite|groupe|patron|direction)\s*(?:actuel(?:le)?\s*)?(?:est|c'est|s'appelle|=|:|,)?\s*$/,
    /\b(?:ancien(?:ne)?\s+(?:salarie|employe|collaborat\w*)|ex[- ]salarie\w*)\s+(?:de|d'|du|chez)\s*(?:la\s+|le\s+|l')?$/,
    /\b(?:chez)\s+(?:son|leur|mon)\s+employeur\s*$/,
  ],
  employerRight: [
    /^\s*(?:ou|où)\s+(?:elle|il|je|nous|ils|elles)\s+(?:travaill|est salarie|est employe)/,
    /^\s*(?:est|etait|reste)\s+(?:son|mon|leur|notre)\s+employeur/,
    /^\s*(?:depuis\s+(?:\d+\s+ans|\d{4}|longtemps)|ou\s+elle\s+travaille)\b.*$/,
  ],
  // Indice financier à gauche : le nom est un titre, un produit ou un établissement
  financeLeft: [
    /(?:pret|prets|credit|credits|emprunt|hypotheque|financement|decouvert)\b[^.;!?]{0,60}\b(?:aupres de|aupres d'|aupres du|chez|a la|au|a l')\s*(?:la\s+|le\s+|l')?$/,
    /\b(?:contrat|contrats|police|assurance|assurances|mutuelle|prevoyance|couverture)\s*(?:de\s+|d')?$/,
    /(?:action|actions|titre|titres|part|parts|obligation|obligations|etf|tracker|portefeuille|ligne|position|valeur|valeurs|cours|dividende|dividendes|coupon|investi\w*|souscri\w*|detien\w*|detenu\w*|poss[ei]d\w*|acquis\w*|achet\w*|vend\w*|cede\w*|arbitr\w*|exposition|exposee?s?)\b[^.;!?]{0,35}\b(?:de|d'|du|des|sur|dans|en|chez|a|aupres de)?\s*(?:la\s+|le\s+|l'|les\s+)?$/,
    /(?:assurance[- ]?vie|assurance vie|contrat|capitalisation|per|perp|madelin|epargne|compte|livret|pea|pea-pme|cto|compte[- ]titres|placement\w*|enveloppe|support)\b[^.;!?]{0,35}\b(?:chez|aupres de|aupres d'|ouvert\w*\s+(?:chez|a)|souscrit\w*\s+(?:chez|aupres de)|gere\w*\s+(?:chez|par)|de la|de l'|du|de)\s*$/,
    /(?:fonds?|sicav|scpi|opci|opcvm|fcp|fip|fcpi|fcpr|etf|mandat|gestion|gestionnaire|societe de gestion|gere\w*|geree?s?)\b[^.;!?]{0,35}\b(?:de|d'|du|chez|par|gere\w*\s+par|geree?s?\s+par)?\s*$/,
    /(?:banque|banquier|courtier|plateforme|assureur|compagnie d'assurance|etablissement)\b[^.;!?]{0,25}\b(?:est|c'est|=|:|,|chez|de|d')?\s*$/,
  ],
  financeRight: [
    /^\s*(?:est|etait)\s+(?:notre|son|mon|leur)?\s*(?:assureur|banque|banquier|gestionnaire|courtier|etablissement)/,
    /^\s*(?:vie|patrimoine|capitalisation|epargne|actions?|obligations?|etf|ucits)\b/,
    /^\s*(?:msci|ftse|stoxx|cac|eur|usd)\b/,
  ],
  // Cas où un nom d'entreprise n'est PAS la société du client mais bien son titre coté (parts de société personnelle)
  ownCompanyLeft: [
    /\b(?:ma|sa|notre|leur|mon|son)\s+(?:societe|holding|entreprise|sas|sarl|sci|eurl|sasu|structure|boite|cabinet)\s*(?:s'appelle|est|c'est|=|:|,|qui s'appelle)?\s*$/,
    /\b(?:holding|societe|entreprise|sas|sarl|sci|eurl|sasu|cabinet)\s+(?:nommee?|appelee?|denommee?)\s*$/,
  ],
};

// Mots d'entreprise qui sont aussi des mots courants : le nom n'est retenu comme entreprise que s'il y a un indice dans la phrase.
export const AMBIGUOUS_COMMON = new Set(['total', 'orange', 'casino', 'meta', 'apple', 'shell', 'bic', 'seb', 'sap', 'ing', 'bp', 'elis', 'ipsos', 'spie', 'accor', 'atos', 'alten', 'engie', 'edf', 'legrand', 'safran', 'veolia', 'vinci', 'hermes', 'kering', 'danone', 'sanofi',
  'michelin', 'publicis', 'renault', 'capgemini', 'carrefour', 'thales', 'rexel', 'nexans', 'valeo', 'arkema', 'gecina', 'lazard', 'fidelity', 'vanguard', 'moneta', 'corum', 'voisin', 'primonial', 'echiquier', 'alphabet', 'amazon', 'tesla', 'ferrari', 'adidas', 'diageo', 'roche', 'siemens', 'novartis', 'bmw']);
// Dont seuls ces mots sont réellement ambigus avec le vocabulaire courant (à l'initiale majuscule en milieu de phrase, les autres sont retenus)
export const REALLY_COMMON = new Set(['total', 'orange', 'casino', 'meta', 'apple', 'shell', 'bic', 'seb', 'sap', 'ing', 'bp', 'moneta', 'corum', 'voisin', 'echiquier', 'amazon', 'alphabet', 'lazard']);

// Régions et départements (niveau Renforcé : lieu de résidence ou d'activité). Les points cardinaux seuls ne sont jamais retenus.
export const GEO_NAMES = ('Auvergne-Rhône-Alpes|Bourgogne-Franche-Comté|Bretagne|Centre-Val de Loire|Corse|Grand Est|Hauts-de-France|Île-de-France|Normandie|Nouvelle-Aquitaine|Occitanie|Pays de la Loire|Provence-Alpes-Côte d\'Azur|' +
  'Ain|Aisne|Allier|Alpes-de-Haute-Provence|Hautes-Alpes|Alpes-Maritimes|Ardèche|Ardennes|Ariège|Aube|Aude|Aveyron|Bouches-du-Rhône|Calvados|Cantal|Charente|Charente-Maritime|Cher|Corrèze|Côte-d\'Or|Côtes-d\'Armor|Creuse|Dordogne|Doubs|Drôme|Eure|Eure-et-Loir|Finistère|Gard|Haute-Garonne|Gers|Gironde|Hérault|Ille-et-Vilaine|Indre|Indre-et-Loire|Isère|Jura|Landes|Loir-et-Cher|Loire|Haute-Loire|Loire-Atlantique|Loiret|Lot|Lot-et-Garonne|Lozère|Maine-et-Loire|Manche|Marne|Haute-Marne|Mayenne|Meurthe-et-Moselle|Meuse|Morbihan|Moselle|Nièvre|Oise|Orne|Pas-de-Calais|Puy-de-Dôme|Pyrénées-Atlantiques|Hautes-Pyrénées|Pyrénées-Orientales|Bas-Rhin|Haut-Rhin|Rhône|Haute-Saône|Saône-et-Loire|Sarthe|Savoie|Haute-Savoie|Seine-Maritime|Seine-et-Marne|Yvelines|Deux-Sèvres|Somme|Tarn|Tarn-et-Garonne|Var|Vaucluse|Vendée|Vienne|Haute-Vienne|Vosges|Yonne|Territoire de Belfort|Essonne|Hauts-de-Seine|Seine-Saint-Denis|Val-de-Marne|Val-d\'Oise|Alsace|Aquitaine|Auvergne|Bourgogne|Champagne|Languedoc|Limousin|Lorraine|Picardie|Poitou|Provence|Savoie|Pays basque|Côte d\'Azur|Riviera').split('|');

// Fonctions dirigeantes (Renforcé) et événements de vie
export const JOB_RE = "(?:directeur(?:\\s+g[ée]n[ée]ral)?|directrice(?:\\s+g[ée]n[ée]rale)?|directeur\\s+financier|directrice\\s+financi[èe]re|pr[ée]sident(?:e)?(?:[-\\s]directeur\\s+g[ée]n[ée]ral)?|pdg|daf|drh|dsi|ceo|cfo|coo|g[ée]rant(?:e)?|fondateur|fondatrice|associ[ée](?:e)?[-\\s]g[ée]rant(?:e)?|chef\\s+d'entreprise|dirigeant(?:e)?|vice-pr[ée]sident(?:e)?)";
export const LIFE_EVENT_LEFT = /(?:mari[ée]\w*|mariage|divorc\w*|d[ée]c[ée]d\w*|d[ée]c[èe]s|naissance|n[ée]e?|vendu\w*|vente|achet\w*|acquisition|sign\w*|promesse|h[ée]ritage|donation|retrait\w*|licenci\w*|embauch\w*)\b[^.;!?]{0,75}$/i;

// Construit les index du dictionnaire financier (JSON modifiable par l'utilisateur).
export function buildLexicon(dict) {
  const entries = []; // { name, aliases[], role, employerFrequent }
  for (const g of (dict && dict.groupes) || []) {
    for (const n of g.noms || []) {
      const parts = String(n).split('|').map((s) => s.trim()).filter(Boolean);
      if (!parts.length) continue;
      entries.push({ name: parts[0], aliases: parts, role: g.role, employerFrequent: !!g.employeurFrequent });
    }
  }
  const aliasMap = new Map();
  for (const e of entries) for (const a of e.aliases) { const k = fold(a).trim(); if (k && !aliasMap.has(k)) aliasMap.set(k, e); }
  const aliases = [...aliasMap.keys()].sort((a, b) => b.length - a.length);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const rx = aliases.length ? new RegExp("(?<![\\p{L}\\p{N}])(?:" + aliases.map(esc).join('|') + ")(?![\\p{L}\\p{N}])", 'gu') : null;
  return { entries, aliasMap, rx };
}
