// Locais salvos (bola colorida das lojas do jogo) e o cartão que aparece ao tocar num ponto do mapa.
(() => {
  const { $, S, map, esc, dist, fmtDist, load, save, toast, openSheet, closeSheets, closeCard, POI_LABELS } = App;

  const COLORS = [
    ['Vermelho', '#ff3b30'], ['Laranja', '#ff8a1c'], ['Amarelo', '#ffd21a'], ['Verde', '#3fd63a'],
    ['Azul', '#2f8fff'], ['Roxo', '#a45cff'], ['Rosa', '#ff5cc8'], ['Branco', '#f2f2ee']
  ];
  let places = load('nfsu2-places', []);

  function persist() {
    save('nfsu2-places', places);
    render();
  }
  function render() {
    const src = map.getSource('places');
    if (!src) return;
    src.setData({ type: 'FeatureCollection', features: places.map(p => ({
      type: 'Feature', properties: { id: p.id, name: p.name, color: p.color },
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] } })) });
  }
  App.on('mapload', render);

  // ---------- Lista ----------
  function openList() {
    const here = S.shown || S.target;
    const rows = places
      .map(p => ({ p, d: here ? dist(here, p) : null }))
      .sort((a, b) => (a.d ?? 0) - (b.d ?? 0))
      .map(({ p, d }) => `
        <div class="row">
          <span class="ball" style="--c:${esc(p.color)}"></span>
          <div class="t"><b>${esc(p.name)}</b><small>${esc(p.addr || '')}</small></div>
          <span class="k">${d != null ? fmtDist(d) : ''}</span>
          <button class="btn" data-go="${esc(p.id)}">Rota</button>
          <button class="btn icon" data-edit="${esc(p.id)}" aria-label="Editar">✎</button>
        </div>`).join('');
    $('placesList').innerHTML = rows || '<div class="hint">Nenhum local salvo ainda.</div>';
    openSheet('placesSheet');
  }
  $('bPlaces').onclick = openList;
  $('placesList').addEventListener('click', e => {
    const go = e.target.closest('[data-go]'), ed = e.target.closest('[data-edit]');
    if (go) { const p = places.find(x => x.id === go.dataset.go); if (p) { closeSheets(); App.route.to({ lat: p.lat, lng: p.lng, name: p.name }); } }
    if (ed) { const p = places.find(x => x.id === ed.dataset.edit); if (p) openForm(p); }
  });
  $('bSaveHere').onclick = () => {
    const here = S.target;
    if (!here) return toast('Aguardando o GPS…');
    openForm({ lat: here.lat, lng: here.lng, name: $('street').textContent !== '—' ? $('street').textContent : '' });
  };

  // ---------- Formulário ----------
  let editing = null, pickedColor = COLORS[0][1];
  $('placeColors').innerHTML = COLORS.map(([n, c]) =>
    `<button data-color="${c}" aria-label="${n}" title="${n}"><span class="ball" style="--c:${c}"></span></button>`).join('');
  $('placeColors').addEventListener('click', e => {
    const b = e.target.closest('[data-color]'); if (!b) return;
    pickedColor = b.dataset.color; markColor();
  });
  const markColor = () => [...$('placeColors').children].forEach(b => b.classList.toggle('sel', b.dataset.color === pickedColor));

  function openForm(p) {
    editing = p;
    const isNew = !p.id;
    $('placeFormTitle').textContent = isNew ? 'Salvar local' : 'Editar local';
    $('placeName').value = p.name || '';
    pickedColor = p.color || COLORS[0][1]; markColor();
    $('placeDelete').hidden = isNew;
    $('placeAddr').textContent = p.addr || `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
    openSheet('placeForm');
    if (!p.addr) App.reverseGeocode(p).then(pr => {
      if (!pr || editing !== p) return;
      p.addr = [pr.street || pr.name, pr.housenumber, pr.district, pr.city].filter(Boolean).join(', ');
      $('placeAddr').textContent = p.addr;
      if (!$('placeName').value) $('placeName').value = pr.name || pr.street || '';
    }).catch(() => {});
    setTimeout(() => $('placeName').focus(), 50);
  }
  $('placeSave').onclick = () => {
    const name = $('placeName').value.trim();
    if (!name) { toast('Dê um nome ao local'); return $('placeName').focus(); }
    const p = editing;
    if (p.id) Object.assign(places.find(x => x.id === p.id), { name, color: pickedColor, addr: p.addr });
    else places.push({ id: 'p' + Date.now().toString(36), name, color: pickedColor, lat: p.lat, lng: p.lng, addr: p.addr || '' });
    persist(); closeSheets(); toast('Local salvo');
  };
  $('placeName').addEventListener('keydown', e => { if (e.key === 'Enter') $('placeSave').click(); });
  $('placeDelete').onclick = () => {
    if (!editing?.id || !confirm(`Excluir "${editing.name}"?`)) return;
    places = places.filter(x => x.id !== editing.id);
    persist(); closeSheets(); toast('Local excluído');
  };

  // ---------- Cartão ao tocar no mapa ----------
  function showCard({ title, sub, color, actions }) {
    $('cardTitle').textContent = title;
    $('cardSub').textContent = sub || '';
    $('cardBall').style.setProperty('--c', color || '#8d8f88');
    $('cardActions').innerHTML = '';
    actions.forEach(([label, fn, primary]) => {
      const b = document.createElement('button');
      b.className = 'btn' + (primary ? ' primary' : '');
      b.textContent = label;
      b.onclick = () => { closeCard(); fn(); };
      $('cardActions').appendChild(b);
    });
    closeSheets();
    $('card').hidden = false;
  }
  $('cardClose').onclick = closeCard;

  App.on('tap', (feat, lngLat) => {
    if (!feat) return closeCard();
    const [lng, lat] = feat.geometry.coordinates;
    const here = S.shown || S.target, d = here ? ' · ' + fmtDist(dist(here, { lat, lng })) : '';
    if (feat.layer.id === 'place-disc') {
      const p = places.find(x => x.id === feat.properties.id); if (!p) return;
      showCard({ title: p.name, sub: (p.addr || 'Local salvo') + d, color: p.color, actions: [
        ['Editar', () => openForm(p)],
        ['Rota até aqui', () => App.route.to({ lat: p.lat, lng: p.lng, name: p.name }), true]
      ] });
    } else {
      const pr = feat.properties, kind = POI_LABELS[pr.subclass] || POI_LABELS[pr.class] || 'Estabelecimento';
      const name = pr['name:pt'] || pr.name || kind;
      const color = map.getPaintProperty('poi-dot', 'circle-color');
      showCard({ title: name, sub: kind + d, color: matchColor(color, pr.class), actions: [
        ['Salvar local', () => openForm({ lat, lng, name })],
        ['Rota até aqui', () => App.route.to({ lat, lng, name }), true]
      ] });
      // Completa com o endereço (rua e número) do serviço de endereços
      App.reverseGeocode({ lat, lng }).then(a => {
        if (!a || $('card').hidden || $('cardTitle').textContent !== name) return;
        const addr = [a.street || (a.osm_key === 'highway' ? a.name : ''), a.housenumber].filter(Boolean).join(', ');
        if (addr) $('cardSub').textContent = `${kind} · ${addr}${d}`;
      }).catch(() => {});
    }
  });
  App.on('longpress', lngLat => {
    const p = { lat: lngLat.lat, lng: lngLat.lng };
    const here = S.shown || S.target;
    showCard({ title: 'Ponto selecionado', sub: `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}${here ? ' · ' + fmtDist(dist(here, p)) : ''}`,
      color: '#ffae1a', actions: [
        ['Salvar local', () => openForm(p)],
        ['Rota até aqui', () => App.route.to({ ...p, name: 'Ponto selecionado' }), true]
      ] });
    App.reverseGeocode(p).then(pr => {
      if (!pr || $('card').hidden || $('cardTitle').textContent !== 'Ponto selecionado') return;
      $('cardSub').textContent = [pr.name || pr.street, pr.housenumber, pr.district || pr.city].filter(Boolean).join(', ');
    }).catch(() => {});
  });
  // Pega a cor de uma expressão 'match' do estilo para a classe do estabelecimento
  function matchColor(expr, cls) {
    if (!Array.isArray(expr)) return expr;
    for (let i = 2; i < expr.length - 1; i += 2) if ([].concat(expr[i]).includes(cls)) return expr[i + 1];
    return expr[expr.length - 1];
  }

  App.places = {
    all: () => places,
    search: q => { q = q.toLowerCase(); return places.filter(p => p.name.toLowerCase().includes(q)); },
    clear: () => { places = []; persist(); }
  };
})();
