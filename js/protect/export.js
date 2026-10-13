// Préparation du texte à copier vers une IA externe (ChatGPT ou autre) : instructions de rédaction + trame + transcription PROTÉGÉE.
// Le texte produit ne contient jamais de table de correspondance, ni les termes originaux masqués, ni le titre de la fiche.
// Rien n'est envoyé par l'application : c'est vous qui collez le texte, après avoir lu l'avertissement.

export const AVERTISSEMENT_COPIE = [
  'Ce texte est pseudonymisé, pas anonyme : montants, produits, situation familiale ou professionnelle peuvent encore permettre de reconnaître une personne.',
  'Relisez-le en entier avant de le coller. L\'application ne peut pas garantir qu\'aucune information identifiante n\'a échappé à la détection.',
  'Vérifiez que votre compte ChatGPT ou l\'outil utilisé n\'entraîne pas ses modèles sur vos conversations (réglages de données, chat temporaire) et que votre entreprise autorise cet usage.',
  'Rien n\'est envoyé par l\'application : le texte est seulement copié dans le presse-papiers. Sur iPhone et Mac, le presse-papiers peut être partagé avec vos autres appareils.',
];

export function instructionsBlock({ dateLabel = '' } = {}) {
  return [
    'Tu es l\'assistant d\'un conseiller en gestion de patrimoine (Family Office). Ci-dessous : la transcription brute d\'un entretien, déjà pseudonymisée, et la trame de la fiche de suivi patrimonial à produire. Ton rôle : en tirer une FICHE DE TRAVAIL de conseiller, très synthétique, et non un inventaire phrase par phrase.',
    '',
    'STYLE : NOTES PROFESSIONNELLES COURTES',
    '- Écris en français, en puces courtes (« - »), style de notes de conseiller : phrases nominales, abréviations courantes (AV, PEA, PER, PEE, PERCOL, SCPI, CTO, TMI, RP, CRD).',
    '- Une à trois puces par sujet quand cela suffit. Regroupe dans UNE seule puce les informations liées (enveloppe + établissement + montant + répartition), sépare-les par « : », « , » ou « ; ».',
    '- Exemple de style attendu. Au lieu de quatre puces (« PEA Fortuneo : valorisation environ 142 000 € », « Allocation PEA : ETF MSCI World 70 % », « ETF Europe : 15 % », « Solde en marchés émergents »), écris : « PEA Fortuneo 142 k€ : 70 % ETF World, 15 % Europe, solde émergents ». Même logique pour les assurances-vie, les crédits, les revenus et les autres placements.',
    '- Supprime les répétitions. Aucun développement inutile, aucune formule de politesse, aucun récit chronologique de l\'entretien.',
    '- Priorité aux éléments utiles au suivi patrimonial. Dans « Patrimoine », ne fais AUCUN résumé général si les sous-rubriques détaillent déjà les actifs : écris seulement le titre, puis les sous-rubriques.',
    '- Pas de tableau, pas de gras, pas de longs paragraphes : uniquement des titres et des listes à puces.',
    `- Écris chaque titre de rubrique seul sur sa ligne, exactement comme dans la trame, suivi de deux-points (« Patrimoine : », « Financier : »…), sans numéro ni symbole Markdown, en texte brut, avec un retour à la ligne après chaque titre et chaque puce. Place les sous-rubriques sous leur rubrique, dans l'ordre de la trame.${dateLabel ? ` Commence la fiche par la ligne « Maj du ${dateLabel} ».` : ''}`,
    '- N\'écris que les rubriques et sous-rubriques pour lesquelles la transcription apporte une information. Pas de listes « Non évoqué » : une rubrique sans information est omise ou laissée vide.',
    '',
    'FIDÉLITÉ : SYNTHÉTISER SANS RIEN PERDRE D\'ESSENTIEL',
    '- N\'utilise que ce qui figure dans la transcription. N\'invente aucun montant, date, taux, valorisation, nom, produit, décision, conseil ni recommandation.',
    '- Conserve tous les chiffres et informations réellement importants : montants et valorisations, taux, dates et échéances, noms des produits et des sociétés financières, contraintes professionnelles, risques et points de vigilance, décisions prises, actions à réaliser, points à suivre.',
    '- Conserve les nuances d\'incertitude (environ, à confirmer, envisagé, prévu, en attente). Signale brièvement par « à confirmer » les seuls points importants qui paraissent incertains, contradictoires ou incomplets.',
    '- Distingue clairement : les besoins exprimés, les intérêts ou pistes évoquées (non décidées), les décisions prises et les actions à réaliser. Ne présente JAMAIS une piste ou une idée comme une opération validée, ni une information descriptive comme une action.',
    '',
    'TRANSCRIPTION SANS IDENTIFICATION DES INTERVENANTS ; ATTRIBUTION DES ACTIONS',
    '- La transcription est brute (dictée automatique) : ponctuation imparfaite, erreurs de dictée, phrases incomplètes, interlocuteurs non identifiés. N\'invente pas qui parle.',
    '- N\'écris jamais « Client : » ni « Conseiller : » en tête de puce. N\'attribue une action, une décision ou une demande à une personne (client, conjoint, conseiller) que si le contenu l\'établit clairement.',
    '- Si l\'attribution est incertaine : formulation neutre (« Transmettre le dernier avis d\'imposition », « PEA jeune à ouvrir : 1 000 € »), ou « responsable à confirmer » seulement si c\'est important. Les actions doivent rester concrètes et exploitables (quoi, quand si dit).',
    '- Garde les faits certains même si leur auteur est incertain.',
    '',
    'PSEUDONYMES',
    '- Les étiquettes comme « Client A », « Personne B », « Entreprise A », « Ville A », « Produit A » ou « Information masquée A » remplacent des informations masquées. Ne cherche jamais à deviner ni à reconstituer les identités réelles ; reprends l\'étiquette telle quelle, sans la compléter ni la transformer.',
    '- Ne supprime pas une information patrimoniale au motif qu\'elle est liée à une personne ou à une société pseudonymisée : garde-la.',
    '',
    'DESTINATION : FICHE CRM DU CLIENT',
    '- Le compte rendu sera copié dans la fiche CRM du client concerné : il est inutile de répéter « Client A », « le client » ou son nom. Écris à la forme impersonnelle, sans sujet : « Résidence principale à Ville A », « Appartement locatif à Ville B », « Projet de résidence secondaire à Ville C », « PEA Fortuneo : 142 k€, principalement ETF World » — et non « Client A possède… », « Client A souhaite… », « Client A envisage… ».',
    '- Conserve en revanche les distinctions indispensables entre le client, son conjoint, ses enfants, ses associés ou d\'autres personnes quand le rôle ou la propriété d\'un actif compte (« PEA du conjoint : … », « Assurance-vie des enfants : … »). N\'attribue jamais au client un actif qui appartient à une autre personne par simplification, ni l\'inverse ; si le titulaire est incertain, ne le précise pas et ajoute « titulaire à confirmer » seulement si c\'est important.',
    '- Quand une autre personne doit être distinguée, désigne-la par son rôle (« le conjoint », « l\'aîné », « l\'associé ») ; n\'utilise une étiquette (« Personne B ») que si le rôle est inconnu ou si plusieurs personnes ont le même rôle.',
  ].join('\n');
}

// Trame hiérarchique : 1. Rubrique / 1.1 Sous-rubrique (section.level === 2).
export function trameBlock(template) {
  let n = 0, sub = 0;
  const lines = (template.sections || []).map((s) => {
    let num;
    if (s.level === 2 && n > 0) num = `   ${n}.${++sub}`; else { n++; sub = 0; num = `${n}.`; }
    return `${num} ${s.title}${s.instruction ? ' — ' + s.instruction : ''}`;
  });
  return ['TRAME DE LA FICHE : ' + template.name, ...lines].join('\n');
}

// Date au format AAMMJJ (ex. 7 octobre 2026 → 261007), pour la ligne « Maj du … ».
export function dateAAMMJJ(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return String(d.getFullYear() % 100).padStart(2, '0') + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
}

export function buildPrompt({ template, categoryLabel = '', protectedText, dateMs = null }) {
  return [
    instructionsBlock({ dateLabel: dateMs ? dateAAMMJJ(dateMs) : '' }), '',
    trameBlock(template), '',
    'TYPE D\'ENTRETIEN : ' + (categoryLabel || 'non précisé'), '',
    'TRANSCRIPTION PSEUDONYMISÉE',
    '"""',
    protectedText.trim(),
    '"""',
  ].join('\n');
}
