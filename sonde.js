// Sonde Whisper : teste un réglage à la fois et détecte les plantages de la page (écran blanc).
// Principe : avant chaque étape, on écrit un "marqueur" dans localStorage (écriture immédiate).
// Si la page est tuée par iOS, au rechargement le marqueur est encore là : on sait donc où ça a planté.
const $ = (id) => document.getElementById(id);
const M = 'onnx-community/whisper-';
const PRESETS = [
  { id: 'tiny-wasm', label: '1. Tiny · WASM (référence, doit marcher)', model: M + 'tiny', device: 'wasm', dtype: 'q8', mo: '≈ 40 Mo' },
  { id: 'base-wasm', label: '2. Base · WASM', model: M + 'base', device: 'wasm', dtype: 'q8', mo: '≈ 73 Mo' },
  { id: 'tiny-gpu', label: '3. Tiny · WebGPU', model: M + 'tiny', device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, mo: '≈ 114 Mo' },
  { id: 'base-gpu-fp16', label: '4. Base · WebGPU en fp16 (si shader-f16 disponible)', model: M + 'base', device: 'webgpu', dtype: { encoder_model: 'fp16', decoder_model_merged: 'fp16' }, mo: '≈ 139 Mo' },
  { id: 'base-gpu', label: '5. Base · WebGPU réglage actuel (celui qui a planté)', model: M + 'base', device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, mo: '≈ 197 Mo' },
];

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

// ---------- Téléphone ----------
async function showEnv() {
  const r = [`Navigateur : ${navigator.userAgent}`, `WebGPU : ${navigator.gpu ? 'API présente' : 'ABSENT'}`];
  if (navigator.gpu) {
    try {
      const a = await navigator.gpu.requestAdapter();
      if (a) r.push(`  shader-f16 : ${a.features.has('shader-f16')}`, `  maxBufferSize : ${Math.round(a.limits.maxBufferSize / 1048576)} Mo`, `  maxStorageBufferBindingSize : ${Math.round(a.limits.maxStorageBufferBindingSize / 1048576)} Mo`);
      else r.push('  aucun adaptateur WebGPU');
    } catch (e) { r.push('  erreur WebGPU : ' + e.message); }
  }
  r.push(`Cœurs : ${navigator.hardwareConcurrency || '?'}`);
  $('env').textContent = r.join('\n');
  return r.join('\n');
}
let envText = '';
showEnv().then((t) => (envText = t));

// ---------- Détection d'un plantage précédent ----------
const results = store.get('probe_results', []);
const marker = store.get('probe_marker', null);
if (marker) {
  results.push({ id: marker.id, verdict: 'PLANTAGE (page tuée par le système)', derniereEtape: marker.step, apresSec: Math.round((marker.last - marker.t0) / 1000), quand: new Date(marker.t0).toLocaleTimeString('fr-FR') });
  store.set('probe_results', results);
  store.del('probe_marker');
  const c = $('crash');
  c.hidden = false;
  c.innerHTML = `<h2 class="bad">Plantage détecté</h2><p>Le test « ${marker.id} » a fait recharger la page.<br>Dernière étape atteinte : <b></b></p>`;
  c.querySelector('b').textContent = marker.step;
}

function mark(id, step, t0) { store.set('probe_marker', { id, step, t0, last: Date.now() }); }

// ---------- Rendu ----------
function render() {
  $('results').textContent = results.length
    ? results.map((r) => `${r.id} : ${r.verdict}\n   ${Object.entries(r).filter(([k]) => !['id', 'verdict'].includes(k)).map(([k, v]) => `${k}=${v}`).join(' ; ')}`).join('\n')
    : 'Aucun test pour l\'instant.';
}
function renderPresets() {
  const box = $('presets');
  box.textContent = '';
  for (const p of PRESETS) {
    const b = document.createElement('button');
    const done = results.filter((r) => r.id === p.id).pop();
    b.textContent = `${p.label} – téléchargement ${p.mo}${done ? ' – dernier résultat : ' + done.verdict.split(' ')[0] : ''}`;
    b.onclick = () => run(p);
    box.appendChild(b);
  }
}

// ---------- Un test ----------
function fakeAudio() { // 5 s de son artificiel (aucune donnée réelle)
  const a = new Float32Array(16000 * 5);
  for (let i = 0; i < a.length; i++) a[i] = 0.2 * Math.sin(i / 16000 * 2 * Math.PI * 200) * (Math.sin(i / 16000 * 4) > 0 ? 1 : 0.1);
  return a;
}

async function run(p) {
  for (const b of $('presets').querySelectorAll('button')) b.disabled = true;
  const t0 = Date.now();
  let worker = null, lastPct = -1;
  const res = { id: p.id, verdict: 'EN COURS' };
  try {
    mark(p.id, 'démarrage', t0);
    if (p.device === 'webgpu' && !navigator.gpu) throw new Error('WebGPU absent sur ce navigateur');
    worker = new Worker('stt-worker.js', { type: 'module' });
    let pending = null;
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') {
        const q = m.p;
        if (q.status === 'progress' && q.total) {
          const pct = Math.floor((q.loaded / q.total) * 10) * 10;
          if (pct !== lastPct) { lastPct = pct; mark(p.id, `téléchargement ${q.file} ${pct}%`, t0); }
          $('bar').value = q.loaded / q.total;
          $('status').textContent = `Téléchargement ${q.file.split('/').pop()} : ${(q.loaded / 1e6).toFixed(0)}/${(q.total / 1e6).toFixed(0)} Mo`;
        } else if (q.status === 'done') { lastPct = -1; mark(p.id, `fichier terminé : ${q.file} (la suite = création de la session)`, t0); }
        else if (q.status === 'ready') mark(p.id, 'modèle prêt', t0);
        return;
      }
      const pd = pending; pending = null;
      if (pd) m.type === 'error' ? pd.rej(new Error(m.message)) : pd.res(m);
    };
    worker.onerror = (e) => { const pd = pending; pending = null; pd && pd.rej(new Error(e.message || 'erreur worker')); };
    const call = (msg, tr = []) => new Promise((res, rej) => { pending = { res, rej }; worker.postMessage(msg, tr); });

    $('status').textContent = 'Chargement...';
    mark(p.id, 'envoi de la demande de chargement', t0);
    const loaded = await call({ type: 'load', model: p.model, device: p.device, dtype: p.dtype });
    res.chargementSec = +(loaded.ms / 1000).toFixed(1);

    mark(p.id, 'première transcription (son généré 5 s)', t0);
    $('status').textContent = 'Première transcription...';
    const r = await call({ type: 'run', index: 0, audio: fakeAudio() });
    res.transcription5sSec = +(r.ms / 1000).toFixed(2);

    mark(p.id, 'libération de la mémoire', t0);
    await call({ type: 'dispose' });
    res.verdict = 'OK';
  } catch (e) {
    res.verdict = 'ERREUR (sans plantage)';
    res.message = String(e.message || e).slice(0, 300);
  } finally {
    if (worker) worker.terminate();
    store.del('probe_marker');
    results.push(res);
    store.set('probe_results', results);
    $('status').textContent = `Terminé : ${res.verdict}`;
    $('bar').value = 0;
    render(); renderPresets();
  }
}

$('copy').onclick = async () => {
  const txt = ['SONDE WHISPER ' + new Date().toISOString(), envText, '', ...$('results').textContent.split('\n')].join('\n');
  $('report').value = txt;
  try { await navigator.clipboard.writeText(txt); } catch { $('report').select(); }
};
$('reset').onclick = () => { results.length = 0; store.del('probe_results'); store.del('probe_marker'); render(); renderPresets(); };

render();
renderPresets();
