// Apparence : « clair » (par défaut, ambiance coquille d'œuf des maquettes), « sombre », ou « automatique » (suit l'iPhone / Windows).
// Ce petit script est chargé avant l'affichage pour éviter un clignotement.
(function () {
  var theme = 'light';
  try { var s = JSON.parse(localStorage.getItem('dia_settings')) || {}; if (s.theme === 'dark' || s.theme === 'auto' || s.theme === 'light') theme = s.theme; } catch (e) {}
  document.documentElement.setAttribute('data-theme', theme);
  var dark = theme === 'dark' || (theme === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  var metas = document.querySelectorAll('meta[name="theme-color"]');
  for (var i = metas.length - 1; i > 0; i--) metas[i].parentNode.removeChild(metas[i]);
  if (metas[0]) { metas[0].removeAttribute('media'); metas[0].setAttribute('content', dark ? '#071A33' : '#F6F0E7'); }
})();
