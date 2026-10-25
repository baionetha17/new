// Gerador de mapa compartilhado: mesma semente = mesmo mapa no servidor e em todos os navegadores.
// Terreno plano de 500 x 500 m com campos, estradas e objetos destrutíveis em voxels de 10 cm (o mesmo do tanque).
// As mudanças nos objetos (furos, atropelos, desabamento, queda de árvore, fogo) também ficam aqui: o servidor aplica,
// manda só a operação, e cada navegador repete a mesma conta e chega no mesmo resultado.
(function (root, f) { if (typeof module === 'object' && module.exports) module.exports = f(); else root.MAPGEN = f(); })(typeof self !== 'undefined' ? self : this, function () {
'use strict';
const PVS = 0.1, SIZE = 500, HALF = 250, CELL = 10, NC = SIZE / CELL;
// materiais
const LEAF = 1, TRUNK = 2, WALL = 3, TILE = 4, HAY = 5, WOOD = 6, STONE = 7, FLOOR = 8, RUBBLE = 9, THATCH = 10, SAND = 11, METAL = 12, GLASS = 13, RUBBER = 14, DIRT = 15, BRICK = 16, CLOTH = 17, LOG = 18;
// mm de penetração perdidos por metro atravessado, convertidos para cada voxel
const RES_M = [0, 1.2, 48, 80, 12, 4, 16, 90, 8, 60, 6, 120, 30, 2, 20, 50, 85, 3, 40];
const RES = RES_M.map(v => v * PVS);
const OPAC = [0, 0.03, 1, 1, 1, 1, 0.4, 0.45, 1, 1, 1, 1, 1, 0.1, 1, 1, 1, 1, 1];   // quanto cada voxel tapa a visão
const SOFT = [0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];              // folha e feno: miolo oco
const BURN = [0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1];           // o que pega fogo (madeira, assoalho, palha, pano, toras)
// segundos que o voxel aguenta no fogo depois que as chamas chegam nele (varia ±40% por voxel); tora de parede quase não some, só escurece
const BURN_T = [0, 4, 0, 0, 0, 6, 50, 0, 150, 0, 25, 0, 0, 0, 0, 0, 0, 10, 600];
const HARD = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0];              // alvenaria: o tanque passa bem devagar
const RUBBLE_Z = 0.55;                                                       // altura a que a esteira amassa o entulho

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function h3(i, j, k, s) { let h = (i * 374761393 + j * 668265263 + k * 1274126177 + s * 1103515245) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
// ruído suave 3D (valor nos cantos de uma grade, interpolado)
function vn3(x, y, z, s) { const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z), u = x - i, v = y - j, w = z - k;
  const a = u * u * (3 - 2 * u), b = v * v * (3 - 2 * v), c = w * w * (3 - 2 * w), L = (p, q, t) => p + (q - p) * t;
  return L(L(L(h3(i, j, k, s), h3(i + 1, j, k, s), a), L(h3(i, j + 1, k, s), h3(i + 1, j + 1, k, s), a), b),
           L(L(h3(i, j, k + 1, s), h3(i + 1, j, k + 1, s), a), L(h3(i, j + 1, k + 1, s), h3(i + 1, j + 1, k + 1, s), a), b), c); }
const mix = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

const THEMES = {
  kursk: { name: 'Prokhorovka, Kursk (1943)', short: 'Kursk',
    crops: [[176, 160, 96], [190, 172, 104], [122, 128, 72], [112, 94, 66], [98, 118, 62], [150, 140, 80]],
    road: [138, 116, 86], wall: [214, 208, 192], roof: [[158, 128, 74], [142, 112, 62]], roofKind: 'thatch', shutter: [[70, 110, 150], [92, 132, 92]],
    truck: [[84, 92, 58], [78, 84, 56]], trees: ['birch', 'birch', 'oak', 'birch'], belts: 0.32, hedges: 0, villages: 2, hay: 22, loose: 16 },
  normandia: { name: 'Bocage da Normandia (1944)', short: 'Normandia',
    crops: [[92, 124, 62], [104, 134, 68], [112, 94, 70], [170, 155, 95], [86, 116, 58], [120, 140, 74]],
    road: [128, 112, 90], wall: [176, 166, 144], roof: [[78, 82, 92], [150, 82, 58]], roofKind: 'tile', shutter: [[64, 96, 70], [120, 76, 60]],
    truck: [[96, 98, 94], [150, 140, 96]], trees: ['oak', 'oak', 'apple', 'pine'], belts: 0.12, hedges: 0.36, villages: 2, hay: 8, loose: 22 }
};

// ---------------------------------------------------------------- grade de voxels de um objeto
// LITE: o servidor não precisa das cores, só do material (gasta um quarto da memória)
let LITE = false;
function newProp(kind, x0, y0, nx, ny, nz) { const n = nx * ny * nz;
  if (n >= 1 << 21) throw new Error('objeto grande demais: ' + kind);
  const C = () => LITE ? null : new Uint8Array(n);
  return { kind, x0, y0, z0: 0, nx, ny, nz, n, mat: new Uint8Array(n), cr: C(), cg: C(), cb: C() }; }
function put(pr, i, j, k, m, c, jit, s) { const idx = (k * pr.ny + j) * pr.nx + i; pr.mat[idx] = m; if (!pr.cr) return;
  const v = jit ? (h3(i, j, k, s || 1) - .5) * jit : 0; pr.cr[idx] = Math.max(0, Math.min(255, c[0] + v)); pr.cg[idx] = Math.max(0, Math.min(255, c[1] + v)); pr.cb[idx] = Math.max(0, Math.min(255, c[2] + v * 0.8)); }
// tira o miolo de folhas e feno que ninguém vê
function hollow(pr) { const { nx, ny, nz, mat } = pr; const kill = [];
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) { const idx = (k * ny + j) * nx + i; const m = mat[idx]; if (!SOFT[m]) continue;
    if (mat[idx + 1] && mat[idx - 1] && mat[idx + nx] && mat[idx - nx] && mat[idx + nx * ny] && mat[idx - nx * ny]) kill.push(idx); }
  for (const idx of kill) mat[idx] = 0; }
function finish(pr) { const L = []; let solid = 0, top = 0;
  for (let i = 0; i < pr.n; i++) if (pr.mat[i]) { L.push(i); if (!SOFT[pr.mat[i]]) solid++; const k = (i / (pr.nx * pr.ny)) | 0; if (k > top) top = k; }
  pr.list = Int32Array.from(L); if (pr.solid0 === undefined) pr.solid0 = solid; pr.solid = solid;
  pr.bb = [pr.x0, pr.y0, pr.x0 + pr.nx * PVS, pr.y0 + pr.ny * PVS, (top + 1) * PVS];
  pr.ver = (pr.ver || 0) + 1;
  return pr; }
// árvores iguais dividem a mesma grade até alguém mexer nelas
function own(pr) { if (pr.shared) { pr.mat = pr.mat.slice(); pr.shared = false; } }
function ownColors(pr) { if (pr.sharedCol && pr.cr) { pr.cr = pr.cr.slice(); pr.cg = pr.cg.slice(); pr.cb = pr.cb.slice(); pr.sharedCol = false; } }
function idxOf(pr, i, j, k) { return (k * pr.ny + j) * pr.nx + i; }

// ---------------------------------------------------------------- árvores
const TREE_T = {};
function treeTemplate(type, variant) {
  const key = type + variant + (LITE ? 'L' : ''); if (TREE_T[key]) return TREE_T[key];
  const s = 9137 + variant * 7717 + type.length * 131, r = mulberry32(s);
  let tr, cr, crz, cz, top, leaf, bark;
  if (type === 'birch') { tr = 0.13; cr = 1.6 + r() * 0.6; crz = 2.7 + r() * 0.7; cz = 5.2 + r() * 1.0; top = cz + crz; leaf = [108, 150, 64]; bark = [226, 226, 216]; }
  else if (type === 'pine') { tr = 0.19; cr = 1.9 + r() * 0.4; crz = 0; cz = 1.8; top = 8.8 + r() * 2.2; leaf = [44, 80, 54]; bark = [104, 74, 52]; }
  else if (type === 'apple') { tr = 0.15; cr = 1.5 + r() * 0.4; crz = 1.2 + r() * 0.3; cz = 2.6 + r() * 0.3; top = cz + crz; leaf = [88, 130, 58]; bark = [92, 74, 56]; }
  else { tr = 0.28; cr = 2.3 + r() * 0.7; crz = 2.0 + r() * 0.5; cz = 4.7 + r() * 0.8; top = cz + crz; leaf = [64, 104, 48]; bark = [86, 70, 54]; }
  const half = Math.ceil((cr + 0.5) / PVS), nx = half * 2, nz = Math.ceil((top + 0.4) / PVS);
  const pr = newProp('tree', -half * PVS, -half * PVS, nx, nx, nz);
  // galhos: segmentos do tronco até a copa
  const br = []; const nb = type === 'pine' ? 0 : 5 + ((r() * 3) | 0);
  for (let b = 0; b < nb; b++) { const a = r() * Math.PI * 2, z0 = cz - crz * (0.3 + r() * 0.5), L = cr * (0.6 + r() * 0.3), up = crz * (0.2 + r() * 0.5);
    br.push([0, 0, z0, Math.cos(a) * L, Math.sin(a) * L, z0 + up, 0.05 + r() * 0.04]); }
  const segD2 = (px, py, pz, g) => { const ex = g[3] - g[0], ey = g[4] - g[1], ez = g[5] - g[2], L2 = ex * ex + ey * ey + ez * ez;
    let t = ((px - g[0]) * ex + (py - g[1]) * ey + (pz - g[2]) * ez) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = px - g[0] - ex * t, dy = py - g[1] - ey * t, dz = pz - g[2] - ez * t; return [dx * dx + dy * dy + dz * dz, t]; };
  const fruit = type === 'apple';
  for (let k = 0; k < nz; k++) for (let j = 0; j < nx; j++) for (let i = 0; i < nx; i++) {
    const px = (i + .5) * PVS - half * PVS, py = (j + .5) * PVS - half * PVS, pz = (k + .5) * PVS, rr = Math.hypot(px, py);
    const n = h3(i, j, k, s), cl = vn3(px / 0.75, py / 0.75, pz / 0.75, s + 1);
    let inCrown = false;
    if (type === 'pine') { if (pz > cz) { const f = (pz - cz) / (top - cz), tier = ((pz - cz) / 1.05) % 1; const R = cr * (1 - f) * (0.62 + 0.38 * (1 - tier)); inCrown = rr < R + 0.15 - 0.35 * cl - n * 0.12 && (tier > 0.12 || rr < 0.35); } }
    else { const e = Math.sqrt((px * px + py * py) / (cr * cr) + ((pz - cz) / crz) ** 2); inCrown = e < 0.74 + 0.42 * cl - 0.1 * n; }
    // tronco
    const trunkTop = type === 'pine' ? top - 0.8 : cz + crz * 0.2, trR = tr * (1 - 0.35 * pz / trunkTop) + (pz < 0.4 ? 0.06 * (0.4 - pz) / 0.4 : 0);
    if (rr < trR && pz < trunkTop) { let c = bark;
      if (type === 'birch') { const dash = h3(k >> 1, Math.floor((Math.atan2(py, px) + 3.2) * 2.2), 0, s); c = dash > 0.8 ? [44, 44, 40] : bark; }
      else c = mix(bark, 0.85 + 0.25 * ((Math.atan2(py, px) * 3 + pz * 0.7) % 1 + 1) % 1);
      put(pr, i, j, k, TRUNK, c, 12, s); continue; }
    let onBranch = false; for (const g of br) { const [d2, t] = segD2(px, py, pz, g), rad = g[6] * (1 - 0.6 * t); if (d2 < rad * rad) { onBranch = true; break; } }
    if (onBranch) { put(pr, i, j, k, TRUNK, mix(bark, type === 'birch' ? 0.62 : 0.9), 12, s); continue; }
    if (inCrown) { const hf = type === 'pine' ? (pz - cz) / (top - cz) : (pz - cz + crz) / (2 * crz), shade = (0.78 + 0.28 * hf) * (0.82 + 0.3 * cl);
      const c = fruit && n > 0.985 ? [196, 58, 40] : mix(leaf, shade); put(pr, i, j, k, LEAF, c, 30, s); }
  }
  hollow(pr); finish(pr);
  pr.tree = type; pr.crownR = cr; pr.trunkR = tr;
  return (TREE_T[key] = pr);
}
function tree(x, y, type, s) { return instance(treeTemplate(type, s & 3), x, y, { crush: true, foot: [x - 0.5, y - 0.5, x + 0.5, y + 0.5] }); }
function instance(t, x, y, extra) {
  const pr = { kind: t.kind, tree: t.tree, crownR: t.crownR, trunkR: t.trunkR, x0: x + t.x0, y0: y + t.y0, z0: 0, nx: t.nx, ny: t.ny, nz: t.nz, n: t.n,
    mat: t.mat, cr: t.cr, cg: t.cg, cb: t.cb, list: t.list, solid0: t.solid0, solid: t.solid, shared: true, sharedCol: true, tpl: t, ver: 1, cx: x, cy: y };
  pr.bb = [pr.x0, pr.y0, pr.x0 + t.nx * PVS, pr.y0 + t.ny * PVS, t.bb[4]];
  return Object.assign(pr, extra); }

// ---------------------------------------------------------------- casas e celeiros com cômodos, andares, móveis e janelas
// Montada em voxels inteiros num sistema local (u ao longo da cumeeira, v atravessando) e girada no fim se precisar.
// pr.nav guarda cômodos, portas, janelas e escadas em coordenadas do mundo (para tropas, no futuro);
// pr.win guarda os vidros de cada janela, para estilhaçar a janela inteira de uma vez.
const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
// seno e cosseno das 32 direções, arredondados para todo navegador gerar a mesma casa
const COS32 = [], SIN32 = []; for (let q = 0; q < 32; q++) { COS32.push(Math.round(Math.cos(q * Math.PI / 16) * 1e9) / 1e9); SIN32.push(Math.round(Math.sin(q * Math.PI / 16) * 1e9) / 1e9); }
function building(cx, cy, W, D, q32, front, T, s, barn) {
  const r = mulberry32(s), thatch = T.roofKind === 'thatch';
  const nf = barn ? 1 : thatch ? (r() < 0.25 ? 2 : 1) : (r() < 0.6 ? 2 : 1), log = thatch && nf === 2 && !barn;
  const WT = thatch && !log ? 3 : 4, IT = 2, ST = barn ? 34 : 28, wallK = nf * ST;
  const Wn = Math.round(W / PVS), Dn = Math.round(D / PVS), Mg = 6, nu = Wn + 2 * Mg, nv = Dn + 2 * Mg;
  const ha = Dn / 2 + 4, rh = Math.round(Dn * (thatch ? 0.5 : 0.42)), RT = thatch ? 4 : 2, ovU = thatch ? 4 : 3, nz = wallK + rh + 12;
  const pr = newProp(barn ? 'barn' : 'house', cx - nu * PVS / 2, cy - nv * PVS / 2, nu, nv, nz), mat = pr.mat;
  const U0 = Mg, U1 = Mg + Wn, V0 = Mg, V1 = Mg + Dn, iu0 = U0 + WT, iu1 = U1 - WT, iv0 = V0 + WT, iv1 = V1 - WT;
  const pick = a => a[(r() * a.length) | 0];
  const roofC = pick(T.roof), wallC = T.wall.map(v => v - r() * 16), shutC = pick(T.shutter), shutters = thatch || r() < 0.6;
  const plaster = thatch ? [232, 226, 210] : [214, 206, 188], woodC = [118, 90, 62], frameC = thatch ? shutC : [226, 222, 210], glassC = [58, 74, 88], logC = [134, 100, 66];
  const at = (i, j, k) => (k * nv + j) * nu + i;
  const inG = (i, j, k) => i >= 0 && j >= 0 && k >= 0 && i < nu && j < nv && k < nz;
  const set = (i, j, k, m, c, jit) => { if (inG(i, j, k)) { if (m) put(pr, i, j, k, m, c, jit === undefined ? 8 : jit, s); else mat[at(i, j, k)] = 0; } };
  const box = (i0, i1, j0, j1, k0, k1, m, col, jit) => { for (let k = k0; k < k1; k++) for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) set(i, j, k, m, typeof col === 'function' ? col(i, j, k) : col, jit); };
  const clear = (i0, i1, j0, j1, k0, k1) => box(i0, i1, j0, j1, k0, k1, 0);
  const roofK = j => wallK + rh * (1 - Math.abs(j + .5 - nv / 2) / ha);          // altura do telhado (em voxels) na fileira j
  const base = f => f === 0 ? 1 : f * ST, ceilK = f => f === nf - 1 ? wallK - 1 : (f + 1) * ST - 2;   // chão e teto livres de cada andar
  // paredes externas: face 0 é v baixo, 1 v alto, 2 u baixo, 3 u alto; a = posição ao longo da face, t = camada de fora para dentro
  const faceIJ = (face, a, t) => face === 0 ? [a, V0 + t] : face === 1 ? [a, V1 - 1 - t] : face === 2 ? [U0 + t, a] : [U1 - 1 - t, a];
  const FN = [[0, -1], [0, 1], [-1, 0], [1, 0]], fFront = front > 0 ? 1 : 0, fBack = 1 - fFront;
  const stone = (al, pz, quoin, bc) => { const rowH = 0.22, row = Math.floor(pz / rowH), off = h3(row, 0, 0, s) * 0.4, sl = 0.32 + 0.2 * h3(row, 1, 0, s);
    const st = Math.floor((al + off) / sl), fu = ((al + off) / sl) % 1, fz = (pz / rowH) % 1;
    return fu < 0.1 || fz < 0.14 ? [196, 188, 170] : mix(quoin ? [196, 186, 160] : bc, 0.82 + 0.26 * h3(row, st, 2, s)); };
  const extCol = (a, t, k, dc) => { const pz = (k + .5) * PVS;
    if (t === WT - 1 && k < wallK && !barn) return mix(plaster, 0.95 + 0.06 * h3(a >> 2, k >> 2, 7, s));
    if (log) return dc < 2 && t === 0 ? [96, 72, 50] : mix(logC, (k % 2 ? 1 : 0.8) * (0.9 + 0.16 * h3(k >> 1, a >> 3, 3, s)));
    if (thatch) { if (pz < 0.45) return pz > 0.4 ? [120, 94, 68] : [150, 118, 84]; return mix(wallC, 0.94 + 0.08 * vn3(a * PVS / 0.5, t, pz / 0.5, s)); }
    return stone(a * PVS, pz, dc < 4, wallC); };
  const WM = log ? LOG : WALL;
  for (let k = 0; k < wallK; k++) for (let j = V0; j < V1; j++) for (let i = U0; i < U1; i++) {
    const tu = Math.min(i - U0, U1 - 1 - i), tv = Math.min(j - V0, V1 - 1 - j), t = Math.min(tu, tv); if (t >= WT) continue;
    const gable = tu < tv; set(i, j, k, WM, extCol(gable ? j : i, t, k, gable ? tv : tu), thatch ? 8 : 10); }
  // frente e fundos sobem até encostar no beiral
  for (let j = V0; j < V1; j++) { const tv = Math.min(j - V0, V1 - 1 - j); if (tv >= WT) continue; const kt = Math.ceil(roofK(j) - RT - 0.5);
    for (let k = wallK; k < kt; k++) for (let i = U0; i < U1; i++) set(i, j, k, log ? LOG : WALL, extCol(i, Math.min(tv, WT - 2), k, 9), 8); }
  // empenas: as pontas sobem até o telhado (tábuas em Kursk, pedra na Normandia)
  for (let j = V0; j < V1; j++) { const top = roofK(j) - RT * 0.5;
    for (let k = wallK; k < top; k++) for (let t = 0; t < WT; t++) for (const i of [U0 + t, U1 - 1 - t]) {
      if (thatch) set(i, j, k, LOG, mix([128, 98, 66], ((j >> 1) & 1 ? 0.88 : 1) * (j % 2 ? 1 : 0.84)), 8); else set(i, j, k, WALL, extCol(j, Math.min(t, WT - 2), k, 9), 10); } }
  // assoalho, piso de cima com vigas e forro
  const board = (i, j, k) => mix([104, 78, 54], (j % 2 ? 1 : 0.84) * (0.9 + 0.14 * h3(j >> 1, (i / 14) | 0, k, s)));
  if (barn) box(iu0, iu1, iv0, iv1, 0, 1, DIRT, (i, j) => mix([112, 94, 66], 0.82 + 0.26 * h3(i, j, 0, s)), 6);
  else box(iu0, iu1, iv0, iv1, 0, 1, FLOOR, board, 6);
  for (let f = 1; f < nf; f++) { const k0 = f * ST - 2; box(iu0, iu1, iv0, iv1, k0 + 1, k0 + 2, FLOOR, board, 6);
    for (let i = iu0; i < iu1; i++) if ((i - iu0) % 8 < 2) box(i, i + 1, iv0, iv1, k0, k0 + 1, WOOD, [88, 66, 46], 6); }
  if (!barn) box(iu0, iu1, iv0, iv1, wallK - 1, wallK, FLOOR, (i, j) => mix([150, 120, 84], 0.9 + 0.12 * h3(i >> 1, (j / 12) | 0, 9, s)), 6);
  // cômodos: o comprimento é cortado por paredes internas (as mesmas nos dois andares, uma em cima da outra)
  const L = iu1 - iu0, nR = barn ? 1 : L >= 72 ? 3 : L >= 46 ? 2 : 1; let cuts = [];
  if (nR === 2) cuts = [iu0 + Math.round(L * (0.42 + 0.16 * r()))];
  if (nR === 3) cuts = [iu0 + Math.round(L * (0.3 + 0.06 * r())), iu0 + Math.round(L * (0.62 + 0.06 * r()))];
  if (nf === 2 && cuts.length) { cuts[0] = Math.max(cuts[0], iu0 + 34); if (cuts[1] && cuts[1] - cuts[0] < 26) cuts.pop(); if (iu1 - cuts[cuts.length - 1] < 24) cuts.pop(); }
  const spans = []; { let u = iu0; for (const c of cuts) { spans.push([u, c]); u = c + IT; } spans.push([u, iu1]); }
  const kindsG = barn ? ['celeiro'] : spans.length === 1 ? ['cozinha'] : nf === 2 ? (spans.length === 3 ? ['entrada', 'cozinha', 'sala'] : ['sala', 'cozinha'])
    : spans.length === 3 ? ['entrada', 'cozinha', 'quarto'] : ['cozinha', 'quarto'];
  const intM = log ? LOG : WALL, intCol = (i, j, k) => log ? mix([150, 116, 78], (k % 2 ? 1 : 0.86)) : mix(plaster, 0.93 + 0.07 * h3(i >> 2, j >> 2, k >> 2, s));
  const rooms = [], doors = [], wins = [], stairs = [];
  const bandLo = fBack === 0 ? iv0 : iv1 - 9, bandHi = bandLo + 9;               // faixa da escada, encostada na parede de trás
  const doorPos = (lo, hi, avoid) => { const ok = []; for (let a = lo; a <= hi; a++) if (!avoid || a + 9 + 2 <= avoid[0] || a >= avoid[1] + 2) ok.push(a); return ok.length ? ok[(r() * ok.length) | 0] : -1; };
  for (let f = 0; f < nf; f++) { const b = base(f), top = ceilK(f);
    for (const c of cuts) box(c, c + IT, iv0, iv1, b, top, intM, intCol, 6);
    spans.forEach((sp, q) => rooms.push({ id: rooms.length, f, u0: sp[0], u1: sp[1], v0: iv0, v1: iv1, b, top, kind: f === 0 ? kindsG[q] : 'quarto', q }));
    // portas internas entre cômodos vizinhos (fora da faixa da escada)
    cuts.forEach((c, q) => { const a = doorPos(iv0 + 2, iv1 - 11, nf === 2 && q === 0 ? [bandLo, bandHi] : null); if (a < 0) return; clear(c, c + IT, a, a + 9, b, b + 20);
      doors.push({ f, u: c + IT / 2, v: a + 4.5, k0: b, k1: b + 20, w: 9, n: [1, 0], a: -1, b: -1 }); }); }
  // o último cômodo do térreo às vezes é dividido em frente e fundos
  if (!barn && spans.length >= 2 && iv1 - iv0 >= 56 && r() < 0.5) { const R = rooms.find(R => R.f === 0 && R.q === spans.length - 1), cv = iv0 + Math.round((iv1 - iv0) * (0.45 + 0.1 * r()));
    box(R.u0, R.u1, cv, cv + IT, R.b, R.top, intM, intCol, 6);
    const R2 = { id: rooms.length, f: 0, u0: R.u0, u1: R.u1, v0: cv + IT, v1: R.v1, b: R.b, top: R.top, kind: 'quarto', q: R.q }; R.v1 = cv; rooms.push(R2);
    if (fFront === 1) { const t = R.kind; R.kind = R2.kind; R2.kind = t; }      // o cômodo da frente fica com o uso original
    const a = doorPos(R.u0 + 2, R.u1 - 11); if (a >= 0) { clear(a, a + 9, cv, cv + IT, R.b, R.b + 20); doors.push({ f: 0, u: a + 4.5, v: cv + 1, k0: R.b, k1: R.b + 20, w: 9, n: [0, 1], a: R.id, b: R2.id }); } }
  const roomAt = (f, u, v) => rooms.find(R => R.f === f && u >= R.u0 && u < R.u1 && v >= R.v0 && v < R.v1);
  for (const d of doors) if (d.n[0]) { const A = roomAt(d.f, d.u - 2, d.v), B = roomAt(d.f, d.u + 2, d.v); d.a = A ? A.id : -1; d.b = B ? B.id : -1; }
  // escada reta de madeira no primeiro cômodo, subindo ao longo da parede de trás
  let us = -1;
  if (nf === 2) { us = iu0 + 2; const stc = [152, 114, 76];
    clear(us + 6, us + 28, bandLo, bandHi, ST - 2, ST);
    for (let q = 0; q < 14; q++) box(us + 2 * q, us + 2 * q + 2, bandLo, bandHi, Math.max(1, 2 * q - 1), 2 * q + 2, WOOD, (i, j, k) => mix(stc, k === 2 * q + 1 ? 1.06 : 0.84), 6);
    const rj = fBack === 0 ? bandHi : bandLo - 1;
    for (let i = us + 5; i < us + 28; i++) { if ((i - us) % 5 === 0) box(i, i + 1, rj, rj + 1, ST, ST + 9, WOOD, [104, 78, 52], 4); set(i, rj, ST + 9, WOOD, [124, 94, 62], 4); }
    for (let j = bandLo; j < bandHi; j++) { if ((j - bandLo) % 4 === 0) box(us + 5, us + 6, j, j + 1, ST, ST + 9, WOOD, [104, 78, 52], 4); set(us + 5, j, ST + 9, WOOD, [124, 94, 62], 4); }
    const R0 = roomAt(0, us, bandLo), R1 = roomAt(1, us + 27, bandLo);
    stairs.push({ u0: us, u1: us + 28, v0: bandLo, v1: bandHi, k0: 1, k1: ST, a: R0 && R0.id, b: R1 && R1.id }); }
  // portas de fora
  const extDoor = (face, a0, w, k1, leaf, room) => {
    for (let a = a0; a < a0 + w; a++) for (let t = 0; t < WT; t++) for (let k = 1; k < k1; k++) { const [i, j] = faceIJ(face, a, t); set(i, j, k, 0); }
    const mid = WT >> 1;
    if (leaf) for (let a = a0; a < a0 + w; a++) for (let k = 1; k < k1; k++) { const [i, j] = faceIJ(face, a, mid), pl = a - a0;
      if (a === a0 || a === a0 + w - 1 || k === k1 - 1) { set(i, j, k, WOOD, [70, 52, 38], 6); continue; }
      set(i, j, k, WOOD, mix(thatch ? shutC : woodC, ((pl >> 1) & 1 ? 0.9 : 1) * (pl % 2 ? 1 : 0.84)), 6);
      if (pl === w - 3 && k === 11) set(i, j, k, METAL, [40, 40, 38], 0); }
    for (let a = a0 - 1; a < a0 + w + 1; a++) for (const t of [-1, -2]) { const [i, j] = faceIJ(face, a, t); set(i, j, 0, STONE, [150, 144, 132], 10); }
    const c = faceIJ(face, a0 + w / 2, 0); doors.push({ u: face < 2 ? a0 + w / 2 : c[0], v: face < 2 ? c[1] : a0 + w / 2, k0: 1, k1, w, n: FN[face], a: room ? room.id : -1, b: -1, out: true, leaf, face, a0 }); };
  const g0 = rooms.filter(R => R.f === 0);
  const touchF = (R, face) => face === 0 ? R.v0 === iv0 : face === 1 ? R.v1 === iv1 : face === 2 ? R.u0 === iu0 : R.u1 === iu1;
  if (barn) extDoor(fFront, Math.round((iu0 + iu1) / 2 - 14), 28, 29, false, g0[0]);
  else { const R = g0.find(R => touchF(R, fFront)), a = Math.max(R.u0 + 2, Math.min(R.u1 - 12, R.u0 + Math.round((R.u1 - R.u0 - 10) * (0.3 + 0.4 * r())))); extDoor(fFront, a, 10, 22, true, R);
    if (!thatch && r() < 0.45) { const Rb = g0.filter(R => touchF(R, fBack)).pop(); if (Rb && Rb.u1 - Rb.u0 > 16 && Rb !== g0[0]) extDoor(fBack, Rb.u1 - 13, 10, 22, true, Rb); } }
  // fogão (forno russo em Kursk, lareira na Normandia): decide antes das janelas, para não pôr janela atrás dele
  const kit = rooms.find(R => R.kind === 'cozinha'); let hearth = null;
  if (kit) { if (thatch) hearth = { side: touchF(kit, fBack) ? fBack : fFront, w: 15, d: 15, end: r() < 0.5 };
    else { const g = touchF(kit, 2) ? 2 : touchF(kit, 3) ? 3 : -1; hearth = g >= 0 ? { side: g, w: 14, d: 5, mid: true } : { side: fBack, w: 14, d: 5, end: false }; } }
  // janelas
  const window_ = (face, ac, k0, k1, room, glass) => { const a0 = ac - 4, a1 = ac + 5, mid = WT >> 1, idx = [];
    for (let a = a0; a < a1; a++) for (let t = 0; t < WT; t++) for (let k = k0; k < k1; k++) { const [i, j] = faceIJ(face, a, t); set(i, j, k, 0); }
    if (glass) for (let a = a0; a < a1; a++) for (let k = k0; k < k1; k++) { const [i, j] = faceIJ(face, a, mid);
      if (a === a0 || a === a1 - 1 || k === k0 || k === k1 - 1 || a === ac || k === k0 + 6) set(i, j, k, WOOD, frameC, 6);
      else { set(i, j, k, GLASS, (a + k) % 6 === 0 ? [128, 146, 156] : glassC, 6); idx.push(at(i, j, k)); } }
    for (let a = a0 - 1; a < a1 + 1; a++) { const [i, j] = faceIJ(face, a, -1); set(i, j, k0 - 1, WOOD, [92, 72, 52], 6); }
    if (!thatch) for (let a = a0 - 1; a < a1 + 1; a++) for (let t = 0; t < WT - 1; t++) { const [i, j] = faceIJ(face, a, t); set(i, j, k1, WALL, [202, 194, 174], 8); }
    if (glass && shutters) for (const [p0, p1] of [[a0 - 5, a0 - 1], [a1 + 1, a1 + 5]]) for (let a = p0; a < p1; a++) for (let k = k0; k < k1; k++) { const [i, j] = faceIJ(face, a, -1); set(i, j, k, WOOD, mix(shutC, (k >> 1) & 1 ? 0.92 : 1), 6); }
    const c = faceIJ(face, ac + 0.5, 0); wins.push({ face, ac, a0, a1, k0, k1, room: room.id, glass, idx, u: face < 2 ? ac + 0.5 : c[0], v: face < 2 ? c[1] : ac + 0.5 }); };
  for (const R of rooms) { const b = R.b, wk0 = b + (barn ? 18 : 9), wk1 = b + (barn ? 26 : 19);
    for (const face of [0, 1]) { if (!touchF(R, face)) continue; const span = R.u1 - R.u0, nw = barn ? Math.max(1, Math.floor(span / 34)) : span >= 38 ? 2 : span >= 16 ? 1 : 0;
      for (let q = 0; q < nw; q++) { const ac = Math.round(R.u0 + span * (q + .5) / nw);
        if (R.f === 0 && doors.some(d => d.out && d.face === face && ac + 10 > d.a0 && ac - 10 < d.a0 + d.w)) continue;
        if (R.f === 0 && nf === 2 && face === fBack && ac < us + 30 && ac > us - 6) continue;
        if (hearth && R === kit && hearth.side === face) continue;
        window_(face, ac, wk0, wk1, R, !barn); } }
    for (const face of [2, 3]) { if (!touchF(R, face) || R.v1 - R.v0 < 18) continue; if (hearth && R === kit && hearth.side === face) continue;
      window_(face, Math.round((R.v0 + R.v1) / 2), wk0, wk1, R, !barn); } }
  // ---- telhado (por cima de tudo que já foi feito)
  for (let j = 0; j < nv; j++) { const dv = Math.abs(j + .5 - nv / 2); if (dv > ha) continue; const rz = roofK(j);
    for (let k = Math.max(0, Math.ceil(rz - RT - 0.5)); k <= Math.floor(rz - 0.5) && k < nz; k++) for (let i = U0 - ovU; i < U1 + ovU; i++) {
      const n = h3(i, j, k, s), pl = (i + .5 - nu / 2) * PVS, ap = dv * PVS, H = ha * PVS, al = Math.abs(pl), gx = (U1 + ovU - nu / 2) * PVS;
      let c; if (thatch) { const strand = h3(Math.floor(pl / 0.07), 0, 0, s), course = ((H - ap) / 0.42) % 1;
        c = mix(roofC, (0.84 + 0.22 * strand) * (course < 0.1 + 0.08 * strand ? 0.92 : 1) * (ap < 0.3 ? 0.78 : 1) * (al > gx - 0.12 ? 0.85 : 1)); }
      else { const row = Math.floor((H - ap) / 0.26), fr = ((H - ap) / 0.26) % 1, col = Math.floor((pl + (row & 1) * 0.11) / 0.22), v = h3(row, col, 0, s);
        c = mix(roofC, (fr < 0.22 ? 0.72 : 0.9 + 0.16 * v) * (ap < 0.22 ? 0.8 : 1)); }
      set(i, j, k, thatch ? THATCH : TILE, c, thatch ? 20 : 8); } }
  // ---- móveis: cada andar tem um mapa do chão ocupado (paredes, portas, escada) e outro da parede (janelas)
  const occ = [], tall = []; for (let f = 0; f < nf; f++) { occ.push(new Uint8Array(nu * nv)); tall.push(new Uint8Array(nu * nv)); }
  const markA = (A, i0, i1, j0, j1) => { for (let j = Math.max(0, j0); j < Math.min(nv, j1); j++) for (let i = Math.max(0, i0); i < Math.min(nu, i1); i++) A[j * nu + i] = 1; };
  const freeA = (A, i0, i1, j0, j1) => { for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) if (A[j * nu + i]) return false; return true; };
  for (let f = 0; f < nf; f++) { for (let j = iv0; j < iv1; j++) for (let i = iu0; i < iu1; i++) if (mat[at(i, j, base(f))]) occ[f][j * nu + i] = 1;   // paredes, escada, fogão
    for (const d of doors) { const R = rooms[d.a] || rooms[d.b]; if (!R || R.f !== f) continue; markA(occ[f], Math.floor(d.u - 9), Math.ceil(d.u + 9), Math.floor(d.v - 9), Math.ceil(d.v + 9)); }
    for (const w of wins) { const R = rooms[w.room]; if (R.f !== f) continue; markA(tall[f], Math.floor(w.u - 7), Math.ceil(w.u + 7), Math.floor(w.v - 7), Math.ceil(w.v + 7)); } }
  if (nf === 2) { markA(occ[0], us - 1, us + 31, bandLo - 2, bandHi + 2); markA(occ[1], us + 4, us + 29, bandLo - 2, bandHi + 2); markA(tall[0], us - 1, us + 31, bandLo - 2, bandHi + 2); }
  const FR = (R, side, off) => side === 0 ? (p, q) => [R.u0 + off + p, R.v0 + q] : side === 1 ? (p, q) => [R.u0 + off + p, R.v1 - 1 - q] : side === 2 ? (p, q) => [R.u0 + q, R.v0 + off + p] : (p, q) => [R.u1 - 1 - q, R.v0 + off + p];
  const sideLen = (R, side) => side < 2 ? R.u1 - R.u0 : R.v1 - R.v0;
  // encosta um móvel w x d numa parede; build(B, ij) desenha no sistema do móvel: p ao longo da parede, q para dentro, k a partir do chão
  const place = (R, w, d, isTall, build, sides, offs) => { for (let tries = 0; tries < 16; tries++) {
      const side = sides ? sides[(r() * sides.length) | 0] : (r() * 4) | 0, len = sideLen(R, side); if (len < w + 2) continue;
      const off = offs !== undefined ? (offs < 0 ? len - w - 1 : offs) : 1 + ((r() * (len - w - 1)) | 0), ij = FR(R, side, off);
      const a = ij(0, 0), e = ij(w - 1, d - 1), i0 = Math.min(a[0], e[0]), i1 = Math.max(a[0], e[0]) + 1, j0 = Math.min(a[1], e[1]), j1 = Math.max(a[1], e[1]) + 1;
      if (i0 < R.u0 || j0 < R.v0 || i1 > R.u1 || j1 > R.v1 || !freeA(occ[R.f], i0, i1, j0, j1) || (isTall && !freeA(tall[R.f], i0, i1, j0, j1))) continue;
      markA(occ[R.f], i0, i1, j0, j1); if (isTall) markA(tall[R.f], i0, i1, j0, j1);
      const b0 = R.b; build((p, q, k, m, c, jit) => { const [i, j] = ij(p, q); set(i, j, b0 + k, m, c, jit === undefined ? 6 : jit); }, ij); return true; }
    return false; };
  // na parede, acima dos móveis: quadros e prateleiras (não ocupam o chão)
  const onWall = (R, w, k0, k1, build) => { for (let tries = 0; tries < 12; tries++) { const side = (r() * 4) | 0, len = sideLen(R, side); if (len < w + 4) continue;
      const off = 2 + ((r() * (len - w - 3)) | 0), ij = FR(R, side, off); let ok = true;
      for (let p = 0; p < w && ok; p++) { const [i, j] = ij(p, 0); if (tall[R.f][j * nu + i]) ok = false;
        for (let k = k0; k < k1 && ok; k++) if (mat[at(i, j, R.b + k)]) ok = false;
        const bk = FR(R, side, off)(p, -1); if (!mat[at(bk[0], bk[1], R.b + k0)]) ok = false; }
      if (!ok) continue; const a = ij(0, 0), e = ij(w - 1, 0); markA(tall[R.f], Math.min(a[0], e[0]), Math.max(a[0], e[0]) + 1, Math.min(a[1], e[1]), Math.max(a[1], e[1]) + 1);
      build((p, q, k, m, c, jit) => { const [i, j] = ij(p, q); set(i, j, R.b + k, m, c, jit === undefined ? 4 : jit); }); return true; } return false; };
  const WD = [112, 82, 56], WDk = [86, 62, 42];
  const bed = B => { const bc = pick([[150, 60, 50], [70, 90, 130], [120, 110, 70], [96, 120, 80], [140, 120, 150]]);
    for (let q = 0; q < 20; q++) for (let p = 0; p < 10; p++) {
      if ((p === 0 || p === 9) && (q === 0 || q === 19)) B(p, q, 0, WOOD, WDk);
      B(p, q, 1, WOOD, WD); B(p, q, 2, CLOTH, [214, 206, 190], 10);
      if (q < 5) { if (p > 0 && p < 9) B(p, q, 3, CLOTH, [234, 230, 222], 6); }
      else B(p, q, 3, CLOTH, mix(bc, (p === 0 || p === 9 ? 0.8 : 1) * ((q >> 1) % 3 === 0 ? 0.86 : 1)), 10); }
    for (let p = 0; p < 10; p++) for (let k = 1; k < 9; k++) B(p, 0, k, WOOD, mix(WDk, k === 8 ? 1.2 : 1)); };
  const wardrobe = B => { for (let q = 0; q < 5; q++) for (let p = 0; p < 10; p++) for (let k = 0; k < 19; k++) { if (k === 0 && q === 4 && p > 0 && p < 9) continue;
      B(p, q, k, WOOD, mix(WD, (p === 4 || p === 5) && q === 4 ? 0.78 : k === 18 ? 1.15 : q === 4 && (k === 2 || k === 17) ? 0.9 : 1)); }
    B(3, 5, 10, METAL, [180, 160, 100], 0); B(6, 5, 10, METAL, [180, 160, 100], 0); };
  const dresser = B => { const pl = [[226, 224, 216], [90, 112, 168], [204, 190, 150], [170, 70, 60]];
    for (let q = 0; q < 4; q++) for (let p = 0; p < 12; p++) { for (let k = 0; k < 8; k++) B(p, q, k, WOOD, mix(WD, k === 7 ? 1.12 : q === 3 && (p === 6 || k === 3) ? 0.8 : 1));
      for (const k of [12, 16, 19]) B(p, q, k, WOOD, mix(WD, 1.08)); }
    for (let p = 0; p < 12; p++) for (let k = 8; k < 19; k++) B(p, 0, k, WOOD, WDk);
    for (let p = 1; p < 11; p += 2) for (const k of [8, 9, 13, 14, 17]) if (r() < 0.6) B(p, 1, k, TILE, pick(pl), 6); };
  const bench = B => { for (let p = 0; p < 16; p++) for (let q = 0; q < 4; q++) { B(p, q, 4, WOOD, mix(WD, 1.05)); if (p === 1 || p === 14) for (let k = 0; k < 4; k++) B(p, q, k, WOOD, WDk); } };
  const chest = B => { for (let p = 0; p < 9; p++) for (let q = 0; q < 5; q++) for (let k = 0; k < 6; k++) B(p, q, k, WOOD, mix([120, 76, 46], k === 5 ? 1.15 : k === 2 ? 0.8 : 1)); B(4, 5, 4, METAL, [60, 60, 56], 0); };
  const shelf = B => { for (let p = 0; p < 10; p++) for (let q = 0; q < 3; q++) for (const k of [0, 4]) B(p, q, k, WOOD, mix(WD, 1.1));
    for (let p = 1; p < 9; p += 2) for (const k of [1, 5]) if (r() < 0.65) B(p, 1, k, r() < 0.5 ? TILE : GLASS, pick([[226, 224, 216], [140, 96, 60], [90, 120, 90], [200, 160, 80]]), 6); };
  const picture = (w, h, gold) => B => { const sky = pick([[120, 150, 180], [180, 150, 110], [90, 110, 80]]);
    for (let p = 0; p < w; p++) for (let k = 0; k < h; k++) { const edge = p === 0 || p === w - 1 || k === 0 || k === h - 1;
      B(p, 0, k, WOOD, edge ? (gold ? [196, 160, 70] : [70, 50, 32]) : gold ? (k > h / 2 ? [180, 60, 40] : [210, 170, 90]) : k < h / 2 ? mix([92, 120, 70], 0.9 + 0.2 * h3(p, k, 3, s)) : mix(sky, 0.9 + 0.2 * h3(p, k, 5, s)), 4); } };
  // mesa solta no meio do cômodo, com cadeiras
  const table = (R, cloth) => { for (let tries = 0; tries < 10; tries++) {
      const tw = 12, td = 8, cu = Math.round((R.u0 + R.u1) / 2 + (r() - 0.5) * (R.u1 - R.u0 - 30)), cv = Math.round((R.v0 + R.v1) / 2 + (r() - 0.5) * (R.v1 - R.v0 - 26));
      const i0 = cu - 6, j0 = cv - 4; if (i0 - 5 < R.u0 || j0 - 5 < R.v0 || i0 + tw + 5 > R.u1 || j0 + td + 5 > R.v1 || !freeA(occ[R.f], i0 - 5, i0 + tw + 5, j0 - 5, j0 + td + 5)) continue;
      markA(occ[R.f], i0 - 5, i0 + tw + 5, j0 - 5, j0 + td + 5); const b = R.b, tc = mix(WD, 1.05);
      for (let j = j0; j < j0 + td; j++) for (let i = i0; i < i0 + tw; i++) { set(i, j, b + 7, WOOD, tc, 6); if (cloth) set(i, j, b + 8, CLOTH, (i + j) % 4 === 0 ? [200, 70, 60] : [232, 228, 218], 4); }
      for (const [i, j] of [[i0, j0], [i0 + tw - 1, j0], [i0, j0 + td - 1], [i0 + tw - 1, j0 + td - 1]]) box(i, i + 1, j, j + 1, b, b + 7, WOOD, WDk, 4);
      const chair = (ci, cj, bi, bj) => { box(ci, ci + 4, cj, cj + 4, b + 4, b + 5, WOOD, tc, 4); for (const [a, e] of [[0, 0], [3, 0], [0, 3], [3, 3]]) box(ci + a, ci + a + 1, cj + e, cj + e + 1, b, b + 4, WOOD, WDk, 4);
        box(ci + (bi > 0 ? 3 : 0), ci + (bi > 0 ? 4 : bi < 0 ? 1 : 4), cj + (bj > 0 ? 3 : 0), cj + (bj > 0 ? 4 : bj < 0 ? 1 : 4), b + 5, b + 10, WOOD, WD, 4); };
      chair(i0 + 1, j0 - 4, 0, -1); chair(i0 + tw - 5, j0 + td, 0, 1); if (r() < 0.7) chair(i0 + 1, j0 + td, 0, 1); if (r() < 0.5) chair(i0 - 4, j0 + 2, -1, 0); if (r() < 0.5) chair(i0 + tw, j0 + 2, 1, 0);
      return true; } return false; };
  const rug = R => { const w = Math.round((R.u1 - R.u0) * 0.55), d = Math.round((R.v1 - R.v0) * 0.5), i0 = Math.round((R.u0 + R.u1 - w) / 2), j0 = Math.round((R.v0 + R.v1 - d) / 2), k = R.b - 1, c1 = pick([[150, 50, 46], [70, 80, 120], [120, 96, 50]]), c2 = [214, 196, 150];
    for (let j = j0; j < j0 + d; j++) for (let i = i0; i < i0 + w; i++) { if (!mat[at(i, j, k)]) continue; const e = Math.min(i - i0, i0 + w - 1 - i, j - j0, j0 + d - 1 - j); set(i, j, k, CLOTH, e === 1 || e === 3 ? c2 : mix(c1, ((i + j) % 6 < 2 ? 0.85 : 1)), 6); } };
  // chaminé de tijolo do fogão até passar do telhado
  const chimney = (i0, i1, j0, j1, k0) => { let kt = 0; for (let j = j0; j < j1; j++) kt = Math.max(kt, Math.ceil(roofK(j)) + 7);
    for (let k = k0; k < Math.min(nz, kt); k++) for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) { const row = k, brick = ((((i + j) * 10 + (row & 1) * 12) / 24) | 0) & 1;
      set(i, j, k, BRICK, k >= kt - 1 ? [70, 66, 62] : k % 2 === 0 && (i + j + row) % 5 === 0 ? [168, 160, 150] : brick ? [140, 74, 56] : [124, 66, 50], 10); }
    for (let f = 0; f < nf; f++) markA(occ[f], i0, i1, j0, j1); };
  if (hearth) { const R = kit, hs = hearth;
    if (thatch) place(R, 15, 15, true, (B, ij) => { const wc = [232, 228, 216];
        for (let p = 0; p < 15; p++) for (let q = 0; q < 15; q++) for (let k = 0; k < 18; k++) { if (p >= 5 && p < 10 && q >= 10 && k >= 6 && k < 11) continue; B(p, q, k, BRICK, mix(wc, q === 14 && k === 5 ? 0.86 : k === 17 ? 1.02 : 1), 8); }
        for (let p = 5; p < 10; p++) for (let k = 6; k < 11; k++) B(p, 9, k, BRICK, [40, 34, 30], 4);
        const a = ij(2, 2), e = ij(6, 6); chimney(Math.min(a[0], e[0]), Math.max(a[0], e[0]) + 1, Math.min(a[1], e[1]), Math.max(a[1], e[1]) + 1, R.b + 18); }, [hs.side], hs.end ? -1 : 1);
    else place(R, 14, 5, true, (B, ij) => { const sc = [154, 144, 126];
        for (let p = 0; p < 14; p++) for (let q = 0; q < 5; q++) for (let k = 0; k < 13; k++) { if (p >= 4 && p < 10 && q >= 1 && k < 8) continue; B(p, q, k, STONE, mix(sc, 0.86 + 0.2 * h3(p >> 1, k >> 1, q, s)), 10); }
        for (let p = 4; p < 10; p++) for (let k = 0; k < 8; k++) B(p, 1, k, STONE, [36, 30, 26], 4);
        for (let p = -1; p < 15; p++) for (let q = 0; q < 6; q++) B(p, q, 13, WOOD, WDk, 4);
        const a = ij(4, 0), e = ij(9, 3); chimney(Math.min(a[0], e[0]), Math.max(a[0], e[0]) + 1, Math.min(a[1], e[1]), Math.max(a[1], e[1]) + 1, R.b + 14); },
      [hs.side], hs.mid ? Math.round((sideLen(R, hs.side) - 14) / 2) : 2); }
  const kursk = thatch;
  for (const R of rooms) { const big = (R.u1 - R.u0) * (R.v1 - R.v0) > 900;
    if (R.kind === 'celeiro') continue;
    if (R.kind === 'sala' || (R.kind === 'quarto' && big && r() < 0.5)) rug(R);
    if (R.kind === 'quarto') { place(R, 10, 20, false, bed); if (big && r() < 0.5) place(R, 10, 20, false, bed); place(R, 10, 5, true, wardrobe); if (r() < 0.6) place(R, 9, 5, false, chest); }
    if (R.kind === 'cozinha') { table(R, kursk && r() < 0.5); if (kursk) { place(R, 16, 4, false, bench); onWall(R, 10, 12, 18, shelf); } else place(R, 12, 4, true, dresser); }
    if (R.kind === 'sala') { table(R, r() < 0.4); place(R, 12, 4, true, kursk ? wardrobe : dresser); if (r() < 0.6) place(R, 16, 4, false, bench); }
    if (R.kind === 'entrada') { place(R, 16, 4, false, bench); if (r() < 0.7) place(R, 9, 5, false, chest); onWall(R, 10, 12, 18, shelf); }
    const np = R.kind === 'entrada' ? 0 : 1 + (r() < 0.5 ? 1 : 0);
    for (let q = 0; q < np; q++) { const w = 4 + ((r() * 3) | 0); onWall(R, w, 14, 14 + w + 1, picture(w, w + 1, false)); }
    if (kursk && R.kind !== 'entrada' && R.f === 0 && r() < 0.6) onWall(R, 3, 19, 23, picture(3, 4, true)); }
  // celeiro: montes de feno, baias de madeira
  if (barn) { const R = rooms[0];
    for (let q = 0; q < 2; q++) { const ci = q ? R.u1 - 18 : R.u0 + 18, cj = fBack === 0 ? R.v0 + 14 : R.v1 - 14, rr = 15 + r() * 4, hh = 17 + r() * 5;
      for (let k = R.b; k < R.b + hh; k++) for (let j = cj - 20; j < cj + 20; j++) for (let i = ci - 20; i < ci + 20; i++) { const e = ((i - ci) ** 2 + (j - cj) ** 2) / (rr * rr) + ((k - R.b) / hh) ** 2, cl = vn3(i / 4, j / 4, k / 4, s);
        if (e < 0.9 + 0.2 * cl && i >= R.u0 && i < R.u1 && j >= R.v0 && j < R.v1) set(i, j, k, HAY, mix([206, 176, 98], 0.78 + 0.25 * cl), 22); } }
    const st0 = Math.round((R.u0 + R.u1) / 2 - 22);
    for (let u = st0; u <= st0 + 44; u += 16) for (let q = 0; q < 16; q++) { const j = fBack === 0 ? R.v0 + q : R.v1 - 1 - q; for (let k = R.b; k < R.b + 12; k++) set(u, j, k, WOOD, mix([120, 92, 62], (k % 3 ? 1 : 0.85)), 6); } }
  finish(pr);
  pr.block = false; pr.crush = false; pr.struct = true; pr.cutK = barn ? 23 : 19; pr.settleN = 0;
  // 32 direções: gira a grade montada (q = 0 é o cume ao longo de x)
  const q = ((q32 % 32) + 32) % 32, ca = COS32[q], sa = SIN32[q];
  const ex = Math.abs(ca) * W / 2 + Math.abs(sa) * D / 2 + 0.1, ey = Math.abs(sa) * W / 2 + Math.abs(ca) * D / 2 + 0.1;
  pr.foot = [cx - ex, cy - ey, cx + ex, cy + ey]; pr.ang = q;
  pr.rubbleC = [wallC, roofC, woodC];
  // sistema local → mundo
  const lx0 = cx - nu * PVS / 2, ly0 = cy - nv * PVS / 2;
  const W2 = (u, v) => { const x = lx0 + u * PVS - cx, y = ly0 + v * PVS - cy; return [r2(cx + x * ca - y * sa), r2(cy + x * sa + y * ca)]; };
  const N2 = n => [r3(n[0] * ca - n[1] * sa), r3(n[0] * sa + n[1] * ca)];
  const C2 = (u0, u1, v0, v1) => [W2(u0, v0), W2(u1, v0), W2(u1, v1), W2(u0, v1)];
  const B2 = (u0, u1, v0, v1) => { const c = C2(u0, u1, v0, v1), xs = c.map(p => p[0]), ys = c.map(p => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
  const src = q ? rotateA(pr, cx, cy, ca, sa) : null;
  let idxW = w => Int32Array.from(w.idx);
  if (src) { const wn = new Map(); wins.forEach((w, n) => { if (w.glass) for (const a of w.idx) wn.set(a, n); });
    const got = wins.map(() => []); for (let t = 0; t < src.length; t++) { const a = src[t]; if (a < 0) continue; const n = wn.get(a); if (n !== undefined && pr.mat[t] === GLASS) got[n].push(t); }
    idxW = w => Int32Array.from(got[wins.indexOf(w)]); }
  pr.win = wins.filter(w => w.glass).map(w => { const p = W2(w.u, w.v); return { idx: idxW(w), c: [p[0], p[1], r2((w.k0 + w.k1) / 2 * PVS)], broken: false }; });
  let gi = 0;
  pr.nav = { floors: nf, floorZ: Array.from({ length: nf }, (_, f) => r2(base(f) * PVS)),
    rooms: rooms.map(R => ({ id: R.id, floor: R.f, kind: R.kind, box: B2(R.u0, R.u1, R.v0, R.v1), poly: C2(R.u0, R.u1, R.v0, R.v1), z0: r2(R.b * PVS), z1: r2(R.top * PVS) })),
    doors: doors.map(d => { const p = W2(d.u, d.v); return { x: p[0], y: p[1], z0: r2(d.k0 * PVS), z1: r2(d.k1 * PVS), w: r2(d.w * PVS), n: N2(d.n), a: d.a, b: d.b, out: !!d.out, leaf: !!d.leaf }; }),
    windows: wins.map(w => { const p = W2(w.u, w.v); return { x: p[0], y: p[1], z0: r2(w.k0 * PVS), z1: r2(w.k1 * PVS), w: 0.9, n: N2(FN[w.face]), room: w.room, glass: w.glass ? gi++ : -1 }; }),
    stairs: stairs.map(t => ({ box: B2(t.u0, t.u1, t.v0, t.v1), poly: C2(t.u0, t.u1, t.v0, t.v1), z0: 0.1, z1: r2(t.k1 * PVS), up: N2([1, 0]), from: t.a, to: t.b })) };
  pr.cx = cx; pr.cy = cy;
  return pr;
}
// gira um objeto 90° (troca x por y) depois de montado
function rotate90(pr, cx, cy) {
  const { nx, ny, nz } = pr, o = newProp(pr.kind, cx - ny * PVS / 2, cy - nx * PVS / 2, ny, nx, nz);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const a = (k * ny + j) * nx + i; if (!pr.mat[a]) continue;
    const b = (k * nx + i) * ny + (ny - 1 - j); o.mat[b] = pr.mat[a]; if (o.cr) { o.cr[b] = pr.cr[a]; o.cg[b] = pr.cg[a]; o.cb[b] = pr.cb[a]; } }
  Object.assign(pr, { x0: o.x0, y0: o.y0, nx: ny, ny: nx, mat: o.mat, cr: o.cr, cg: o.cg, cb: o.cb }); pr.solid0 = undefined; finish(pr);
}

// gira um objeto por um ângulo qualquer; cada voxel novo copia o voxel de origem mais perto
// (e, se ele estiver vazio, um dos cantos), para parede fina não abrir frestas na diagonal. Devolve a origem de cada voxel.
function rotateA(pr, cx, cy, ca, sa) {
  const { nx, ny, nz } = pr, w = nx * PVS, h = ny * PVS, ex = Math.abs(ca) * w / 2 + Math.abs(sa) * h / 2, ey = Math.abs(sa) * w / 2 + Math.abs(ca) * h / 2;
  const mx = Math.ceil(ex * 2 / PVS - 1e-6), my = Math.ceil(ey * 2 / PVS - 1e-6), o = newProp(pr.kind, cx - mx * PVS / 2, cy - my * PVS / 2, mx, my, nz);
  const lx0 = pr.x0 - cx, ly0 = pr.y0 - cy, nxy = nx * ny, oxy = mx * my, src = new Int32Array(o.n).fill(-1);
  const OFF = [[0, 0], [-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]], col = new Int32Array(5);
  for (let j = 0; j < my; j++) for (let i = 0; i < mx; i++) { let nc = 0;
    for (const [du, dv] of OFF) { const x = o.x0 - cx + (i + .5 + du) * PVS, y = o.y0 - cy + (j + .5 + dv) * PVS;
      const si = Math.floor((x * ca + y * sa - lx0) / PVS), sj = Math.floor((-x * sa + y * ca - ly0) / PVS);
      if (si >= 0 && sj >= 0 && si < nx && sj < ny) col[nc++] = sj * nx + si; }
    if (!nc) continue;
    for (let k = 0; k < nz; k++) { let a = -1; for (let c = 0; c < nc; c++) { const b = k * nxy + col[c]; if (pr.mat[b]) { a = b; break; } } if (a < 0) continue;
      const t = k * oxy + j * mx + i; o.mat[t] = pr.mat[a]; src[t] = a; if (o.cr) { o.cr[t] = pr.cr[a]; o.cg[t] = pr.cg[a]; o.cb[t] = pr.cb[a]; } } }
  Object.assign(pr, { x0: o.x0, y0: o.y0, nx: mx, ny: my, n: o.n, mat: o.mat, cr: o.cr, cg: o.cg, cb: o.cb }); pr.solid0 = undefined; finish(pr);
  return src;
}

// ---------------------------------------------------------------- muros, cercas e sebes, sempre alinhados com x ou y
function linear(kind, ax, ay, len, alongX, s) {
  const th = kind === 'hedge' ? 1.3 : kind === 'wall' ? 0.5 : 0.2, hgt = kind === 'hedge' ? 1.8 : kind === 'wall' ? 1.05 : 1.2;
  const L = Math.ceil(len / PVS), Tn = Math.ceil(th / PVS), nz = Math.ceil((hgt + 0.5) / PVS);
  const nx = alongX ? L : Tn, ny = alongX ? Tn : L;
  const pr = newProp(kind, ax - (alongX ? 0 : th / 2), ay - (alongX ? th / 2 : 0), nx, ny, nz);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const u = alongX ? i : j, v = alongX ? j : i, pz = (k + .5) * PVS, n = h3(i, j, k, s), along = (u + .5) * PVS, vv = (v + .5) * PVS - th / 2;
    if (kind === 'wall') { // pedra seca com musgo por cima
      const rowH = 0.2, row = Math.floor(pz / rowH), off = h3(row, 0, 0, s) * 0.3, sl = 0.28 + 0.2 * h3(row, 3, 0, s), st = Math.floor((along + off) / sl);
      const top = hgt - 0.18 * h3(Math.floor(along / 0.5), 0, 0, s); if (pz > top) continue;
      const fu = ((along + off) / sl) % 1, fz = (pz / rowH) % 1, bulge = 0.04 * h3(row, st, 1, s);
      if (Math.abs(vv) > th / 2 - (fu < 0.12 || fz < 0.15 ? 0.04 : 0) + bulge - 0.05) continue;
      const moss = pz > top - 0.22 && vn3(along / 0.4, vv / 0.4, pz / 0.4, s) > 0.55;
      put(pr, i, j, k, STONE, moss ? [92, 112, 70] : fu < 0.12 || fz < 0.15 ? [104, 100, 92] : mix([138, 132, 120], 0.82 + 0.3 * h3(row, st, 2, s)), 14, s); }
    else if (kind === 'fence') { // cerca de tábuas: postes, duas travessas e ripas
      const pm = along % 2.0, post = pm < 0.13, rail = (Math.abs(pz - 0.42) < 0.05 || Math.abs(pz - 0.98) < 0.05) && Math.abs(vv) < 0.05;
      const slat = (along % 0.16) < 0.09 && Math.abs(vv - 0.06) < 0.05 && pz > 0.12 && pz < 1.12 - 0.06 * ((along / 0.16 | 0) & 1);
      if (post && pz < hgt + 0.08 && Math.abs(vv) < 0.07) { put(pr, i, j, k, WOOD, [92, 70, 50], 10, s); continue; }
      if (rail) { put(pr, i, j, k, WOOD, [110, 84, 58], 10, s); continue; }
      if (slat) put(pr, i, j, k, WOOD, mix([132, 104, 72], 0.85 + 0.25 * h3(Math.floor(along / 0.16), 0, 0, s)), 10, s); }
    else { // sebe: arbustos fechados, com raminhos na base
      const top = hgt - 0.55 * vn3(along / 0.9, 0, 0, s), cl = vn3(along / 0.45, vv / 0.45, pz / 0.45, s + 3);
      const half = th / 2 - 0.25 * (pz / hgt) * cl;
      if (pz > top + 0.25 * (cl - 0.5) || Math.abs(vv) > half) continue;
      if (pz < 0.35 && n > 0.86) { put(pr, i, j, k, TRUNK, [74, 60, 44], 10, s); continue; }
      put(pr, i, j, k, LEAF, mix([60, 98, 46], 0.78 + 0.4 * cl * (0.75 + 0.35 * pz / hgt)), 18, s); }
  }
  hollow(pr); finish(pr);
  pr.crush = true; pr.foot = [pr.x0, pr.y0, pr.x0 + nx * PVS, pr.y0 + ny * PVS];
  pr.cx = pr.x0 + nx * PVS / 2; pr.cy = pr.y0 + ny * PVS / 2;
  return pr;
}

// ---------------------------------------------------------------- objetos soltos
// arbusto redondo: bola achatada e cheia de calombos, com uns galhos na base; o tanque passa por cima
function bush(x, y, s, dry) {
  const r = mulberry32(s), R = 0.55 + r() * 0.55, Hh = R * (1.1 + r() * 0.5), half = Math.ceil((R + 0.25) / PVS), nz = Math.ceil((Hh + 0.3) / PVS), base = dry ? [92, 104, 52] : [58, 96, 44];
  const pr = newProp('bush', x - half * PVS, y - half * PVS, half * 2, half * 2, nz);
  for (let k = 0; k < nz; k++) for (let j = 0; j < half * 2; j++) for (let i = 0; i < half * 2; i++) {
    const px = (i + .5 - half) * PVS, py = (j + .5 - half) * PVS, pz = (k + .5) * PVS, cl = vn3(px / 0.35, py / 0.35, pz / 0.35, s), n = h3(i, j, k, s);
    const e = (px * px + py * py) / (R * R) + ((pz - Hh * 0.45) / (Hh * 0.58)) ** 2; if (e > 0.78 + 0.45 * cl) continue;
    if (pz < 0.25 && n > 0.8) { put(pr, i, j, k, TRUNK, [80, 64, 46], 10, s); continue; } if (pz < 0.12) continue;
    const f = !dry && n > 0.993 ? [214, 200, 120] : mix(base, 0.72 + 0.45 * cl * (0.7 + 0.4 * pz / Hh)); put(pr, i, j, k, LEAF, f, 22, s); }
  hollow(pr); finish(pr); pr.crush = true; pr.foot = [x - R, y - R, x + R, y + R]; pr.cx = x; pr.cy = y; return pr; }
function haystack(x, y, s) {
  const r = mulberry32(s), R = 1.3 + r() * 0.5, Hh = 2.0 + r() * 0.5, half = Math.ceil((R + 0.2) / PVS), nz = Math.ceil((Hh + 0.6) / PVS);
  const pr = newProp('hay', x - half * PVS, y - half * PVS, half * 2, half * 2, nz);
  for (let k = 0; k < nz; k++) for (let j = 0; j < half * 2; j++) for (let i = 0; i < half * 2; i++) {
    const px = (i + .5 - half) * PVS, py = (j + .5 - half) * PVS, pz = (k + .5) * PVS, rr = Math.hypot(px, py);
    if (rr < 0.05 && pz < Hh + 0.5) { put(pr, i, j, k, WOOD, [96, 74, 52], 4, s); continue; }                // vara no meio
    const a = Math.atan2(py, px), sag = 0.12 * vn3(a * 2, pz / 0.5, 0, s), e = rr * rr / (R * R) + (pz / Hh) ** 2;
    if (e < 1 - sag) { const strand = h3(Math.floor((a + 3.2) * 18), Math.floor(pz / 0.3), 0, s);
      put(pr, i, j, k, HAY, mix([206, 176, 98], (0.78 + 0.18 * pz / Hh) * (0.9 + 0.18 * strand) * (pz < 0.25 ? 0.8 : 1)), 22, s); } }
  hollow(pr); finish(pr);
  pr.crush = true; pr.foot = [x - R, y - R, x + R, y + R]; pr.cx = x; pr.cy = y;
  return pr;
}
// trincheira de sacos de areia em U
function sandbags(x, y, face, s) {
  const R = 2.3 + mulberry32(s)() * 0.5, TH = 0.5, HG = 0.8, half = Math.ceil((R + 0.4) / PVS), nz = Math.ceil((HG + 0.2) / PVS);
  const pr = newProp('sand', x - half * PVS, y - half * PVS, half * 2, half * 2, nz);
  for (let k = 0; k < nz; k++) for (let j = 0; j < half * 2; j++) for (let i = 0; i < half * 2; i++) {
    const px = (i + .5 - half) * PVS, py = (j + .5 - half) * PVS, pz = (k + .5) * PVS, rr = Math.hypot(px, py);
    let a = Math.atan2(py, px) - face; while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI;
    if (Math.abs(a) > 2.3 || Math.abs(rr - R) > TH / 2) continue;
    const course = Math.floor(pz / 0.2), L = a * R + 10 + (course & 1) * 0.25, bag = Math.floor(L / 0.5), fu = (L / 0.5) % 1, fz = (pz / 0.2) % 1;
    const round = Math.min(fu, 1 - fu) < 0.12 && fz > 0.75;   // cantos arredondados de cada saco
    if (pz > HG || round) continue;
    const seam = Math.min(fu, 1 - fu) < 0.06 || fz < 0.1, v = h3(course, bag, 0, s);
    put(pr, i, j, k, SAND, mix([180, 160, 116], (seam ? 0.78 : 0.9 + 0.18 * v)), 12, s); }
  finish(pr);
  pr.crush = true; pr.foot = [x - R - 0.3, y - R - 0.3, x + R + 0.3, y + R + 0.3]; pr.cx = x; pr.cy = y;
  return pr;
}
// carroça de madeira de duas rodas (às vezes com feno)
function cart(x, y, alongX, flip, hay, s) {
  const Lb = 2.6, Wb = 1.3, nx = Math.ceil(5.2 / PVS), ny = Math.ceil(2.0 / PVS), nz = Math.ceil((hay ? 2.3 : 1.4) / PVS);
  const pr = newProp('cart', x - nx * PVS / 2, y - ny * PVS / 2, nx, ny, nz);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const px = ((i + .5) * PVS - nx * PVS / 2) * flip, py = (j + .5) * PVS - ny * PVS / 2, pz = (k + .5) * PVS, ay = Math.abs(py);
    // rodas: aro, raios e cubo
    if (Math.abs(ay - 0.78) < 0.05) { const wx = px - 0.1, wz = pz - 0.62, rw = Math.hypot(wx, wz), an = Math.atan2(wz, wx);
      if ((rw < 0.62 && rw > 0.52) || rw < 0.1 || (rw < 0.55 && Math.abs(Math.sin(an * 4)) < 0.16)) { put(pr, i, j, k, WOOD, rw > 0.6 ? [60, 56, 50] : [100, 76, 52], 8, s); continue; } }
    if (Math.abs(px - 0.1) < 0.05 && Math.abs(pz - 0.62) < 0.05 && ay < 0.8) { put(pr, i, j, k, WOOD, [80, 62, 44], 4, s); continue; }       // eixo
    if (Math.abs(px) < Lb / 2 && ay < Wb / 2) {
      if (pz > 0.7 && pz < 0.82) { put(pr, i, j, k, WOOD, mix([130, 100, 68], (Math.floor(px / 0.2) & 1) ? 0.9 : 1), 8, s); continue; }         // assoalho
      if (pz >= 0.82 && pz < 1.2 && (ay > Wb / 2 - 0.08 || Math.abs(px) > Lb / 2 - 0.08)) { put(pr, i, j, k, WOOD, mix([120, 92, 62], (Math.floor(pz / 0.12) & 1) ? 0.88 : 1), 8, s); continue; }
      if (hay && pz >= 0.82) { const e = (px / (Lb / 2)) ** 2 + (py / (Wb / 2 + 0.1)) ** 2 + ((pz - 0.82) / 1.3) ** 2, cl = vn3(px / 0.4, py / 0.4, pz / 0.4, s);
        if (e < 0.9 + 0.2 * cl) put(pr, i, j, k, HAY, mix([206, 176, 98], 0.82 + 0.25 * cl), 22, s); continue; } }
    // varais para o cavalo
    if (px > Lb / 2 && px < Lb / 2 + 2.0 && Math.abs(ay - 0.45) < 0.05) { const zz = 0.76 - (px - Lb / 2) * 0.12; if (Math.abs(pz - zz) < 0.05) put(pr, i, j, k, WOOD, [104, 80, 56], 8, s); }
  }
  if (hay) hollow(pr);
  finish(pr);
  pr.crush = true; pr.foot = [pr.x0 + 0.5, pr.y0 + 0.2, pr.x0 + nx * PVS - 0.5, pr.y0 + ny * PVS - 0.2];
  if (!alongX) { rotate90(pr, x, y); pr.foot = [pr.x0 + 0.2, pr.y0 + 0.5, pr.x0 + pr.nx * PVS - 0.2, pr.y0 + pr.ny * PVS - 0.5]; }
  pr.cx = x; pr.cy = y;
  return pr;
}
// caminhão abandonado (GAZ-AA em Kursk, Opel Blitz na Normandia)
function truck(x, y, alongX, flip, T, s) {
  const r = mulberry32(s), body = T.truck[(r() * T.truck.length) | 0], burnt = r() < 0.3, cover = T.roofKind === 'tile';
  const nx = Math.ceil(6.6 / PVS), ny = Math.ceil(2.6 / PVS), nz = Math.ceil((cover ? 3.0 : 2.5) / PVS);
  const pr = newProp('truck', x - nx * PVS / 2, y - ny * PVS / 2, nx, ny, nz);
  const paint = c => burnt ? mix([58, 50, 44], 0.8 + 0.4 * (c[0] / 255)) : c;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const px = ((i + .5) * PVS - nx * PVS / 2) * flip, py = (j + .5) * PVS - ny * PVS / 2, pz = (k + .5) * PVS, ay = Math.abs(py), n = h3(i, j, k, s);
    const rust = n > 0.9 && vn3(px / 0.6, py / 0.6, pz / 0.6, s) > 0.55;
    const B = c => paint(rust ? [120, 70, 44] : c);
    // rodas
    for (const wx of [2.0, -1.3, -2.15]) { if (Math.abs(ay - 0.92) < 0.13 && Math.hypot(px - wx, pz - 0.46) < 0.46) {
      const rw = Math.hypot(px - wx, pz - 0.46); put(pr, i, j, k, rw < 0.2 ? METAL : RUBBER, rw < 0.2 ? [70, 70, 66] : burnt ? [26, 24, 22] : [34, 34, 32], 6, s); break; } }
    if (pr.mat[idxOf(pr, i, j, k)]) continue;
    // chassi
    if (pz > 0.58 && pz < 0.72 && ay > 0.38 && ay < 0.5 && px > -3.1 && px < 3.0) { put(pr, i, j, k, METAL, [40, 40, 38], 4, s); continue; }
    // para-lamas da frente
    if (px > 1.45 && px < 2.6 && ay > 0.75 && ay < 1.08) { const fz = 0.5 + Math.sqrt(Math.max(0, 0.3 - (px - 2.0) ** 2)) + 0.05; if (pz > fz - 0.08 && pz < fz + 0.02 && pz > 0.6) { put(pr, i, j, k, METAL, B(mix(body, 0.85)), 6, s); continue; } }
    // capô com grade
    if (px > 1.6 && px < 3.05 && ay < 0.62 && pz > 0.72 && pz < 1.55 - (px - 1.6) * 0.08) {
      const shell = ay > 0.52 || pz > 1.45 - (px - 1.6) * 0.08 || px > 2.95; if (!shell) continue;
      put(pr, i, j, k, METAL, px > 2.95 ? (Math.floor(pz / 0.08) & 1 ? [44, 44, 42] : paint([96, 96, 90])) : B(mix(body, ay > 0.52 ? 0.95 : 1.05)), 6, s); continue; }
    // faróis
    if (px > 2.55 && px < 2.8 && Math.abs(ay - 0.85) < 0.1 && Math.abs(pz - 1.05) < 0.1) { put(pr, i, j, k, GLASS, burnt ? [40, 40, 40] : [210, 206, 170], 0, s); continue; }
    // cabine
    if (px > 0.35 && px < 1.6 && ay < 1.0 && pz > 0.72 && pz < 2.2) {
      const shell = ay > 0.9 || pz > 2.1 || px < 0.45 || px > 1.5; if (!shell) { if (pz < 1.15 && px > 0.6 && px < 1.0) put(pr, i, j, k, METAL, [50, 44, 38], 4, s); continue; }
      const win = pz > 1.45 && pz < 2.02 && ((px > 1.5 && ay < 0.85) || (ay > 0.9 && px > 0.7 && px < 1.45));
      if (win) { if (!burnt && n > 0.25) put(pr, i, j, k, GLASS, ((px + pz) % 0.5) < 0.07 ? [130, 146, 150] : [58, 72, 82], 4, s); continue; }
      put(pr, i, j, k, cover ? METAL : WOOD, B(mix(body, pz > 2.1 ? 1.08 : 1)), 6, s); continue; }
    // carroceria de madeira
    if (px > -3.2 && px < 0.3 && ay < 1.1) {
      if (pz > 0.72 && pz < 0.86) { put(pr, i, j, k, WOOD, paint(mix([118, 96, 66], (Math.floor(py / 0.2) & 1) ? 0.9 : 1)), 8, s); continue; }
      if (pz >= 0.86 && pz < 1.45 && (ay > 1.0 || px < -3.1 || px > 0.2)) { put(pr, i, j, k, WOOD, paint(mix(cover ? body : [112, 90, 62], (Math.floor(pz / 0.15) & 1) ? 0.9 : 1)), 8, s); continue; }
      if (cover && pz >= 1.45) { const arch = 1.45 + 1.25 * Math.sqrt(Math.max(0, 1 - (py / 1.1) ** 2)); if (pz < arch && pz > arch - 0.12) { put(pr, i, j, k, WOOD, paint(mix([128, 118, 84], 0.9 + 0.15 * vn3(px / 0.5, py / 0.5, pz / 0.5, s) - ((px + 3.2) % 0.9 < 0.08 ? 0.12 : 0))), 10, s); continue; }
        if ((px < -3.1 || px > 0.2) && pz < arch && n > 0.4) { put(pr, i, j, k, WOOD, paint([118, 108, 78]), 10, s); continue; } } }
  }
  finish(pr);
  pr.block = true; pr.crush = false;
  pr.foot = [x - 3.2, y - 1.15, x + 3.2, y + 1.15];
  if (!alongX) { rotate90(pr, x, y); pr.foot = [x - 1.15, y - 3.2, x + 1.15, y + 3.2]; }
  pr.cx = x; pr.cy = y;
  return pr;
}
// poste de telégrafo
function pole(x, y, s) {
  const H = 6.6, half = 9, nz = Math.ceil((H + 0.3) / PVS);
  const pr = newProp('pole', x - half * PVS, y - half * PVS, half * 2, half * 2, nz);
  for (let k = 0; k < nz; k++) for (let j = 0; j < half * 2; j++) for (let i = 0; i < half * 2; i++) {
    const px = (i + .5 - half) * PVS, py = (j + .5 - half) * PVS, pz = (k + .5) * PVS;
    if (Math.hypot(px, py) < 0.11 && pz < H) { put(pr, i, j, k, WOOD, mix([96, 78, 58], 0.9 + 0.15 * h3(k >> 2, 0, 0, s)), 6, s); continue; }
    // travessa atravessada na linha (os fios correm ao longo de x, junto da estrada)
    if (Math.abs(pz - (H - 0.4)) < 0.05 && Math.abs(px) < 0.05 && Math.abs(py) < 0.75) { put(pr, i, j, k, WOOD, [86, 68, 50], 6, s); continue; }
    if (Math.abs(pz - (H - 0.3)) < 0.06 && Math.abs(px) < 0.05 && [-0.65, -0.3, 0.3, 0.65].some(v => Math.abs(py - v) < 0.05)) put(pr, i, j, k, GLASS, [208, 214, 206], 0, s); }
  finish(pr);
  pr.crush = true; pr.foot = [x - 0.2, y - 0.2, x + 0.2, y + 0.2]; pr.cx = x; pr.cy = y; pr.trunkR = 0.11;
  return pr;
}
// borda de terra revirada em volta de uma cratera (só visual, cada navegador monta a sua)
function craterRim(x, y, r, s) {
  const R = r * 1.45, half = Math.ceil(R / PVS) + 1, nz = 4;
  const pr = newProp('crater', x - half * PVS, y - half * PVS, half * 2, half * 2, nz);
  for (let k = 0; k < nz; k++) for (let j = 0; j < half * 2; j++) for (let i = 0; i < half * 2; i++) {
    const px = (i + .5 - half) * PVS, py = (j + .5 - half) * PVS, pz = (k + .5) * PVS, d = Math.hypot(px, py) / r, n = vn3(px / 0.25, py / 0.25, 0, s);
    const hgt = d < 0.75 ? 0 : d < 1.0 ? 0.32 * (d - 0.75) / 0.25 : 0.32 * Math.max(0, 1 - (d - 1) / 0.45);
    if (pz < hgt * (0.55 + 0.8 * n) - 0.02) put(pr, i, j, k, DIRT, mix([112, 92, 66], 0.75 + 0.35 * n + 0.1 * pz), 18, s); }
  finish(pr); pr.visual = true; pr.cx = x; pr.cy = y;
  return pr;
}

// ---------------------------------------------------------------- mudanças (servidor e navegadores fazem a mesma conta)
// bola: tira tudo cujo centro está a menos de r de algum ponto (pts = [x,y,z, x,y,z, ...])
function tunnel(pr, r, pts, rem) { own(pr); rem = rem || [];
  const P = PVS, r2 = r * r, { nx, ny, nz, mat } = pr;
  for (let q = 0; q < pts.length; q += 3) { const x = pts[q], y = pts[q + 1], z = pts[q + 2];
    const i0 = Math.max(0, Math.floor((x - r - pr.x0) / P)), i1 = Math.min(nx - 1, Math.floor((x + r - pr.x0) / P)), j0 = Math.max(0, Math.floor((y - r - pr.y0) / P)), j1 = Math.min(ny - 1, Math.floor((y + r - pr.y0) / P));
    const k0 = Math.max(0, Math.floor((z - r) / P)), k1 = Math.min(nz - 1, Math.floor((z + r) / P));
    for (let k = k0; k <= k1; k++) { const dz = (k + .5) * P - z; for (let j = j0; j <= j1; j++) { const dy = pr.y0 + (j + .5) * P - y; for (let i = i0; i <= i1; i++) {
      const idx = (k * ny + j) * nx + i; if (!mat[idx]) continue; const dx = pr.x0 + (i + .5) * P - x; if (dx * dx + dy * dy + dz * dz > r2) continue;
      if (!SOFT[mat[idx]]) pr.solid--; mat[idx] = 0; rem.push(idx); } } } }
  return rem; }
// caixa girada (a esteira de um tanque): tira o que estiver entre zlo e zhi
function crushBox(pr, x, y, h, hl, hw, zlo, zhi, rem) { rem = rem || [];
  const c = Math.cos(h), s = Math.sin(h), ext = Math.abs(c) * hl + Math.abs(s) * hw, eyt = Math.abs(s) * hl + Math.abs(c) * hw, P = PVS, { nx, ny, mat } = pr;
  const i0 = Math.max(0, Math.floor((x - ext - pr.x0) / P)), i1 = Math.min(nx - 1, Math.floor((x + ext - pr.x0) / P)), j0 = Math.max(0, Math.floor((y - eyt - pr.y0) / P)), j1 = Math.min(ny - 1, Math.floor((y + eyt - pr.y0) / P));
  const k0 = Math.max(0, Math.floor(zlo / P)), k1 = Math.min(pr.nz - 1, Math.floor(zhi / P));
  if (i0 > i1 || j0 > j1 || k0 > k1) return rem; own(pr);
  for (let j = j0; j <= j1; j++) { const dy = pr.y0 + (j + .5) * P - y; for (let i = i0; i <= i1; i++) { const dx = pr.x0 + (i + .5) * P - x, u = dx * c + dy * s, v = -dx * s + dy * c;
    if (u > hl || u < -hl || v > hw || v < -hw) continue;
    for (let k = k0; k <= k1; k++) { const idx = (k * ny + j) * nx + i; if (!mat[idx]) continue; if (!SOFT[mat[idx]]) pr.solid--; mat[idx] = 0; rem.push(idx); } } }
  return rem; }
// fogo: queima o que é inflamável dentro do raio (seed escolhe quais voxels vão primeiro)
// fogo: a frente das chamas sai de (x,y,z) a v m/s e já está no raio r; age = segundos desde que pegou.
// Cada voxel inflamável só some depois de passar o seu tempo de queima (BURN_T) dentro do fogo.
function burn(pr, x, y, z, r, age, v, seed, rem) { own(pr); rem = rem || [];
  const P = PVS, r2 = r * r, { nx, ny, mat, list } = pr, nxy = nx * ny;
  for (let a = 0; a < list.length; a++) { const idx = list[a], m = mat[idx]; if (!BURN[m]) continue;
    const i = idx % nx, j = ((idx / nx) | 0) % ny, k = (idx / nxy) | 0;
    const dx = pr.x0 + (i + .5) * P - x, dy = pr.y0 + (j + .5) * P - y, dz = (k + .5) * P - z, d2 = dx * dx + dy * dy + dz * dz; if (d2 > r2) continue;
    if (age - Math.sqrt(d2) / v < BURN_T[m] * (0.6 + 0.8 * h3((i / 3) | 0, (j / 3) | 0, (k / 3) | 0, seed))) continue;
    if (!SOFT[m]) pr.solid--; mat[idx] = 0; rem.push(idx); }
  return rem; }
function flammableNear(pr, x, y, z, r) { const P = PVS, { nx, ny, nz, mat } = pr;
  const i0 = Math.max(0, Math.floor((x - r - pr.x0) / P)), i1 = Math.min(nx - 1, Math.floor((x + r - pr.x0) / P)), j0 = Math.max(0, Math.floor((y - r - pr.y0) / P)), j1 = Math.min(ny - 1, Math.floor((y + r - pr.y0) / P));
  const k0 = Math.max(0, Math.floor((z - r) / P)), k1 = Math.min(nz - 1, Math.floor((z + r) / P)); let n = 0;
  for (let k = k0; k <= k1; k += 2) for (let j = j0; j <= j1; j += 2) for (let i = i0; i <= i1; i += 2) if (BURN[mat[(k * ny + j) * nx + i]]) n++;
  return n; }
// árvore ou poste cai para um dos quatro lados (0 +x, 1 +y, 2 -x, 3 -y); o toco fica de pé
function fell(M, pr, dir) {
  const ux = [1, 0, -1, 0][dir & 3], uy = [0, 1, 0, -1][dir & 3], P = PVS, { nx, ny, nz } = pr, cx = pr.cx, cy = pr.cy, tr = pr.trunkR || 0.15, stumpZ = 0.4;
  const src = []; let maxS = 0, maxT = 0, maxZ = 0;
  for (const idx of pr.list) { if (!pr.mat[idx]) continue; const i = idx % nx, t = (idx / nx) | 0, j = t % ny, k = (t / ny) | 0;
    const sx = pr.x0 + (i + .5) * P - cx, sy = pr.y0 + (j + .5) * P - cy, z = (k + .5) * P;
    if (z < stumpZ && Math.hypot(sx, sy) < tr + 0.08) { src.push([sx, sy, z, idx, 1]); continue; }      // toco
    const sa = sx * ux + sy * uy, ta = -sx * uy + sy * ux; let zn = tr - sa; if (zn < P / 2) zn = P / 2 + (P / 2 - zn) * 0.25;
    src.push([z, ta, zn, idx, 0]); maxS = Math.max(maxS, z + 0.2); maxT = Math.max(maxT, Math.abs(ta) + 0.2); maxZ = Math.max(maxZ, zn + 0.2); }
  // grade nova alinhada com x/y, cobrindo o toco e a árvore deitada
  // tudo em múltiplos de PVS a partir do pé da árvore, que já está na grade: cada voxel cai certinho numa casa
  const nA0 = 10, nA1 = Math.ceil(maxS / P), nT = Math.ceil(maxT / P);
  const gx = ux ? nA0 + nA1 : 2 * nT, gy = uy ? nA0 + nA1 : 2 * nT, gz = Math.max(Math.ceil(maxZ / P), Math.ceil(stumpZ / P)) + 1;
  const bx0 = ux > 0 ? cx - nA0 * P : ux < 0 ? cx - nA1 * P : cx - nT * P, by0 = uy > 0 ? cy - nA0 * P : uy < 0 ? cy - nA1 * P : cy - nT * P;
  const o = newProp(pr.kind, bx0, by0, gx, gy, gz); if (!pr.cr) o.cr = o.cg = o.cb = null;
  for (const [a, b, c, idx, stump] of src) {
    const wx = stump ? cx + a : cx + ux * a - uy * b, wy = stump ? cy + b : cy + uy * a + ux * b, wz = stump ? c : c;
    const i = Math.floor((wx - o.x0) / P), j = Math.floor((wy - o.y0) / P), k = Math.floor(wz / P); if (i < 0 || j < 0 || k < 0 || i >= gx || j >= gy || k >= gz) continue;
    const t = (k * gy + j) * gx + i; o.mat[t] = pr.mat[idx]; if (o.cr) { o.cr[t] = pr.cr[idx]; o.cg[t] = pr.cg[idx]; o.cb[t] = pr.cb[idx]; } }
  Object.assign(pr, { x0: o.x0, y0: o.y0, nx: gx, ny: gy, nz: gz, n: o.n, mat: o.mat, cr: o.cr, cg: o.cg, cb: o.cb, shared: false, sharedCol: false, tpl: null });
  pr.fallen = true; pr.block = false; pr.crush = true; pr.fallDir = dir & 3; pr.solid0 = undefined;
  finish(pr); pr.foot = [pr.bb[0], pr.bb[1], pr.bb[2], pr.bb[3]]; reindex(M, pr);
  return pr; }
const fallDir = (dx, dy) => Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 2) : (dy > 0 ? 1 : 3);

// ---------------------------------------------------------------- estrutura das casas
// Tudo que não está mais ligado ao chão por algum caminho de voxels vizinhos cai. Pedaço pequeno some (vira poeira);
// pedaço grande cai inteiro até encostar em algo e, se caiu de mais de meio metro, quebra e vira entulho.
// out (só no navegador, para animar): out.bits = [x,y,z,r,g,b, ...] do que sumiu na hora; out.falls = [{ idx, drop, bits }] do que caiu
let QB = null, MB = null;
function settle(pr, out) {
  own(pr); ownColors(pr); const { nx, ny, mat } = pr, nxy = nx * ny, n = pr.n, C3 = pr.cr; let any = false;
  if (!QB || QB.length < n) { QB = new Int32Array(n); MB = new Uint8Array(n); }
  const Q = QB, mark = MB, P = [0, 0, 0];
  const rec = (list, idx) => { if (!out) return; propCenter(pr, idx, P); list.push(P[0], P[1], P[2], C3 ? C3[idx] : 128, C3 ? pr.cg[idx] : 128, C3 ? pr.cb[idx] : 128); };
  for (let it = 0; it < 5; it++) {
    mark.fill(0, 0, n); let qt = 0, qh = 0;
    for (let idx = 0; idx < nxy; idx++) if (mat[idx]) { mark[idx] = 1; Q[qt++] = idx; }
    while (qh < qt) { const idx = Q[qh++], i = idx % nx, j = ((idx / nx) | 0) % ny; let o;
      if (i > 0 && mat[o = idx - 1] && !mark[o]) { mark[o] = 1; Q[qt++] = o; }
      if (i < nx - 1 && mat[o = idx + 1] && !mark[o]) { mark[o] = 1; Q[qt++] = o; }
      if (j > 0 && mat[o = idx - nx] && !mark[o]) { mark[o] = 1; Q[qt++] = o; }
      if (j < ny - 1 && mat[o = idx + nx] && !mark[o]) { mark[o] = 1; Q[qt++] = o; }
      if (idx >= nxy && mat[o = idx - nxy] && !mark[o]) { mark[o] = 1; Q[qt++] = o; }
      if (idx + nxy < n && mat[o = idx + nxy] && !mark[o]) { mark[o] = 1; Q[qt++] = o; } }
    // pedaços soltos, na ordem do voxel mais baixo
    const comps = [];
    for (const s0 of pr.list) { if (!mat[s0] || mark[s0]) continue; const C = [s0]; mark[s0] = 2;
      for (let h = 0; h < C.length; h++) { const idx = C[h], i = idx % nx, j = ((idx / nx) | 0) % ny; let o;
        if (i > 0 && mat[o = idx - 1] && !mark[o]) { mark[o] = 2; C.push(o); }
        if (i < nx - 1 && mat[o = idx + 1] && !mark[o]) { mark[o] = 2; C.push(o); }
        if (j > 0 && mat[o = idx - nx] && !mark[o]) { mark[o] = 2; C.push(o); }
        if (j < ny - 1 && mat[o = idx + nx] && !mark[o]) { mark[o] = 2; C.push(o); }
        if (idx >= nxy && mat[o = idx - nxy] && !mark[o]) { mark[o] = 2; C.push(o); }
        if (idx + nxy < n && mat[o = idx + nxy] && !mark[o]) { mark[o] = 2; C.push(o); } }
      comps.push(C); }
    if (!comps.length) break;
    let moved = false;
    for (const C of comps) {
      if (C.length < 40) { for (const idx of C) { if (out) rec(out.bits, idx); mat[idx] = 0; } moved = true; continue; }
      for (const idx of C) mark[idx] = 3;
      let drop = 1e9;
      for (const idx of C) { if (idx >= nxy && mark[idx - nxy] === 3) continue; let d = 0, q = idx - nxy; while (q >= 0 && (!mat[q] || mark[q] === 3)) { d++; q -= nxy; } if (d < drop) drop = d; if (!drop) break; }
      for (const idx of C) mark[idx] = 2;
      if (!drop) continue;                                     // apoiado em outro pedaço solto: resolve na próxima volta
      moved = true; C.sort((a, b) => a - b);
      const brk = drop >= 5, seed = (pr.id | 0) * 977 + (pr.settleN | 0) * 131 + it * 17, kept = [], bits = out ? [] : null;
      for (const idx of C) { const to = idx - drop * nxy, m = mat[idx]; mat[idx] = 0;
        let r = 0, g = 0, b = 0; if (C3) { r = C3[idx]; g = pr.cg[idx]; b = pr.cb[idx]; }
        if (brk && (m === GLASS || SOFT[m] || h3(idx, it, 7, seed) < 0.3)) { if (bits) { propCenter(pr, to, P); bits.push(P[0], P[1], P[2], r, g, b); } continue; }
        mat[to] = brk ? RUBBLE : m; if (C3) { const k = brk ? 0.78 : 1; C3[to] = r * k; pr.cg[to] = g * k; pr.cb[to] = b * k; } kept.push(to); }
      if (out) out.falls.push({ idx: Int32Array.from(kept), drop: drop * PVS, bits });
    }
    if (!moved) break;
    any = true; finish(pr);
  }
  if (any) { pr.settleN = (pr.settleN | 0) + 1; if (!pr.list.length) pr.gone = true; }
  return any; }
// tanque passando por dentro da casa: tira o que estiver na caixa dele acima do assoalho (o entulho baixo fica).
// count: só conta o que está na frente [alvenaria, resto, entulho] sem mexer em nada
function push(pr, x, y, h, hl, hw, count) {
  const c = Math.cos(h), s = Math.sin(h), ext = Math.abs(c) * hl + Math.abs(s) * hw, eyt = Math.abs(s) * hl + Math.abs(c) * hw, P = PVS, { nx, ny, mat } = pr;
  const i0 = Math.max(0, Math.floor((x - ext - pr.x0) / P)), i1 = Math.min(nx - 1, Math.floor((x + ext - pr.x0) / P)), j0 = Math.max(0, Math.floor((y - eyt - pr.y0) / P)), j1 = Math.min(ny - 1, Math.floor((y + eyt - pr.y0) / P));
  const k1 = Math.min(pr.nz - 1, Math.floor(2.6 / P)), kr = Math.round(RUBBLE_Z / P), res = count ? [0, 0, 0] : [];
  if (i0 > i1 || j0 > j1) return res; if (!count) own(pr);
  for (let j = j0; j <= j1; j++) { const dy = pr.y0 + (j + .5) * P - y; for (let i = i0; i <= i1; i++) { const dx = pr.x0 + (i + .5) * P - x, u = dx * c + dy * s, v = -dx * s + dy * c;
    if (u > hl || u < -hl || v > hw || v < -hw) continue;
    for (let k = 1; k <= k1; k++) { const idx = (k * ny + j) * nx + i, m = mat[idx]; if (!m) continue; const low = (m === RUBBLE || m === DIRT) && k < kr;
      if (count) { if (m === RUBBLE || m === DIRT) { res[2]++; continue; } if (HARD[m]) res[0]++; else res[1]++; continue; }
      if (low) continue; if (!SOFT[m]) pr.solid--; mat[idx] = 0; res.push(idx); } } }
  return res; }
// janela inteira estilhaça
function shatter(pr, w) { const W = pr.win && pr.win[w]; if (!W || W.broken) return []; W.broken = true; own(pr); const rem = [];
  for (const idx of W.idx) if (pr.mat[idx] === GLASS) { pr.mat[idx] = 0; rem.push(idx); } return rem; }
function winAt(pr, x, y, z, r) { if (!pr.win) return -1; r = r || 0.8; for (let w = 0; w < pr.win.length; w++) { const c = pr.win[w].c; if (pr.win[w].broken) continue;
  if (Math.abs(c[0] - x) < r && Math.abs(c[1] - y) < r && Math.abs(c[2] - z) < r) return w; } return -1; }

// ---------------------------------------------------------------- mapa
function generate(seed, themeKey, lite) { LITE = !!lite; try { return gen(seed, themeKey); } finally { LITE = false; } }
function gen(seed, themeKey) {
  const T = THEMES[themeKey] || THEMES.kursk, R = mulberry32((seed >>> 0) || 1);
  const pick = a => a[(R() * a.length) | 0];
  const M = { seed, theme: themeKey in THEMES ? themeKey : 'kursk', name: T.name, size: SIZE, half: HALF, fields: [], roads: [], props: [], zone: { x: 0, y: 0, r: 30 },
    spawns: [[[-45, -215], [-15, -215], [15, -215], [45, -215]], [[45, 215], [15, 215], [-15, 215], [-45, 215]]] };
  // campos
  const split = (x0, y0, x1, y1, d) => { const w = x1 - x0, h = y1 - y0;
    if (d > 5 || (w < 70 && h < 70) || (w < 130 && h < 130 && R() < 0.45)) { M.fields.push({ x0, y0, x1, y1, col: pick(T.crops), dir: R() < 0.5 ? 0 : 1, s: (R() * 1e6) | 0 }); return; }
    if (w > h) { const s = x0 + w * (0.35 + R() * 0.3); split(x0, y0, s, y1, d + 1); split(s, y0, x1, y1, d + 1); }
    else { const s = y0 + h * (0.35 + R() * 0.3); split(x0, y0, x1, s, d + 1); split(x0, s, x1, y1, d + 1); } };
  split(-HALF, -HALF, HALF, HALF, 0);
  // estradas
  const ry = (R() - 0.5) * 90, ph = R() * 6, main = [];
  for (let x = -HALF - 20; x <= HALF + 20; x += 20) main.push([x, ry + 16 * Math.sin(x / 80 + ph)]);
  const rx = (R() < 0.5 ? -1 : 1) * (70 + R() * 90), ph2 = R() * 6, lane = [];
  for (let y = -HALF - 20; y <= HALF + 20; y += 20) lane.push([rx + 12 * Math.sin(y / 60 + ph2), y]);
  M.roads.push({ pts: main, w: 7 }, { pts: lane, w: 5 });
  const roadDist = (x, y) => { let d = 1e9; for (const rd of M.roads) for (let i = 1; i < rd.pts.length; i++) { const a = rd.pts[i - 1], b = rd.pts[i];
    const ex = b[0] - a[0], ey = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / (ex * ex + ey * ey))); d = Math.min(d, Math.hypot(x - a[0] - ex * t, y - a[1] - ey * t) - rd.w / 2); } return d; };
  const roadY = x => { for (let i = 1; i < main.length; i++) if (main[i][0] >= x) { const a = main[i - 1], b = main[i], t = (x - a[0]) / (b[0] - a[0]); return a[1] + (b[1] - a[1]) * t; } return ry; };
  // ocupação
  const feet = [];
  const free = (x0, y0, x1, y1, m) => {
    if (x0 < -HALF + 6 || y0 < -HALF + 6 || x1 > HALF - 6 || y1 > HALF - 6) return false;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rad = Math.hypot(x1 - x0, y1 - y0) / 2;
    if (Math.hypot(cx - M.zone.x, cy - M.zone.y) < M.zone.r + 8 + rad) return false;
    for (const t of M.spawns) for (const s of t) if (Math.hypot(cx - s[0], cy - s[1]) < 26 + rad) return false;
    for (const f of feet) if (x0 < f[2] + m && x1 > f[0] - m && y0 < f[3] + m && y1 > f[1] - m) return false;
    return true; };
  const add = (pr) => { pr.id = M.props.length; M.props.push(pr); feet.push(pr.foot || [pr.bb[0], pr.bb[1], pr.bb[2], pr.bb[3]]); return pr; };
  let sd = (R() * 1e9) | 0; const ns = () => (sd = (sd + 7919) | 0);
  // vilas ao longo da estrada principal
  const vx = [-(90 + R() * 70), 90 + R() * 70];
  for (let v = 0; v < T.villages; v++) {
    const n = 3 + ((R() * 3) | 0); let x = vx[v] - n * 8;
    for (let h = 0; h < n; h++, x += 14 + R() * 5) {
      const side = R() < 0.5 ? -1 : 1, w = 7 + R() * 2.5, d = 5.4 + R() * 1.6, along = R() < 0.7;
      const cy = roadY(x) + side * (11 + R() * 5);
      // direção (uma de 32): segue a curva da estrada, com um desvio de vez em quando; algumas ficam de oitão para a estrada
      const tq = Math.atan2(roadY(x + 2) - roadY(x - 2), 4) / (Math.PI / 16), jit = R() < 0.6 ? (R() < 0.5 ? -1 : 1) * (1 + ((R() * 3) | 0)) : 0;
      const q = Math.round(tq) + jit + (along ? 0 : 8), ca = Math.abs(COS32[(q % 32 + 32) % 32]), sa = Math.abs(SIN32[(q % 32 + 32) % 32]);
      const hw = ca * w / 2 + sa * d / 2 + 0.6, hd = sa * w / 2 + ca * d / 2 + 0.6;
      if (!free(x - hw, cy - hd, x + hw, cy + hd, 2) || roadDist(x, cy) < hd + 1) continue;
      add(building(x, cy, w, d, q, along ? -side : (R() < 0.5 ? 1 : -1), T, ns(), false));
      // muro ou cerca no quintal, atrás da casa
      const yb = cy + side * (hd + 3.5), kind = T.roofKind === 'tile' ? 'wall' : 'fence', len = 9 + R() * 6;
      if (free(x - len / 2, yb - 0.4, x + len / 2, yb + 0.4, 0.5)) add(linear(kind, x - len / 2, yb, len, true, ns()));
      if (R() < 0.5) { const xs = x + (R() < 0.5 ? -1 : 1) * (len / 2), y0 = Math.min(yb, cy), y1 = Math.max(yb, cy);
        if (free(xs - 0.4, y0, xs + 0.4, y1, 0.3)) add(linear(kind, xs, y0, y1 - y0, false, ns())); }
      // celeiro de pedra atrás do quintal (Normandia)
      if (T.roofKind === 'tile' && R() < 0.5) { const bw = 10 + R() * 2, bd = 6 + R(), bq = Math.round(tq) + (R() < 0.5 ? 0 : (R() < 0.5 ? -1 : 1));
        const bc = Math.abs(COS32[(bq % 32 + 32) % 32]), bs = Math.abs(SIN32[(bq % 32 + 32) % 32]), ehx = bc * bw / 2 + bs * bd / 2, ehy = bs * bw / 2 + bc * bd / 2;
        const bx = x + (R() - 0.5) * 4, by = yb + side * (2.4 + ehy);
        if (free(bx - ehx - 0.5, by - ehy - 0.5, bx + ehx + 0.5, by + ehy + 0.5, 1)) add(building(bx, by, bw, bd, bq, -side, T, ns(), true)); }
      // carroça no quintal
      if (R() < 0.45) { const ox = x + (R() < 0.5 ? -1 : 1) * (hw + 3), oy = cy + side * 2, ax = R() < 0.5;
        if (free(ox - (ax ? 2.6 : 1), oy - (ax ? 1 : 2.6), ox + (ax ? 2.6 : 1), oy + (ax ? 1 : 2.6), 0.5)) add(cart(ox, oy, ax, R() < 0.5 ? 1 : -1, T.roofKind === 'thatch' && R() < 0.6, ns())); }
      // pomar ao lado de algumas casas na Normandia
      if (T.trees.includes('apple') && R() < 0.4) { const ox = x + (R() < 0.5 ? -1 : 1) * 14, oy = cy + side * 8;
        for (let a = 0; a < 3; a++) for (let b = 0; b < 2; b++) { const tx = ox + (a - 1) * 5, ty = oy + side * b * 5; if (free(tx - 1.6, ty - 1.6, tx + 1.6, ty + 1.6, 0.4) && roadDist(tx, ty) > 3) add(tree(tx, ty, 'apple', ns())); } }
    }
  }
  // caminhões abandonados na beira da estrada
  for (let i = 0, tries = 0; i < 2 && tries < 40; tries++) { const x = (R() - 0.5) * 420, side = R() < 0.5 ? -1 : 1, y = roadY(x) + side * (3.5 + 1.2);
    if (free(x - 3.4, y - 1.3, x + 3.4, y + 1.3, 1)) { add(truck(x, y, true, R() < 0.5 ? 1 : -1, T, ns())); i++; } }
  // ninhos de sacos de areia
  for (let i = 0, tries = 0; i < 3 && tries < 80; tries++) { const x = (R() - 0.5) * 380, y = (R() - 0.5) * 300;
    if (free(x - 3, y - 3, x + 3, y + 3, 2) && roadDist(x, y) > 4) { add(sandbags(x, y, y > 0 ? -Math.PI / 2 : Math.PI / 2, ns())); i++; } }
  // postes de telégrafo ao longo da estrada principal
  { const side = R() < 0.5 ? -1 : 1; for (let x = -HALF + 20; x < HALF - 20; x += 32 + R() * 8) { const y = roadY(x) + side * 6.2;
    if (free(x - 0.3, y - 0.3, x + 0.3, y + 0.3, 0.6)) add(pole(x, y, ns())); } }
  // cinturões de árvores e sebes nas divisas dos campos
  for (const f of M.fields) for (const edge of [0, 1]) {
    const r = R(); const isBelt = r < T.belts, isHedge = !isBelt && r < T.belts + T.hedges; if (!isBelt && !isHedge) continue;
    const alongX = edge === 0, len = alongX ? f.x1 - f.x0 : f.y1 - f.y0; if (len < 25) continue;
    const ex = f.x0, ey = f.y0;
    if (isHedge) { // sebe com passagens
      let t = 4; while (t < len - 6) { const seg = Math.min(len - t - 4, 12 + R() * 20); const ax = alongX ? ex + t : ex, ay = alongX ? ey : ey + t;
        const b = alongX ? [ax, ay - 0.7, ax + seg, ay + 0.7] : [ax - 0.7, ay, ax + 0.7, ay + seg];
        if (seg > 5 && free(b[0], b[1], b[2], b[3], 0.5) && roadDist((b[0] + b[2]) / 2, (b[1] + b[3]) / 2) > 4) { add(linear('hedge', ax, ay, seg, alongX, ns()));
          if (R() < 0.35) { const tt = R() * seg, tx = alongX ? ax + tt : ax, ty = alongX ? ay : ay + tt; const pr = tree(tx, ty, pick(T.trees.filter(t => t !== 'apple')), ns()); pr.id = M.props.length; M.props.push(pr); } }
        t += seg + 6 + R() * 6; }
    } else { // fila de árvores
      let t = 3 + R() * 4; while (t < len - 3) { const off = (R() - 0.5) * 1.5, tx = alongX ? ex + t : ex + off, ty = alongX ? ey + off : ey + t;
        if (free(tx - 1.2, ty - 1.2, tx + 1.2, ty + 1.2, 0.6) && roadDist(tx, ty) > 3) add(tree(tx, ty, pick(T.trees), ns()));
        t += 5 + R() * 4; if (R() < 0.08) t += 15; } }
  }
  // árvores soltas e feno
  for (let i = 0, tries = 0; i < T.loose && tries < 400; tries++) { const x = (R() - 0.5) * 460, y = (R() - 0.5) * 460;
    if (free(x - 2, y - 2, x + 2, y + 2, 1.5) && roadDist(x, y) > 4) { add(tree(x, y, pick(T.trees), ns())); i++; } }
  for (let i = 0, tries = 0; i < T.hay && tries < 400; tries++) { const x = (R() - 0.5) * 460, y = (R() - 0.5) * 460;
    if (free(x - 2, y - 2, x + 2, y + 2, 2) && roadDist(x, y) > 4) { add(haystack(x, y, ns())); i++; } }
  // arbustos redondos: em moitas na beira dos campos, perto das casas e soltos
  { const dry = T.roofKind === 'thatch', put1 = (x, y) => { if (free(x - 1.2, y - 1.2, x + 1.2, y + 1.2, 0.4) && roadDist(x, y) > 3) { add(bush(x, y, ns(), dry)); return true; } return false; };
    for (let i = 0, tries = 0; i < 45 && tries < 600; tries++) { const f = M.fields[(R() * M.fields.length) | 0], e = R() < 0.5, x = e ? f.x0 + R() * (f.x1 - f.x0) : (R() < 0.5 ? f.x0 : f.x1) + (R() - 0.5) * 2, y = e ? (R() < 0.5 ? f.y0 : f.y1) + (R() - 0.5) * 2 : f.y0 + R() * (f.y1 - f.y0);
      if (put1(x, y)) { i++; const m = (R() * 3) | 0; for (let q = 0; q < m; q++) put1(x + (R() - 0.5) * 4, y + (R() - 0.5) * 4); } }
    for (const pr of M.props.slice()) if (pr.struct && R() < 0.7) { const n = 1 + ((R() * 3) | 0); for (let q = 0; q < n; q++) { const a = R() * Math.PI * 2, d = 6 + R() * 4; put1(pr.cx + Math.cos(a) * d, pr.cy + Math.sin(a) * d); } }
    for (let i = 0, tries = 0; i < 25 && tries < 300; tries++) if (put1((R() - 0.5) * 460, (R() - 0.5) * 460)) i++; }
  // índice espacial
  M.cells = Array.from({ length: NC * NC }, () => []);
  for (const pr of M.props) reindex(M, pr);
  return M;
}
// põe o objeto nas células que a caixa dele cobre (objetos que mudam de tamanho só ganham células novas)
function reindex(M, pr) { const b = pr.bb; const i0 = cellOf(b[0]), i1 = cellOf(b[2]), j0 = cellOf(b[1]), j1 = cellOf(b[3]);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const c = M.cells[j * NC + i]; if (!c.includes(pr.id)) c.push(pr.id); } }
// objeto que só existe na tela de quem vê (borda de cratera)
function addVisual(M, pr) { pr.id = M.props.length; M.props.push(pr); reindex(M, pr); return pr; }
function cellOf(v) { return Math.max(0, Math.min(NC - 1, Math.floor((v + HALF) / CELL))); }
function propAt(pr, x, y, z) { const i = Math.floor((x - pr.x0) / PVS), j = Math.floor((y - pr.y0) / PVS), k = Math.floor(z / PVS);
  if (i < 0 || j < 0 || k < 0 || i >= pr.nx || j >= pr.ny || k >= pr.nz) return -1; return (k * pr.ny + j) * pr.nx + i; }
function propCenter(pr, idx, o) { const i = idx % pr.nx, t = (idx / pr.nx) | 0, j = t % pr.ny, k = (t / pr.ny) | 0; o[0] = pr.x0 + (i + .5) * PVS; o[1] = pr.y0 + (j + .5) * PVS; o[2] = (k + .5) * PVS; return o; }
// objetos perto de um segmento (pelas células que ele cruza)
function propsAlong(M, ax, ay, bx, by) { const set = new Set(), L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(L / 4));
  for (let s = 0; s <= n; s++) { const x = ax + (bx - ax) * s / n, y = ay + (by - ay) * s / n; if (x < -HALF || y < -HALF || x > HALF || y > HALF) continue; for (const id of M.cells[cellOf(y) * NC + cellOf(x)]) set.add(id); }
  return set; }
// interseção de raio com caixa: [t0, t1] ou null
function rayBox(p, d, b, zmax) { let t0 = 0, t1 = 1e9; const lo = [b[0], b[1], 0], hi = [b[2], b[3], zmax];
  for (let a = 0; a < 3; a++) { if (Math.abs(d[a]) < 1e-9) { if (p[a] < lo[a] || p[a] > hi[a]) return null; continue; }
    let u = (lo[a] - p[a]) / d[a], v = (hi[a] - p[a]) / d[a]; if (u > v) { const w = u; u = v; v = w; } t0 = Math.max(t0, u); t1 = Math.min(t1, v); if (t0 > t1) return null; }
  return [t0, t1]; }
// opacidade da linha de visão entre dois pontos (1 ou mais = bloqueada)
function los(M, a, b) { const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(d[0], d[1], d[2]); if (L < 1e-6) return 0; d[0] /= L; d[1] /= L; d[2] /= L;
  let op = 0;
  for (const id of propsAlong(M, a[0], a[1], b[0], b[1])) { const pr = M.props[id]; if (pr.gone || pr.visual) continue;
    const hit = rayBox(a, d, pr.bb, pr.bb[4]); if (!hit) continue; const t0 = Math.max(0, hit[0]), t1 = Math.min(L, hit[1]); let last = -1;
    for (let t = t0; t <= t1; t += PVS * 0.8) { const idx = propAt(pr, a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t); if (idx < 0 || idx === last) continue; last = idx; const m = pr.mat[idx]; if (!m) continue; op += OPAC[m]; if (op >= 1) return op; } }
  return op; }
// caixa orientada (tanque) contra caixa alinhada (casa)
function obbHitsBox(cx, cy, h, hl, hw, b) { const c = Math.cos(h), s = Math.sin(h);
  const ax = [[c, s], [-s, c], [1, 0], [0, 1]], pts = [];
  for (const [u, v] of [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw]]) pts.push([cx + c * u - s * v, cy + s * u + c * v]);
  const bp = [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]];
  for (const a of ax) { let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9; for (const p of pts) { const d = p[0] * a[0] + p[1] * a[1]; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
    for (const p of bp) { const d = p[0] * a[0] + p[1] * a[1]; b0 = Math.min(b0, d); b1 = Math.max(b1, d); } if (a1 < b0 || b1 < a0) return false; }
  return true; }

return { PVS, SIZE, HALF, RES, OPAC, SOFT, BURN, RUBBLE_Z, BURN_T, MAT: { LEAF, TRUNK, WALL, TILE, HAY, WOOD, STONE, FLOOR, RUBBLE, THATCH, SAND, METAL, GLASS, RUBBER, DIRT, BRICK, CLOTH, LOG },
  HARD, THEMES, generate, propAt, propCenter, propsAlong, rayBox, los, obbHitsBox, mulberry32, h3,
  tunnel, crushBox, burn, flammableNear, settle, push, shatter, winAt, fell, fallDir, craterRim, addVisual, reindex, own, ownColors };
});
