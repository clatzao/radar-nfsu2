// Base de ruas local (ex.: Maracás/BA): traçado exato do OpenStreetMap com nomes completados pelo IBGE.
// Quando o carro está dentro de uma cidade que tem base local, a seta e o nome da rua usam essa base
// (mais precisa que os dados gerais do mapa) e ela funciona sem internet, pois vem dentro do app.
// Também guarda as correções de nome feitas pelo usuário.
(() => {
  const { dist, load, save } = App;
  let index = [], active = null;           // active = { meta, feats, grid }
  const loaded = {};
  const CELL = 0.001;                      // ~110 m
  const key = (x, y) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;

  fetch('data/ruas/index.json').then(r => r.json()).then(l => { index = l || []; }).catch(() => {});

  const inside = (b, p) => p.lng >= b[0] && p.lng <= b[2] && p.lat >= b[1] && p.lat <= b[3];

  async function ensure(p) {
    const meta = index.find(e => inside(e.bbox, p));
    if (!meta) { active = null; return; }
    if (active && active.meta.codigo === meta.codigo) return;
    if (!loaded[meta.codigo]) {
      loaded[meta.codigo] = fetch('data/ruas/' + meta.arquivo).then(r => r.json()).then(build).catch(() => null);
    }
    const data = await loaded[meta.codigo];
    if (data) active = { meta, ...data };
  }

  function build(data) {
    const grid = new Map();
    const feats = data.ways.map(w => {
      const f = { properties: { id: w.id, name: w.n, class: w.c, brunnel: w.t ? 'tunnel' : '', fonte: w.f, alt: w.a || '' },
                  geometry: { type: 'LineString', coordinates: w.g } };
      const cells = new Set();
      for (let i = 0; i < w.g.length; i++) {
        const [x0, y0] = w.g[i], [x1, y1] = w.g[Math.min(i + 1, w.g.length - 1)];
        const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (CELL / 2)));
        for (let s = 0; s <= steps; s++) cells.add(key(x0 + (x1 - x0) * s / steps, y0 + (y1 - y0) * s / steps));
      }
      cells.forEach(k => (grid.get(k) || grid.set(k, []).get(k)).push(f));
      return f;
    });
    StreetMatch.linkWays(feats);
    return { feats, grid, data };
  }

  /** Trechos de rua da base local perto de p (ou null se p está fora de uma cidade com base local). */
  function near(p) {
    if (!index.length) return null;
    const meta = index.find(e => inside(e.bbox, p));
    if (!meta) return null;
    if (!active || active.meta.codigo !== meta.codigo) { ensure(p); return null; }
    const out = new Set();
    const cx = Math.floor(p.lng / CELL), cy = Math.floor(p.lat / CELL);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) (active.grid.get(`${cx + dx},${cy + dy}`) || []).forEach(f => out.add(f));
    return [...out];
  }

  // ---------- Correções de nome feitas pelo usuário ----------
  let fixes = load('nfsu2-street-fixes', {});     // { 'way:123': 'Nome', 'pt:<lat>,<lng>,<rumo>': { lat, lng, b, name } }
  const axis = (a, b) => { const x = Math.abs(((a - b + 540) % 360) - 180); return Math.min(x, 180 - x); };

  /** Nome corrigido pelo usuário para a via presa (road), se houver. */
  function fixedName(road) {
    if (!road) return null;
    if (road.props && road.props.id != null && fixes['way:' + road.props.id] != null) return fixes['way:' + road.props.id];
    for (const k in fixes) {
      const f = fixes[k];
      if (k.startsWith('pt:') && dist(f, road) < 35 && (road.b == null || axis(f.b, road.b) < 30)) return f.name;
    }
    return null;
  }
  function setFix(road, name) {
    if (road.props && road.props.id != null) {
      if (name == null) delete fixes['way:' + road.props.id]; else fixes['way:' + road.props.id] = name;
    } else {
      const k = `pt:${road.lat.toFixed(5)},${road.lng.toFixed(5)},${Math.round(road.b || 0)}`;
      for (const kk in fixes) if (kk.startsWith('pt:') && dist(fixes[kk], road) < 35 && axis(fixes[kk].b, road.b || 0) < 30) delete fixes[kk];
      if (name != null) fixes[k] = { lat: road.lat, lng: road.lng, b: road.b || 0, name };
    }
    save('nfsu2-street-fixes', fixes);
    App.emit('streetfix');
  }

  App.local = { near, fixedName, setFix, city: () => active && active.meta.cidade, covers: p => !!index.find(e => inside(e.bbox, p)) };
})();
