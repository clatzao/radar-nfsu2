// Início: mantém a tela ligada no navegador e liga o GPS (ou a simulação).
(() => {
  let wakeLock = null;
  async function requestWakeLock() {
    try { if (!wakeLock && 'wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.onrelease = () => (wakeLock = null); } }
    catch (e) {}
  }
  document.addEventListener('pointerdown', requestWakeLock);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') requestWakeLock(); });

  App.applySource();
})();
