// Desenho em pixel art: chão em textura, objetos e tanques em voxels, partículas. Portado do Banco de Provas.
const RENDER = (() => {
'use strict';
const { VS, D2R, G, clamp, lerp, hash, vnoise, nrm, toW, toL, gCenter, CAT } = SIM;
const PVS = MAPGEN.PVS;
const PITCH = 55 * D2R, SA = Math.sin(PITCH), CA = Math.cos(PITCH);
const LIGHT = nrm([-0.5, 0.45, 0.75]);
const KX = -LIGHT[0] / LIGHT[2], KY = -LIGHT[1] / LIGHT[2];
const rnd = Math.random;
const pack = (r, g, b) => (255 << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255);
const FIRE = [[255, 250, 220], [255, 210, 90], [255, 140, 40], [220, 70, 25], [120, 40, 20], [50, 30, 25]];
function fireCol(t) { const f = clamp(t, 0, 0.999) * (FIRE.length - 1), i = f | 0, u = f - i; const a = FIRE[i], b = FIRE[i + 1]; return [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)]; }

// ================================================================ vista (um canvas)
class View {
  constructor(cv, px) { this.cv = cv; this.ctx = cv.getContext('2d'); this.cam = { x: 0, y: 0, S: 10, ox: 0, oy: 0 }; this.fixedPX = px; this.cw = 0; this.ch = 0;
    this.particles = []; this.labels = []; this.resize(); }
  resize() { const r = this.cv.getBoundingClientRect(); const w = Math.max(2, Math.round(r.width)), h = Math.max(2, Math.round(r.height));
    if (w === this.cw && h === this.ch) return false; this.cw = w; this.ch = h;
    // GBcss: tamanho do pixel do chão na tela (pixel art). Afastado, tanques e objetos são desenhados em pixel 1x1 (PX = 1)
    // e o chão em blocos de GBcss; de perto o voxel já é grande e tudo volta ao pixel do chão (setPX).
    this.GBcss = this.fixedPX || (w < 900 ? 2 : 3); this.PX = this.fixedPX || this.wantPX || 1; this.GB = Math.max(1, Math.round(this.GBcss / this.PX)); this.cv.width = w; this.cv.height = h;
    const W = this.W = Math.ceil(w / this.PX / 4) * 4, H = this.H = Math.ceil(h / this.PX);   // largura múltipla de 4: o contorno pula 4 pixels vazios de uma vez
    this.off = document.createElement('canvas'); this.off.width = W; this.off.height = H; this.offc = this.off.getContext('2d');
    this.img = this.offc.createImageData(W, H); this.u32 = new Uint32Array(this.img.data.buffer);
    this.zb = new Float32Array(W * H); this.idb = new Int32Array(W * H); this.occ = new Uint8Array(W * H); this.occ32 = new Uint32Array(this.occ.buffer); this.shadow = new Uint8Array(W * H); this.shadow32 = null; return true; }
  setPX(px) { if (this.fixedPX || px === this.PX) return; this.wantPX = px; this.cw = 0; this.resize(); }
  proj(x, y, z, o) { const c = this.cam, X = x - c.x - c.ox, Y = y - c.y - c.oy; o[0] = this.W / 2 + X * c.S; o[1] = this.H / 2 - (Y * SA + z * CA) * c.S; o[2] = Y * CA - z * SA; return o; }
  unproj(sx, sy) { const c = this.cam; return [(sx - this.W / 2) / c.S + c.x + c.ox, -(sy - this.H / 2) / (c.S * SA) + c.y + c.oy, 0]; }
  clear(col) { this.u32.fill(col); this.zb.fill(Infinity); this.idb.fill(0); this.occ.fill(0); }
  // chão a partir da textura do mapa
  ground(T) { const { W, H, u32, cam } = this, S = cam.S, cx = cam.x + cam.ox, cy = cam.y + cam.oy, res = T.res, tw = T.w, th = T.h, out = T.out, data = T.data;
    const B = this.GB, step = res / S * B, tx0 = ((B / 2 - W / 2) / S + cx - T.x0) * res;
    for (let y = 0; y < H; y += B) { const wy = -(y + B / 2 - H / 2) / (S * SA) + cy, ty = Math.floor((wy - T.y0) * res), row = y * W, yEnd = Math.min(H, y + B);
      if (ty < 0 || ty >= th) { u32.fill(out, row, yEnd * W); continue; }
      const base = ty * tw; let tx = tx0;
      for (let x = 0; x < W; x += B, tx += step) { const ix = tx | 0, v = (tx < 0 || ix >= tw) ? out : data[base + ix], e = Math.min(W, x + B); for (let q = row + x; q < row + e; q++) u32[q] = v; }
      for (let yy = y + 1; yy < yEnd; yy++) u32.copyWithin(yy * W, row, row + W); }
    this.zb.fill(Infinity); this.idb.fill(0); this.occ.fill(0); }
  // anel da zona de captura desenhado no chão
  groundRing(x, y, r, col, a) { const P = [0, 0, 0]; const n = Math.max(64, Math.round(r * this.cam.S * 4));
    for (let i = 0; i < n; i++) { const t = i / n * Math.PI * 2; this.proj(x + Math.cos(t) * r, y + Math.sin(t) * r, 0, P); this.plot(P[0], P[1], col[0], col[1], col[2], a, false); if (i % 2) this.plot(P[0], P[1] + 1, col[0], col[1], col[2], a * 0.6, false); } }
  // sombra dos tanques (os objetos já têm sombra gravada na textura)
  shadowGrid(g, T) { const R = T.R, o = T.o, pv = T.p, s = Math.max(1, Math.ceil(VS * this.cam.S * 1.1)), hs = s / 2, W = this.W, H = this.H, sh = this.shadow, P = [0, 0, 0];
    for (let a = 0; a < g.list.length; a++) { const idx = g.list[a]; if (!g.mat[idx]) continue; const lx = g.cx[a] - pv[0], ly = g.cy[a] - pv[1], lz = g.cz[a] - pv[2];
      const wx = o[0] + R[0] * lx + R[1] * ly + R[2] * lz, wy = o[1] + R[3] * lx + R[4] * ly + R[5] * lz, wz = o[2] + R[6] * lx + R[7] * ly + R[8] * lz; if (wz < 0.02) continue;
      this.proj(wx + KX * wz, wy + KY * wz, 0, P); const x0 = (P[0] - hs) | 0, y0 = (P[1] - hs) | 0;
      for (let yy = y0; yy < y0 + s; yy++) { if (yy < 0 || yy >= H) continue; for (let xx = x0; xx < x0 + s; xx++) { if (xx < 0 || xx >= W) continue; sh[yy * W + xx] = 1; } } } }
  applyShadow() { const u = this.u32, sh = this.shadow, s32 = this.shadow32 || (this.shadow32 = new Uint32Array(sh.buffer, 0, sh.length >> 2));
    for (let q = 0; q < s32.length; q++) { if (!s32[q]) continue; for (let i = q * 4; i < q * 4 + 4; i++) { if (!sh[i]) continue; const c = u[i]; u[i] = pack((c & 255) * 0.55, ((c >> 8) & 255) * 0.58, ((c >> 16) & 255) * 0.62); } s32[q] = 0; } }
  // voxels de um tanque. mode: ext | cut (sem teto, mostra tripulação e módulos)
  splatGrid(tank, g, T, code, mode) {
    const R = T.R, o = T.o, pv = T.p, cam = this.cam, s = Math.max(1, Math.ceil(VS * cam.S * 1.08)), hs = s / 2, sv = Math.max(1, Math.ceil(VS * cam.S * (SA + CA) * 1.02)), hv = sv / 2, W = this.W, H = this.H, S = cam.S;
    const L0 = LIGHT[0], L1 = LIGHT[1], L2 = LIGHT[2], cut = mode === 'cut', MOD = tank.MOD, cx = cam.x + cam.ox, cy = cam.y + cam.oy;
    const zb = this.zb, u32 = this.u32, idb = this.idb, occ = this.occ;
    for (let a = 0; a < g.list.length; a++) { const idx = g.list[a]; const mat = g.mat[idx]; if (!mat) continue;
      const pl = g.plate[idx];
      if (cut && (pl === 7 || pl === 20 || pl === 15 || pl === 18 || (pl === 16 && g.cz[a] > 2.42) || pl === 19)) continue;
      const lx = g.cx[a] - pv[0], ly = g.cy[a] - pv[1], lz = g.cz[a] - pv[2];
      const wx = o[0] + R[0] * lx + R[1] * ly + R[2] * lz, wy = o[1] + R[3] * lx + R[4] * ly + R[5] * lz, wz = o[2] + R[6] * lx + R[7] * ly + R[8] * lz;
      const X = wx - cx, Y = wy - cy; const sx = W / 2 + X * S, sy = H / 2 - (Y * SA + wz * CA) * S, d = Y * CA - wz * SA;
      if (sx < -s || sy < -s || sx > W + s || sy > H + s) continue;
      const nx = g.lnx[idx], ny = g.lny[idx], nz = g.lnz[idx];
      const wnx = R[0] * nx + R[1] * ny + R[2] * nz, wny = R[3] * nx + R[4] * ny + R[5] * nz, wnz = R[6] * nx + R[7] * ny + R[8] * nz;
      const sh = 0.5 + 0.62 * Math.max(0, wnx * L0 + wny * L1 + wnz * L2) + 0.08 * wnz;
      let r = g.cr[idx], gg = g.cg[idx], b = g.cb[idx];
      if (mat === 2 && cut) { const m = MOD[g.mod[idx]]; if (m.kind !== 'track') { const cc = CAT[m.kind].c; r = cc[0]; gg = cc[1]; b = cc[2]; if (m.dead) { r *= 0.45; gg *= 0.35; b *= 0.35; } } }
      const bu = g.burn[idx]; if (bu > 0) { const f = 1 - bu * 0.8; r = r * f + 18 * bu; gg = gg * f + 14 * bu; b = b * f + 12 * bu; }
      r *= sh; gg *= sh; b *= sh;
      const ht = g.heat[idx]; if (ht > 0) { r += 255 * ht; gg += 120 * ht * ht; b += 30 * ht * ht * ht; }
      const col = pack(r > 255 ? 255 : r, gg > 255 ? 255 : gg, b > 255 ? 255 : b), id = ((code << 20) | idx) + 1;
      const x0 = (sx - hs) | 0, y0 = (sy - hv) | 0;
      for (let yy = y0; yy < y0 + sv; yy++) { if (yy < 0 || yy >= H) continue; const row = yy * W; for (let xx = x0; xx < x0 + s; xx++) { if (xx < 0 || xx >= W) continue; const p = row + xx;
        if (d < zb[p]) { zb[p] = d; u32[p] = col; idb[p] = id; occ[p] = 1; } } } } }
  splatTank(tank, code, mode) { tank.update(); this.splatGrid(tank, tank.GH, tank.TH, code * 2, mode); this.splatGrid(tank, tank.GT, tank.TT, code * 2 + 1, mode); }
  tankOnScreen(tank, m) { const P = this.proj(tank.TH.o[0], tank.TH.o[1], 1, [0, 0, 0]); const r = (m || 7) * this.cam.S; return P[0] > -r && P[0] < this.W + r && P[1] > -r && P[1] < this.H + r; }
  // voxels de um objeto do mapa (casa, árvore...): só os que têm face para a câmera (de cima ou do sul)
  splatProp(pr, code) {
    const b = pr.bb, cam = this.cam, S = cam.S, W = this.W, H = this.H, P = [0, 0, 0];
    this.proj(b[0], b[3], 0, P); const sx0 = P[0]; this.proj(b[2], b[1], 0, P); const sx1 = P[0], syb = P[1]; this.proj(b[0], b[3], b[4], P); const syt = P[1];
    if (sx1 < 0 || sx0 > W || syb < 0 || syt > H) return;
    // longe, cada voxel tem menos de um pixel: desenha um voxel de cada bloco 2x2x2, no dobro do tamanho
    const R = pr.R, lod = PVS * S < 0.7, VZ = lod ? PVS * 2 : PVS, s = Math.max(1, Math.ceil(VZ * S * 1.06)), hs = s / 2, sv = Math.max(1, Math.ceil(VZ * S * (SA + CA) * 1.02)), hv = sv / 2, ox = pr.x0 - cam.x - cam.ox, oy = pr.y0 - cam.y - cam.oy, zb = this.zb, u32 = this.u32, idb = this.idb, occ = this.occ;
    const L = pr.list, lx = R.lx, ly = R.ly, lz = R.lz, shd = R.shd, vis = lod ? R.lod : R.vis, mat = pr.mat, cr = pr.cr, cg = pr.cg, cb = pr.cb, base = (code << 20) + 1;
    for (let q = 0; q < vis.length; q++) { const a = vis[q], idx = L[a]; if (!mat[idx]) continue;
      const X = ox + lx[a], Y = oy + ly[a], z = lz[a]; const sx = W / 2 + X * S, sy = H / 2 - (Y * SA + z * CA) * S, d = Y * CA - z * SA;
      if (sx < -s || sy < -s || sx > W + s || sy > H + s) continue;
      const sh = shd[a] / 100; let r = cr[idx] * sh, g = cg[idx] * sh, bl = cb[idx] * sh; const col = pack(r > 255 ? 255 : r, g > 255 ? 255 : g, bl > 255 ? 255 : bl), id = base + idx;
      const x0 = (sx - hs) | 0, y0 = (sy - hv) | 0;
      if (s === 1 && sv === 1) { if (x0 >= 0 && y0 >= 0 && x0 < W && y0 < H) { const p = y0 * W + x0; if (d < zb[p]) { zb[p] = d; u32[p] = col; idb[p] = id; occ[p] = 1; } } continue; }
      for (let yy = y0; yy < y0 + sv; yy++) { if (yy < 0 || yy >= H) continue; const row = yy * W; for (let xx = x0; xx < x0 + s; xx++) { if (xx < 0 || xx >= W) continue; const p = row + xx;
        if (d < zb[p]) { zb[p] = d; u32[p] = col; idb[p] = id; occ[p] = 1; } } } } }
  // árvore caindo: gira os voxels em volta do pé até deitar (só desenho; a árvore deitada já existe no mapa)
  splatFalling(f, code, u) {
    const cam = this.cam, S = cam.S, W = this.W, H = this.H, s = Math.max(1, Math.ceil(PVS * S * 1.1)), hs = s / 2, sv = Math.max(1, Math.ceil(PVS * S * (SA + CA) * 1.05)), zb = this.zb, u32 = this.u32, idb = this.idb, occ = this.occ;
    const ang = u * u * Math.PI / 2, c = Math.cos(ang), sn = Math.sin(ang), ux = f.ux, uy = f.uy, ccx = f.cx - cam.x - cam.ox, ccy = f.cy - cam.y - cam.oy;
    for (let q = 0; q < f.n; q++) { const sa = f.sa[q], ta = f.ta[q], z = f.z[q];
      const na = sa * c + z * sn, nz = z * c - sa * sn; if (nz < -0.3) continue;
      const X = ccx + ux * na - uy * ta, Y = ccy + uy * na + ux * ta, Z = Math.max(0.05, nz);
      const sx = W / 2 + X * S, sy = H / 2 - (Y * SA + Z * CA) * S, d = Y * CA - Z * SA; if (sx < -s || sy < -s || sx > W + s || sy > H + s) continue;
      const x0 = (sx - hs) | 0, y0 = (sy - sv / 2) | 0, col = f.col[q];
      for (let yy = y0; yy < y0 + sv; yy++) { if (yy < 0 || yy >= H) continue; const row = yy * W; for (let xx = x0; xx < x0 + s; xx++) { if (xx < 0 || xx >= W) continue; const p = row + xx;
        if (d < zb[p]) { zb[p] = d; u32[p] = col; idb[p] = 0; occ[p] = 1; } } } } }
  // pedaços que caíram e ficaram no chão
  drawLitter() { const Lt = this.litter; if (!Lt || !Lt.n) return; const cam = this.cam, S = cam.S, W = this.W, H = this.H, zb = this.zb, u32 = this.u32, occ = this.occ, cx = cam.x + cam.ox, cy = cam.y + cam.oy;
    const n = Math.min(Lt.n, Lt.cap), ps = Lt.pos, cs = Lt.col, sz = Lt.sz;
    for (let q = 0; q < n; q++) { const X = ps[q * 3] - cx, Y = ps[q * 3 + 1] - cy, z = ps[q * 3 + 2]; const sx = W / 2 + X * S, sy = H / 2 - (Y * SA + z * CA) * S; if (sx < -4 || sy < -4 || sx > W + 4 || sy > H + 4) continue;
      const s = Math.max(1, Math.ceil(VS * S * sz[q])), d = Y * CA - z * SA, x0 = (sx - s / 2) | 0, y0 = (sy - s / 2) | 0, col = cs[q];
      for (let yy = y0; yy < y0 + s; yy++) { if (yy < 0 || yy >= H) continue; const row = yy * W; for (let xx = x0; xx < x0 + s; xx++) { if (xx < 0 || xx >= W) continue; const p = row + xx;
        if (d < zb[p]) { zb[p] = d; u32[p] = col; occ[p] = 1; } } } } }
  addLitter(x, y, z, col, sz) { let Lt = this.litter; if (!Lt) Lt = this.litter = { cap: 60000, n: 0, pos: new Float32Array(180000), col: new Uint32Array(60000), sz: new Float32Array(60000) };
    const q = Lt.n % Lt.cap; Lt.pos[q * 3] = x; Lt.pos[q * 3 + 1] = y; Lt.pos[q * 3 + 2] = z; Lt.col[q] = pack(col[0], col[1], col[2]); Lt.sz[q] = sz; Lt.n++; }
  // contorno escuro: em volta dos objetos e onde a profundidade salta (blocos de 4 pixels sem objeto por perto são pulados)
  outline() { const { W, H, zb, u32, occ, occ32 } = this, Wq = W >> 2;
    for (let y = 1; y < H - 1; y++) { const q0 = y * Wq, q1 = q0 + Wq;
      for (let q = q0; q < q1; q++) { if (!(occ32[q] | occ32[q - 1] | occ32[q + 1] | occ32[q - Wq] | occ32[q + Wq])) continue;
        const pe = Math.min(q * 4 + 4, y * W + W - 1);
        for (let p = Math.max(q * 4, y * W + 1); p < pe; p++) {
          if (!occ[p]) { if (!(occ[p - 1] | occ[p + 1] | occ[p - W] | occ[p + W])) continue; const c = u32[p]; u32[p] = (c & 0xFF000000) | ((((c >> 16) & 255) * 0.55) << 16) | ((((c >> 8) & 255) * 0.55) << 8) | ((c & 255) * 0.55); continue; }
          const z = zb[p]; if (zb[p - W] - z > 0.35 || zb[p - 1] - z > 0.35) { const c = u32[p]; u32[p] = (c & 0xFF000000) | ((((c >> 16) & 255) * 0.62) << 16) | ((((c >> 8) & 255) * 0.62) << 8) | ((c & 255) * 0.62); } } } } }
  plot(x, y, r, g, b, a, add) { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= this.W || y >= this.H) return; const p = y * this.W + x, c = this.u32[p];
    if (add) this.u32[p] = pack(Math.min(255, (c & 255) + r * a), Math.min(255, ((c >> 8) & 255) + g * a), Math.min(255, ((c >> 16) & 255) + b * a));
    else this.u32[p] = pack((c & 255) * (1 - a) + r * a, ((c >> 8) & 255) * (1 - a) + g * a, ((c >> 16) & 255) * (1 - a) + b * a); }
  line(x0, y0, x1, y1, r, g, b, a, add) { const dx = x1 - x0, dy = y1 - y0, n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)))); if (n > 9000) return; for (let i = 0; i <= n; i++) this.plot(x0 + dx * i / n, y0 + dy * i / n, r, g, b, a, add); }
  // fumaça em blocos do tamanho do pixel do chão: fica macia e não pesa na tela em 1x1
  softDisc(cx, cy, R, r, g, b, a) { const R2 = R * R, B = this.GB || 1;
    for (let y = Math.floor((cy - R) / B) * B; y <= cy + R; y += B) for (let x = Math.floor((cx - R) / B) * B; x <= cx + R; x += B) { const d = ((x - cx) * (x - cx) + (y - cy) * (y - cy)) / R2; if (d <= 1) { const n = hash(x >> 1, y >> 1) * 0.35, aa = a * (1 - d) * (0.8 + n);
      for (let yy = y; yy < y + B; yy++) for (let xx = x; xx < x + B; xx++) this.plot(xx, yy, r, g, b, aa, false); } } }
  disc(cx, cy, R, r, g, b, a, add) { const R2 = R * R; for (let y = Math.floor(cy - R); y <= cy + R; y++) for (let x = Math.floor(cx - R); x <= cx + R; x++) { const d = (x - cx) * (x - cx) + (y - cy) * (y - cy); if (d <= R2) this.plot(x, y, r, g, b, a * (add ? 1 - d / R2 : 1), add); } }
  present() { this.offc.putImageData(this.img, 0, 0); const c = this.ctx; c.imageSmoothingEnabled = false; c.drawImage(this.off, 0, 0, this.W * this.PX, this.H * this.PX); }
  // ---------------------------------------------------------------- partículas (as mesmas do Banco)
  sparks(p, n, cnt, sp) { const P = this.particles; for (let i = 0; i < cnt; i++) { const d = nrm([n[0] + (rnd() - .5) * 1.6, n[1] + (rnd() - .5) * 1.6, n[2] + (rnd() - .3) * 1.6]); const v = (2 + rnd() * 6) * sp;
    P.push({ k: 0, x: p[0], y: p[1], z: p[2], vx: d[0] * v, vy: d[1] * v, vz: d[2] * v + 1, life: 0.25 + rnd() * 0.6, max: 0.8 }); }
    P.push({ k: 4, x: p[0], y: p[1], z: p[2], life: 0.12, max: 0.12, r: 0.5 }); }
  debris(p, n, col, cnt) { for (let i = 0; i < cnt; i++) { const d = nrm([n[0] + (rnd() - .5), n[1] + (rnd() - .5), n[2] + rnd() * 0.8]); const v = 1.5 + rnd() * 4;
    this.particles.push({ k: 3, x: p[0], y: p[1], z: p[2], vx: d[0] * v, vy: d[1] * v, vz: d[2] * v + 1.5, life: 3 + rnd() * 4, col, sz: 0.5 }); } }
  // keep: o pedaço fica no chão para sempre (vira lixo do mapa) em vez de sumir
  chunk(w, col, sp, sz, keep) { sp = sp || 1; this.particles.push({ k: 3, x: w[0], y: w[1], z: w[2], vx: (rnd() - .5) * 3 * sp, vy: (rnd() - .5) * 3 * sp, vz: (1 + rnd() * 3) * sp, life: keep ? 30 : 6 + rnd() * 6, col, sz: sz || 1, keep }); }
  dust(p, c, col) { for (let i = 0; i < c; i++) this.particles.push({ k: 2, x: p[0] + (rnd() - .5) * .3, y: p[1] + (rnd() - .5) * .3, z: Math.max(0.1, p[2] || 0), vx: (rnd() - .5) * 2, vy: (rnd() - .5) * 2, vz: 0.5 + rnd() * 1.5, life: 1.5 + rnd() * 2, max: 3.5, r0: 0.15, r1: 0.9, col: col || [120, 108, 80] }); }
  fireball(p, s, big) { const P = this.particles;
    P.push({ k: 4, x: p[0], y: p[1], z: p[2], life: 0.18 + s * 0.12, max: 0.18 + s * 0.12, r: 1.2 * s + 0.5 });
    const n = Math.round(40 + s * 160);
    for (let i = 0; i < n; i++) { const z = rnd() * 1.4 - 0.4, a = rnd() * Math.PI * 2, r = Math.sqrt(Math.max(0, 1 - z * z)), v = (1 + rnd() * 4) * s + 0.5;
      P.push({ k: 1, x: p[0], y: p[1], z: p[2], vx: r * Math.cos(a) * v, vy: r * Math.sin(a) * v, vz: z * v + 1, life: 0.4 + rnd() * 0.8 * (0.6 + s), max: 0.4 + 0.8 * (0.6 + s), drag: 2.5 }); }
    for (let i = 0; i < n * 0.5; i++) P.push({ k: 0, x: p[0], y: p[1], z: p[2], vx: (rnd() - .5) * 10 * s, vy: (rnd() - .5) * 10 * s, vz: rnd() * 8 * s + 1, life: 0.5 + rnd() * 1.2, max: 1.2 });
    for (let i = 0; i < n * 0.25; i++) P.push({ k: 2, x: p[0], y: p[1], z: p[2], vx: (rnd() - .5) * 2 * s, vy: (rnd() - .5) * 2 * s, vz: 0.8 + rnd() * 1.5, life: 3 + rnd() * 4, max: 7, r0: 0.2 * s + 0.1, r1: 0.7 * s + 0.5, col: [70, 66, 62] });
    if (big) P.push({ k: 5, x: p[0], y: p[1], z: 0.05, life: 0.6, max: 0.6, r: 3 + s * 3 }); }
  muzzle(p, dir) { const P = this.particles;
    P.push({ k: 4, x: p[0], y: p[1], z: p[2], life: 0.1, max: 0.1, r: 1.1 });
    for (let i = 0; i < 26; i++) { const v = 3 + rnd() * 9; P.push({ k: 1, x: p[0], y: p[1], z: p[2], vx: dir[0] * v + (rnd() - .5) * 3, vy: dir[1] * v + (rnd() - .5) * 3, vz: dir[2] * v + (rnd() - .5) * 2, life: 0.12 + rnd() * 0.2, max: 0.32, drag: 6 }); }
    for (let i = 0; i < 16; i++) { const v = 1 + rnd() * 5; P.push({ k: 2, x: p[0], y: p[1], z: p[2], vx: dir[0] * v + (rnd() - .5), vy: dir[1] * v + (rnd() - .5), vz: 0.4 + rnd(), life: 1.5 + rnd() * 2.5, max: 4, r0: 0.2, r1: 1.1, col: [150, 146, 136] }); }
    P.push({ k: 5, x: p[0] - dir[0] * 2, y: p[1] - dir[1] * 2, z: 0.05, life: 0.35, max: 0.35, r: 4 }); }
  updParticles(dt) { const wind = [0.5, 0.25], P = this.particles;
    for (let i = P.length - 1; i >= 0; i--) { const q = P[i]; q.life -= dt; if (q.life <= 0) { P[i] = P[P.length - 1]; P.pop(); continue; }
      if (q.k === 0) { q.px = q.x; q.py = q.y; q.pz = q.z; q.vz -= G * dt * 0.8; q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt; if (q.z < 0) { q.z = 0; q.vz *= -0.35; q.vx *= 0.6; q.vy *= 0.6; } }
      else if (q.k === 1) { const dr = Math.exp(-(q.drag || 1.2) * dt); q.vx = q.vx * dr + wind[0] * dt; q.vy = q.vy * dr + wind[1] * dt; q.vz = q.vz * dr + 3.2 * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt; }
      else if (q.k === 2) { q.vx = q.vx * 0.98 + wind[0] * dt; q.vy = q.vy * 0.98 + wind[1] * dt; q.vz *= 0.995; q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt; }
      else if (q.k === 3) { if (!q.rest) { q.vz -= G * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt; if (q.z < 0.05) { q.z = 0.05; q.vz *= -0.3; q.vx *= 0.5; q.vy *= 0.5; if (Math.abs(q.vz) < 0.6) q.rest = true; } }
        if (q.rest && q.keep) { this.addLitter(q.x, q.y, 0.05 * (q.sz || 1), q.col, q.sz || 1); P[i] = P[P.length - 1]; P.pop(); } } }
    if (P.length > 7000) P.splice(0, P.length - 7000); }
  drawParticles() { const cam = this.cam, sc = cam.S / 30, P = [0, 0, 0], Q = [0, 0, 0], W = this.W, H = this.H, zb = this.zb;
    for (const q of this.particles) { if (q.k !== 2) continue; this.proj(q.x, q.y, q.z, P); const age = 1 - q.life / q.max; const R = (q.r0 + (q.r1 - q.r0) * age) * cam.S; const a = 0.3 * (1 - age) * Math.min(1, age * 6 + 0.2);
      if (P[0] < -R || P[1] < -R || P[0] > W + R || P[1] > H + R) continue; this.softDisc(P[0], P[1], Math.min(R, cam.S * 1.6, 60 * this.GB), q.col[0], q.col[1], q.col[2], a); }
    for (const q of this.particles) { this.proj(q.x, q.y, q.z, P); const ix = P[0] | 0, iy = P[1] | 0; if (ix < -40 || iy < -40 || ix >= W + 40 || iy >= H + 40) continue;
      const inside = ix >= 0 && iy >= 0 && ix < W && iy < H; const behind = inside && P[2] > zb[iy * W + ix] + 0.12;
      if (q.k === 0) { if (behind || !inside) continue; const t = q.life / q.max; this.proj(q.px ?? q.x, q.py ?? q.y, q.pz ?? q.z, Q); const c = t > 0.5 ? [255, 250, 200] : [255, 190, 80]; this.line(Q[0], Q[1], P[0], P[1], c[0], c[1], c[2], 1, true); }
      else if (q.k === 1) { if (behind) continue; const age = 1 - q.life / q.max; const c = fireCol(age); const R = Math.max(0.6, (0.9 - age * 0.4) * sc * 2.2); this.disc(P[0], P[1], R, c[0], c[1], c[2], 0.9, age < 0.55); }
      else if (q.k === 3) { if (!inside || (behind && !q.rest)) continue; const s = Math.max(1, Math.ceil(VS * cam.S * (q.sz || 1))); const c = pack(q.col[0], q.col[1], q.col[2]); for (let y = iy; y < iy + s; y++) for (let x = ix; x < ix + s; x++) if (x >= 0 && y >= 0 && x < W && y < H) this.u32[y * W + x] = c; }
      else if (q.k === 4) { const a = q.life / q.max; this.disc(P[0], P[1], q.r * cam.S * (1.4 - a * 0.4), 255, 230, 170, 0.9 * a, true); }
      else if (q.k === 5) { const a = q.life / q.max; const R = q.r * cam.S * (1 - a); for (let t = 0; t < 64; t++) { const an = t / 64 * Math.PI * 2; this.plot(P[0] + Math.cos(an) * R, P[1] + Math.sin(an) * R * SA, 255, 220, 170, 0.6 * a, true); } } } }
  label(w, text, col, dur) { this.labels.push({ w: w.slice(), text, col, t: 0, dur: dur || 1.6 }); }
  drawLabels(dt) { const c = this.ctx, PX = this.PX; c.textAlign = 'center';
    for (let i = this.labels.length - 1; i >= 0; i--) { const L = this.labels[i]; L.t += dt; if (L.t > L.dur) { this.labels.splice(i, 1); continue; }
      const p = this.proj(L.w[0], L.w[1], L.w[2], [0, 0, 0]); const a = clamp((L.dur - L.t) / 0.4, 0, 1);
      c.globalAlpha = a; c.font = '20px "Saira Stencil One", Impact, sans-serif'; c.lineWidth = 4; c.strokeStyle = 'rgba(0,0,0,.8)';
      const y = p[1] * PX - 20 - L.t * 26; c.strokeText(L.text, p[0] * PX, y); c.fillStyle = L.col; c.fillText(L.text, p[0] * PX, y); c.globalAlpha = 1; } }
}

// ================================================================ textura do chão
function buildGround(M) {
  const res = 3, w = M.size * res, h = w, x0 = -M.half, y0 = -M.half;
  const base = new Uint32Array(w * h), data = new Uint32Array(w * h), shade = new Uint8Array(w * h);
  const T = { res, w, h, x0, y0, base, data, shade, out: pack(34, 38, 30), M };
  const theme = MAPGEN.THEMES[M.theme];
  for (const f of M.fields) {
    const i0 = Math.max(0, Math.floor((f.x0 - x0) * res)), i1 = Math.min(w, Math.ceil((f.x1 - x0) * res)), j0 = Math.max(0, Math.floor((f.y0 - y0) * res)), j1 = Math.min(h, Math.ceil((f.y1 - y0) * res));
    const c = f.col, fs = f.s % 1000;
    for (let j = j0; j < j1; j++) { const wy = y0 + (j + .5) / res; for (let i = i0; i < i1; i++) { const wx = x0 + (i + .5) / res;
      const n = vnoise(wx / 7 + fs, wy / 7), n2 = hash(i, j), m = vnoise(wx / 1.7 + 30, wy / 1.7 + fs);
      let k = 0.86 + 0.22 * n + 0.06 * n2;
      const fur = ((f.dir ? wx : wy) * 1.5 + m * 0.6) % 1; if (fur < 0.42) k *= 0.92;
      const edge = Math.min(wx - f.x0, f.x1 - wx, wy - f.y0, f.y1 - wy); let r = c[0] * k, g = c[1] * k, b = c[2] * k;
      if (edge < 0.9) { const e = edge / 0.9; r = lerp(92, r, e); g = lerp(112, g, e); b = lerp(58, b, e); }
      if (n2 > 0.97) { r *= 0.82; g *= 0.86; b *= 0.8; }
      base[j * w + i] = pack(r, g, b); } } }
  // estradas de terra com sulcos
  for (const rd of M.roads) { const hw = rd.w / 2;
    for (let s = 1; s < rd.pts.length; s++) { const a = rd.pts[s - 1], b = rd.pts[s], ex = b[0] - a[0], ey = b[1] - a[1], L2 = ex * ex + ey * ey, L = Math.sqrt(L2);
      const bx0 = Math.min(a[0], b[0]) - hw - 1, bx1 = Math.max(a[0], b[0]) + hw + 1, by0 = Math.min(a[1], b[1]) - hw - 1, by1 = Math.max(a[1], b[1]) + hw + 1;
      for (let j = Math.max(0, Math.floor((by0 - y0) * res)); j < Math.min(h, Math.ceil((by1 - y0) * res)); j++) { const wy = y0 + (j + .5) / res;
        for (let i = Math.max(0, Math.floor((bx0 - x0) * res)); i < Math.min(w, Math.ceil((bx1 - x0) * res)); i++) { const wx = x0 + (i + .5) / res;
          const t = clamp(((wx - a[0]) * ex + (wy - a[1]) * ey) / L2, 0, 1), dx = wx - a[0] - ex * t, dy = wy - a[1] - ey * t, d = Math.hypot(dx, dy);
          const sideD = (dx * -ey + dy * ex) / L; const nn = vnoise(wx / 2.2, wy / 2.2) * 0.8;
          if (d > hw + nn) continue;
          const rc = theme.road; let k = 0.9 + 0.14 * vnoise(wx / 3 + 9, wy / 3) + 0.05 * hash(i, j);
          if (Math.abs(Math.abs(sideD) - 1.1) < 0.28) k *= 0.82;
          if (d > hw - 0.5 + nn) k *= 0.93;
          base[j * w + i] = pack(rc[0] * k, rc[1] * k, rc[2] * k); } } } }
  // borda do mapa escurecida
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const e = Math.min(i, j, w - 1 - i, h - 1 - j) / res; if (e > 8) continue; const c = base[j * w + i], k = 0.55 + 0.45 * e / 8;
    base[j * w + i] = pack((c & 255) * k, ((c >> 8) & 255) * k, ((c >> 16) & 255) * k); }
  for (const pr of M.props) { stampShadow(T, pr, 1); pr._sb = shadowBox(pr); }
  composite(T, 0, 0, w, h);
  return T;
}
function composite(T, i0, j0, i1, j1) { const { w, base, data, shade } = T; i0 = Math.max(0, i0); j0 = Math.max(0, j0); i1 = Math.min(T.w, i1); j1 = Math.min(T.h, j1);
  for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) { const p = j * w + i, c = base[p]; data[p] = shade[p] ? pack((c & 255) * 0.6, ((c >> 8) & 255) * 0.63, ((c >> 16) & 255) * 0.68) : c; } }
function stampShadow(T, pr, v) { if (pr.gone) return; const { res, w, h, x0, y0, shade } = T, mat = pr.mat, P = [0, 0, 0];
  for (const idx of pr.list) { if (!mat[idx] || (MAPGEN.SOFT[mat[idx]] && (idx & 1))) continue; MAPGEN.propCenter(pr, idx, P);
    const sx = P[0] + KX * P[2], sy = P[1] + KY * P[2], i = Math.floor((sx - x0) * res), j = Math.floor((sy - y0) * res);
    if (i < 0 || j < 0 || i >= w - 1 || j >= h - 1) continue; const p = j * w + i; shade[p] = v; shade[p + 1] = v; if (pr.kind !== 'tree') shade[p + w] = v; } }
function shadowBox(pr) { const b = pr.bb, z = b[4]; return [Math.min(b[0], b[0] + KX * z) - 1, Math.min(b[1], b[1] + KY * z) - 1, Math.max(b[2], b[2] + KX * z) + 1, Math.max(b[3], b[3] + KY * z) + 1]; }
// refaz as sombras numa região depois que um objeto mudou
function reshadow(T, pr) { const M = T.M, nb = shadowBox(pr), ob = pr._sb || nb, sb = [Math.min(nb[0], ob[0]), Math.min(nb[1], ob[1]), Math.max(nb[2], ob[2]), Math.max(nb[3], ob[3])], { res, w, x0, y0 } = T; pr._sb = nb;
  const i0 = Math.floor((sb[0] - x0) * res), i1 = Math.ceil((sb[2] - x0) * res), j0 = Math.floor((sb[1] - y0) * res), j1 = Math.ceil((sb[3] - y0) * res);
  for (let j = Math.max(0, j0); j < Math.min(T.h, j1); j++) T.shade.fill(0, j * w + Math.max(0, i0), j * w + Math.min(w, i1));
  for (const id of MAPGEN.propsAlong(M, sb[0] - 12, sb[1] - 12, sb[2] + 12, sb[3] + 12)) { const o = M.props[id]; const ob = shadowBox(o); if (ob[0] > sb[2] || ob[2] < sb[0] || ob[1] > sb[3] || ob[3] < sb[1]) continue; stampShadow(T, o, 1); }
  composite(T, i0, j0, i1, j1); }
function texIdx(T, x, y) { const i = Math.floor((x - T.x0) * T.res), j = Math.floor((y - T.y0) * T.res); if (i < 0 || j < 0 || i >= T.w || j >= T.h) return -1; return j * T.w + i; }
function darken(T, x, y, k, minK) { const p = texIdx(T, x, y); if (p < 0) return; const c = T.base[p]; const r = (c & 255) * k, g = ((c >> 8) & 255) * k, b = ((c >> 16) & 255) * k;
  if (r + g + b < (minK || 90)) return; T.base[p] = pack(r, g, b); const s = T.shade[p]; T.data[p] = s ? pack(r * 0.6, g * 0.63, b * 0.68) : T.base[p]; }
function paint(T, x, y, col, a) { const p = texIdx(T, x, y); if (p < 0) return; const c = T.base[p]; const r = lerp(c & 255, col[0], a), g = lerp((c >> 8) & 255, col[1], a), b = lerp((c >> 16) & 255, col[2], a);
  T.base[p] = pack(r, g, b); T.data[p] = T.shade[p] ? pack(r * 0.6, g * 0.63, b * 0.68) : T.base[p]; }
// marcas de esteira
function stampTracks(T, x, y, h, wid) { const c = Math.cos(h), s = Math.sin(h);
  for (const side of [1, -1]) { const off = side * (wid / 2 - 0.25); for (let u = -0.15; u <= 0.15; u += 0.3) for (let v = -0.18; v <= 0.18; v += 0.18) darken(T, x - s * (off + v) + c * u, y + c * (off + v) + s * u, 0.93, 120); } }
function stampCrater(T, x, y, r) { const step = 1 / T.res;
  for (let dy = -r * 1.4; dy <= r * 1.4; dy += step) for (let dx = -r * 1.4; dx <= r * 1.4; dx += step) { const d = Math.hypot(dx, dy) * (0.85 + 0.3 * hash(Math.round(dx * 9), Math.round(dy * 9)));
    if (d < r) paint(T, x + dx, y + dy, [44, 36, 28], 0.55 * (1 - d / r) + 0.25); else if (d < r * 1.35) paint(T, x + dx, y + dy, [126, 108, 82], 0.3); } }
function stampScorch(T, x, y, r) { const step = 1 / T.res; for (let dy = -r; dy <= r; dy += step) for (let dx = -r; dx <= r; dx += step) { const d = Math.hypot(dx, dy) / r * (0.7 + 0.5 * hash(Math.round(dx * 5), Math.round(dy * 5))); if (d < 1) paint(T, x + dx, y + dy, [26, 22, 20], 0.6 * (1 - d)); } }

// dados de desenho de cada objeto: posição local, sombreamento e lista de voxels que aparecem para a câmera.
// Árvores iguais dividem esses dados até alguém mexer nelas.
function prepProp(pr) { const t = pr.tpl;
  if (t && pr.shared && t.R && t.R.ver === pr.ver) { pr.R = t.R; return; }
  const n = pr.list.length, lx = new Float32Array(n), ly = new Float32Array(n), lz = new Float32Array(n), nx = pr.nx, ny = pr.ny;
  for (let a = 0; a < n; a++) { const idx = pr.list[a], i = idx % nx, q = (idx / nx) | 0, j = q % ny, k = (q / ny) | 0; lx[a] = (i + .5) * PVS; ly[a] = (j + .5) * PVS; lz[a] = (k + .5) * PVS; }
  pr.R = { lx, ly, lz, shd: new Uint8Array(n), vis: null, ver: pr.ver }; shadeProp(pr);
  if (t && pr.shared) t.R = pr.R; }
// depois de um furo: recalcula luz e o que ficou exposto (a grade é a mesma; se mudou de forma, monta tudo de novo)
function refreshProp(pr) { if (!pr.R || pr.R.ver !== pr.ver) { prepPropOwn(pr); return; }
  if (pr.tpl && pr.R === pr.tpl.R) pr.R = { lx: pr.R.lx, ly: pr.R.ly, lz: pr.R.lz, shd: new Uint8Array(pr.list.length), vis: null, ver: pr.ver };
  shadeProp(pr); }
function prepPropOwn(pr) { const tpl = pr.tpl; pr.tpl = null; prepProp(pr); pr.tpl = tpl; }
function shadeProp(pr) { const { nx, ny, nz, mat, list } = pr, nxy = nx * ny, shd = pr.R.shd, vis = [], lod = [], nx2 = (nx + 1) >> 1, ny2 = (ny + 1) >> 1, seen = new Uint8Array(nx2 * ny2 * ((nz + 1) >> 1));
  for (let a = 0; a < list.length; a++) { const idx = list[a]; if (!mat[idx]) continue; const i = idx % nx, t = (idx / nx) | 0, j = t % ny, k = (t / ny) | 0;
    const up = k + 1 >= nz || !mat[idx + nxy], south = j - 1 < 0 || !mat[idx - nx];
    let x = 0, y = 0, z = 0; if (i + 1 >= nx || !mat[idx + 1]) x++; if (i - 1 < 0 || !mat[idx - 1]) x--; if (j + 1 >= ny || !mat[idx + nx]) y++; if (south) y--; if (up) z++; if (k - 1 >= 0 && !mat[idx - nxy]) z--;
    if (up || south) { vis.push(a); const c = ((k >> 1) * ny2 + (j >> 1)) * nx2 + (i >> 1); if (!seen[c]) { seen[c] = 1; lod.push(a); } }
    if (!x && !y && !z) z = 1; const l = Math.hypot(x, y, z); x /= l; y /= l; z /= l;
    const sh = 0.5 + 0.62 * Math.max(0, x * LIGHT[0] + y * LIGHT[1] + z * LIGHT[2]) + 0.08 * z; shd[a] = Math.round(sh * 100); }
  pr.R.vis = Int32Array.from(vis); pr.R.lod = Int32Array.from(lod); }

return { View, buildGround, composite, reshadow, stampTracks, stampCrater, stampScorch, paint, prepProp, refreshProp, shadeProp, SA, CA, LIGHT, pack, fireCol };
})();
