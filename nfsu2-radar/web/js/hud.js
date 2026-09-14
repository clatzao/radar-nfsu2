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
  function updateStreet() {
    const p = S.shown || S.target;
    if (!p) return;
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
          if (s.d > 45) continue;
          let score = s.d;
          if (S.speedMs > 2) { const a = Math.abs(angDiff(s.b, S.heading)); score += Math.min(a, 180 - a) * .5; }
          if (score < bestScore) { bestScore = score; best = name; }
        }
      }
    }
    D.nearestName = nearestName; D.nearestDist = isFinite(nearest) ? Math.round(nearest) : null;
    if (best) { D.source = 'mapa'; return showStreet(best); }
    // Plano B: o mapa não tem nome de rua por perto → pergunta ao serviço de endereços
    reverseStreet(p);
    if (geo.name && geo.at && dist(geo.at, p) < 60) { D.source = 'serviço de endereços'; showStreet(geo.name); }
    else if (feats.length || geo.at) { D.source = 'nenhuma'; showStreet(''); }
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
    lastStreet = ''; $('street').textContent = '—'; $('temp').textContent = '--°';
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
