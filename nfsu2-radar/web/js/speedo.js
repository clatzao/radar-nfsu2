// Velocímetro no estilo do HUD personalizado do NFSU2.
// Desenhado em SVG usando as mesmas coordenadas da imagem de referência (1414 × 1100 px).
(() => {
  const { $, S, settings, clamp, rad } = App;
  const svg = $('speedoSvg');

  const MC = [890, 605];   // mostrador grande
  const SC = [305, 815];   // mostrador pequeno (aceleração, como o "boost" do jogo)
  const pol = (c, r, a) => [c[0] + r * Math.sin(rad(a)), c[1] - r * Math.cos(rad(a))];
  const P = (c, r, a) => pol(c, r, a).map(v => v.toFixed(1)).join(' ');
  const arc = (c, r, a1, a2) => {
    const sweep = ((a2 - a1) % 360 + 360) % 360;
    return `M${P(c, r, a1)} A${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${P(c, r, a2)}`;
  };

  // Chama "tribal": língua que sai da base e termina numa ponta curvada
  function tongue(x0, y0, w, x1, y1, curl) {
    const L = Math.hypot(x1 - x0, y1 - y0), dx = (x1 - x0) / L, dy = (y1 - y0) / L, nx = -dy, ny = dx;
    const p = (x, y) => `${x.toFixed(0)} ${y.toFixed(0)}`;
    const a = [x0 + nx * w, y0 + ny * w], b = [x0 - nx * w, y0 - ny * w];
    const tip = [x1 + nx * curl, y1 + ny * curl];
    return `M${p(...a)}` +
      ` C${p(a[0] + dx * L * .35 + nx * w * 1.1, a[1] + dy * L * .35 + ny * w * 1.1)} ${p(x1 - dx * L * .28 + nx * w * .9, y1 - dy * L * .28 + ny * w * .9)} ${p(...tip)}` +
      ` C${p(x1 - dx * L * .32 - nx * w * .15, y1 - dy * L * .32 - ny * w * .15)} ${p(x0 + dx * L * .42 - nx * w * 1.25, y0 + dy * L * .42 - ny * w * 1.25)} ${p(...b)}` +
      ` Q${p(x0 - dx * w * .4, y0 - dy * w * .4)} ${p(...a)} Z`;
  }
  const flames = (list, fill) => list.map(t => `<path d="${tongue(...t)}" fill="${fill}"/>`).join('');

  function dial(c, rOuter, rRim, rFace, id) {
    return `
      <circle cx="${c[0]}" cy="${c[1]}" r="${rOuter}" fill="#101010"/>
      <circle cx="${c[0]}" cy="${c[1]}" r="${rRim}" fill="url(#rim)"/>
      <circle cx="${c[0]}" cy="${c[1]}" r="${rFace}" fill="url(#face)" stroke="#0c0c0c" stroke-width="4"/>
      <clipPath id="${id}"><circle cx="${c[0]}" cy="${c[1]}" r="${rFace - 2}"/></clipPath>`;
  }

  function build() {
    let s = `
      <defs>
        <radialGradient id="face" cx="42%" cy="36%" r="70%">
          <stop offset="0" stop-color="#4a4a4a"/><stop offset=".5" stop-color="#2e2e2e"/><stop offset="1" stop-color="#161616"/>
        </radialGradient>
        <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#4b4b4b"/><stop offset=".5" stop-color="#2a2a2a"/><stop offset="1" stop-color="#1c1c1c"/>
        </linearGradient>
        <linearGradient id="needleFill" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#8f8f8f"/><stop offset=".45" stop-color="#e9e9e9"/><stop offset="1" stop-color="#9a9a9a"/>
        </linearGradient>
        <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="14"/></filter>
      </defs>`;

    // Sombra estática (fica separada dos ponteiros para não ser redesenhada a cada quadro)
    s += `<g filter="url(#shadow)" opacity=".55" transform="translate(10 18)">
            <circle cx="${MC[0]}" cy="${MC[1]}" r="430" fill="#000"/><circle cx="${SC[0]}" cy="${SC[1]}" r="222" fill="#000"/></g>`;

    // Faixa azul "N2O" com a aba do nome
    s += `<path d="M${P(MC, 512, 268)} A512 512 0 0 1 ${P(MC, 512, 22)} L1150 116 L1328 262 L1292 382 L${P(MC, 412, 64)}
            A412 412 0 0 0 ${P(MC, 412, 268)} Z" fill="#139bf0" stroke="#0d0d0d" stroke-width="10" stroke-linejoin="round"/>`;
    for (let a = 282; a <= 380; a += 10.8) {
      s += `<line x1="${pol(MC, 462, a)[0].toFixed(1)}" y1="${pol(MC, 462, a)[1].toFixed(1)}" x2="${pol(MC, 503, a)[0].toFixed(1)}" y2="${pol(MC, 503, a)[1].toFixed(1)}" stroke="#0d0d0d" stroke-width="8"/>`;
    }
    s += `<text x="1208" y="222" transform="rotate(49 1208 222)" text-anchor="middle" dominant-baseline="central"
            font-family="'Exo 2', Arial, sans-serif" font-weight="800" font-style="normal" font-size="112" fill="#0d0d0d" letter-spacing="-2">N2O</text>`;

    // Mostrador grande
    s += dial(MC, 422, 404, 386, 'clipMain');
    s += `<g clip-path="url(#clipMain)">
      ${flames([[540, 640, 48, 690, 400, -46], [590, 880, 82, 900, 420, -78], [670, 880, 92, 1110, 370, -90],
                [760, 880, 86, 1260, 520, -74], [640, 1000, 66, 1010, 660, -52], [500, 520, 34, 610, 370, -30]], '#5b5b5b')}
      ${flames([[690, 930, 54, 960, 570, -48], [790, 930, 58, 1160, 610, -52], [610, 780, 42, 820, 520, -36],
                [860, 1000, 46, 1200, 760, -40]], '#353535')}
    </g>`;
    s += `<path d="${arc(MC, 368, 12, 50)}" fill="none" stroke="#a31313" stroke-width="30"/>`;
    for (let i = 0; i < 8; i++) {
      const [x, y] = pol(MC, 366, 183 + i * 31.3);
      s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="20" fill="#fdfdfd"/>`;
    }
    s += `
      <path d="M1000 580 L1038 505 L1076 580 Z" fill="#fdfdfd"/>
      <text id="spdCard" x="1148" y="580" font-family="'Exo 2', Arial, sans-serif" font-style="italic" font-weight="700" font-size="124" fill="#fdfdfd">N</text>
      <text id="spdNum" x="1230" y="750" text-anchor="end" font-family="'Exo 2', Arial, sans-serif" font-style="italic" font-weight="700" font-size="168"
            fill="#f4f4f4" stroke="#0d0d0d" stroke-width="6" paint-order="stroke" letter-spacing="-4">000</text>
      <text id="spdUnit" x="1106" y="842" text-anchor="middle" font-family="Arial, Roboto, sans-serif" font-weight="700" font-style="normal" font-size="64" fill="#e6e6e6">KM/H</text>
      <g id="needle"><path d="M-15 -176 A15 15 0 0 0 15 -176 L4.5 -392 L-4.5 -392 Z" fill="url(#needleFill)" stroke="#111" stroke-width="5" stroke-linejoin="round"/></g>`;

    // Mostrador pequeno (na frente)
    s += dial(SC, 218, 202, 190, 'clipSmall');
    s += `<g clip-path="url(#clipSmall)">
      ${flames([[200, 910, 40, 250, 690, -34], [250, 900, 48, 380, 690, -44], [320, 900, 40, 470, 770, -34]], '#5b5b5b')}
      ${flames([[270, 930, 28, 350, 770, -24], [340, 960, 26, 460, 860, -20]], '#353535')}
    </g>`;
    s += `<path d="${arc(SC, 158, 12, 52)}" fill="none" stroke="#a31313" stroke-width="30"/>`;
    s += `<path d="${arc(SC, 158, 178, 214)}" fill="none" stroke="#a31313" stroke-width="30"/>`;
    [4, 35, 329, 294, 260, 232, 206].forEach(a => {
      const [x, y] = pol(SC, 160, a);
      s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="15" fill="#fdfdfd"/>`;
    });
    s += `<g id="boost"><path d="M-12 36 A12 12 0 0 0 12 36 L4 -158 L-4 -158 Z" fill="url(#needleFill)" stroke="#111" stroke-width="5" stroke-linejoin="round"/></g>`;
    svg.innerHTML = s;
  }
  build();

  const needle = $('needle'), boost = $('boost'), num = $('spdNum'), unit = $('spdUnit'), card = $('spdCard');
  const CARD = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'];
  const MAX = { kmh: 240, mph: 150 };
  // Ponteiro parado aponta logo depois do primeiro ponto (como na imagem) e vai até o último ponto
  const REST = 203, END = 42 + 360;
  let shown = 0, prevShown = 0, accel = 0, units = 'kmh';
  const last = { needle: null, boost: null, num: '', card: '' };

  function applyUnits() {
    units = settings.units === 'mph' ? 'mph' : 'kmh';
    unit.textContent = units === 'mph' ? 'MPH' : 'KM/H';
  }
  const SIZES = { P: 26, M: 34, G: 42 };
  function applyLook() {
    const el = $('speedo');
    el.hidden = !settings.showSpeedo;
    el.style.setProperty('--speedo-h', SIZES[settings.speedoSize] || SIZES.P);
  }
  applyUnits(); applyLook();
  App.onSetting(k => { if (k === 'units') applyUnits(); if (k === 'showSpeedo' || k === 'speedoSize') applyLook(); });

  App.on('frame', step => {
    if (!settings.showSpeedo) return;
    const target = units === 'mph' ? S.speedKmh / 1.609 : S.speedKmh;
    prevShown = shown;
    shown += (target - shown) * (1 - Math.exp(-step * 6));
    const g = ((shown - prevShown) / (units === 'mph' ? 2.237 : 3.6)) / Math.max(step, .001) / 4;   // ≈ aceleração em g
    accel += (clamp(g, -1, 1) - accel) * (1 - Math.exp(-step * 3));

    // Só mexe no SVG quando algo muda de verdade (economiza processamento no celular/central)
    const na = +(REST + clamp(shown / MAX[units], 0, 1) * (END - REST)).toFixed(1);
    if (na !== last.needle) { needle.setAttribute('transform', `translate(${MC[0]} ${MC[1]}) rotate(${na})`); last.needle = na; }
    const ba = +(296 + (accel > 0 ? accel * 99 : accel * 90)).toFixed(1);
    if (ba !== last.boost) { boost.setAttribute('transform', `translate(${SC[0]} ${SC[1]}) rotate(${ba})`); last.boost = ba; }
    const n = String(Math.min(999, Math.round(shown))).padStart(3, '0');
    if (n !== last.num) { num.textContent = n; last.num = n; }
    const c = CARD[Math.round((((S.heading % 360) + 360) % 360) / 45) % 8];
    if (c !== last.card) { card.textContent = c; last.card = c; }
  });
})();
