// Écrans du coffre chiffré : verrouillage, activation guidée (mot de passe, clé de récupération, sauvegarde vérifiée, chiffrement des fiches),
// changement de mot de passe, nouvelle clé de récupération, délai de verrouillage. Chargé seulement si le coffre existe ou si on l'ouvre dans les Réglages.
import { h, icon, toast, sheet, confirmDialog, promptDialog } from './ui.js';
import * as V from './vault.js';
import * as B from './backup.js';
import { shareOrDownload, copyText } from './exports.js';
import { APP_VERSION } from './version.js';
import { getSettings, setSetting } from './store.js';

// ---------- Nom d'espace (libellé NON secret : aide à reconnaître à qui est cet espace, n'authentifie personne) ----------
export const spaceName = () => { const v = getSettings().spaceName; return typeof v === 'string' ? v.trim().slice(0, 40) : ''; };
function spaceNameRow() {
  const inp = h('input', { class: 'field', value: spaceName(), maxlength: '40', placeholder: 'Ex. Espace de Marie', 'aria-label': 'Nom de l\'espace', autocomplete: 'off' });
  inp.addEventListener('change', () => { setSetting('spaceName', inp.value.trim().slice(0, 40)); window.dispatchEvent(new Event('dia-space')); toast('Nom d\'espace enregistré'); });
  return h('div', { style: { marginTop: '14px' } },
    h('label', { class: 'lbl', text: 'Nom de l\'espace (facultatif)' }), inp,
    h('p', { class: 'hint', text: 'Affiché sur l\'écran de verrouillage et dans le menu, pour reconnaître cet espace. Ce n\'est pas un identifiant de connexion : n\'y mettez aucune information confidentielle. Chaque navigateur ou session Windows garde son propre espace.' }));
}

// ---------- Invitation à activer le coffre (accueil) : disparaît une fois activé, ou 7 jours si « Plus tard » ----------
export function inviteCard() {
  if (V.state() !== 'absent') return null;
  const until = Number(getSettings().vaultInviteUntil) || 0;
  if (until > Date.now()) return null;
  const card = h('div', { class: 'banner', style: { marginTop: '12px' } }, icon('shield'), h('div', {},
    h('div', { style: { fontWeight: '700' }, text: 'Protégez vos fiches par un mot de passe' }),
    h('p', { class: 'hint', style: { margin: '4px 0 8px' }, text: 'Le coffre chiffre vos fiches sur cet appareil. Le mot de passe est demandé à l\'ouverture et après un délai d\'inactivité ; une clé de récupération vous est remise. Aucun compte en ligne, rien n\'est envoyé.' }),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn small primary', text: 'Activer le coffre', onclick: () => wizard({ refresh: () => card.remove() }) }),
      h('button', { class: 'btn small', text: 'Plus tard', onclick: () => { setSetting('vaultInviteUntil', Date.now() + 7 * 86400000); card.remove(); } }))));
  return card;
}

// ---------- Écran de verrouillage (plein écran) ----------
export function lockScreen() {
  return new Promise((resolve) => {
    const msg = h('p', { class: 'hint', style: { minHeight: '22px', color: 'var(--danger)' } });
    const pw = h('input', { class: 'field', type: 'password', placeholder: 'Mot de passe', autocomplete: 'current-password', autocapitalize: 'none', 'aria-label': 'Mot de passe', enterkeyhint: 'go' });
    const go = h('button', { class: 'btn primary', type: 'button' }, icon('check'), h('span', { text: 'Déverrouiller' }));
    const bioBtn = V.biometricEnabled() ? h('button', { class: 'btn', type: 'button', style: { marginTop: '10px' }, onclick: async () => { msg.textContent = ''; try { await V.unlockBiometric(); overlay.remove(); document.body.classList.remove('noscroll'); resolve(); } catch (e) { msg.textContent = e.message; } } }, icon('user'), h('span', { text: 'Déverrouiller avec Face ID' })) : null;
    const overlay = h('div', { class: 'lockscreen', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'ADE-CI Notes verrouillé' },
      h('div', { class: 'lock-box' },
        h('img', { src: 'img/emblem-tile.png', alt: '', width: 72, height: 72, style: { borderRadius: '18px' } }),
        h('h1', { class: 'serif', style: { fontSize: '28px', margin: '14px 0 4px' }, text: 'ADE-CI Notes est verrouillé' }),
        spaceName() ? h('p', { class: 'hint', style: { fontWeight: '600', color: 'var(--ink)' }, text: 'Espace : ' + spaceName() }) : null,
        h('p', { class: 'hint', text: 'Vos fiches sont chiffrées sur cet appareil. Saisissez votre mot de passe.' }),
        pw, h('div', { style: { height: '10px' } }), go, bioBtn, msg,
        h('button', { class: 'linkbtn', type: 'button', text: 'Mot de passe oublié ? Utiliser la clé de récupération', onclick: recovery })));
    const done = () => { overlay.remove(); document.body.classList.remove('noscroll'); resolve(); };
    async function attempt() {
      msg.textContent = ''; go.disabled = true;
      try { await V.unlock(pw.value); pw.value = ''; done(); }
      catch (e) { msg.textContent = e.message; go.disabled = false; pw.select(); }
    }
    go.addEventListener('click', attempt);
    pw.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') attempt(); });
    function recovery() {
      sheet({ title: 'Clé de récupération', build(body, close) {
        const key = h('input', { class: 'field', placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX', autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Clé de récupération' });
        const err = h('p', { class: 'hint', style: { color: 'var(--danger)' } });
        const ok = h('button', { class: 'btn primary', text: 'Utiliser la clé', onclick: async () => {
          err.textContent = '';
          try {
            await V.unlockWithRecovery(key.value);
            close();
            await newPasswordSheet();     // après une récupération, choisir immédiatement un nouveau mot de passe
            done();
          } catch (e) { err.textContent = e.message; }
        } });
        body.append(h('p', { class: 'hint', style: { marginTop: 0 }, text: 'Saisissez la clé de récupération notée lors de l\'activation du coffre. Vous choisirez ensuite un nouveau mot de passe.' }), key, err,
          h('div', { class: 'sheet-actions' }, ok, h('button', { class: 'btn', text: 'Annuler', onclick: close })));
      } });
    }
    document.body.append(overlay); document.body.classList.add('noscroll');
    setTimeout(() => pw.focus(), 50);
  });
}
function newPasswordSheet() {
  return new Promise((resolve) => {
    sheet({ title: 'Nouveau mot de passe', build(body, close) {
      const a = h('input', { class: 'field', type: 'password', placeholder: 'Nouveau mot de passe', autocomplete: 'new-password' });
      const b = h('input', { class: 'field', type: 'password', placeholder: 'Confirmer', autocomplete: 'new-password', style: { marginTop: '8px' } });
      const hint = h('p', { class: 'hint', style: { color: 'var(--danger)' } });
      body.append(h('p', { class: 'hint', style: { marginTop: 0 }, text: 'Votre ancien mot de passe est remplacé. Vos données restent intactes.' }), a, b, hint,
        h('div', { class: 'sheet-actions' }, h('button', { class: 'btn primary', text: 'Enregistrer', onclick: async () => {
          if (a.value !== b.value) { hint.textContent = 'Les deux mots de passe sont différents.'; return; }
          try { await V.resetPasswordAfterRecovery(a.value); toast('Mot de passe modifié'); close(); resolve(); } catch (e) { hint.textContent = e.message; }
        } })));
    } });
  });
}

// ---------- Bloc « Sécurité » des Réglages ----------
export function securityBlock({ refresh }) {
  const box = h('div', { class: 'card' });
  async function draw() {
    box.replaceChildren();
    const st = V.state();
    if (st === 'absent') {
      box.append(
        h('div', { style: { fontWeight: '700', color: 'var(--ink)' }, text: 'Coffre chiffré : non activé' }),
        h('p', { class: 'hint', text: 'Chiffre réellement vos fiches, dossiers et fichiers importés avec un mot de passe (AES-256). Sans lui, les données restent illisibles pour quiconque copierait le contenu du navigateur. Ce n\'est pas un simple écran de verrouillage.' }),
        h('p', { class: 'hint', text: 'Attention : si vous perdez à la fois le mot de passe et la clé de récupération, vos données chiffrées sont définitivement perdues. L\'activation exige une sauvegarde vérifiée.' }),
        h('button', { class: 'btn primary', onclick: () => wizard({ refresh: draw }) }, icon('shield'), h('span', { text: 'Activer le coffre chiffré…' })),
        spaceNameRow());
      return;
    }
    const c = await V.counts();
    const bioNode = await bioBlock();
    const remaining = (c.sessions - c.sessionsEncrypted) + (c.folders - c.foldersEncrypted) + (c.originals - c.originalsEncrypted) + (c.chunks - c.chunksEncrypted) + c.kvPlain;
    const sel = h('select', { class: 'field', 'aria-label': 'Verrouillage automatique' }, [[1, '1 minute'], [5, '5 minutes'], [15, '15 minutes'], [30, '30 minutes']].map(([v, l]) => h('option', { value: v, text: 'Verrouillage après ' + l, selected: V.autoLockMinutes() === v })));
    sel.addEventListener('change', async () => { await V.setAutoLock(+sel.value); toast('Verrouillage automatique : ' + sel.value + ' min'); });
    box.append(
      h('div', { style: { fontWeight: '700', color: 'var(--ink)' }, text: 'Coffre chiffré : actif' }),
      h('p', { class: 'hint', text: `Fiches chiffrées : ${c.sessionsEncrypted} sur ${c.sessions} · dossiers : ${c.foldersEncrypted} sur ${c.folders} · fichiers importés : ${c.originalsEncrypted} sur ${c.originals} · audio : ${c.chunksEncrypted} sur ${c.chunks} · listes et vocabulaire : ${c.kvPlain ? 'en clair' : 'chiffrés'}.` + (remaining ? ` ${remaining} élément(s) sont encore en clair : terminez le chiffrement.` : '') }),
      sel,
      h('div', { style: { display: 'grid', gap: '8px', marginTop: '12px' } },
        remaining ? h('button', { class: 'btn primary', onclick: () => migrationSheet({ refresh: draw }) }, icon('shield'), h('span', { text: 'Terminer le chiffrement des fiches' })) : null,
        h('button', { class: 'btn', onclick: () => { V.lock(); } }, icon('shield'), h('span', { text: 'Verrouiller maintenant' })),
        h('button', { class: 'btn', onclick: changePasswordSheet }, icon('edit'), h('span', { text: 'Changer le mot de passe' })),
        h('button', { class: 'btn', onclick: () => newRecoverySheet() }, icon('doc'), h('span', { text: 'Nouvelle clé de récupération' })),
        h('button', { class: 'btn danger-ghost', onclick: () => disableSheet({ refresh: draw }) }, icon('trash'), h('span', { text: 'Désactiver le coffre' }))),
      h('p', { class: 'hint', text: 'La désactivation déchiffre toutes vos fiches sur cet appareil.' }),
      bioNode,
      spaceNameRow());
  }
  draw();
  const off = V.onState(() => { if (!box.isConnected) { off(); return; } draw(); });
  return box;
}

function changePasswordSheet() {
  sheet({ title: 'Changer le mot de passe', build(body, close) {
    const o = h('input', { class: 'field', type: 'password', placeholder: 'Mot de passe actuel', autocomplete: 'current-password' });
    const n1 = h('input', { class: 'field', type: 'password', placeholder: 'Nouveau mot de passe', autocomplete: 'new-password', style: { marginTop: '8px' } });
    const n2 = h('input', { class: 'field', type: 'password', placeholder: 'Confirmer le nouveau mot de passe', autocomplete: 'new-password', style: { marginTop: '8px' } });
    const hint = h('p', { class: 'hint', style: { color: 'var(--danger)' } });
    body.append(o, n1, n2, hint, h('p', { class: 'hint', text: 'Vos données ne sont pas rechiffrées : seule la protection de la clé change. Les anciennes sauvegardes gardent leur propre mot de passe.' }),
      h('div', { class: 'sheet-actions' }, h('button', { class: 'btn primary', text: 'Changer', onclick: async () => {
        if (n1.value !== n2.value) { hint.textContent = 'Les deux nouveaux mots de passe sont différents.'; return; }
        try { await V.changePassword(o.value, n1.value); toast('Mot de passe modifié'); close(); } catch (e) { hint.textContent = e.message; }
      } }), h('button', { class: 'btn', text: 'Annuler', onclick: close })));
  } });
}
async function newRecoverySheet() {
  const pw = await promptDialog({ title: 'Nouvelle clé de récupération', label: 'Mot de passe actuel', type: 'password', confirmLabel: 'Continuer', message: 'L\'ancienne clé de récupération cessera de fonctionner.' });
  if (!pw) return;
  try { const key = await V.newRecoveryKey(pw); showRecoveryKey(key); } catch (e) { toast(e.message, 4000); }
}
function showRecoveryKey(key, onDone) {
  sheet({ title: 'Clé de récupération', build(body, close) {
    body.append(
      h('p', { class: 'hint', style: { marginTop: 0 }, text: 'Notez cette clé sur papier et rangez-la hors de l\'appareil (coffre, gestionnaire de mots de passe). Elle n\'est affichée qu\'une fois.' }),
      h('div', { class: 'reckey', text: key }),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn small', onclick: async () => { toast((await copyText(key)) ? 'Clé copiée' : 'Copie impossible'); } }, icon('copy'), h('span', { text: 'Copier' })),
        h('button', { class: 'btn small', onclick: () => { const w = window.open('', '_blank'); if (w) { w.document.write('<pre style="font:24px monospace;padding:40px">ADE-CI Notes — clé de récupération\n\n' + key + '\n\nÀ conserver hors de l\'appareil.</pre>'); w.document.close(); w.print(); } } }, icon('doc'), h('span', { text: 'Imprimer' }))),
      h('div', { class: 'sheet-actions' }, h('button', { class: 'btn primary', text: 'J\'ai noté la clé', onclick: () => { close(); if (onDone) onDone(); } })));
  } });
}
function disableSheet({ refresh }) {
  sheet({ title: 'Désactiver le coffre', build(body, close) {
    const pw = h('input', { class: 'field', type: 'password', placeholder: 'Mot de passe', autocomplete: 'current-password' });
    const hint = h('p', { class: 'hint', style: { color: 'var(--danger)' } });
    body.append(h('p', { class: 'hint', style: { marginTop: 0 }, text: 'Toutes les fiches seront déchiffrées et de nouveau stockées en clair sur cet appareil. Aucune donnée n\'est supprimée.' }), pw, hint,
      h('div', { class: 'sheet-actions' }, h('button', { class: 'btn danger', text: 'Déchiffrer et désactiver', onclick: async () => {
        try { const r = await V.disable(pw.value); toast(`${r.sessions} fiche(s) et ${r.folders} dossier(s) déchiffrés`, 4000); close(); refresh(); } catch (e) { hint.textContent = e.message; }
      } }), h('button', { class: 'btn', text: 'Annuler', onclick: close })));
  } });
}

// ---------- Migration (reprise possible) ----------
function migrationSheet({ refresh, onDone }) {
  sheet({ title: 'Chiffrement des fiches', build(body, close) {
    const bar = h('progress', { max: '1', value: '0', style: { width: '100%' } });
    const msg = h('p', { class: 'hint', text: 'Chaque fiche est chiffrée, relue et comparée avant d\'être remplacée. Vous pouvez interrompre : relancer reprend là où c\'est arrêté.' });
    const closeBtn = h('button', { class: 'btn', text: 'Fermer', onclick: () => { close(); refresh && refresh(); } });
    body.append(msg, bar, h('div', { class: 'sheet-actions' }, closeBtn));
    (async () => {
      try {
        const r = await V.migrateAll({ onProgress: ({ done, total }) => { bar.value = total ? done / total : 1; } });
        bar.value = 1;
        msg.textContent = `Terminé : ${r.sessions} fiche(s) et ${r.folders} dossier(s) chiffrés, ${r.already} déjà chiffrés` + (r.failed.length ? `, ${r.failed.length} en échec (restés en clair, aucune perte).` : '.');
        if (onDone) onDone(r);
      } catch (e) { msg.textContent = 'Interrompu : ' + e.message + ' Vos fiches ne sont pas perdues ; relancez le chiffrement.'; }
    })();
  } });
}

// ---------- Activation guidée ----------
function wizard({ refresh }) {
  const s = sheet({ title: 'Activer le coffre chiffré', wide: true, build(body, close) {
    const stepBox = h('div', {});
    body.append(stepBox);
    const st = { password: '', recovery: '' };
    const step1 = () => {
      const c1 = h('input', { type: 'checkbox' }), c2 = h('input', { type: 'checkbox' }), c3 = h('input', { type: 'checkbox' });
      const next = h('button', { class: 'btn primary', text: 'Continuer', disabled: true, onclick: step2 });
      const upd = () => { next.disabled = !(c1.checked && c2.checked && c3.checked); };
      [c1, c2, c3].forEach((c) => c.addEventListener('change', upd));
      stepBox.replaceChildren(
        h('p', { class: 'hint', style: { marginTop: 0 }, text: 'Étape 1 sur 4 : ce que cela change' }),
        h('ul', { class: 'plain' },
          h('li', { text: 'Vos fiches, dossiers et fichiers importés seront chiffrés sur cet appareil avec une clé protégée par votre mot de passe.' }),
          h('li', { text: 'Aucune réinitialisation possible : en cas d\'oubli, seuls la clé de récupération ou une sauvegarde chiffrée permettent de retrouver vos données.' }),
          h('li', { text: 'Le chiffrement ne protège pas un appareil déverrouillé avec l\'application ouverte, ni une extension de navigateur qui lit la page.' })),
        h('label', { class: 'check' }, c1, h('span', { text: 'J\'ai compris qu\'un mot de passe oublié sans clé de récupération ni sauvegarde est irrécupérable.' })),
        h('label', { class: 'check' }, c2, h('span', { text: 'Je vais conserver une sauvegarde chiffrée hors de cet appareil.' })),
        h('label', { class: 'check' }, c3, h('span', { text: 'Je sais que les trames (modèles de comptes rendus) et les réglages techniques ne sont pas chiffrés.' })),
        h('div', { class: 'sheet-actions' }, next, h('button', { class: 'btn', text: 'Annuler', onclick: close })));
    };
    const step2 = () => {
      const a = h('input', { class: 'field', type: 'password', placeholder: 'Mot de passe', autocomplete: 'new-password' });
      const b = h('input', { class: 'field', type: 'password', placeholder: 'Confirmer le mot de passe', autocomplete: 'new-password', style: { marginTop: '8px' } });
      const issues = h('ul', { class: 'plain', style: { color: 'var(--danger)' } });
      const next = h('button', { class: 'btn primary', text: 'Continuer', disabled: true });
      const upd = () => {
        const list = V.passwordIssues(a.value); if (a.value && b.value && a.value !== b.value) list.push('Les deux mots de passe sont différents.');
        issues.replaceChildren(...list.map((t) => h('li', { text: t }))); next.disabled = !(a.value && list.length === 0 && b.value);
      };
      a.addEventListener('input', upd); b.addEventListener('input', upd);
      next.addEventListener('click', async () => {
        next.disabled = true; next.textContent = 'Création…';
        try { const r = await V.create(a.value); st.password = a.value; st.recovery = r.recoveryKey; step3(); }
        catch (e) { issues.replaceChildren(h('li', { text: e.message })); next.disabled = false; next.textContent = 'Continuer'; }
      });
      stepBox.replaceChildren(
        h('p', { class: 'hint', style: { marginTop: 0 }, text: 'Étape 2 sur 4 : choisissez un mot de passe fort' }),
        h('p', { class: 'hint', text: 'Au moins 12 caractères mélangés, ou une phrase de 16 caractères ou plus. Ne réutilisez pas un mot de passe existant.' }),
        a, b, issues,
        h('div', { class: 'sheet-actions' }, next, h('button', { class: 'btn', text: 'Retour', onclick: step1 })));
    };
    const step3 = () => {
      const confirm = h('input', { class: 'field', placeholder: 'Ressaisissez la clé pour confirmer', autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false' });
      const err = h('p', { class: 'hint', style: { color: 'var(--danger)' } });
      const next = h('button', { class: 'btn primary', text: 'Continuer', onclick: () => {
        if (confirm.value.toUpperCase().replace(/[^A-Z2-7]/g, '') !== st.recovery.replace(/-/g, '')) { err.textContent = 'La clé saisie ne correspond pas : relisez ce que vous avez noté.'; return; }
        step4();
      } });
      stepBox.replaceChildren(
        h('p', { class: 'hint', style: { marginTop: 0 }, text: 'Étape 3 sur 4 : clé de récupération' }),
        h('p', { class: 'hint', text: 'Notez cette clé sur papier et rangez-la hors de l\'appareil. Elle permet de rouvrir le coffre si vous oubliez le mot de passe.' }),
        h('div', { class: 'reckey', text: st.recovery }),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn small', onclick: async () => { toast((await copyText(st.recovery)) ? 'Clé copiée' : 'Copie impossible'); } }, icon('copy'), h('span', { text: 'Copier' }))),
        confirm, err, h('div', { class: 'sheet-actions' }, next));
    };
    const step4 = () => {
      const saved = h('input', { type: 'checkbox' });
      const go = h('button', { class: 'btn primary', text: 'Chiffrer mes fiches', disabled: true });
      saved.addEventListener('change', () => { go.disabled = !saved.checked; });
      const state = h('p', { class: 'hint' });
      const mk = h('button', { class: 'btn', onclick: async () => {
        mk.disabled = true; state.textContent = 'Création et vérification de la sauvegarde…';
        try {
          const data = JSON.stringify(await B.buildBackup(APP_VERSION, { withProtect: true, withOriginals: true }));
          const text = await B.encryptText(data, st.password);
          const back = JSON.parse(await B.decryptEnvelope(JSON.parse(text), st.password));      // relecture à blanc
          const n = JSON.parse(data);
          if (back.sessions.length !== n.sessions.length || back.folders.length !== n.folders.length || (back.originals || []).length !== (n.originals || []).length) throw new Error('vérification impossible');
          const res = await shareOrDownload([new File([text], `ADE-CI-Notes-sauvegarde-avant-coffre-${new Date().toISOString().slice(0, 10)}.json`, { type: 'application/json' })], 'Sauvegarde ADE-CI Notes');
          if (res === 'annule') { state.textContent = 'Sauvegarde annulée.'; mk.disabled = false; return; }
          B.markBackupDone(); state.textContent = `Sauvegarde vérifiée : ${n.sessions.length} fiche(s), ${n.folders.length} dossier(s) relus avec succès. Elle s'ouvre avec le mot de passe que vous venez de choisir.`;
        } catch (e) { state.textContent = 'Échec : ' + e.message; mk.disabled = false; }
      } }, icon('share'), h('span', { text: 'Créer et vérifier la sauvegarde' }));
      go.addEventListener('click', () => { close(); migrationSheet({ refresh, onDone: () => toast('Coffre actif'), }); });
      stepBox.replaceChildren(
        h('p', { class: 'hint', style: { marginTop: 0 }, text: 'Étape 4 sur 4 : sauvegarde de sécurité puis chiffrement' }),
        h('p', { class: 'hint', text: 'Avant de chiffrer, créez une sauvegarde chiffrée de vos fiches actuelles. Elle est relue pour vérifier qu\'elle est complète. Rangez le fichier hors de cet appareil.' }),
        mk, state,
        h('label', { class: 'check' }, saved, h('span', { text: 'J\'ai enregistré le fichier de sauvegarde hors de cet appareil.' })),
        h('div', { class: 'sheet-actions' }, go));
    };
    step1();
  } });
  return s;
}

// Face ID : proposé uniquement dans la démonstration ou avec les fonctions avancées, tant que le test sur iPhone n'a pas conclu.
async function bioBlock() {
  let advanced = false; try { advanced = !!JSON.parse(localStorage.getItem('dia_settings') || '{}').advanced; } catch {}
  const demo = true;   // Face ID validé sur iPhone avec la version 0.8.5-demo : proposé de la même façon dans la version officielle
  if (!demo && !advanced && !V.biometricEnabled()) return h('p', { class: 'hint', style: { marginTop: '12px' }, text: 'Face ID : non proposé dans cette version (à valider sur iPhone avant toute activation). Le mot de passe reste la seule méthode.' });
  const box = h('div', { class: 'card', style: { marginTop: '12px' } });
  const supported = await V.biometricSupported();
  const on = V.biometricEnabled();
  box.append(h('div', { style: { fontWeight: '700', color: 'var(--ink)' }, text: 'Face ID (expérimental) : ' + (on ? 'activé' : 'non activé') }),
    h('p', { class: 'hint', text: 'Le mot de passe reste toujours disponible. Face ID n\'est pas garanti sur cet appareil : il est vérifié à l\'activation (deux lectures du même secret).' + (supported ? '' : ' Non disponible ici.') }),
    on ? h('button', { class: 'btn', onclick: async () => { await V.disableBiometric(); toast('Face ID désactivé'); } }, h('span', { text: 'Désactiver Face ID' }))
      : h('button', { class: 'btn', disabled: !supported, onclick: async (ev) => { ev.target.disabled = true; try { await V.enableBiometric(); toast('Face ID activé'); } catch (e) { toast(e.message, 6000); ev.target.disabled = false; } } }, h('span', { text: 'Activer Face ID' })));
  return box;
}