// Topo da tela: nome da rua, temperatura, horário e a tela de diagnóstico.
(() => {
  const { $, S, map, dist, angDiff, segInfo, lines, fmtClock, ROAD_CLASSES } = App;

  // ---------- Nome da rua ----------
  const D = { tileNames: 0, nearestName: '', nearestDist: null, source: '', geo: '', error: '' };
  let lastStreet = '';
  function showStreet(name) {
    if (name === lastStreet) return;
    lastStreet = name; $('street').textContent = name || '—';
  }
  // Escolha do nome em duas etapas:
  //  1) usa o ponto em que a seta está presa na via (S.road), não a posição prevista à frente
  //     (que em cruzamentos já estava "entrando" na rua transversal);
  //  2) só aceita nomes de linhas quase em cima desse ponto e com o mesmo rumo da via.
  // Um nome novo precisa ganhar 2 leituras seguidas para substituir o atual (evita piscar em cruzamentos).
  let pending = { name: '', hits: 0 };
  function pickName(p, roadBearing, maxD, maxAngle) {
    const feats = App.roadsNear(p, ['road-names'], 'transportation_name', 90);
    D.tileNames = feats.length;
    let best = null, bestScore = Infinity, nearest = Infinity, nearestName = '';
    for (const f of feats) {
      const name = f.properties['name:pt'] || f.properties.name || f.properties['name:latin'];
      if (!name || !ROAD_CLASSES.has(f.properties.class)) continue;   // ignora trilhas, calçadas e trilhos
      for (const ln of lines(f.geometry)) {
        for (let i = 1; i < ln.length; i++) {
          const s = segInfo(p, ln[i - 1], ln[i]);
          if (s.d < nearest) { nearest = s.d; nearestName = name; }
          if (s.d > maxD) continue;
          let score = s.d;
          if (roadBearing != null) {
            const a = Math.abs(angDiff(s.b, roadBearing)), off = Math.min(a, 180 - a);
            if (off > maxAngle) continue;
            score += off * .4;
          }
          // Túnel só vale se a via onde a seta está presa também for túnel
          if (/^t[úu]nel\b/i.test(name) && !(S.road && S.road.tunnel)) score += 25;
          if (score < bestScore) { bestScore = score; best = name; }
        }
      }
    }
    D.nearestName = nearestName; D.nearestDist = isFinite(nearest) ? Math.round(nearest) : null;
    return { best, count: feats.length };
  }

  function updateStreet() {
    if (!S.target) return;
    const road = S.road;
    const p = road ? { lat: road.lat, lng: road.lng } : S.target;
    const bearing = road && road.b != null ? road.b : (S.speedMs > 2 ? S.heading : null);
    // GPS ruim demais: mantém o nome atual em vez de arriscar um errado
    if (S.acc != null && S.acc > 35 && lastStreet) { D.source = 'mantido (GPS impreciso)'; return; }

    // 1ª tentativa: linha do nome praticamente em cima da via (mesmo traçado); depois, um pouco mais de folga
    let { best, count } = pickName(p, bearing, 8, 20);
    if (!best) best = pickName(p, bearing, 18, 28).best;
    if (!best) best = pickName(p, bearing, 30, 35).best;
    let name = best, source = 'mapa';
    if (!best) {
      // Plano B: o mapa não tem nome por perto → serviço de endereços (só com internet)
      reverseStreet(S.target);
      if (geo.name && geo.at && dist(geo.at, S.target) < 40) { name = geo.name; source = 'serviço de endereços'; }
      else if (!count && !geo.at) return;
      else { name = ''; source = 'nenhuma'; }
    }
    if (name === lastStreet) { pending = { name: '', hits: 0 }; D.source = source; return; }
    // parado ou quase parado: não troca um nome já exibido
    if (lastStreet && S.speedMs < 1) return;
    pending = pending.name === name ? { name, hits: pending.hits + 1 } : { name, hits: 1 };
    if (!lastStreet || pending.hits >= 2) { D.source = source; showStreet(name); pending = { name: '', hits: 0 }; }
  }
  setInterval(updateStreet, 1000);

  // ---------- Endereço pelo Photon (OpenStreetMap, gratuito) ----------
  const geo = { name: '', at: null, busy: false, time: 0, gen: 0 };
  async function reverseStreet(p) {
    if (geo.busy || Date.now() - geo.time < 5000 || (geo.at && dist(geo.at, p) < 25)) return;
    geo.busy = true; geo.time = Date.now();
    const gen = geo.gen, at = { ...p };
    try {
      const pr = await App.reverseGeocode(at);
      const name = pr ? (pr.osm_key === 'highway' ? pr.name : pr.street) || '' : '';
      if (gen === geo.gen) { geo.name = name; geo.at = at; D.geo = name || '(sem resultado)'; }
    } catch (e) {
      D.geo = 'erro: ' + e.message;
    } finally { geo.busy = false; }
  }
  App.reverseGeocode = async p => {
    const r = await fetch(`https://photon.komoot.io/reverse?lat=${p.lat.toFixed(6)}&lon=${p.lng.toFixed(6)}&limit=1`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return (await r.json())?.features?.[0]?.properties || null;
  };

  // ---------- Temperatura (Open-Meteo, gratuito e sem chave) ----------
  const W = { last: 0, at: null, busy: false, retryAt: 0, gen: 0 };
  async function updateWeather() {
    if (!S.target || W.busy || Date.now() < W.retryAt) return;
    if (W.at && Date.now() - W.last < 10 * 60 * 1000 && dist(W.at, S.target) < 3000) return;
    W.busy = true;
    const gen = W.gen, at = { ...S.target };
    try {
      // Coordenadas arredondadas (~1 km): suficiente para o clima e não expõe a posição exata
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${at.lat.toFixed(2)}&longitude=${at.lng.toFixed(2)}&current=temperature_2m`);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const t = (await r.json())?.current?.temperature_2m;
      if (typeof t !== 'number') throw new Error('resposta sem temperatura');
      if (gen === W.gen) { $('temp').textContent = Math.round(t) + '°C'; W.at = at; W.last = Date.now(); }
    } catch (e) {
      console.warn('Temperatura indisponível:', e);
      if (gen === W.gen) W.retryAt = Date.now() + 60 * 1000;
    } finally { W.busy = false; }
  }
  App.on('fix', updateWeather);

  App.on('reset', () => {
    W.gen++; W.at = null; W.last = 0; W.retryAt = 0;
    geo.gen++; geo.name = ''; geo.at = null; geo.time = 0;
    lastStreet = ''; pending = { name: '', hits: 0 }; S.road = null;
    $('street').textContent = '—'; $('temp').textContent = '--°';
  });

  // ---------- Relógio ----------
  function updateClock() {
    $('clock').textContent = fmtClock(new Date());
    if (S.mode === 'gps' && S.target && Date.now() - S.lastFix > 6000) App.setGps('Sinal de GPS fraco');
  }
  updateClock(); setInterval(updateClock, 1000);

  // ---------- Diagnóstico: segure o painel da rua por 2 segundos ----------
  let holdT = null;
  const diag = $('diag'), sp = $('streetPanel');
  sp.addEventListener('pointerdown', () => { holdT = setTimeout(() => { diag.hidden = !diag.hidden; updateDiag(); }, 2000); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => sp.addEventListener(ev, () => clearTimeout(holdT)));
  diag.onclick = () => (diag.hidden = true);
  function updateDiag() {
    if (diag.hidden) return;
    const p = S.shown || S.target, f = S.fix;
    diag.textContent = [
      'DIAGNÓSTICO (toque para fechar)',
      `modo: ${S.mode}${App.NATIVE ? ' · app' : ' · navegador'}`,
      `gps: ${f ? f.lat.toFixed(6) + ', ' + f.lng.toFixed(6) : '—'}  ±${S.acc != null ? Math.round(S.acc) : '?'} m`,
      `seta: ${p ? p.lat.toFixed(6) + ', ' + p.lng.toFixed(6) : '—'}  (desvio ${f && p ? Math.round(dist(f, p)) : '?'} m)`,
      `via atual: ${S.road ? 'rumo ' + Math.round(S.road.b ?? -1) + '°, a ' + Math.round(S.road.d ?? 0) + ' m do GPS' : 'nenhuma'}`,
      `velocidade: ${Math.round(S.speedKmh)} km/h · direção ${Math.round(S.heading)}°`,
      `zoom: ${map.getZoom().toFixed(1)} (ajuste ${App.userZoom().toFixed(1)})`,
      `mapa carregado: ${map.loaded()} · nomes nos tiles: ${D.tileNames}`,
      `rua mais próxima nos tiles: ${D.nearestName || '—'} (${D.nearestDist ?? '?'} m)`,
      `serviço de endereços: ${D.geo || '(não consultado)'}`,
      `nome exibido vem de: ${D.source || '—'}`,
      D.error ? `erro: ${D.error}` : ''
    ].filter(Boolean).join('\n');
  }
  setInterval(updateDiag, 1000);
})();
