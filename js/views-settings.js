// Réglages : sauvegarde et restauration, vocabulaire, IA, confidentialité, stockage, aide.
import { h, icon, toast, confirmDialog, promptDialog, sheet } from './ui.js';
import * as S from './store.js';
import * as B from './backup.js';
import { go } from './common.js';
import { APP_VERSION } from './version.js';
import * as Up from './update.js';
import { shareOrDownload } from './exports.js';
import { vocabAccordion } from './vocab-ui.js';
import * as V from './vault.js';
// ia-ui.js (IA locale) n'est chargé que si les « fonctions avancées » sont activées (voir plus bas).

const fmtMo = (b) => (b / 1048576).toFixed(b > 1e9 ? 0 : 1) + ' Mo';
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export async function settingsView({ query }) {
  const el = h('div', { class: 'view' });
  const group = (title, ...kids) => h('div', { class: 'settings-group' }, h('h2', { text: title }), ...kids);

  // ---------- Fonctions avancées : IA locale (Qwen, WebLLM), laboratoire. Masquées par défaut, code conservé, chargé seulement si activé ----------
  const advancedOn = !!S.getSettings().advanced;
  const advancedNodes = { ia: null };
  if (advancedOn) { try { advancedNodes.ia = (await import('./ia-ui.js')).iaSection(); } catch (err) { console.error('IA locale indisponible :', err && err.message); } }
  function advancedBlock() {
    const on = h('input', { type: 'checkbox', checked: advancedOn, id: 'adv' });
    on.addEventListener('change', () => { S.setSetting('advanced', on.checked); toast(on.checked ? 'Fonctions avancées affichées' : 'Fonctions avancées masquées'); go('#/reglages'); location.reload(); });
    return h('div', { class: 'card' },
      h('label', { class: 'check', style: { marginTop: 0 } }, on, h('span', {}, h('b', { text: 'Afficher les fonctions avancées' }), h('span', { class: 'a-sub', text: 'Rédaction par une IA locale sur cet ordinateur (Qwen, WebLLM), assistant sans IA, laboratoire. Désactivé par défaut : ces fonctions ne servent pas au parcours habituel (protéger, copier, rédiger, exporter).' }))));
  }

  // ---------- Sauvegarde ----------
  async function backupFlow() {
    sheet({ title: 'Sauvegarder mes données', build(body, close) {
      const pw1 = h('input', { class: 'field', type: 'password', placeholder: 'Mot de passe', autocomplete: 'new-password', autocapitalize: 'none' });
      const pw2 = h('input', { class: 'field', type: 'password', placeholder: 'Confirmer le mot de passe', autocomplete: 'new-password', autocapitalize: 'none', style: { marginTop: '8px' } });
      const vaultOn = V.isEnabled();         // coffre actif : une sauvegarde en clair n'est pas proposée
      const prot = h('input', { type: 'checkbox', checked: true, id: 'prot', disabled: vaultOn });
      const pwBox = h('div', {}, pw1, pw2, h('p', { class: 'hint', text: 'Notez ce mot de passe : sans lui, la sauvegarde est impossible à lire. Il ne peut pas être récupéré.' }));
      prot.addEventListener('change', () => { pwBox.hidden = !prot.checked; });
      const withDocs = h('input', { type: 'checkbox', checked: true, disabled: true });
      const docsInfo = h('span', { text: 'Inclure les documents importés (calcul de la taille…)' });
      let docsEst = { count: 0, bytes: 0, tooBig: false };
      B.estimateOriginals().then((est) => {
        docsEst = est;
        if (!est.count) { docsInfo.textContent = 'Aucun document importé à inclure.'; withDocs.checked = false; return; }
        const mo = (est.bytes / 1048576).toFixed(est.bytes < 10485760 ? 1 : 0);
        docsInfo.textContent = `Inclure les documents importés (${est.count} fichier(s), environ ${mo} Mo ; la sauvegarde sera plus lourde d'un tiers de plus)`;
        withDocs.disabled = false;
        if (est.tooBig) { withDocs.checked = false; withDocs.disabled = true; docsInfo.textContent += ' : trop volumineux pour une seule sauvegarde.'; }
        else if (est.bytes > 30 * 1048576) { withDocs.checked = false; docsInfo.textContent += ' : volumineux, à cocher seulement avec une bonne connexion et de la place sur l\'appareil.'; }
      }).catch(() => { docsInfo.textContent = 'Documents importés : estimation impossible.'; withDocs.checked = false; });
      const go_ = h('button', { class: 'btn primary', text: 'Créer la sauvegarde' });
      go_.addEventListener('click', async () => {
        if (prot.checked) {
          if (pw1.value.length < 8) { toast('Mot de passe : 8 caractères minimum.'); pw1.focus(); return; }
          if (pw1.value !== pw2.value) { toast('Les deux mots de passe sont différents.'); pw2.focus(); return; }
        } else if (!(await confirmDialog({ title: 'Sauvegarde non protégée', danger: true, confirmLabel: 'Continuer sans mot de passe',
          message: 'Le fichier contiendra vos transcriptions et comptes rendus en clair : toute personne qui l\'obtient pourra les lire. Rangez-le dans un emplacement sécurisé.' }))) return;
        go_.disabled = true; go_.textContent = 'Création…';
        try {
          // La fiche d'identité et les décisions de pseudonymisation contiennent des noms : incluses seulement dans une sauvegarde chiffrée.
          const built = await B.buildBackup(APP_VERSION, { withProtect: prot.checked, withOriginals: withDocs.checked && !withDocs.disabled });
          const data = JSON.stringify(built);
          const text = prot.checked ? await B.encryptText(data, pw1.value) : data;
          if (prot.checked) {   // contrôle immédiat : le fichier se relit avec ce mot de passe et contient autant de fiches
            const back = JSON.parse(await B.decryptEnvelope(JSON.parse(text), pw1.value));
            if (back.sessions.length !== built.sessions.length || back.folders.length !== built.folders.length || (back.originals || []).length !== (built.originals || []).length) throw new Error('la vérification de la sauvegarde a échoué : aucun fichier créé');
          }
          const name = `ADE-CI-Notes-sauvegarde-${today()}${prot.checked ? '-protegee' : ''}.json`;
          const res = await shareOrDownload([new File([text], name, { type: 'application/json' })], 'Sauvegarde ADE-CI Notes');
          if (res !== 'annule') { B.markBackupDone(); toast('Sauvegarde créée'); close(); render(); } else { go_.disabled = false; go_.textContent = 'Créer la sauvegarde'; }
        } catch (err) { toast('Échec : ' + err.message, 5000); go_.disabled = false; go_.textContent = 'Créer la sauvegarde'; }
      });
      body.append(
        h('p', { class: 'sheet-msg', text: 'Le fichier contient vos entretiens, transcriptions, comptes rendus, dossiers, trames, et — dans une sauvegarde protégée — les fiches d\'identité et décisions de pseudonymisation. Les fichiers audio ne sont pas inclus (exportez-les depuis la fiche de chaque entretien).' }),
        h('label', { class: 'catpick' }, h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: '14px', padding: '12px 14px' } }, prot, h('span', { text: 'Protéger par un mot de passe (recommandé)' }))),
        h('label', { class: 'check' }, withDocs, docsInfo),
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
        let plan = await B.planRestore(clean);
        const nAdd = () => plan.addSessions.length, nCopy = () => plan.copySessions.length;
        const noteBox = h('div', {});
        const drawNotes = () => noteBox.replaceChildren(...[
          plan.trashedInBackup ? h('p', { class: 'hint', text: `${plan.trashedInBackup} élément(s) de la sauvegarde étaient dans la corbeille : ils seront restaurés dans la corbeille de cet appareil.` }) : null,
          plan.ignoredInTrash ? h('p', { class: 'hint', text: `${plan.ignoredInTrash} élément(s) sont dans la corbeille de cet appareil : ils ne sont ni ressuscités ni dupliqués (restaurez-les depuis la Corbeille).` }) : null,
          plan.ignoredPurged ? h('div', { class: 'banner', style: { marginTop: '8px' } }, icon('info'), h('div', {}, h('div', { text: `${plan.ignoredPurged} élément(s) ont été supprimés définitivement de cet appareil depuis cette sauvegarde : ils ne seront pas réintroduits.` }),
            h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: async (ev) => { plan = await B.planRestore(clean, { reviveDeleted: ev.target.checked }); drawNotes(); } }), h('span', { text: 'Les restaurer quand même' })))) : null].filter(Boolean));
        drawNotes();
        sheet({ title: 'Restaurer cette sauvegarde ?', build(body, close) {
          body.append(
            h('p', { class: 'sheet-msg', text: `Sauvegarde du ${obj.exportedAt ? new Date(obj.exportedAt).toLocaleDateString('fr-FR') : '—'}, vérifiée.` }),
            h('div', { class: 'card' }, h('div', { class: 'info-grid' },
              ...[['Entretiens ajoutés', nAdd()], ['Copies créées (version différente déjà présente)', nCopy()], ['Dossiers ajoutés', plan.addFolders.length], ['Documents importés restaurés', plan.originalsAdd.length], ['Trames ajoutées', plan.addTemplates.length + plan.copyTemplates.length], ['Éléments déjà présents (ignorés)', plan.skipped]]
                .map(([k, v]) => h('div', { class: 'kv' }, h('span', { text: k }), h('span', { text: String(v) }))))),
            noteBox,
            h('p', { class: 'hint', text: 'Rien de ce qui est déjà sur cet appareil ne sera écrasé ni supprimé.' + (plan.audioMissing ? ` ${plan.audioMissing} entretien(s) avaient un audio : il n'est pas inclus dans la sauvegarde.` : '') }),
            h('div', { class: 'sheet-actions' },
              h('button', { class: 'btn primary', text: 'Restaurer', disabled: !(nAdd() + nCopy() + plan.addFolders.length + plan.addTemplates.length + plan.copyTemplates.length + plan.vocabAdd.length + plan.originalsAdd.length + plan.enrichProtect.length + (plan.protectGlobal ? 1 : 0)), onclick: async () => { await B.applyRestore(plan); toast('Sauvegarde restaurée'); close(); render(); } }),
              h('button', { class: 'btn', text: 'Annuler', onclick: close })));
        } });
      } catch (err) { toast(err.message, 6000); }
    });
    document.body.append(inp); inp.click(); setTimeout(() => inp.remove(), 120000);
  }

  // ---------- Inventaire avant migration et audio ----------
  const mo = (n) => (n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' Ko' : (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' Mo');
  const dur = (s) => { const m = Math.round(s / 60); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0'); };
  async function inventorySheet() {
    const inv = await B.inventory();
    sheet({ title: 'Inventaire avant migration', wide: true, build(body, close) {
      const row = (k, v) => h('div', { class: 'kv' }, h('span', { text: k }), h('span', { text: String(v) }));
      const A = () => import('../audio.js');
      const audioList = inv.audio.length ? inv.audio.map((a) => h('div', { class: 'card', style: { marginTop: '8px' } },
        h('div', { style: { fontWeight: '600', color: 'var(--ink)' }, text: a.title }),
        h('div', { class: 'hint', text: `${dur(a.seconds)} · ${mo(a.bytes)}${a.complete ? '' : ' · incomplet'}` }),
        h('button', { class: 'btn small', onclick: async (ev) => {
          ev.target.disabled = true;
          try {
            const [M, e] = [await A(), await S.getEntretien(a.id)];
            const d = await M.audioDigest(e);
            const blob = await M.buildWavBlob(e);
            await shareOrDownload([new File([blob], (e.title || 'audio').replace(/[^\p{L}\p{N}\-_ ]/gu, '_') + '.wav', { type: 'audio/wav' })], e.title);
            toast('Empreinte : ' + d.sha256.slice(0, 16) + '…', 6000);
          } catch (err) { toast('Export impossible : ' + err.message, 5000); }
          ev.target.disabled = false;
        } }, icon('share'), h('span', { text: 'Exporter cet audio (WAV)' })))) : [h('p', { class: 'hint', text: 'Aucun enregistrement audio sur cet appareil.' })];
      body.append(
        h('p', { class: 'sheet-msg', text: 'Voici tout ce que contient cet appareil, et ce qu\'une sauvegarde transfère ou non.' }),
        h('div', { class: 'card' }, h('div', { class: 'info-grid' },
          row('Entretiens', inv.sessions + (inv.unreadable ? ` (dont ${inv.unreadable} illisible(s))` : '')), row('avec transcription', inv.withTranscript), row('avec compte rendu', inv.withReport), row('Mots de transcription', inv.words),
          row('Dossiers', inv.folders), row('Trames', `${inv.templates} (dont ${inv.customTemplates} personnalisée(s))`),
          row('Dans la corbeille', `${inv.trashedFiches} fiche(s), ${inv.trashedFolders} dossier(s), ${inv.trashedParts} fiche(s) avec un élément retiré`),
          row('Fiches d\'identité de pseudonymisation', inv.protectSheets), row('Décisions manuelles', inv.protectDecisions),
          row('Vocabulaire personnalisé', inv.vocab), row('Dictionnaire et listes de protection', inv.protectDict + inv.protectLists),
          row('Documents importés', `${inv.documents} (${mo(inv.documentBytes)})`),
          row('Enregistrements audio', `${inv.audio.length} (${dur(inv.audioSeconds)}, ${mo(inv.audioBytes)})`),
          inv.orphanChunks ? row('Morceaux audio sans fiche', inv.orphanChunks) : null,
          inv.usage ? row('Espace utilisé', `${mo(inv.usage)} sur ${mo(inv.quota)}`) : null)),
        h('h4', { text: 'Transféré par la sauvegarde complète' }),
        h('ul', { class: 'plain' }, h('li', { text: 'Entretiens, transcriptions, comptes rendus, historiques et dossiers' }), h('li', { text: 'Trames' }), h('li', { text: 'Vocabulaire personnalisé' }),
          h('li', { text: 'Fiches d\'identité, décisions de pseudonymisation, dictionnaire et listes (sauvegarde protégée uniquement)' }), h('li', { text: 'Documents importés (si la case est cochée)' })),
        h('h4', { text: 'À exporter séparément : l\'audio' }),
        h('p', { class: 'hint', text: 'Les enregistrements ne sont pas dans le fichier de sauvegarde (trop volumineux). Exportez chaque audio en WAV puis rattachez-le à la fiche restaurée (fiche › Informations › Rattacher un audio). L\'empreinte affichée permet de vérifier que l\'audio réimporté est identique.' }),
        ...audioList,
        h('h4', { text: 'Non transféré' }),
        h('ul', { class: 'plain' }, h('li', { text: 'Réglages d\'affichage (thème, fonctions avancées) : à refaire' }), h('li', { text: 'Brouillon de saisie non enregistré' }), h('li', { text: 'Modèles d\'IA locale téléchargés (Qwen) : à retélécharger si vous réactivez ces fonctions' }),
          h('li', { text: 'Coffre chiffré : à recréer sur la nouvelle installation (un mot de passe différent est possible), les fiches restaurées sont chiffrées à l\'écriture' })),
        h('div', { class: 'sheet-actions' }, h('button', { class: 'btn', text: 'Fermer', onclick: close })));
    } });
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
  const securityNode = h('div', {});
  import('./vault-ui.js').then((m) => securityNode.append(m.securityBlock({ refresh: () => {} }))).catch(() => securityNode.append(h('p', { class: 'hint', text: 'Module de sécurité indisponible.' })));
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
            h('button', { class: 'btn', onclick: restoreFlow }, icon('archive'), h('span', { text: 'Restaurer' }))),
          h('button', { class: 'btn', style: { marginTop: '10px' }, onclick: inventorySheet }, icon('clipboard'), h('span', { text: 'Inventaire avant migration' })),
          h('a', { class: 'btn', style: { marginTop: '10px' }, href: '#/corbeille' }, icon('trash'), h('span', { text: 'Corbeille' })))),

      group('Sécurité', securityNode),
      h('div', { class: 'settings-group' }, vocabAccordion()),
      group('Apparence', themeBlock()),

      ...(advancedNodes.ia ? [h('div', { class: 'settings-group' }, advancedNodes.ia)] : []),
      h('details', { class: 'settings-group evid' }, h('summary', { text: 'Options avancées (outils de test)' }),
        h('p', { class: 'hint', text: 'Anciennes fonctions de laboratoire : IA locale, enregistrement et transcription de test. Elles ne font pas partie du parcours normal et sont masquées par défaut.' }), advancedBlock()),

      group('Confidentialité',
        h('div', { class: 'card' }, h('ul', { class: 'plain', style: { marginTop: 0 } },
          h('li', { text: 'Vos entretiens sont enregistrés uniquement sur cet appareil, dans le navigateur.' }),
          h('li', { text: 'L\'application n\'envoie ni audio, ni transcription, ni compte rendu : elle ne contient aucun code d\'envoi de données et aucun outil de suivi.' }),
          h('li', { text: 'Elle est téléchargée depuis GitHub Pages : GitHub voit qu\'un appareil consulte l\'application, jamais votre contenu.' }),
          h('li', { text: 'Limites : tant que le coffre chiffré n\'est pas activé (Réglages › Sécurité), les données ne sont pas chiffrées par l\'application (le code de l\'iPhone les protège quand il est verrouillé).' }),
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
          h('p', { class: 'hint', text: 'ADE-CI Notes, développé pour Ade-ci Family Office. Polices Abhaya Libre (titres) et Open Sans (textes), licence SIL OFL.' }))),
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
