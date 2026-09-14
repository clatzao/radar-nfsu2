// Teste automático de precisão do nome da rua numa cidade com base local.
//   node ferramentas/ruas-locais/testar.cjs 2920502
// Simula um carro dirigindo pelas ruas (virando em cruzamentos, com erro de GPS), passa cada leitura pelo
// mesmo código do app (streetmatch.js + a regra de troca de nome do hud.js) e compara com a rua real.
'use strict';
const fs = require('fs');
const path = require('path');
const SM = require('../../nfsu2-radar/web/js/streetmatch.js');

const codigo = process.argv[2] || '2920502';
const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, `../../nfsu2-radar/web/data/ruas/${codigo}.json`), 'utf8'));
const SEM_NOME = 'Rua sem nome';

// Mesmos objetos que localstreets.js monta no app
const feats = data.ways.map(w => ({ properties: { id: w.id, name: w.n, class: w.c, brunnel: w.t ? 'tunnel' : '', fonte: w.f },
  geometry: { type: 'LineString', coordinates: w.g } }));
SM.linkWays(feats);
const CELL = 0.001, grid = new Map(), key = (x, y) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
for (const f of feats) {
  const g = f.geometry.coordinates, cells = new Set();
  for (let i = 0; i < g.length; i++) {
    const [x0, y0] = g[i], [x1, y1] = g[Math.min(i + 1, g.length - 1)];
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (CELL / 2)));
    for (let s = 0; s <= steps; s++) cells.add(key(x0 + (x1 - x0) * s / steps, y0 + (y1 - y0) * s / steps));
  }
  cells.forEach(k => (grid.get(k) || grid.set(k, []).get(k)).push(f));
}
const near = p => { const out = new Set(); const cx = Math.floor(p.lng / CELL), cy = Math.floor(p.lat / CELL);
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) (grid.get(`${cx + dx},${cy + dy}`) || []).forEach(f => out.add(f)); return [...out]; };

// Grafo: vias ligadas pelos nós em comum
const nodeKey = c => c[0].toFixed(6) + ',' + c[1].toFixed(6);
const byNode = new Map();
const driveable = feats.filter(f => f.properties.class !== 'service');
for (const f of driveable) f.geometry.coordinates.forEach((c, i) => (byNode.get(nodeKey(c)) || byNode.set(nodeKey(c), []).get(nodeKey(c))).push({ f, i }));

const offset = (p, b, m) => ({ lat: p.lat + m * Math.cos(b * Math.PI / 180) / 111320, lng: p.lng + m * Math.sin(b * Math.PI / 180) / (111320 * Math.cos(p.lat * Math.PI / 180)) });
const brg = (a, b) => (Math.atan2((b.lng - a.lng) * Math.cos(a.lat * Math.PI / 180), b.lat - a.lat) * 180 / Math.PI + 360) % 360;
let seed = 12345; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());

function drive(noise, speed) {
  const res = { total: 0, certo: 0, errado: 0, transicao: 0 };
  const erros = {};
  for (let trip = 0; trip < 120; trip++) {
    let f = driveable[Math.floor(rnd() * driveable.length)];
    let coords = f.geometry.coordinates, idx = 0, dir = 1;
    if (rnd() < .5) { idx = coords.length - 1; dir = -1; }
    let pos = { lng: coords[idx][0], lat: coords[idx][1] };
    let road = null, shown = '', shownId = null, pending = { name: '', hits: 0 }, sinceChange = 0, lastTrue = null;
    for (let t = 0; t < 180; t++) {
      // anda 1 segundo pela via; no fim, escolhe outra via que sai do mesmo nó
      let move = speed;
      while (move > 0) {
        const nxt = idx + dir;
        if (nxt < 0 || nxt >= coords.length) {
          const opts = (byNode.get(nodeKey(coords[idx])) || []).filter(o => o.f !== f);
          if (!opts.length) { dir = -dir; break; }
          const o = opts[Math.floor(rnd() * opts.length)];
          f = o.f; coords = f.geometry.coordinates; idx = o.i;
          dir = idx === 0 ? 1 : idx === coords.length - 1 ? -1 : (rnd() < .5 ? 1 : -1);
          continue;
        }
        const target = { lng: coords[nxt][0], lat: coords[nxt][1] }, L = SM.dist(pos, target);
        if (move < L) { const k = move / L; pos = { lng: pos.lng + (target.lng - pos.lng) * k, lat: pos.lat + (target.lat - pos.lat) * k }; move = 0; }
        else { pos = target; idx = nxt; move -= L; }
      }
      const nxt = coords[Math.max(0, Math.min(coords.length - 1, idx + dir))];
      const heading = brg(pos, { lng: nxt[0], lat: nxt[1] });
      const trueName = f.properties.name || SEM_NOME;
      if (trueName !== lastTrue) { sinceChange = 0; lastTrue = trueName; } else sinceChange += speed;

      // leitura do GPS com erro
      const raw = offset(offset(pos, 0, gauss() * noise / 1.4), 90, gauss() * noise / 1.4);
      road = SM.snap(raw, noise, true, heading + gauss() * 8, road, near(raw));
      const name = road ? (road.props.name || SEM_NOME) : null;
      // regra de troca do hud.js: nome novo precisa aparecer 2 vezes seguidas,
      // exceto quando a via nova é ligada à anterior (curva num cruzamento) e o GPS está bom
      if (name != null && name !== shown) {
        pending = pending.name === name ? { name, hits: pending.hits + 1 } : { name, hits: 1 };
        const turn = shownId != null && road.props.links && road.props.links.has(shownId) && noise <= 12;
        if (!shown || pending.hits >= 2 || turn) { shown = name; shownId = road.props.id; pending = { name: '', hits: 0 }; }
      } else { pending = { name: '', hits: 0 }; if (road) shownId = road.props.id; }
      if (t < 3) continue;
      res.total++;
      if (shown === trueName) res.certo++;
      else if (sinceChange < speed * 3) res.transicao++;        // até 3 s depois de entrar numa rua nova
      else { res.errado++; const k = `${trueName} → ${shown}`; erros[k] = (erros[k] || 0) + 1; }
    }
  }
  return { res, erros };
}

for (const [noise, speed] of [[5, 8.3], [10, 8.3], [15, 13.9]]) {
  const { res, erros } = drive(noise, speed);
  const semTrans = res.total - res.transicao;
  console.log(`\nGPS ±${noise} m, ${Math.round(speed * 3.6)} km/h: ${res.total} segundos simulados`);
  console.log(`  certo ${(100 * res.certo / res.total).toFixed(1)}%  ·  fora das trocas de rua: ${(100 * res.certo / semTrans).toFixed(1)}% certo (${res.errado} s errados)  ·  ${res.transicao} s nos 3 s após virar`);
  const top = Object.entries(erros).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (top.length) console.log('  erros mais comuns:\n   ' + top.map(([k, v]) => `${v}× ${k}`).join('\n   '));
}
