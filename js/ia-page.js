// Rédaction d'un compte rendu par une IA exécutée SUR CET APPAREIL OU SUR CET ORDINATEUR.
// La transcription ne quitte jamais l'ordinateur ou l'appareil : moteur local (Ollama, LM Studio, llama.cpp sur 127.0.0.1)
// ou modèle exécuté dans le navigateur (WebLLM, hébergé dans vendor/).
import { h, icon, toast } from './ui.js';
import * as S from './store.js';
import { generateReport, withTimeout } from './ia-core.js';
import { generateReportV2, annotateReport } from './ia-pipeline.js';
import { verifyReport } from './ia-verify.js';
import { usableModel, setLocalAi, GEN, strategyFor } from './ia-local.js';
import { engineSettings, probeServer, serverChat, shortModel } from './ia-engine.js';
import { catLabel } from './defaults.js';

const app = document.getElementById('app');
const params = new URLSearchParams(location.search);
const id = params.get('e');
const MK = 'ia_marker';
const back = (tab = 'compte-rendu') => { location.href = './#/entretien/' + id + '?tab=' + tab; };

const view = (...kids) => { app.replaceChildren(h('div', { class: 'view' }, ...kids)); window.scrollTo(0, 0); };
const topbar = () => h('div', { class: 'topbar' }, h('button', { class: 'back', onclick: () => back() }, icon('back'), h('span', { text: 'Fiche' })), h('div', { class: 'spacer' }));
const fmtSec = (s) => (s < 90 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`);

function showMessage(title, text, ...extra) {
  view(topbar(), h('div', { class: 'eyebrow', text: 'IA locale' }), h('h1', { class: 'page-title', text: title }), h('p', { class: 'lead', style: { marginTop: '12px' }, text }), ...extra);
}
const toSettings = (label = 'Ouvrir les réglages de l\'IA') => h('a', { class: 'btn primary', href: './#/reglages?open=ia', style: { marginTop: '8px' } }, icon('gear'), h('span', { text: label }));

(async function start() {
  // Plantage lors d'une précédente rédaction (moteur du navigateur) ? On désactive ce moteur et on le dit clairement.
  let mk = null;
  try { mk = JSON.parse(localStorage.getItem(MK) || 'null'); } catch {}
  if (mk) {
    try { localStorage.removeItem(MK); } catch {}
    setLocalAi({ enabled: false });
    return showMessage('La rédaction précédente a été interrompue',
      `L'application s'est arrêtée pendant « ${mk.step} » (mémoire insuffisante, très probablement). Par sécurité, le moteur du navigateur a été désactivé. Votre compte rendu et vos données ne sont pas modifiés. Vous pouvez utiliser un moteur local sur ordinateur (Ollama) ou choisir un modèle plus léger dans les réglages.`, toSettings());
  }
  if (!id) return showMessage('Entretien introuvable', 'Ouvrez cette page depuis la fiche d\'un entretien.');
  const [e, templates] = await Promise.all([S.getEntretien(id), S.listTemplates()]);
  if (!e) return showMessage('Entretien introuvable', 'Il a peut-être été supprimé.');
  const rawTranscript = S.transcriptOf(e);
  if (!rawTranscript.trim()) return showMessage('Pas de transcription', 'Ajoutez d\'abord la transcription de l\'entretien.', h('a', { class: 'btn', href: './#/entretien/' + id, style: { marginTop: '8px' } }, h('span', { text: 'Ouvrir la fiche' })));

  // ----- quel moteur ? -----
  const eng = engineSettings();
  let runner = null;           // { kind, label, detail, chat?, webgpu? }
  if (eng.kind === 'server') {
    const pr = await probeServer(eng.url);
    if (!pr.ok) return showMessage('Le moteur local ne répond pas', pr.error, h('p', { class: 'hint', text: 'Adresse configurée : ' + eng.url }), h('button', { class: 'btn', style: { marginTop: '8px' }, onclick: () => location.reload() }, h('span', { text: 'Réessayer' })), toSettings());
    const model = eng.model && pr.models.includes(eng.model) ? eng.model : pr.models[0];
    if (!model) return showMessage('Aucun modèle installé', 'Le moteur répond mais aucun modèle n\'est installé. Installez un modèle (voir l\'aide dans les réglages de l\'IA).', toSettings());
    runner = { kind: 'server', label: 'Moteur sur cet ordinateur', detail: `${shortModel(model)} · ${pr.flavor === 'ollama' ? 'Ollama' : 'serveur local'}`, model, chat: serverChat({ url: pr.url, model, flavor: pr.flavor }) };
  } else if (eng.kind === 'webgpu') {
    const um = usableModel();
    if (!um) return showMessage('IA du navigateur non disponible', 'Aucun modèle n\'est validé et activé sur cet appareil. Passez par les réglages de l\'IA.', toSettings());
    let adapter = null;
    try { adapter = navigator.gpu ? await navigator.gpu.requestAdapter() : null; } catch {}
    if (!adapter) return showMessage('IA du navigateur non disponible', 'Cet appareil ou ce navigateur n\'offre pas WebGPU (accélération graphique), nécessaire à ce moteur.', toSettings());
    runner = { kind: 'webgpu', label: 'Moteur du navigateur (WebGPU)', detail: `${um.label} (${um.mo})`, model: um };
  } else {
    return showMessage('Aucune IA n\'est configurée sur cet appareil',
      'La rédaction automatique demande un moteur d\'IA local. Sur ordinateur : un logiciel gratuit installé sur le même PC (Ollama ou équivalent) ou le moteur du navigateur. Sur iPhone 14, aucun moteur fiable n\'est disponible : l\'assistant de structuration vous aide à classer les informations de la transcription, sans IA.',
      toSettings('Configurer l\'IA'),
      h('a', { class: 'btn', href: './#/entretien/' + id + '?tab=compte-rendu&assist=1', style: { marginTop: '8px' } }, icon('sparkle'), h('span', { text: 'Pré-remplir sans IA (assistant)' })));
  }

  // Le vocabulaire de correction (PEA, PER, assurance-vie…) est appliqué avant l'IA, sans modifier la transcription enregistrée.
  const transcript = S.applyVocab(rawTranscript, S.getVocab()).text;
  const words = transcript.trim().split(/\s+/).length;
  const tplSel = h('select', { class: 'field', 'aria-label': 'Trame' }, templates.filter((t) => !e.category || t.category === e.category || t.id === e.templateId).map((t) => h('option', { value: t.id, text: t.name })));
  tplSel.value = (templates.find((t) => t.id === e.templateId) || S.defaultTemplateFor(templates, e.category) || templates[0]).id;
  const replace = h('input', { type: 'checkbox', id: 'replace' });
  const rewriteChk = h('input', { type: 'checkbox', id: 'rewrite', checked: S.getSettings().iaRewrite !== false && runner.kind === 'server' });
  const bar = h('progress', { max: '1', value: '0', style: { width: '100%' }, hidden: true });
  const status = h('p', { class: 'hint', 'aria-live': 'polite' });
  let stop = false, running = false;
  const startBtn = h('button', { class: 'btn primary', onclick: run }, icon('sparkle'), h('span', { text: 'Générer avec l\'IA' }));
  const cancelBtn = h('button', { class: 'btn', text: 'Annuler', onclick: () => { if (running) { stop = true; status.textContent = 'Annulation en cours…'; } else back(); } });
  const check = (input, label, hint) => h('label', { class: 'check', for: input.id }, input, h('span', {}, label, hint ? h('small', { class: 'a-sub', text: hint }) : null));

  view(topbar(),
    h('div', { class: 'eyebrow', text: 'IA locale · brouillon à relire' }),
    h('h1', { class: 'page-title', text: 'Générer le compte rendu' }),
    h('div', { class: 'card', style: { marginTop: '16px' } },
      h('div', { class: 'kv' }, h('span', { text: 'Entretien' }), h('span', { text: e.title })),
      h('div', { class: 'kv' }, h('span', { text: 'Transcription' }), h('span', { text: `${words.toLocaleString('fr-FR')} mots` })),
      h('div', { class: 'kv' }, h('span', { text: 'Moteur' }), h('span', { text: runner.label })),
      h('div', { class: 'kv' }, h('span', { text: 'Modèle' }), h('span', { text: runner.detail }))),
    h('label', { class: 'lbl', text: 'Trame du compte rendu' }), tplSel,
    h('div', { class: 'banner' }, icon('shield'), h('div', { text: runner.kind === 'server' ? 'La transcription reste sur cet ordinateur : elle est envoyée uniquement au logiciel installé sur ce même PC (adresse locale 127.0.0.1), jamais sur Internet.' : 'La transcription reste sur cet appareil : la rédaction est faite par un modèle exécuté ici. Au premier usage, le modèle (' + runner.model.mo + ') est téléchargé depuis Internet : ce téléchargement ne contient aucune donnée de l\'entretien. Gardez l\'écran allumé.' })),
    h('div', { class: 'banner warn' }, icon('info'), h('div', { text: 'Le résultat est un brouillon à relire : l\'IA peut se tromper. Chaque information est reliée aux passages de la transcription qui la justifient, et les montants, dates et noms absents de la transcription sont écartés. Relisez avant toute utilisation.' })),
    check(replace, 'Remplacer aussi les rubriques déjà rédigées', 'Sinon, elles sont conservées.'),
    runner.kind === 'server' ? check(rewriteChk, 'Rédaction fluide', 'Reformule chaque rubrique à partir des informations vérifiées (plus lisible ; recommandé avec un modèle de 7 milliards de paramètres ou plus).') : null,
    h('div', { style: { height: '12px' } }), bar, status,
    h('div', { class: 'sheet-actions' }, startBtn, cancelBtn));

  async function run() {
    running = true; stop = false; startBtn.disabled = true; bar.hidden = false;
    const template = templates.find((t) => t.id === tplSel.value) || templates[0];
    const mark = (step) => { if (runner.kind === 'webgpu') try { localStorage.setItem(MK, JSON.stringify({ step, ts: Date.now() })); } catch {} };
    let worker = null, engine = null, wake = null, result = null;
    try {
      try { if ('wakeLock' in navigator) wake = await navigator.wakeLock.request('screen'); } catch {}
      const onProgress = (p) => {
        mark(`${p.step} ${p.i}/${p.n}`);
        bar.value = p.i / p.n;
        status.textContent = p.step === 'analyse' ? `Analyse de la transcription (${p.i}/${p.n})…` : p.step === 'classement' ? 'Classement des informations par rubrique…' : p.step === 'rédaction' ? `Rédaction : ${p.title} (${p.i}/${p.n})` : p.step === 'rubrique' ? `Rédaction : ${p.title} (${p.i}/${p.n})` : `Traitement : ${p.step} ${p.i}/${p.n}`;
      };
      if (runner.kind === 'server') {
        result = await generateReportV2({ chat: runner.chat, template, transcript, rewrite: rewriteChk.checked ? 'auto' : 'off', maxChars: 1000, shouldStop: () => stop, onProgress });
        S.setSetting('iaRewrite', rewriteChk.checked);
      } else {
        mark('création du moteur');
        const webllm = await import('../vendor/web-llm.js');
        const model = runner.model;
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
          if (/qwen3/i.test(model.model)) req.extra_body = { enable_thinking: false };
          const r = await withTimeout(engine.chat.completions.create(req), 240000, () => { try { engine.interruptGenerate(); } catch {} });
          return { text: r.choices[0].message.content || '', usage: r.usage };
        };
        const { sections, stats } = await generateReport({ chat, template, transcript, strategy: strategyFor(transcript, model), promptStyle: GEN.promptStyle, maxChars: GEN.maxChars, forceNotes: GEN.forceNotes, glossary: GEN.glossary, shouldStop: () => stop, onProgress });
        mark('contrôle des preuves');
        result = { sections: annotateReport(sections, transcript), flags: [], stats };
      }
      mark('enregistrement du résultat');
      // Fusion : les rubriques déjà rédigées sont conservées, sauf demande contraire
      const existing = e.reportSections || [];
      const merged = result.sections.map((s) => {
        const old = existing.find((x) => x.title.trim().toLowerCase() === s.title.trim().toLowerCase());
        const keepOld = old && (old.content || '').trim() && !replace.checked;
        const empty = s.content === 'Non évoqué' || !(s.content || '').trim();
        if (keepOld) return old;
        return { id: old ? old.id : S.uid('r'), title: s.title, content: empty ? (old && (old.content || '').trim() ? old.content : '') : s.content, ia: !empty, evidence: empty ? undefined : s.evidence, flags: empty ? undefined : (s.flags || []) };
      });
      for (const x of existing) if (!merged.some((m) => m.id === x.id) && (x.content || '').trim()) merged.push(x);
      if (existing.some((x) => (x.content || '').trim())) e.reportHistory = S.pushHistory(e.reportHistory, { text: JSON.stringify(existing), reason: 'avant rédaction IA' });
      e.reportSections = merged; e.templateId = template.id;
      e.iaInfo = { engine: runner.kind, model: runner.kind === 'server' ? runner.model : runner.model.model, label: runner.detail, date: Date.now(), seconds: Math.round(result.stats.seconds), calls: result.stats.calls || 0, rejected: result.stats.rejected || 0, flags: (result.flags || []).slice(0, 30), reviewed: false };
      await S.saveEntretien(e);
      const check = verifyReport(merged.filter((m) => m.ia), transcript);
      try { localStorage.removeItem(MK); } catch {}
      done(merged, check, result);
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

  function done(merged, check, result) {
    const filled = merged.filter((m) => m.ia).length;
    const flags = [...(result.flags || []), ...merged.filter((m) => m.ia).flatMap((m) => (m.flags || []).filter((f) => f.kind === 'à vérifier' || f.kind === 'sans source').map((f) => ({ kind: f.kind, text: `${m.title} : ${f.text}` })))];
    view(topbar(), h('div', { class: 'eyebrow', text: 'IA locale · brouillon' }), h('h1', { class: 'page-title', text: 'Brouillon prêt' }),
      h('p', { class: 'lead', style: { marginTop: '12px' }, text: `${filled} rubrique${filled > 1 ? 's' : ''} rédigée${filled > 1 ? 's' : ''} en ${fmtSec(result.stats.seconds)}. Les rubriques sans information sont laissées vides (« Non évoqué »).` }),
      h('div', { class: 'card' },
        h('div', { class: 'kv' }, h('span', { text: 'Moteur' }), h('span', { text: runner.detail })),
        h('div', { class: 'kv' }, h('span', { text: 'Durée' }), h('span', { text: fmtSec(result.stats.seconds) })),
        result.stats.facts ? h('div', { class: 'kv' }, h('span', { text: 'Informations analysées' }), h('span', { text: `${result.stats.facts} · retenues ${result.stats.kept} · écartées ${result.stats.rejected}` })) : null),
      check.unverified.length
        ? h('div', { class: 'banner warn' }, icon('info'), h('div', {}, h('div', { style: { fontWeight: 600 }, text: 'Montants à vérifier : ils ne figurent pas tels quels dans la transcription' }),
            h('ul', { class: 'plain' }, check.unverified.slice(0, 12).map((u) => h('li', { text: `${u.value} — ${u.section}` })))))
        : h('div', { class: 'banner' }, icon('check'), h('div', { text: `Contrôle automatique : les ${check.checked} montant(s) du brouillon figurent dans la transcription. Relisez tout de même le texte.` })),
      flags.length ? h('div', { class: 'banner warn' }, icon('info'), h('div', {}, h('div', { style: { fontWeight: 600 }, text: 'Points à vérifier' }), h('ul', { class: 'plain' }, flags.slice(0, 10).map((f) => h('li', { text: f.text }))), flags.length > 10 ? h('p', { class: 'hint', text: `… et ${flags.length - 10} autre(s), visibles dans le compte rendu.` }) : null)) : null,
      h('div', { class: 'sheet-actions' }, h('button', { class: 'btn primary', onclick: () => back() }, h('span', { text: 'Ouvrir le compte rendu' }))));
  }
})().catch((err) => showMessage('Un problème est survenu', String(err.message || err).slice(0, 200)));
