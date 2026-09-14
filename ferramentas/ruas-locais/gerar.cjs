// Gera a base de ruas local de um município para o app (nome de rua preciso).
//
//   node ferramentas/ruas-locais/gerar.cjs 2920502 "Maracás" -13.475 -40.470 -13.405 -40.395
//                                          código IBGE  nome     sul     oeste   norte   leste
//
// Fontes:
//  - Traçado das ruas: OpenStreetMap (Overpass API), sem simplificação.
//  - Nomes: OpenStreetMap + CNEFE do IBGE (endereços do Censo 2022 com coordenadas).
//    Para cada trecho de rua, conta os endereços do CNEFE ao longo dele (fora das esquinas).
//    Se muitos endereços concordam num nome, ele é usado (corrige nomes desatualizados/digitados errado no OSM
//    e preenche ruas sem nome). Se o CNEFE não é claro, fica o nome do OSM. Sem nome em nenhum: "sem nome".
// Saída: nfsu2-radar/web/data/ruas/<código>.json e atualiza data/ruas/index.json
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const SM = require('../../nfsu2-radar/web/js/streetmatch.js');

const [codigo, cidade, S_, W_, N_, E_] = process.argv.slice(2);
if (!codigo || !cidade || !E_) {
  console.log('uso: node gerar.cjs <códigoIBGE> "<Cidade>" <sul> <oeste> <norte> <leste>');
  process.exit(1);
}
const bbox = [+S_, +W_, +N_, +E_];
const ROOT = path.resolve(__dirname, '../..');
const OUT_DIR = path.join(ROOT, 'nfsu2-radar/web/data/ruas');
const CACHE = path.join(__dirname, 'cache');
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(CACHE, { recursive: true });

const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const TIPOS = /^(RUA|AVENIDA|AV|TRAVESSA|TV|PRACA|ALAMEDA|RODOVIA|ESTRADA|LADEIRA|BECO|VIA|LOTEAMENTO|CONJUNTO|VILA|LARGO|PASSAGEM|VIELA)\s+/;
const semTipo = k => k.replace(TIPOS, '');

// ---------- Downloads ----------
async function overpass() {
  const file = path.join(CACHE, `osm-${codigo}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const q = `[out:json][timeout:90];way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|road|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"](${bbox.join(',')});out tags geom;`;
  for (const ep of ['https://overpass.kumi.systems/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter']) {
    try {
      const r = await fetch(ep, { method: 'POST', body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(120000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'RadarNFSU2-gerador' } });
      if (!r.ok) { console.log('Overpass', ep, r.status); continue; }
      const j = await r.json();
      fs.writeFileSync(file, JSON.stringify(j));
      return j;
    } catch (e) { console.log('Overpass', ep, e.message); }
  }
  throw new Error('Overpass indisponível, tente mais tarde');
}

async function cnefe() {
  const file = path.join(CACHE, `cnefe-${codigo}.csv`);
  if (!fs.existsSync(file)) {
    const uf = codigo.slice(0, 2);
    const ufDir = { 11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO', 21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA', 31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP', 41: 'PR', 42: 'SC', 43: 'RS', 50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF' }[uf];
    const base = `https://ftp.ibge.gov.br/Cadastro_Nacional_de_Enderecos_para_Fins_Estatisticos/Censo_Demografico_2022/Arquivos_CNEFE/CSV/Municipio/${uf}_${ufDir}/`;
    const listing = await (await fetch(base)).text();
    const zipName = (listing.match(new RegExp(`${codigo}_[A-Z_]+\\.zip`)) || [])[0];
    if (!zipName) throw new Error('CNEFE do município não encontrado');
    const zip = Buffer.from(await (await fetch(base + zipName)).arrayBuffer());
    fs.writeFileSync(file, unzipFirst(zip));
  }
  const csv = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const head = csv[0].split(';'), ix = k => head.indexOf(k);
  const iT = ix('NOM_TIPO_SEGLOGR'), iTi = ix('NOM_TITULO_SEGLOGR'), iN = ix('NOM_SEGLOGR'), iLa = ix('LATITUDE'), iLo = ix('LONGITUDE'), iNv = ix('NV_GEO_COORD');
  const pts = [];
  for (let i = 1; i < csv.length; i++) {
    const c = csv[i].split(';');
    if (c.length < head.length || !c[iN]) continue;
    const nv = +c[iNv];
    if (!(nv >= 1 && nv <= 3)) continue;               // só coordenadas do próprio endereço ou muito próximas
    pts.push({ lat: +c[iLa], lng: +c[iLo], nome: [c[iT], c[iTi], c[iN]].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(),
               chave: norm([c[iT], c[iN]].join(' ')) });
  }
  return pts;
}

// Descompacta o primeiro arquivo de um .zip (formato simples, compressão deflate)
function unzipFirst(buf) {
  const sig = buf.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  const method = buf.readUInt16LE(sig + 8), csize = buf.readUInt32LE(sig + 18);
  const nlen = buf.readUInt16LE(sig + 26), xlen = buf.readUInt16LE(sig + 28);
  const start = sig + 30 + nlen + xlen;
  let data = buf.subarray(start, csize ? start + csize : undefined);
  if (!csize) {   // tamanho só no diretório central
    const cd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    data = buf.subarray(start, start + buf.readUInt32LE(cd + 20));
  }
  return method === 8 ? zlib.inflateRawSync(data) : data;
}

// ---------- Nomes bonitos (título + acentos) ----------
const PEQUENAS = new Set(['DE', 'DA', 'DO', 'DOS', 'DAS', 'E', 'EM']);
const ACENTOS = { JOAO: 'João', JOSE: 'José', ANTONIO: 'Antônio', SAO: 'São', CONCEICAO: 'Conceição', LUIS: 'Luís', PRACA: 'Praça',
  ALVARO: 'Álvaro', SEBASTIAO: 'Sebastião', ESTEVAO: 'Estêvão', GONCALVES: 'Gonçalves', LUCIA: 'Lúcia', LUCIO: 'Lúcio', JULIO: 'Júlio',
  VITORIA: 'Vitória', GLORIA: 'Glória', GETULIO: 'Getúlio', ELPIDIO: 'Elpídio', ANGELO: 'Ângelo', IRMA: 'Irmã', OTAVIO: 'Otávio',
  FABIO: 'Fábio', CICERO: 'Cícero', VALERIO: 'Valério', GENESIO: 'Genésio', ANESIO: 'Anésio', ROMAO: 'Romão', ADAO: 'Adão',
  SIMAO: 'Simão', ASSUNCAO: 'Assunção', ANUNCIACAO: 'Anunciação', LIBERDADE: 'Liberdade', INDEPENDENCIA: 'Independência',
  REPUBLICA: 'República', BRASILIA: 'Brasília', BAHIA: 'Bahia', MARACAS: 'Maracás', AMELIA: 'Amélia', OTILIA: 'Otília',
  EMILIA: 'Emília', CECILIA: 'Cecília', LIDIA: 'Lídia', VERONICA: 'Verônica', MONICA: 'Mônica', MARCIO: 'Márcio', SERGIO: 'Sérgio',
  ROGERIO: 'Rogério', MAURICIO: 'Maurício', PLACIDO: 'Plácido', BENEDITO: 'Benedito', HELIO: 'Hélio', LAZARO: 'Lázaro',
  AGUIDA: 'Águida', ANA: 'Ana', MAE: 'Mãe', JARDIM: 'Jardim', PRIMAVERA: 'Primavera', ESPERANCA: 'Esperança', FATIMA: 'Fátima',
  SAUDE: 'Saúde', CAMPO: 'Campo', VIRGINIA: 'Virgínia', ELOI: 'Elói', ELOY: 'Eloy', NOVAES: 'Novaes', CRUZEIRO: 'Cruzeiro',
  TRIANGULO: 'Triângulo', AGRICOLA: 'Agrícola', INDUSTRIA: 'Indústria', COMERCIO: 'Comércio', ESTACAO: 'Estação', PORTAO: 'Portão',
  BARAO: 'Barão', GERONIMO: 'Gerônimo', ALCEBIADES: 'Alcebíades', ARISTIDES: 'Aristides', CANDIDO: 'Cândido', ELISIO: 'Elísio',
  EUCLIDES: 'Euclides', HERCULES: 'Hércules', IRINEU: 'Irineu', JERONIMO: 'Jerônimo', LEONIDIO: 'Leonídio', MARIO: 'Mário',
  NILO: 'Nilo', OTACILIO: 'Otacílio', PAULO: 'Paulo', ROMULO: 'Rômulo', TEOFILO: 'Teófilo', VIRGILIO: 'Virgílio', ZELIA: 'Zélia',
  ACACIO: 'Acácio', ANISIO: 'Anísio', ATAIDE: 'Ataíde', CESAR: 'César', DAMIAO: 'Damião', GALDINO: 'Galdino', HIPOLITO: 'Hipólito',
  INACIO: 'Inácio', JOAQUIM: 'Joaquim', LAURINDO: 'Laurindo', LEOPOLDINA: 'Leopoldina', MONTEIRO: 'Monteiro', NATALIA: 'Natália',
  PATRICIA: 'Patrícia', SILVERIO: 'Silvério', TANCREDO: 'Tancredo', URBANO: 'Urbano', VALERIA: 'Valéria', JUSTICA: 'Justiça',
  IGUALDADE: 'Igualdade', GRACA: 'Graça', GRACAS: 'Graças', MAGALHAES: 'Magalhães', GUIMARAES: 'Guimarães', ESPIRITO: 'Espírito',
  PEDRAO: 'Pedrão', FUNDACAO: 'Fundação', INDIO: 'Índio', IRAMAIA: 'Iramaia', JEQUIE: 'Jequié', ITIRUCU: 'Itiruçu' };
function bonito(nome, dicionario) {
  return norm(nome).split(' ').map((w, i) => {
    if (/^\d+$/.test(w) || /^[IVX]+$/.test(w) && w.length <= 4) return w;
    if (i > 0 && PEQUENAS.has(w)) return w.toLowerCase();
    if (dicionario[w]) return dicionario[w];
    if (ACENTOS[w]) return ACENTOS[w];
    return w.charAt(0) + w.slice(1).toLowerCase();
  }).join(' ').replace(/^Av /, 'Avenida ').replace(/^Tv /, 'Travessa ');
}

// Remove alternativas e sobras ("RUA X OU RUA 02", "... OU RU") do nome do CNEFE
const limpar = s => (s || '').replace(/\s+OU\s+.*$/i, '').replace(/\s+/g, ' ').trim();

// Mesma rua escrita de outro jeito (erro de digitação, acento, abreviação ou nome mais completo)
function parecido(a, b) {
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  if (1 - d[m][n] / Math.max(m, n) >= .8) return true;
  // mesma primeira e última palavra (ex.: "ELIEZER CERQUEIRA MENDES" × "ELIEZER C MENDES")
  const wa = a.split(' '), wb = b.split(' ');
  return wa[0] === wb[0] && wa[wa.length - 1] === wb[wb.length - 1];
}

// ---------- Endereços ao longo de um trecho ----------
function enderecosAoLongo(coords, pts, grid, maxD = 30) {
  const out = [];
  const seen = new Set();
  for (const [x, y] of coords) {
    const k = cell(x, y);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const p of grid.get(`${k[0] + dx},${k[1] + dy}`) || []) {
        if (seen.has(p)) continue;
        seen.add(p);
        let best = null;
        for (let i = 1; i < coords.length; i++) {
          const s = SM.segInfo(p, coords[i - 1], coords[i]);
          const along = s.t * s.len;
          if (along < 12 || s.len - along < 12) continue;       // perto da esquina: pode ser da rua transversal
          if (!best || s.d < best.d) best = s;
        }
        if (best && best.d <= maxD) out.push({ ...p, d: best.d });
      }
    }
  }
  return out;
}
const CELL = 0.0006;   // ~65 m
const cell = (x, y) => [Math.floor(x / CELL), Math.floor(y / CELL)];

function votar(ends) {
  const soma = {};
  for (const a of ends) {
    const k = a.chave;
    const v = soma[k] || (soma[k] = { peso: 0, n: 0, grafias: {} });
    v.peso += 1 / (1 + a.d / 12); v.n++; v.grafias[a.nome] = (v.grafias[a.nome] || 0) + 1;
  }
  const lista = Object.entries(soma).sort((a, b) => b[1].peso - a[1].peso);
  if (!lista.length) return null;
  const total = lista.reduce((s, [, v]) => s + v.peso, 0);
  const [chave, v] = lista[0];
  return { chave, nome: Object.entries(v.grafias).sort((a, b) => b[1] - a[1])[0][0], share: v.peso / total, n: v.n };
}

const CLASSE = h => ({ residential: 'minor', living_street: 'minor', unclassified: 'minor', road: 'minor', service: 'service' }[h]
  || h.replace('_link', ''));

(async () => {
  const osm = await overpass();
  const pts = await cnefe();
  const grid = new Map();
  for (const p of pts) { const k = cell(p.lng, p.lat).join(','); (grid.get(k) || grid.set(k, []).get(k)).push(p); }
  // dicionário de acentos a partir dos nomes do próprio OSM da cidade
  const dic = {};
  for (const w of osm.elements) if (w.tags && w.tags.name) for (const word of w.tags.name.split(/\s+/)) {
    const k = norm(word); if (k && /[^\x00-\x7f]/.test(word)) dic[k] = word.charAt(0).toUpperCase() + word.slice(1);
  }

  const stats = { vias: 0, osm: 0, ibgePreencheu: 0, semNome: 0 };
  const nomesOsm = [...new Set(osm.elements.filter(w => w.tags && w.tags.name && w.tags.highway).map(w => w.tags.name))];
  const conflitos = [];
  const ways = [];
  for (const w of osm.elements) {
    if (w.type !== 'way' || !w.geometry) continue;
    const coords = w.geometry.map(n => [+n.lon.toFixed(6), +n.lat.toFixed(6)]);
    const osmNome = w.tags.name || '';
    const v = votar(enderecosAoLongo(coords, pts, grid));
    let ibge = v ? limpar(v.nome) : '';
    // nomes que no CNEFE descrevem a localidade/loteamento e não a rua
    if (!ibge || /SEM DENOMINACAO|SEM NOME|PROJETADA|CASAS POPULARES|LOTEAMENTO|CONJUNTO|CONDOMINIO|FAZENDA|SITIO|POVOADO|^RODOVIA /.test(norm(ibge))) ibge = '';
    let nome = osmNome, fonte = osmNome ? 'osm' : '', alt = '';
    if (ibge) {
      const igual = osmNome && parecido(semTipo(norm(osmNome)), semTipo(norm(ibge)));
      if (!osmNome && v.n >= 3 && v.share >= .6) {
        // se a mesma rua já aparece com nome no OSM (outro trecho), usa exatamente aquela grafia
        const k = semTipo(norm(ibge));
        const igualOsm = nomesOsm.find(n => parecido(semTipo(norm(n)), k));
        nome = igualOsm || bonito(ibge, dic); fonte = 'ibge'; stats.ibgePreencheu++;
      }
      else if (osmNome && !igual && v.n >= 8 && v.share >= .8) {
        // conflito real: mantém o OSM e guarda a sugestão do IBGE para o usuário decidir no app
        alt = bonito(ibge, dic);
        conflitos.push({ via: w.id, osm: osmNome, ibge: alt, enderecos: v.n, concordancia: Math.round(v.share * 100) });
      }
    }
    if (!nome) stats.semNome++; else if (fonte === 'osm') stats.osm++;
    stats.vias++;
    const way = { id: w.id, n: nome, f: fonte, c: CLASSE(w.tags.highway), t: w.tags.tunnel === 'yes' ? 1 : 0, g: coords };
    if (alt) way.a = alt;
    ways.push(way);
  }

  const out = { cidade, codigo, bbox: [bbox[1], bbox[0], bbox[3], bbox[2]], gerado: new Date().toISOString().slice(0, 10),
    fontes: '© OpenStreetMap (ODbL) · IBGE CNEFE Censo 2022', ways };
  fs.writeFileSync(path.join(OUT_DIR, `${codigo}.json`), JSON.stringify(out));
  const idxFile = path.join(OUT_DIR, 'index.json');
  const idx = fs.existsSync(idxFile) ? JSON.parse(fs.readFileSync(idxFile, 'utf8')) : [];
  const entry = { codigo, cidade, bbox: out.bbox, arquivo: `${codigo}.json`, gerado: out.gerado };
  fs.writeFileSync(idxFile, JSON.stringify([...idx.filter(e => e.codigo !== codigo), entry], null, 1));
  fs.writeFileSync(path.join(__dirname, `conflitos-${codigo}.json`), JSON.stringify(conflitos, null, 1));
  console.log(cidade, stats, `→ ${(fs.statSync(path.join(OUT_DIR, `${codigo}.json`)).size / 1024).toFixed(0)} KB`);
  console.log(`${conflitos.length} ruas em que o IBGE corrigiu o nome do OSM (lista em conflitos-${codigo}.json)`);
})().catch(e => { console.error(e); process.exit(1); });
