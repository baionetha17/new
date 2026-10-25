// Gerador de mapa compartilhado: mesma semente = mesmo mapa no servidor e em todos os navegadores.
// Terreno plano de 500 x 500 m com campos, estradas e objetos destrutíveis em voxels de 10 cm (o mesmo do tanque).
// As mudanças nos objetos (furos, atropelos, desabamento, queda de árvore, fogo) também ficam aqui: o servidor aplica,
// manda só a operação, e cada navegador repete a mesma conta e chega no mesmo resultado.
(function (root, f) { if (typeof module === 'object' && module.exports) module.exports = f(); else root.MAPGEN = f(); })(typeof self !== 'undefined' ? self : this, function () {
'use strict';
const PVS = 0.1, SIZE = 500, HALF = 250, CELL = 10, NC = SIZE / CELL;
// materiais
const LEAF = 1, TRUNK = 2, WALL = 3, TILE = 4, HAY = 5, WOOD = 6, STONE = 7, FLOOR = 8, RUBBLE = 9, THATCH = 10, SAND = 11, METAL = 12, GLASS = 13, RUBBER = 14, DIRT = 15, BRICK = 16;
// mm de penetração perdidos por metro atravessado, convertidos para cada voxel
const RES_M = [0, 1.2, 48, 80, 12, 4, 16, 90, 8, 60, 6, 120, 30, 2, 20, 50, 85];
const RES = RES_M.map(v => v * PVS);
const OPAC = [0, 0.03, 1, 1, 1, 1, 0.4, 0.45, 1, 1, 1, 1, 1, 0.1, 1, 1, 1];   // quanto cada voxel tapa a visão
const SOFT = [0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];              // folha e feno: miolo oco, não seguram a casa
const BURN = [0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0];              // o que pega fogo
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
function newProp(kind, x0, y0, nx, ny, nz) { const n = nx * ny * nz;
  if (n >= 1 << 20) throw new Error('objeto grande demais: ' + kind);
  return { kind, x0, y0, z0: 0, nx, ny, nz, n, mat: new Uint8Array(n), cr: new Uint8Array(n), cg: new Uint8Array(n), cb: new Uint8Array(n) }; }
function put(pr, i, j, k, m, c, jit, s) { const idx = (k * pr.ny + j) * pr.nx + i; pr.mat[idx] = m;
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
function ownColors(pr) { if (pr.sharedCol) { pr.cr = pr.cr.slice(); pr.cg = pr.cg.slice(); pr.cb = pr.cb.slice(); pr.sharedCol = false; } }
function idxOf(pr, i, j, k) { return (k * pr.ny + j) * pr.nx + i; }

// ---------------------------------------------------------------- árvores
const TREE_T = {};
function treeTemplate(type, variant) {
  const key = type + variant; if (TREE_T[key]) return TREE_T[key];
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

// ---------------------------------------------------------------- casa
function house(cx, cy, w, d, alongX, T, s) {
  const r = mulberry32(s), thatch = T.roofKind === 'thatch';
  const W = alongX ? w : d, D = alongX ? d : w;              // W ao longo da cumeeira
  const wh = 2.75, ha = D / 2 + 0.4, rh = D * (thatch ? 0.5 : 0.42), ex = W / 2, ey = D / 2, WT = 0.3, RT = thatch ? 0.4 : 0.2, gx = ex + (thatch ? 0.4 : 0.25);
  const nx = Math.ceil((W + 1.0) / PVS), ny = Math.ceil((D + 1.0) / PVS), nz = Math.ceil((wh + rh + 1.4) / PVS);
  const x0 = cx - nx * PVS / 2, y0 = cy - ny * PVS / 2;
  const pr = newProp('house', x0, y0, nx, ny, nz);
  const roofC = T.roof[(r() * T.roof.length) | 0], wallC = T.wall.map(v => v - r() * 16), shutC = T.shutter[(r() * T.shutter.length) | 0];
  const woodC = [118, 90, 62], frameC = thatch ? shutC : [226, 222, 210], glassC = [58, 74, 88];
  const door = (r() - 0.5) * (W - 3.2), chim = [(r() - 0.5) * W * 0.5, (r() < 0.5 ? -1 : 1) * 0.55];
  const table = [(chim[0] > 0 ? -1 : 1) * W * 0.22, -chim[1] * 0.9];
  pr.rubbleC = [wallC, roofC, woodC];
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const pl = x0 + (i + .5) * PVS - cx, pa = y0 + (j + .5) * PVS - cy, pz = (k + .5) * PVS;  // ao longo, através, altura
    const ap = Math.abs(pa), al = Math.abs(pl), n = h3(i, j, k, s);
    const roofZ = wh + rh * (1 - ap / ha);
    const inX = al <= ex, inY = ap <= ey;
    // chaminé de tijolo, saindo do fogão
    const inChim = Math.abs(pl - chim[0]) < 0.28 && Math.abs(pa - chim[1]) < 0.28;
    if (inChim && pz > 1.6 && pz < roofZ + 0.75) { const row = Math.floor(pz / 0.1), brick = ((Math.floor((pl + pa + (row & 1) * 0.12) / 0.24)) & 1);
      const c = pz > roofZ + 0.62 ? [70, 66, 62] : (pz * 10) % 1 < 0.2 ? [168, 160, 150] : brick ? [140, 74, 56] : [124, 66, 50];
      put(pr, i, j, k, BRICK, c, 10, s); continue; }
    // telhado
    if (al <= gx && ap <= ha && pz <= roofZ && pz > roofZ - RT - (thatch && ap > ha - 0.3 ? 0.12 * n : 0)) {
      let c;
      if (thatch) { const strand = h3(Math.floor(pl / 0.07), 0, 0, s), course = ((ha - ap) / 0.42) % 1;
        c = mix(roofC, (0.84 + 0.22 * strand) * (course < 0.1 + 0.08 * strand ? 0.92 : 1) * (ap < 0.3 ? 0.78 : 1) * (al > gx - 0.12 ? 0.85 : 1)); }
      else { const row = Math.floor((ha - ap) / 0.26), fr = ((ha - ap) / 0.26) % 1, col = Math.floor((pl + (row & 1) * 0.11) / 0.22), v = h3(row, col, 0, s);
        c = mix(roofC, (fr < 0.22 ? 0.72 : 0.9 + 0.16 * v) * (ap < 0.22 ? 0.8 : 1)); }
      put(pr, i, j, k, thatch ? THATCH : TILE, c, thatch ? 20 : 8, s); continue; }
    if (!inX || !inY) continue;
    const dX = ex - al, dY = ey - ap, edgeX = dX < WT, edgeY = dY < WT, layer = Math.min(dX, dY) / PVS | 0;  // 0 = face de fora
    // piso de tábuas
    if (k === 0 && !edgeX && !edgeY) { put(pr, i, j, k, FLOOR, mix([96, 72, 50], (pa * 5) % 1 < 0.12 ? 0.78 : 0.95 + 0.1 * h3(Math.floor(pa * 5), Math.floor(pl / 1.2), 0, s)), 8, s); continue; }
    // fogão de barro / lareira e mesa
    if (!edgeX && !edgeY) {
      if (Math.abs(pl - chim[0]) < 0.65 && Math.abs(pa - chim[1]) < 0.6 && pz < 1.6) { put(pr, i, j, k, BRICK, thatch ? [222, 216, 200] : [120, 104, 90], 14, s); continue; }
      const tx = Math.abs(pl - table[0]), ty = Math.abs(pa - table[1]);
      if (tx < 0.6 && ty < 0.4 && ((pz > 0.7 && pz < 0.8) || (tx > 0.5 && ty > 0.3 && pz < 0.8))) { put(pr, i, j, k, WOOD, woodC, 10, s); continue; }
      continue; }
    const wallTop = edgeX ? roofZ - RT * 0.5 : wh;   // empenas sobem até o telhado
    if (pz > wallTop) continue;
    // portas e janelas
    if (edgeY && !edgeX) {
      const dd = Math.abs(pl - door);
      if (pa > 0 && dd < 0.55 && pz < 2.1) {
        if (dd > 0.47 || pz > 2.02) { put(pr, i, j, k, WOOD, [70, 52, 38], 6, s); continue; }
        if (layer === 1) { const plank = Math.floor((pl - door + 0.6) / 0.15); put(pr, i, j, k, WOOD, mix(thatch ? shutC : woodC, (plank & 1 ? 0.9 : 1) * ((pl - door + 0.6) % 0.15 < 0.03 ? 0.75 : 1)), 6, s);
          if (Math.abs(pl - door - 0.36) < 0.05 && Math.abs(pz - 1.05) < 0.05) put(pr, i, j, k, METAL, [40, 40, 38], 0, s); }
        continue; }
      const t = ((pl + ex) % 2.4 + 2.4) % 2.4;
      if (t > 0.75 && t < 1.65 && pz > 1.0 && pz < 1.95 && al < ex - 0.7) {
        const fr = t < 0.83 || t > 1.57 || pz < 1.08 || pz > 1.87, mull = Math.abs(t - 1.2) < 0.04 || Math.abs(pz - 1.6) < 0.04;
        if (fr || (mull && layer === 1)) put(pr, i, j, k, WOOD, frameC, 6, s);
        else if (layer === 1) put(pr, i, j, k, GLASS, ((t + pz) % 0.6) < 0.08 ? [128, 146, 156] : glassC, 6, s);
        continue; }
      // venezianas dos lados da janela
      if (layer === 0 && al < ex - 0.7 && pz > 1.0 && pz < 1.95 && ((t > 0.33 && t < 0.72) || (t > 1.68 && t < 2.07))) {
        put(pr, i, j, k, WOOD, mix(shutC, (Math.floor(pz / 0.12) & 1) ? 0.92 : 1), 6, s); continue; }
      if (layer === 0 && t > 0.72 && t < 1.68 && pz > 0.92 && pz < 1.0 && al < ex - 0.7) { put(pr, i, j, k, WOOD, [92, 72, 52], 6, s); continue; }
    }
    if (edgeX && !edgeY && pz > 1.1 && pz < 1.9 && ap < 0.42) {
      const fr = ap > 0.35 || pz < 1.17 || pz > 1.83;
      if (fr) put(pr, i, j, k, WOOD, frameC, 6, s); else if (layer === 1) put(pr, i, j, k, GLASS, glassC, 6, s);
      continue; }
    // parede
    let c, m = WALL;
    if (edgeX && pz > wh && thatch) { const b = Math.floor(pa / 0.16); c = mix([128, 98, 66], (b & 1 ? 0.88 : 1) * ((pa / 0.16) % 1 < 0.15 ? 0.78 : 1)); m = WOOD; }
    else if (thatch) { c = pz < 0.45 ? [150, 118, 84] : mix(wallC, 0.94 + 0.08 * vn3(pl / 0.5, pa / 0.5, pz / 0.5, s)); if (pz < 0.45 && pz > 0.4) c = [120, 94, 68]; }
    else { // pedra com argamassa
      const rowH = 0.22, row = Math.floor(pz / rowH), along = edgeY ? pl : pa, off = h3(row, 0, 0, s) * 0.4, sl = 0.32 + 0.2 * h3(row, 1, 0, s);
      const st = Math.floor((along + off) / sl), fu = ((along + off) / sl) % 1, fz = (pz / rowH) % 1, quoin = dX < 0.45 && dY < 0.45;
      if (fu < 0.1 || fz < 0.14) c = [196, 188, 170];
      else c = mix(quoin ? [196, 186, 160] : wallC, 0.82 + 0.26 * h3(row, st, 2, s)); }
    put(pr, i, j, k, m, c, thatch ? 8 : 10, s);
  }
  finish(pr);
  pr.block = true; pr.crush = false;
  pr.foot = alongX ? [cx - ex - 0.1, cy - ey - 0.1, cx + ex + 0.1, cy + ey + 0.1] : [cx - ey - 0.1, cy - ex - 0.1, cx + ey + 0.1, cy + ex + 0.1];
  if (!alongX) rotate90(pr, cx, cy);
  pr.cx = cx; pr.cy = cy;
  return pr;
}
// gira um objeto 90° (troca x por y) depois de montado
function rotate90(pr, cx, cy) {
  const { nx, ny, nz } = pr, o = newProp(pr.kind, cx - ny * PVS / 2, cy - nx * PVS / 2, ny, nx, nz);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const a = (k * ny + j) * nx + i; if (!pr.mat[a]) continue;
    const b = (k * nx + i) * ny + (ny - 1 - j); o.mat[b] = pr.mat[a]; o.cr[b] = pr.cr[a]; o.cg[b] = pr.cg[a]; o.cb[b] = pr.cb[a]; }
  Object.assign(pr, { x0: o.x0, y0: o.y0, nx: ny, ny: nx, mat: o.mat, cr: o.cr, cg: o.cg, cb: o.cb }); pr.solid0 = undefined; finish(pr);
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
    if (Math.abs(pz - (H - 0.4)) < 0.05 && Math.abs(py) < 0.05 && Math.abs(px) < 0.75) { put(pr, i, j, k, WOOD, [86, 68, 50], 6, s); continue; }
    if (Math.abs(pz - (H - 0.3)) < 0.06 && Math.abs(py) < 0.05 && [-0.65, -0.3, 0.3, 0.65].some(v => Math.abs(px - v) < 0.05)) put(pr, i, j, k, GLASS, [208, 214, 206], 0, s); }
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
function burn(pr, x, y, z, r, seed, rem) { own(pr); rem = rem || [];
  const P = PVS, r2 = r * r, { nx, ny, nz, mat } = pr;
  const i0 = Math.max(0, Math.floor((x - r - pr.x0) / P)), i1 = Math.min(nx - 1, Math.floor((x + r - pr.x0) / P)), j0 = Math.max(0, Math.floor((y - r - pr.y0) / P)), j1 = Math.min(ny - 1, Math.floor((y + r - pr.y0) / P));
  const k0 = Math.max(0, Math.floor((z - r) / P)), k1 = Math.min(nz - 1, Math.floor((z + r) / P));
  for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const idx = (k * ny + j) * nx + i, m = mat[idx]; if (!BURN[m]) continue;
    const dx = pr.x0 + (i + .5) * P - x, dy = pr.y0 + (j + .5) * P - y, dz = (k + .5) * P - z; if (dx * dx + dy * dy + dz * dz > r2) continue;
    if (h3(i, j, k, seed) > (m === WOOD ? 0.25 : 0.7)) continue;
    if (!SOFT[m]) pr.solid--; mat[idx] = 0; rem.push(idx); }
  return rem; }
function flammableNear(pr, x, y, z, r) { const P = PVS, { nx, ny, nz, mat } = pr;
  const i0 = Math.max(0, Math.floor((x - r - pr.x0) / P)), i1 = Math.min(nx - 1, Math.floor((x + r - pr.x0) / P)), j0 = Math.max(0, Math.floor((y - r - pr.y0) / P)), j1 = Math.min(ny - 1, Math.floor((y + r - pr.y0) / P));
  const k0 = Math.max(0, Math.floor((z - r) / P)), k1 = Math.min(nz - 1, Math.floor((z + r) / P)); let n = 0;
  for (let k = k0; k <= k1; k += 2) for (let j = j0; j <= j1; j += 2) for (let i = i0; i <= i1; i += 2) if (BURN[mat[(k * ny + j) * nx + i]]) n++;
  return n; }
// casa desaba: o que estava acima de 1,1 m cai e vira um monte de entulho dentro das paredes
function collapse(pr) { own(pr); const rem = [], P = PVS, { nx, ny, nz, mat } = pr, kc = Math.ceil(1.1 / P);
  for (let k = kc; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const idx = (k * ny + j) * nx + i; if (mat[idx]) { mat[idx] = 0; rem.push(idx); } }
  const f = pr.foot, hx = (f[2] - f[0]) / 2, hy = (f[3] - f[1]) / 2, cx = (f[0] + f[2]) / 2, cy = (f[1] + f[3]) / 2, s = (pr.id || 1) * 7919, C = pr.rubbleC || [[150, 140, 120], [120, 100, 70], [110, 84, 58]];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = pr.x0 + (i + .5) * P, y = pr.y0 + (j + .5) * P, u = (x - cx) / hx, v = (y - cy) / hy; if (Math.abs(u) > 1.08 || Math.abs(v) > 1.08) continue;
    const hm = 1.25 * (1 - 0.7 * Math.min(1, u * u + v * v)) * (0.7 + 0.45 * vn3(x / 0.55, y / 0.55, 0, s)) - (Math.max(Math.abs(u), Math.abs(v)) > 1 ? 0.5 : 0);
    for (let k = 0; k < kc + 3 && (k + .5) * P < hm; k++) { const idx = (k * ny + j) * nx + i; if (mat[idx]) continue;
      const pick = h3(i >> 1, j >> 1, k >> 1, s), base = pick < 0.55 ? C[0] : pick < 0.82 ? C[1] : C[2];
      mat[idx] = RUBBLE; const c = mix(base, 0.62 + 0.3 * h3(i, j, k, s + 1));
      pr.cr[idx] = c[0]; pr.cg[idx] = c[1]; pr.cb[idx] = c[2]; } }
  pr.collapsed = true; pr.block = false; pr.crush = true; pr.rubble = true;
  finish(pr); return rem; }
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
  const o = newProp(pr.kind, bx0, by0, gx, gy, gz);
  for (const [a, b, c, idx, stump] of src) {
    const wx = stump ? cx + a : cx + ux * a - uy * b, wy = stump ? cy + b : cy + uy * a + ux * b, wz = stump ? c : c;
    const i = Math.floor((wx - o.x0) / P), j = Math.floor((wy - o.y0) / P), k = Math.floor(wz / P); if (i < 0 || j < 0 || k < 0 || i >= gx || j >= gy || k >= gz) continue;
    const t = (k * gy + j) * gx + i; o.mat[t] = pr.mat[idx]; o.cr[t] = pr.cr[idx]; o.cg[t] = pr.cg[idx]; o.cb[t] = pr.cb[idx]; }
  Object.assign(pr, { x0: o.x0, y0: o.y0, nx: gx, ny: gy, nz: gz, n: o.n, mat: o.mat, cr: o.cr, cg: o.cg, cb: o.cb, shared: false, sharedCol: false, tpl: null });
  pr.fallen = true; pr.block = false; pr.crush = true; pr.fallDir = dir & 3; pr.solid0 = undefined;
  finish(pr); pr.foot = [pr.bb[0], pr.bb[1], pr.bb[2], pr.bb[3]]; reindex(M, pr);
  return pr; }
const fallDir = (dx, dy) => Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 2) : (dy > 0 ? 1 : 3);

// ---------------------------------------------------------------- mapa
function generate(seed, themeKey) {
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
      const side = R() < 0.5 ? -1 : 1, w = 6 + R() * 3, d = 5 + R() * 2, along = R() < 0.7;
      const cy = roadY(x) + side * (11 + R() * 5);
      const hw = (along ? w : d) / 2 + 0.6, hd = (along ? d : w) / 2 + 0.6;
      if (!free(x - hw, cy - hd, x + hw, cy + hd, 3) || roadDist(x, cy) < hd + 1) continue;
      add(house(x, cy, w, d, along, T, ns()));
      // muro ou cerca no quintal, atrás da casa
      const yb = cy + side * (hd + 3.5), kind = T.roofKind === 'tile' ? 'wall' : 'fence', len = 9 + R() * 6;
      if (free(x - len / 2, yb - 0.4, x + len / 2, yb + 0.4, 0.5)) add(linear(kind, x - len / 2, yb, len, true, ns()));
      if (R() < 0.5) { const xs = x + (R() < 0.5 ? -1 : 1) * (len / 2), y0 = Math.min(yb, cy), y1 = Math.max(yb, cy);
        if (free(xs - 0.4, y0, xs + 0.4, y1, 0.3)) add(linear(kind, xs, y0, y1 - y0, false, ns())); }
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

return { PVS, SIZE, HALF, RES, OPAC, SOFT, BURN, RUBBLE_Z, MAT: { LEAF, TRUNK, WALL, TILE, HAY, WOOD, STONE, FLOOR, RUBBLE, THATCH, SAND, METAL, GLASS, RUBBER, DIRT, BRICK },
  THEMES, generate, propAt, propCenter, propsAlong, rayBox, los, obbHitsBox, mulberry32, h3,
  tunnel, crushBox, burn, flammableNear, collapse, fell, fallDir, craterRim, addVisual, reindex, own, ownColors };
});
