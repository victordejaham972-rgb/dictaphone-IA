// Réglages : sauvegarde et restauration, vocabulaire, IA, confidentialité, stockage, aide.
import { h, icon, toast, confirmDialog, promptDialog, sheet } from './ui.js';
import * as S from './store.js';
import * as B from './backup.js';
import { go } from './common.js';
import { APP_VERSION } from './version.js';
import * as Up from './update.js';
import { shareOrDownload } from './exports.js';
import { vocabAccordion } from './vocab-ui.js';
import { iaSection } from './ia-ui.js';

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

  // ---------- Apparence ----------
  function themeBlock() {
    const cur = (S.getSettings().theme) || 'light';
    const opts = [['light', 'Clair'], ['auto', 'Automatique'], ['dark', 'Sombre']];
    const seg = h('div', { class: 'seg' }, opts.map(([k, label]) => h('button', { class: cur === k ? 'on' : '', text: label, onclick: () => {
      S.setSetting('theme', k); document.documentElement.setAttribute('data-theme', k);
      const dark = k === 'dark' || (k === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
      const m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', dark ? '#071A33' : '#F6F0E7');
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.textContent === label));
    } })));
    return h('div', { class: 'card' }, seg, h('p', { class: 'hint', text: 'Clair : ambiance coquille d\'œuf (par défaut). Automatique : suit le mode sombre de l\'appareil. Sombre : fond bleu nuit.' }));
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
            h('button', { class: 'btn', onclick: restoreFlow }, icon('archive'), h('span', { text: 'Restaurer' }))))),

      h('div', { class: 'settings-group' }, vocabAccordion()),
      group('Apparence', themeBlock()),

      h('div', { class: 'settings-group' }, iaSection()),

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

      group('Mise à jour de l\'application',
        h('div', { class: 'card' },
          h('div', { class: 'kv' }, h('span', { text: 'Version affichée' }), h('span', { text: APP_VERSION })),
          h('div', { class: 'kv' }, h('span', { text: 'Version publiée' }), upPub),
          h('div', { class: 'kv' }, h('span', { text: 'Fonctionnement hors connexion' }), upSw),
          upMsg,
          h('div', { class: 'btn-row', style: { marginTop: '10px' } },
            h('button', { class: 'btn small', onclick: doCheck }, icon('down'), h('span', { text: 'Rechercher une mise à jour' })),
            h('button', { class: 'btn small primary', onclick: doForce }, icon('sparkle'), h('span', { text: 'Mettre à jour maintenant' }))),
          h('p', { class: 'hint', text: 'La mise à jour renouvelle uniquement les fichiers du programme. Vos entretiens, comptes rendus, trames et sauvegardes ne sont pas touchés. L\'icône reste en place.' }))),
      group('À propos',
        h('div', { class: 'card' },
          h('div', { class: 'kv' }, h('span', { text: 'Version' }), h('span', { text: APP_VERSION })),
          h('p', { class: 'hint', text: 'Dictaphone IA, développé pour Ade-ci Family Office. Polices Abhaya Libre (titres) et Open Sans (textes), licence SIL OFL.' }))),
      h('div', { style: { height: '12px' } }));
    drawStorage();
  };
  // ----- mise à jour de l'application -----
  const upPub = h('span', { text: '…' }), upSw = h('span', { text: '…' }), upMsg = h('p', { class: 'hint', hidden: true });
  const say = (t) => { upMsg.hidden = !t; upMsg.textContent = t || ''; };
  async function doCheck() {
    say('Vérification en cours…');
    try {
      const r = await Up.checkForUpdate(), st = await Up.swStatus();
      upPub.textContent = r.published || '?';
      upSw.textContent = !st.supported ? 'non disponible' : st.active ? 'actif' + (st.waiting ? ' (mise à jour en attente)' : '') : st.installing ? 'installation…' : 'inactif';
      say(r.outdated ? `Une version plus récente (${r.published}) est disponible. Touchez « Mettre à jour maintenant ».` : `Votre application est à jour (${r.running}).`);
    } catch (err) { upPub.textContent = 'injoignable'; say('Vérification impossible : ' + err.message); }
  }
  async function doForce() {
    try { await Up.forceUpdate((t) => say(t)); } catch (err) { say('Mise à jour impossible : ' + err.message + '. Vos données ne sont pas modifiées.'); }
  }
  render();
  doCheck();
  if (query.do === 'sauvegarde') setTimeout(backupFlow, 300);
  return { el };
}
