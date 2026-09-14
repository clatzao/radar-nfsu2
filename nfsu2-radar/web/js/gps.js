// Posição: GPS nativo do app Android, GPS do navegador, ou simulação de trajeto.
(() => {
  const { $, S, settings, clamp, dist, brg, NATIVE } = App;
  let watchId = null, demoTimer = null;

  function setGps(txt) { $('gpsTxt').textContent = txt; }

  // Zera tudo ao trocar de fonte, senão a posição antiga vira uma "velocidade" absurda
  function resetTracking() {
    Object.assign(S, { fix: null, target: null, shown: null, acc: null, heading: 0, speedMs: 0, speedKmh: 0, lastFix: 0 });
    App.emit('reset');
  }

  let lastGood = null;   // última leitura precisa: { acc, t }
  function onFix(lat, lng, spd, hdg, acc, ts) {
    const now = ts || Date.now(), p = { lat, lng }, prev = S.fix;
    const good = acc == null || acc <= 50;
    // Descarta leituras bem piores que as recentes (ex.: prédio, túnel, troca GPS → rede)
    if (acc != null && lastGood && Date.now() - lastGood.t < 4000 && acc > Math.max(30, lastGood.acc * 3)) return;
    if (acc != null && acc <= 20) lastGood = { acc, t: Date.now() };
    let moved = false;
    if (spd == null || isNaN(spd)) {
      // Sem velocidade do aparelho (comum em PC): calcula pela distância, só com sinal bom
      spd = 0;
      if (prev && good) {
        const d = dist(prev, p), dt = (now - prev.t) / 1000;
        if (dt >= .5 && dt <= 10 && d > Math.max(3, (acc || 0) * .5)) {
          spd = d / dt;
          if (spd > 70) spd = 0;               // salto de posição, não movimento real
          else moved = true;
        }
      }
    } else moved = spd > 1.5;
    if (moved && spd > 1.5) {
      if (hdg != null && !isNaN(hdg)) S.heading = hdg;
      else if (prev) S.heading = brg(prev, p);
    }
    S.fix = { lat, lng, t: now };
    S.target = App.snapToRoad(p, acc, moved && spd > 1.5);
    S.speedMs = spd; S.speedKmh = spd * 3.6;
    S.lastFix = Date.now(); S.acc = acc;
    if (S.mode === 'gps') setGps(good ? 'Rua atual' : `Rua atual · GPS impreciso (±${Math.round(acc)} m)`);
    else setGps('Rua atual · simulação');
    App.emit('fix', S.target);
  }

  // No app Android, o GPS vem direto da antena (ponte nativa)
  window.nativeFix = (lat, lng, spd, hdg, acc, ts) => { if (S.mode === 'gps') onFix(lat, lng, spd, hdg, acc, ts); };
  window.nativeStatus = txt => { if (S.mode === 'gps' && !S.target) setGps(txt); };

  function stopAll() {
    if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    if (NATIVE) NATIVE.stop();
    if (demoTimer) { clearInterval(demoTimer); demoTimer = null; }
  }

  function startGps() {
    stopAll(); resetTracking();
    S.mode = 'gps';
    setGps('Procurando GPS…');
    if (NATIVE) { NATIVE.start(); return; }
    if (!('geolocation' in navigator)) { setGps('Sem GPS neste aparelho'); return; }
    watchId = navigator.geolocation.watchPosition(
      pos => { const c = pos.coords; onFix(c.latitude, c.longitude, c.speed, c.heading, c.accuracy, pos.timestamp); },
      err => { if (S.mode === 'gps' && !S.target) setGps(err.code === 1 ? 'Permissão de localização negada' : 'Sem sinal de GPS'); },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );
  }

  // ---------- Simulação (Ajustes → Simular trajeto) ----------
  // Se houver rota ativa, o carro simulado percorre a rota; senão, anda na Av. Paulista.
  const PAULISTA = [
    [-46.66404, -23.55455], [-46.6629, -23.55555], [-46.66182, -23.55683], [-46.66026, -23.55817],
    [-46.65714, -23.56095], [-46.65588, -23.56207], [-46.65279, -23.56462], [-46.65013, -23.56681],
    [-46.64905, -23.56771], [-46.64726, -23.56908], [-46.64471, -23.57103], [-46.6443, -23.57137]
  ];
  function startDemo() {
    stopAll(); resetTracking();
    S.mode = 'demo';
    let path = null, seg = 0, along = 0, v = 0, stopT = 0, sinceStop = 0, nextStop = 350, routeId = null;
    const pickPath = () => {
      const r = App.route && App.route.shape();
      routeId = r ? App.route.id() : null;
      path = (r && r.length > 1 ? r : PAULISTA).map(([lng, lat]) => ({ lat, lng }));
      seg = 0; along = 0;
    };
    pickPath();
    const tick = () => {
      const r = App.route && App.route.shape();
      if ((r ? App.route.id() : null) !== routeId) pickPath();
      if (stopT > 0) { stopT--; v = Math.max(0, v - 5); }
      else { const vt = (routeId ? 22 : 15) + Math.sin(Date.now() / 7000) * 5; v += clamp(vt - v, -4, 3); }
      let move = v; sinceStop += move;
      if (stopT <= 0 && sinceStop > nextStop) { stopT = 4; sinceStop = 0; nextStop = 400 + Math.random() * 600; }
      while (move > 0 && path.length > 1) {
        const L = dist(path[seg], path[seg + 1]), rem = L - along;
        if (move < rem) { along += move; move = 0; }
        else {
          move -= rem; seg++; along = 0;
          if (seg >= path.length - 1) { path = path.slice().reverse(); seg = 0; v = 0; stopT = 3; break; }
        }
      }
      const a = path[seg], b = path[seg + 1] || a, f = along / Math.max(.01, dist(a, b));
      onFix(a.lat + (b.lat - a.lat) * f, a.lng + (b.lng - a.lng) * f, v, brg(a, b), 5, Date.now());
    };
    tick();
    demoTimer = setInterval(tick, 1000);
  }

  function applySource() {
    const demo = settings.simulate || new URLSearchParams(location.search).has('demo');
    if (demo && S.mode !== 'demo') startDemo();
    else if (!demo && (S.mode !== 'gps' || !S.fix)) startGps();
  }
  App.onSetting(k => { if (k === 'simulate') applySource(); });

  Object.assign(App, { startGps, startDemo, applySource, setGps });
})();
