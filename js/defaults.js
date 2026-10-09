// Catégories et trames d'origine. Les trames sont ensuite modifiables dans l'application.
export const CATEGORIES = [
  { id: 'clients', label: 'Entretiens clients', short: 'Clients', hint: 'Rendez-vous et échanges avec les clients' },
  { id: 'webinaires', label: 'Webinaires', short: 'Webinaires', hint: 'Conférences, formations, présentations' },
  { id: 'internes', label: 'Réunions internes', short: 'Internes', hint: 'Réunions, discussions et échanges avec les collaborateurs' },
];
export const catLabel = (id) => (CATEGORIES.find((c) => c.id === id) || {}).label || 'Non classé';
export const catShort = (id) => (CATEGORIES.find((c) => c.id === id) || {}).short || 'Non classé';

const sec = (title, instruction) => ({ title, instruction });

// Consignes : elles guident la rédaction manuelle aujourd'hui, et serviront de consignes à une IA interne plus tard.
export const DEFAULT_TEMPLATES = [
  {
    id: 'tpl-clients', category: 'clients', name: 'Entretien client', builtin: true, isDefault: true,
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
