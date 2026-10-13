// Catégories et trames d'origine. Les trames sont ensuite modifiables dans l'application.
// who* / subject* : champs servant à composer automatiquement le titre « Nom — Sujet — jj/mm/aaaa ».
export const CATEGORIES = [
  { id: 'clients', label: 'Entretiens clients', short: 'Clients', hint: 'Rendez-vous et échanges avec les clients',
    whoLabel: 'Nom du client', whoHint: 'Ex. Martin', subjectLabel: 'Sujet principal de l\'entretien', subjectHint: 'Ex. Bilan patrimonial', fallback: 'Entretien client' },
  { id: 'webinaires', label: 'Webinaires', short: 'Webinaires', hint: 'Conférences, formations, présentations',
    whoLabel: 'Société ou organisateur', whoHint: 'Ex. Société Exemple', subjectLabel: 'Sujet principal du webinaire', subjectHint: 'Ex. Perspectives des marchés', fallback: 'Webinaire' },
  { id: 'internes', label: 'Réunions internes', short: 'Internes', hint: 'Réunions, discussions et échanges avec les collaborateurs',
    whoLabel: 'Équipe ou personnes concernées (facultatif)', whoHint: 'Ex. Réunion équipe', subjectLabel: 'Objet principal de la réunion', subjectHint: 'Ex. Suivi des dossiers', fallback: 'Réunion interne' },
];
export const catInfo = (id) => CATEGORIES.find((c) => c.id === id) || null;
export const catLabel = (id) => (CATEGORIES.find((c) => c.id === id) || {}).label || 'Non classé';
export const catShort = (id) => (CATEGORIES.find((c) => c.id === id) || {}).short || 'Non classé';

const sec = (title, instruction, level) => ({ title, instruction, ...(level === 2 ? { level: 2 } : {}) });

// Consignes : elles guident la rédaction manuelle aujourd'hui, et serviront de consignes à une IA interne plus tard.
export const DEFAULT_TEMPLATES = [
  {
    // Trame de suivi patrimonial en six rubriques (sous-rubriques en retrait). Pas de « Non évoqué » : une rubrique sans information reste vide.
    id: 'tpl-clients-v2', category: 'clients', name: 'Entretien client', builtin: true, isDefault: true,
    sections: [
      sec('Patrimoine', 'Titre seul : pas de résumé général quand les sous-rubriques détaillent déjà les actifs.'),
      sec('Financier', 'Une puce par enveloppe ou placement, regroupant établissement, montant et répartition (ex. PEA 142 k€ : 70 % ETF World, 15 % Europe, solde émergents).', 2),
      sec('Immobilier', 'Une puce par bien ou crédit : valeur, capital restant dû, taux, mensualité, échéance, loyer, SCPI.', 2),
      sec('Professionnel / épargne salariale et retraite', 'Une puce par dispositif : entreprise ou activité, titres détenus, PEE, PERCOL, PER, retraite.', 2),
      sec('Situation', 'Situation familiale et professionnelle, revenus et fiscalité, contraintes et évolutions importantes.'),
      sec('Besoins', 'Objectifs exprimés, projets, contraintes et priorités.'),
      sec('Intérêts', 'Solutions envisagées, produits ou stratégies étudiés, pistes d\'arbitrage. Ce sont des pistes, pas des décisions.'),
      sec('Actions', 'Actions concrètes, documents à demander ou transmettre, responsabilités et échéances.'),
      sec('À garder en mémoire', 'Échéances futures, points en attente, sujets à reprendre.'),
    ],
  },
  {
    // Ancienne trame à neuf rubriques : conservée telle quelle (renommée, masquée par défaut, récupérable).
    id: 'tpl-clients', category: 'clients', name: 'Entretien client (ancienne trame, 9 rubriques)', builtin: true, isDefault: false,
    sections: [
      sec('Contexte du rendez-vous', 'Date, participants, motif et cadre de l\'échange.'),
      sec('Situation patrimoniale', 'Éléments de situation évoqués (famille, activité, actifs, passif). Ne retenir que ce qui a été dit.'),
      sec('Objectifs du client', 'Objectifs et priorités exprimés, avec les échéances éventuelles.'),
      sec('Sujets abordés', 'Principaux thèmes discutés, dans l\'ordre de l\'entretien.'),
      sec('Produits et solutions évoqués', 'Solutions, produits ou stratégies mentionnés. Distinguer ce qui est envisagé de ce qui est décidé.'),
      sec('Points de vigilance', 'Risques, réserves, contraintes, informations manquantes ou incertaines.'),
      sec('Décisions prises', 'Uniquement les décisions explicitement validées. Une hypothèse n\'est pas une décision.'),
      sec('Actions à réaliser', 'Action, responsable, échéance.'),
      sec('Prochaines étapes', 'Prochains rendez-vous et suites prévues.'),
    ],
  },
  {
    id: 'tpl-clients-detail', category: 'clients', name: 'Entretien client — bilan détaillé', builtin: true, isDefault: false,
    sections: [
      sec('Contexte du rendez-vous', 'Date, participants, motif et cadre de l\'échange.'),
      sec('Situation familiale et professionnelle', 'Famille (conjoint, enfants), profession, société, statut. Ne retenir que ce qui a été dit.'),
      sec('Revenus et charges', 'Revenus (salaires, dividendes, loyers) et charges (crédits, impôts, frais), avec les montants.'),
      sec('Patrimoine immobilier', 'Biens immobiliers (résidences, locatif, SCI) avec valeurs, crédits restants et loyers.'),
      sec('Épargne et placements financiers', 'Assurance-vie, PEA, PER, SCPI, livrets et comptes, avec les montants.'),
      sec('Fiscalité et transmission', 'Tranche d\'imposition, IFI, dispositifs évoqués, projets de donation ou de transmission.'),
      sec('Objectifs du client', 'Objectifs et priorités exprimés, avec les échéances éventuelles.'),
      sec('Produits et solutions évoqués', 'Pistes et stratégies mentionnées. Distinguer ce qui est envisagé de ce qui est décidé.'),
      sec('Décisions prises', 'Uniquement les décisions explicitement validées. Une hypothèse n\'est pas une décision.'),
      sec('Documents à récupérer', 'Pièces à fournir ou à demander, avec l\'échéance.'),
      sec('Actions à réaliser', 'Action, responsable, échéance.'),
      sec('Points de vigilance', 'Risques, réserves, informations manquantes, incertaines ou contradictoires.'),
      sec('Prochaines étapes', 'Prochain rendez-vous et suites prévues.'),
    ],
  },
  {
    id: 'tpl-premier-rdv', category: 'clients', name: 'Premier rendez-vous client', builtin: true, isDefault: false,
    sections: [
      sec('Contexte et motif du rendez-vous', 'Contient : date, participants, origine de la prise de contact (recommandation, réseau, événement), motif et attentes exprimées. Ne contient pas : informations patrimoniales détaillées.'),
      sec('Situation personnelle et familiale', 'Contient : situation familiale, régime matrimonial s\'il est cité, enfants et personnes à charge, projets familiaux. Ne retenir que ce qui a été dit.'),
      sec('Situation professionnelle et revenus', 'Contient : activité, statut, ancienneté, revenus et leur évolution prévue, éventuelle détention d\'entreprise. Ne contient pas : patrimoine détenu.'),
      sec('Patrimoine et engagements', 'Contient : actifs financiers, immobiliers et professionnels cités, crédits et charges, avec établissements, montants et dates seulement s\'ils sont dits. Indiquer « Non évoqué » pour ce qui manque.'),
      sec('Objectifs, projets et horizon', 'Contient : objectifs exprimés (retraite, transmission, protection de la famille, investissement, fiscalité), priorités et échéances. Ne contient pas : solutions proposées.'),
      sec('Profil de risque et préférences', 'Contient : attitude face au risque, expérience des placements, contraintes de liquidité, préférences exprimées. Ne rien déduire : écrire ce qui est dit.'),
      sec('Points de vigilance et informations manquantes', 'Contient : contraintes, réserves, incohérences, pièces ou informations à obtenir. Ne contient pas : actions déjà listées.'),
      sec('Pistes évoquées et prochaines étapes', 'Contient : pistes de travail évoquées (distinguer ce qui est une piste non décidée de ce qui est validé), documents à fournir, responsable et échéance seulement s\'ils sont dits, prochain rendez-vous.'),
    ],
  },  {
    id: 'tpl-suivi-patrimonial', category: 'clients', name: 'Suivi patrimonial — Family Office', builtin: true, isDefault: false,
    sections: [
      sec('Situation et actualités', 'Contient : situation familiale et professionnelle, événements récents (changement de poste, naissance, déménagement, vente, héritage), faits nouveaux depuis le dernier rendez-vous. Ne contient pas : montants de patrimoine, solutions, actions.'),
      sec('Patrimoine financier', 'Contient : assurance-vie, contrat de capitalisation, PEA, compte-titres, PER individuel, livrets, comptes bancaires, trésorerie, portefeuille, avec établissements, montants et dates. Ne contient pas : immobilier, SCPI, épargne salariale ou retraite d\'entreprise.'),
      sec('Patrimoine immobilier', 'Contient : résidences, biens locatifs, SCI, SCPI et OPCI, valeurs, crédits immobiliers, loyers, taxe foncière. Ne contient pas : placements financiers, épargne salariale.'),
      sec('Épargne salariale et retraite professionnelle', 'Contient : PEE, PERCO ou PER collectif, intéressement, participation, abondement, actions gratuites, stock-options, BSPCE, retraite supplémentaire d\'entreprise, avec montants et disponibilités. Ne contient pas : placements personnels du client.'),
      sec('Besoins et objectifs', 'Contient : besoins, projets et objectifs exprimés par le client (retraite, études des enfants, achat, transmission, revenus complémentaires), avec échéances. Ne contient pas : solutions proposées.'),
      sec('Solutions et pistes évoquées', 'Contient : solutions, produits et stratégies évoqués. Indiquer clairement ce qui est une piste non décidée et ce qui est une décision validée. Ne contient pas : actions à réaliser, informations descriptives.'),
      sec('Actions à réaliser', 'Contient : actions à mener, avec le responsable et l\'échéance seulement s\'ils sont dits explicitement. Ne contient pas : simples constats ou informations descriptives.'),
      sec('Points de suivi et échéances', 'Contient : prochain rendez-vous, éléments en attente, points à revoir, échéances et dates de rappel. Ne contient pas : actions déjà listées.'),
    ],
  },
  {
    id: 'tpl-webinaires', category: 'webinaires', name: 'Webinaire', builtin: true, isDefault: true,
    sections: [
      sec('Sujet du webinaire', 'Titre, organisateur, date.'),
      sec('Intervenants', 'Noms et fonctions des intervenants.'),
      sec('Principales informations', 'Informations clés présentées, dans l\'ordre.'),
      sec('Points techniques', 'Chiffres, dispositifs, références juridiques ou fiscales citées. Vérifier avant toute utilisation.'),
      sec('Enseignements', 'Ce qui est utile pour l\'activité du cabinet.'),
      sec('Points à retenir', 'Synthèse en quelques points.'),
      sec('Actions éventuelles', 'Suites à donner, vérifications à faire.'),
    ],
  },
  {
    id: 'tpl-internes', category: 'internes', name: 'Réunion interne', builtin: true, isDefault: true,
    sections: [
      sec('Objet de la réunion', 'Date, sujet et cadre.'),
      sec('Participants', 'Présents, absents et excusés.'),
      sec('Sujets abordés', 'Points discutés, dans l\'ordre.'),
      sec('Décisions prises', 'Uniquement les décisions explicites.'),
      sec('Tâches à réaliser', 'Tâche concernée.'),
      sec('Responsables', 'Personne en charge de chaque tâche.'),
      sec('Échéances', 'Date limite de chaque tâche.'),
      sec('Prochaines étapes', 'Prochaine réunion et points à suivre.'),
    ],
  },
];

// Corrections proposées par défaut pour la transcription (modifiables dans Réglages).
export const DEFAULT_VOCAB = [
  { from: 'assurance vie', to: 'assurance-vie' },
  { from: 'p e a', to: 'PEA' },
  { from: 'pea', to: 'PEA' },
  { from: 'sci', to: 'SCI' },
  { from: 'per', to: 'PER' },
  { from: 'scpi', to: 'SCPI' },
];
