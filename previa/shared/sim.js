// Núcleo compartilhado entre servidor e navegador: tanques em voxels, blindagem, balística e dano.
// Portado do Banco de Provas. O servidor roda o dano de verdade; o navegador usa o mesmo modelo
// para desenhar e para a análise de mira (tiro "seco", que não muda nada).
(function (root, f) { if (typeof module === 'object' && module.exports) module.exports = f(); else root.SIM = f(); })(typeof self !== 'undefined' ? self : this, function () {
'use strict';
const VS = 0.1, D2R = Math.PI / 180, G = 9.81;
const rnd = Math.random, clamp = (v, a, b) => v < a ? a : v > b ? b : v, lerp = (a, b, t) => a + (b - a) * t;
const r2 = v => Math.round(v * 100) / 100;
function nrm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
function hash(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function vnoise(x, y) { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return lerp(lerp(hash(xi, yi), hash(xi + 1, yi), u), lerp(hash(xi, yi + 1), hash(xi + 1, yi + 1), u), v); }

// ================================================================ formas
function P(nx, ny, nz, d, plate, internal) { const l = Math.hypot(nx, ny, nz); const n = [nx / l, ny / l, nz / l]; d /= l;
  return { m: p => d - (n[0] * p[0] + n[1] * p[1] + n[2] * p[2]), nm: () => n, plate, internal: !!internal }; }
function CYL(cx, cy, R, plate) { return { m: p => R - Math.hypot(p[0] - cx, p[1] - cy), nm: p => nrm([p[0] - cx, p[1] - cy, 0]), plate, internal: false }; }
function CONE(cx, cy, R, z0, k, plate) { return { m: p => R - k * Math.max(0, p[2] - z0) - Math.hypot(p[0] - cx, p[1] - cy),
  nm: p => { const dx = p[0] - cx, dy = p[1] - cy, r = Math.hypot(dx, dy) || 1; return nrm([dx / r, dy / r, p[2] > z0 ? k : 0.09]); }, plate, internal: false }; }
function inStar(u, v, R) { const pts = []; for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? R * 0.4 : R; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
  let ins = false; for (let i = 0, j = 9; i < 10; j = i++) { const a = pts[i], b = pts[j]; if ((a[1] > v) !== (b[1] > v) && u < (b[0] - a[0]) * (v - a[1]) / (b[1] - a[1]) + a[0]) ins = !ins; } return ins; }
const CAT = {
  crew: { c: [70, 200, 215], n: 'Tripulante' }, ammo: { c: [235, 190, 60], n: 'Munição' }, fuel: { c: [215, 70, 50], n: 'Combustível' },
  engine: { c: [230, 130, 50], n: 'Motor' }, trans: { c: [165, 120, 220], n: 'Transmissão' }, gun: { c: [170, 190, 205], n: 'Canhão / culatra' },
  track: { c: [120, 120, 110], n: 'Esteira / rodas' }, misc: { c: [110, 190, 110], n: 'Rádio, mira, MG, anel' }
};

// ================================================================ tanques
// Coordenadas locais em metros: x para a frente, y para a esquerda, z para cima. Torre: origem no centro do anel.
// O bloco "game" guarda os números de jogo: mobilidade, canhão, munições, racks e postos.
const TANKS = {};

TANKS.pz4 = { key: 'pz4', name: 'Pz.Kpfw. IV Ausf. F2', short: 'Panzer IV F2', sub: 'Sd.Kfz. 161/1 · 1942', menu: 'Panzer IV Ausf. F2 (Alemanha)',
  color: [76, 82, 86], crewCol: [40, 42, 48], jit: 7,
  plates: {
    1: { n: 'Frente inferior (nariz)', t: 50 }, 2: { n: 'Glacis', t: 20 }, 3: { n: 'Frente superior (motorista)', t: 50 },
    4: { n: 'Lateral inferior do casco', t: 30 }, 5: { n: 'Lateral da superestrutura', t: 30 }, 6: { n: 'Traseira do casco', t: 20 },
    7: { n: 'Teto do casco', t: 11 }, 8: { n: 'Fundo', t: 10 }, 9: { n: 'Piso do sponson', t: 10 }, 10: { n: 'Parede corta-fogo', t: 6 },
    11: { n: 'Frente da torre', t: 50 }, 12: { n: 'Mantelete', t: 50 }, 13: { n: 'Lateral da torre', t: 30 }, 14: { n: 'Traseira da torre', t: 30 },
    15: { n: 'Teto da torre', t: 10 }, 16: { n: 'Cúpula do comandante', t: 50 }, 17: { n: 'Canto frontal da torre', t: 30 }, 18: { n: 'Escotilha da cúpula', t: 12 },
    19: { n: 'Para-lama', t: 3 } },
  hull: [-3.1, -1.5, 0, 62, 30, 18], tur: [-1.2, -1.0, 0.6, 48, 20, 21],
  hullShapes: [
    [P(0, 1, 0, 0.95, 4), P(0, -1, 0, 0.95, 4), P(0, 0, -1, -0.40, 8), P(0, 0, 1, 1.15, 7, true), P(1, 0, -0.21, 2.636, 1), P(1, 0, 3.077, 5.763, 2), P(-1, 0, -0.16, 2.686, 6)],
    [P(0, 1, 0, 1.22, 5), P(0, -1, 0, 1.22, 5), P(0, 0, -1, -1.05, 9), P(0, 0, 1, 1.70, 7), P(1, 0, 0.158, 2.407, 3), P(-1, 0, -0.16, 2.686, 6)]],
  turShapes: [
    [P(0, 0, -1, -1.70, 0, true), P(0, 0, 1, 2.38, 15), P(0, 1, 0.466, 1.712, 13), P(0, -1, 0.466, 1.712, 13), P(1, 0, 0.176, 1.149, 11), P(-1, 0, 0.268, 1.506, 14), P(0.45, 0.89, 0, 0.934, 17), P(0.45, -0.89, 0, 0.934, 17)],
    [CYL(-0.62, 0, 0.40, 16), P(0, 0, 1, 2.60, 18), P(0, 0, -1, -2.30, 0, true)],
    [P(1, 0, 0, 1.06, 12), P(-1, 0, 0, -0.74, 0, true), P(0, 1, 0, 0.30, 12), P(0, -1, 0, 0.30, 12), P(0, 0, 1, 2.20, 12), P(0, 0, -1, -1.82, 12)]],
  ring: [0.15, 0.05], piv: [0, 0, 2.0], ringZ: 1.7, ringHole: 0.86, ringR: [0.72, 0.86], firewall: -1.45, roofPlates: [7],
  barrel: { x0: 1.06, x1: 3.5, z: 2.0, r: 0.1, col: [70, 76, 80], brake: { x0: 3.25, x1: 3.5, r: 0.16 } },
  track: { wheelX: [-1.6, -1.12, -0.68, -0.2, 0.24, 0.72, 1.16, 1.64], wz: 0.315, wr: 0.235, sprocket: [2.55, 0.60, 0.30], idler: [-2.72, 0.55, 0.27],
    ret: [-1.35, -0.45, 0.45, 1.35], rz: 0.80, rr: 0.075, ty: [0.97, 1.40], wy: [1.02, 1.36], ry: [1.1, 1.3], bogie: { w: 0.3, y: [0.95, 1.02], z: [0.36, 0.5] },
    col: [[66, 60, 54], [50, 46, 42]], wheelCol: [72, 78, 82] },
  fenders: { y: [1.22, 1.45], z: 1.05, x: [-2.9, 2.75] },
  deco: [{ box: [[-0.6, 0.3], [-1.44, -1.24], [1.1, 1.2]], col: [64, 58, 48] }, { box: [[2.2, 2.4], [1.28, 1.4], [1.1, 1.2]], col: [30, 30, 30] }],
  mods: [
    { key: 'driver', name: 'Motorista', kind: 'crew', g: 'h', max: 100, abs: 4, box: [[1.5, 1.95], [0.35, 0.8], [0.5, 1.5]], head: 1.3 },
    { key: 'radio_op', name: 'Rádio-operador', kind: 'crew', g: 'h', max: 100, abs: 4, box: [[1.5, 1.95], [-0.8, -0.35], [0.5, 1.5]], head: 1.3 },
    { key: 'gunner', name: 'Atirador', kind: 'crew', g: 't', max: 100, abs: 4, box: [[0.05, 0.5], [0.3, 0.72], [1.05, 1.95]], head: 1.75 },
    { key: 'loader', name: 'Municiador', kind: 'crew', g: 't', max: 100, abs: 4, box: [[-0.35, 0.1], [-0.7, -0.3], [0.75, 1.9]], head: 1.7 },
    { key: 'commander', name: 'Comandante', kind: 'crew', g: 't', max: 100, abs: 4, box: [[-0.85, -0.42], [-0.22, 0.22], [1.25, 2.38]], head: 2.15 },
    { key: 'engine', name: 'Motor Maybach HL 120', kind: 'engine', eng: true, g: 'h', max: 160, abs: 45, box: [[-2.7, -1.55], [-0.42, 0.42], [0.48, 1.25]], fireP: 0.15 },
    { key: 'radiator', name: 'Radiadores', kind: 'engine', eng: true, g: 'h', max: 60, abs: 10, box: [[-2.55, -1.65], [0.5, 0.92], [0.55, 1.5]] },
    { key: 'fans', name: 'Ventiladores', kind: 'engine', eng: true, g: 'h', max: 60, abs: 10, box: [[-2.55, -1.65], [-0.92, -0.5], [0.85, 1.45]] },
    { key: 'trans', name: 'Câmbio ZF SSG 76', kind: 'trans', g: 'h', max: 150, abs: 45, box: [[1.55, 2.35], [-0.32, 0.32], [0.45, 1.0]] },
    { key: 'fdL', name: 'Redução final esq.', kind: 'trans', g: 'h', max: 80, abs: 30, box: [[2.3, 2.66], [0.6, 0.94], [0.45, 0.82]] },
    { key: 'fdR', name: 'Redução final dir.', kind: 'trans', g: 'h', max: 80, abs: 30, box: [[2.3, 2.66], [-0.94, -0.6], [0.45, 0.82]] },
    { key: 'fuelA', name: 'Combustível 140 L', kind: 'fuel', g: 'h', max: 70, abs: 12, box: [[-1.35, -0.7], [0.15, 0.88], [0.42, 0.68]], fireP: 0.45 },
    { key: 'fuelB', name: 'Combustível 110 L', kind: 'fuel', g: 'h', max: 70, abs: 12, box: [[-1.35, -0.7], [-0.88, -0.15], [0.42, 0.68]], fireP: 0.45 },
    { key: 'fuelC', name: 'Combustível 220 L', kind: 'fuel', g: 'h', max: 90, abs: 12, box: [[-0.6, 0.85], [-0.88, 0.88], [0.42, 0.66]], fireP: 0.45 },
    { key: 'shaft', name: 'Eixo cardã', kind: 'trans', g: 'h', max: 50, abs: 10, box: [[-1.55, 1.55], [-0.1, 0.0], [0.62, 0.72]] },
    { key: 'dkw', name: 'Gerador do giro (DKW)', kind: 'misc', g: 'h', max: 50, abs: 10, box: [[-1.35, -0.95], [0.5, 0.9], [0.7, 1.05]], fireP: 0.1 },
    { key: 'ammoL', name: 'Munição sponson esq.', cap: 24, kind: 'ammo', g: 'h', max: 40, abs: 10, box: [[-1.3, 0.9], [0.96, 1.18], [1.1, 1.5]] },
    { key: 'ammoR', name: 'Munição sponson dir.', cap: 24, kind: 'ammo', g: 'h', max: 40, abs: 10, box: [[-1.3, 1.1], [-1.18, -0.96], [1.1, 1.5]] },
    { key: 'ammoFL', name: 'Munição piso esq.', cap: 20, kind: 'ammo', g: 'h', max: 40, abs: 10, box: [[0.95, 1.45], [0.15, 0.85], [0.42, 0.9]] },
    { key: 'ammoFR', name: 'Munição piso dir.', cap: 19, kind: 'ammo', g: 'h', max: 40, abs: 10, box: [[0.95, 1.45], [-0.85, -0.15], [0.42, 0.9]] },
    { key: 'radio', name: 'Rádio Fu 5', kind: 'misc', g: 'h', max: 30, abs: 5, box: [[1.15, 1.6], [-1.18, -0.96], [1.1, 1.5]] },
    { key: 'bowmg', name: 'MG 34 do casco', kind: 'misc', g: 'h', max: 30, abs: 5, box: [[1.95, 2.32], [-0.62, -0.48], [1.38, 1.48]] },
    { key: 'breech', name: 'Culatra do KwK 40', kind: 'gun', g: 't', max: 120, abs: 60, box: [[-0.3, 0.74], [-0.17, 0.17], [1.88, 2.12]] },
    { key: 'guard', name: 'Guarda de recuo', kind: 'gun', g: 't', max: 60, abs: 15, box: [[-0.65, -0.3], [-0.15, 0.15], [1.9, 2.08]] },
    { key: 'sight', name: 'Mira TZF 5f', kind: 'misc', g: 't', max: 25, abs: 5, box: [[0.35, 0.78], [0.19, 0.29], [1.98, 2.08]] },
    { key: 'coax', name: 'MG 34 coaxial', kind: 'misc', g: 't', max: 30, abs: 5, box: [[0.2, 0.78], [-0.31, -0.21], [1.93, 2.03]] },
    { key: 'ring', name: 'Anel da torre', kind: 'misc', g: 't', max: 80, abs: 20, ring: true },
    { key: 'barrel', name: 'Cano L/43', kind: 'gun', g: 't', max: 70, abs: 25, barrel: true, ext: true },
    { key: 'trackL', name: 'Esteira esquerda', kind: 'track', g: 'h', max: 100, abs: 20, side: 1, track: true, ext: true },
    { key: 'trackR', name: 'Esteira direita', kind: 'track', g: 'h', max: 100, abs: 20, side: -1, track: true, ext: true },
    { key: 'wheelsL', name: 'Rodas esquerda', kind: 'track', g: 'h', max: 160, abs: 25, side: 1, wheels: true, ext: true },
    { key: 'wheelsR', name: 'Rodas direita', kind: 'track', g: 'h', max: 160, abs: 25, side: -1, wheels: true, ext: true },
    { key: 'exhaust', name: 'Escapamento', kind: 'misc', eng: true, g: 'h', max: 40, abs: 5, box: [[-3.05, -2.82], [-0.7, 0.1], [0.62, 0.9]], ext: true, col: [96, 70, 52] }],
  vents: { fight: [[1.78, 0.55, 1.72], [1.78, -0.55, 1.72]], eng: [[-2.0, 0.5, 1.68], [-2.0, -0.5, 1.68], [-2.3, 0, 1.68]], tur: [[-0.62, 0, 2.62], [-0.1, 0.9, 2.05], [-0.1, -0.9, 2.05]] },
  turBox: { x: [-1.05, 0.85, 3.5], y: [-0.9, 0.9], z: [1.7, 2.6] },
  antenna: { on: 'h', a: [0.95, -1.17, 1.7], b: [0.95, -1.17, 3.7] },
  game: {
    country: 'Alemanha', flag: 'de', year: 1942, weight: 23.6, hp: 300, len: 5.9, wid: 2.88,
    vmax: 40 / 3.6, vrev: 9 / 3.6, acc: 1.6, turn: 32, trav: 14, elev: [-8, 20], reload: 7.0, view: 450,
    gun: '7,5 cm KwK 40 L/43', cal: 75, disp: 0.0009, moveDisp: 0.006,
    ammo: [
      { k: 'PzGr 39', t: 'APCBC', v: 740, pen: [135, 123, 110], fill: 18, def: 50, d: 'Perfurante com coifa e explosivo. Penetra e explode dentro.' },
      { k: 'PzGr 40', t: 'APCR', v: 920, pen: [159, 143, 126], fill: 0, def: 10, d: 'Núcleo de tungstênio. Penetra muito de perto, ricocheteia fácil.' },
      { k: 'Hl.Gr 38B', t: 'HEAT', v: 450, pen: [80], fill: 510, def: 7, d: 'Carga oca. Mesma penetração a qualquer distância, voo lento.' },
      { k: 'Sprgr 34', t: 'HE', v: 485, pen: [10], fill: 686, def: 20, d: 'Explosivo. Quebra esteiras, canos e casas.' }],
    cap: 87, racks: ['ammoL', 'ammoR', 'ammoFL', 'ammoFR'],
    seats: { driver: 'driver', radio: 'radio_op', gunner: 'gunner', loader: 'loader', commander: 'commander' },
    driveL: ['trackL', 'fdL', 'wheelsL'], driveR: ['trackR', 'fdR', 'wheelsR'], driveBoth: ['trans', 'shaft'],
    traverseMod: 'ring', gunMods: ['breech', 'barrel'], sightMod: 'sight',
    // metralhadoras: cadência (tiros/s), velocidade, fita, munição total, troca de fita (s), arco da do casco (graus)
    mg: { name: 'MG 34', rate: 14, v: 755, belt: 150, coax: 1650, bow: 1500, reload: 7, arc: 15 },
    // fumaça: óleo jogado na descarga quente faz uma cortina atrás do tanque (n vezes, dur segundos cada)
    smoke: { kind: 'exhaust', name: 'Fumaça na descarga', n: 3, dur: 14 }
  },
  ficha: `
      <h3>Blindagem real</h3>
      <div class="tw"><table>
        <thead><tr><th>Placa</th><th>mm</th><th>Inclin.</th><th>Efetiva*</th></tr></thead>
        <tbody>
          <tr><td>Frente superior (placa do motorista)</td><td class="n">50</td><td class="n">9°</td><td class="n">51</td></tr>
          <tr><td>Glacis (entre as duas frentes)</td><td class="n">20</td><td class="n">72°</td><td class="n">65</td></tr>
          <tr><td>Frente inferior (nariz)</td><td class="n">50</td><td class="n">12°</td><td class="n">51</td></tr>
          <tr><td>Laterais do casco e superestrutura</td><td class="n">30</td><td class="n">0°</td><td class="n">30</td></tr>
          <tr><td>Traseira</td><td class="n">20</td><td class="n">10°</td><td class="n">20</td></tr>
          <tr><td>Teto do casco / deck do motor</td><td class="n">11</td><td class="n">90°</td><td class="n">—</td></tr>
          <tr><td>Frente da torre</td><td class="n">50</td><td class="n">11°</td><td class="n">51</td></tr>
          <tr><td>Mantelete do canhão</td><td class="n">50</td><td class="n">0°</td><td class="n">50</td></tr>
          <tr><td>Laterais da torre</td><td class="n">30</td><td class="n">25°</td><td class="n">33</td></tr>
          <tr><td>Traseira da torre</td><td class="n">30</td><td class="n">15°</td><td class="n">31</td></tr>
          <tr><td>Cúpula do comandante</td><td class="n">50</td><td class="n">0°</td><td class="n">50</td></tr>
        </tbody>
      </table></div>
      <p class="note">*Efetiva para um tiro reto. Ausf. F2 (março a julho de 1942), sem as saias Schürzen.</p>
      <h3>Por dentro</h3>
      <p class="note">Motor Maybach HL 120 atrás, separado por parede corta-fogo. Três tanques de combustível (470 L) sob o piso da torre. 87 tiros nos sponsons e no piso, nada na torre. Motorista e rádio-operador na frente, com o câmbio entre eles. Atirador à esquerda do canhão, municiador à direita, comandante atrás sob a cúpula.</p>
      <p class="note">Fontes: Jentz e Doyle, <i>Panzer Tracts 4-2</i>; War Thunder Wiki (blindagem e penetração).</p>`,
  paint(hull, p, pl) {
    if (hull) {
      if (pl === 5 && Math.abs(Math.abs(p[1]) - 1.17) < 0.06 && p[0] > -1.0 && p[0] < -0.4 && p[2] > 1.12 && p[2] < 1.62) {
        const dx = Math.abs(p[0] + 0.7), dz = Math.abs(p[2] - 1.37); const core = (dx < 0.06 && dz < 0.22) || (dz < 0.06 && dx < 0.22); const rim = (dx < 0.16 && dz < 0.25) || (dz < 0.16 && dx < 0.25);
        if (core) return [24, 24, 24]; if (rim && (dx < 0.06 || dz < 0.06 || Math.abs(dx - dz) < 0.1)) return [225, 225, 215]; }
      if (pl === 6 && Math.abs(p[1] - 0.6) < 0.25 && Math.abs(p[2] - 1.37) < 0.22) { const dx = Math.abs(p[1] - 0.6), dz = Math.abs(p[2] - 1.37); if ((dx < 0.06 && dz < 0.2) || (dz < 0.06 && dx < 0.2)) return [24, 24, 24]; if (dx < 0.12 && dz < 0.12) return [225, 225, 215]; }
      if (pl === 3 && Math.abs(p[1] - 0.55) < 0.16 && Math.abs(p[2] - 1.45) < 0.06) return [28, 30, 32];
      if (pl === 2 && Math.abs(p[1]) < 0.85 && (Math.floor((p[1] + 2) / 0.15) % 2 === 0)) return [70, 66, 60];
      if (pl === 7 && p[0] < -1.5) { const inGr = Math.abs(p[1]) > 0.12 && Math.abs(p[1]) < 0.9 && p[0] > -2.6 && p[0] < -1.6; if (inGr && (Math.round(p[0] * 10) % 2 === 0)) return [44, 48, 50]; }
      if (pl === 7 && p[0] > 1.5 && p[0] < 2.05 && Math.abs(Math.abs(p[1]) - 0.55) < 0.27) { if (Math.abs(Math.abs(p[1]) - 0.55) > 0.18 || p[0] < 1.58 || p[0] > 1.98) return [56, 60, 63]; }
    } else {
      if (pl === 13 && p[0] > -0.45 && p[0] < 0.2 && p[2] > 1.8 && p[2] < 2.28) { if (p[0] < -0.37 || p[0] > 0.12 || p[2] < 1.86 || p[2] > 2.22 || Math.abs(p[0] + 0.12) < 0.05) return [54, 58, 61]; }
      if (pl === 16 && Math.abs(p[2] - 2.45) < 0.05) return [30, 32, 34];
      if (pl === 11 && Math.abs(p[1] - 0.45) < 0.1 && Math.abs(p[2] - 2.05) < 0.06) return [28, 30, 32];
      if (pl === 11 && Math.abs(p[1] + 0.5) < 0.08 && Math.abs(p[2] - 2.05) < 0.06) return [28, 30, 32];
    }
    return null; }
};

TANKS.m4a1 = { key: 'm4a1', name: 'M4A1 Sherman', short: 'M4A1 Sherman', sub: 'Medium Tank M4A1 · casco fundido · 1942', menu: 'M4A1 Sherman (EUA)',
  color: [88, 90, 62], crewCol: [92, 88, 62], jit: 12,
  plates: {
    1: { n: 'Nariz (carcaça do diferencial)', t: 76 }, 2: { n: 'Glacis fundido', t: 51 },
    4: { n: 'Lateral inferior do casco', t: 38 }, 5: { n: 'Lateral do sponson', t: 38 }, 6: { n: 'Traseira do casco', t: 38 },
    7: { n: 'Teto do casco', t: 19 }, 8: { n: 'Fundo', t: 13 }, 9: { n: 'Piso do sponson', t: 13 }, 10: { n: 'Parede corta-fogo', t: 6 },
    11: { n: 'Frente da torre', t: 76 }, 12: { n: 'Mantelete M34', t: 89 }, 13: { n: 'Lateral da torre', t: 51 }, 14: { n: 'Traseira da torre', t: 51 },
    15: { n: 'Teto da torre', t: 25 }, 20: { n: 'Deck do motor', t: 13 } },
  hull: [-3.2, -1.4, 0, 59, 28, 19], tur: [-1.3, -1.0, 0.6, 46, 20, 23],
  hullShapes: [
    [P(0, 1, 0, 0.88, 4), P(0, -1, 0, 0.88, 4), P(0, 0, -1, -0.43, 8), P(0, 0, 1, 1.10, 7, true), P(0.866, 0, -0.5, 1.727, 1), P(0.643, 0, 0.766, 2.476, 2), P(-1, 0, -0.18, 2.773, 6)],
    [P(0, 1, 0.118, 1.378, 5), P(0, -1, 0.118, 1.378, 5), P(0, 0, -1, -1.0, 9), P(0, 0, 1, 1.80, 7), P(0.643, 0, 0.766, 2.476, 2), P(-1, 0, -0.18, 2.773, 6)]],
  turShapes: [
    [P(0, 0, -1, -1.80, 0, true), P(0, 0, 1, 2.55, 15), CONE(0, 0, 0.92, 2.3, 1.4, 13), P(0.866, 0, 0.5, 1.575, 11)],
    [P(0, 0, -1, -1.95, 13), P(0, 0, 1, 2.45, 15), P(-1, 0, 0, 1.12, 14), P(0, 1, 0, 0.6, 13), P(0, -1, 0, 0.6, 13), P(1, 0, 0, -0.4, 0, true)],
    [P(1, 0, 0, 0.98, 12), P(-1, 0, 0, -0.6, 0, true), P(0, 1, 0, 0.42, 12), P(0, -1, 0, 0.42, 12), P(0, 0, 1, 2.4, 12), P(0, 0, -1, -1.85, 12)]],
  ring: [0.0, 0.0], piv: [0, 0, 2.1], ringZ: 1.8, ringHole: 0.87, ringR: [0.74, 0.88], firewall: -1.55, roofPlates: [7, 20],
  barrel: { x0: 0.98, x1: 2.95, z: 2.1, r: 0.1, col: [74, 76, 54] },
  track: { wheelX: [-1.56, -1.04, -0.26, 0.26, 1.04, 1.56], wz: 0.334, wr: 0.254, sprocket: [2.32, 0.72, 0.28], idler: [-2.55, 0.40, 0.25],
    ret: [-1.3, 0.0, 1.3], rz: 0.84, rr: 0.08, ty: [0.89, 1.31], wy: [0.95, 1.22], ry: [1.02, 1.18], bogie: { w: 0.16, y: [0.95, 1.2], z: [0.42, 0.78] },
    col: [[52, 50, 46], [38, 37, 35]], wheelCol: [80, 82, 56] },
  fenders: null,
  deco: [{ box: [[-3.1, -2.93], [-0.8, 0.8], [0.85, 1.1]], col: [70, 70, 50], ext: true },
    { box: [[2.3, 2.5], [0.95, 1.0], [1.05, 1.3]], col: [60, 62, 44] }, { box: [[2.3, 2.5], [-1.0, -0.95], [1.05, 1.3]], col: [60, 62, 44] }],
  mods: [
    { key: 'driver', name: 'Motorista', kind: 'crew', g: 'h', max: 100, abs: 4, box: [[1.1, 1.6], [0.3, 0.75], [0.55, 1.65]], head: 1.45 },
    { key: 'codriver', name: 'Copiloto / metralhador', kind: 'crew', g: 'h', max: 100, abs: 4, box: [[1.1, 1.6], [-0.75, -0.3], [0.55, 1.65]], head: 1.45 },
    { key: 'gunner', name: 'Atirador', kind: 'crew', g: 't', max: 100, abs: 4, box: [[0.05, 0.45], [-0.7, -0.3], [1.15, 2.05]], head: 1.85 },
    { key: 'loader', name: 'Municiador', kind: 'crew', g: 't', max: 100, abs: 4, box: [[-0.45, -0.05], [0.3, 0.7], [0.9, 2.0]], head: 1.8 },
    { key: 'commander', name: 'Comandante', kind: 'crew', g: 't', max: 100, abs: 4, box: [[-0.6, -0.22], [-0.6, -0.25], [1.35, 2.38]], head: 2.18 },
    { key: 'engine', name: 'Motor radial Continental R975', kind: 'engine', eng: true, g: 'h', max: 160, abs: 45, box: [[-2.6, -1.7], [-0.56, 0.56], [0.54, 1.66]], inside: p => Math.hypot(p[1], p[2] - 1.1) < 0.56, fireP: 0.15 },
    { key: 'clutch', name: 'Embreagem e ventilador', kind: 'engine', eng: true, g: 'h', max: 60, abs: 15, box: [[-1.7, -1.6], [-0.4, 0.4], [0.7, 1.5]] },
    { key: 'trans', name: 'Câmbio de 5 marchas', kind: 'trans', g: 'h', max: 150, abs: 45, box: [[1.25, 1.95], [-0.28, 0.28], [0.5, 1.05]] },
    { key: 'diff', name: 'Diferencial e redução final', kind: 'trans', g: 'h', max: 140, abs: 40, box: [[1.95, 2.32], [-0.85, 0.85], [0.5, 0.95]] },
    { key: 'shaft', name: 'Eixo cardã', kind: 'trans', g: 'h', max: 50, abs: 10, box: [[-1.55, 1.25], [-0.05, 0.05], [0.75, 0.85]] },
    { key: 'fuelLU', name: 'Combustível esq. sup. (212 L)', kind: 'fuel', eng: true, g: 'h', max: 70, abs: 12, box: [[-2.6, -1.65], [0.62, 1.08], [1.05, 1.72]], fireP: 0.5 },
    { key: 'fuelRU', name: 'Combustível dir. sup. (212 L)', kind: 'fuel', eng: true, g: 'h', max: 70, abs: 12, box: [[-2.6, -1.65], [-1.08, -0.62], [1.05, 1.72]], fireP: 0.5 },
    { key: 'fuelLL', name: 'Combustível esq. inf. (119 L)', kind: 'fuel', eng: true, g: 'h', max: 60, abs: 12, box: [[-2.6, -1.7], [0.6, 0.84], [0.5, 0.98]], fireP: 0.5 },
    { key: 'fuelRL', name: 'Combustível dir. inf. (119 L)', kind: 'fuel', eng: true, g: 'h', max: 60, abs: 12, box: [[-2.6, -1.7], [-0.84, -0.6], [0.5, 0.98]], fireP: 0.5 },
    { key: 'aux', name: 'Gerador auxiliar', kind: 'misc', g: 'h', max: 50, abs: 10, box: [[-1.45, -1.05], [0.35, 0.8], [0.5, 0.85]], fireP: 0.1 },
    { key: 'ammoR', name: 'Munição sponson dir.', cap: 30, kind: 'ammo', g: 'h', max: 40, abs: 10, box: [[-1.4, 0.8], [-1.12, -0.9], [1.05, 1.6]] },
    { key: 'ammoL', name: 'Munição sponson esq.', cap: 30, kind: 'ammo', g: 'h', max: 40, abs: 10, box: [[-1.4, 0.6], [0.9, 1.12], [1.05, 1.6]] },
    { key: 'ammoFL', name: 'Munição piso esq.', cap: 11, kind: 'ammo', g: 'h', max: 40, abs: 10, box: [[0.85, 1.05], [0.15, 0.8], [0.5, 0.9]] },
    { key: 'ammoFR', name: 'Munição piso dir.', cap: 11, kind: 'ammo', g: 'h', max: 40, abs: 10, box: [[0.85, 1.05], [-0.8, -0.15], [0.5, 0.9]] },
    { key: 'ammoT', name: 'Munição pronto uso', cap: 8, kind: 'ammo', g: 't', max: 40, abs: 10, box: [[0.05, 0.45], [0.35, 0.7], [0.85, 1.15]] },
    { key: 'bowmg', name: 'MG .30 do casco', kind: 'misc', g: 'h', max: 30, abs: 5, box: [[1.85, 2.2], [-0.56, -0.44], [1.38, 1.48]] },
    { key: 'breech', name: 'Culatra do M3', kind: 'gun', g: 't', max: 120, abs: 60, box: [[-0.4, 0.6], [-0.16, 0.16], [1.98, 2.22]] },
    { key: 'guard', name: 'Guarda de recuo', kind: 'gun', g: 't', max: 60, abs: 15, box: [[-0.75, -0.4], [-0.14, 0.14], [2.0, 2.18]] },
    { key: 'sight', name: 'Mira e periscópio M4', kind: 'misc', g: 't', max: 25, abs: 5, box: [[0.25, 0.58], [-0.34, -0.24], [2.22, 2.32]] },
    { key: 'coax', name: 'MG .30 coaxial', kind: 'misc', g: 't', max: 30, abs: 5, box: [[0.1, 0.6], [-0.3, -0.2], [2.03, 2.12]] },
    { key: 'radio', name: 'Rádio SCR-508', kind: 'misc', g: 't', max: 30, abs: 5, box: [[-1.05, -0.6], [-0.4, 0.4], [2.0, 2.35]] },
    { key: 'aa', name: 'Metralhadora .50 antiaérea', kind: 'misc', g: 't', max: 30, abs: 5, box: [[-0.78, 0.15], [0.62, 0.7], [2.72, 2.8]], ext: true, col: [50, 52, 40] },
    { key: 'ring', name: 'Anel da torre', kind: 'misc', g: 't', max: 80, abs: 20, ring: true },
    { key: 'barrel', name: 'Cano M3 L/40', kind: 'gun', g: 't', max: 70, abs: 25, barrel: true, ext: true },
    { key: 'trackL', name: 'Esteira esquerda', kind: 'track', g: 'h', max: 100, abs: 20, side: 1, track: true, ext: true },
    { key: 'trackR', name: 'Esteira direita', kind: 'track', g: 'h', max: 100, abs: 20, side: -1, track: true, ext: true },
    { key: 'wheelsL', name: 'Rodas e truques VVSS esq.', kind: 'track', g: 'h', max: 160, abs: 25, side: 1, wheels: true, ext: true },
    { key: 'wheelsR', name: 'Rodas e truques VVSS dir.', kind: 'track', g: 'h', max: 160, abs: 25, side: -1, wheels: true, ext: true }],
  vents: { fight: [[1.35, 0.55, 1.82], [1.35, -0.55, 1.82]], eng: [[-2.2, 0.45, 1.82], [-2.2, -0.45, 1.82], [-2.6, 0, 1.82]], tur: [[-0.38, -0.45, 2.57], [-0.2, 0.88, 2.25]] },
  turBox: { x: [-1.12, 0.98, 2.95], y: [-0.92, 0.92], z: [1.8, 2.55] },
  antenna: { on: 't', a: [-0.85, 0.45, 2.45], b: [-0.85, 0.45, 4.4] },
  game: {
    country: 'EUA', flag: 'us', year: 1942, weight: 30.3, hp: 400, len: 5.84, wid: 2.62,
    vmax: 39 / 3.6, vrev: 7 / 3.6, acc: 1.6, turn: 30, trav: 24, elev: [-10, 25], reload: 6.5, view: 450,
    gun: '75 mm M3 L/40', cal: 75, disp: 0.0009, moveDisp: 0.003, stab: true,
    ammo: [
      { k: 'M61', t: 'APCBC', v: 618, pen: [102, 93, 84], fill: 66, def: 50, d: 'Perfurante com coifa e explosivo. Penetra e explode dentro.' },
      { k: 'M72', t: 'AP', v: 619, pen: [88, 78, 67], fill: 0, def: 20, d: 'Projétil sólido. Só estilhaços depois de penetrar.' },
      { k: 'M48', t: 'HE', v: 463, pen: [10], fill: 666, def: 20, d: 'Explosivo. Quebra esteiras, canos e casas.' }],
    cap: 90, racks: ['ammoT', 'ammoL', 'ammoR', 'ammoFL', 'ammoFR'],
    seats: { driver: 'driver', radio: 'codriver', gunner: 'gunner', loader: 'loader', commander: 'commander' },
    driveL: ['trackL', 'wheelsL'], driveR: ['trackR', 'wheelsR'], driveBoth: ['trans', 'diff', 'shaft'],
    traverseMod: 'ring', gunMods: ['breech', 'barrel'], sightMod: 'sight',
    mg: { name: 'M1919A4', rate: 8, v: 850, belt: 250, coax: 2500, bow: 2250, reload: 8, arc: 12 },
    // morteiro M3 de 2 polegadas no teto da torre: granada de fumaça na direção do canhão, de 35 a 150 m
    smoke: { kind: 'mortar', name: 'Morteiro de fumaça', n: 12, reload: 6, range: [35, 150] }
  },
  ficha: `
      <h3>Blindagem real</h3>
      <div class="tw"><table>
        <thead><tr><th>Placa</th><th>mm</th><th>Inclin.</th><th>Efetiva*</th></tr></thead>
        <tbody>
          <tr><td>Glacis fundido (curvo, 37° a 55°)</td><td class="n">51</td><td class="n">~50°</td><td class="n">79</td></tr>
          <tr><td>Nariz: carcaça do diferencial</td><td class="n">~76</td><td class="n">~30°</td><td class="n">88</td></tr>
          <tr><td>Laterais do sponson (fundidas)</td><td class="n">38</td><td class="n">~7°</td><td class="n">38</td></tr>
          <tr><td>Laterais inferiores</td><td class="n">38</td><td class="n">0°</td><td class="n">38</td></tr>
          <tr><td>Traseira</td><td class="n">38</td><td class="n">~10°</td><td class="n">39</td></tr>
          <tr><td>Teto do casco</td><td class="n">19</td><td class="n">90°</td><td class="n">—</td></tr>
          <tr><td>Frente da torre</td><td class="n">76</td><td class="n">30°</td><td class="n">88</td></tr>
          <tr><td>Mantelete M34 (escudo + rotor)</td><td class="n">89</td><td class="n">0°</td><td class="n">89</td></tr>
          <tr><td>Laterais e traseira da torre</td><td class="n">51</td><td class="n">~5°</td><td class="n">51</td></tr>
        </tbody>
      </table></div>
      <p class="note">*Efetiva para um tiro reto. Produção do fim de 1942, munição seca nos sponsons.</p>
      <h3>Por dentro</h3>
      <p class="note">Motor radial R975 atrás, com quatro tanques de combustível (662 L) em volta. Eixo cardã alto, por baixo do cesto da torre. 90 tiros: 30 em cada sponson, 22 no piso e 8 de pronto uso no cesto. Os racks dos sponsons eram a causa principal dos incêndios. Estabilizador vertical no canhão: atira melhor em movimento.</p>
      <p class="note">Fontes: Hunnicutt, <i>Sherman</i>; TM 9-731B; War Thunder Wiki (blindagem e penetração).</p>`,
  replate(hull, p, pl) { return hull && pl === 7 && p[0] < -1.55 ? 20 : pl; },
  paint(hull, p, pl) {
    if (hull) {
      if (pl === 5 && p[0] > -0.95 && p[0] < -0.05 && inStar(p[0] + 0.5, p[2] - 1.4, 0.32)) return [218, 218, 206];
      if ((pl === 7) && p[0] > 1.12 && p[0] < 1.62 && Math.abs(Math.abs(p[1]) - 0.55) < 0.26) { if (Math.abs(Math.abs(p[1]) - 0.55) > 0.18 || p[0] < 1.18 || p[0] > 1.56) return [62, 64, 44]; }
      if (pl === 20 && p[0] > -2.75 && p[0] < -1.75 && Math.abs(p[1]) < 0.85 && Math.abs(p[1]) > 0.08 && (Math.round(p[0] * 10) % 2 === 0)) return [48, 50, 36];
      if (pl === 2 && Math.abs(p[1] - 0.5) < 0.14 && Math.abs(p[2] - 1.62) < 0.06) return [30, 30, 26];
      if (pl === 2 && Math.abs(p[1] + 0.5) < 0.14 && Math.abs(p[2] - 1.62) < 0.06) return [30, 30, 26];
    } else {
      if (pl === 13 && Math.abs(p[1]) > 0.55 && inStar(p[0] + 0.12, p[2] - 2.12, 0.2)) return [218, 218, 206];
      if (pl === 15 && p[0] > -0.62 && p[0] < -0.14 && p[1] > -0.72 && p[1] < -0.18) { if (p[0] < -0.55 || p[0] > -0.2 || p[1] < -0.65 || p[1] > -0.24 || Math.abs(p[1] + 0.45) < 0.04) return [60, 62, 42]; }
    }
    return null; }
};

// ================================================================ munições
const DISTS = [100, 500, 1000];
const RIC = { APCBC: [62, 72], APHE: [58, 68], AP: [58, 68], APCR: [55, 66], HEAT: [78, 85], HE: [78, 85] };
const NORM = { APCBC: 4, APHE: 3, AP: 3, APCR: 1, HEAT: 0, HE: 0 };
function penAt(a, d) { const p = a.pen; if (p.length === 1) return p[0];
  if (d <= DISTS[0]) return p[0];
  for (let i = 0; i < DISTS.length - 1; i++) if (d <= DISTS[i + 1]) return lerp(p[i], p[i + 1], (d - DISTS[i]) / (DISTS[i + 1] - DISTS[i]));
  const sl = (p[2] - p[1]) / 500; return Math.max(5, p[2] + sl * (d - 1000)); }
function ammoObj(TK, i) { const a = TK.game.ammo[i]; return { i, t: a.t, name: a.k + ' (' + a.t + ')', cal: TK.game.cal, v: a.v, fill: a.fill || 0, def: a }; }
function ricChance(t, ang, cal, th) { const [a0, a1] = RIC[t]; let c = clamp((ang - a0) / (a1 - a0), 0, 1); const om = cal / Math.max(th, 1); if (t !== 'HEAT' && t !== 'HE') { if (om >= 3) c = 0; else if (om >= 2) c *= 0.5; } return c; }
function effThick(t, ang, cal, th) { let a = Math.max(0, ang - NORM[t]); if (t !== 'HEAT' && cal / Math.max(th, 1) >= 3) a *= 0.6; return th / Math.max(0.06, Math.cos(a * D2R)); }
// ângulo de elevação (tiro baixo) para acertar a distância d com desnível dz
function elevFor(v, d, dz) { const v2 = v * v, disc = v2 * v2 - G * (G * d * d + 2 * dz * v2); if (disc < 0) return Math.PI / 4; return Math.atan2(v2 - Math.sqrt(disc), G * d); }

// ================================================================ grades de voxels
function makeGrid(id, x0, y0, z0, nx, ny, nz) { const n = nx * ny * nz; return { id, x0, y0, z0, nx, ny, nz, n,
  mat: new Uint8Array(n), plate: new Uint8Array(n), mod: new Uint8Array(n), thick: new Float32Array(n), t0: new Float32Array(n),
  pnx: new Float32Array(n), pny: new Float32Array(n), pnz: new Float32Array(n),
  lnx: new Float32Array(n), lny: new Float32Array(n), lnz: new Float32Array(n),
  cr: new Uint8Array(n), cg: new Uint8Array(n), cb: new Uint8Array(n), burn: new Float32Array(n), heat: new Float32Array(n),
  list: null }; }
const gIdx = (g, i, j, k) => (k * g.ny + j) * g.nx + i;
function gAt(g, l) { const i = Math.floor((l[0] - g.x0) / VS), j = Math.floor((l[1] - g.y0) / VS), k = Math.floor((l[2] - g.z0) / VS);
  if (i < 0 || j < 0 || k < 0 || i >= g.nx || j >= g.ny || k >= g.nz) return -1; return (k * g.ny + j) * g.nx + i; }
function gCenter(g, idx, o) { const i = idx % g.nx, t = (idx / g.nx) | 0, j = t % g.ny, k = (t / g.ny) | 0; o[0] = g.x0 + (i + .5) * VS; o[1] = g.y0 + (j + .5) * VS; o[2] = g.z0 + (k + .5) * VS; return o; }
const inShape = (s, p) => { for (const c of s) if (c.m(p) < 0) return false; return true; };
function lightNormal(g, idx) { const i = idx % g.nx, t = (idx / g.nx) | 0, j = t % g.ny, k = (t / g.ny) | 0; let x = 0, y = 0, z = 0;
  const e = (a, b, c) => a < 0 || b < 0 || c < 0 || a >= g.nx || b >= g.ny || c >= g.nz || !g.mat[gIdx(g, a, b, c)];
  if (e(i + 1, j, k)) x++; if (e(i - 1, j, k)) x--; if (e(i, j + 1, k)) y++; if (e(i, j - 1, k)) y--; if (e(i, j, k + 1)) z++; if (e(i, j, k - 1)) z--;
  if (!x && !y && !z) z = 1; const l = Math.hypot(x, y, z); g.lnx[idx] = x / l; g.lny[idx] = y / l; g.lnz[idx] = z / l; }
function setCol(g, idx, c, jit) { const v = jit ? (hash(idx, g.id * 7) - .5) * jit : 0; g.cr[idx] = clamp(c[0] + v, 0, 255); g.cg[idx] = clamp(c[1] + v, 0, 255); g.cb[idx] = clamp(c[2] + v, 0, 255); }
function convexHull(pts) { pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = []; for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  up.pop(); lo.pop(); return lo.concat(up); }
function polySD(poly, x, z) { let d = 1e9, inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[j], b = poly[i];
    const ex = b[0] - a[0], ez = b[1] - a[1], t = clamp(((x - a[0]) * ex + (z - a[1]) * ez) / (ex * ex + ez * ez), 0, 1);
    d = Math.min(d, Math.hypot(x - a[0] - ex * t, z - a[1] - ez * t));
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside; }
  return inside ? -d : d; }
function buildTrackPoly(tr) { const pts = []; const add = (cx, cz, r) => { for (let a = 0; a < 32; a++) { const t = a / 32 * Math.PI * 2; pts.push([cx + Math.cos(t) * r, cz + Math.sin(t) * r]); } };
  for (const x of tr.wheelX) add(x, tr.wz, tr.wr); add(tr.sprocket[0], tr.sprocket[1], tr.sprocket[2]); add(tr.idler[0], tr.idler[1], tr.idler[2]); for (const x of tr.ret) add(x, tr.rz, tr.rr);
  return convexHull(pts); }
const linkCol = (TK, p) => TK.track.col[(Math.floor((p[0] + p[2] * 1.3) / 0.14) & 1)];

// Monta o modelo de um tipo de tanque uma vez; cada tanque da partida copia só o que muda.
const TEMPLATES = {};
function getTemplate(key) {
  if (TEMPLATES[key]) return TEMPLATES[key];
  const TK = TANKS[key], PL = TK.plates;
  const MOD = [null]; for (const src of TK.mods) { const o = Object.assign({}, src); o.id = MOD.length; o.hp = o.max; o.dead = false; o.vox = []; MOD.push(o); }
  const modBy = k => MOD.find(o => o && o.key === k);
  const GH = makeGrid(0, ...TK.hull), GT = makeGrid(1, ...TK.tur);
  const buildArmor = (g, shapes) => { const p = [0, 0, 0], q = [0, 0, 0];
    for (let k = 0; k < g.nz; k++) for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
      p[0] = g.x0 + (i + .5) * VS; p[1] = g.y0 + (j + .5) * VS; p[2] = g.z0 + (k + .5) * VS;
      const cont = shapes.filter(s => inShape(s, p)); if (!cont.length) continue;
      let best = null, bm = 1e9;
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy && !dz) continue;
        q[0] = p[0] + dx * VS; q[1] = p[1] + dy * VS; q[2] = p[2] + dz * VS;
        if (shapes.some(s => inShape(s, q))) continue;
        for (const s of cont) for (const c of s) { if (c.internal) continue; if (c.m(q) < 0) { const mm = c.m(p); if (mm < bm) { bm = mm; best = c; } } }
      }
      if (!best) continue;
      const idx = gIdx(g, i, j, k), n = best.nm(p);
      g.mat[idx] = 1; g.plate[idx] = best.plate; g.thick[idx] = g.t0[idx] = PL[best.plate].t;
      g.pnx[idx] = n[0]; g.pny[idx] = n[1]; g.pnz[idx] = n[2];
    } };
  const putMod = (g, idx, mid, c) => { if (g.mat[idx] === 1) return; g.mat[idx] = 2; g.mod[idx] = mid; setCol(g, idx, c, 10); MOD[mid].vox.push(idx); };
  const fillBox = (g, mid, box, colFn, inside) => { const p = [0, 0, 0];
    for (let k = 0; k < g.nz; k++) for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
      p[0] = g.x0 + (i + .5) * VS; p[1] = g.y0 + (j + .5) * VS; p[2] = g.z0 + (k + .5) * VS;
      if (p[0] < box[0][0] || p[0] > box[0][1] || p[1] < box[1][0] || p[1] > box[1][1] || p[2] < box[2][0] || p[2] > box[2][1]) continue;
      if (inside && !inside(p)) continue;
      const idx = gIdx(g, i, j, k); if (g.mat[idx] === 1 || g.mat[idx] === 3) continue;
      if (g.mat[idx] === 2) { const o = MOD[g.mod[idx]]; const ov = o.vox.indexOf(idx); if (ov >= 0) o.vox.splice(ov, 1); }
      putMod(g, idx, mid, colFn(p)); } };
  const tr = TK.track, poly = buildTrackPoly(tr);
  buildArmor(GH, TK.hullShapes); buildArmor(GT, TK.turShapes);
  const p = [0, 0, 0];
  for (let idx = 0; idx < GH.n; idx++) { if (GH.mat[idx] !== 1 || !TK.roofPlates.includes(GH.plate[idx])) continue; gCenter(GH, idx, p);
    if (Math.hypot(p[0] - TK.ring[0], p[1] - TK.ring[1]) < TK.ringHole) GH.mat[idx] = 0; }
  for (let idx = 0; idx < GH.n; idx++) { if (GH.mat[idx]) continue; gCenter(GH, idx, p); if (Math.abs(p[0] - TK.firewall) > 0.05) continue;
    if (TK.hullShapes.some(s => inShape(s, p))) { GH.mat[idx] = 1; GH.plate[idx] = 10; GH.thick[idx] = GH.t0[idx] = PL[10].t; GH.pnx[idx] = 1; GH.pny[idx] = 0; GH.pnz[idx] = 0; } }
  for (const g of [GH, GT]) for (let idx = 0; idx < g.n; idx++) { if (g.mat[idx] !== 1) continue; gCenter(g, idx, p);
    if (TK.replate) { const np = TK.replate(g === GH, p, g.plate[idx]); if (np !== g.plate[idx]) { g.plate[idx] = np; g.thick[idx] = g.t0[idx] = PL[np].t; } }
    setCol(g, idx, TK.paint(g === GH, p, g.plate[idx]) || TK.color, TK.jit); }
  for (const d of TK.deco || []) for (let idx = 0; idx < GH.n; idx++) { if (GH.mat[idx]) continue; gCenter(GH, idx, p); const b = d.box;
    if (p[0] < b[0][0] || p[0] > b[0][1] || p[1] < b[1][0] || p[1] > b[1][1] || p[2] < b[2][0] || p[2] > b[2][1]) continue;
    GH.mat[idx] = 3; GH.plate[idx] = 0; GH.thick[idx] = GH.t0[idx] = 3; setCol(GH, idx, d.col, 8); GH.pnz[idx] = 1; }
  for (const o of MOD) { if (!o || !o.box) continue; const g = o.g === 'h' ? GH : GT; const cc = CAT[o.kind].c;
    const real = { ammo: null, fuel: [120, 70, 50], engine: [110, 90, 70], trans: [95, 90, 100], gun: [70, 76, 80], misc: [80, 95, 80], track: [60, 60, 58] }[o.kind];
    fillBox(g, o.id, o.box, q => { if (o.col) return o.col; if (o.kind === 'crew') return q[2] > o.head ? [215, 170, 140] : TK.crewCol;
      if (o.kind === 'ammo') return (Math.round(q[0] * 10) % 2) ? [200, 160, 60] : [150, 115, 45];
      return real || cc; }, o.inside); }
  const ring = modBy('ring'), rz = TK.ringZ - 0.05; for (let idx = 0; idx < GT.n; idx++) { gCenter(GT, idx, p); if (Math.abs(p[2] - rz) > 0.05) continue; const r = Math.hypot(p[0], p[1]); if (r > TK.ringR[0] && r < TK.ringR[1]) putMod(GT, idx, ring.id, [60, 62, 64]); }
  const bar = modBy('barrel'), B = TK.barrel; for (let idx = 0; idx < GT.n; idx++) { gCenter(GT, idx, p); const dy = Math.abs(p[1]), dz = Math.abs(p[2] - B.z);
    if (p[0] > B.x0 && p[0] < B.x1 && dy < B.r && dz < B.r) putMod(GT, idx, bar.id, B.col);
    else if (B.brake && p[0] > B.brake.x0 && p[0] < B.brake.x1 && dy < B.brake.r && dz < B.brake.r && !(dy > B.r && dz > B.r)) putMod(GT, idx, bar.id, [58, 62, 66]); }
  for (const side of [1, -1]) { const trk = modBy(side > 0 ? 'trackL' : 'trackR'), wh = modBy(side > 0 ? 'wheelsL' : 'wheelsR');
    for (let idx = 0; idx < GH.n; idx++) { if (GH.mat[idx]) continue; gCenter(GH, idx, p); const ay = p[1] * side; if (ay < tr.ty[0] - 0.03 || ay > tr.ty[1] + 0.02) continue;
      const sd = polySD(poly, p[0], p[2]);
      if (sd > -0.06 && sd < 0.06 && ay > tr.ty[0] && ay < tr.ty[1]) { putMod(GH, idx, trk.id, linkCol(TK, p)); continue; }
      if (ay > tr.wy[0] && ay < tr.wy[1]) {
        for (const x of tr.wheelX) { const d = Math.hypot(p[0] - x, p[2] - tr.wz); if (d < tr.wr) { putMod(GH, idx, wh.id, d > tr.wr - 0.06 ? [38, 38, 36] : (d < 0.07 ? [60, 64, 66] : tr.wheelCol)); break; } }
        if (GH.mat[idx]) continue;
        for (const w of [tr.sprocket, tr.idler]) { const d = Math.hypot(p[0] - w[0], p[2] - w[1]); if (d < w[2]) { putMod(GH, idx, wh.id, d > w[2] - 0.07 ? [46, 46, 44] : tr.wheelCol); break; } }
        if (GH.mat[idx]) continue;
      }
      if (ay > tr.ry[0] && ay < tr.ry[1]) for (const x of tr.ret) { if (Math.hypot(p[0] - x, p[2] - tr.rz) < tr.rr + 0.02) { putMod(GH, idx, wh.id, [64, 68, 70]); break; } }
      if (GH.mat[idx]) continue;
      const bg = tr.bogie; if (ay > bg.y[0] && ay < bg.y[1] && p[2] > bg.z[0] && p[2] < bg.z[1]) { for (let b = 0; b < tr.wheelX.length / 2; b++) { const bx = (tr.wheelX[b * 2] + tr.wheelX[b * 2 + 1]) / 2; if (Math.abs(p[0] - bx) < bg.w) { putMod(GH, idx, wh.id, tr.wheelCol.map(v => v * 0.85)); break; } } }
    } }
  const F = TK.fenders; if (F) for (let idx = 0; idx < GH.n; idx++) { if (GH.mat[idx]) continue; gCenter(GH, idx, p); const ay = Math.abs(p[1]);
    if (ay > F.y[0] && ay < F.y[1] && Math.abs(p[2] - F.z) < 0.05 && p[0] > F.x[0] && p[0] < F.x[1]) { GH.mat[idx] = 3; GH.plate[idx] = 0; GH.thick[idx] = GH.t0[idx] = 3; setCol(GH, idx, TK.color, 6); GH.pnz[idx] = 1; } }
  // posição de cada elo ao longo do contorno da esteira (para animar): anti-horário visto da esquerda, embaixo anda para +x
  { const segs = []; let acc = 0; for (let i = 0; i < poly.length; i++) { const A = poly[i], B = poly[(i + 1) % poly.length], L = Math.hypot(B[0] - A[0], B[1] - A[1]); segs.push([A, B, L, acc]); acc += L; }
    GH.tu = new Float32Array(GH.n); GH.tuLen = acc;
    for (const k of ['trackL', 'trackR']) for (const idx of modBy(k).vox) { gCenter(GH, idx, p); let bd = 1e9, bu = 0;
      for (const [A, B, L, u0] of segs) { const t = Math.max(0, Math.min(1, ((p[0] - A[0]) * (B[0] - A[0]) + (p[2] - A[1]) * (B[1] - A[1])) / (L * L || 1))), dx = A[0] + (B[0] - A[0]) * t - p[0], dz = A[1] + (B[1] - A[1]) * t - p[2], d = dx * dx + dz * dz;
        if (d < bd) { bd = d; bu = u0 + L * t; } }
      GH.tu[idx] = bu; } }
  for (const g of [GH, GT]) { const L = []; for (let i = 0; i < g.n; i++) if (g.mat[i]) L.push(i); g.list = Int32Array.from(L);
    g.cx = new Float32Array(L.length); g.cy = new Float32Array(L.length); g.cz = new Float32Array(L.length);
    for (let a = 0; a < L.length; a++) { gCenter(g, L[a], p); g.cx[a] = p[0]; g.cy[a] = p[1]; g.cz[a] = p[2]; }
    for (const idx of L) lightNormal(g, idx); }
  for (const o of MOD) { if (!o) continue; const g = o.g === 'h' ? GH : GT; let s = [0, 0, 0]; for (const v of o.vox) { gCenter(g, v, p); s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; } const n = o.vox.length || 1; o.c = [s[0] / n, s[1] / n, s[2] / n]; }
  return (TEMPLATES[key] = { TK, GH, GT, MOD });
}
const CLONE = ['mat', 'thick', 'burn', 'heat', 'cr', 'cg', 'cb', 'lnx', 'lny', 'lnz'];
function cloneGrid(g) { const o = Object.assign({}, g); for (const k of CLONE) o[k] = g[k].slice(); return o; }

// ================================================================ transformações
function setRz(R, a) { const c = Math.cos(a), s = Math.sin(a); R[0] = c; R[1] = -s; R[2] = 0; R[3] = s; R[4] = c; R[5] = 0; R[6] = 0; R[7] = 0; R[8] = 1; }
function toW(T, l, o) { const x = l[0] - T.p[0], y = l[1] - T.p[1], z = l[2] - T.p[2], R = T.R; o[0] = T.o[0] + R[0] * x + R[1] * y + R[2] * z; o[1] = T.o[1] + R[3] * x + R[4] * y + R[5] * z; o[2] = T.o[2] + R[6] * x + R[7] * y + R[8] * z; return o; }
function toL(T, w, o) { const x = w[0] - T.o[0], y = w[1] - T.o[1], z = w[2] - T.o[2], R = T.R; o[0] = T.p[0] + R[0] * x + R[3] * y + R[6] * z; o[1] = T.p[1] + R[1] * x + R[4] * y + R[7] * z; o[2] = T.p[2] + R[2] * x + R[5] * y + R[8] * z; return o; }
function dW(T, n, o) { const R = T.R; o[0] = R[0] * n[0] + R[1] * n[1] + R[2] * n[2]; o[1] = R[3] * n[0] + R[4] * n[1] + R[5] * n[2]; o[2] = R[6] * n[0] + R[7] * n[1] + R[8] * n[2]; return o; }
function axisAngle(ax, a) { const [x, y, z] = nrm(ax), c = Math.cos(a), s = Math.sin(a), t = 1 - c; return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c]; }
function mul3(A, B) { const o = new Float64Array(9); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]; return o; }

// ================================================================ um tanque na partida
const SEAT_DONORS = { gunner: ['commander', 'loader', 'radio'], driver: ['radio', 'loader', 'commander'], loader: ['radio', 'commander'], commander: ['radio'] };
const SEAT_ORDER = ['gunner', 'driver', 'loader', 'commander'];
const SEAT_NAMES = { driver: 'Motorista', gunner: 'Atirador', loader: 'Municiador', commander: 'Comandante', radio: 'Rádio' };

class Tank {
  constructor(key, id) {
    const T = getTemplate(key);
    this.key = key; this.id = id; this.TK = T.TK; this.PL = T.TK.plates; this.game = T.TK.game;
    this.GH = cloneGrid(T.GH); this.GT = cloneGrid(T.GT);
    this.MOD = T.MOD.map(o => o ? Object.assign({}, o) : null);
    this.mk = {}; for (const o of this.MOD) if (o) this.mk[o.key] = o;
    this.TH = { R: new Float64Array(9), o: [0, 0, 0], p: [0, 0, 0] };
    this.TT = { R: new Float64Array(9), o: [0, 0, 0], p: this.TK.piv };
    this.x = 0; this.y = 0; this.h = 0; this.ty = 0;
    this.fires = []; this.destroyed = false; this.boom = false; this.turretOff = false; this.removedTrack = []; this.holes = [];
    this.seat = Object.assign({}, this.game.seats); this.moving = null; this.repair = null;
    this.out = null; this.dirty = new Map(); this.lastHitBy = null;
    this.update();
  }
  update() { setRz(this.TH.R, this.h); this.TH.o[0] = this.x; this.TH.o[1] = this.y; this.TH.o[2] = 0;
    if (!this.turretFly) { setRz(this.TT.R, this.h + this.ty); toW(this.TH, [this.TK.ring[0], this.TK.ring[1], this.TK.piv[2]], this.TT.o); } }
  tf(g) { return g === this.GH ? this.TH : this.TT; }
  grid(gid) { return gid ? this.GT : this.GH; }
  // ---- eventos para os navegadores (só no servidor, quando "out" existe)
  emit(a) { if (this.out) this.out.push(a); }
  sparks(p, n, cnt, sp) { this.emit(['sp', r2(p[0]), r2(p[1]), r2(p[2]), r2(n[0]), r2(n[1]), r2(n[2]), cnt, sp]); }
  debris(p, n, g, idx, cnt) { this.emit(['db', r2(p[0]), r2(p[1]), r2(p[2]), r2(n[0]), r2(n[1]), r2(n[2]), this.id, g.id, idx, cnt]); }
  dust(p, c) { this.emit(['du', r2(p[0]), r2(p[1]), r2(p[2]), c]); }
  fireball(p, s, big) { this.emit(['fb', r2(p[0]), r2(p[1]), r2(p[2]), r2(s), big ? 1 : 0]); }
  label(p, text, col, dur) { this.emit(['lb', r2(p[0]), r2(p[1]), r2(p[2]), text, col, dur || 1.6]); }
  touch(g, idx) { this.dirty.set((g.id << 20) | idx, 1); }
  flush() { if (!this.out) { this.dirty.clear(); return; }
    for (const key of this.dirty.keys()) { const gid = key >> 20, idx = key & 0xFFFFF, g = this.grid(gid); if (!g.mat[idx]) continue;
      this.emit(['vb', this.id, gid, idx, Math.round(g.thick[idx] * 10) / 10, r2(g.burn[idx]), r2(g.heat[idx])]); }
    this.dirty.clear(); }
  removeVox(g, idx, chunk) { if (!g.mat[idx]) return; g.mat[idx] = 0;
    const i = idx % g.nx, t = (idx / g.nx) | 0, j = t % g.ny, k = (t / g.ny) | 0;
    for (const [a, b, c] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) { const ii = i + a, jj = j + b, kk = k + c; if (ii < 0 || jj < 0 || kk < 0 || ii >= g.nx || jj >= g.ny || kk >= g.nz) continue; const n = gIdx(g, ii, jj, kk); if (g.mat[n]) lightNormal(g, n); }
    this.emit(['rm', this.id, g.id, idx, chunk || 0]); }
  // ---- amostragem
  sample(p, H) { const l = [0, 0, 0];
    if (!this.turretOff) { toL(this.TT, p, l); const r = gAt(this.GT, l); if (r >= 0 && this.GT.mat[r]) { H.g = this.GT; H.idx = r; return H; } }
    toL(this.TH, p, l); const r = gAt(this.GH, l); if (r >= 0 && this.GH.mat[r]) { H.g = this.GH; H.idx = r; return H; }
    return null; }
  plateNormalW(g, idx, o) { return dW(this.tf(g), [g.pnx[idx], g.pny[idx], g.pnz[idx]], o); }
  // ---- tiro: anda em linha reta pelo tanque a partir de "start" (fora dele). dry = só análise.
  castShot(start, dir0, A, pen0, dry, maxLen) {
    const PL = this.PL, MOD = this.MOD, H = { g: null, idx: -1 };
    const dir = dir0.slice(), pos = start.slice();
    const step = 0.02, nS = Math.ceil((maxLen || 10) / step);
    let pen = pen0, inside = false, inArmor = false, lastMod = 0, travelIn = 0, fuse = false, ricN = 0;
    const world = [pos.slice()];
    const rep = { A, res: null, plate: null, t: 0, t0: 0, ang: 0, eff: 0, ric: 0, pen: pen0, mods: [], crew: [], ext: null, ground: false, blast: null, fused: false };
    const W = [0, 0, 0];
    for (let s = 0; s < nS; s++) {
      pos[0] += dir[0] * step; pos[1] += dir[1] * step; pos[2] += dir[2] * step;
      if (inside) travelIn += step;
      if (fuse && travelIn >= 1.2) { if (!dry) this.explodeInside(pos.slice(), A, rep); rep.fused = true; break; }
      if (pos[2] < 0) { rep.ground = !inside; if (!rep.res) rep.res = 'miss'; break; }
      const h = this.sample(pos, H);
      if (!h) { inArmor = false; lastMod = 0; continue; }
      const g = h.g, idx = h.idx, mat = g.mat[idx];
      if (mat === 1) {
        if (inArmor) continue; inArmor = true; lastMod = 0;
        const n = this.plateNormalW(g, idx, W); const cs = -(dir[0] * n[0] + dir[1] * n[1] + dir[2] * n[2]); const ang = Math.acos(clamp(Math.abs(cs), 0, 1)) / D2R;
        const th = g.thick[idx];
        if (!inside) {
          const ric = ricChance(A.t, ang, A.cal, th), eff = effThick(A.t, ang, A.cal, th);
          if (!rep.plate) { rep.plate = PL[g.plate[idx]].n; rep.t = th; rep.t0 = g.t0[idx]; rep.ang = ang; rep.eff = eff; rep.ric = ric; rep.pen = pen; rep.at = pos.slice(); }
          if (dry) { rep.res = pen >= eff ? 'pen' : 'non'; return rep; }
          if (rnd() < ric && ricN < 1) {
            ricN++; rep.res = rep.res || 'ric';
            const d = dir[0] * n[0] + dir[1] * n[1] + dir[2] * n[2]; for (let a = 0; a < 3; a++) dir[a] = dir[a] - 2 * d * n[a] + (rnd() - .5) * 0.08; const nd = nrm(dir); dir[0] = nd[0]; dir[1] = nd[1]; dir[2] = nd[2];
            pen *= 0.55; world.push(pos.slice()); this.sparks(pos, n, 40, 1.4); this.chip(g, idx, 0.06, A.cal); this.label(pos, 'RICOCHETE', '#e8b64a');
            for (let a = 0; a < 3; a++) pos[a] += dir[a] * 0.08; inArmor = true; continue; }
          if (A.t === 'HE' && pen < eff) { rep.res = rep.res === 'pen' ? 'pen' : rep.res === 'ric' ? 'ric' : 'non'; world.push(pos.slice()); this.heBlast(pos, A, n, rep); rep.blast = pos.slice(); break; }
          if (pen >= eff) {
            rep.res = 'pen'; inside = true; rep.plate = PL[g.plate[idx]].n; rep.t = th; rep.t0 = g.t0[idx]; rep.ang = ang; rep.eff = eff; rep.pen = pen; pen -= eff; world.push(pos.slice());
            this.punch(g, idx, A);
            this.sparks(pos, n, 50, 1.8); this.debris(pos, n, g, idx, 10);
            const nf = A.t === 'HEAT' ? 8 : Math.round((A.cal / 5) * (A.t === 'APCR' ? 1.2 : 1) * clamp(1 + pen / 60, 1, 2) + 6);
            const cone = A.t === 'HEAT' ? 8 : A.t === 'APCR' ? 18 : 24;
            this.spall(pos, dir, nf, cone, A.t === 'APCR' ? 0.7 : 1.0, A.t === 'HEAT' ? 3.0 : 2.6, rep, 'spall');
            if (A.t === 'HE') { this.explodeInside(pos.slice(), A, rep); break; }
            if (A.t === 'HEAT') pen = Math.min(pen, 60);
            if ((A.t === 'APCBC' || A.t === 'APHE') && A.fill > 0 && eff >= 15) fuse = true;
            this.label(pos, 'PENETROU', '#e5583f');
            continue; }
          const wasPen = rep.res === 'pen'; rep.res = wasPen ? 'pen' : rep.res === 'ric' ? 'ric' : 'non'; world.push(pos.slice());
          this.sparks(pos, n, 70, 1.6); this.chip(g, idx, clamp(pen / eff, 0.2, 1) * 0.3, A.cal); this.debris(pos, n, g, idx, 4);
          if (!wasPen) this.label(pos, 'NÃO PENETROU', '#79c27c');
          if (A.t === 'HEAT' || A.fill > 300) { this.heBlast(pos, A, n, rep); rep.blast = pos.slice(); }
          break;
        } else {
          const eff = effThick(A.t, ang, A.cal, th), nn = [-n[0], -n[1], -n[2]];
          if (pen >= eff && g.plate[idx] !== 10) { pen -= eff; world.push(pos.slice()); this.punch(g, idx, A); this.sparks(pos, nn, 30, 1.4); inside = false; fuse = false; continue; }
          if (pen >= eff) { pen -= eff; continue; }
          world.push(pos.slice()); this.sparks(pos, nn, 30, 1);
          if (fuse) { this.explodeInside(pos.slice(), A, rep); rep.fused = true; }
          break; }
      } else {
        inArmor = false; if (mat === 3) { if (!dry) pen -= 3; continue; }
        const mid = g.mod[idx]; if (mid === lastMod) continue; lastMod = mid;
        const o = MOD[mid];
        if (dry) { if (!inside && o.ext) { rep.ext = rep.ext || []; if (!rep.ext.includes(o.name)) rep.ext.push(o.name); pen -= o.abs; } continue; }
        if (!inside && !o.ext) continue;
        if (!rep.res && !inside) { rep.res = 'non'; rep.at = pos.slice(); }
        this.hurt(o, inside ? (o.kind === 'crew' ? 999 : 160) : (A.t === 'HE' ? 60 : 55), 'shell', rep, pos);
        pen -= o.abs;
        const nd = [-dir[0], -dir[1], -dir[2]];
        if (!inside) { this.sparks(pos, nd, 20, 1); if (A.t === 'HE') { world.push(pos.slice()); this.heBlast(pos, A, nd, rep); rep.blast = pos.slice(); break; } }
        if (pen <= 0) { world.push(pos.slice()); if (fuse) { this.explodeInside(pos.slice(), A, rep); rep.fused = true; } break; }
      }
    }
    world.push(pos.slice()); rep.end = pos.slice(); rep.dir = dir;
    if (!rep.res) rep.res = 'miss';
    if (!dry && ricN > 0) { const e = [pos[0] + dir[0] * 40, pos[1] + dir[1] * 40, Math.max(0, pos[2] + dir[2] * 40)]; const pts = []; for (const q of world) pts.push(r2(q[0]), r2(q[1]), r2(q[2])); pts.push(r2(e[0]), r2(e[1]), r2(e[2])); this.emit(['tr', pts]); }
    if (!dry) this.flush();
    return rep; }
  punch(g, idx, A) {
    const p = gCenter(g, idx, [0, 0, 0]); this.holes.push({ g: g.id, idx, c: p.slice() }); this.emit(['ho', this.id, g.id, idx]);
    this.removeVox(g, idx);
    const big = A.cal >= 85 || A.t === 'HE';
    const i = idx % g.nx, t = (idx / g.nx) | 0, j = t % g.ny, k = (t / g.ny) | 0;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const ii = i + dx, jj = j + dy, kk = k + dz; if (ii < 0 || jj < 0 || kk < 0 || ii >= g.nx || jj >= g.ny || kk >= g.nz) continue; const q = gIdx(g, ii, jj, kk); if (g.mat[q] !== 1) continue;
      g.heat[q] = 1; g.burn[q] = Math.min(1, g.burn[q] + 0.5); g.thick[q] *= 0.85; this.touch(g, q);
      if (big && Math.abs(dx) + Math.abs(dy) + Math.abs(dz) === 1 && rnd() < 0.5) this.removeVox(g, q, 1); } }
  chip(g, idx, frac) {
    const i = idx % g.nx, t = (idx / g.nx) | 0, j = t % g.ny, k = (t / g.ny) | 0;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const ii = i + dx, jj = j + dy, kk = k + dz; if (ii < 0 || jj < 0 || kk < 0 || ii >= g.nx || jj >= g.ny || kk >= g.nz) continue; const q = gIdx(g, ii, jj, kk); if (g.mat[q] !== 1) continue;
      const c = (dx || dy || dz) ? 0.35 : 1; g.thick[q] = Math.max(0, g.thick[q] * (1 - frac * c)); g.burn[q] = Math.min(1, g.burn[q] + 0.35 * c); g.heat[q] = Math.max(g.heat[q], 0.8 * c); this.touch(g, q);
      if (g.thick[q] < 2) this.removeVox(g, q, 1); } }
  spall(p, dir, n, cone, en, len, rep, kind) {
    for (let f = 0; f < n; f++) {
      const a = rnd() * Math.PI * 2, c = Math.tan(cone * D2R * Math.sqrt(rnd()));
      const u = nrm(Math.abs(dir[2]) < 0.9 ? [-dir[1], dir[0], 0] : [1, 0, 0]); const v = [dir[1] * u[2] - dir[2] * u[1], dir[2] * u[0] - dir[0] * u[2], dir[0] * u[1] - dir[1] * u[0]];
      const d = nrm([dir[0] + (u[0] * Math.cos(a) + v[0] * Math.sin(a)) * c, dir[1] + (u[1] * Math.cos(a) + v[1] * Math.sin(a)) * c, dir[2] + (u[2] * Math.cos(a) + v[2] * Math.sin(a)) * c]);
      this.fragment(p, d, en * (0.45 + rnd() * 0.55), len * (0.6 + rnd() * 0.6), rep, kind); } }
  fragment(p0, d, en, maxLen, rep, kind) {
    const pos = p0.slice(), H = { g: null, idx: -1 }; let inA = true, last = 0, L = 0; const step = 0.04; const W = [0, 0, 0];
    while (L < maxLen && en > 0.05) {
      pos[0] += d[0] * step; pos[1] += d[1] * step; pos[2] += d[2] * step; L += step;
      if (pos[2] < 0) break;
      const h = this.sample(pos, H); if (!h) { inA = false; last = 0; continue; }
      const g = h.g, idx = h.idx, mat = g.mat[idx];
      if (mat === 1 || mat === 3) { if (inA) continue;
        const fp = 12 * en; if (fp > g.thick[idx] * 1.5 && g.plate[idx] !== 10) { en *= 0.4; inA = true; continue; }
        if (rnd() < 0.25) { g.burn[idx] = Math.min(1, g.burn[idx] + 0.1); this.touch(g, idx); }
        break; }
      inA = false; const mid = g.mod[idx]; if (mid === last) continue; last = mid; const o = this.MOD[mid];
      this.hurt(o, 25 + 70 * en, kind, rep, pos, en);
      en -= o.kind === 'crew' ? 0.45 : o.abs / 40;
    } }
  explodeInside(p, A, rep) {
    const n = Math.min(90, 22 + Math.round(A.fill / 2.2));
    for (let f = 0; f < n; f++) { const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z); this.fragment(p, [r * Math.cos(a), r * Math.sin(a), z], 0.55 + rnd() * 0.45, 1.2 + A.fill / 120, rep, 'he'); }
    const br = 0.35 + Math.cbrt(A.fill) / 14;
    for (const o of this.MOD) { if (!o || o.dead || !o.c) continue; if (o.g === 't' && this.turretOff) continue; const g = o.g === 'h' ? this.GH : this.GT; const w = toW(this.tf(g), o.c, [0, 0, 0]); const d = Math.hypot(w[0] - p[0], w[1] - p[1], w[2] - p[2]);
      if (d < br) this.hurt(o, (1 - d / br) * (o.kind === 'crew' ? 160 : 90), 'he', rep, w); }
    this.fireball(p, 0.25 + A.fill / 1500, true);
    rep.fused = true; }
  heBlast(p, A, n, rep) {
    const r = 0.5 + Math.cbrt(A.fill) / 7;
    this.fireball(p, 0.3 + A.fill / 1800); this.dust(p, 18);
    for (const o of this.MOD) { if (!o || o.dead || !o.ext && o.key !== 'ring') continue; if (o.g === 't' && this.turretOff) continue; const g = o.g === 'h' ? this.GH : this.GT; let best = 1e9, bw = null;
      for (let a = 0; a < o.vox.length; a += 3) { if (!g.mat[o.vox[a]]) continue; const w = toW(this.tf(g), gCenter(g, o.vox[a], [0, 0, 0]), [0, 0, 0]); const d = Math.hypot(w[0] - p[0], w[1] - p[1], w[2] - p[2]); if (d < best) { best = d; bw = w; } }
      if (best < r) this.hurt(o, 30 + 90 * (1 - best / r), 'blast', rep, bw); }
    for (const g of [this.GH, this.GT]) { if (g === this.GT && this.turretOff) continue; const T = this.tf(g), loc = toL(T, p, [0, 0, 0]); const c = gAt(g, loc); if (c < 0) continue;
      const i = c % g.nx, t = (c / g.nx) | 0, j = t % g.ny, k = (t / g.ny) | 0;
      for (let dz = -2; dz <= 2; dz++) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const ii = i + dx, jj = j + dy, kk = k + dz; if (ii < 0 || jj < 0 || kk < 0 || ii >= g.nx || jj >= g.ny || kk >= g.nz) continue; const q = gIdx(g, ii, jj, kk); if (g.mat[q] !== 1) continue;
        const fall = 1 - Math.hypot(dx, dy, dz) / 3.2; if (fall <= 0) continue; g.burn[q] = Math.min(1, g.burn[q] + 0.4 * fall); g.thick[q] *= 1 - 0.06 * fall; this.touch(g, q);
        if (g.thick[q] <= A.def.pen[0] && rnd() < fall && g.plate[q] !== 10) { const w = toW(T, gCenter(g, q, [0, 0, 0]), [0, 0, 0]); const nn = this.plateNormalW(g, q, [0, 0, 0]); this.removeVox(g, q); this.holes.push({ g: g.id, idx: q, c: gCenter(g, q, [0, 0, 0]) }); this.emit(['ho', this.id, g.id, q]);
          this.spall(w, [-nn[0], -nn[1], -nn[2]], 14, 50, 0.6, 1.6, rep, 'he'); rep.res = 'pen'; } } }
    this.flush(); }
  // ---- dano
  hurt(o, dmg, cause, rep, wpos, en) {
    if (this.destroyed && o.kind === 'crew') return;
    if (o.dead && o.kind !== 'ammo') return;
    if (o.kind === 'crew') {
      const killP = cause === 'shell' ? 1 : cause === 'he' ? 0.45 + 0.5 * (en || 1) : cause === 'blast' ? 0.3 : 0.35 + 0.5 * (en || 1);
      if (rnd() < killP || dmg >= 999) { if (!o.dead && rep && !rep.crew.includes(o.name)) rep.crew.push(o.name); this.kill(o); }
      return; }
    if (o.dead) return;
    o.hp -= dmg; if (rep && !rep.mods.includes(o.name)) rep.mods.push(o.name);
    if (o.kind === 'ammo' && (o.count || 0) > 0) { const p = cause === 'shell' ? 0.75 : cause === 'he' ? 0.35 : cause === 'blast' ? 0.15 : 0.22 * (en || 1); if (rnd() < p) { this.detonate(o, wpos); return; } }
    if (o.fireP && rnd() < o.fireP * (cause === 'shell' ? 1.4 : 1)) this.startFire(o);
    if (o.hp <= 0) { o.hp = 0; o.dead = true; if (o.track) this.breakTrack(o, wpos); } }
  kill(o) { if (o.dead) return; o.dead = true; o.hp = 0; this.checkDestroyed(); }
  breakTrack(o, wpos) {
    const loc = wpos ? toL(this.TH, wpos, [0, 0, 0]) : o.c; const p = [0, 0, 0], g = this.GH;
    for (const v of o.vox) { if (!g.mat[v]) continue; gCenter(g, v, p); if (Math.abs(p[0] - loc[0]) < 0.28 && (p[2] < 0.25 || p[2] > 0.75 || Math.abs(p[0] - loc[0]) < 0.18)) { this.removedTrack.push(v); this.removeVox(g, v, 1.5); } }
    this.label(wpos || toW(this.TH, o.c, [0, 0, 0]), o.wheels ? 'RODAS QUEBRADAS' : 'ESTEIRA QUEBRADA', '#e8b64a'); }
  crewAlive() { let n = 0; for (const o of this.MOD) if (o && o.kind === 'crew' && !o.dead) n++; return n; }
  checkDestroyed() { if (!this.destroyed && this.crewAlive() === 0) { this.destroyed = true; this.label(toW(this.TH, [0, 0, 1.8], [0, 0, 0]), 'TANQUE DESTRUÍDO', '#e5583f', 3); if (this.onDestroyed) this.onDestroyed('crew'); } }
  startFire(o) { if (this.fires.some(f => f.mod === o.key)) return;
    this.fires.push({ mod: o.key, comp: o.eng ? 'eng' : 'fight', t: 0, life: o.kind === 'fuel' ? 30 : 18, int: o.kind === 'fuel' ? 1 : 0.7 });
    this.label(toW(this.tf(o.g === 'h' ? this.GH : this.GT), o.c, [0, 0, 0]), 'INCÊNDIO', '#ff8a3a'); }
  detonate(o, wpos) {
    if (this.boom) return; this.boom = true; o.dead = true; o.hp = 0;
    const c = toW(this.TH, o.c, [0, 0, 0]);
    for (const m of this.MOD) { if (!m) continue; if (m.kind === 'crew') m.dead = true; if (m.kind === 'ammo' || m.kind === 'fuel') { m.dead = true; m.hp = 0; } }
    const vel = [(rnd() - .5) * 4, (rnd() - .5) * 4, 11 + rnd() * 5], w = [(rnd() - .5) * 5, (rnd() - .5) * 5, (rnd() - .5) * 3];
    this.turretOff = true;
    this.fires = [{ mod: o.key, comp: 'fight', t: 0, life: 80, int: 2.2, boom: true }, { mod: 'engine', comp: 'eng', t: 0, life: 70, int: 1 }];
    const wasDead = this.destroyed; this.destroyed = true;
    this.emit(['boom', this.id, r2(c[0]), r2(c[1]), r2(c[2]), r2(vel[0]), r2(vel[1]), r2(vel[2]), r2(w[0]), r2(w[1]), r2(w[2])]);
    this.label(c, 'MUNIÇÃO DETONOU', '#ff5a2a', 3.2);
    if (!wasDead && this.onDestroyed) this.onDestroyed('ammo'); }
  // ---- simulação do servidor: postos, fogo, conserto
  hasSeat(s) { return !!this.seat[s] && !this.destroyed; }
  updateCrew(dt) {
    for (const s in this.seat) { const k = this.seat[s]; if (k && this.mk[k].dead) this.seat[s] = null; }
    if (this.moving) { const mv = this.moving; if (this.mk[mv.key].dead) this.moving = null; else { mv.t += dt; if (mv.t >= mv.T) { this.seat[mv.to] = mv.key; this.moving = null; } } return; }
    for (const s of SEAT_ORDER) { if (this.seat[s]) continue;
      for (const d of SEAT_DONORS[s]) { const k = this.seat[d]; if (!k) continue;
        this.seat[d] = null; this.moving = { to: s, from: d, key: k, t: 0, T: 6 }; return; } } }
  updFires(dt) {
    for (let i = this.fires.length - 1; i >= 0; i--) { const f = this.fires[i]; f.t += dt;
      if (f.t > f.life) { this.fires.splice(i, 1); continue; }
      if (this.destroyed) continue;
      if (f.comp === 'fight') {
        for (const o of this.MOD) if (o && o.kind === 'crew' && !o.dead && rnd() < 0.05 * dt) { this.kill(o); if (this.destroyed) return; }
        if (f.t > 3 && rnd() < 0.03 * dt) { const am = this.MOD.filter(o => o && o.kind === 'ammo' && !o.dead && o.count > 0); if (am.length) { this.detonate(am[(rnd() * am.length) | 0], null); return; } }
      } else { const e = this.mk.engine; if (!e.dead) { e.hp -= 4 * dt; if (e.hp <= 0) { e.hp = 0; e.dead = true; } } }
      if (this.crewAlive() > 0 && f.t > 8 && rnd() < 0.07 * dt) { this.fires.splice(i, 1); this.label(toW(this.TH, [0, 0, 2], [0, 0, 0]), 'FOGO APAGADO', '#79c27c'); } } }
  needsRepair() { for (const o of this.MOD) if (o && o.kind !== 'crew' && o.kind !== 'ammo' && o.kind !== 'fuel' && (o.dead || o.hp < o.max * 0.5)) return true; return false; }
  startRepair() { if (this.destroyed || this.repair) return false; const a = this.crewAlive(); if (!a) return false;
    if (this.fires.length) { this.repair = { kind: 'fire', t: 0, T: 4 * 5 / a }; return true; }
    if (!this.needsRepair()) return false;
    let T = 0; for (const o of this.MOD) if (o && o.kind !== 'crew' && o.kind !== 'ammo' && o.kind !== 'fuel' && (o.dead || o.hp < o.max * 0.5)) T += o.track || o.wheels ? 8 : 5;
    this.repair = { kind: 'fix', t: 0, T: Math.min(25, T) * 5 / a }; return true; }
  updRepair(dt, moving) { const R = this.repair; if (!R) return;
    if (this.destroyed || !this.crewAlive() || (moving && R.kind === 'fix')) { this.repair = null; return; }
    R.t += dt; if (R.t < R.T) return;
    this.repair = null;
    if (R.kind === 'fire') { this.fires = this.fires.filter(f => f.boom); this.label(toW(this.TH, [0, 0, 2], [0, 0, 0]), 'FOGO APAGADO', '#79c27c'); return; }
    const g = this.GH, p = [0, 0, 0];
    for (const v of this.removedTrack) g.mat[v] = 2;
    for (const v of this.removedTrack) lightNormal(g, v);
    if (this.removedTrack.length) this.emit(['rs', this.id, this.removedTrack.slice()]);
    this.removedTrack = [];
    for (const o of this.MOD) if (o && o.kind !== 'crew' && o.kind !== 'ammo' && o.kind !== 'fuel' && (o.dead || o.hp < o.max * 0.5)) { o.dead = false; o.hp = Math.max(o.hp, o.max * 0.6); }
    this.label(toW(this.TH, [0, 0, 1.8], [0, 0, 0]), 'CONSERTADO', '#79c27c'); }
  // ---- estado para o placar e para o HUD
  // anima os elos: dL/dR = quanto cada esteira andou (m). Só recolore quando o desenho muda de lugar.
  animTracks(dL, dR) { const g = this.GH, tu = g.tu; if (!tu) return; const col = this.TK.track.col, P = 0.14;
    this.trOff = this.trOff || [0, 0]; const o = this.trOff; o[0] += dL; o[1] += dR;
    for (let s = 0; s < 2; s++) { const m = this.mk[s ? 'trackR' : 'trackL'], ph = Math.floor(o[s] / P * 4); if (m.ph === ph) continue; m.ph = ph;
      for (const idx of m.vox) if (g.mat[idx] === 2) setCol(g, idx, col[Math.floor((tu[idx] + o[s]) / P) & 1], 10); } }
  driveState() { const g = this.game, mk = this.mk;
    const L = g.driveL.some(k => mk[k] && mk[k].dead), R = g.driveR.some(k => mk[k] && mk[k].dead);
    const both = g.driveBoth.some(k => mk[k] && mk[k].dead) || mk.engine.dead || !this.hasSeat('driver');
    return { L, R, both }; }
  deadMods() { const a = []; for (const o of this.MOD) if (o && o.dead) a.push(o.id); return a; }
  // ---- só no navegador: aplica o estado recebido
  restoreTrack(list) { const g = this.GH, p = [0, 0, 0];
    for (const v of list) { g.mat[v] = 2; gCenter(g, v, p); setCol(g, v, linkCol(this.TK, p), 10); }
    for (const v of list) lightNormal(g, v); }
  tintMod(o, c, f) { const g = o.g === 'h' ? this.GH : this.GT; for (const v of o.vox) { g.cr[v] = lerp(g.cr[v], c[0], f); g.cg[v] = lerp(g.cg[v], c[1], f); g.cb[v] = lerp(g.cb[v], c[2], f); } }
  untintMod(o) { const T = getTemplate(this.key), g = o.g === 'h' ? this.GH : this.GT, t = o.g === 'h' ? T.GH : T.GT; for (const v of o.vox) { g.cr[v] = t.cr[v]; g.cg[v] = t.cg[v]; g.cb[v] = t.cb[v]; } }
  setDead(ids) { const set = new Set(ids);
    for (const o of this.MOD) { if (!o) continue; const d = set.has(o.id); if (d === o.dead) continue; o.dead = d;
      if (d) this.tintMod(o, o.kind === 'crew' ? [150, 30, 30] : [60, 30, 25], o.kind === 'crew' ? 0.65 : 0.6); else this.untintMod(o); } }
  charAll() { for (const g of [this.GH, this.GT]) for (const v of g.list) { if (!g.mat[v]) continue; g.burn[v] = Math.min(1, g.burn[v] + (g.mat[v] === 2 ? 0.85 : 0.5)); } }
}

return { VS, D2R, G, CAT, TANKS, getTemplate, Tank, penAt, ammoObj, ricChance, effThick, elevFor, toW, toL, dW, setRz, axisAngle, mul3, nrm, hash, vnoise, clamp, lerp, gCenter, gAt, lightNormal, SEAT_NAMES, linkCol };
});
