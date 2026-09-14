// Atualização automática do app (só existe dentro do app Android; no navegador não faz nada).
(() => {
  const { $, settings, toast, NATIVE } = App;
  const card = $('updateCard');
  let skipped = null;

  function show(title, sub, withButtons) {
    $('updTitle').textContent = title;
    $('updSub').textContent = sub;
    $('updActions').hidden = !withButtons;
    card.hidden = false;
  }

  // Chamadas pelo lado nativo (Updater.java)
  window.onUpdateAvailable = (version, current, notes) => {
    if (version === skipped) return;
    const firstLine = (notes || '').split('\n').map(l => l.replace(/^[-*#\s]+/, '').trim()).find(Boolean) || '';
    show(`Versão ${version} disponível`, `Você está na ${current}. ${firstLine}`, true);
    card.dataset.version = version;
  };
  window.onUpdateNone = current => toast(`Você já está na versão mais recente (${current})`);
  window.onUpdateProgress = pct => show('Baixando atualização', pct >= 0 ? `${pct}%` : 'Baixando…', false);
  window.onUpdateStatus = msg => {
    if (card.hidden || $('updActions').hidden) toast(msg, 6000);
    else $('updSub').textContent = msg;
    if (/Falha|não foi|cancelada/i.test(msg)) { $('updActions').hidden = false; }
  };

  $('updNow').onclick = () => { $('updActions').hidden = true; $('updSub').textContent = 'Preparando…'; NATIVE.installUpdate(); };
  $('updLater').onclick = () => { skipped = card.dataset.version; card.hidden = true; };

  App.update = {
    available: !!(NATIVE && NATIVE.checkUpdate),
    version: () => (NATIVE && NATIVE.getVersion ? NATIVE.getVersion() : ''),
    check: manual => { if (NATIVE && NATIVE.checkUpdate) NATIVE.checkUpdate(!!manual); }
  };

  // Procura ao abrir o app e depois a cada 6 horas (se ligado nos Ajustes)
  if (App.update.available) {
    const auto = () => { if (settings.autoUpdate) App.update.check(false); };
    setTimeout(auto, 8000);
    setInterval(auto, 6 * 60 * 60 * 1000);
  }
})();
