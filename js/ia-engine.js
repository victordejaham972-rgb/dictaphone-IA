// Moteurs d'IA locale utilisables par la rédaction de comptes rendus.
//  - « server » : un logiciel gratuit installé SUR CE MÊME ORDINATEUR (Ollama, LM Studio, llama.cpp…) qui répond à l'adresse
//    locale http://127.0.0.1:port. L'application refuse toute autre adresse : la transcription ne quitte jamais l'ordinateur.
//  - « webgpu » : modèle exécuté dans le navigateur (WebLLM), voir ia-page.js et ia-local.js.
// Les réglages (adresse, modèle) sont conservés sur l'appareil, comme les autres réglages.
import { getSettings, setSetting } from './store.js';

export const DEFAULT_URL = 'http://127.0.0.1:11434';          // Ollama
export const PRESETS = [
  { label: 'Ollama', url: 'http://127.0.0.1:11434' },
  { label: 'LM Studio', url: 'http://127.0.0.1:1234' },
  { label: 'llama.cpp', url: 'http://127.0.0.1:8080' },
];

export function engineSettings() {
  const s = getSettings();
  const kind = s.iaEngine === 'server' || s.iaEngine === 'webgpu' || s.iaEngine === 'none' ? s.iaEngine : (s.iaEnabled ? 'webgpu' : 'none');   // anciens réglages : IA du navigateur déjà activée
  return { kind, url: s.iaUrl || DEFAULT_URL, model: s.iaServerModel || '' };
}
export function setEngine(patch) {
  if (patch.kind !== undefined) setSetting('iaEngine', patch.kind);
  if (patch.url !== undefined) setSetting('iaUrl', patch.url);
  if (patch.model !== undefined) setSetting('iaServerModel', patch.model);
}

// L'adresse doit désigner cet ordinateur (localhost, 127.x.x.x ou ::1). Renvoie l'adresse nettoyée, ou lève une erreur claire.
export function cleanUrl(raw) {
  let u;
  try { u = new URL((raw || '').trim()); } catch { throw new Error('Adresse invalide. Exemple : http://127.0.0.1:11434'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('L\'adresse doit commencer par http://');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!(host === 'localhost' || /^127(\.\d{1,3}){3}$/.test(host) || host === '::1')) throw new Error('Pour protéger vos données, seule une adresse de CET ordinateur est acceptée (localhost ou 127.0.0.1).');
  return u.origin;
}

const withTimeout = async (url, init, ms) => {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctl.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' }); }
  catch (err) { if (err && err.name === 'AbortError') throw new Error('Le moteur ne répond pas (délai dépassé).'); throw err; }
  finally { clearTimeout(t); }
};

// Teste la connexion et liste les modèles installés. Reconnaît Ollama (API native) et les serveurs « compatibles OpenAI » (LM Studio, llama.cpp).
export async function probeServer(rawUrl) {
  const t0 = performance.now();
  let url;
  try { url = cleanUrl(rawUrl); } catch (e) { return { ok: false, error: e.message }; }
  try {
    const r = await withTimeout(url + '/api/tags', {}, 4000);
    if (r.ok) { const j = await r.json(); const models = (j.models || []).map((m) => m.name || m.model).filter(Boolean); return { ok: true, flavor: 'ollama', models, ms: Math.round(performance.now() - t0), url }; }
  } catch (e) { if (/délai/.test(e.message)) return { ok: false, error: e.message }; }
  try {
    const r = await withTimeout(url + '/v1/models', {}, 4000);
    if (r.ok) { const j = await r.json(); const models = (j.data || []).map((m) => m.id).filter(Boolean); return { ok: true, flavor: 'openai', models, ms: Math.round(performance.now() - t0), url }; }
    return { ok: false, error: `Le moteur répond (code ${r.status}) mais n'est pas reconnu.` };
  } catch (e) {
    return { ok: false, error: /Failed to fetch|NetworkError|Load failed/i.test(e.message) ? 'Aucun moteur ne répond à cette adresse. Vérifiez qu\'il est lancé, ou que son réglage d\'autorisation inclut l\'adresse de l\'application (voir l\'aide ci-dessous).' : e.message };
  }
}

// Fournit chat(messages, { maxTokens, temperature }) -> { text, usage } pour le moteur local.
export function serverChat({ url, model, flavor = 'openai', numCtx = 8192, timeoutMs = 300000 }) {
  const base = cleanUrl(url);
  return async (messages, { maxTokens = 400, temperature = 0.1 } = {}) => {
    let r;
    if (flavor === 'ollama') {
      r = await withTimeout(base + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: false, think: false, options: { temperature, num_predict: maxTokens, num_ctx: numCtx } }) }, timeoutMs);
      if (!r.ok) throw new Error('Le moteur a refusé la demande (code ' + r.status + ') : ' + (await r.text()).slice(0, 160));
      const j = await r.json();
      return { text: (j.message && j.message.content) || '', usage: { prompt_tokens: j.prompt_eval_count || 0, completion_tokens: j.eval_count || 0 } };
    }
    r = await withTimeout(base + '/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature, stream: false, chat_template_kwargs: { enable_thinking: false } }) }, timeoutMs);
    if (!r.ok) throw new Error('Le moteur a refusé la demande (code ' + r.status + ') : ' + (await r.text()).slice(0, 160));
    const j = await r.json();
    return { text: (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '', usage: j.usage || {} };
  };
}
