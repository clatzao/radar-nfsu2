// Tela de ajustes.
(() => {
  const { $, settings, setSetting, openSheet, toast } = App;

  const OPTIONS = [
    { section: 'Tela' },
    { key: 'showSpeedo', type: 'switch', title: 'Velocímetro', sub: 'Mostrador do jogo no canto da tela' },
    { key: 'speedoSize', type: 'seg', title: 'Tamanho do velocímetro', sub: 'Pequeno, médio ou grande', choices: [['P', 'P'], ['M', 'M'], ['G', 'G']] },
    { key: 'units', type: 'seg', title: 'Unidade', sub: 'Velocidade no velocímetro', choices: [['kmh', 'km/h'], ['mph', 'MPH']] },
    { key: 'showPoi', type: 'switch', title: 'Estabelecimentos no mapa', sub: 'Postos, restaurantes, farmácias, lojas…' },
    { key: 'pitch', type: 'seg', title: 'Inclinação do mapa', sub: 'Visão de cima ou inclinada como o radar', choices: [[0, 'Plana'], [25, 'Leve'], [38, 'Jogo'], [55, 'Forte']] },
    { section: 'Rotas' },
    { key: 'voice', type: 'switch', title: 'Voz', sub: 'Fala as instruções da rota (ex.: "Em 300 metros, vire à direita")' },
    { key: 'avoidTolls', type: 'switch', title: 'Evitar pedágios', sub: 'Vale para a próxima rota calculada' },
    { key: 'avoidUnpaved', type: 'switch', title: 'Evitar estrada de terra', sub: 'Vale para a próxima rota calculada' },
    { section: 'Offline' },
    { type: 'action', title: 'Mapas offline', sub: 'Baixar região ou rota para usar sem internet', label: 'Abrir', run: () => App.offlineUI.open() },
    { section: 'Testes' },
    { key: 'simulate', type: 'switch', title: 'Simular trajeto', sub: 'Um carro de mentira anda sozinho (segue a rota, se houver)' },
    { section: 'Aplicativo', nativeOnly: true },
    { key: 'autoUpdate', type: 'switch', nativeOnly: true, title: 'Atualização automática', sub: 'Procura versão nova ao abrir o app' },
    { type: 'action', nativeOnly: true, title: 'Verificar atualização', sub: () => `Versão instalada: ${App.update.version()}`,
      label: 'Verificar', run: () => { toast('Procurando atualização…'); App.update.check(true); } },
    { section: 'Dados' },
    { type: 'action', title: 'Zerar zoom', sub: 'Volta o zoom do mapa ao padrão', label: 'Zerar', run: () => { App.resetZoom(); toast('Zoom zerado'); } },
    { type: 'action', title: 'Apagar locais salvos', sub: 'Remove todas as bolas do mapa', label: 'Apagar', danger: true,
      run: () => { if (confirm('Apagar todos os locais salvos?')) { App.places.clear(); toast('Locais apagados'); } } }
  ];

  function render() {
    $('settingsBody').innerHTML = OPTIONS.map((o, i) => {
      if (o.nativeOnly && !(App.update && App.update.available)) return '';
      if (o.section) return `<div class="section">${o.section}</div>`;
      let ctl = '';
      if (o.type === 'switch') ctl = `<button class="switch${settings[o.key] ? ' on' : ''}" data-i="${i}" role="switch" aria-checked="${!!settings[o.key]}" aria-label="${o.title}"></button>`;
      if (o.type === 'seg') ctl = `<div class="seg">${o.choices.map(([v, l]) =>
        `<button data-i="${i}" data-v="${v}" class="${String(settings[o.key]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
      if (o.type === 'action') ctl = `<button class="btn${o.danger ? ' danger' : ''}" data-i="${i}">${o.label}</button>`;
      const sub = typeof o.sub === 'function' ? o.sub() : o.sub;
      return `<div class="opt"><div class="t"><b>${o.title}</b><small>${App.esc(sub)}</small></div>${ctl}</div>`;
    }).join('');
  }
  $('settingsBody').addEventListener('click', e => {
    const b = e.target.closest('[data-i]'); if (!b) return;
    const o = OPTIONS[+b.dataset.i];
    if (o.type === 'switch') setSetting(o.key, !settings[o.key]);
    if (o.type === 'seg') setSetting(o.key, typeof o.choices[0][0] === 'number' ? +b.dataset.v : b.dataset.v);
    if (o.type === 'action') o.run();
    render();
  });
  $('bSettings').onclick = () => { render(); openSheet('settingsSheet'); };
})();
