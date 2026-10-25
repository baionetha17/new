// Gerador de mapa compartilhado: mesma semente = mesmo mapa no servidor e em todos os navegadores.
// Terreno plano de 500 x 500 m com campos, estradas e objetos destrutíveis em voxels de 25 cm.
(function (root, f) { if (typeof module === 'object' && module.exports) module.exports = f(); else root.MAPGEN = f(); })(typeof self !== 'undefined' ? self : this, function () {
'use strict';
const PVS = 0.25, SIZE = 500, HALF = 250, CELL = 10, NC = SIZE / CELL;
// materiais: 1 folha, 2 tronco, 3 parede, 4 telhado, 5 feno, 6 madeira, 7 pedra, 8 piso
const RES = [0, 0.3, 12, 20, 3, 1, 4, 22, 2];       // mm de penetração perdidos por voxel atravessado
const OPAC = [0, 0.07, 1, 1, 1, 0.35, 0.5, 1, 1];  // quanto cada voxel tapa a visão
const SOFT = [0, 1, 0, 0, 0, 1, 0, 0, 0];

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function h3(i, j, k, s) { let h = (i * 374761393 + j * 668265263 + k * 1274126177 + s * 1103515245) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }

const THEMES = {
  kursk: { name: 'Prokhorovka, Kursk (1943)', short: 'Kursk',
    crops: [[176, 160, 96], [190, 172, 104], [122, 128, 72], [112, 94, 66], [98, 118, 62], [150, 140, 80]],
    road: [138, 116, 86], wall: [206, 200, 184], roof: [[158, 128, 74], [142, 112, 62]], roofKind: 'thatch',
    trees: ['birch', 'birch', 'oak', 'birch'], belts: 0.32, hedges: 0, villages: 2, hay: 22, loose: 16 },
  normandia: { name: 'Bocage da Normandia (1944)', short: 'Normandia',
    crops: [[92, 124, 62], [104, 134, 68], [112, 94, 70], [170, 155, 95], [86, 116, 58], [120, 140, 74]],
    road: [128, 112, 90], wall: [170, 160, 138], roof: [[78, 82, 92], [150, 82, 58]], roofKind: 'tile',
    trees: ['oak', 'oak', 'apple', 'pine'], belts: 0.12, hedges: 0.36, villages: 2, hay: 8, loose: 22 }
};

function newProp(kind, x0, y0, nx, ny, nz) { const n = nx * ny * nz;
  return { kind, x0, y0, z0: 0, nx, ny, nz, n, mat: new Uint8Array(n), cr: new Uint8Array(n), cg: new Uint8Array(n), cb: new Uint8Array(n) }; }
function put(pr, i, j, k, m, c, jit, s) { const idx = (k * pr.ny + j) * pr.nx + i; pr.mat[idx] = m;
  const v = jit ? (h3(i, j, k, s || 1) - .5) * jit : 0; pr.cr[idx] = Math.max(0, Math.min(255, c[0] + v)); pr.cg[idx] = Math.max(0, Math.min(255, c[1] + v)); pr.cb[idx] = Math.max(0, Math.min(255, c[2] + v * 0.8)); }
function hollow(pr) { const { nx, ny, nz, mat } = pr; const kill = [];
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) { const idx = (k * ny + j) * nx + i; const m = mat[idx]; if (!SOFT[m]) continue;
    if (mat[idx + 1] && mat[idx - 1] && mat[idx + nx] && mat[idx - nx] && mat[idx + nx * ny] && mat[idx - nx * ny]) kill.push(idx); }
  for (const idx of kill) mat[idx] = 0; }
function finish(pr) { const L = []; let solid = 0, top = 0;
  for (let i = 0; i < pr.n; i++) if (pr.mat[i]) { L.push(i); if (!SOFT[pr.mat[i]]) solid++; const k = (i / (pr.nx * pr.ny)) | 0; if (k > top) top = k; }
  pr.list = Int32Array.from(L); pr.solid0 = solid; pr.solid = solid;
  pr.bb = [pr.x0, pr.y0, pr.x0 + pr.nx * PVS, pr.y0 + pr.ny * PVS, (top + 1) * PVS];
  return pr; }

// ---------------------------------------------------------------- objetos
function tree(x, y, type, s) {
  const r = mulberry32(s);
  let tr, cr, crz, cz, top, leaf, bark;
  if (type === 'birch') { tr = 0.14; cr = 1.5 + r() * 0.7; crz = 2.6 + r() * 0.8; cz = 5 + r() * 1.2; top = cz + crz; leaf = [104, 146, 62]; bark = [222, 222, 212]; }
  else if (type === 'pine') { tr = 0.2; cr = 1.8 + r() * 0.5; crz = 0; cz = 1.6; top = 8.5 + r() * 2.5; leaf = [44, 80, 54]; bark = [96, 70, 50]; }
  else if (type === 'apple') { tr = 0.17; cr = 1.4 + r() * 0.5; crz = 1.15 + r() * 0.35; cz = 2.5 + r() * 0.3; top = cz + crz; leaf = [86, 128, 56]; bark = [92, 74, 56]; }
  else { tr = 0.3; cr = 2.2 + r() * 0.9; crz = 2.0 + r() * 0.6; cz = 4.6 + r() * 1.0; top = cz + crz; leaf = [62, 102, 46]; bark = [88, 70, 52]; }
  const half = Math.ceil(cr / PVS) + 1, nx = half * 2, nz = Math.ceil(top / PVS) + 1;
  const pr = newProp('tree', x - half * PVS, y - half * PVS, nx, nx, nz); pr.tree = type;
  const fruit = type === 'apple';
  for (let k = 0; k < nz; k++) for (let j = 0; j < nx; j++) for (let i = 0; i < nx; i++) {
    const px = (i + .5) * PVS - half * PVS, py = (j + .5) * PVS - half * PVS, pz = (k + .5) * PVS, rr = Math.hypot(px, py);
    const n = h3(i, j, k, s & 1023);
    let inCrown = false;
    if (type === 'pine') { if (pz > cz) { const f = (pz - cz) / (top - cz), tier = ((pz - cz) / 1.1) % 1; const R = cr * (1 - f) * (0.7 + 0.3 * (1 - tier)); inCrown = rr < R + 0.1 - n * 0.25; } }
    else { const e = Math.sqrt((px * px + py * py) / (cr * cr) + ((pz - cz) / crz) ** 2); inCrown = e < 1 - 0.2 * n; }
    if (inCrown) { const shade = 0.82 + 0.25 * (pz - cz + crz) / (2 * crz + 0.01); const c = fruit && n > 0.93 ? [190, 60, 40] : [leaf[0] * shade, leaf[1] * shade, leaf[2] * shade]; put(pr, i, j, k, 1, c, 26, s); continue; }
    if (rr < tr && pz < (type === 'pine' ? top - 1 : cz + crz * 0.3)) { const c = type === 'birch' && n > 0.78 ? [40, 40, 36] : bark; put(pr, i, j, k, 2, c, 14, s); }
  }
  hollow(pr); finish(pr);
  pr.crush = true; pr.foot = [x - 0.5, y - 0.5, x + 0.5, y + 0.5]; pr.cx = x; pr.cy = y;
  return pr;
}
function house(cx, cy, w, d, alongX, T, s) {
  const r = mulberry32(s);
  const W = alongX ? w : d, D = alongX ? d : w;              // W ao longo da cumeeira
  const wh = 2.75, ha = D / 2 + 0.35, rh = D * 0.42, ex = W / 2, ey = D / 2;
  const nx = Math.ceil((W + 0.8) / PVS), ny = Math.ceil((D + 0.8) / PVS), nz = Math.ceil((wh + rh + 1.4) / PVS);
  const x0 = cx - nx * PVS / 2, y0 = cy - ny * PVS / 2;
  const pr = newProp('house', x0, y0, nx, ny, nz);
  const roofC = T.roof[(r() * T.roof.length) | 0], wallC = T.wall.map(v => v - r() * 18);
  const door = (r() - 0.5) * (W - 3), chim = [(r() - 0.5) * W * 0.6, (r() < 0.5 ? -1 : 1) * ha * 0.35];
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const pl = x0 + (i + .5) * PVS - cx, pa = y0 + (j + .5) * PVS - cy, pz = (k + .5) * PVS;  // ao longo, através, altura
    const roofZ = wh + rh * (1 - Math.abs(pa) / ha);
    const inX = Math.abs(pl) <= ex, inY = Math.abs(pa) <= ey;
    // chaminé
    if (Math.abs(pl - chim[0]) < 0.3 && Math.abs(pa - chim[1]) < 0.3 && pz > wh && pz < wh + rh + 0.6) { put(pr, i, j, k, 3, [120, 96, 84], 18, s); continue; }
    // telhado
    if (Math.abs(pl) <= ex + 0.3 && Math.abs(pa) <= ha && pz <= roofZ && pz > roofZ - 0.32) {
      const row = Math.floor((ha - Math.abs(pa)) / 0.5) % 2, c = T.roofKind === 'thatch' ? roofC.map(v => v * (0.9 + 0.1 * row)) : roofC.map(v => v * (row ? 1 : 0.86));
      put(pr, i, j, k, 4, c, T.roofKind === 'thatch' ? 22 : 10, s); continue; }
    if (!inX || !inY) continue;
    const edgeX = ex - Math.abs(pl) < PVS, edgeY = ey - Math.abs(pa) < PVS;
    if (k === 0 && !edgeX && !edgeY) { put(pr, i, j, k, 8, [70, 56, 44], 10, s); continue; }
    if (!edgeX && !edgeY) continue;
    const wallTop = edgeX ? roofZ : wh;     // empenas sobem até o telhado
    if (pz > wallTop) continue;
    // portas e janelas
    if (edgeY && !edgeX) {
      if (pa > 0 && Math.abs(pl - door) < 0.55 && pz < 2.1) { if (Math.abs(pl - door) > 0.42 || pz > 2.0) put(pr, i, j, k, 6, [80, 60, 44], 8, s); continue; }
      const t = ((pl + ex) % 2.4 + 2.4) % 2.4; if (t > 0.8 && t < 1.7 && pz > 1.0 && pz < 1.95 && Math.abs(pl) < ex - 0.7) { if (t < 0.9 || t > 1.6 || pz < 1.1 || pz > 1.85) put(pr, i, j, k, 6, [60, 48, 38], 8, s); continue; }
    }
    if (edgeX && !edgeY && pz > 1.0 && pz < 1.9 && Math.abs(pa) < 0.5) { if (Math.abs(pa) > 0.38 || pz < 1.1 || pz > 1.8) put(pr, i, j, k, 6, [60, 48, 38], 8, s); continue; }
    const c = T.roofKind === 'tile' ? wallC.map(v => v * (0.88 + 0.12 * h3(Math.floor(pl * 2), Math.floor(pz * 3), j, 7))) : wallC;
    put(pr, i, j, k, 3, pz < 0.4 ? c.map(v => v * 0.78) : c, 12, s);
  }
  finish(pr);
  pr.block = true; pr.crush = false;
  pr.foot = alongX ? [cx - ex - 0.1, cy - ey - 0.1, cx + ex + 0.1, cy + ey + 0.1] : [cx - ey - 0.1, cy - ex - 0.1, cx + ey + 0.1, cy + ex + 0.1];
  if (!alongX) rotate90(pr, cx, cy);
  pr.cx = cx; pr.cy = cy;
  return pr;
}
// gira a casa 90° (troca x por y) depois de montada
function rotate90(pr, cx, cy) {
  const { nx, ny, nz } = pr, o = newProp(pr.kind, cx - ny * PVS / 2, cy - nx * PVS / 2, ny, nx, nz);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const a = (k * ny + j) * nx + i; if (!pr.mat[a]) continue;
    const b = (k * nx + i) * ny + (ny - 1 - j); o.mat[b] = pr.mat[a]; o.cr[b] = pr.cr[a]; o.cg[b] = pr.cg[a]; o.cb[b] = pr.cb[a]; }
  Object.assign(pr, { x0: o.x0, y0: o.y0, nx: ny, ny: nx, mat: o.mat, cr: o.cr, cg: o.cg, cb: o.cb }); finish(pr);
}
// muro de pedra, cerca de madeira ou sebe, sempre alinhados com x ou y
function linear(kind, ax, ay, len, alongX, s) {
  const r = mulberry32(s), th = kind === 'hedge' ? 1.25 : kind === 'wall' ? 0.5 : 0.25, hgt = kind === 'hedge' ? 1.7 : kind === 'wall' ? 1.0 : 1.25;
  const L = Math.ceil(len / PVS), T = Math.ceil(th / PVS), nz = Math.ceil((hgt + 0.5) / PVS);
  const nx = alongX ? L : T, ny = alongX ? T : L;
  const pr = newProp(kind, ax - (alongX ? 0 : th / 2), ay - (alongX ? th / 2 : 0), nx, ny, nz);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const u = alongX ? i : j, v = alongX ? j : i, pz = (k + .5) * PVS, n = h3(i, j, k, s & 1023), along = (u + .5) * PVS;
    if (kind === 'wall') { const top = hgt - 0.25 * h3(Math.floor(along / 0.6), 0, 0, s & 255); if (pz > top) continue; const moss = pz > top - 0.3 && n > 0.6; put(pr, i, j, k, 7, moss ? [96, 112, 74] : [134, 128, 116], 26, s); }
    else if (kind === 'fence') { const post = (along % 2.0) < PVS; const rail = Math.abs(pz - 0.55) < PVS / 2 || Math.abs(pz - 1.05) < PVS / 2; if (pz > hgt || !(post || rail)) continue; put(pr, i, j, k, 6, [112, 86, 60], 16, s); }
    else { const top = hgt - 0.5 * n * n; const vv = (v + .5) * PVS - th / 2; if (pz > top || Math.abs(vv) > th / 2 - 0.3 * (pz / hgt) * n) continue; put(pr, i, j, k, 1, [58 + 20 * n, 92 + 26 * n, 46], 14, s); }
  }
  hollow(pr); finish(pr);
  pr.crush = true; pr.foot = [pr.x0, pr.y0, pr.x0 + nx * PVS, pr.y0 + ny * PVS];
  pr.cx = pr.x0 + nx * PVS / 2; pr.cy = pr.y0 + ny * PVS / 2;
  return pr;
}
function haystack(x, y, s) {
  const r = mulberry32(s), R = 1.3 + r() * 0.5, Hh = 1.8 + r() * 0.5, half = Math.ceil(R / PVS) + 1, nz = Math.ceil(Hh / PVS) + 1;
  const pr = newProp('hay', x - half * PVS, y - half * PVS, half * 2, half * 2, nz);
  for (let k = 0; k < nz; k++) for (let j = 0; j < half * 2; j++) for (let i = 0; i < half * 2; i++) {
    const px = (i + .5 - half) * PVS, py = (j + .5 - half) * PVS, pz = (k + .5) * PVS;
    if ((px * px + py * py) / (R * R) + (pz / Hh) ** 2 < 1) put(pr, i, j, k, 5, [204, 174, 96].map(v => v * (0.82 + 0.18 * pz / Hh)), 26, s); }
  hollow(pr); finish(pr);
  pr.crush = true; pr.foot = [x - R, y - R, x + R, y + R]; pr.cx = x; pr.cy = y;
  return pr;
}

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
      const pr = add(house(x, cy, w, d, along, T, ns()));
      // muro ou cerca no quintal, atrás da casa
      const yb = cy + side * (hd + 3.5), kind = T.roofKind === 'tile' ? 'wall' : 'fence', len = 9 + R() * 6;
      if (free(x - len / 2, yb - 0.4, x + len / 2, yb + 0.4, 0.5)) add(linear(kind, x - len / 2, yb, len, true, ns()));
      if (R() < 0.5) { const xs = x + (R() < 0.5 ? -1 : 1) * (len / 2), y0 = Math.min(yb, cy), y1 = Math.max(yb, cy);
        if (free(xs - 0.4, y0, xs + 0.4, y1, 0.3)) add(linear(kind, xs, y0, y1 - y0, false, ns())); }
      // pomar ao lado de algumas casas na Normandia
      if (T.trees.includes('apple') && R() < 0.4) { const ox = x + (R() < 0.5 ? -1 : 1) * 14, oy = cy + side * 8;
        for (let a = 0; a < 3; a++) for (let b = 0; b < 2; b++) { const tx = ox + (a - 1) * 5, ty = oy + side * b * 5; if (free(tx - 1.6, ty - 1.6, tx + 1.6, ty + 1.6, 0.4) && roadDist(tx, ty) > 3) add(tree(tx, ty, 'apple', ns())); } }
    }
  }
  // cinturões de árvores e sebes nas divisas dos campos
  for (const f of M.fields) for (const edge of [0, 1]) {
    const r = R(); const isBelt = r < T.belts, isHedge = !isBelt && r < T.belts + T.hedges; if (!isBelt && !isHedge) continue;
    const alongX = edge === 0, len = alongX ? f.x1 - f.x0 : f.y1 - f.y0; if (len < 25) continue;
    const ex = alongX ? f.x0 : f.x0, ey = alongX ? f.y0 : f.y0;
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
  for (const pr of M.props) { const b = pr.bb; const i0 = cellOf(b[0]), i1 = cellOf(b[2]), j0 = cellOf(b[1]), j1 = cellOf(b[3]);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) M.cells[j * NC + i].push(pr.id); }
  return M;
}
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
  for (const id of propsAlong(M, a[0], a[1], b[0], b[1])) { const pr = M.props[id]; if (pr.gone) continue;
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

return { PVS, SIZE, HALF, RES, OPAC, SOFT, THEMES, generate, propAt, propCenter, propsAlong, rayBox, los, obbHitsBox, mulberry32 };
});
