// Sonde IA : rédige un compte rendu à partir d'une transcription FICTIVE avec un modèle exécuté sur l'appareil,
// note automatiquement le résultat et détecte les plantages (écran blanc) grâce à un repère écrit avant chaque étape.
import * as webllm from './vendor/web-llm.js';
import { generateReport, withTimeout } from './js/ia-core.js';
import { scoreCase } from './js/ia-score.js';
import { DEFAULT_TEMPLATES } from './js/defaults.js';
import { MODELS } from './js/ia-models.js';
import { GEN, strategyFor } from './js/ia-local.js';

const $ = (id) => document.getElementById(id);
const TRANSCRIPT = "Bonjour Monsieur Exemple, merci d'être venu. Alors comme convenu, on fait le point sur votre situation. Je rappelle que vous avez cinquante-huit ans, vous êtes marié et vous avez deux enfants, Léa qui est étudiante et Hugo qui travaille déjà. Très bien. Donc côté patrimoine, vous avez une assurance vie d'environ 120 000 euros ouverte il y a douze ans, un pea de 45 000 euros, et un per dont je ne connais pas le montant exact. Oui alors le per je ne sais plus exactement, peut-être 18 000 ou 20 000 euros, il faudra que je regarde le dernier relevé. D'accord, on notera que c'est à confirmer. Vous avez aussi la résidence principale, estimée à 450 000 euros, sans crédit, et un appartement locatif à Lyon d'une valeur de 210 000 euros avec un crédit restant de 60 000 euros. Votre épouse perçoit un salaire net de 4 500 euros par mois, et vous 6 200 euros. Alors quels sont vos objectifs ? Mon premier objectif c'est de partir à la retraite à 62 ans en gardant un niveau de vie équivalent. Le deuxième c'est de préparer la transmission à nos deux enfants sans pénaliser la fiscalité. D'accord. Sur la retraite, on pourrait envisager d'augmenter les versements sur le per pour réduire l'impôt cette année, par exemple 10 000 euros, mais ce n'est qu'une piste, je n'ai pas encore fait la simulation. Oui je préfère voir les chiffres avant de décider. Sur l'allocation, aujourd'hui l'assurance vie est investie à 70 % en fonds euros et 30 % en unités de compte. On pourrait imaginer un arbitrage de 30 000 euros des fonds euros vers les unités de compte pour dynamiser, mais je vous le dis clairement, ce n'est pas une recommandation à ce stade, c'est une hypothèse à étudier. Ça me semble risqué, je n'ai pas envie de prendre trop de risque avant ma retraite. On est d'accord. Concernant la transmission, on pourrait regarder les donations aux enfants et la clause bénéficiaire de l'assurance vie, à vérifier avec le notaire. Alors décisions : on maintient l'allocation actuelle de l'assurance vie jusqu'à septembre, aucun arbitrage pour l'instant. Et on étudie la piste per sans engagement. Pour les actions : je vous envoie une simulation fiscale avant le 15 novembre, et vous me transmettez votre dernier avis d'imposition et le relevé du per avant le 8 novembre. Prochain rendez-vous le 21 novembre à dix heures. Un dernier point de vigilance : le locatif à Lyon représente une part importante du patrimoine sur un seul bien, on y reviendra. Parfait, merci.";
const GOLD = { facts: [['assurance-vie 120 000', '120\\s?000'], ['PEA 45 000', '45\\s?000'], ['PER montant', '18\\s?000|20\\s?000'], ['résidence 450 000', '450\\s?000'], ['locatif 210 000', '210\\s?000'], ['crédit 60 000', '60\\s?000'], ['salaire 4 500', '4\\s?500'], ['salaire 6 200', '6\\s?200'], ['retraite 62 ans', '62'], ['transmission', 'transmission'], ["maintien allocation jusqu'en septembre", 'septembre'], ['simulation avant le 15 novembre', '15\\s+novembre'], ['documents avant le 8 novembre', '8\\s+novembre'], ['rendez-vous 21 novembre', '21\\s+novembre'], ['vigilance locatif', 'un seul bien|concentr|part importante']],
  hypotheses: [{ pattern: '30\\s?000', label: 'arbitrage 30 000 présenté comme décision' }, { pattern: '10\\s?000', label: 'versement PER 10 000 présenté comme décision' }],
  uncertain: { pattern: '18\\s?000|20\\s?000', cue: 'confirmer|environ|peut-être|incertain|vérifier|exact|ou 20' },
  sections: { 'Situation patrimoniale': { must: ['120\\s?000', '45\\s?000', '450\\s?000'], mustNot: [] }, 'Objectifs du client': { must: ['62', 'transmission'], mustNot: ['15\\s+novembre', '8\\s+novembre'] }, 'Points de vigilance': { must: ['un seul bien|concentr|part importante|Lyon'], mustNot: ['62\\s?ans'] }, 'Décisions prises': { must: ['septembre'], mustNot: ['30\\s?000', '10\\s?000', '62\\s?ans', '450\\s?000', 'retraite'] }, 'Actions à réaliser': { must: ['15\\s+novembre', '8\\s+novembre'], mustNot: ['62\\s?ans', '450\\s?000'] }, 'Prochaines étapes': { must: ['21\\s+novembre'], mustNot: ['450\\s?000', '62\\s?ans'] } } };
const TEMPLATE = DEFAULT_TEMPLATES.find((t) => t.id === 'tpl-clients');

const PRESETS = MODELS.map((m, i) => ({ id: m.id, label: (i + 1) + '. ' + m.label, model: m.model, model32: m.model32, strategy: m.strategy, mo: '≈ ' + m.mo }));
let hasF16 = false;

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const RES = 'iaprobe_results', MK = 'iaprobe_marker';
const results = store.get(RES, []);
let envText = '';

async function showEnv() {
  const r = [`Navigateur : ${navigator.userAgent}`, `WebGPU : ${navigator.gpu ? 'API présente' : 'ABSENT'}`];
  if (navigator.gpu) {
    try {
      const a = await navigator.gpu.requestAdapter();
      if (a) hasF16 = a.features.has('shader-f16');
      if (a) r.push(`  shader-f16 : ${a.features.has('shader-f16')}`, `  maxBufferSize : ${Math.round(a.limits.maxBufferSize / 1048576)} Mo`, `  maxStorageBufferBindingSize : ${Math.round(a.limits.maxStorageBufferBindingSize / 1048576)} Mo`);
      else r.push('  aucun adaptateur WebGPU');
    } catch (e) { r.push('  erreur WebGPU : ' + e.message); }
  }
  const ids = webllm.prebuiltAppConfig.model_list.map((m) => m.model_id);
  r.push('Modèles de cette version du moteur : ' + PRESETS.map((p) => (ids.includes(p.model) ? '✓' : '✗') + p.id).join(' '));
  envText = r.join('\n'); $('env').textContent = envText;
  return ids;
}
const idsPromise = showEnv();

const marker = store.get(MK, null);
if (marker) {
  results.push({ id: marker.id, verdict: 'PLANTAGE (page tuée par le système)', derniereEtape: marker.step, apresSec: Math.round((marker.last - marker.t0) / 1000), quand: new Date(marker.t0).toLocaleTimeString('fr-FR') });
  store.set(RES, results); store.del(MK);
  const c = $('crash'); c.hidden = false;
  c.innerHTML = '<h2 class="bad">Plantage détecté</h2><p>Le test « ' + marker.id + ' » a fait recharger la page.<br>Dernière étape atteinte : <b></b></p><p class="hint">Redémarrez l\'iPhone avant le test suivant.</p>';
  c.querySelector('b').textContent = marker.step;
}
const mark = (id, step, t0) => store.set(MK, { id, step, t0, last: Date.now() });

function render() {
  $('results').textContent = results.length
    ? results.map((r) => `${r.id} : ${r.verdict}\n   ${Object.entries(r).filter(([k]) => !['id', 'verdict', 'sections'].includes(k)).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ; ')}`).join('\n')
    : "Aucun test pour l'instant.";
}
async function renderPresets() {
  const ids = await idsPromise;
  const box = $('presets'); box.textContent = '';
  for (const p of PRESETS) {
    const b = document.createElement('button');
    const done = results.filter((r) => r.id === p.id).pop();
    b.textContent = `${p.label} – téléchargement ${p.mo}${done ? ' – dernier résultat : ' + done.verdict.split(' ')[0] : ''}`;
    const usable = (hasF16 || p.model32 || !/q4f16/.test(p.model)) && ids.includes(hasF16 ? p.model : (p.model32 || p.model));
    b.disabled = !usable || !navigator.gpu;
    if (!usable && navigator.gpu) b.textContent += ' – non compatible avec cet appareil (shader-f16 absent)';
    const gb = parseFloat(String(p.mo).replace(/[^\d,]/g, '').replace(',', '.')) || 0;
    const isPhone = /iPhone|iPad|Android/i.test(navigator.userAgent);
    const pcOnly = (MODELS.find((m) => m.id === p.id) || {}).pc;
    if (pcOnly && isPhone) { b.disabled = true; b.textContent += ' – réservé aux ordinateurs'; }
    // Aucun modèle ne se lance seul : chaque test exige un toucher, et une confirmation dès 1 Go.
    b.onclick = () => {
      if (gb >= 1 && !confirm(`Ce test télécharge un modèle d'environ ${gb.toLocaleString('fr-FR')} Go et peut faire planter la page (vos entretiens ne sont pas touchés).\n\nÊtes-vous en Wi-Fi, l'iPhone branché, après un redémarrage ?`)) return;
      run(p);
    };
    box.appendChild(b);
  }
}

async function run(p) {
  for (const b of $('presets').querySelectorAll('button')) b.disabled = true;
  const t0 = Date.now();
  const modelId = (!hasF16 && p.model32) ? p.model32 : p.model;
  const res = { id: p.id, model: modelId, verdict: 'EN COURS', date: Date.now() };
  let worker = null, engine = null;
  try {
    mark(p.id, 'démarrage', t0);
    worker = new Worker('ia-worker.js', { type: 'module' });
    let lastPct = -1;
    engine = await webllm.CreateWebWorkerMLCEngine(worker, modelId, {
      initProgressCallback: (r) => {
        const pct = Math.floor((r.progress || 0) * 10) * 10;
        if (pct !== lastPct) { lastPct = pct; mark(p.id, `chargement du modèle ${pct}% – ${String(r.text).slice(0, 80)}`, t0); }
        $('bar').value = r.progress || 0; $('status').textContent = String(r.text).slice(0, 160);
      },
    });
    res.chargementSec = +((Date.now() - t0) / 1000).toFixed(1);
    const chat = async (messages, { maxTokens, temperature }) => {
      const req = { messages, max_tokens: maxTokens, temperature, stream: false };
      if (/qwen3/i.test(modelId)) req.extra_body = { enable_thinking: false };
      const r = await withTimeout(engine.chat.completions.create(req), 240000, () => { try { engine.interruptGenerate(); } catch {} });
      return { text: r.choices[0].message.content || '', usage: r.usage };
    };
    const { sections, stats } = await generateReport({
      chat, template: TEMPLATE, transcript: TRANSCRIPT, strategy: strategyFor(TRANSCRIPT, p), promptStyle: GEN.promptStyle, glossary: GEN.glossary,
      onProgress: (pr) => { mark(p.id, `rédaction rubrique ${pr.i}/${pr.n} (${pr.title || pr.step})`, t0); $('bar').value = pr.i / pr.n; $('status').textContent = `Rédaction : rubrique ${pr.i}/${pr.n}`; },
    });
    Object.assign(res, scoreCase(GOLD, sections, TRANSCRIPT, stats));
    res.sections = sections;
    mark(p.id, 'libération du modèle', t0);
    await engine.unload();
    res.verdict = 'OK';
  } catch (e) {
    res.verdict = 'ERREUR (sans plantage)'; res.message = String(e.message || e).slice(0, 300);
  } finally {
    try { if (worker) worker.terminate(); } catch {}
    store.del(MK);
    results.push(res); store.set(RES, results);
    $('status').textContent = 'Terminé : ' + res.verdict; $('bar').value = 0;
    render(); renderPresets();
  }
}

$('copy').onclick = async () => {
  const lines = ['SONDE IA ' + new Date().toISOString(), envText, ''];
  for (const r of results) {
    lines.push('== ' + r.id + ' : ' + r.verdict, JSON.stringify({ ...r, sections: undefined }));
    if (r.sections) for (const s of r.sections) lines.push('--- ' + s.title, s.content);
    lines.push('');
  }
  const txt = lines.join('\n'); $('report').value = txt;
  try { await navigator.clipboard.writeText(txt); } catch { $('report').select(); }
};
$('reset').onclick = () => { results.length = 0; store.del(RES); store.del(MK); render(); renderPresets(); };
render(); renderPresets();
