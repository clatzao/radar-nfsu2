// Topo da tela: nome da rua, temperatura, horário e a tela de diagnóstico.
(() => {
  const { $, S, map, dist, fmtClock } = App;

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
  let pending = { name: '', hits: 0 }, shownRoadId = null;
  const SEM_NOME = 'Rua sem nome';

  /**
   * Nome da via em que a seta está presa (sem histerese nem serviço de endereços).
   * Devolve { best, count, local }: best '' = via conhecida sem nome; null = não sabe.
   */
  function chooseName(target) {
    const road = S.road;
    // 1) correção feita por você vale sempre
    const fixed = App.local.fixedName(road);
    if (fixed != null) return { best: fixed, count: 1, source: 'sua correção' };
    // 2) cidade com base local: o nome é o da própria via onde a seta está presa (ou "sem nome")
    if (road && road.local) return { best: road.props.name || SEM_NOME, count: 1, source: 'base local ' + (road.props.fonte || '') };
    // 3) resto do país: nomes dos dados gerais do mapa, no rumo da via
    const p = road ? { lat: road.lat, lng: road.lng } : target;
    const feats = App.roadsNear(p, ['road-names'], 'transportation_name', 90);
    D.tileNames = feats.length;
    const r = StreetMatch.nameFor(road, target, S.heading, S.speedMs > 2, feats);
    D.nearestName = r.nearestName; D.nearestDist = r.nearest != null ? Math.round(r.nearest) : null;
    return { best: r.best, count: feats.length, source: 'mapa' };
  }
  // Para testes automáticos: qual nome o app mostraria para um carro em p, andando no rumo heading
  App.debugStreet = (raw, heading, acc = 5) => {
    Object.assign(S, { road: null, heading, speedMs: 10 });
    const t = App.snapToRoad(raw, acc, true);
    return { name: chooseName(t).best || '', snapped: t, road: S.road };
  };

  function updateStreet() {
    if (!S.target) return;
    // GPS ruim demais: mantém o nome atual em vez de arriscar um errado
    if (S.acc != null && S.acc > 35 && lastStreet) { D.source = 'mantido (GPS impreciso)'; return; }
    let { best, count, source } = chooseName(S.target);
    let name = best;
    if (best == null) {
      // Plano B: o mapa não tem nome por perto → serviço de endereços (só com internet).
      // Só aceita se o resultado for a própria rua, e não o endereço de uma casa numa rua vizinha.
      reverseStreet(S.target);
      if (geo.name && geo.at && dist(geo.at, S.target) < 40) { name = geo.name; source = 'serviço de endereços'; }
      else if (!count && !geo.at) return;
      else { name = ''; source = 'nenhuma'; }
    }
    const road = S.road;
    if (name === lastStreet) { pending = { name: '', hits: 0 }; D.source = source; if (road && road.props) shownRoadId = road.props.id; return; }
    // parado ou quase parado: não troca um nome já exibido
    if (lastStreet && S.speedMs < 1) return;
    pending = pending.name === name ? { name, hits: pending.hits + 1 } : { name, hits: 1 };
    // Curva de verdade (a via nova sai da anterior num cruzamento) com GPS bom: troca na hora.
    // Qualquer outra troca precisa se repetir 2 vezes (evita piscar entre avenida e marginal).
    const turn = road && road.local && shownRoadId != null && road.props.links && road.props.links.has(shownRoadId) && (S.acc == null || S.acc <= 12);
    if (!lastStreet || pending.hits >= 2 || turn) {
      D.source = source; showStreet(name); pending = { name: '', hits: 0 };
      shownRoadId = road && road.props ? road.props.id : null;
    }
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
      const name = pr && pr.osm_key === 'highway' ? pr.name || '' : '';
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

  // ---------- Corrigir o nome da rua: toque no painel "Rua atual" ----------
  let fixRoad = null;
  function openFix(road) {
    if (!road) return App.toast('Nenhuma rua identificada aqui');
    fixRoad = road;
    const current = App.local.fixedName(road);
    const original = road.local ? (road.props.name || '') : (lastStreet && lastStreet !== SEM_NOME ? lastStreet : '');
    $('fixName').value = current != null ? current : original;
    const sug = [...new Set([original, road.props && road.props.alt].filter(Boolean))];
    $('fixSugTitle').hidden = !sug.length;
    $('fixSug').innerHTML = sug.map(s => `<button class="row" data-sug="${App.esc(s)}"><div class="t"><b>${App.esc(s)}</b>
      <small>${road.props && s === road.props.alt ? 'Segundo os endereços do IBGE (Censo 2022)' : road.local && road.props.fonte === 'ibge' ? 'Nome vindo do IBGE' : 'Nome no OpenStreetMap'}</small></div></button>`).join('');
    $('fixInfo').textContent = current != null ? 'Esta rua já tem uma correção sua.' : '';
    $('fixReset').hidden = current == null;
    App.openSheet('streetFix');
  }
  $('fixSug').addEventListener('click', e => { const b = e.target.closest('[data-sug]'); if (b) $('fixName').value = b.dataset.sug; });
  $('fixSave').onclick = () => {
    const v = $('fixName').value.trim();
    App.local.setFix(fixRoad, v || SEM_NOME);
    App.closeSheets(); App.toast('Nome da rua salvo');
  };
  $('fixName').addEventListener('keydown', e => { if (e.key === 'Enter') $('fixSave').click(); });
  $('fixReset').onclick = () => { App.local.setFix(fixRoad, null); App.closeSheets(); App.toast('Voltou ao nome original'); };
  App.on('streetfix', () => { lastStreet = null; pending = { name: '', hits: 0 }; updateStreet(); });
  App.openStreetFix = openFix;

  // ---------- Diagnóstico: segure o painel da rua por 2 segundos ----------
  let holdT = null, held = false;
  const diag = $('diag'), sp = $('streetPanel');
  sp.addEventListener('pointerdown', () => { held = false; holdT = setTimeout(() => { held = true; diag.hidden = !diag.hidden; updateDiag(); }, 2000); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => sp.addEventListener(ev, () => clearTimeout(holdT)));
  sp.addEventListener('click', () => { if (!held) openFix(S.road); });
  diag.onclick = () => (diag.hidden = true);
  function updateDiag() {
    if (diag.hidden) return;
    const p = S.shown || S.target, f = S.fix;
    diag.textContent = [
      'DIAGNÓSTICO (toque para fechar)',
      `modo: ${S.mode}${App.NATIVE ? ' · app' : ' · navegador'}`,
      `gps: ${f ? f.lat.toFixed(6) + ', ' + f.lng.toFixed(6) : '—'}  ±${S.acc != null ? Math.round(S.acc) : '?'} m`,
      `seta: ${p ? p.lat.toFixed(6) + ', ' + p.lng.toFixed(6) : '—'}  (desvio ${f && p ? Math.round(dist(f, p)) : '?'} m)`,
      `via atual: ${S.road ? 'rumo ' + Math.round(S.road.b ?? -1) + '°, a ' + Math.round(S.road.d ?? 0) + ' m do GPS' + (S.road.local ? ` · base local ${App.local.city() || ''} (via ${S.road.props.id}, ${S.road.props.fonte || 'sem nome'})` : '') : 'nenhuma'}`,
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
