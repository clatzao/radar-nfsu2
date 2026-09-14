// Mapa: estilo do radar do NFSU2, camadas (estabelecimentos, locais salvos, rota), câmera e toques.
(() => {
  const { $, S, settings, clamp, angDiff, dist, offset, segInfo, lines } = App;

  // Cores dos estabelecimentos (mesma linguagem das bolas de loja do jogo)
  const POI_COLORS = [
    ['fuel'], '#ff8a1c',
    ['restaurant', 'fast_food', 'cafe', 'bar', 'beer', 'ice_cream', 'bakery'], '#ff3b30',
    ['hospital', 'pharmacy', 'doctors', 'dentist', 'clinic'], '#3fd63a',
    ['bank', 'atm'], '#ffd21a',
    ['lodging'], '#a45cff',
    ['car', 'car_repair', 'bicycle'], '#f2f2ee',
    ['shop', 'grocery', 'supermarket', 'alcohol_shop', 'clothing_store', 'hardware', 'furniture', 'mobile_phone',
     'jewelry', 'shoe', 'electronics', 'books', 'gift', 'optician', 'hairdresser', 'laundry', 'florist'], '#2f8fff'
  ];
  const POI_CLASSES = POI_COLORS.filter((_, i) => i % 2 === 0).flat();
  // Nomes em português pela subcategoria (mais específica) ou categoria do OpenStreetMap
  const POI_LABELS = { fuel: 'Posto de combustível', restaurant: 'Restaurante', fast_food: 'Lanchonete', cafe: 'Café', bar: 'Bar',
    pub: 'Bar', beer: 'Bar', biergarten: 'Bar', ice_cream: 'Sorveteria', bakery: 'Padaria', pastry: 'Confeitaria', food_court: 'Praça de alimentação',
    hospital: 'Hospital', pharmacy: 'Farmácia', chemist: 'Drogaria', doctors: 'Clínica médica', dentist: 'Dentista', clinic: 'Clínica',
    veterinary: 'Veterinário', bank: 'Banco', atm: 'Caixa eletrônico', bureau_de_change: 'Casa de câmbio',
    lodging: 'Hospedagem', hotel: 'Hotel', motel: 'Motel', hostel: 'Albergue', guest_house: 'Pousada',
    car: 'Loja de carros', car_repair: 'Oficina mecânica', car_parts: 'Autopeças', tyres: 'Borracharia', car_wash: 'Lava-rápido',
    motorcycle: 'Loja de motos', bicycle: 'Bicicletaria', grocery: 'Mercado', supermarket: 'Supermercado', convenience: 'Loja de conveniência',
    greengrocer: 'Hortifrúti', butcher: 'Açougue', alcohol_shop: 'Adega', beverages: 'Distribuidora de bebidas', clothes: 'Loja de roupas',
    clothing_store: 'Loja de roupas', shoes: 'Loja de calçados', shoe: 'Loja de calçados', hardware: 'Material de construção',
    doityourself: 'Material de construção', furniture: 'Loja de móveis', mobile_phone: 'Loja de celulares', electronics: 'Eletrônicos',
    jewelry: 'Joalheria', books: 'Livraria', gift: 'Loja de presentes', optician: 'Ótica', hairdresser: 'Cabeleireiro',
    beauty: 'Salão de beleza', laundry: 'Lavanderia', florist: 'Floricultura', department_store: 'Loja de departamentos',
    mall: 'Shopping', variety_store: 'Loja de variedades', pet: 'Pet shop', shop: 'Loja' };

  const EMPTY = { type: 'FeatureCollection', features: [] };
  function buildStyle() {
    const C = { land: '#2e302c', water: '#1e4561', block: '#3a3c37', minor: '#9d9f99', mid: '#b3b5ae', major: '#c9cbc4' };
    const W = b => ['interpolate', ['exponential', 1.5], ['zoom'], 12, b * .45, 15, b, 18, b * 4.5];
    const inCls = c => ['in', ['get', 'class'], ['literal', c]];
    const line = { type: 'line', source: 'omt', 'source-layer': 'transportation', layout: { 'line-cap': 'round', 'line-join': 'round' } };
    const poiColor = ['match', ['get', 'class'], ...POI_COLORS, '#2f8fff'];
    const Z = (a, b) => ['interpolate', ['linear'], ['zoom'], 14, a, 18, b];
    return {
      version: 8,
      glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
      sources: {
        omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
        route: { type: 'geojson', data: EMPTY },
        places: { type: 'geojson', data: EMPTY }
      },
      layers: [
        { id: 'land', type: 'background', paint: { 'background-color': C.land } },
        { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': C.water } },
        { id: 'blocks', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 15, paint: { 'fill-color': C.block, 'fill-opacity': .35 } },
        { ...line, id: 'minor', filter: inCls(['minor', 'service']), paint: { 'line-color': C.minor, 'line-width': W(2.2) } },
        { ...line, id: 'mid', filter: inCls(['secondary', 'tertiary']), paint: { 'line-color': C.mid, 'line-width': W(3.2) } },
        { ...line, id: 'major', filter: inCls(['motorway', 'trunk', 'primary']), paint: { 'line-color': C.major, 'line-width': W(4.6) } },
        // Invisível: só serve para achar o nome da rua rapidamente
        { id: 'road-names', type: 'line', source: 'omt', 'source-layer': 'transportation_name',
          paint: { 'line-opacity': 0, 'line-width': 8 } },
        // Rota do GPS
        { id: 'route-glow', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#ffae1a', 'line-width': W(9), 'line-blur': W(6), 'line-opacity': .45 } },
        { id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#141512', 'line-width': W(6.5) } },
        { id: 'route-line', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#ffae1a', 'line-width': W(4.2) } },
        // Estabelecimentos
        { id: 'poi-glow', type: 'circle', source: 'omt', 'source-layer': 'poi', minzoom: 16, filter: inCls(POI_CLASSES),
          paint: { 'circle-color': poiColor, 'circle-radius': Z(7, 16), 'circle-blur': 1, 'circle-opacity': .55 } },
        { id: 'poi-dot', type: 'circle', source: 'omt', 'source-layer': 'poi', minzoom: 16, filter: inCls(POI_CLASSES),
          paint: { 'circle-color': poiColor, 'circle-radius': Z(3.2, 7), 'circle-stroke-color': '#fff3a0', 'circle-stroke-width': Z(.8, 2) } },
        // Nome dos estabelecimentos quando o mapa está bem aproximado
        { id: 'poi-label', type: 'symbol', source: 'omt', 'source-layer': 'poi', minzoom: 17, filter: ['all', inCls(POI_CLASSES), ['has', 'name']],
          layout: { 'text-field': ['coalesce', ['get', 'name:pt'], ['get', 'name']], 'text-font': ['Noto Sans Italic'],
                    'text-size': ['interpolate', ['linear'], ['zoom'], 17, 11, 19, 14], 'text-offset': [0, 1.1], 'text-anchor': 'top',
                    'text-max-width': 8, 'text-optional': true, 'text-padding': 4 },
          paint: { 'text-color': '#f2f2ee', 'text-halo-color': '#141512', 'text-halo-width': 1.6 } },
        // Locais salvos: a bola colorida das lojas do jogo
        { id: 'place-glow', type: 'circle', source: 'places',
          paint: { 'circle-color': ['get', 'color'], 'circle-radius': Z(16, 26), 'circle-blur': 1, 'circle-opacity': .8 } },
        { id: 'place-disc', type: 'circle', source: 'places',
          paint: { 'circle-color': ['get', 'color'], 'circle-radius': Z(8, 13), 'circle-stroke-color': '#fff3a0', 'circle-stroke-width': Z(2.4, 3.6) } },
        { id: 'place-core', type: 'circle', source: 'places',
          paint: { 'circle-color': '#1b1c1a', 'circle-radius': Z(2.6, 4.2) } }
      ]
    };
  }

  const map = new maplibregl.Map({
    container: 'map', style: buildStyle(), center: [-46.6559, -23.5614], zoom: 16.4, pitch: settings.pitch,
    interactive: false, attributionControl: false, fadeDuration: 0,
    // Em telas de alta densidade, desenhar em 2x no máximo deixa o mapa bem mais leve sem perder nitidez visível
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    maxTileCacheSize: 200
  });
  window.__radar = { map, S };   // para depuração pelo console

  function setPoiVisible(v) {
    ['poi-glow', 'poi-dot', 'poi-label'].forEach(id => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', v ? 'visible' : 'none'));
  }
  map.on('load', () => { setPoiVisible(settings.showPoi); App.emit('mapload'); });
  App.onSetting(k => { if (k === 'showPoi') setPoiVisible(settings.showPoi); });

  // ---------- Consulta rápida de ruas perto de um ponto ----------
  // Usa o índice espacial do que está desenhado na tela (bem mais leve que varrer os tiles inteiros).
  // Se o ponto estiver fora da tela, cai na varredura completa.
  function roadsNear(p, layers, sourceLayer, radiusPx = 70) {
    try {
      const pt = map.project([p.lng, p.lat]), c = map.getContainer();
      if (pt.x > 0 && pt.y > 0 && pt.x < c.clientWidth && pt.y < c.clientHeight && map.getLayer(layers[0])) {
        return map.queryRenderedFeatures([[pt.x - radiusPx, pt.y - radiusPx], [pt.x + radiusPx, pt.y + radiusPx]], { layers });
      }
      return map.getSource('omt') ? map.querySourceFeatures('omt', { sourceLayer }) : [];
    } catch (e) { return []; }
  }

  // ---------- Seta presa na rua ----------
  const ROAD_CLASSES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service']);
  function snapToRoad(p, acc, moving) {
    // Com rota ativa e o carro em cima dela, gruda na linha da rota (mais estável)
    const onRoute = App.route && App.route.snap(p, clamp(acc || 15, 12, 30));
    if (onRoute) return onRoute;
    const feats = roadsNear(p, ['minor', 'mid', 'major'], 'transportation');
    if (!feats.length) return p;
    const maxD = clamp(acc || 15, 10, 25);
    let best = null, bestScore = Infinity;
    for (const f of feats) {
      if (!ROAD_CLASSES.has(f.properties.class)) continue;
      for (const ln of lines(f.geometry)) {
        for (let i = 1; i < ln.length; i++) {
          const s = segInfo(p, ln[i - 1], ln[i]);
          if (s.d > maxD) continue;
          let score = s.d;
          if (moving) {
            const a = Math.abs(angDiff(s.b, S.heading)), off = Math.min(a, 180 - a);
            if (off > 50) continue;
            score += off * .3;
          }
          if (score < bestScore) { bestScore = score; best = s; }
        }
      }
    }
    return best ? { lat: best.lat, lng: best.lng } : p;
  }

  // ---------- Câmera ----------
  // 'follow' = segue o carro; 'overview' = mostra a rota inteira (antes de iniciar)
  const cam = { mode: 'follow' };
  const PLAYER_Y = .66;
  const padding = () => ({ top: Math.max(0, (2 * PLAYER_Y - 1) * map.getContainer().clientHeight), bottom: 0, left: 0, right: 0 });
  const playerEl = document.querySelector('.player');
  function overview(bounds) {
    cam.mode = 'overview';
    playerEl.style.display = 'none';        // <svg> não aceita a propriedade .hidden
    $('speedo').style.visibility = 'hidden';   // libera o canto para ver a rota inteira
    const h = map.getContainer().clientHeight, w = map.getContainer().clientWidth;
    map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });   // tira o deslocamento usado para seguir o carro
    map.jumpTo({ bearing: 0, pitch: 0 });
    // deixa espaço para o resumo (à esquerda na tela deitada, embaixo no celular em pé)
    const pad = w > h ? { top: h * .22, bottom: h * .12, left: w * .44, right: w * .1 }
                      : { top: h * .3, bottom: h * .42, left: w * .08, right: w * .08 };
    map.fitBounds(bounds, { padding: pad, duration: 0, maxZoom: 16 });
  }
  function follow() {
    cam.mode = 'follow';
    playerEl.style.display = '';
    $('speedo').style.visibility = '';
  }

  // ---------- Zoom: pinça, roda do mouse ou botões + / − ----------
  const ZOOM_MIN = -4, ZOOM_MAX = 2.5;
  let userZoom = clamp(App.load('nfsu2-zoom', 0) || 0, ZOOM_MIN, ZOOM_MAX), zoomShown = userZoom;
  function setUserZoom(z) {
    if (cam.mode === 'overview') { map.setZoom(clamp(map.getZoom() + (z - userZoom), 3, 18)); return; }
    userZoom = clamp(z, ZOOM_MIN, ZOOM_MAX);
    App.save('nfsu2-zoom', +userZoom.toFixed(2));
  }
  $('bZoomIn').onclick = () => setUserZoom(userZoom + .5);
  $('bZoomOut').onclick = () => setUserZoom(userZoom - .5);
  function resetZoom() { userZoom = 0; App.save('nfsu2-zoom', 0); }
  const inUi = t => t.closest && t.closest('.panel, .btn, .menu, .zoom, .diag');

  let pinch = null;
  const touchDist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  document.addEventListener('touchstart', e => {
    if (e.touches.length === 2 && !inUi(e.target)) { pinch = { d: touchDist(e.touches), z: userZoom, mz: map.getZoom() }; cancelPress(); }
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const dz = Math.log2(touchDist(e.touches) / pinch.d);
    if (cam.mode === 'overview') map.setZoom(clamp(pinch.mz + dz, 3, 18));
    else { setUserZoom(pinch.z + dz); zoomShown = userZoom; }
  }, { passive: false });
  document.addEventListener('touchend', e => { if (e.touches.length < 2) pinch = null; });
  document.addEventListener('wheel', e => {
    if (inUi(e.target)) return;
    e.preventDefault();
    if (cam.mode === 'overview') map.setZoom(clamp(map.getZoom() - e.deltaY * .003, 3, 18));
    else setUserZoom(userZoom - e.deltaY * .003);
  }, { passive: false });
  ['gesturestart', 'gesturechange'].forEach(ev => document.addEventListener(ev, e => e.preventDefault()));

  // ---------- Toque e "segurar" no mapa ----------
  let press = null;
  function cancelPress() { if (press) clearTimeout(press.timer); press = null; }
  $('map').addEventListener('pointerdown', e => {
    if (!e.isPrimary) return cancelPress();
    const pt = [e.clientX, e.clientY];
    press = { pt, t: Date.now(), long: false,
      timer: setTimeout(() => { if (press) { press.long = true; App.emit('longpress', map.unproject(pt), pt); } }, 650) };
  });
  $('map').addEventListener('pointermove', e => {
    if (press && Math.hypot(e.clientX - press.pt[0], e.clientY - press.pt[1]) > 12) cancelPress();
  });
  $('map').addEventListener('pointerup', () => {
    if (press && !press.long && Date.now() - press.t < 400) {
      const [x, y] = press.pt, box = [[x - 26, y - 26], [x + 26, y + 26]];
      const layers = ['place-disc', 'poi-dot'].filter(id => map.getLayer(id));
      // escolhe o ponto mais perto do dedo (locais salvos têm preferência), não o primeiro da lista
      let hit = null, bestD = Infinity;
      for (const f of map.queryRenderedFeatures(box, { layers })) {
        const q = map.project(f.geometry.coordinates);
        const d = Math.hypot(q.x - x, q.y - y) - (f.layer.id === 'place-disc' ? 12 : 0);
        if (d < bestD) { bestD = d; hit = f; }
      }
      App.emit('tap', hit, map.unproject(press.pt));
    }
    cancelPress();
  });
  $('map').addEventListener('pointercancel', cancelPress);

  // ---------- Animação (30 fps) ----------
  const north = $('north');
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = (now - last) / 1000;
    if (dt < 1 / 62) return;          // até 60 quadros por segundo
    last = now;
    const step = Math.min(dt, .2);
    App.emit('frame', step);
    if (!S.target) return;
    // Prevê a posição entre um sinal de GPS e outro para o movimento ficar suave
    const age = (Date.now() - S.lastFix) / 1000;
    const pred = S.speedMs > 1 && age < 2.5 ? offset(S.target, S.heading, S.speedMs * Math.min(1.2, age)) : S.target;
    if (!S.shown || dist(S.shown, pred) > 300) S.shown = { ...pred };
    const k = 1 - Math.exp(-step * 6);
    S.shown.lat += (pred.lat - S.shown.lat) * k;
    S.shown.lng += (pred.lng - S.shown.lng) * k;
    S.bearing = (S.bearing + angDiff(S.heading, S.bearing) * (1 - Math.exp(-step * 4)) + 360) % 360;
    // Triângulo laranja: destino da rota (como no jogo) ou norte
    const dest = App.route && App.route.destination();
    const tri = dest ? App.brg(S.shown, dest) - S.bearing : -S.bearing;
    north.setAttribute('transform', `rotate(${tri} 50 50)`);
    if (cam.mode !== 'follow') return;
    // Quanto mais rápido, mais o mapa se afasta
    const zt = clamp(16.6 - (S.speedKmh - 20) / 100 * 1.6, 15, 16.6) + (App.route ? App.route.zoomHint() : 0);
    S.zoom += (zt - S.zoom) * (1 - Math.exp(-step * 1.2));
    zoomShown += (userZoom - zoomShown) * (1 - Math.exp(-step * 12));
    map.jumpTo({ center: [S.shown.lng, S.shown.lat], bearing: S.bearing, zoom: clamp(S.zoom + zoomShown, 11, 19.5),
                 pitch: settings.pitch, padding: padding() });
  }
  requestAnimationFrame(frame);

  // ---------- Eventos simples entre os módulos ----------
  const handlers = {};
  App.on = (ev, fn) => (handlers[ev] = handlers[ev] || []).push(fn);
  App.emit = (ev, ...args) => (handlers[ev] || []).forEach(fn => fn(...args));

  Object.assign(App, { map, snapToRoad, roadsNear, ROAD_CLASSES, POI_LABELS, cam, overview, follow, resetZoom,
    userZoom: () => userZoom });
})();
