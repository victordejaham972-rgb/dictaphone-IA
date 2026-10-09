// Réglages : sauvegarde et restauration, vocabulaire, IA, confidentialité, stockage, aide.
import { h, icon, toast, confirmDialog, promptDialog, sheet } from './ui.js';
import * as S from './store.js';
import * as B from './backup.js';
import { go } from './common.js';
import { APP_VERSION } from './version.js';
import { shareOrDownload } from './exports.js';
import { AI_STATUS_TEXT } from './ai.js';
import { modelStatus, localAiSettings, setLocalAi } from './ia-local.js';

const fmtMo = (b) => (b / 1048576).toFixed(b > 1e9 ? 0 : 1) + ' Mo';
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export async function settingsView({ query }) {
  const el = h('div', { class: 'view' });
  const group = (title, ...kids) => h('div', { class: 'settings-group' }, h('h2', { text: title }), ...kids);

  // ---------- Sauvegarde ----------
  async function backupFlow() {
    sheet({ title: 'Sauvegarder mes données', build(body, close) {
      const pw1 = h('input', { class: 'field', type: 'password', placeholder: 'Mot de passe', autocomplete: 'new-password', autocapitalize: 'none' });
      const pw2 = h('input', { class: 'field', type: 'password', placeholder: 'Confirmer le mot de passe', autocomplete: 'new-password', autocapitalize: 'none', style: { marginTop: '8px' } });
      const prot = h('input', { type: 'checkbox', checked: true, id: 'prot' });
      const pwBox = h('div', {}, pw1, pw2, h('p', { class: 'hint', text: 'Notez ce mot de passe : sans lui, la sauvegarde est impossible à lire. Il ne peut pas être récupéré.' }));
      prot.addEventListener('change', () => { pwBox.hidden = !prot.checked; });
      const go_ = h('button', { class: 'btn primary', text: 'Créer la sauvegarde' });
      go_.addEventListener('click', async () => {
        if (prot.checked) {
          if (pw1.value.length < 8) { toast('Mot de passe : 8 caractères minimum.'); pw1.focus(); return; }
          if (pw1.value !== pw2.value) { toast('Les deux mots de passe sont différents.'); pw2.focus(); return; }
        } else if (!(await confirmDialog({ title: 'Sauvegarde non protégée', danger: true, confirmLabel: 'Continuer sans mot de passe',
          message: 'Le fichier contiendra vos transcriptions et comptes rendus en clair : toute personne qui l\'obtient pourra les lire. Rangez-le dans un emplacement sécurisé.' }))) return;
        go_.disabled = true; go_.textContent = 'Création…';
        try {
          const data = JSON.stringify(await B.buildBackup(APP_VERSION));
          const text = prot.checked ? await B.encryptText(data, pw1.value) : data;
          const name = `Dictaphone-IA-sauvegarde-${today()}${prot.checked ? '-protegee' : ''}.json`;
          const res = await shareOrDownload([new File([text], name, { type: 'application/json' })], 'Sauvegarde Dictaphone IA');
          if (res !== 'annule') { B.markBackupDone(); toast('Sauvegarde créée'); close(); render(); } else { go_.disabled = false; go_.textContent = 'Créer la sauvegarde'; }
        } catch (err) { toast('Échec : ' + err.message, 5000); go_.disabled = false; go_.textContent = 'Créer la sauvegarde'; }
      });
      body.append(
        h('p', { class: 'sheet-msg', text: 'Le fichier contient vos entretiens, transcriptions, comptes rendus, dossiers et trames. Les fichiers audio ne sont pas inclus (exportez-les depuis la fiche de chaque entretien).' }),
        h('label', { class: 'catpick' }, h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: '14px', padding: '12px 14px' } }, prot, h('span', { text: 'Protéger par un mot de passe (recommandé)' }))),
        h('div', { style: { height: '10px' } }), pwBox,
        h('div', { class: 'sheet-actions' }, go_, h('button', { class: 'btn', text: 'Annuler', onclick: close })));
    } });
  }

  async function restoreFlow() {
    const inp = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
    inp.addEventListener('change', async () => {
      const f = inp.files[0]; inp.remove();
      if (!f) return;
      try {
        if (f.size > 200 * 1024 * 1024) throw new Error('Fichier trop volumineux.');
        let { encrypted, obj } = B.parseFile(await f.text());
        if (encrypted) {
          const pw = await promptDialog({ title: 'Sauvegarde protégée', label: 'Mot de passe', type: 'password', confirmLabel: 'Déverrouiller', message: 'Saisissez le mot de passe choisi lors de la sauvegarde.' });
          if (!pw) return;
          obj = B.parseFile(await B.decryptEnvelope(obj, pw)).obj;
        }
        const clean = B.sanitize(obj);
        const plan = await B.planRestore(clean);
        const nAdd = plan.addSessions.length, nCopy = plan.copySessions.length;
        sheet({ title: 'Restaurer cette sauvegarde ?', build(body, close) {
          body.append(
            h('p', { class: 'sheet-msg', text: `Sauvegarde du ${obj.exportedAt ? new Date(obj.exportedAt).toLocaleDateString('fr-FR') : '—'}, vérifiée.` }),
            h('div', { class: 'card' }, h('div', { class: 'info-grid' },
              ...[['Entretiens ajoutés', nAdd], ['Copies créées (version différente déjà présente)', nCopy], ['Dossiers ajoutés', plan.addFolders.length], ['Trames ajoutées', plan.addTemplates.length + plan.copyTemplates.length], ['Éléments déjà présents (ignorés)', plan.skipped]]
                .map(([k, v]) => h('div', { class: 'kv' }, h('span', { text: k }), h('span', { text: String(v) }))))),
            h('p', { class: 'hint', text: 'Rien de ce qui est déjà sur cet appareil ne sera écrasé ni supprimé.' + (plan.audioMissing ? ` ${plan.audioMissing} entretien(s) avaient un audio : il n'est pas inclus dans la sauvegarde.` : '') }),
            h('div', { class: 'sheet-actions' },
              h('button', { class: 'btn primary', text: 'Restaurer', disabled: !(nAdd + nCopy + plan.addFolders.length + plan.addTemplates.length + plan.copyTemplates.length + plan.vocabAdd.length), onclick: async () => { await B.applyRestore(plan); toast('Sauvegarde restaurée'); close(); render(); } }),
              h('button', { class: 'btn', text: 'Annuler', onclick: close })));
        } });
      } catch (err) { toast(err.message, 6000); }
    });
    document.body.append(inp); inp.click(); setTimeout(() => inp.remove(), 120000);
  }

  // ---------- Vocabulaire ----------
  function vocabBlock() {
    const list = S.getVocab();
    const box = h('div', {});
    const save = () => S.setVocab(list.filter((v) => v.from.trim() || v.to.trim()));
    function draw() {
      box.textContent = '';
      list.forEach((v, i) => {
        const a = h('input', { class: 'field', value: v.from, placeholder: 'Erreur fréquente', autocapitalize: 'none', autocorrect: 'off', 'aria-label': 'Erreur fréquente' });
        const b = h('input', { class: 'field', value: v.to, placeholder: 'Écriture correcte', autocapitalize: 'none', autocorrect: 'off', 'aria-label': 'Écriture correcte' });
        a.addEventListener('input', () => { v.from = a.value; save(); }); b.addEventListener('input', () => { v.to = b.value; save(); });
        box.append(h('div', { class: 'vocab-row' }, a, h('span', { text: '→' }), b, h('button', { class: 'iconbtn', 'aria-label': 'Supprimer', style: { color: 'var(--danger)', flex: 'none' }, onclick: () => { list.splice(i, 1); save(); draw(); } }, icon('trash'))));
      });
      box.append(h('button', { class: 'btn small', style: { marginTop: '12px' }, onclick: () => { list.push({ from: '', to: '' }); draw(); const f = box.querySelectorAll('.vocab-row input'); f[f.length - 2] && f[f.length - 2].focus(); } }, icon('plus'), h('span', { text: 'Ajouter une correction' })));
    }
    draw();
    return h('div', { class: 'card' }, h('p', { class: 'hint', style: { marginTop: 0 }, text: 'Mots que la transcription Apple écrit souvent mal. Dans une transcription, « Corriger » puis « Appliquer mon vocabulaire » les remplace d\'un coup.' }), box);
  }

  // ---------- IA locale ----------
  // Rien n'est supposé : un modèle n'est proposé que s'il a réussi la sonde IA SUR CET APPAREIL (voir ia-local.js).
  function aiBlock() {
    const list = modelStatus(), valid = list.filter((m) => m.validated), st = localAiSettings();
    const box = h('div', { class: 'card ia-card' });
    const fmt = (m) => {
      const p = m.probe;
      if (!p) return 'Non testé';
      if (m.validated) return `Validé le ${new Date(p.date || Date.now()).toLocaleDateString('fr-FR')} · rappel ${Math.round(p.recall * 100)} % · classement ${p.placement == null ? '—' : Math.round(p.placement * 100) + ' %'}`;
      if (p.verdict && p.verdict.startsWith('PLANTAGE')) return 'A fait planter l\'application';
      if (p.verdict !== 'OK') return 'Échec du test';
      return `Insuffisant · rappel ${Math.round(p.recall * 100)} %, classement ${p.placement == null ? '—' : Math.round(p.placement * 100) + ' %'}${(p.hallucinatedNumbers || []).length ? ', montants inventés' : ''}${(p.promotedHypotheses || []).length ? ', hypothèse prise pour une décision' : ''}`;
    };
    box.append(
      h('p', { style: { margin: '0 0 8px', color: 'var(--ink)', fontWeight: 600 }, text: valid.length ? 'Rédaction par IA locale : disponible sur cet appareil (expérimental)' : 'Rédaction automatique : non disponible' }),
      h('p', { class: 'hint', text: valid.length ? 'Un modèle a réussi le test de qualité sur cet appareil. Le résultat reste un brouillon à relire.' : AI_STATUS_TEXT }),
      h('p', { style: { margin: '10px 0 4px', fontWeight: 600, color: 'var(--ink)' }, text: 'Modèles testés sur cet appareil' }),
      h('div', { class: 'info-grid' }, list.map((m) => h('div', { class: 'kv' },
        h('span', {}, h('span', { text: `${m.label} (${m.mo})` }), h('span', { class: 'hint', style: { display: 'block', margin: '2px 0 0' }, text: 'Licence : ' + (m.licence || '—') + (m.pc ? ' · ordinateur uniquement' : '') })),
        h('span', { text: fmt(m) })))),
      h('a', { class: 'btn', style: { marginTop: '12px' }, href: 'ia-sonde.html' }, icon('flask'), h('span', { text: 'Tester l\'IA sur cet appareil' })));
    if (valid.length) {
      const sel = h('select', { class: 'field', 'aria-label': 'Modèle', style: { marginTop: '10px' } }, valid.map((m) => h('option', { value: m.id, text: `${m.label} (${m.mo})` })));
      sel.value = valid.some((m) => m.id === st.modelId) ? st.modelId : valid[0].id;
      const on = h('input', { type: 'checkbox', checked: st.enabled && valid.some((m) => m.id === st.modelId) });
      const apply = () => { setLocalAi({ enabled: on.checked, modelId: sel.value }); toast(on.checked ? 'IA locale activée' : 'IA locale désactivée'); };
      on.addEventListener('change', apply); sel.addEventListener('change', apply);
      box.append(h('label', { class: 'catpick', style: { marginTop: '12px' } }, h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: '14px', padding: '12px 14px' } }, on, h('span', { text: 'Activer la rédaction par IA locale (expérimental)' }))), sel);
    }
    box.append(
      h('p', { style: { margin: '14px 0 4px', fontWeight: 600, color: 'var(--ink)' }, text: 'Ce qui reste vrai' }),
      h('ul', { class: 'plain' },
        h('li', { text: 'La transcription n\'est jamais envoyée : le modèle s\'exécute sur l\'appareil. Seuls les fichiers du modèle sont téléchargés une fois depuis Internet.' }),
        h('li', { text: 'Une IA de cette taille peut se tromper : relisez toujours, surtout montants, noms, dates et décisions. L\'application signale les montants absents de la transcription.' }),
        h('li', { text: 'Sans IA, la rédaction guidée par les trames, les corrections, le PDF et l\'envoi par mail restent disponibles.' })));
    return box;
  }

  // ---------- Stockage ----------
  const storageBox = h('div', { class: 'card' });
  async function drawStorage() {
    storageBox.textContent = '';
    let line = 'Estimation indisponible.', persisted = false;
    try { const est = await navigator.storage.estimate(); line = `${fmtMo(est.usage)} utilisés sur ${fmtMo(est.quota)} possibles.`; persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false; } catch {}
    storageBox.append(h('p', { style: { margin: '0 0 6px' }, text: line }),
      h('p', { class: 'hint', text: persisted ? 'Le navigateur s\'est engagé à ne pas effacer ces données automatiquement (sans garantie absolue).' : 'Le navigateur peut effacer ces données s\'il manque de place ou si l\'application est peu utilisée.' }),
      persisted ? null : h('button', { class: 'btn small', onclick: async () => { let ok = false; try { ok = await navigator.storage.persist(); } catch {} toast(ok ? 'Protection activée' : 'Le navigateur a refusé : faites des sauvegardes régulières.', 4500); drawStorage(); } }, icon('shield'), h('span', { text: 'Demander la protection du stockage' })));
  }

  // ---------- Page ----------
  const last = B.lastBackupAt();
  const render = () => {
    el.textContent = '';
    el.append(
      h('div', { class: 'eyebrow', text: 'Réglages' }), h('h1', { class: 'page-title', text: 'Réglages' }), h('div', { class: 'rule' }),

      group('Sauvegarde',
        h('div', { class: 'card' },
          h('p', { style: { margin: '0 0 12px' }, text: last ? 'Dernière sauvegarde : ' + new Date(last).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' }) + '.' : 'Aucune sauvegarde réalisée pour le moment.' }),
          h('p', { class: 'hint', text: 'Vos données sont uniquement sur cet appareil. Sauvegardez-les régulièrement et rangez le fichier dans un emplacement sécurisé.' }),
          h('div', { class: 'btn-row', style: { marginTop: '10px' } },
            h('button', { class: 'btn primary', onclick: backupFlow }, icon('share'), h('span', { text: 'Sauvegarder' })),
            h('button', { class: 'btn', onclick: restoreFlow }, icon('upload'), h('span', { text: 'Restaurer' }))))),

      group('Vocabulaire de correction', vocabBlock()),

      group('Intelligence artificielle', aiBlock()),

      group('Confidentialité',
        h('div', { class: 'card' }, h('ul', { class: 'plain', style: { marginTop: 0 } },
          h('li', { text: 'Vos entretiens sont enregistrés uniquement sur cet appareil, dans le navigateur.' }),
          h('li', { text: 'L\'application n\'envoie ni audio, ni transcription, ni compte rendu : elle ne contient aucun code d\'envoi de données et aucun outil de suivi.' }),
          h('li', { text: 'Elle est téléchargée depuis GitHub Pages : GitHub voit qu\'un appareil consulte l\'application, jamais votre contenu.' }),
          h('li', { text: 'Limites : les données ne sont pas chiffrées par l\'application (le code de l\'iPhone les protège quand il est verrouillé) et il n\'y a pas encore de verrouillage de l\'application.' }),
          h('li', { text: 'Le texte copié reste dans le presse-papiers de l\'appareil, et peut être partagé avec vos autres appareils Apple si cette fonction est activée.' }),
          h('li', { text: 'Une sauvegarde sans mot de passe est lisible par toute personne qui obtient le fichier.' })))),

      group('Stockage', storageBox),

      group('Ajouter à l\'écran d\'accueil',
        h('div', { class: 'card' }, h('ol', { class: 'plain', style: { marginTop: 0 } },
          h('li', { text: 'Ouvrez l\'adresse de l\'application dans Safari.' }), h('li', { text: 'Touchez le bouton Partager.' }),
          h('li', { text: 'Choisissez « Sur l\'écran d\'accueil », puis « Ajouter ».' })))),

      group('Fonctions expérimentales',
        h('div', { class: 'card' },
          h('p', { class: 'hint', style: { marginTop: 0 }, text: 'Espace réservé aux tests techniques (enregistrement, transcription Whisper, IA locale). Non validé sur iPhone : peut faire planter la page.' }),
          h('a', { class: 'btn', href: 'labo.html' }, icon('flask'), h('span', { text: 'Ouvrir le laboratoire' })))),

      group('À propos',
        h('div', { class: 'card' },
          h('div', { class: 'kv' }, h('span', { text: 'Version' }), h('span', { text: APP_VERSION })),
          h('p', { class: 'hint', text: 'Dictaphone IA, développé pour Ade-ci Family Office. Polices Abhaya Libre et DM Sans (licence SIL OFL).' }))),
      h('div', { style: { height: '12px' } }));
    drawStorage();
  };
  render();
  if (query.do === 'sauvegarde') setTimeout(backupFlow, 300);
  return { el };
}
