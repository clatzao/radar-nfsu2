// Núcleo compartilhado: utilitários, estado e ajustes salvos.
// Os scripts são clássicos (sem módulos) para funcionar também em file:// dentro do app Android.
'use strict';
window.App = {};
(() => {
  const $ = id => document.getElementById(id);

  // ---------- Geometria ----------
  const R = 6371000, rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const angDiff = (to, from) => ((to - from + 540) % 360) - 180;
  function dist(a, b) {
    const x = rad(b.lng - a.lng) * Math.cos(rad((a.lat + b.lat) / 2));
    return Math.hypot(x, rad(b.lat - a.lat)) * R;
  }
  function brg(a, b) {
    const x = rad(b.lng - a.lng) * Math.cos(rad((a.lat + b.lat) / 2));
    return (deg(Math.atan2(x, rad(b.lat - a.lat))) + 360) % 360;
  }
  function offset(p, bearing, m) {
    return { lat: p.lat + deg(m * Math.cos(rad(bearing)) / R),
             lng: p.lng + deg(m * Math.sin(rad(bearing)) / (R * Math.cos(rad(p.lat)))) };
  }
  /** Ponto mais próximo de p no segmento A-B ([lng,lat]); devolve distância, rumo do segmento, fração e o ponto. */
  function segInfo(p, A, B) {
    const k = Math.cos(rad(p.lat)) * 111320, m = 110540;
    const ax = (A[0] - p.lng) * k, ay = (A[1] - p.lat) * m, bx = (B[0] - p.lng) * k, by = (B[1] - p.lat) * m;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const t = L2 ? clamp(-(ax * dx + ay * dy) / L2, 0, 1) : 0;
    return { d: Math.hypot(ax + t * dx, ay + t * dy), b: (deg(Math.atan2(dx, dy)) + 360) % 360, t,
             lng: A[0] + (B[0] - A[0]) * t, lat: A[1] + (B[1] - A[1]) * t };
  }
  const lines = g => g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];

  // ---------- Formatação ----------
  function fmtDist(m) {
    if (m == null || !isFinite(m)) return '—';
    if (m < 1000) return (m < 100 ? Math.round(m / 10) * 10 : Math.round(m / 50) * 50) + ' m';
    return (m < 10000 ? (m / 1000).toFixed(1).replace('.', ',') : Math.round(m / 1000)) + ' km';
  }
  function fmtDuration(s) {
    const min = Math.max(1, Math.round(s / 60));
    return min < 60 ? min + ' min' : Math.floor(min / 60) + ' h ' + String(min % 60).padStart(2, '0');
  }
  const fmtClock = d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- Dados trazidos da versão antiga do app (só acontece uma vez) ----------
  try {
    const json = window.NFSU2Native && window.NFSU2Native.takeMigration && window.NFSU2Native.takeMigration();
    if (json) {
      const old = JSON.parse(json);
      Object.keys(old).forEach(k => { if (localStorage.getItem(k) == null) localStorage.setItem(k, old[k]); });
    }
  } catch (e) {}

  // ---------- Armazenamento local (no app fica salvo no aparelho) ----------
  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
  }
  function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {} }

  // ---------- Ajustes ----------
  const DEFAULTS = {
    showSpeedo: true,
    speedoSize: 'P',       // P, M ou G
    voice: true,           // instruções faladas da rota
    units: 'kmh',          // 'kmh' ou 'mph'
    showPoi: true,
    pitch: 38,             // inclinação do mapa, como o disco do radar no jogo
    avoidTolls: false,
    avoidUnpaved: false,
    simulate: false,       // simula um carro andando (para testar sem sair de casa)
    autoUpdate: true       // procura versão nova do app no GitHub
  };
  const settings = Object.assign({}, DEFAULTS, load('nfsu2-settings', {}));
  const listeners = [];
  function setSetting(key, value) {
    settings[key] = value;
    save('nfsu2-settings', settings);
    listeners.forEach(fn => fn(key, value));
  }

  // ---------- Estado da posição ----------
  const S = { mode: 'gps', fix: null, target: null, shown: null, acc: null,
              heading: 0, bearing: 0, speedMs: 0, speedKmh: 0, zoom: 16.4, lastFix: 0 };

  // ---------- Interface ----------
  function toast(msg, ms = 3500) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms);
  }
  const SHEETS = ['routeSheet', 'placesSheet', 'placeForm', 'settingsSheet', 'offlineSheet', 'streetFix'];
  function openSheet(id) {
    SHEETS.forEach(s => ($(s).hidden = s !== id));
    closeCard();
  }
  function closeSheets() {
    SHEETS.forEach(s => ($(s).hidden = true));
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }
  function closeCard() { $('card').hidden = true; }
  document.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheets(); });

  Object.assign(App, {
    $, R, rad, deg, clamp, angDiff, dist, brg, offset, segInfo, lines,
    fmtDist, fmtDuration, fmtClock, esc, load, save,
    settings, setSetting, onSetting: fn => listeners.push(fn),
    S, toast, openSheet, closeSheets, closeCard,
    NATIVE: window.NFSU2Native || null
  });
})();
