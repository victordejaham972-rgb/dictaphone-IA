// Rédaction d'un compte rendu par une IA exécutée SUR CET APPAREIL (WebLLM, hébergé dans vendor/).
// La transcription ne quitte jamais l'appareil. Seuls les fichiers du modèle sont téléchargés (une fois).
import * as webllm from '../vendor/web-llm.js';
import { h, icon, toast, confirmDialog } from './ui.js';
import * as S from './store.js';
import { generateReport, withTimeout } from './ia-core.js';
import { verifyReport } from './ia-verify.js';
import { usableModel, localAiSettings, setLocalAi, GEN, strategyFor } from './ia-local.js';
import { catLabel } from './defaults.js';

const app = document.getElementById('app');
const params = new URLSearchParams(location.search);
const id = params.get('e');
const MK = 'ia_marker';
const back = (tab = 'compte-rendu') => { location.href = './#/entretien/' + id + '?tab=' + tab; };

const view = (...kids) => { app.replaceChildren(h('div', { class: 'view' }, ...kids)); window.scrollTo(0, 0); };
const topbar = () => h('div', { class: 'topbar' }, h('button', { class: 'back', onclick: () => back() }, icon('back'), h('span', { text: 'Fiche' })), h('div', { class: 'spacer' }));

function showMessage(title, text, extra) {
  view(topbar(), h('div', { class: 'eyebrow', text: 'IA locale' }), h('h1', { class: 'page-title', text: title }), h('div', { class: 'rule' }), h('p', { class: 'lead', text }), extra || null);
}

(async function start() {
  // Plantage lors d'une précédente rédaction ? On désactive l'IA locale et on le dit clairement.
  let mk = null;
  try { mk = JSON.parse(localStorage.getItem(MK) || 'null'); } catch {}
  if (mk) {
    try { localStorage.removeItem(MK); } catch {}
    setLocalAi({ enabled: false });
    return showMessage('La rédaction précédente a été interrompue',
      `L'application s'est arrêtée pendant « ${mk.step} » (mémoire insuffisante, très probablement). Par sécurité, l'IA locale a été désactivée. Votre compte rendu et vos données ne sont pas modifiés. Vous pouvez choisir un modèle plus léger dans Réglages > Intelligence artificielle.`,
      h('a', { class: 'btn', href: './#/reglages' }, h('span', { text: 'Ouvrir les réglages' })));
  }
  if (!id) return showMessage('Entretien introuvable', 'Ouvrez cette page depuis la fiche d\'un entretien.');
  const [e, templates, folders] = await Promise.all([S.getEntretien(id), S.listTemplates(), S.listFolders()]);
  if (!e) return showMessage('Entretien introuvable', 'Il a peut-être été supprimé.');
  const model = usableModel();
  if (!model) return showMessage('IA locale non disponible', 'Aucun modèle n\'est validé et activé sur cet appareil. Activez l\'IA locale dans Réglages après un test réussi.', h('a', { class: 'btn', href: './#/reglages' }, h('span', { text: 'Ouvrir les réglages' })));
  let adapter = null;
  try { adapter = navigator.gpu ? await navigator.gpu.requestAdapter() : null; } catch {}
  if (!adapter) return showMessage('IA locale non disponible', 'Cet appareil ou ce navigateur n\'offre pas WebGPU (accélération graphique), nécessaire à l\'IA locale.');
  const rawTranscript = S.transcriptOf(e);
  if (!rawTranscript.trim()) return showMessage('Pas de transcription', 'Ajoutez d\'abord la transcription de l\'entretien.');
  // Le vocabulaire de correction (PEA, PER, assurance-vie…) est appliqué avant l'IA, sans modifier la transcription enregistrée.
  const transcript = S.applyVocab(rawTranscript, S.getVocab()).text;
  const template = templates.find((t) => t.id === e.templateId) || S.defaultTemplateFor(templates, e.category) || templates[0];

  const replace = h('input', { type: 'checkbox', id: 'replace' });
  const bar = h('progress', { max: '1', value: '0', style: { width: '100%' }, hidden: true });
  const status = h('p', { class: 'hint', 'aria-live': 'polite' });
  let stop = false, running = false;
  const startBtn = h('button', { class: 'btn primary', onclick: run }, icon('sparkle'), h('span', { text: 'Lancer la rédaction' }));
  const cancelBtn = h('button', { class: 'btn', text: 'Annuler', onclick: () => { if (running) { stop = true; status.textContent = 'Annulation en cours…'; } else back(); } });

  view(topbar(),
    h('div', { class: 'eyebrow', text: 'IA locale · expérimental' }),
    h('h1', { class: 'page-title', text: 'Rédaction du compte rendu' }), h('div', { class: 'rule' }),
    h('div', { class: 'card' },
      h('div', { class: 'kv' }, h('span', { text: 'Entretien' }), h('span', { text: e.title })),
      h('div', { class: 'kv' }, h('span', { text: 'Catégorie' }), h('span', { text: catLabel(e.category) })),
      h('div', { class: 'kv' }, h('span', { text: 'Trame' }), h('span', { text: template ? template.name : '—' })),
      h('div', { class: 'kv' }, h('span', { text: 'Modèle' }), h('span', { text: `${model.label} (${model.mo})` }))),
    h('div', { class: 'banner' }, icon('shield'), h('div', { text: 'La transcription reste sur cet appareil : la rédaction est faite par un modèle exécuté ici. Au premier usage, le modèle (' + model.mo + ') est téléchargé depuis Internet : ce téléchargement ne contient aucune donnée de l\'entretien. Gardez l\'écran allumé pendant la rédaction.' })),
    h('div', { class: 'banner warn' }, icon('info'), h('div', { text: 'Le résultat est un brouillon à relire : une IA peut se tromper. Vérifiez les montants, les noms, les dates et les décisions avant toute utilisation.' })),
    h('label', { class: 'catpick', style: { marginTop: '14px' } }, h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: '14px', padding: '12px 14px' } }, replace, h('span', { text: 'Remplacer aussi les rubriques déjà rédigées (sinon elles sont conservées)' }))),
    h('div', { style: { height: '14px' } }), bar, status,
    h('div', { class: 'sheet-actions' }, startBtn, cancelBtn));

  async function run() {
    running = true; stop = false; startBtn.disabled = true; bar.hidden = false;
    const t0 = Date.now();
    const mark = (step) => { try { localStorage.setItem(MK, JSON.stringify({ step, ts: Date.now() })); } catch {} };
    let worker = null, engine = null, wake = null;
    try {
      try { if ('wakeLock' in navigator) wake = await navigator.wakeLock.request('screen'); } catch {}
      mark('création du moteur');
      worker = new Worker('ia-worker.js', { type: 'module' });
      let lastPct = -1;
      engine = await webllm.CreateWebWorkerMLCEngine(worker, model.model, {
        initProgressCallback: (r) => {
          const pct = Math.floor((r.progress || 0) * 10) * 10;
          if (pct !== lastPct) { lastPct = pct; mark(`chargement du modèle ${pct} %`); }
          bar.value = r.progress || 0; status.textContent = String(r.text).slice(0, 140);
        },
      });
      const chat = async (messages, { maxTokens, temperature }) => {
        const req = { messages, max_tokens: maxTokens, temperature, stream: false };
        if (/qwen3/i.test(model.model)) req.extra_body = { enable_thinking: false };   // pas de « raisonnement » interne : réponses directes
        const r = await withTimeout(engine.chat.completions.create(req), 240000, () => { try { engine.interruptGenerate(); } catch {} });
        return { text: r.choices[0].message.content || '', usage: r.usage };
      };
      const { sections, stats } = await generateReport({
        chat, template, transcript, strategy: strategyFor(transcript, model), promptStyle: GEN.promptStyle, maxChars: GEN.maxChars, forceNotes: GEN.forceNotes, glossary: GEN.glossary,
        shouldStop: () => stop,
        onProgress: (p) => { mark(`rédaction ${p.step} ${p.i}/${p.n}`); bar.value = p.i / p.n; status.textContent = p.step === 'rubrique' ? `Rédaction : ${p.title} (${p.i}/${p.n})` : `Analyse de la transcription : ${p.step} ${p.i}/${p.n}`; },
      });
      mark('enregistrement du résultat');
      // Fusion : les rubriques déjà rédigées sont conservées, sauf demande contraire
      const existing = e.reportSections || [];
      const merged = sections.map((s) => {
        const old = existing.find((x) => x.title.trim().toLowerCase() === s.title.trim().toLowerCase());
        const keepOld = old && (old.content || '').trim() && !replace.checked;
        return { id: old ? old.id : S.uid('r'), title: s.title, content: keepOld ? old.content : s.content === 'Non évoqué' ? (old && (old.content || '').trim() ? old.content : '') : s.content, ia: !keepOld && s.content !== 'Non évoqué' };
      });
      for (const x of existing) if (!merged.some((m) => m.id === x.id) && (x.content || '').trim()) merged.push(x);
      e.reportSections = merged; e.templateId = template ? template.id : e.templateId;
      e.iaInfo = { model: model.model, label: model.label, date: Date.now(), seconds: Math.round(stats.seconds) };
      await S.saveEntretien(e);
      const check = verifyReport(merged.filter((m) => m.ia), transcript);
      try { localStorage.removeItem(MK); } catch {}
      done(merged, check, stats);
    } catch (err) {
      try { localStorage.removeItem(MK); } catch {}
      running = false; startBtn.disabled = false; bar.hidden = true;
      status.textContent = err.message === 'annulé' ? 'Rédaction annulée. Rien n\'a été modifié.' : 'Échec : ' + err.message;
    } finally {
      try { if (engine) await engine.unload(); } catch {}
      try { if (worker) worker.terminate(); } catch {}
      try { if (wake) wake.release(); } catch {}
    }
  }

  function done(merged, check, stats) {
    const filled = merged.filter((m) => m.ia).length;
    view(topbar(), h('div', { class: 'eyebrow', text: 'IA locale · brouillon' }), h('h1', { class: 'page-title', text: 'Brouillon prêt' }), h('div', { class: 'rule' }),
      h('p', { class: 'lead', text: `${filled} rubrique${filled > 1 ? 's' : ''} rédigée${filled > 1 ? 's' : ''} par l'IA en ${Math.round(stats.seconds)} s. Les rubriques sans information sont laissées vides.` }),
      check.unverified.length
        ? h('div', { class: 'banner warn' }, icon('info'), h('div', {}, h('div', { style: { fontWeight: 600 }, text: 'Montants à vérifier : ils ne figurent pas dans la transcription' }),
            h('ul', { class: 'plain' }, check.unverified.slice(0, 12).map((u) => h('li', { text: `${u.value} — ${u.section}` })))))
        : h('div', { class: 'banner' }, icon('check'), h('div', { text: `Contrôle automatique : les ${check.checked} montant(s) du brouillon figurent bien dans la transcription. Relisez tout de même le texte.` })),
      h('div', { class: 'sheet-actions' }, h('button', { class: 'btn primary', onclick: () => back() }, h('span', { text: 'Ouvrir le compte rendu' }))));
  }
})().catch((err) => showMessage('Un problème est survenu', String(err.message || err).slice(0, 200)));
