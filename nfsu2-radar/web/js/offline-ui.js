// Tela "Mapas offline": baixar região ou rota, ver o que está guardado e apagar.
(() => {
  const { $, S, esc, fmtDist, fmtDuration, toast, openSheet, closeSheets } = App;
  const off = App.offline;

  const fmtBytes = b => b == null ? '?' : b < 1048576 ? Math.max(1, Math.round(b / 1024)) + ' KB' : (b / 1048576).toFixed(1).replace('.', ',') + ' MB';
  // Cidade grande pesa ~300 KB por parte; interior e estrada, bem menos
  const estimate = n => `entre ${Math.max(1, Math.round(n * .03))} e ${Math.max(2, Math.round(n * .3))} MB (cidade grande pesa mais)`;
  const fmtDate = t => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

  async function render() {
    const list = await off.groups();
    $('offList').innerHTML = list.map(g => `
      <div class="row">
        <span class="ball" style="--c:${g.type === 'route' ? '#ffae1a' : '#2f8fff'}"></span>
        <div class="t"><b>${esc(g.name)}</b>
          <small>${g.type === 'route' ? 'Rota' : 'Região'} · ${g.count} partes · ${fmtBytes(g.bytes)} · ${fmtDate(g.created)}${g.failed ? ` · ${g.failed} falharam` : ''}</small></div>
        ${g.type === 'route' && g.route ? `<button class="btn" data-start="${esc(g.id)}">Iniciar</button>` : ''}
        <button class="btn icon danger" data-del="${esc(g.id)}" aria-label="Apagar">🗑</button>
      </div>`).join('') || '<div class="hint">Nada baixado ainda.</div>';
    const used = await off.usage();
    $('offUsage').textContent = used != null ? `Espaço usado pelo app (mapas guardados incluídos): ${fmtBytes(used)}` : '';
    groupsCache = list;
  }
  let groupsCache = [];

  $('offList').addEventListener('click', async e => {
    const del = e.target.closest('[data-del]'), st = e.target.closest('[data-start]');
    if (del) {
      const g = groupsCache.find(x => x.id === del.dataset.del);
      if (!g || !confirm(`Apagar "${g.name}" dos mapas offline?`)) return;
      await off.removeGroup(g.id);
      toast('Apagado'); render();
    }
    if (st) {
      const g = groupsCache.find(x => x.id === st.dataset.start);
      if (g && g.route) { closeSheets(); App.route.start(g.route); }
    }
  });

  function progress(title, done, total) {
    $('offProgress').hidden = false;
    $('offProgTitle').textContent = `${title} — ${done} de ${total}`;
    $('offBar').style.width = (total ? done / total * 100 : 0) + '%';
  }

  async function run(group, keys) {
    if (off.busy()) return toast('Já existe um download em andamento');
    if (navigator.onLine === false) return toast('Sem internet para baixar agora');
    openSheet('offlineSheet');
    render();
    progress(group.name, 0, keys.length);
    try {
      const g = await off.download(group, keys, (d, t) => progress(group.name, d, t));
      toast(`Pronto: ${g.name} (${fmtBytes(g.bytes)}) disponível sem internet`, 5000);
    } catch (e) {
      toast(e.message, 4000);
    } finally {
      $('offProgress').hidden = true;
      render();
    }
  }

  $('offCancel').onclick = () => off.cancel();
  $('offArea').onclick = () => {
    const here = S.target;
    if (!here) return toast('Aguardando o GPS para saber a sua região…');
    const keys = off.tilesForArea(here, 10);
    const name = ($('street').textContent !== '—' ? 'Região de ' + $('street').textContent : 'Região ao redor');
    if (!confirm(`Baixar ${name}? São ${keys.length} partes: ${estimate(keys.length)}.`)) return;
    run({ id: 'a' + Date.now().toString(36), type: 'area', name }, keys);
  };

  App.offlineUI = {
    open: () => { openSheet('offlineSheet'); render(); },
    downloadRoute: (route, title) => {
      const keys = off.tilesForRoute(route.shape);
      const name = (title || 'Rota').replace(/^Até /, 'Até ');
      if (!confirm(`Baixar o mapa da rota "${name}" (${fmtDist(route.total)})? São ${keys.length} partes: ${estimate(keys.length)}.`)) return;
      const saved = { shape: route.shape, cum: route.cum, total: route.total, time: route.time, maneuvers: route.maneuvers, dest: route.dest, id: route.id };
      run({ id: 'r' + Date.now().toString(36), type: 'route', name: `${name} · ${fmtDuration(route.time)}`, route: saved }, keys);
    }
  };
})();
