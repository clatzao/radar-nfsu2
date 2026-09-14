// Busca de endereços (Photon) e rotas com instruções em português (Valhalla), ambos gratuitos e do OpenStreetMap.
(() => {
  const { $, S, map, settings, esc, dist, segInfo, fmtDist, fmtDuration, fmtClock, toast, openSheet, closeSheets } = App;

  // ---------- Busca ----------
  let from = null, to = null, activeField = 'to', searchT = null, searchSeq = 0;

  function describe(pr) {
    const main = pr.name || [pr.street, pr.housenumber].filter(Boolean).join(', ');
    const sub = [pr.name && pr.street ? [pr.street, pr.housenumber].filter(Boolean).join(', ') : '', pr.district,
                 pr.city && pr.city !== main ? pr.city : '', pr.state].filter(Boolean).join(' · ');
    return { main: main || pr.city || pr.state || 'Sem nome', sub };
  }

  async function search(q) {
    const seq = ++searchSeq;
    const here = S.target;
    const saved = App.places.search(q).slice(0, 4).map(p => ({ name: p.name, sub: 'Local salvo', lat: p.lat, lng: p.lng, color: p.color }));
    renderResults(saved, true);
    try {
      const bias = here ? `&lat=${here.lat.toFixed(3)}&lon=${here.lng.toFixed(3)}` : '';
      const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8${bias}`);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const feats = (await r.json()).features || [];
      if (seq !== searchSeq) return;
      const found = feats.map(f => {
        const d = describe(f.properties);
        return { name: d.main, sub: d.sub, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] };
      });
      renderResults(saved.concat(found), false);
    } catch (e) {
      if (seq === searchSeq) renderResults(saved, false, 'Sem conexão com a busca. Tente de novo.');
    }
  }

  let results = [];
  function renderResults(list, loading, error) {
    results = list;
    const here = S.target;
    $('routeResults').innerHTML = list.map((it, i) => `
      <button class="row" data-i="${i}">
        <span class="ball" style="--c:${it.color || '#8d8f88'}"></span>
        <div class="t"><b>${esc(it.name)}</b><small>${esc(it.sub)}</small></div>
        <span class="k">${here ? fmtDist(dist(here, it)) : ''}</span>
      </button>`).join('') +
      (loading ? '<div class="hint">Buscando…</div>' : '') +
      (error ? `<div class="hint">${esc(error)}</div>` : '') +
      (!loading && !error && !list.length ? '<div class="hint">Nada encontrado.</div>' : '');
  }

  function onType(e) {
    activeField = e.target.id === 'fromInput' ? 'from' : 'to';
    if (activeField === 'from') from = null; else to = null;
    const q = e.target.value.trim();
    clearTimeout(searchT);
    if (q.length < 3) { $('routeResults').innerHTML = ''; return; }
    searchT = setTimeout(() => search(q), 350);
  }
  $('fromInput').addEventListener('input', onType);
  $('toInput').addEventListener('input', onType);
  $('fromInput').addEventListener('focus', () => (activeField = 'from'));
  $('toInput').addEventListener('focus', () => (activeField = 'to'));
  $('toInput').addEventListener('keydown', e => { if (e.key === 'Enter' && results[0]) pick(results[0]); });

  $('routeResults').addEventListener('click', e => {
    const b = e.target.closest('[data-i]'); if (b) pick(results[+b.dataset.i]);
  });
  function pick(it) {
    if (activeField === 'from') {
      from = it; $('fromInput').value = it.name;
      $('toInput').focus();
      if (to) calc();
    } else {
      to = it; $('toInput').value = it.name;
      calc();
    }
    $('routeResults').innerHTML = '';
  }
  $('bRoute').onclick = () => {
    openSheet('routeSheet');
    $('routeResults').innerHTML = '';
    setTimeout(() => $('toInput').focus(), 50);
  };

  // ---------- Cálculo da rota (Valhalla) ----------
  let route = null, routeSeq = 0, previewing = false;

  function decode6(str) {           // polyline com 6 casas decimais → [[lng, lat], ...]
    const out = []; let i = 0, lat = 0, lng = 0;
    while (i < str.length) {
      for (const k of [0, 1]) {
        let b, shift = 0, res = 0;
        do { b = str.charCodeAt(i++) - 63; res |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        const d = res & 1 ? ~(res >> 1) : res >> 1;
        if (k === 0) lat += d; else lng += d;
      }
      out.push([lng / 1e6, lat / 1e6]);
    }
    return out;
  }

  async function requestRoute(a, b) {
    const body = {
      locations: [{ lat: a.lat, lon: a.lng, ...(S.heading && !from ? { heading: Math.round(S.heading), heading_tolerance: 60 } : {}) },
                  { lat: b.lat, lon: b.lng }],
      costing: 'auto', language: 'pt-BR', directions_options: { units: 'kilometers' },
      costing_options: { auto: { use_tolls: settings.avoidTolls ? 0 : 0.5, exclude_unpaved: !!settings.avoidUnpaved } }
    };
    const res = await fetch('https://valhalla1.openstreetmap.de/route?json=' + encodeURIComponent(JSON.stringify(body)));
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.trip) throw new Error(j.error || 'HTTP ' + res.status);
    const leg = j.trip.legs[0];
    const shape = decode6(leg.shape);
    const cum = [0];
    for (let i = 1; i < shape.length; i++) cum.push(cum[i - 1] + dist({ lng: shape[i - 1][0], lat: shape[i - 1][1] }, { lng: shape[i][0], lat: shape[i][1] }));
    const r = { id: Date.now(), shape, cum, total: cum[cum.length - 1], time: j.trip.summary.time,
                maneuvers: leg.maneuvers, dest: { lat: b.lat, lng: b.lng, name: b.name || 'Destino' },
                idx: 0, offCount: 0, spoken: {} };
    // O Valhalla costuma superestimar o tempo em estradas do interior; o OSRM dá uma estimativa
    // mais próxima da real. Se responder rápido, usamos o tempo dele (a rota e as instruções continuam do Valhalla).
    try {
      const o = await fetch(`https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`,
                            { signal: AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined }).then(x => x.json());
      const od = o?.routes?.[0];
      if (od && Math.abs(od.distance - r.total) / r.total < .25) r.time = od.duration;
    } catch (e) {}
    return r;
  }

  async function calc() {
    const a = from || S.target;
    if (!to) return;
    if (!a) return toast('Aguardando o GPS para saber de onde sair…');
    const seq = ++routeSeq;
    closeSheets();
    toast('Calculando rota…', 20000);
    try {
      const r = await requestRoute(a, to);
      if (seq !== routeSeq) return;
      setRoute(r);
      showSummary(!!from);
      toast('Rota pronta', 1200);
    } catch (e) {
      if (seq === routeSeq) toast('Não foi possível calcular a rota: ' + e.message, 5000);
    }
  }

  function setRoute(r) {
    route = r;
    const src = map.getSource('route');
    if (src) src.setData(r ? { type: 'Feature', geometry: { type: 'LineString', coordinates: r.shape } } : { type: 'FeatureCollection', features: [] });
    $('compassTxt').textContent = r ? '★' : 'N';
    if (!r) { $('nav').hidden = true; $('summary').hidden = true; previewing = false; App.follow(); }
  }

  function showSummary(customOrigin) {
    previewing = true;
    const b = new maplibregl.LngLatBounds();
    route.shape.forEach(c => b.extend(c));
    App.overview(b);
    $('sumTitle').textContent = (from ? from.name + ' → ' : 'Até ') + route.dest.name;
    $('sumDist').textContent = fmtDist(route.total);
    $('sumTime').textContent = fmtDuration(route.time);
    $('sumEta').textContent = fmtClock(new Date(Date.now() + route.time * 1000));
    $('sumNote').textContent = customOrigin
      ? 'Rota a partir do ponto escolhido. A navegação acompanha o carro quando você estiver no caminho.'
      : 'Tempo estimado sem trânsito em tempo real.';
    $('nav').hidden = true;
    $('summary').hidden = false;
  }
  $('sumCancel').onclick = () => { setRoute(null); from = to = null; $('fromInput').value = $('toInput').value = ''; };
  $('sumStart').onclick = () => {
    $('summary').hidden = true; previewing = false; App.follow();
    const first = route.maneuvers[0];
    speak(`Rota iniciada até ${route.dest.name}. ${fmtDistSpoken(route.total)}, cerca de ${fmtDuration(route.time).replace('min', 'minutos').replace(' h ', ' horas e ')}. ${first ? first.instruction : ''}`);
    updateProgress();
  };
  const fmtDistSpoken = m => spokenDist(m).replace(/^./, c => c.toUpperCase());
  $('navClose').onclick = () => { setRoute(null); from = to = null; $('fromInput').value = $('toInput').value = ''; toast('Rota encerrada'); };

  // ---------- Acompanhamento da rota ----------
  /** Ponto da rota mais próximo de p, procurando perto do último trecho conhecido (ou na rota toda). */
  function nearestOnRoute(p, full) {
    const sh = route.shape;
    const lo = full ? 0 : Math.max(0, route.idx - 20), hi = full ? sh.length - 1 : Math.min(sh.length - 1, route.idx + 400);
    let best = { d: Infinity, t: 0 }, bi = route.idx;
    for (let i = lo; i < hi; i++) {
      const s = segInfo(p, sh[i], sh[i + 1]);
      if (s.d < best.d) { best = s; bi = i; }
    }
    return { s: best, i: bi };
  }

  let rerouting = false, lastReroute = 0, lastTrim = 0;
  function updateProgress() {
    if (!route || previewing || !S.fix) return;
    const raw = { lat: S.fix.lat, lng: S.fix.lng };
    let { s: best, i: bi } = nearestOnRoute(raw, false);
    if (best.d > 150) ({ s: best, i: bi } = nearestOnRoute(raw, true));   // longe do trecho esperado
    route.idx = bi;
    const along = route.cum[bi] + (route.cum[bi + 1] - route.cum[bi]) * best.t;
    const left = Math.max(0, route.total - along);

    // Chegou
    if (left < 30 || dist(raw, route.dest) < 25) {
      toast('Você chegou: ' + route.dest.name, 5000);
      speak('Você chegou ao seu destino.');
      setRoute(null); from = to = null;
      return;
    }
    // Saiu da rota: recalcula rápido (só com GPS confiável, no máximo a cada 12 s)
    const reliable = S.acc == null || S.acc <= 30;
    route.offCount = best.d > 40 && reliable ? route.offCount + 1 : 0;
    if (route.offCount >= 3 && !rerouting && Date.now() - lastReroute > 12000 && !from) {
      rerouting = true; lastReroute = Date.now();
      toast('Recalculando rota…', 3000);
      speak('Recalculando a rota.');
      requestRoute(raw, route.dest).then(r => { if (route) { setRoute(r); updateProgress(); } })
        .catch(() => {}).finally(() => (rerouting = false));
    }

    // Some com o trecho já percorrido (a linha laranja vai "encolhendo")
    if (Date.now() - lastTrim > 900 && best.d < 40) {
      lastTrim = Date.now();
      const rest = [[best.lng, best.lat], ...route.shape.slice(bi + 1)];
      map.getSource('route')?.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: rest } });
    }

    // Próxima manobra e a seguinte
    const mi = route.maneuvers.findIndex(m => m.begin_shape_index > bi);
    const nIdx = mi < 0 ? route.maneuvers.length - 1 : mi;
    const next = route.maneuvers[nIdx], after = route.maneuvers[nIdx + 1];
    const toNext = Math.max(0, route.cum[Math.min(next.begin_shape_index, route.cum.length - 1)] - along);
    let instr = next.instruction || '';
    if (after && after.length * 1000 < 150 && after.type !== 4) instr += '  ·  depois: ' + (after.instruction || '').replace(/\.$/, '');
    $('navDist').textContent = fmtDist(toNext);
    $('navInstr').textContent = instr;
    $('turnIcon').innerHTML = turnIcon(next.type);
    const secsLeft = route.time * (left / Math.max(1, route.total));
    $('navEta').textContent = fmtClock(new Date(Date.now() + secsLeft * 1000));
    $('navLeft').textContent = fmtDist(left) + ' · ' + fmtDuration(secsLeft);
    $('nav').hidden = false;
    route.toNext = toNext;

    // Voz: um aviso com antecedência e outro na hora de virar
    const kmh = Math.max(S.speedKmh, 20);
    const farAt = kmh > 80 ? 1200 : kmh > 50 ? 500 : 250;
    const nearAt = Math.max(40, kmh / 3.6 * 7);            // ~7 segundos antes
    const said = route.spoken[nIdx] || (route.spoken[nIdx] = {});
    if (next.type !== 4 && next.type !== 5 && next.type !== 6) {
      if (!said.far && toNext <= farAt && toNext > nearAt * 1.6 && (next.length > 0 || nIdx > 0)) {
        said.far = true;
        speak(`Em ${spokenDist(toNext)}, ${lower(next.verbal_transition_alert_instruction || next.instruction)}`);
      } else if (!said.near && toNext <= nearAt) {
        said.near = said.far = true;
        speak(next.verbal_pre_transition_instruction || next.instruction);
      }
    } else if (!said.far && toNext <= farAt) {
      said.far = true;
      speak(`Em ${spokenDist(toNext)}, você chegará ao destino.`);
    }
  }
  App.on('fix', updateProgress);
  App.on('reset', () => { if (route) route.idx = 0; });

  const lower = t => (t || '').charAt(0).toLowerCase() + (t || '').slice(1);
  function spokenDist(m) {
    if (m >= 1000) { const km = Math.round(m / 100) / 10; return (km % 1 ? String(km).replace('.', ',') : km) + (km >= 2 ? ' quilômetros' : ' quilômetro'); }
    return (m >= 100 ? Math.round(m / 50) * 50 : Math.round(m / 10) * 10) + ' metros';
  }

  // ---------- Voz ----------
  // No app usa o leitor de texto do Android; no navegador usa a voz do sistema.
  function speak(text) {
    if (!settings.voice || !text) return;
    if (App.NATIVE && App.NATIVE.speak) { App.NATIVE.speak(text); return; }
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'pt-BR';
    const v = speechSynthesis.getVoices().find(x => /pt(-|_)BR/i.test(x.lang));
    if (v) u.voice = v;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  // Seta da manobra (tipos do Valhalla)
  function turnIcon(type) {
    const ang = { 9: 40, 10: 90, 11: 135, 12: 180, 13: -180, 14: -135, 15: -90, 16: -40, 18: 40, 19: -40, 20: 40, 21: -40,
                  23: 30, 24: -30, 37: 40, 38: -40 }[type] || 0;
    if (type === 26 || type === 27) {
      return '<path d="M24 40 V30 A8 8 0 1 1 32 22" fill="none" stroke="#141512" stroke-width="5" stroke-linecap="round"/><path d="M26 14 L36 22 L26 29 Z" fill="#141512"/>';
    }
    if (type >= 4 && type <= 6) {
      return '<circle cx="24" cy="20" r="9" fill="none" stroke="#141512" stroke-width="5"/><path d="M24 29 V42" stroke="#141512" stroke-width="5" stroke-linecap="round"/>';
    }
    return `<g transform="rotate(${ang} 24 30)"><path d="M24 44 V14" stroke="#141512" stroke-width="5.5" stroke-linecap="round"/><path d="M13 20 L24 6 L35 20 Z" fill="#141512"/></g>`;
  }

  // ---------- Usado por outros módulos ----------
  App.route = {
    to: dest => { from = null; to = dest; $('fromInput').value = ''; $('toInput').value = dest.name || ''; calc(); },
    destination: () => route && route.dest,
    shape: () => route && route.shape,
    id: () => route && route.id,
    // Com rota ativa, prende a seta na linha da rota quando o carro está sobre ela
    snap: (p, maxD) => {
      if (!route || previewing) return null;
      const { s } = nearestOnRoute(p, false);
      return s.d <= maxD ? { lat: s.lat, lng: s.lng } : null;
    },
    // Aproxima um pouco o mapa perto de uma conversão
    zoomHint: () => (route && !previewing && route.toNext != null && route.toNext < 180 ? .6 : 0)
  };
})();
