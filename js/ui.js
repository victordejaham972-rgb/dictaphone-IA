// Petits composants d'interface. Le contenu saisi par l'utilisateur est toujours inséré en texte (jamais en HTML).
const NS = 'http://www.w3.org/2000/svg';

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

const ICONS = {
  home: 'M4 11l8-7 8 7v9a1 1 0 01-1 1h-4v-6H9v6H5a1 1 0 01-1-1z',
  folder: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z',
  'folder-plus': 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2zM12 10v6M9 13h6',
  plus: 'M12 5v14M5 12h14',
  doc: 'M7 3h7l5 5v12a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1zM14 3v5h5M9 13h7M9 17h7',
  template: 'M5 4h14v5H5zM5 13h6v7H5zM15 13h4v7h-4z',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z',
  back: 'M15 5l-7 7 7 7',
  chevron: 'M9 5l7 7-7 7',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-4.5-4.5',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM5 20c0-3.5 3-6 7-6s7 2.5 7 6',
  screen: 'M4 5h16a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1zM8 20h8M12 16v4',
  users: 'M9 11a3 3 0 100-6 3 3 0 000 6zM3 19c0-3 2.5-5 6-5s6 2 6 5M16 11a2.5 2.5 0 100-5M18 14c2 .5 3 2 3 4',
  check: 'M5 12l5 5 9-10',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  copy: 'M8 8h11v12H8zM5 16V4h11',
  share: 'M12 4v11M8 8l4-4 4 4M5 14v5h14v-5',
  clipboard: 'M9 4h6v3H9zM7 6H5v15h14V6h-2M9 12h6M9 16h6',
  upload: 'M12 16V5M8 9l4-4 4 4M5 15v4h14v-4',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  info: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 11v6M12 7.5v.5',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  play: 'M8 5v14l11-7z',
  pause: 'M8 5v14M16 5v14',
  move: 'M5 12h14M13 6l6 6-6 6',
  archive: 'M4 5h16v4H4zM6 9v10h12V9M10 13h4',
  sparkle: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z',
  flask: 'M9 3h6M10 3v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3',
};
export function icon(name, cls) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
  if (cls) s.setAttribute('class', cls);
  const p = document.createElementNS(NS, 'path'); p.setAttribute('d', ICONS[name] || ICONS.doc);
  s.appendChild(p);
  return s;
}
export const catIcon = (cat) => icon({ clients: 'user', webinaires: 'screen', internes: 'users' }[cat] || 'folder');

// ---------- Retours à l'utilisateur ----------
let toastTimer = null;
export function toast(msg, ms = 2600) {
  let t = document.getElementById('toast');
  if (!t) { t = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------- Feuilles (fenêtres du bas) ----------
export function sheet({ title, build, wide = false }) {
  const overlay = h('div', { class: 'overlay' });
  const box = h('div', { class: 'sheet' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title || '' });
  const grab = h('div', { class: 'grab' });
  box.append(grab);
  if (title) box.append(h('h3', { class: 'sheet-title', text: title }));
  const close = () => { overlay.classList.remove('in'); document.body.classList.remove('noscroll'); setTimeout(() => overlay.remove(), 200); };
  const body = h('div', { class: 'sheet-body' });
  box.append(body);
  build(body, close);
  overlay.append(box);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.append(overlay);
  document.body.classList.add('noscroll');
  requestAnimationFrame(() => overlay.classList.add('in'));
  return { close, body };
}

export function confirmDialog({ title, message, confirmLabel = 'Confirmer', cancelLabel = 'Annuler', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const s = sheet({ title, build(body, close) {
      body.append(
        h('p', { class: 'sheet-msg', text: message }),
        h('div', { class: 'sheet-actions' },
          h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), text: confirmLabel, onclick: () => { done(true); close(); } }),
          h('button', { class: 'btn', text: cancelLabel, onclick: () => { done(false); close(); } })));
    } });
    s.body.parentElement.parentElement.addEventListener('click', (e) => { if (e.target.classList.contains('overlay')) done(false); });
  });
}

export function promptDialog({ title, label, value = '', placeholder = '', confirmLabel = 'Enregistrer', type = 'text', message = '' }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const s = sheet({ title, build(body, close) {
      const input = h('input', { class: 'field', type, value, placeholder, autocomplete: type === 'password' ? 'off' : 'off', autocapitalize: type === 'password' ? 'none' : 'sentences', maxlength: '200' });
      if (message) body.append(h('p', { class: 'sheet-msg', text: message }));
      const ok = () => { const v = input.value.trim(); if (!v) { input.focus(); return; } done(v); close(); };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
      body.append(label ? h('label', { class: 'lbl', text: label }) : null, input,
        h('div', { class: 'sheet-actions' },
          h('button', { class: 'btn primary', text: confirmLabel, onclick: ok }),
          h('button', { class: 'btn', text: 'Annuler', onclick: () => { done(null); close(); } })));
      setTimeout(() => { input.focus(); input.select(); }, 250);
    } });
    s.body.parentElement.parentElement.addEventListener('click', (e) => { if (e.target.classList.contains('overlay')) done(null); });
  });
}

export function actionSheet({ title, actions }) {
  sheet({ title, build(body, close) {
    body.append(h('div', { class: 'actions-list' }, actions.map((a) => h('button', {
      class: 'action' + (a.danger ? ' danger' : ''),
      onclick: () => { close(); setTimeout(() => a.run && a.run(), 120); },
    }, a.icon ? icon(a.icon) : null, h('span', {}, a.label, a.sub ? h('small', { class: 'a-sub', text: a.sub }) : null)))),
    h('button', { class: 'btn', text: 'Fermer', onclick: close }));
  } });
}

export function autosize(ta) {
  const fit = () => { ta.style.height = 'auto'; ta.style.height = Math.max(ta.scrollHeight + 2, 96) + 'px'; };
  ta.addEventListener('input', fit);
  requestAnimationFrame(fit);
  return fit;
}

export function empty(title, text, action) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-title serif', text: title }), text ? h('p', { text }) : null, action || null);
}

// Enregistrement automatique différé + sécurité si la page est masquée ou fermée
export function debouncedSaver(fn, delay = 700) {
  let timer = null, pending = false;
  const flush = async () => { clearTimeout(timer); timer = null; if (pending) { pending = false; await fn(); } };
  const trigger = () => { pending = true; clearTimeout(timer); timer = setTimeout(flush, delay); };
  const onHide = () => { if (document.hidden) flush(); };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', flush);
  const dispose = async () => { document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', flush); await flush(); };
  return { trigger, flush, dispose };
}
