// Réglages : intelligence artificielle (moteur sur cet ordinateur, moteur du navigateur, aide à l'installation, essai sur transcription fictive).
import { h, icon, toast, sheet } from './ui.js';
import * as S from './store.js';
import { engineSettings, setEngine, probeServer, serverChat, PRESETS, cleanUrl, shortModel } from './ia-engine.js';
import { modelStatus, localAiSettings, setLocalAi } from './ia-local.js';
import { generateReportV2 } from './ia-pipeline.js';
import { DEMO_TRANSCRIPT } from './ia-demo.js';

const fmtSec = (s) => (s < 90 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`);

export function iaSection() {
  const st = engineSettings();
  const sub = h('div', { class: 'acc-sub' });
  const head = h('button', { class: 'acc-head', 'aria-expanded': 'false' }, h('div', { class: 'tile' }, icon('sparkle')), h('div', { class: 'grow' }, h('div', { class: 'acc-title', text: 'Intelligence artificielle' }), sub), icon('chevron', 'acc-chev'));
  const body = h('div', { class: 'acc-body', hidden: true });
  const card = h('div', { class: 'card acc' }, head, body);
  let open = new URLSearchParams(location.hash.split('?')[1] || '').get('open') === 'ia';
  const sync = () => { body.hidden = !open; head.setAttribute('aria-expanded', String(open)); card.classList.toggle('open', open); };
  head.addEventListener('click', () => { open = !open; sync(); });

  const label = () => { const s = engineSettings(); return s.kind === 'server' ? `Moteur sur cet ordinateur${s.model ? ' · ' + shortModel(s.model) : ''}` : s.kind === 'webgpu' ? 'Moteur du navigateur' : 'Non configurée'; };
  const refreshSub = () => { sub.textContent = label(); };

  // ----- 1. moteur sur cet ordinateur -----
  const urlInp = h('input', { class: 'field', value: st.url, placeholder: 'http://127.0.0.1:11434', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', 'aria-label': 'Adresse du moteur' });
  const modelSel = h('select', { class: 'field', 'aria-label': 'Modèle', hidden: true });
  const probeMsg = h('p', { class: 'hint', style: { margin: '8px 0 0' } });
  let flavor = 'openai';
  const presets = h('div', { class: 'fchips', style: { marginTop: '8px' } }, PRESETS.map((p) => h('button', { text: p.label, onclick: () => { urlInp.value = p.url; setEngine({ url: p.url }); } })));
  async function test() {
    probeMsg.style.color = 'var(--muted)'; probeMsg.textContent = 'Connexion…'; modelSel.hidden = true;
    let url; try { url = cleanUrl(urlInp.value); } catch (e) { probeMsg.style.color = 'var(--danger)'; probeMsg.textContent = e.message; return null; }
    setEngine({ url });
    const r = await probeServer(url);
    if (!r.ok) { probeMsg.style.color = 'var(--danger)'; probeMsg.textContent = r.error; return null; }
    flavor = r.flavor;
    probeMsg.style.color = 'var(--ok)';
    probeMsg.textContent = `Connecté (${r.flavor === 'ollama' ? 'Ollama' : 'serveur local'}, ${r.ms} ms) · ${r.models.length} modèle${r.models.length > 1 ? 's' : ''} installé${r.models.length > 1 ? 's' : ''}.`;
    modelSel.replaceChildren(...r.models.map((m) => h('option', { value: m, text: shortModel(m) })));
    const cur = engineSettings().model; if (cur && r.models.includes(cur)) modelSel.value = cur;
    modelSel.hidden = !r.models.length;
    if (!r.models.length) { probeMsg.style.color = 'var(--danger)'; probeMsg.textContent = 'Le moteur répond, mais aucun modèle n\'est installé (voir l\'aide ci-dessous).'; }
    return r;
  }
  const useBtn = h('button', { class: 'btn primary', style: { marginTop: '10px' }, onclick: async () => {
    const r = await test(); if (!r || !r.models.length) return;
    setEngine({ kind: 'server', model: modelSel.value, url: r.url }); refreshSub(); drawSel(); toast('Moteur de cet ordinateur activé');
  } }, icon('check'), h('span', { text: 'Tester et utiliser ce moteur' }));
  modelSel.addEventListener('change', () => { if (engineSettings().kind === 'server') { setEngine({ model: modelSel.value }); refreshSub(); } });

  const demoBtn = h('button', { class: 'btn', style: { marginTop: '10px' }, onclick: demo }, icon('sparkle'), h('span', { text: 'Essai sur une transcription fictive' }));
  async function demo() {
    const s = engineSettings();
    if (s.kind !== 'server') return toast('Activez d\'abord le moteur de cet ordinateur.', 4000);
    const r = await test(); if (!r || !r.models.length) return;
    const model = engineSettings().model && r.models.includes(engineSettings().model) ? engineSettings().model : r.models[0];
    const { DEFAULT_TEMPLATES } = await import('./defaults.js');
    const template = DEFAULT_TEMPLATES.find((t) => t.id === 'tpl-clients-detail');
    const out = h('div', {});
    const msg = h('p', { class: 'hint', text: 'Rédaction en cours sur une transcription entièrement fictive…' });
    const bar = h('progress', { max: '1', value: '0', style: { width: '100%' } });
    const closeBtn = h('button', { class: 'btn', text: 'Fermer' });
    let stop = false;
    const sh = sheet({ title: 'Essai du moteur', build(b, close) { closeBtn.addEventListener('click', () => { stop = true; close(); }); b.append(h('p', { class: 'hint', style: { marginTop: 0 }, text: `Modèle : ${model}. Transcription fictive de ${DEMO_TRANSCRIPT.split(/\s+/).length} mots, trame « ${template.name} ». Rien n'est enregistré.` }), bar, msg, out, h('div', { class: 'sheet-actions' }, closeBtn)); } });
    try {
      const chat = serverChat({ url: r.url, model, flavor: r.flavor });
      const res = await generateReportV2({ chat, template, transcript: DEMO_TRANSCRIPT, rewrite: 'off', maxChars: 1000, shouldStop: () => stop, onProgress: (p) => { bar.value = p.i / p.n; msg.textContent = `${p.step === 'analyse' ? 'Analyse' : p.step === 'classement' ? 'Classement' : 'Rédaction'} (${p.i}/${p.n})`; } });
      bar.hidden = true;
      msg.textContent = `Terminé en ${fmtSec(res.stats.seconds)} · ${res.stats.calls} requêtes · ${res.stats.kept} informations retenues, ${res.stats.rejected} écartée(s) · couverture ${Math.round(res.stats.coverage * 100)} %.`;
      out.replaceChildren(...res.sections.filter((x) => x.content !== 'Non évoqué').map((x) => h('div', { class: 'rsec' }, h('div', { class: 'rt', text: x.title }), h('div', { style: { whiteSpace: 'pre-wrap', fontSize: '14.5px' }, text: x.content }))), ...(res.flags.length ? [h('div', { class: 'banner warn' }, icon('info'), h('div', {}, res.flags.slice(0, 6).map((f) => h('p', { style: { margin: '0 0 4px' }, text: f.text }))))] : []));
    } catch (e) { bar.hidden = true; msg.style.color = 'var(--danger)'; msg.textContent = e.message === 'annulé' ? 'Essai annulé.' : 'Échec : ' + e.message; }
  }

  const here = location.origin;
  const help = h('details', { class: 'help' }, h('summary', { text: 'Comment installer le moteur sur mon PC (gratuit)' }),
    h('ol', { class: 'plain' },
      h('li', { text: 'Installez Ollama (gratuit, licence MIT) depuis ollama.com. À faire avec l\'accord de l\'entreprise : c\'est un logiciel qui reste sur le PC.' }),
      h('li', { text: 'Dans une fenêtre de commandes, téléchargez un modèle (une seule fois, environ 4,7 Go) : ollama pull qwen2.5:7b (licence Apache 2.0).' }),
      h('li', { text: `Autorisez cette application à parler à Ollama : créez la variable d'environnement OLLAMA_ORIGINS avec la valeur ${here} (Paramètres Windows > Variables d'environnement), puis quittez et relancez Ollama.` }),
      h('li', { text: 'Revenez ici et touchez « Tester et utiliser ce moteur ». Le navigateur peut demander l\'autorisation d\'accéder au réseau local : acceptez.' })),
    h('p', { class: 'hint', text: 'Alternatives équivalentes : LM Studio (activer « Enable CORS ») ou llama.cpp (llama-server). Seule une adresse de cet ordinateur est acceptée par l\'application. Cette fonction ne marche pas sur iPhone.' }));

  const serverBox = h('div', {},
    h('div', { class: 'lbl', style: { marginTop: 0 }, text: 'Adresse du moteur (sur ce PC uniquement)' }), urlInp, presets,
    h('div', { style: { height: '10px' } }), modelSel, probeMsg, useBtn, demoBtn, help);

  // ----- 2. moteur du navigateur (WebGPU) -----
  function webgpuBox() {
    const list = modelStatus(), valid = list.filter((m) => m.validated), cur = localAiSettings();
    const fmt = (m) => {
      const p = m.probe;
      if (!p) return 'Non testé';
      if (m.validated) return `Validé le ${new Date(p.date || Date.now()).toLocaleDateString('fr-FR')} · rappel ${Math.round(p.recall * 100)} %`;
      if (p.verdict && p.verdict.startsWith('PLANTAGE')) return 'A fait planter l\'application';
      if (p.verdict !== 'OK') return 'Échec du test';
      return `Insuffisant · rappel ${Math.round(p.recall * 100)} %`;
    };
    const box = h('div', {},
      h('p', { class: 'hint', style: { marginTop: 0 }, text: 'Modèle exécuté dans le navigateur grâce à la carte graphique (WebGPU). Il doit d\'abord réussir un test de qualité sur CET appareil. Non adapté à l\'iPhone 14 (mémoire insuffisante, non démontré).' }),
      h('div', { class: 'info-grid' }, list.map((m) => h('div', { class: 'kv' }, h('span', {}, `${m.label} (${m.mo})`), h('span', { text: fmt(m) })))),
      h('a', { class: 'btn', style: { marginTop: '10px' }, href: 'ia-sonde.html' }, icon('flask'), h('span', { text: 'Tester l\'IA du navigateur sur cet appareil' })));
    if (valid.length) {
      const sel = h('select', { class: 'field', 'aria-label': 'Modèle du navigateur', style: { marginTop: '10px' } }, valid.map((m) => h('option', { value: m.id, text: `${m.label} (${m.mo})` })));
      sel.value = valid.some((m) => m.id === cur.modelId) ? cur.modelId : valid[0].id;
      box.append(sel, h('button', { class: 'btn primary', style: { marginTop: '10px' }, onclick: () => { setLocalAi({ enabled: true, modelId: sel.value }); setEngine({ kind: 'webgpu' }); refreshSub(); drawSel(); toast('Moteur du navigateur activé'); } }, icon('check'), h('span', { text: 'Utiliser ce modèle' })));
    }
    return box;
  }

  // ----- choix du moteur actif -----
  const selBox = h('div', { class: 'catpick' });
  const choices = [['server', 'Sur cet ordinateur', 'Logiciel gratuit sur ce PC (Ollama…). Recommandé : modèles de 7 milliards de paramètres ou plus.'], ['webgpu', 'Dans le navigateur', 'Modèle léger exécuté par la carte graphique. Expérimental.'], ['none', 'Aucune IA', 'Rédaction à la main, avec l\'assistant de structuration.']];
  let showing = engineSettings().kind === 'none' ? 'server' : engineSettings().kind;
  const panel = h('div', { style: { marginTop: '12px' } });
  function drawSel() {
    const act = engineSettings().kind;
    selBox.textContent = '';
    for (const [k, t, d] of choices) selBox.append(h('button', { class: showing === k ? 'on' : '', onclick: () => { showing = k; if (k === 'none') { setEngine({ kind: 'none' }); refreshSub(); toast('IA désactivée'); } drawSel(); } },
      h('div', { class: 'tile', style: { width: '40px', height: '40px' } }, icon(k === 'server' ? 'screen' : k === 'webgpu' ? 'flask' : 'edit')),
      h('div', {}, h('div', { style: { fontWeight: 600, color: 'var(--ink)' }, text: t + (act === k ? ' · actif' : '') }), h('div', { class: 'hint', style: { margin: 0 }, text: d }))));
    panel.replaceChildren(...(showing === 'server' ? [serverBox] : showing === 'webgpu' ? [webgpuBox()] : [h('p', { class: 'hint', text: 'Aucun moteur n\'est utilisé. Dans le compte rendu, l\'assistant de structuration classe les passages de la transcription par rubrique (sans IA, sans rien inventer).' })]));
  }
  drawSel(); refreshSub(); sync();

  body.append(
    h('p', { class: 'hint', style: { marginTop: 0 }, text: 'Dictaphone IA rédige le compte rendu à partir de la transcription et de la trame choisie. Tout reste sur votre appareil : aucune transcription n\'est envoyée sur Internet, aucun abonnement, aucun coût.' }),
    selBox, panel,
    h('p', { style: { margin: '16px 0 4px', fontWeight: 600, color: 'var(--ink)' }, text: 'Ce qui reste vrai' }),
    h('ul', { class: 'plain' },
      h('li', { text: 'Chaque information du brouillon est reliée aux passages de la transcription qui la justifient ; les montants, dates et noms absents de la transcription sont écartés.' }),
      h('li', { text: 'Une IA peut se tromper (rubrique, nuance, contresens) : relisez toujours. Un compte rendu généré par l\'IA est marqué « à relire » jusqu\'à votre validation.' }),
      h('li', { text: 'Sur iPhone 14, aucune IA générative fiable n\'est disponible : utilisez l\'assistant de structuration, ou faites rédiger le compte rendu sur PC.' })));
  return card;
}
