// Modèles d'IA locale proposés au test (noms exacts du moteur WebLLM 0.2.85). Aucun n'est « validé » d'avance :
// un modèle n'est utilisable dans l'application que s'il réussit la sonde IA sur l'appareil concerné (voir ia-local.js).
// - model32 : variante sans la fonction graphique « shader-f16 » (plus lourde), utilisée automatiquement si l'appareil ne l'offre pas.
// - strategy : mode de rédaction qui a donné les meilleures mesures pour ce modèle (banc d'essai sur transcriptions fictives).
// - pc : modèle réservé aux ordinateurs disposant d'une carte graphique (mémoire trop importante pour un téléphone).
// - licence : relevée sur les fiches officielles des modèles le 2026-10-09 ; à faire valider par l'entreprise avant un usage professionnel.
export const MODELS = [
  { id: 'smol360', label: 'SmolLM2 · 360 millions (très petit)', model: 'SmolLM2-360M-Instruct-q4f32_1-MLC', mo: '0,6 Go', licence: 'Apache 2.0' },
  { id: 'gemma3-1b', label: 'Gemma 3 · 1 milliard', model: 'gemma3-1b-it-q4f16_1-MLC', strategy: 'sections', mo: '0,7 Go', licence: 'Conditions d\'utilisation Gemma' },
  { id: 'llama32-1b', label: 'Llama 3.2 · 1 milliard', model: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', model32: 'Llama-3.2-1B-Instruct-q4f32_1-MLC', mo: '0,9 Go', licence: 'Licence communautaire Llama 3.2 (« Built with Llama »)' },
  { id: 'qwen25-15b', label: 'Qwen 2.5 · 1,5 milliard', model: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', model32: 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC', strategy: 'global', mo: '1,6 Go', licence: 'Apache 2.0' },
  { id: 'qwen35-2b', label: 'Qwen 3.5 · 2 milliards', model: 'Qwen3.5-2B-q4f16_1-MLC', model32: 'Qwen3.5-2B-q4f32_1-MLC', strategy: 'sections', mo: '2,2 Go', licence: 'Apache 2.0' },
  { id: 'llama32-3b', label: 'Llama 3.2 · 3 milliards', model: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', model32: 'Llama-3.2-3B-Instruct-q4f32_1-MLC', strategy: 'global', mo: '2,3 Go', licence: 'Licence communautaire Llama 3.2 (« Built with Llama »)' },
  { id: 'qwen25-7b', label: 'Qwen 2.5 · 7 milliards (ordinateur)', model: 'Qwen2.5-7B-Instruct-q4f16_1-MLC', strategy: 'global', mo: '5,1 Go', pc: true, licence: 'Apache 2.0' },
];
export const modelById = (id) => MODELS.find((m) => m.id === id) || null;
