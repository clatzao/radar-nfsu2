// Mapas offline.
// Todo pedaço de mapa (tile) carregado fica guardado no aparelho (IndexedDB), então as áreas já vistas
// funcionam sem internet. Além disso dá para baixar de propósito uma rota inteira ou a região ao redor.
(() => {
  const { dist, toast } = App;

  const TILEJSON = 'https://tiles.openfreemap.org/planet';
  const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
  const MAX_Z = 14;               // o OpenFreeMap vai até o zoom 14; acima disso o mapa amplia esses mesmos dados
  const AUTO_LIMIT = 6000;        // tiles guardados automaticamente (os baixados de propósito não contam)

  // ---------- IndexedDB ----------
  let dbPromise = null;
  function db() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('sem IndexedDB'));
      const req = indexedDB.open('nfsu2-offline', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore('tiles');     // 'z/x/y' → { d: ArrayBuffer, t: data, g: [ids de download] }
        d.createObjectStore('glyphs');    // 'fonte/faixa' → ArrayBuffer
        d.createObjectStore('groups');    // id → { id, type, name, created, count, bytes, route? }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch(e => { console.warn('Offline indisponível:', e); return null; });
    return dbPromise;
  }
  function tx(store, mode, fn) {
    return db().then(d => d && new Promise((resolve, reject) => {
      const t = d.transaction(store, mode), s = t.objectStore(store);
      let out;
      Promise.resolve(fn(s)).then(v => (out = v));
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }
  const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const get = (store, key) => tx(store, 'readonly', s => reqP(s.get(key))).catch(() => undefined);
  const put = (store, key, val) => tx(store, 'readwrite', s => { s.put(val, key); }).catch(() => {});

  // ---------- Endereço dos tiles (muda quando o OpenFreeMap publica dados novos) ----------
  let template = App.load('nfsu2-tile-template', null);
  let templateAt = App.load('nfsu2-tile-template-at', 0);
  let templateReq = null;
  function tileTemplate() {
    const fresh = template && Date.now() - templateAt < 24 * 3600e3;
    if (fresh) return Promise.resolve(template);
    if (!templateReq) {
      templateReq = fetch(TILEJSON).then(r => r.json()).then(j => {
        template = j.tiles[0]; templateAt = Date.now();
        App.save('nfsu2-tile-template', template); App.save('nfsu2-tile-template-at', templateAt);
        return template;
      }).catch(e => { if (template) return template; throw e; }).finally(() => (templateReq = null));
    }
    return template ? Promise.resolve(template) : templateReq;   // usa o antigo enquanto atualiza
  }

  async function fetchTile(z, x, y, signal) {
    const url = (await tileTemplate()).replace('{z}', z).replace('{x}', x).replace('{y}', y);
    const r = await fetch(url, { signal });
    if (r.status === 204 || r.status === 404) return new ArrayBuffer(0);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.arrayBuffer();
  }

  // ---------- Protocolo usado pelo mapa: nfsu2://tiles/z/x/y e nfsu2://fonts/fonte/faixa ----------
  let autoCount = App.load('nfsu2-auto-count', 0);
  maplibregl.addProtocol('nfsu2', async (params, abort) => {
    const path = decodeURIComponent(params.url.replace(/^nfsu2:\/\//, ''));
    if (path.startsWith('fonts/')) {
      const key = path.slice(6);
      const hit = await get('glyphs', key);
      if (hit) return { data: hit };
      const [stack, range] = key.split('/');
      const r = await fetch(GLYPHS.replace('{fontstack}', encodeURIComponent(stack)).replace('{range}', range), { signal: abort.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.arrayBuffer();
      put('glyphs', key, data);
      return { data };
    }
    const key = path.replace(/^tiles\//, '');
    const hit = await get('tiles', key);
    if (hit && hit.d) return { data: hit.d };
    const [z, x, y] = key.split('/').map(Number);
    const data = await fetchTile(z, x, y, abort.signal);
    put('tiles', key, { d: data, t: Date.now(), g: [] });
    if (++autoCount % 200 === 0) { App.save('nfsu2-auto-count', autoCount); if (autoCount > AUTO_LIMIT) prune(); }
    return { data };
  });

  // Apaga os tiles automáticos mais antigos quando passam do limite (nunca os baixados de propósito)
  async function prune() {
    const old = [];
    await tx('tiles', 'readonly', s => new Promise(res => {
      const c = s.openCursor();
      c.onsuccess = () => {
        const cur = c.result;
        if (!cur) return res();
        if (!cur.value.g || !cur.value.g.length) old.push([cur.value.t, cur.key]);
        cur.continue();
      };
    })).catch(() => {});
    old.sort((a, b) => a[0] - b[0]);
    const remove = old.slice(0, Math.max(0, old.length - AUTO_LIMIT * .7));
    await tx('tiles', 'readwrite', s => remove.forEach(([, k]) => s.delete(k))).catch(() => {});
    autoCount = old.length - remove.length;
    App.save('nfsu2-auto-count', autoCount);
  }

  // ---------- Quais tiles cobrem uma rota ou uma região ----------
  const tileX = (lng, z) => Math.floor((lng + 180) / 360 * 2 ** z);
  const tileY = (lat, z) => {
    const r = lat * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z);
  };
  const tileMeters = (lat, z) => 40075016 * Math.cos(lat * Math.PI / 180) / 2 ** z;

  function addBox(set, west, south, east, north, z) {
    for (let x = tileX(west, z); x <= tileX(east, z); x++)
      for (let y = tileY(north, z); y <= tileY(south, z); y++) set.add(`${z}/${x}/${y}`);
  }
  function tilesForRoute(shape) {
    const set = new Set();
    let w = 180, s = 90, e = -180, n = -90;
    shape.forEach(([lng, lat]) => { w = Math.min(w, lng); e = Math.max(e, lng); s = Math.min(s, lat); n = Math.max(n, lat); });
    for (let z = 6; z <= 11; z++) addBox(set, w, s, e, n, z);
    for (const z of [12, 13, 14]) {
      const ring = z === 14 ? 1 : 0;           // no zoom 14 pega também os tiles vizinhos (margem de ~2 km)
      for (let i = 0; i < shape.length; i++) {
        const a = shape[i], b = shape[i + 1] || a;
        const L = dist({ lng: a[0], lat: a[1] }, { lng: b[0], lat: b[1] });
        const steps = Math.max(1, Math.ceil(L / (tileMeters(a[1], z) / 3)));
        for (let k = 0; k < steps; k++) {
          const lng = a[0] + (b[0] - a[0]) * k / steps, lat = a[1] + (b[1] - a[1]) * k / steps;
          const tx0 = tileX(lng, z), ty0 = tileY(lat, z);
          for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) set.add(`${z}/${tx0 + dx}/${ty0 + dy}`);
        }
      }
    }
    return [...set];
  }
  function tilesForArea(center, km) {
    const set = new Set();
    const dLat = km / 111.32, dLng = km / (111.32 * Math.cos(center.lat * Math.PI / 180));
    for (let z = 6; z <= MAX_Z; z++) addBox(set, center.lng - dLng, center.lat - dLat, center.lng + dLng, center.lat + dLat, z);
    return [...set];
  }

  // ---------- Download ----------
  let job = null;
  async function download(group, keys, onProgress) {
    if (job) throw new Error('Já existe um download em andamento');
    if (!(await db())) throw new Error('Este aparelho não permite guardar mapas');
    const ctrl = new AbortController();
    job = { ctrl, group };
    let done = 0, bytes = 0, failed = 0, i = 0;
    const worker = async () => {
      while (i < keys.length && !ctrl.signal.aborted) {
        const key = keys[i++];
        try {
          const old = await get('tiles', key);
          let data = old && old.d;
          if (!data) { const [z, x, y] = key.split('/').map(Number); data = await fetchTile(z, x, y, ctrl.signal); }
          const g = new Set((old && old.g) || []); g.add(group.id);
          await put('tiles', key, { d: data, t: Date.now(), g: [...g] });
          bytes += data.byteLength;
        } catch (e) {
          if (ctrl.signal.aborted) break;
          failed++;
        }
        onProgress && onProgress(++done, keys.length);
      }
    };
    try {
      await Promise.all(Array.from({ length: 6 }, worker));
      // fontes dos nomes no mapa (letras latinas)
      for (const range of ['0-255', '256-511']) {
        const key = `Noto Sans Italic/${range}`;
        if (!(await get('glyphs', key))) {
          try {
            const r = await fetch(GLYPHS.replace('{fontstack}', encodeURIComponent('Noto Sans Italic')).replace('{range}', range));
            if (r.ok) await put('glyphs', key, await r.arrayBuffer());
          } catch (e) {}
        }
      }
      if (ctrl.signal.aborted) throw new Error('Download cancelado');
      Object.assign(group, { count: keys.length - failed, failed, bytes, created: Date.now() });
      await put('groups', group.id, group);
      return group;
    } finally {
      job = null;
    }
  }

  async function removeGroup(id) {
    await tx('tiles', 'readwrite', s => new Promise(res => {
      const c = s.openCursor();
      c.onsuccess = () => {
        const cur = c.result;
        if (!cur) return res();
        const v = cur.value;
        if (v.g && v.g.includes(id)) { v.g = v.g.filter(x => x !== id); cur.update(v); }   // vira cache automático
        cur.continue();
      };
    }));
    await tx('groups', 'readwrite', s => { s.delete(id); });
  }
  const groups = () => tx('groups', 'readonly', s => reqP(s.getAll())).then(l => (l || []).sort((a, b) => b.created - a.created)).catch(() => []);
  async function clearAll() {
    await tx('tiles', 'readwrite', s => { s.clear(); });
    await tx('glyphs', 'readwrite', s => { s.clear(); });
    await tx('groups', 'readwrite', s => { s.clear(); });
    autoCount = 0; App.save('nfsu2-auto-count', 0);
  }
  async function usage() {
    try { const e = await navigator.storage.estimate(); return e.usage || 0; } catch (e) { return null; }
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  App.offline = {
    style: { tiles: ['nfsu2://tiles/{z}/{x}/{y}'], glyphs: 'nfsu2://fonts/{fontstack}/{range}', maxzoom: MAX_Z },
    tilesForRoute, tilesForArea, download, removeGroup, groups, clearAll, usage,
    cancel: () => job && job.ctrl.abort(),
    busy: () => !!job
  };
})();
