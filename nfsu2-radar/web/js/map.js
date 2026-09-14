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
      // tiles e fontes passam pelo módulo offline (guarda no aparelho e usa sem internet)
      glyphs: App.offline.style.glyphs,
      sources: {
        omt: { type: 'vector', tiles: App.offline.style.tiles, minzoom: 0, maxzoom: App.offline.style.maxzoom,
               attribution: '© OpenMapTiles © OpenStreetMap' },
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
    attributionControl: false, fadeDuration: 0,
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),   // mais leve em telas de alta densidade
    maxTileCacheSize: 200,
    dragRotate: true, touchPitch: false, keyboard: false, pitchWithRotate: false, maxPitch: 60
  });
  map.touchZoomRotate.enableRotation();
  window.__radar = { map, S };   // para depuração pelo console

  function setPoiVisible(v) {
    ['poi-glow', 'poi-dot', 'poi-label'].forEach(id => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', v ? 'visible' : 'none'));
  }
  map.on('load', () => { setPoiVisible(settings.showPoi); App.emit('mapload'); });
  App.onSetting(k => { if (k === 'showPoi') setPoiVisible(settings.showPoi); });

  // ---------- Consulta rápida de ruas perto de um ponto ----------
  function roadsNear(p, layers, sourceLayer, radiusPx = 70) {
    try {
      const pt = map.project([p.lng, p.lat]), c = map.getContainer();
      if (pt.x > 0 && pt.y > 0 && pt.x < c.clientWidth && pt.y < c.clientHeight && map.getLayer(layers[0])) {
        return map.queryRenderedFeatures([[pt.x - radiusPx, pt.y - radiusPx], [pt.x + radiusPx, pt.y + radiusPx]], { layers });
      }
      return map.getSource('omt') ? map.querySourceFeatures('omt', { sourceLayer }) : [];
    } catch (e) { return []; }
  }

  // ---------- Seta presa na rua (com "memória" da via atual) ----------
  // Guarda em S.road o trecho em que o carro está (ponto e rumo). Em cruzamentos, só troca de via
  // se a outra for claramente melhor, e nunca para uma rua atravessada ao sentido do carro.
  const ROAD_CLASSES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service']);
  function snapToRoad(p, acc, moving) {
    const onRoute = App.route && App.route.snap(p, clamp(acc || 15, 12, 30));
    if (onRoute) { S.road = onRoute; return { lat: onRoute.lat, lng: onRoute.lng }; }
    const feats = roadsNear(p, ['minor', 'mid', 'major'], 'transportation');
    const prev = S.road;
    const maxD = clamp(acc || 15, 10, 25);
    let best = null, bestScore = Infinity;
    // Com GPS bom quase certamente não estamos dentro de um túnel (lá o sinal cai)
    const goodGps = acc == null || acc <= 25;
    const tunnelPenalty = goodGps ? 20 : 0;
    const surfaceD = Math.max(maxD, 28);      // via de superfície é aceita um pouco mais longe que um túnel
    for (const f of feats) {
      if (!ROAD_CLASSES.has(f.properties.class)) continue;
      const tunnel = f.properties.brunnel === 'tunnel';
      for (const ln of lines(f.geometry)) {
        for (let i = 1; i < ln.length; i++) {
          const s = segInfo(p, ln[i - 1], ln[i]);
          if (s.d > (tunnel || !goodGps ? maxD : surfaceD)) continue;
          let score = s.d + (tunnel ? tunnelPenalty : 0);
          const ref = moving ? S.heading : (prev ? prev.b : null);
          if (ref != null) {
            const a = Math.abs(angDiff(s.b, ref)), off = Math.min(a, 180 - a);
            if (moving && off > 45) continue;          // rua atravessada: não gruda nela
            score += off * (moving ? .35 : .15);
          }
          // continuidade: perto do trecho anterior e com o mesmo rumo ganha bônus
          if (prev && dist(prev, s) < 30) {
            const a = Math.abs(angDiff(s.b, prev.b));
            if (Math.min(a, 180 - a) < 20) score -= 4;
          }
          if (score < bestScore) { bestScore = score; best = s; best.tunnel = tunnel; }
        }
      }
    }
    if (!best) { S.road = null; return p; }
    S.road = { lat: best.lat, lng: best.lng, b: best.b, d: best.d, tunnel: best.tunnel };
    return { lat: best.lat, lng: best.lng };
  }

  // ---------- Câmera ----------
  // 'follow' = segue o carro · 'free' = você arrasta/gira o mapa · 'overview' = rota inteira antes de iniciar
  const cam = { mode: 'follow', lastTouch: 0, blend: null };
  const PLAYER_Y = .66;
  const followPadding = () => ({ top: Math.max(0, (2 * PLAYER_Y - 1) * map.getContainer().clientHeight), bottom: 0, left: 0, right: 0 });

  // Marcador do carro preso ao mapa (acompanha quando você arrasta ou gira)
  const markerEl = document.createElement('div');
  markerEl.className = 'player-marker';
  markerEl.innerHTML = '<svg viewBox="0 0 40 40"><path d="M20 4 L33 34 L20 27 L7 34 Z" fill="#3fd63a" stroke="#0f3d0d" stroke-width="2" stroke-linejoin="round"/></svg>';
  const marker = new maplibregl.Marker({ element: markerEl, rotationAlignment: 'map', pitchAlignment: 'map' })
    .setLngLat([-46.6559, -23.5614]);
  let markerAdded = false;

  function setMode(mode) {
    cam.mode = mode;
    $('bRecenter').hidden = mode !== 'free';
    $('speedo').style.visibility = mode === 'overview' ? 'hidden' : '';
    App.emit('cammode', mode);
  }
  function overview(bounds) {
    setMode('overview');
    const h = map.getContainer().clientHeight, w = map.getContainer().clientWidth;
    map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
    map.jumpTo({ bearing: 0, pitch: 0 });
    const pad = w > h ? { top: h * .22, bottom: h * .12, left: w * .44, right: w * .1 }
                      : { top: h * .3, bottom: h * .42, left: w * .08, right: w * .08 };
    map.fitBounds(bounds, { padding: pad, duration: 0, maxZoom: 16 });
  }
  function follow() {
    if (cam.mode === 'follow') return;
    // volta ao carro suavemente em ~0,7 s
    cam.blend = { t0: performance.now(), center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(),
                  pitch: map.getPitch(), padding: map.getPadding() };
    setMode('follow');
  }
  function free() {
    cam.blend = null;
    setMode('free');
  }
  // Qualquer gesto seu no mapa (arrastar, pinçar, girar, roda do mouse) solta a câmera do carro
  map.on('movestart', e => { if (e.originalEvent) { cam.lastTouch = Date.now(); if (cam.mode === 'follow') free(); } });
  map.on('move', e => { if (e.originalEvent) cam.lastTouch = Date.now(); });
  $('bRecenter').onclick = follow;

  // ---------- Zoom pelos botões + / − ----------
  const ZOOM_MIN = -4, ZOOM_MAX = 2.5;
  let userZoom = clamp(App.load('nfsu2-zoom', 0) || 0, ZOOM_MIN, ZOOM_MAX), zoomShown = userZoom;
  function setUserZoom(z) {
    userZoom = clamp(z, ZOOM_MIN, ZOOM_MAX);
    App.save('nfsu2-zoom', +userZoom.toFixed(2));
  }
  $('bZoomIn').onclick = () => cam.mode === 'follow' ? setUserZoom(userZoom + .5) : map.zoomIn({ duration: 250 });
  $('bZoomOut').onclick = () => cam.mode === 'follow' ? setUserZoom(userZoom - .5) : map.zoomOut({ duration: 250 });
  function resetZoom() { setUserZoom(0); if (cam.mode !== 'follow') follow(); }
  // Tocar na bússola deixa o norte para cima (no modo livre)
  $('compassBtn').onclick = () => { if (cam.mode !== 'follow') map.easeTo({ bearing: 0, duration: 400 }); };
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
  $('map').addEventListener('touchstart', e => { if (e.touches.length > 1) cancelPress(); }, { passive: true });
  $('map').addEventListener('pointerup', () => {
    if (press && !press.long && Date.now() - press.t < 400) {
      const [x, y] = press.pt, box = [[x - 26, y - 26], [x + 26, y + 26]];
      const layers = ['place-disc', 'poi-dot'].filter(id => map.getLayer(id));
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

  // ---------- Animação (até 60 fps) ----------
  const north = $('north');
  let last = performance.now();
  const lerpAng = (a, b, t) => (a + angDiff(b, a) * t + 360) % 360;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = (now - last) / 1000;
    if (dt < 1 / 62) return;
    last = now;
    const step = Math.min(dt, .2);
    App.emit('frame', step);
    if (!S.target) return;

    const age = (Date.now() - S.lastFix) / 1000;
    const pred = S.speedMs > 1 && age < 2.5 ? offset(S.target, S.heading, S.speedMs * Math.min(1.2, age)) : S.target;
    if (!S.shown || dist(S.shown, pred) > 300) S.shown = { ...pred };
    const k = 1 - Math.exp(-step * 6);
    S.shown.lat += (pred.lat - S.shown.lat) * k;
    S.shown.lng += (pred.lng - S.shown.lng) * k;
    S.bearing = lerpAng(S.bearing, S.heading, 1 - Math.exp(-step * 4));

    marker.setLngLat([S.shown.lng, S.shown.lat]).setRotation(S.heading);
    if (!markerAdded) { marker.addTo(map); markerAdded = true; }
    markerEl.style.visibility = cam.mode === 'overview' ? 'hidden' : '';

    // Triângulo laranja: aponta o destino da rota (como no jogo) ou o norte, relativo à tela
    const dest = App.route && App.route.destination();
    const screenBearing = cam.mode === 'follow' ? S.bearing : map.getBearing();
    const tri = dest ? App.brg(S.shown, dest) - screenBearing : -screenBearing;
    north.setAttribute('transform', `rotate(${tri} 50 50)`);

    // Com rota ativa, volta a seguir o carro sozinho depois de 20 s sem mexer no mapa
    if (cam.mode === 'free' && App.route && App.route.destination() && Date.now() - cam.lastTouch > 20000) follow();
    if (cam.mode !== 'follow') return;

    const zt = clamp(16.6 - (S.speedKmh - 20) / 100 * 1.6, 15, 16.6) + (App.route ? App.route.zoomHint() : 0);
    S.zoom += (zt - S.zoom) * (1 - Math.exp(-step * 1.2));
    zoomShown += (userZoom - zoomShown) * (1 - Math.exp(-step * 12));
    const target = { center: [S.shown.lng, S.shown.lat], bearing: S.bearing, zoom: clamp(S.zoom + zoomShown, 11, 19.5),
                     pitch: settings.pitch, padding: followPadding() };
    if (cam.blend) {
      const t = Math.min(1, (now - cam.blend.t0) / 700), e = t * t * (3 - 2 * t);
      const b = cam.blend, P = followPadding();
      map.jumpTo({
        center: [b.center.lng + (target.center[0] - b.center.lng) * e, b.center.lat + (target.center[1] - b.center.lat) * e],
        zoom: b.zoom + (target.zoom - b.zoom) * e, bearing: lerpAng(b.bearing, target.bearing, e),
        pitch: b.pitch + (target.pitch - b.pitch) * e,
        padding: { top: b.padding.top + (P.top - b.padding.top) * e, bottom: 0, left: 0, right: 0 }
      });
      if (t >= 1) cam.blend = null;
      return;
    }
    map.jumpTo(target);
  }
  requestAnimationFrame(frame);

  // ---------- Eventos simples entre os módulos ----------
  const handlers = {};
  App.on = (ev, fn) => (handlers[ev] = handlers[ev] || []).push(fn);
  App.emit = (ev, ...args) => (handlers[ev] || []).forEach(fn => fn(...args));

  Object.assign(App, { map, snapToRoad, roadsNear, ROAD_CLASSES, POI_LABELS, cam, overview, follow, resetZoom,
    userZoom: () => userZoom });
})();
