// Casamento de posição com a via e escolha do nome da rua.
// Funções puras (sem mapa nem tela): o app usa no navegador/APK e o teste automático usa no Node.
(function (root) {
  'use strict';
  const R = 6371000, rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const angDiff = (to, from) => ((to - from + 540) % 360) - 180;
  const axisOff = (a, b) => { const x = Math.abs(angDiff(a, b)); return Math.min(x, 180 - x); };   // diferença sem sentido (0–90°)
  function dist(a, b) {
    const x = rad(b.lng - a.lng) * Math.cos(rad((a.lat + b.lat) / 2));
    return Math.hypot(x, rad(b.lat - a.lat)) * R;
  }
  function segInfo(p, A, B) {
    const k = Math.cos(rad(p.lat)) * 111320, m = 110540;
    const ax = (A[0] - p.lng) * k, ay = (A[1] - p.lat) * m, bx = (B[0] - p.lng) * k, by = (B[1] - p.lat) * m;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const t = L2 ? clamp(-(ax * dx + ay * dy) / L2, 0, 1) : 0;
    return { d: Math.hypot(ax + t * dx, ay + t * dy), b: (deg(Math.atan2(dx, dy)) + 360) % 360, t,
             lng: A[0] + (B[0] - A[0]) * t, lat: A[1] + (B[1] - A[1]) * t, len: Math.sqrt(L2) };
  }
  const lines = g => g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
  const ROAD_CLASSES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service']);

  /**
   * Prende a posição do GPS na via mais provável.
   * feats: trechos da camada "transportation" perto do ponto ({ properties, geometry } em lng/lat).
   * prev: via anterior ({ lat, lng, b }) para dar continuidade.
   */
  function snap(p, acc, moving, heading, prev, feats) {
    const maxD = clamp(acc || 15, 10, 25);
    const goodGps = acc == null || acc <= 25;
    const tunnelPenalty = goodGps ? 20 : 0;
    const surfaceD = Math.max(maxD, 28);
    let best = null, bestScore = Infinity;
    for (const f of feats) {
      if (!ROAD_CLASSES.has(f.properties.class)) continue;
      const tunnel = f.properties.brunnel === 'tunnel';
      for (const ln of lines(f.geometry)) {
        for (let i = 1; i < ln.length; i++) {
          const s = segInfo(p, ln[i - 1], ln[i]);
          if (s.d > (tunnel || !goodGps ? maxD : surfaceD)) continue;
          let score = s.d + (tunnel ? tunnelPenalty : 0);
          const ref = moving ? heading : (prev ? prev.b : null);
          if (ref != null) {
            const off = axisOff(s.b, ref);
            if (moving && off > 45) continue;
            score += off * (moving ? .35 : .15);
          }
          if (prev && dist(prev, s) < 30 && axisOff(s.b, prev.b) < 20) score -= 4;
          // Topologia (só na base local, onde cada via tem id e sabe com quais outras se liga):
          // continuar na mesma via ou numa via ligada a ela é natural; pular para uma paralela sem ligação,
          // não (é o GPS oscilando entre a avenida e a marginal/rua ao lado).
          const pid = prev && prev.props && prev.props.id;
          if (pid != null && f.properties.id != null) {
            if (f.properties.id === pid) score -= 6;
            else if (f.properties.links && f.properties.links.has(pid)) score -= 2;
            else if (dist(prev, s) < 60) score += 8;
          }
          if (score < bestScore) { bestScore = score; best = s; best.tunnel = tunnel; best.props = f.properties; }
        }
      }
    }
    return best ? { lat: best.lat, lng: best.lng, b: best.b, d: best.d, tunnel: best.tunnel, props: best.props } : null;
  }

  /** Melhor nome entre as linhas "transportation_name" próximas ao ponto p, no rumo da via. */
  function pickName(p, bearing, feats, maxD, maxAngle, roadIsTunnel) {
    let best = null, bestScore = Infinity, nearest = Infinity, nearestName = '';
    for (const f of feats) {
      const pr = f.properties;
      const name = pr['name:pt'] || pr.name || pr['name:latin'];
      if (!name || !ROAD_CLASSES.has(pr.class)) continue;
      for (const ln of lines(f.geometry)) {
        for (let i = 1; i < ln.length; i++) {
          const s = segInfo(p, ln[i - 1], ln[i]);
          if (s.d < nearest) { nearest = s.d; nearestName = name; }
          if (s.d > maxD) continue;
          let score = s.d;
          if (bearing != null) {
            const off = axisOff(s.b, bearing);
            if (off > maxAngle) continue;
            score += off * .4;
          }
          if (/^t[úu]nel\b/i.test(name) && !roadIsTunnel) score += 25;
          if (score < bestScore) { bestScore = score; best = name; }
        }
      }
    }
    return { best, nearest: isFinite(nearest) ? nearest : null, nearestName };
  }

  /** Nome para a via presa (road) ou, sem via, para o ponto do GPS. */
  function nameFor(road, target, heading, moving, nameFeats) {
    const p = road ? { lat: road.lat, lng: road.lng } : target;
    const bearing = road && road.b != null ? road.b : (moving ? heading : null);
    const tunnel = !!(road && road.tunnel);
    let r = pickName(p, bearing, nameFeats, 8, 20, tunnel);
    if (!r.best) r = { ...pickName(p, bearing, nameFeats, 18, 28, tunnel), nearest: r.nearest, nearestName: r.nearestName };
    if (!r.best) r = { ...pickName(p, bearing, nameFeats, 30, 35, tunnel), nearest: r.nearest, nearestName: r.nearestName };
    return r;
  }

  /** Marca em properties.links os ids das vias que compartilham um ponto (cruzamento) com cada via. */
  function linkWays(feats) {
    const byNode = new Map();
    for (const f of feats) for (const c of f.geometry.coordinates) {
      const k = c[0].toFixed(6) + ',' + c[1].toFixed(6);
      (byNode.get(k) || byNode.set(k, []).get(k)).push(f);
    }
    for (const f of feats) f.properties.links = new Set();
    for (const list of byNode.values()) if (list.length > 1)
      for (const a of list) for (const b of list) if (a !== b) a.properties.links.add(b.properties.id);
    return feats;
  }

  const api = { snap, pickName, nameFor, linkWays, segInfo, dist, angDiff, lines, ROAD_CLASSES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StreetMatch = api;
})(typeof window !== 'undefined' ? window : globalThis);
