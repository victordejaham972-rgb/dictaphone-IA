// IA locale : quels modèles sont VALIDÉS sur cet appareil ? Rien n'est supposé : la validation vient des résultats de la sonde IA
// (rédaction d'un compte rendu à partir d'une transcription fictive, notée automatiquement), enregistrés sur cet appareil.
import { MODELS } from './ia-models.js';
import { getSettings, setSetting } from './store.js';

// Seuils de validation (sur la transcription fictive de test) : le modèle doit retrouver l'information, la classer dans la bonne
// rubrique, ne rien inventer, ne pas présenter une hypothèse comme une décision, et ne pas se contenter de recopier.
export const THRESHOLDS = { recall: 0.8, placement: 0.8, filled: 6, copy: 0.3 };
// Réglages de génération, choisis d'après les mesures du banc d'essai (4 transcriptions fictives, 9 modèles) :
// rédaction globale + consigne détaillée + glossaire. L'extraction de notes préalable et la consigne courte dégradent les résultats.
// Transcription longue (plus de maxChars) : notes par morceaux puis rédaction rubrique par rubrique (mesures plus fragiles).
export const GEN = { strategy: 'global', longStrategy: 'sections', promptStyle: 'v1', maxChars: 5500, forceNotes: false, glossary: true };
// Stratégie : propre au modèle si elle a été mesurée (voir ia-models.js), sinon réglage général.
export const strategyFor = (text, model) => (text.length > GEN.maxChars ? GEN.longStrategy : ((model && model.strategy) || GEN.strategy));
const RES = 'iaprobe_results';

export function probeResults() { try { return JSON.parse(localStorage.getItem(RES)) || []; } catch { return []; } }

export function passes(r) {
  return !!r && r.verdict === 'OK'
    && (r.hallucinatedNumbers || []).length === 0 && (r.promotedHypotheses || []).length === 0
    && r.recall >= THRESHOLDS.recall && (r.placement == null || r.placement >= THRESHOLDS.placement)
    && r.filled >= THRESHOLDS.filled && r.copyRatio <= THRESHOLDS.copy && r.uncertainOk !== false;
}

// Dernier résultat de chaque modèle, et validation
export function modelStatus() {
  const latest = {};
  for (const r of probeResults()) latest[r.id] = r; // les plus récents écrasent les plus anciens
  return MODELS.map((m) => ({ ...m, model: (latest[m.id] && latest[m.id].model) || m.model, probe: latest[m.id] || null, validated: passes(latest[m.id]) }));
}
export const validatedModels = () => modelStatus().filter((m) => m.validated);

// Réglages de l'utilisateur : IA locale activée + modèle choisi
export function localAiSettings() { const s = getSettings(); return { enabled: !!s.iaEnabled, modelId: s.iaModel || null }; }
export function setLocalAi({ enabled, modelId }) { if (enabled !== undefined) setSetting('iaEnabled', !!enabled); if (modelId !== undefined) setSetting('iaModel', modelId); }

// Moteur utilisable maintenant ? (activé ET modèle choisi toujours validé)
export function usableModel() {
  const st = localAiSettings();
  if (!st.enabled) return null;
  return validatedModels().find((m) => m.id === st.modelId) || null;
}
