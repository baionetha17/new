// Partida no navegador: recebe o estado do servidor, desenha, mostra o HUD e manda os comandos.
const GAME = (() => {
'use strict';
const { D2R, G, toW, gCenter, clamp, lerp, nrm } = SIM;
const $ = s => document.querySelector(s);
const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const lerpA = (a, b, t) => a + wrap(b - a) * t;
const TEAMCOL = ['#d6a440', '#6fa8dc'];
let st = null, net = null, onExit = null, raf = 0, inTimer = 0;

// ================================================================ início
function start(msg, send, exitFn) {
  net = send; onExit = exitFn;
  const M = MAPGEN.generate(msg.seed, msg.map);
  for (const pr of M.props) RENDER.prepProp(pr);
  const T = RENDER.buildGround(M);
  const cv = $('#gameCanvas');
  st = { msg, M, T, view: new RENDER.View(cv), tanks: new Map(), ciNext: 0, byCi: [], mySlot: msg.slot, team: msg.team, mode: msg.mode, names: msg.names || {},
    slots: Object.fromEntries(msg.tanks.map(t => [t.id, t])), me: null, myEnt: null, g: null, shells: new Map(), tracers: [], bullets: [], mgQ: [], soft: [], wheatFires: [], skulls: [], heat: new Set(),
    mouse: { x: 0, y: 0, in: false }, keys: {}, rmb: false, camOff: [0, 0], fireN: 0, repN: 0, smkN: 0, smokes: [], lobs: [], sel: 0, aim: [0, 0, 0], hover: null, hoverT: 0,
    offset: null, lastSnap: 0, feed: [], shake: 0, paused: false, spec: null, last: performance.now(), hudT: 0, mmT: 0, reloadLocal: 0, seenAt: new Map(), loadedPrev: null, dirty: [], falling: [], drops: [] };
  st.zoom = 64 / 6.6 * st.view.GBcss; st.view.cam.S = st.zoom / st.view.PX;   // zoom em pixels de tela por metro
  st.mm = buildMinimapBase(M, T); fogInit(); wiresInit(); HITCAM.init();
  $('#hudMode').textContent = msg.modeName + ' · ' + MAPGEN.THEMES[msg.map].short;
  $('#feed').innerHTML = ''; $('#centerMsg').hidden = true; $('#pause').hidden = true; $('#analysis').hidden = true;
  bindInput(cv);
  clearInterval(inTimer); inTimer = setInterval(sendInput, 33);
  cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
}
function stop() { clearInterval(inTimer); cancelAnimationFrame(raf); unbindInput(); AUDIO.engine(false, 0); HITCAM.hide(); st = null; }

// ================================================================ rede
function onSnap(m) {
  if (!st) return;
  const now = performance.now() / 1000;
  const off = m.T - now; st.offset = st.offset === null ? off : Math.max(off, st.offset + (off - st.offset) * 0.02);
  { const o = DIAG.cur(); o.snap++; o.late = Math.max(o.late, (st.offset - off) * 1000); for (const e of m.ev) if (e[0] === 'mg') o.rx++; }
  for (const e of m.ev) handleEv(e);
  const seen = new Set();
  for (const k of m.k) { const ct = st.tanks.get(k[0]); if (!ct) continue; seen.add(k[0]);
    ct.snaps.push({ t: m.T, x: k[1], y: k[2], h: k[3], ty: k[4], v: k[5] }); if (ct.snaps.length > 30) ct.snaps.shift();
    if (!ct.vis) { ct.snaps = [ct.snaps[ct.snaps.length - 1]]; ct.x = k[1]; ct.y = k[2]; }
    ct.vis = true; ct.v = k[5];
    if ((k[6] & 1) && !(ct.f & 1)) { ct.deadAt = now; RENDER.stampScorch(st.T, k[1], k[2], 3.2); }
    ct.f = k[6]; st.seenAt.set(ct.id, now); }
  for (const ct of st.tanks.values()) if (!seen.has(ct.id)) ct.vis = false;
  st.g = m.g; st.lastSnap = now;
  if (m.me) { const prev = st.me; st.me = m.me; st.myEnt = m.me.id; if (m.me.mg && m.me.mg[0]) DIAG.cur().belt = m.me.mg[0][0];
    if (prev && prev.loaded === null && m.me.loaded !== null) AUDIO.reload();
    st.reloadLocal = m.me.reload; if (prev && prev.id !== m.me.id) { st.camOff = [0, 0]; } }
}
function tankOf(id) { return st.tanks.get(id); }
function myTank() { return st.myEnt ? st.tanks.get(st.myEnt) : null; }
function distTo(p) { const c = st.view.cam; return Math.hypot(p[0] - c.x, p[1] - c.y); }
// pedaços que voam quando um objeto perde voxels (frac: parte dos voxels que vira pedaço; keep: ficam no chão)
function propBits(pr, rem, sp, frac, keep) { if (!rem.length) return; const V = st.view, P = [0, 0, 0], n = Math.min(90, Math.ceil(rem.length * frac) + 6);
  for (let q = 0; q < n; q++) { const idx = rem[(Math.random() * rem.length) | 0]; MAPGEN.propCenter(pr, idx, P); const k = 0.72 + Math.random() * 0.2;
    V.chunk(P.slice(), [pr.cr[idx] * k, pr.cg[idx] * k, pr.cb[idx] * k], sp * (0.4 + Math.random() * 0.6), 1 + Math.random() * 1.5, keep || Math.random() < 0.5); } }
// pedaços soltos de uma casa (bits = [x,y,z,r,g,b,...]): parte voa, parte fica no chão
function spawnBits(bits, frac, cap) { const V = st.view, n = bits.length / 6; if (!n) return; const m = Math.min(cap || 140, Math.ceil(n * frac));
  for (let c = 0; c < m; c++) { const o = ((Math.random() * n) | 0) * 6, k = 0.62 + Math.random() * 0.15; V.chunk([bits[o], bits[o + 1], bits[o + 2]], [bits[o + 3] * k, bits[o + 4] * k, bits[o + 5] * k], 0.8, 1 + Math.random(), Math.random() < 0.5); }
  for (let q = 0; q < n; q += Math.max(1, (n / 6) | 0)) { const o = q * 6; V.dust([bits[o], bits[o + 1], bits[o + 2]], 6, [150, 140, 120]); } }
// HE deixa o aço chamuscado em volta de onde explodiu (só desenho: a mancha é irregular e escurece mais no centro)
function scorchTanks(p, s) { const R = 0.45 + s * 0.9, P = [0, 0, 0];
  for (const ct of st.tanks.values()) { const tk = ct.tk; if (Math.hypot(tk.x - p[0], tk.y - p[1]) > R + 4) continue;
    for (const g of [tk.GH, tk.GT]) { SIM.toL(tk.tf(g), p, P); for (let a = 0; a < g.list.length; a++) { const idx = g.list[a]; if (!g.mat[idx]) continue;
      const d = Math.hypot(g.cx[a] - P[0], g.cy[a] - P[1], g.cz[a] - P[2]) / (R * (0.7 + 0.6 * MAPGEN.h3(idx >> 2, g.id, 7, 3))); if (d >= 1) continue; g.burn[idx] = Math.max(g.burn[idx], Math.min(0.92, (1 - d) * 1.3)); } } } }
// folhas e palha voando quando o tanque passa ou a bala acerta a copa / sebe / feno. rem pode vir em trincas [idx,..] (crushBox) ou simples
function leafFx(pr, rem, stride, frac) { if (!pr.cr || !rem.length) return; const P = [0, 0, 0]; let n = 0;
  for (let q = 0; q < rem.length && n < 40; q += stride) { if (Math.random() > frac) continue; const idx = rem[q]; MAPGEN.propCenter(pr, idx, P); const c = [pr.cr[idx], pr.cg[idx], pr.cb[idx]];
    if (!(c[1] > c[0] * 1.15 || (c[0] > 150 && c[1] > 120 && c[2] < 110))) continue; st.view.leaves(P, 2, c); n++; } }
function markDirty(pr) { if (!pr.dirty) { pr.dirty = true; st.dirty.push(pr); } }
// lasca de bala: casa grande leva alguns ms para redesenhar, então junta as lascas e redesenha no máximo 4 vezes por segundo
function softDirty(pr) { if (!pr.soft) { pr.soft = true; st.soft.push(pr); } }
// árvore caindo: guarda os voxels de pé para animar a queda
function startFall(pr, dir) { if (!pr.R) RENDER.prepProp(pr); const ux = [1, 0, -1, 0][dir], uy = [0, 1, 0, -1][dir], R = pr.R, vis = R.vis, sa = [], ta = [], z = [], col = [], tr = pr.trunkR || 0.15;
  for (let q = 0; q < vis.length; q++) { const a = vis[q], idx = pr.list[a]; if (!pr.mat[idx]) continue; const x = pr.x0 + R.lx[a] - pr.cx, y = pr.y0 + R.ly[a] - pr.cy;
    if (R.lz[a] < 0.4 && Math.hypot(x, y) < tr + 0.08) continue;
    sa.push(x * ux + y * uy); ta.push(-x * uy + y * ux); z.push(R.lz[a]); const sh = R.shd[a] / 100; col.push(RENDER.pack(Math.min(255, pr.cr[idx] * sh), Math.min(255, pr.cg[idx] * sh), Math.min(255, pr.cb[idx] * sh))); }
  pr.falling = true; st.falling.push({ pr, ux, uy, cx: pr.cx, cy: pr.cy, sa: Float32Array.from(sa), ta: Float32Array.from(ta), z: Float32Array.from(z), col: Uint32Array.from(col), n: sa.length, t: 0, dur: 1.1 + Math.min(1, pr.bb[4] / 10) }); }
// fogo: pontos inflamáveis perto da frente de chamas, de onde saem chamas e fumaça
function firePoints(pr) { const f = pr.fire; if (!f) return; const P = [0, 0, 0], pts = [], R = pr.R, r2 = (f.r + 0.6) * (f.r + 0.6), r1 = Math.max(0, f.r - 1.2) ** 2;
  if (!R) return; for (let q = 0; q < R.vis.length && pts.length < 600; q++) { const a = R.vis[q], idx = pr.list[a], m = pr.mat[idx]; if (!m || !MAPGEN.BURN[m]) continue;
    const dx = pr.x0 + R.lx[a] - f.x, dy = pr.y0 + R.ly[a] - f.y, dz = R.lz[a] - f.z, d2 = dx * dx + dy * dy + dz * dz; if (d2 > r2 || d2 < r1) continue; pts.push(pr.x0 + R.lx[a], pr.y0 + R.ly[a], R.lz[a]); }
  f.pts = pts; }
// escurece o que o fogo lambeu
function char(pr, x, y, z, r) { MAPGEN.ownColors(pr); const P = [0, 0, 0], r2 = r * r;
  for (const idx of pr.list) { if (!pr.mat[idx]) continue; MAPGEN.propCenter(pr, idx, P); const dx = P[0] - x, dy = P[1] - y, dz = P[2] - z; if (dx * dx + dy * dy + dz * dz > r2) continue;
    const k = MAPGEN.BURN[pr.mat[idx]] ? 0.95 : 0.975; pr.cr[idx] = Math.max(26, pr.cr[idx] * k); pr.cg[idx] = Math.max(22, pr.cg[idx] * (k - 0.005)); pr.cb[idx] = Math.max(20, pr.cb[idx] * (k - 0.005)); } }
function handleEv(e) {
  const V = st.view, T = st.T, M = st.M;
  switch (e[0]) {
    case 'spawn': { const [, id, type, team, x, y, h, slot] = e; const tk = new SIM.Tank(type, id); tk.x = x; tk.y = y; tk.h = h; tk.update();
      const ct = { id, type, team, slot, tk, ci: st.ciNext++ % 64, snaps: [{ t: 0, x, y, h, ty: 0, v: 0 }], vis: true, x, y, h, ty: 0, v: 0, f: 0, trail: [x, y], smoke: 0 };
      st.byCi[ct.ci] = ct; st.tanks.set(id, ct); break; }
    case 'sp': V.sparks([e[1], e[2], e[3]], [e[4], e[5], e[6]], e[7], e[8]); break;
    case 'db': { const ct = tankOf(e[7]); if (!ct) break; const g = ct.tk.grid(e[8]), i = e[9]; V.debris([e[1], e[2], e[3]], [e[4], e[5], e[6]], [g.cr[i], g.cg[i], g.cb[i]], e[10]); break; }
    case 'du': V.dust([e[1], e[2], e[3]], e[4]); break;
    case 'fb': { const p = [e[1], e[2], e[3]], fl = V.flash || 0; V.fireball(p, e[4], e[5]); if (distTo(p) > 45) V.flash = fl; scorchTanks(p, e[4]); AUDIO.boom(distTo(p), e[4] > 0.5); if (distTo(p) < 25) st.shake = Math.max(st.shake, 0.5); break; }
    case 'lb': V.label([e[1], e[2], e[3]], e[4], e[5], e[6]); break;
    case 'rm': { const ct = tankOf(e[1]); if (!ct) break; const g = ct.tk.grid(e[2]), i = e[3];
      if (e[4] && g.mat[i]) { const w = toW(ct.tk.tf(g), gCenter(g, i, [0, 0, 0]), [0, 0, 0]); V.chunk(w, [g.cr[i], g.cg[i], g.cb[i]], e[4]); }
      ct.tk.removeVox(g, i); break; }
    case 'vb': { const ct = tankOf(e[1]); if (!ct) break; const g = ct.tk.grid(e[2]), i = e[3]; g.thick[i] = e[4]; g.burn[i] = e[5]; if (e[6] > 0) { g.heat[i] = Math.max(g.heat[i], e[6]); st.heat.add([ct.id, e[2], i].join(',')); } break; }
    case 'ho': { const ct = tankOf(e[1]); if (!ct) break; const g = ct.tk.grid(e[2]); ct.tk.holes.push({ g: e[2], idx: e[3], c: gCenter(g, e[3], [0, 0, 0]) }); break; }
    case 'tr': { const pts = []; for (let i = 0; i < e[1].length; i += 3) pts.push([e[1][i], e[1][i + 1], e[1][i + 2]]); st.tracers.push({ pts, t: 0.7 }); AUDIO.ric(distTo(pts[0])); break; }
    case 'boom': { const ct = tankOf(e[1]); if (!ct) break; const tk = ct.tk, c = [e[2], e[3], e[4]];
      tk.charAll(); tk.turretFly = { vel: [e[5], e[6], e[7]], w: [e[8], e[9], e[10]], rest: false }; tk.turretOff = true;
      const p = [0, 0, 0]; for (const v of tk.GT.list) { if (!tk.GT.mat[v]) continue; gCenter(tk.GT, v, p); if (p[2] < tk.TK.ringZ) tk.removeVox(tk.GT, v); }
      V.fireball(c, 2.6, true); st.shake = Math.max(st.shake, distTo(c) < 60 ? 1.2 : 0.3);
      for (let i = 0; i < 260; i++) { const a = Math.random() * Math.PI * 2, u = Math.random(); V.particles.push({ k: 3, x: c[0], y: c[1], z: c[2] + 0.4, vx: Math.cos(a) * u * 7, vy: Math.sin(a) * u * 7, vz: 4 + Math.random() * 12, life: 5 + Math.random() * 8, col: Math.random() < 0.5 ? [60, 62, 64] : [40, 36, 32], sz: 1, keep: Math.random() < 0.35 }); }
      AUDIO.boom(distTo(c), true); RENDER.stampScorch(T, ct.x, ct.y, 5); break; }
    case 'rs': { const ct = tankOf(e[1]); if (ct) ct.tk.restoreTrack(e[2]); break; }
    case 'md': { const ct = tankOf(e[1]); if (!ct) break; const was = new Set(ct.tk.MOD.filter(o => o && o.kind === 'crew' && o.dead).map(o => o.id)); ct.tk.setDead(e[2]);
      // caveirinha subindo de onde estava cada tripulante que acabou de morrer (só de tanque que a gente vê ou é do time)
      if (ct.vis || ct.team === st.team || ct.id === st.myEnt) for (const o of ct.tk.MOD) if (o && o.kind === 'crew' && o.dead && !was.has(o.id)) st.skulls.push({ ct, o, t: 0, dl: st.skulls.length % 3 * 0.15 });
      break; }
    case 'shot': { const [, sid, eid, x, y, z, vx, vy, vz, kind] = e; const sp = Math.hypot(vx, vy, vz);
      st.shells.set(sid, { pos: [x, y, z], prev: [x, y, z], vel: [vx, vy, vz], t: 0, kind, from: eid });
      V.muzzle([x, y, z], [vx / sp, vy / sp, vz / sp]); AUDIO.cannon(distTo([x, y])); if (eid === st.myEnt) st.shake = Math.max(st.shake, 0.35); break; }
    case 'sh': { const s = st.shells.get(e[1]); if (s) { s.end = [e[2], e[3], e[4]]; s.endT = 0.06; } break; }
    case 'cr': { RENDER.stampCrater(T, e[1], e[2], e[3]); RENDER.flattenDisc(T, e[1], e[2], e[3] * 1.6); AUDIO.thud(distTo([e[1], e[2]]));
      // cratera de explosão: terra revirada em volta, em voxels
      if (e[4]) { const pr = MAPGEN.addVisual(M, MAPGEN.craterRim(e[1], e[2], e[3], (e[1] * 97 + e[2] * 31) | 0)); RENDER.prepProp(pr);
        for (let i = 0; i < 24; i++) { const a = Math.random() * Math.PI * 2, d = e[3] * (0.6 + Math.random() * 0.8); V.chunk([e[1] + Math.cos(a) * 0.3, e[2] + Math.sin(a) * 0.3, 0.3], [96 + Math.random() * 30, 80 + Math.random() * 20, 58], 1.6, 1.5, true); } }
      break; }
    case 'pt': { const pr = M.props[e[1]]; if (!pr) break; const rem = MAPGEN.tunnel(pr, e[2], e[3]); if (e[4]) mgChips(pr, rem); else propBits(pr, rem, 1.1, 0.06); leafFx(pr, rem, 1, 0.15); if (e[4]) softDirty(pr); else markDirty(pr); break; }
    case 'smf': { st.lobs.push({ a: [e[2], e[3], e[4]], b: [e[5], e[6], 0], t: 0, T: e[7] }); AUDIO.thud(distTo([e[2], e[3]])); st.view.particles.push({ k: 2, x: e[2], y: e[3], z: e[4], vx: 0, vy: 0, vz: 0.5, life: 1.5, max: 1.5, r0: 0.1, r1: 0.6, col: [180, 178, 170] }); break; }
    case 'sm': st.smokes.push({ x: e[2], y: e[3], R: e[4], life: e[5], grow: e[6], t: 0, s: e[1] }); break;
    // tiro de metralhadora: entra numa fila e sai na hora certa (o servidor manda a hora de cada bala), para rajada não chegar embolada
    case 'mg': if (e[10] !== undefined && st.offset !== null) st.mgQ.push(e); else mgShot(e); break;
    case 'wf': wheatFireStart(e[1], e[2], e[3], e[4]); break;
    // câmera de acerto: tiro nosso que acertou alguém, ou tiro que acertou a gente
    case 'hc': { const d = HITCAM.unpack(e), ct = tankOf(d.to); if (!ct) break;
      if (d.from === st.myEnt && d.to !== st.myEnt) HITCAM.show('out', d, ct.tk); else if (d.to === st.myEnt) HITCAM.show('in', d, ct.tk); break; }
    case 'pq': { const pr = M.props[e[1]]; if (!pr) break; const rem = MAPGEN.crushBox(pr, e[2], e[3], e[4], e[5], e[6], e[7], 2.6); const P = [0, 0, 0];
      for (let i = 0; i < rem.length; i += 3) { const idx = rem[i]; MAPGEN.propCenter(pr, idx, P); RENDER.paint(T, P[0] + (Math.random() - .5) * 0.4, P[1] + (Math.random() - .5) * 0.4, [pr.cr[idx] * 0.8, pr.cg[idx] * 0.8, pr.cb[idx] * 0.8], 0.5); }
      propBits(pr, rem, 0.5, 0.04); leafFx(pr, rem, 3, 0.05);
      if (rem.length) { const leafy = pr.kind === 'bush' || pr.kind === 'hedge' || pr.kind === 'tree', now = performance.now(); if (now - (st.brushT || 0) > 140) { st.brushT = now; if (leafy) AUDIO.brush(distTo([e[2], e[3]]), false); else if (Math.random() < 0.35) AUDIO.crunch(distTo([e[2], e[3]])); } } markDirty(pr); break; }
    case 'pd': { const pr = M.props[e[1]]; if (!pr || pr.fallen) break; startFall(pr, e[2]); MAPGEN.fell(M, pr, e[2]); RENDER.prepProp(pr); pr.dirty = false; RENDER.reshadow(T, pr);
      if (pr.kind === 'tree') { AUDIO.brush(distTo([pr.cx, pr.cy]), pr.tree !== 'sapling'); leafFx(pr, pr.list, 40, 0.5); } else AUDIO.crunch(distTo([pr.cx, pr.cy])); break; }
    // tanque atravessando a casa
    case 'pp': { const pr = M.props[e[1]]; if (!pr) break; const rem = MAPGEN.push(pr, e[2], e[3], e[4], e[5], e[6]); if (!rem.length) break; const P = [0, 0, 0];
      for (let i = 0; i < rem.length; i += 4) { const idx = rem[i]; MAPGEN.propCenter(pr, idx, P); RENDER.paint(T, P[0] + (Math.random() - .5) * 0.6, P[1] + (Math.random() - .5) * 0.6, [pr.cr[idx] * 0.8, pr.cg[idx] * 0.8, pr.cb[idx] * 0.8], 0.5); }
      propBits(pr, rem, 0.7, 0.08, true); if (Math.random() < 0.3) { AUDIO.crunch(distTo([e[2], e[3]])); MAPGEN.propCenter(pr, rem[0], P); V.dust(P, 4, [150, 140, 120]); } markDirty(pr); break; }
    // janela estilhaçada
    case 'pg': { const pr = M.props[e[1]]; if (!pr) break; const rem = MAPGEN.shatter(pr, e[2]); const P = [0, 0, 0];
      for (const idx of rem) { if (Math.random() < 0.45) continue; MAPGEN.propCenter(pr, idx, P); const c = Math.random() < 0.3 ? [228, 236, 240] : [150, 176, 190]; V.chunk(P.slice(), c, 1.2, 0.45, Math.random() < 0.5); }
      if (rem.length) { MAPGEN.propCenter(pr, rem[0], P); AUDIO.glass(distTo(P)); } markDirty(pr); break; }
    // casa assentando: o que perdeu apoio cai
    case 'ps': { const pr = M.props[e[1]]; if (!pr) break; const out = { bits: [], falls: [] }; if (!MAPGEN.settle(pr, out)) break;
      spawnBits(out.bits, pr.fire ? 0.08 : 0.6, pr.fire ? 24 : 140); if (!pr.hide) pr.hide = new Uint8Array(pr.n);
      for (const f of out.falls) { const n = f.idx.length, xs = new Float32Array(n), ys = new Float32Array(n), zs = new Float32Array(n), cols = new Uint32Array(n), P = [0, 0, 0];
        for (let q = 0; q < n; q++) { const idx = f.idx[q]; pr.hide[idx] = 1; MAPGEN.propCenter(pr, idx, P); xs[q] = P[0]; ys[q] = P[1]; zs[q] = P[2]; const k = 0.8 + 0.2 * MAPGEN.h3(idx, 0, 0, 5);
          cols[q] = RENDER.pack(pr.cr[idx] * k, pr.cg[idx] * k, pr.cb[idx] * k); }
        st.drops.push({ pr, idx: f.idx, xs, ys, zs, cols, n, drop: f.drop, bits: f.bits, t: 0, dur: Math.sqrt(2 * f.drop / G) + 0.04 }); }
      if (pr.fire) firePoints(pr); markDirty(pr); break; }
    case 'pi': { const pr = M.props[e[1]]; if (!pr) break; pr.fire = { x: e[2], y: e[3], z: e[4], r: 0.5, pts: [] }; V.fireball([e[2], e[3], e[4]], 0.3, false); firePoints(pr); break; }
    case 'pb': { const pr = M.props[e[1]]; if (!pr) break; const rem = MAPGEN.burn(pr, e[2], e[3], e[4], e[5], e[6], e[7], e[8]);
      if (!pr.fire) pr.fire = { x: e[2], y: e[3], z: e[4], r: e[5], pts: [] }; pr.fire.r = e[5]; char(pr, e[2], e[3], e[4], e[5] + 0.4);
      markDirty(pr); firePoints(pr); break; }
    case 'pf': { const pr = M.props[e[1]]; if (pr) pr.fire = null; break; }
    case 'hi': { const [, sh, tg, res, plate, eff, pen, crew, mods, aname] = e;
      const p = tankOf(tg); if (p) AUDIO.hit(distTo([p.x, p.y]), res === 'pen');
      const RES = { pen: 'PENETROU', non: 'NÃO PENETROU', ric: 'RICOCHETE' };
      if (sh === st.myEnt && tg !== st.myEnt) { const extra = crew.length ? ' · ' + crew.length + (crew.length > 1 ? ' tripulantes' : ' tripulante') : mods.length ? ' · ' + mods.slice(0, 2).join(', ') : '';
        feed((RES[res] || res) + (plate ? ' · ' + plate : '') + (eff ? ' · ' + eff + ' mm ef.' : '') + extra, res === 'pen' ? 'pen' : res === 'ric' ? 'ric' : 'non'); }
      if (tg === st.myEnt) feed('Fomos atingidos: ' + (RES[res] || res).toLowerCase() + (plate ? ' (' + plate.toLowerCase() + ')' : '') + (crew.length ? ' · perdemos ' + crew.join(', ') : ''), res === 'pen' ? 'bad' : 'non');
      break; }
    case 'kill': { const [, kEnt, vEnt, cause, kSlot, vSlot] = e; const vn = slotName(vSlot), kn = kSlot ? slotName(kSlot) : null;
      feed((kn ? kn + ' destruiu ' + vn : vn + ' foi destruído') + (cause === 'ammo' ? ' (munição detonou)' : ''), 'kill');
      if (vEnt === st.myEnt) showCenter(cause === 'ammo' ? 'A munição detonou' : 'Tanque destruído', 3); break; }
  }
}
function mgShot(e) { const a = [e[3], e[4], e[5]], b = [e[6], e[7], e[8]], L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 0.1, ct = st.tanks.get(e[1]), M2 = ct && ct.tk.game.mg;
  DIAG.cur().play++;
  st.bullets.push({ a, b, L, t: 0, T: Math.max(0.07, L / (M2 ? M2.v : 800)), hit: e[9], tr: (st.mgN = (st.mgN || 0) + 1) % 3 === 0, de: ct && ct.tk.game.flag === 'de' });
  if (Math.random() < 0.5) st.view.particles.push({ k: 4, x: a[0], y: a[1], z: a[2], life: 0.05, max: 0.05, r: 0.35 });
  if (Math.random() < 0.6) st.view.chunk([a[0] - (b[0] - a[0]) / L * 0.6, a[1] - (b[1] - a[1]) / L * 0.6, a[2] - 0.1], [206, 164, 72], 0.5, 0.35, Math.random() < 0.2);   // cartucho
  AUDIO.mg(distTo(a), M2 && M2.rate > 10); }
function slotName(id) { const s = st.slots[id]; if (!s) return '?'; if (s.bot) return 'IA (' + SIM.TANKS[s.type].short + ')';
  const n = [s.driver, s.gunner].filter((v, i, a) => v && a.indexOf(v) === i).map(p => st.names[p] || '?'); return n.join(' + ') || SIM.TANKS[s.type].short; }
function feed(text, cls) { const el = document.createElement('div'); el.className = 'f ' + (cls || ''); el.textContent = text; const box = $('#feed'); box.prepend(el); while (box.children.length > 6) box.lastChild.remove(); setTimeout(() => el.classList.add('old'), 6000); setTimeout(() => el.remove(), 9000); }
let centerT = 0;
function showCenter(text, dur) { const el = $('#centerMsg'); el.textContent = text; el.hidden = false; centerT = dur || 2.5; }

// ================================================================ diagnóstico (F8 mostra, F9 copia)
// grava 15 s em fatias de 100 ms: Espaço, input enviado, pacotes, tiros recebidos/tocados, atraso e travadas do quadro
const DIAG = { on: false, b: new Map(), el: null,
  cur() { const k = Math.floor(performance.now() / 100); let o = this.b.get(k);
    if (!o) { o = { sp: 0, mg: 0, snap: 0, rx: 0, play: 0, late: 0, fr: 0, frMax: 0, q: 0, belt: -1 }; this.b.set(k, o); for (const kk of this.b.keys()) { if (kk < k - 150) this.b.delete(kk); else break; } }
    return o; },
  text() { const ks = [...this.b.keys()], k0 = ks[0] || 0;
    let t = 'diag metralhadora (100 ms por linha) ' + navigator.userAgent + '\nt(s)  esp env pac rx toc fila atraso(ms) quadroMax(ms) fita pulos\n';
    for (const k of ks) { const o = this.b.get(k); t += ((k - k0) / 10).toFixed(1).padStart(5) + '   ' + o.sp + '   ' + o.mg + '  ' + String(o.snap).padStart(2) + ' ' + String(o.rx).padStart(2) + ' ' + String(o.play).padStart(2) + ' ' + String(o.q).padStart(4) + ' ' + String(Math.round(o.late)).padStart(6) + ' ' + String(Math.round(o.frMax)).padStart(8) + '   ' + o.belt + '  ' + (o.skip || 0) + '\n'; }
    return t; },
  draw() { if (!this.on) { if (this.el) this.el.hidden = true; return; }
    if (!this.el) { this.el = document.createElement('pre'); this.el.className = 'diag'; document.body.appendChild(this.el); }
    this.el.hidden = false; const k = Math.floor(performance.now() / 100), sum = { sp: 0, mg: 0, snap: 0, rx: 0, play: 0, late: 0, frMax: 0, q: 0 };
    for (let i = k - 10; i < k; i++) { const o = this.b.get(i); if (!o) continue; for (const f of ['sp', 'mg', 'snap', 'rx', 'play']) sum[f] += o[f]; sum.late = Math.max(sum.late, o.late); sum.frMax = Math.max(sum.frMax, o.frMax); sum.q = Math.max(sum.q, o.q); }
    this.el.textContent = 'DIAGNÓSTICO (último 1 s)  F9 copia os últimos 15 s\nEspaço segurado: ' + (st && st.keys[' '] ? 'SIM' : 'não') + '\ninputs com tiro: ' + sum.mg + '/' + sum.sp + '\npacotes: ' + sum.snap + '\ntiros recebidos: ' + sum.rx + '  tocados: ' + sum.play + '  fila: ' + sum.q + '\natraso máx: ' + Math.round(sum.late) + ' ms  quadro mais lento: ' + Math.round(sum.frMax) + ' ms'; },
  copy() { const t = this.text(); try { navigator.clipboard.writeText(t).then(() => toastDiag('Diagnóstico copiado. Cole na conversa.'), () => toastDiag('Não deu para copiar.')); } catch (e) { toastDiag('Não deu para copiar.'); } } };
function toastDiag(m) { const f = $('#feed'); if (!f) return; const d = document.createElement('div'); d.textContent = m; f.prepend(d); setTimeout(() => d.remove(), 5000); }

// ================================================================ entrada
const handlers = {};
function bindInput(cv) {
  handlers.kd = e => { if (!st) return; if (e.target.tagName === 'INPUT') return; const k = e.key.toLowerCase(); AUDIO.init();
    if (k === 'escape') { togglePause(); e.preventDefault(); return; }
    if (k === 'f8') { DIAG.on = !DIAG.on; e.preventDefault(); return; }
    if (k === 'f9') { DIAG.copy(); e.preventDefault(); return; }
    if (st.paused) return;
    st.keys[k] = true;
    if (e.repeat) { if (k === ' ' || k === 'g' || k === 'r' || k.startsWith('arrow')) e.preventDefault(); return; }
    if (k >= '1' && k <= '5') { const i = +k - 1; const tk = myTank(); if (tk && i < tk.tk.game.ammo.length) st.sel = i; }
    if (k === 'r') st.repN++;
    if (k === 'g') st.smkN++;
    if (k === 'h') HITCAM.replay();
    if (k === ' ') { cycleSpec(); e.preventDefault(); }
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault(); };
  handlers.ku = e => { if (st) st.keys[e.key.toLowerCase()] = false; };
  handlers.md = e => { if (!st || st.paused) return; AUDIO.init(); if (e.button === 0) st.fireN++; if (e.button === 2) st.rmb = true; };
  handlers.mu = e => { if (st && e.button === 2) st.rmb = false; };
  handlers.mm = e => { if (!st) return; const r = cv.getBoundingClientRect(); st.mouse.x = e.clientX - r.left; st.mouse.y = e.clientY - r.top; st.mouse.in = true; };
  handlers.ml = () => { if (st) st.mouse.in = false; };
  handlers.wh = e => { if (!st) return; e.preventDefault(); zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15); };
  handlers.cm = e => e.preventDefault();
  handlers.bl = () => { if (st) { st.keys = {}; st.rmb = false; } };
  window.addEventListener('keydown', handlers.kd); window.addEventListener('keyup', handlers.ku); window.addEventListener('blur', handlers.bl);
  cv.addEventListener('mousedown', handlers.md); window.addEventListener('mouseup', handlers.mu); cv.addEventListener('mousemove', handlers.mm); cv.addEventListener('mouseleave', handlers.ml);
  cv.addEventListener('wheel', handlers.wh, { passive: false }); cv.addEventListener('contextmenu', handlers.cm);
  handlers.cv = cv;
}
function unbindInput() { const cv = handlers.cv; if (!cv) return;
  window.removeEventListener('keydown', handlers.kd); window.removeEventListener('keyup', handlers.ku); window.removeEventListener('blur', handlers.bl);
  cv.removeEventListener('mousedown', handlers.md); window.removeEventListener('mouseup', handlers.mu); cv.removeEventListener('mousemove', handlers.mm); cv.removeEventListener('mouseleave', handlers.ml);
  cv.removeEventListener('wheel', handlers.wh); cv.removeEventListener('contextmenu', handlers.cm); handlers.cv = null; }
// afastado ao máximo, do centro até a borda da tela cabem no máximo 150 m
const ZOOM_MAX_M = 150;
function zoomLimits() { const V = st.view; return [Math.max(0.7 * V.GBcss, Math.max(V.cw, V.ch / RENDER.SA) / (2 * ZOOM_MAX_M)), 42 * V.GBcss]; }
function zoom(f) { const [a, b] = zoomLimits(); st.zoom = clamp(st.zoom * f, a, b); }
function sendInput() { if (!st || !net) return; const k = st.keys, p = st.paused; st.lastTick = performance.now();
  const thr = p ? 0 : (k.w || k.arrowup ? 1 : 0) - (k.s || k.arrowdown ? 1 : 0), steer = p ? 0 : (k.a || k.arrowleft ? 1 : 0) - (k.d || k.arrowright ? 1 : 0);
  { const o = DIAG.cur(); if (k[' ']) o.sp++; if (!p && k[' ']) o.mg++; }
  net({ t: 'input', thr, steer, aim: st.aim.map(v => Math.round(v * 100) / 100), fire: st.fireN, sel: st.sel, rep: st.repN, smk: st.smkN, mg: !p && k[' '] ? 1 : 0 }); }
function togglePause(force) { st.paused = force !== undefined ? force : !st.paused; $('#pause').hidden = !st.paused; }
function cycleSpec() { const me = myTank(); if (me && !(me.f & 1)) { st.spec = null; return; }
  const list = [...st.tanks.values()].filter(c => c.team === st.team && !(c.f & 1) && c.vis); if (!list.length) { st.spec = null; return; }
  const i = list.findIndex(c => c.id === st.spec); st.spec = list[(i + 1) % list.length].id; }
function quit() { net({ t: 'quit' }); const fn = onExit; stop(); if (fn) fn(); }

// ================================================================ quadro
function frame(nowMs) {
  if (!st) return; raf = requestAnimationFrame(frame);
  // Com tecla segurada (repetição do teclado) e quadro pesado, o Chrome/Edge dá prioridade total a entrada e desenho e
  // deixa de rodar timers e mensagens do servidor até soltar a tecla. Se o envio de input atrasou, pula este quadro
  // para abrir uma brecha (nunca dois seguidos).
  if (!st.skipped && st.lastTick && performance.now() - st.lastTick > 60) { st.skipped = true; DIAG.cur().skip = (DIAG.cur().skip || 0) + 1; return; }
  st.skipped = false;
  const rdt = Math.min(0.5, Math.max(0, (nowMs - st.last) / 1000)), dt = Math.min(0.05, rdt); st.last = nowMs;
  { const o = DIAG.cur(); o.frMax = Math.max(o.frMax, rdt * 1000); o.q = Math.max(o.q, st.mgQ.length); DIAG.draw(); }
  const V = st.view; V.resize();
  { const [zmin, zmax] = zoomLimits(); st.zoom = clamp(st.zoom, zmin, zmax);
    // voxel com menos de ~4 pixels na tela: desenha em 1x1 para não borrar; maior que isso, volta ao pixel do chão
    const vpx = SIM.VS * st.zoom; V.setPX(V.PX === 1 ? (vpx > 4.4 ? V.GBcss : 1) : (vpx < 3.6 ? 1 : V.GBcss)); V.cam.S = st.zoom / V.PX; }
  const now = nowMs / 1000, rt = st.offset === null ? 0 : now + st.offset - 0.1;
  if (st.mgQ.length) { let n = 0; for (const e of st.mgQ) { if (e[10] > rt) break; if (e[10] > rt - 1) mgShot(e); n++; } if (n) st.mgQ.splice(0, n); }
  // poses interpoladas
  for (const ct of st.tanks.values()) {
    const S = ct.snaps; let a = S[0], b = S[S.length - 1];
    if (S.length > 1) { for (let i = S.length - 1; i > 0; i--) if (S[i - 1].t <= rt) { a = S[i - 1]; b = S[i]; break; } }
    const u = b.t > a.t ? clamp((rt - a.t) / (b.t - a.t), 0, 1) : 1;
    const x = lerp(a.x, b.x, u), y = lerp(a.y, b.y, u), h = lerpA(a.h, b.h, u), ty = lerpA(a.ty, b.ty, u);
    const tk = ct.tk;
    // esteiras: cada lado anda o avanço do casco mais (ou menos) o giro vezes meia bitola
    if (!(ct.f & 1) && ct.x !== undefined) { const fw = (x - ct.x) * Math.cos(h) + (y - ct.y) * Math.sin(h), dh = lerpA(0, h - ct.h, 1), hw = tk.game.wid / 2 - 0.25, ds = ct.f & 64 ? 0.5 : 1;
      if (Math.abs(fw) < 3) tk.animTracks((fw - dh * hw) * ds, (fw + dh * hw) * ds); }
    tk.x = x; tk.y = y; tk.h = h; if (!tk.turretFly) tk.ty = ty; tk.update(); ct.x = x; ct.y = y; ct.h = h;
    if (Math.hypot(x - ct.trail[0], y - ct.trail[1]) > 0.3) { if (Math.hypot(x - ct.trail[0], y - ct.trail[1]) < 4) { RENDER.stampTracks(st.T, x, y, h, tk.game.wid); RENDER.flatten(st.T, x, y, h, tk.game.len, tk.game.wid); } ct.trail = [x, y]; }
    if (tk.turretFly && !tk.turretFly.rest) turretFly(tk, dt);
    fireFx(ct, dt);
  }
  // câmera
  const me = myTank(); let focus = me;
  if (me && (me.f & 1) && st.spec) focus = st.tanks.get(st.spec) || me;
  const cam = V.cam;
  if (focus) {
    let ox = 0, oy = 0;
    // botão direito: a câmera avança na direção do mouse, mais longe quanto mais perto da borda
    if (st.rmb && st.mouse.in) { const lim = (focus.tk.game.view || 450) * 0.75; ox = clamp((st.mouse.x / V.PX - V.W / 2) / cam.S * 2.5, -lim, lim); oy = clamp(-(st.mouse.y / V.PX - V.H / 2) / (cam.S * RENDER.SA) * 2.5, -lim, lim); }
    const k = 1 - Math.exp(-dt * (st.rmb ? 3 : 6)); st.camOff[0] += (ox - st.camOff[0]) * k; st.camOff[1] += (oy - st.camOff[1]) * k;
    cam.x = focus.x + st.camOff[0]; cam.y = focus.y + st.camOff[1];
  }
  if (st.shake > 0) { st.shake = Math.max(0, st.shake - dt * 1.2); cam.ox = (Math.random() - .5) * st.shake * 0.6; cam.oy = (Math.random() - .5) * st.shake * 0.6; } else { cam.ox = cam.oy = 0; }
  // projéteis
  for (const [id, s] of st.shells) { s.t += dt; s.prev = s.pos.slice();
    if (s.end) { s.endT -= dt; s.pos = s.end; if (s.endT <= 0) st.shells.delete(id); continue; }
    s.vel[2] -= G * dt; for (let a = 0; a < 3; a++) s.pos[a] += s.vel[a] * dt; if (s.pos[2] < 0 || s.t > 6) st.shells.delete(id); }
  // calor das placas atingidas esfria
  for (const key of st.heat) { const [id, gid, i] = key.split(',').map(Number); const ct = tankOf(id); if (!ct) { st.heat.delete(key); continue; } const g = ct.tk.grid(gid); g.heat[i] -= dt * 0.35; if (g.heat[i] <= 0) { g.heat[i] = 0; st.heat.delete(key); } }
  V.updParticles(dt);
  propFires(dt); wheatFx(rt, dt);
  // ---- desenho
  V.ground(st.T);
  if (st.g && st.mode === 'dom') { const z = st.M.zone, o = st.g.z[1]; const col = o === 0 ? [214, 164, 64] : o === 1 ? [111, 168, 220] : [230, 230, 220]; V.groundRing(z.x, z.y, z.r, col, 0.75); V.groundRing(z.x, z.y, z.r - 0.4, col, 0.35); }
  const drawn = [];
  for (const ct of st.tanks.values()) { const show = ct.vis || ct.id === st.myEnt || (ct.f & 1); if (!show || !V.tankOnScreen(ct.tk)) continue; drawn.push(ct); }
  for (const ct of drawn) { V.shadowGrid(ct.tk.GH, ct.tk.TH); V.shadowGrid(ct.tk.GT, ct.tk.TT); }
  V.applyShadow();
  if (st.soft.length && now - (st.softT || 0) > 0.25) { st.softT = now; for (const pr of st.soft) { pr.soft = false; markDirty(pr); } st.soft.length = 0; }
  for (const pr of st.dirty) { RENDER.refreshProp(pr); RENDER.reshadow(st.T, pr); pr.dirty = false; if (pr.fire) firePoints(pr); fogProp(pr); } st.dirty.length = 0;
  // de perto, as casas perto do centro da tela aparecem em corte (sem telhado nem andar de cima)
  const cutR = st.zoom > 20 * V.GBcss ? 26 : 0;
  // casa com um tanque visto lá dentro: corta e desenha o telhado meio transparente por cima
  const ghost = new Set(); for (const ct of drawn) for (const id of MAPGEN.propsAlong(st.M, ct.x - 1, ct.y - 1, ct.x + 1, ct.y + 1)) { const pr = st.M.props[id], f = pr.foot;
    if (pr.struct && !pr.gone && ct.x > f[0] && ct.x < f[2] && ct.y > f[1] && ct.y < f[3] && inHouse(pr, ct)) ghost.add(pr); }
  // copa de árvore por cima de um tanque visto: fica meio transparente para dar para ver o tanque embaixo
  for (const ct of drawn) for (const id of MAPGEN.propsAlong(st.M, ct.x - 4, ct.y - 4, ct.x + 4, ct.y + 4)) { const pr = st.M.props[id];
    if (pr.kind === 'tree' && pr.cutK && !pr.gone && !pr.fallen && !pr.falling && Math.hypot(pr.cx - ct.x, pr.cy - ct.y) < (pr.crownR || 2) + 2.2) ghost.add(pr); }
  for (const pr of st.M.props) if (!pr.gone) { const fl = pr.falling; if (!fl) V.splatProp(pr, 128 + pr.id, ghost.has(pr) || cutR && pr.struct && Math.abs(pr.cx - cam.x) < cutR && Math.abs(pr.cy - cam.y) < cutR); }
  for (let i = st.drops.length - 1; i >= 0; i--) { const f = st.drops[i]; f.t += dt; const u = Math.min(1, f.t / f.dur);
    if (u < 1) { V.splatDrop(f, f.drop * (1 - u * u)); continue; }
    st.drops.splice(i, 1); const pr = f.pr; if (pr.hide) { for (const idx of f.idx) pr.hide[idx] = 0; if (!st.drops.some(d => d.pr === pr)) pr.hide = null; }
    if (f.bits) spawnBits(f.bits, f.pr.fire ? 0.06 : 0.35, f.pr.fire ? 24 : 140); const P = [f.xs[0], f.ys[0], f.zs[0]], d = distTo(P);
    if (f.n > 400) { AUDIO.boom(d, false); st.shake = Math.max(st.shake, d < 40 ? 0.35 : 0); for (let q = 0; q < 8; q++) { const j = (Math.random() * f.n) | 0; V.dust([f.xs[j], f.ys[j], f.zs[j]], 12, [150, 140, 120]); } } else AUDIO.thud(d); }
  for (let i = st.falling.length - 1; i >= 0; i--) { const f = st.falling[i]; f.t += dt; const u = Math.min(1, f.t / f.dur); f.pr.falling = u < 1;
    if (u < 1) V.splatFalling(f, 0, u); else { st.falling.splice(i, 1); V.dust([f.cx + f.ux * 4, f.cy + f.uy * 4, 0.3], 20, [110, 120, 80]); AUDIO.thud(distTo([f.cx, f.cy])); } }
  V.drawLitter();
  for (const ct of drawn) V.splatTank(ct.tk, ct.ci, ct.id === st.myEnt && st.zoom > 20 * V.GBcss ? 'cut' : 'ext');
  V.vegetation(st.T, nowMs / 1000);
  V.outline();
  drawAntennas(drawn);
  for (const pr of ghost) if (!(cutR && pr.struct && Math.abs(pr.cx - cam.x) < cutR && Math.abs(pr.cy - cam.y) < cutR)) V.splatGhost(pr); V.blendGhost(0.32);
  V.drawParticles();
  drawWires(nowMs / 1000);
  fogUpdate(dt); if (st.fog && st.fog.on) V.fog(st.fog.vis, st.fog.N, st.fog.half); drawGhosts(nowMs / 1000);
  drawShells(dt); drawBullets(rdt); drawSmoke(dt);
  V.present();
  // ---- por cima
  updateAim(now);
  overlay(dt, drawn); drawSkulls(rdt); HITCAM.frame(rdt);
  if (centerT > 0) { centerT -= dt; if (centerT <= 0) $('#centerMsg').hidden = true; }
  if (me && st.me) { st.reloadLocal = Math.min(1, st.reloadLocal + dt / (st.me.reloadT || 7)); AUDIO.engine(!(me.f & 1), Math.abs(st.me.v)); }
  if (now - st.hudT > 0.1) { st.hudT = now; hud(); }
  if (now - st.mmT > 0.2) { st.mmT = now; minimap(); }
}
function turretFly(tk, dt) { const f = tk.turretFly, TT = tk.TT;
  f.vel[2] -= G * dt; TT.o[0] += f.vel[0] * dt; TT.o[1] += f.vel[1] * dt; TT.o[2] += f.vel[2] * dt;
  const wl = Math.hypot(f.w[0], f.w[1], f.w[2]); if (wl > 1e-4) TT.R = SIM.mul3(SIM.axisAngle(f.w, wl * dt), TT.R);
  let mz = 1e9; const c = [0, 0, 0], tb = tk.TK.turBox; for (const x of tb.x) for (const y of tb.y) for (const z of tb.z) { toW(TT, [x, y, z], c); mz = Math.min(mz, c[2]); }
  if (mz < 0) { TT.o[2] -= mz; if (f.vel[2] < 0) { st.view.dust([TT.o[0], TT.o[1], 0], 30); f.vel[2] *= -0.25; f.vel[0] *= 0.5; f.vel[1] *= 0.5; for (let a = 0; a < 3; a++) f.w[a] *= 0.4; if (Math.abs(f.vel[2]) < 1.2) { f.rest = true; AUDIO.thud(distTo(TT.o)); } } } }
// fogo e fumaça saindo das grades e dos furos
function fireFx(ct, dt) {
  const tk = ct.tk, V = st.view, f = ct.f, TK = tk.TK;
  const comps = []; if (f & 4) comps.push(['fight', 0.8]); if (f & 8) comps.push(['eng', 1]); if (f & 16) comps.push(['fight', 2.2, true]);
  for (const [comp, int, boom] of comps) {
    const vents = []; for (const v of TK.vents[comp]) vents.push(toW(tk.TH, v, [0, 0, 0]));
    if (comp === 'fight') { if (tk.turretFly) { const R0 = TK.ring, rz = TK.ringZ; vents.push(toW(tk.TH, [R0[0], R0[1], rz], [0, 0, 0]), toW(tk.TH, [R0[0] + 0.3, R0[1] + 0.3, rz], [0, 0, 0]), toW(tk.TH, [R0[0] - 0.3, R0[1] - 0.3, rz], [0, 0, 0])); } else for (const v of TK.vents.tur) vents.push(toW(tk.TT, v, [0, 0, 0])); }
    for (const h of tk.holes) { const g = tk.grid(h.g); if (g.mat[h.idx]) continue; const w = toW(tk.tf(g), h.c, [0, 0, 0]); const ml = h.g === 0 ? h.c : SIM.toL(tk.TH, w, [0, 0, 0]); if ((comp === 'eng') === (ml[0] < TK.firewall)) vents.push(w); }
    let n = int * (boom ? 260 : 90) * dt;
    while (n > 0) { if (n < 1 && Math.random() > n) break; n--; const v = vents[(Math.random() * vents.length) | 0]; if (!v) break; const s = boom ? 0.35 : 0.12;
      V.particles.push({ k: 1, x: v[0] + (Math.random() - .5) * s, y: v[1] + (Math.random() - .5) * s, z: v[2], vx: (Math.random() - .5) * 0.6, vy: (Math.random() - .5) * 0.6, vz: 1.4 + Math.random() * 2.2 * (boom ? 2 : 1), life: 0.35 + Math.random() * 0.7 * (boom ? 1.6 : 1), max: 0.9 * (boom ? 1.6 : 1), drag: 1.2 });
      if (Math.random() < 0.35) V.particles.push({ k: 2, x: v[0], y: v[1], z: v[2] + 0.3, vx: (Math.random() - .5) * 0.4, vy: (Math.random() - .5) * 0.4, vz: 1.2 + Math.random(), life: 3 + Math.random() * 3, max: 6, r0: 0.15, r1: 1.2 + (boom ? 1.2 : 0), col: [34, 32, 32] });
      if (Math.random() < 0.06) V.particles.push({ k: 0, x: v[0], y: v[1], z: v[2], vx: (Math.random() - .5) * 2, vy: (Math.random() - .5) * 2, vz: 2 + Math.random() * 3, life: 0.8 + Math.random(), max: 1.6 }); }
  }
  // destroço fumegando
  if ((f & 1) && !comps.length && ct.deadAt !== undefined) { const age = performance.now() / 1000 - ct.deadAt, rate = age < 120 ? 10 : 3;
    if (Math.random() < dt * rate) { const v = toW(tk.TH, [TK.ring[0] + (Math.random() - .5), TK.ring[1] + (Math.random() - .5), TK.ringZ], [0, 0, 0]); V.particles.push({ k: 2, x: v[0], y: v[1], z: v[2], vx: 0, vy: 0, vz: 1.6, life: 9, max: 9, r0: 0.3, r1: 3, col: [30, 29, 28] }); } }
}
function propFires(dt) { const V = st.view;
  for (const pr of st.M.props) { const f = pr.fire; if (!f || !f.pts.length) continue; const n = f.pts.length / 3; let k = Math.min(90, n * 0.8) * dt * 6;
    while (k > 0) { if (k < 1 && Math.random() > k) break; k--; const q = ((Math.random() * n) | 0) * 3, x = f.pts[q], y = f.pts[q + 1], z = f.pts[q + 2];
      V.particles.push({ k: 1, x: x + (Math.random() - .5) * 0.2, y: y + (Math.random() - .5) * 0.2, z, vx: (Math.random() - .5) * 0.5, vy: (Math.random() - .5) * 0.5, vz: 1.2 + Math.random() * 2.4, life: 0.4 + Math.random() * 0.8, max: 1.1, drag: 1.1 });
      if (Math.random() < 0.16) { const c = 42 + Math.random() * 30; V.particles.push({ k: 2, x, y, z: z + 0.4, vx: (Math.random() - .5) * 0.4, vy: (Math.random() - .5) * 0.4, vz: 1.4 + Math.random() * 1.2, life: 6 + Math.random() * 5, max: 11, r0: 0.3, r1: 2.8, col: [c, c * 0.96, c * 0.92] }); }
      if (Math.random() < 0.1) V.particles.push({ k: 9, x, y, z, vx: (Math.random() - .5) * 1, vy: (Math.random() - .5) * 1, vz: 1.5 + Math.random() * 2, life: 1.5 + Math.random() * 2.5, max: 4 });
      if (Math.random() < 0.05) V.particles.push({ k: 0, x, y, z, vx: (Math.random() - .5) * 2, vy: (Math.random() - .5) * 2, vz: 2 + Math.random() * 3, life: 0.8 + Math.random(), max: 1.6 }); } } }
// ================================================================ trigo pegando fogo
// Hora em que o fogo chega em cada célula de 0,5 m, por Dijkstra a partir do ponto e só pelo trigo: a favor do vento ~0,6 m/s,
// de lado ~0,2 e contra ~0,1, com um ruído por célula para a frente ficar irregular. Todo navegador faz a mesma conta.
const WHEAT_BURN = 7;
function wheatFireStart(x, y, seed, t0) { const T = st.T, C = 0.5, R = 46, N = Math.ceil(2 * R / C), ox = x - R, oy = y - R, A = new Float32Array(N * N).fill(Infinity);
  const ok = new Uint8Array(N * N); for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const wx = ox + (i + .5) * C, wy = oy + (j + .5) * C, ti = ((wx - T.x0) * T.res) | 0, tj = ((wy - T.y0) * T.res) | 0;
    if (ti >= 0 && tj >= 0 && ti < T.w && tj < T.h && T.kind[tj * T.w + ti] === 5) ok[j * N + i] = 1; }
  const wl = Math.hypot(SMOKE_WIND[0], SMOKE_WIND[1]), wx = SMOKE_WIND[0] / wl, wy = SMOKE_WIND[1] / wl, D = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const cost = D.map(([a, b]) => { const L = Math.hypot(a, b), c = (a * wx + b * wy) / L, v = 0.12 + 0.95 * ((c + 1) / 2) ** 2; return L * C / v; });
  const hk = [], hv = []; const push = (k, v) => { let i = hk.length; hk.push(k); hv.push(v); while (i > 0) { const p = (i - 1) >> 1; if (hv[p] <= v) break; hk[i] = hk[p]; hv[i] = hv[p]; i = p; } hk[i] = k; hv[i] = v; };
  const pop = () => { const k = hk[0], v = hv[0], lk = hk.pop(), lv = hv.pop(); if (hk.length) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= hk.length) break; if (c + 1 < hk.length && hv[c + 1] < hv[c]) c++; if (hv[c] >= lv) break; hk[i] = hk[c]; hv[i] = hv[c]; i = c; } hk[i] = lk; hv[i] = lv; } return [k, v]; };
  const c0 = (N >> 1) * N + (N >> 1); if (!ok[c0]) return; A[c0] = 0; push(c0, 0);
  while (hk.length) { const [k, v] = pop(); if (v > A[k]) continue; const i = k % N, j = (k / N) | 0;
    for (let d = 0; d < 8; d++) { const ii = i + D[d][0], jj = j + D[d][1]; if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue; const q = jj * N + ii; if (!ok[q]) continue;
      const nv = v + cost[d] * (0.7 + 0.6 * MAPGEN.h3(ii, jj, 5, seed)); if (nv < A[q] && nv < 150) { A[q] = nv; push(q, nv); } } }
  const order = []; for (let q = 0; q < N * N; q++) if (A[q] < Infinity) order.push(q); order.sort((a, b) => A[a] - A[b]);
  st.wheatFires.push({ ox, oy, N, C, A, order, t0, i0: 0, i1: 0, snd: 0 }); }
function wheatFx(rt, dt) { if (!st.wheatFires.length || st.offset === null) return; const V = st.view, T = st.T, F = T.flat, FN = T.flatN, h = st.M.half;
  for (let w = st.wheatFires.length - 1; w >= 0; w--) { const f = st.wheatFires[w], t = rt - f.t0, A = f.A, O = f.order, N = f.N, C = f.C;
    while (f.i1 < O.length && A[O[f.i1]] <= t) f.i1++;
    // queimou: palha deitada e chão preto
    while (f.i0 < f.i1 && A[O[f.i0]] + WHEAT_BURN <= t) { const q = O[f.i0++], x = f.ox + (q % N + .5) * C, y = f.oy + (((q / N) | 0) + .5) * C;
      for (const [a, b] of [[-0.125, -0.125], [0.125, -0.125], [-0.125, 0.125], [0.125, 0.125]]) { const fi = ((x + a + h) * 4) | 0, fj = ((y + b + h) * 4) | 0; if (fi >= 0 && fj >= 0 && fi < FN && fj < FN) F[fj * FN + fi] = 2;
        RENDER.paint(T, x + a, y + b, [38 + Math.random() * 14, 32 + Math.random() * 10, 26 + Math.random() * 8], 0.7 + Math.random() * 0.25); } }
    if (f.i0 >= O.length) { st.wheatFires.splice(w, 1); continue; }
    const n = f.i1 - f.i0; if (!n) continue; let k = Math.min(160, n * 0.6) * dt * 6;
    while (k > 0) { if (k < 1 && Math.random() > k) break; k--; const q = O[f.i0 + ((Math.random() * n) | 0)], x = f.ox + (q % N + Math.random()) * C, y = f.oy + (((q / N) | 0) + Math.random()) * C;
      V.particles.push({ k: 1, x, y, z: 0.1 + Math.random() * 0.4, vx: SMOKE_WIND[0] * 0.8 + (Math.random() - .5) * 0.4, vy: SMOKE_WIND[1] * 0.8 + (Math.random() - .5) * 0.4, vz: 1.2 + Math.random() * 2.2, life: 0.4 + Math.random() * 0.8, max: 1.2, drag: 1.1 });
      if (Math.random() < 0.18) { const c = 70 + Math.random() * 40; V.particles.push({ k: 2, x, y, z: 0.5, vx: (Math.random() - .5) * 0.4, vy: (Math.random() - .5) * 0.4, vz: 1 + Math.random(), life: 4 + Math.random() * 4, max: 8, r0: 0.3, r1: 2.2, col: [c, c * 0.93, c * 0.85] }); }
      if (Math.random() < 0.08) V.particles.push({ k: 9, x, y, z: 0.3, vx: (Math.random() - .5) * 1.2, vy: (Math.random() - .5) * 1.2, vz: 1 + Math.random() * 2, life: 1 + Math.random() * 2, max: 3 }); }
    f.snd -= dt; if (f.snd <= 0) { f.snd = 0.5 + Math.random() * 0.6; const q = O[f.i0 + ((Math.random() * n) | 0)], d = distTo([f.ox + (q % N) * C, f.oy + ((q / N) | 0) * C]); if (d < 70) AUDIO.brush(d * 1.6, false); } } }
function drawAntennas(list) { const V = st.view, P = [0, 0, 0], Q = [0, 0, 0];
  for (const ct of list) { const tk = ct.tk, an = tk.TK.antenna; if ((ct.f & 1) && an.on === 'h') continue; if (tk.turretOff && an.on === 't') continue; const T = an.on === 'h' ? tk.TH : tk.TT;
    V.proj(...toW(T, an.a, [0, 0, 0]), P); V.proj(...toW(T, an.b, [0, 0, 0]), Q); V.line(P[0], P[1], Q[0], Q[1], 28, 30, 32, 0.9, false); } }
// ================================================================ névoa de guerra
// Cada objeto do mapa vira opacidade numa grade de 1 m (só a faixa de 0,8 a 2,6 m, por onde passa a vista do comandante).
// Os tanques do time lançam raios em volta; o que nenhum raio alcança fica escuro. É só desenho: quem esconde o inimigo é o servidor.
function inHouse(pr, ct) { const n = pr.nav; if (!n) return false; for (const R of n.rooms) { if (R.floor) continue; const P = R.poly || null; if (!P) { const b = R.box; if (ct.x > b[0] && ct.x < b[2] && ct.y > b[1] && ct.y < b[3]) return true; continue; }
    let ins = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > ct.y) !== (P[j][1] > ct.y) && ct.x < (P[j][0] - P[i][0]) * (ct.y - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) ins = !ins; if (ins) return true; }
  return false; }
function fogInit() { const M = st.M, N = Math.ceil(M.size) + 2; st.fog = { N, half: M.half, op: new Float32Array(N * N), vis: new Uint8Array(N * N), tmp: new Uint8Array(N * N), smk: new Float32Array(N * N), smkList: [], t: 0, cells: new Map(), on: true };
  for (const pr of M.props) fogProp(pr); }
function fogProp(pr) { const F = st.fog; if (!F) return; const old = F.cells.get(pr); if (old) for (const [c, v] of old) F.op[c] -= v;
  if (pr.gone) { F.cells.delete(pr); return; }
  const acc = new Map(), nx = pr.nx, ny = pr.ny, nxy = nx * ny, mat = pr.mat, O = MAPGEN.OPAC, P = MAPGEN.PVS, N = F.N, h = F.half;
  for (const idx of pr.list) { const m = mat[idx]; if (!m) continue; const k = (idx / nxy) | 0; if (k < 8 || k > 26) continue; const i = idx % nx, j = ((idx / nx) | 0) % ny;
    const ci = Math.floor(pr.x0 + (i + .5) * P + h), cj = Math.floor(pr.y0 + (j + .5) * P + h); if (ci < 0 || cj < 0 || ci >= N || cj >= N) continue; const c = cj * N + ci; acc.set(c, (acc.get(c) || 0) + O[m] / 190); }
  for (const [c, v] of acc) F.op[c] += v; F.cells.set(pr, acc); }
function fogUpdate(dt) { const F = st.fog; if (!F) return; F.t -= dt; if (F.t > 0) return; F.t = 0.12;
  const N = F.N, h = F.half, op = F.op, smk = F.smk, V = st.view, cam = V.cam, out = F.tmp; out.fill(0);
  for (const c of F.smkList) smk[c] = 0; F.smkList.length = 0;
  for (const s of st.smokes) { if (s.t > s.life - 8) continue; const r = s.R * Math.min(1, 0.25 + s.t / s.grow) * 0.75, x = s.x + SMOKE_WIND[0] * s.t + h, y = s.y + SMOKE_WIND[1] * s.t + h;
    for (let j = Math.max(0, Math.floor(y - r)); j <= Math.min(N - 1, Math.ceil(y + r)); j++) for (let i = Math.max(0, Math.floor(x - r)); i <= Math.min(N - 1, Math.ceil(x + r)); i++) { if ((i + .5 - x) ** 2 + (j + .5 - y) ** 2 > r * r) continue; const c = j * N + i; if (!smk[c]) F.smkList.push(c); smk[c] = 0.45; } }
  const eyes = []; for (const ct of st.tanks.values()) if (ct.team === st.team && !(ct.f & 1)) eyes.push([ct.x, ct.y, ct.id === st.myEnt && st.me ? st.me.view : ct.tk.game.view]);
  if (!eyes.length) { F.vis.fill(255); return; }
  const sr = Math.hypot(V.W / 2 / cam.S, V.H / 2 / (cam.S * RENDER.SA)) + 8;
  for (const [ex, ey, view] of eyes) { const dc = Math.hypot(ex - cam.x, ey - cam.y), R = Math.min(view, dc + sr); if (R <= 0 || dc - sr > view) continue;
    const n = Math.ceil(2 * Math.PI * R / 0.7), x0 = ex + h, y0 = ey + h;
    for (let q = 0; q < n; q++) { const a = q / n * 2 * Math.PI, dx = Math.cos(a) * 0.7, dy = Math.sin(a) * 0.7; let x = x0, y = y0, o = 0, last = -1;
      for (let t = 0; t < R; t += 0.7) { x += dx; y += dy; const i = x | 0, j = y | 0; if (i < 0 || j < 0 || i >= N || j >= N) break; const c = j * N + i; if (c === last) continue; last = c;
        const v = 255 * (1 - (o > 1 ? 1 : o)); if (v > out[c]) out[c] = v; if (t > 10) { o += op[c] + smk[c]; if (o >= 1) break; } } } }
  const sw = F.vis; F.vis = out; F.tmp = sw; }
// onde o inimigo foi visto pela última vez: um contorno que some em 10 s
function drawGhosts(now) { const V = st.view, P = [0, 0, 0], Q = [0, 0, 0];
  for (const ct of st.tanks.values()) { if (ct.vis || ct.team === st.team || (ct.f & 1)) continue; const t = st.seenAt.get(ct.id); if (!t || now - t > 10) continue; const a = 0.8 * (1 - (now - t) / 10), g = ct.tk.game;
    const c = Math.cos(ct.h), s = Math.sin(ct.h), L = g.len / 2, W = g.wid / 2, pts = [[L, W], [L, -W], [-L, -W], [-L, W]].map(([u, v]) => [ct.x + c * u - s * v, ct.y + s * u + c * v]);
    for (let k = 0; k < 4; k++) { const A = pts[k], B = pts[(k + 1) % 4]; for (let d = 0; d < 1; d += 0.25) { V.proj(A[0] + (B[0] - A[0]) * d, A[1] + (B[1] - A[1]) * d, 0.2, P); V.proj(A[0] + (B[0] - A[0]) * (d + 0.14), A[1] + (B[1] - A[1]) * (d + 0.14), 0.2, Q); V.line(P[0], P[1], Q[0], Q[1], 255, 107, 79, a, false); } }
    V.proj(ct.x, ct.y, 0.2, P); V.line(P[0] - 3, P[1] - 3, P[0] + 3, P[1] + 3, 255, 107, 79, a, false); V.line(P[0] - 3, P[1] + 3, P[0] + 3, P[1] - 3, 255, 107, 79, a, false); } }
// fios do telégrafo entre postes vizinhos: quatro fios com barriga, balançando com o vento.
// Poste derrubado: o fio arrebenta e fica pendurado do poste que sobrou até o chão.
function wiresInit() { const P = st.M.props.filter(p => p.kind === 'pole').sort((a, b) => a.cx - b.cx); st.wires = [];
  for (let i = 1; i < P.length; i++) { const a = P[i - 1], b = P[i]; if (Math.hypot(b.cx - a.cx, b.cy - a.cy) < 50) st.wires.push([a, b]); } }
function drawWires(time) { const V = st.view, P = [0, 0, 0], Q = [0, 0, 0], H = 6.3, OFF = [-0.65, -0.3, 0.3, 0.65], cam = V.cam;
  for (const [a, b] of st.wires) { const ga = a.gone || a.fallen, gb = b.gone || b.fallen; if (ga && gb) continue;
    const dx = b.cx - a.cx, dy = b.cy - a.cy, L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L, mx = (a.cx + b.cx) / 2, my = (a.cy + b.cy) / 2;
    V.proj(mx, my, 0, P); const R = L * cam.S; if (P[0] < -R || P[0] > V.W + R || P[1] < -R - 7 * cam.S || P[1] > V.H + R) continue;
    for (let w = 0; w < 4; w++) { const o = OFF[w], sw = Math.sin(time * 1.3 + a.cx * 0.1 + w * 0.7) * 0.18, n = 14;
      const ax = a.cx + nx * o, ay = a.cy + ny * o, bx = b.cx + nx * o, by = b.cy + ny * o;
      if (!ga && !gb) { for (let s = 0; s <= n; s++) { const t = s / n, sag = 4 * t * (1 - t), x = ax + (bx - ax) * t + nx * sw * sag, y = ay + (by - ay) * t + ny * sw * sag, z = H - (0.9 + 0.02 * L) * sag;
          V.proj(x, y, z, Q); if (s) V.line(P[0], P[1], Q[0], Q[1], 34, 34, 32, 0.85, false); P[0] = Q[0]; P[1] = Q[1]; } continue; }
      // arrebentado: pende do poste em pé até o chão, a uns 40% do vão
      const sx = ga ? bx : ax, sy = ga ? by : ay, ex = sx + ((ga ? ax : bx) - sx) * 0.4 + nx * (w - 1.5) * 0.4, ey = sy + ((ga ? ay : by) - sy) * 0.4 + ny * (w - 1.5) * 0.4;
      for (let s = 0; s <= n; s++) { const t = s / n, x = sx + (ex - sx) * t + nx * sw * t * 0.5, y = sy + (ey - sy) * t, z = Math.max(0.02, H * (1 - t) * (1 - t * 0.35));
        V.proj(x, y, z, Q); if (s) V.line(P[0], P[1], Q[0], Q[1], 34, 34, 32, 0.85, false); P[0] = Q[0]; P[1] = Q[1]; } } } }
// fumaça: granada voando em arco e nuvens que crescem, andam com o vento e somem (mesma conta do servidor)
const SMOKE_WIND = [0.5, 0.25];
function drawSmoke(dt) { const V = st.view, P = [0, 0, 0], cam = V.cam;
  for (let i = st.lobs.length - 1; i >= 0; i--) { const L = st.lobs[i]; L.t += dt; const f = Math.min(1, L.t / L.T), h = 4 * f * (1 - f) * (8 + L.T * 6);
    V.proj(L.a[0] + (L.b[0] - L.a[0]) * f, L.a[1] + (L.b[1] - L.a[1]) * f, L.a[2] * (1 - f) + h, P); V.disc(P[0], P[1], Math.max(0.8, 0.06 * cam.S), 40, 42, 36, 1, false);
    if (f >= 1) st.lobs.splice(i, 1); }
  for (let i = st.smokes.length - 1; i >= 0; i--) { const s = st.smokes[i]; s.t += dt; if (s.t >= s.life) { st.smokes.splice(i, 1); continue; }
    const r = s.R * Math.min(1, 0.25 + s.t / s.grow), x = s.x + SMOKE_WIND[0] * s.t, y = s.y + SMOKE_WIND[1] * s.t, fade = Math.min(1, s.t * 2) * Math.min(1, (s.life - s.t) / 8);
    for (let q = 0; q < 5; q++) { const hq = MAPGEN.h3(s.s, q, 3, 7), an = s.s * 2.4 + q * 1.26 + s.t * (0.04 + hq * 0.08), rr = q ? r * (0.35 + 0.35 * hq) : 0, z = r * (q ? 0.4 + 0.3 * hq : 0.7);
      V.proj(x + Math.cos(an) * rr, y + Math.sin(an) * rr, z, P); const R = r * (q ? 0.55 + 0.35 * hq : 0.85) * cam.S, c = 178 + 34 * MAPGEN.h3(s.s, q, 9, 1);
      if (P[0] < -R || P[1] < -R || P[0] > V.W + R || P[1] > V.H + R) continue; V.softDisc(P[0], P[1], R, c, c, c - 6, (q ? 0.5 : 0.6) * fade); } } }
// balas de metralhadora: risco curto voando até onde o servidor disse que bateu; um em cada três é traçante
function drawBullets(dt) { const V = st.view, P = [0, 0, 0], Q = [0, 0, 0], H = [0, 0, 0], B = [0, 0, 0];
  for (let i = st.bullets.length - 1; i >= 0; i--) { const u = st.bullets[i]; u.t += dt; const f = Math.min(1, u.t / u.T), g = Math.max(0, f - Math.min(0.5, (u.tr ? 9 : 4) / u.L));
    for (let c = 0; c < 3; c++) { H[c] = u.a[c] + (u.b[c] - u.a[c]) * f; B[c] = u.a[c] + (u.b[c] - u.a[c]) * g; }
    V.proj(H[0], H[1], H[2], P); V.proj(B[0], B[1], B[2], Q);
    if (u.tr) V.line(Q[0], Q[1], P[0], P[1], 255, u.de ? 236 : 120, u.de ? 190 : 90, 0.95, true); else V.line(Q[0], Q[1], P[0], P[1], 230, 220, 190, 0.35, false);
    if (f >= 1) { st.bullets.splice(i, 1); mgImpact(u); } } }
function mgImpact(u) { const V = st.view, p = u.b, d = distTo(p);
  if (u.hit === 3 || u.hit === 2) { for (let i = 0; i < (u.hit === 3 ? 4 : 2); i++) V.particles.push({ k: 0, x: p[0], y: p[1], z: p[2], vx: (Math.random() - .5) * 5, vy: (Math.random() - .5) * 5, vz: Math.random() * 4, life: 0.15 + Math.random() * 0.25, max: 0.4 });
    if (u.hit === 3 && Math.random() < 0.3) AUDIO.ping(d); }
  if (u.hit !== 3 && Math.random() < 0.7) V.particles.push({ k: 2, x: p[0], y: p[1], z: p[2] + 0.05, vx: 0, vy: 0, vz: 0.4, life: 0.8, max: 0.8, r0: 0.05, r1: 0.3, col: u.hit === 1 ? [150, 120, 86] : u.hit === 2 ? [170, 166, 156] : [140, 126, 98] }); }
// lascas de madeira, palha e pedra arrancadas pela bala
function mgChips(pr, rem) { const V = st.view, P = [0, 0, 0]; if (!pr.cr) return;
  for (let q = 0; q < Math.min(4, rem.length); q++) { const idx = rem[q]; MAPGEN.propCenter(pr, idx, P); V.chunk(P.slice(), [pr.cr[idx] * 0.85, pr.cg[idx] * 0.85, pr.cb[idx] * 0.85], 0.5, 0.5 + Math.random() * 0.6, Math.random() < 0.4); } }
function drawShells(dt) { const V = st.view, P = [0, 0, 0], Q = [0, 0, 0];
  for (const s of st.shells.values()) { const sp = Math.hypot(s.vel[0], s.vel[1], s.vel[2]) || 1, tail = Math.min(18, sp * 0.03);
    const b = [s.pos[0] - s.vel[0] / sp * tail, s.pos[1] - s.vel[1] / sp * tail, s.pos[2] - s.vel[2] / sp * tail];
    V.proj(...s.pos, P); V.proj(...b, Q); const he = s.kind === 'HE' || s.kind === 'HEAT'; V.line(Q[0], Q[1], P[0], P[1], 255, he ? 170 : 235, he ? 80 : 160, 0.9, true); V.plot(P[0], P[1], 255, 255, 230, 1, true); }
  for (let i = st.tracers.length - 1; i >= 0; i--) { const t = st.tracers[i]; t.t -= dt; if (t.t <= 0) { st.tracers.splice(i, 1); continue; } const a = Math.min(1, t.t * 2);
    for (let k = 1; k < t.pts.length; k++) { V.proj(...t.pts[k - 1], P); V.proj(...t.pts[k], Q); V.line(P[0], P[1], Q[0], Q[1], 255, 235, 160, a, true); } } }

// ================================================================ mira e análise
function aimFromScreen(mx, my) { const V = st.view, x = (mx / V.PX) | 0, y = (my / V.PX) | 0; if (x < 0 || y < 0 || x >= V.W || y >= V.H) return null;
  const id = V.idb[y * V.W + x];
  if (id > 0) { const v = id - 1, code = v >>> 21, idx = v & 0x1FFFFF;
    if (code < 128) { const ct = st.byCi[code >> 1]; if (ct) { const g = ct.tk.grid(code & 1); if (g.mat[idx]) return { p: toW(ct.tk.tf(g), gCenter(g, idx, [0, 0, 0]), [0, 0, 0]), ct }; } }
    else { const pr = st.M.props[code - 128]; if (pr && pr.mat[idx]) return { p: MAPGEN.propCenter(pr, idx, [0, 0, 0]), pr }; } }
  return { p: V.unproj(mx / V.PX, my / V.PX) }; }
function shotFrom(me, p) { const tk = me.tk, i = st.me.loaded !== null ? st.me.loaded : st.sel, A = SIM.ammoObj(tk.TK, i), B = tk.TK.barrel;
  const mz = toW(tk.TT, [B.x1, 0, B.z], [0, 0, 0]); const dx = p[0] - mz[0], dy = p[1] - mz[1], d = Math.max(1, Math.hypot(dx, dy));
  const el = SIM.elevFor(A.v, d, p[2] - mz[2]), t = d / (A.v * Math.cos(el)), vh = A.v * Math.cos(el), vz = A.v * Math.sin(el) - G * t;
  return { A, mz, d, dir: nrm([dx / d * vh, dy / d * vh, vz]), pen: SIM.penAt(A.def, d) }; }
function updateAim(now) {
  if (!st.mouse.in) return; const h = aimFromScreen(st.mouse.x, st.mouse.y); if (!h) return;
  st.aim = h.p; const me = myTank();
  const box = $('#analysis');
  if (!me || !st.me || !h.ct || h.ct === me || (h.ct.f & 1) || h.ct.team === st.team) { st.hover = null; box.hidden = true; return; }
  if (now - st.hoverT < 0.06 && st.hover) { place(box); return; } st.hoverT = now;
  const s = shotFrom(me, h.p); const start = [h.p[0] - s.dir[0] * 6, h.p[1] - s.dir[1] * 6, h.p[2] - s.dir[2] * 6];
  const rep = h.ct.tk.castShot(start, s.dir, s.A, s.pen, true, 12); st.hover = rep;
  if (!rep.plate) { box.innerHTML = '<b>' + SIM.TANKS[h.ct.type].short + '</b>' + (rep.ext ? '<br>Acerta ' + rep.ext.join(', ') : '') + '<br>Sem blindagem na linha de tiro'; }
  else { const ok = rep.res === 'pen';
    box.innerHTML = '<b>' + SIM.TANKS[h.ct.type].short + ' · ' + rep.plate + '</b>' +
      '<br>Espessura ' + rep.t.toFixed(0) + ' mm' + (rep.t < rep.t0 - 0.5 ? ' (era ' + rep.t0 + ')' : '') +
      '<br>Ângulo ' + rep.ang.toFixed(0) + '° → efetiva <b>' + rep.eff.toFixed(0) + ' mm</b>' +
      '<br>' + s.A.name + ': ' + rep.pen.toFixed(0) + ' mm a ' + Math.round(s.d) + ' m' +
      '<br><span class="' + (ok ? 'bad' : 'good') + '">' + (ok ? 'PENETRA' : 'NÃO PENETRA') + '</span> · ricochete ' + Math.round(rep.ric * 100) + '%' +
      (rep.ext ? '<br>Antes passa por: ' + rep.ext.join(', ') : ''); }
  box.hidden = false; place(box);
}
function place(box) { const x = st.mouse.x, y = st.mouse.y, w = box.offsetWidth, W = st.view.cw; box.style.left = (x + 22 + w > W ? x - w - 22 : x + 22) + 'px'; box.style.top = (y + 18) + 'px'; }
function overlay(dt, drawn) {
  const V = st.view, c = V.ctx, PX = V.PX, P = [0, 0, 0];
  V.drawLabels(dt);
  // nomes sobre os tanques
  c.textAlign = 'center'; c.font = '600 13px "Barlow Condensed", sans-serif';
  for (const ct of drawn) { if (ct.id === st.myEnt) continue; V.proj(ct.x, ct.y, 3.6, P); const dead = ct.f & 1;
    const txt = (dead ? '✕ ' : '') + slotName(ct.slot); c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,.75)'; c.strokeText(txt, P[0] * PX, P[1] * PX - 6);
    c.fillStyle = dead ? '#8d968f' : ct.team === st.team ? '#8fd18f' : '#ff6b4f'; c.fillText(txt, P[0] * PX, P[1] * PX - 6);
    if (!dead && ct.team !== st.team) { const d = myTank() ? Math.round(Math.hypot(ct.x - myTank().x, ct.y - myTank().y)) : 0; c.font = '500 11px "JetBrains Mono", monospace'; c.fillStyle = '#ffb3a3'; c.fillText(d + ' m', P[0] * PX, P[1] * PX + 8); c.font = '600 13px "Barlow Condensed", sans-serif'; } }
  const me = myTank(); if (!me || !st.me || !st.mouse.in) return;
  // marca de onde o canhão aponta agora
  if (!(me.f & 1) && !me.tk.turretOff) { const yaw = me.h + me.tk.ty, B = me.tk.TK.barrel, mz = toW(me.tk.TT, [B.x1, 0, B.z], [0, 0, 0]);
    const d = Math.hypot(st.aim[0] - mz[0], st.aim[1] - mz[1]); V.proj(mz[0] + Math.cos(yaw) * d, mz[1] + Math.sin(yaw) * d, st.aim[2], P);
    c.strokeStyle = 'rgba(255,240,200,.85)'; c.lineWidth = 1.5; c.beginPath(); c.arc(P[0] * PX, P[1] * PX, 5, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(P[0] * PX - 10, P[1] * PX); c.lineTo(P[0] * PX - 6, P[1] * PX); c.moveTo(P[0] * PX + 6, P[1] * PX); c.lineTo(P[0] * PX + 10, P[1] * PX); c.stroke(); }
  // mira do mouse com a recarga em volta
  const x = st.mouse.x, y = st.mouse.y, H = st.hover;
  c.strokeStyle = H && H.res === 'pen' ? '#e5583f' : H && H.res === 'non' ? '#79c27c' : '#dfe1d6'; c.lineWidth = 1.5;
  c.beginPath(); c.arc(x, y, 10, 0, Math.PI * 2); c.moveTo(x - 18, y); c.lineTo(x - 6, y); c.moveTo(x + 6, y); c.lineTo(x + 18, y); c.moveTo(x, y - 18); c.lineTo(x, y - 6); c.moveTo(x, y + 6); c.lineTo(x, y + 18); c.stroke();
  const loaded = st.me.loaded !== null; c.strokeStyle = loaded ? '#d6a440' : 'rgba(214,164,64,.55)'; c.lineWidth = 3;
  c.beginPath(); c.arc(x, y, 15, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (loaded ? 1 : st.reloadLocal)); c.stroke();
  const d = Math.round(Math.hypot(st.aim[0] - me.x, st.aim[1] - me.y)); c.font = '500 11px "JetBrains Mono", monospace'; c.fillStyle = '#dfe1d6'; c.textAlign = 'left'; c.fillText(d + ' m', x + 20, y - 10);
}

// caveirinhas: sobem 1,8 m a partir do lugar do tripulante e somem aos poucos (seguem o tanque se ele andar)
function drawSkulls(dt) { if (!st.skulls.length) return; const V = st.view, c = V.ctx, PX = V.PX, P = [0, 0, 0], sc = Math.max(2, Math.min(4, Math.round(st.zoom / 14)));
  for (let i = st.skulls.length - 1; i >= 0; i--) { const s = st.skulls[i]; s.t += dt; const u = s.t - s.dl; if (u > 2.8) { st.skulls.splice(i, 1); continue; } if (u < 0) continue;
    const tk = s.ct.tk, g = s.o.g === 'h' ? tk.GH : tk.GT, w = toW(tk.tf(g), s.o.c, [0, 0, 0]), rise = 0.3 + 1.8 * (1 - Math.pow(1 - Math.min(1, u / 2.4), 2));
    V.proj(w[0], w[1], w[2] + rise, P); c.globalAlpha = Math.min(1, u / 0.25, (2.8 - u) / 0.8); HITCAM.skull(c, Math.round(P[0] * PX - 3.5 * sc), Math.round(P[1] * PX - 3.5 * sc), sc, '#f4f1e8'); c.globalAlpha = 1; } }

// ================================================================ HUD
const SEATN = SIM.SEAT_NAMES;
function hud() {
  const g = st.g, me = st.me; if (!g) return;
  const mm = Math.floor(g.t / 60), ss = String(g.t % 60).padStart(2, '0'); $('#hudTime').textContent = mm + ':' + ss;
  let sc = '';
  if (st.mode === 'dm') { const al = [0, 0]; for (const ct of st.tanks.values()) if (!(ct.f & 1)) al[ct.team]++; sc = 'Vivos: <b class="t0">' + al[0] + '</b> × <b class="t1">' + al[1] + '</b>'; }
  else if (st.mode === 'tdm') sc = 'Abates: <b class="t0">' + g.sc[0] + '</b> × <b class="t1">' + g.sc[1] + '</b> <small>(vence com ' + st.msg.kills + ')</small>';
  else sc = 'Pontos: <b class="t0">' + g.sc[0] + '</b> × <b class="t1">' + g.sc[1] + '</b> <small>(vence com 100)</small>';
  $('#hudScore').innerHTML = sc;
  const zb = $('#zoneBar'); if (st.mode === 'dom') { zb.hidden = false; const p = g.z[0]; zb.firstElementChild.style.cssText = p < 0 ? 'left:' + (50 + p / 2) + '%;width:' + (-p / 2) + '%;background:' + TEAMCOL[0] : 'left:50%;width:' + (p / 2) + '%;background:' + TEAMCOL[1];
    zb.lastElementChild.textContent = g.z[1] === -1 ? (p ? 'Zona em disputa' : 'Zona neutra') : g.z[1] === st.team ? 'Zona é nossa' : 'Zona do inimigo'; } else zb.hidden = true;
  if (!me) return;
  const ct = myTank(); if (!ct) return; const TK = ct.tk.TK;
  $('#hudTank').textContent = TK.short + ' · ' + (me.role === 'both' ? 'motora e torre' : me.role === 'driver' ? 'você dirige (motora)' : 'você mira e atira (torre)');
  // tripulação
  $('#crew').innerHTML = me.crew.map(([seat, name, ok]) => { const mv = me.moving && me.moving[0] === seat;
    return '<div class="' + (ok ? '' : mv ? 'mv' : 'dead') + '"><span>' + SEATN[seat] + '</span><span>' + (ok ? (name === SEATN[seat] ? 'ok' : name.split(' ')[0]) : mv ? 'assumindo ' + Math.round(me.moving[1] * 100) + '%' : 'vazio') + '</span></div>'; }).join('');
  $('#mods').innerHTML = me.mods.map(([k, name, hp, dead]) => '<div class="' + (dead ? 'dead' : hp < 50 ? 'dmg' : '') + '"><span>' + shortMod(k, name) + '</span><i class="hbar"><i style="width:' + hp + '%"></i></i></div>').join('');
  // munição
  $('#ammo').innerHTML = TK.game.ammo.map((a, i) => '<div class="am' + (i === me.sel ? ' sel' : '') + (me.loaded === i ? ' ld' : '') + (me.ammo[i] ? '' : ' out') + '"><kbd>' + (i + 1) + '</kbd><b>' + a.t + '</b><span>' + me.ammo[i] + '</span></div>').join('');
  const MG = TK.game.mg, SM = TK.game.smoke; $('#mgbar').innerHTML = (MG && me.mg ? me.mg.map(([belt, ammo, rl, ok], i) => '<div class="' + (ok ? '' : 'dead') + '"><span>' + (i ? 'Casco (auto)' : '<kbd>Esp</kbd> Coaxial') + '</span><span>' + (belt || !ammo ? belt + '/' + (belt + ammo) : 'trocando fita') + '</span><i style="width:' + (belt ? Math.round(belt / MG.belt * 100) : Math.round(rl * 100)) + '%"></i></div>').join('') : '') + (SM && me.smk ? '<div class="' + (me.smk[0] ? '' : 'dead') + '"><span><kbd>G</kbd> ' + (SM.kind === 'mortar' ? 'Fumaça' : 'Descarga') + '</span><span>' + (me.smk[2] > 0 ? 'soltando' : me.smk[1] > 0 ? 'carregando' : me.smk[0]) + '</span></div>' : '');
  const rl = $('#reload'); rl.firstElementChild.style.width = (me.loaded !== null ? 100 : Math.round(st.reloadLocal * 100)) + '%';
  rl.lastElementChild.textContent = me.loaded !== null ? 'Carregado: ' + TK.game.ammo[me.loaded].k + ' (' + TK.game.ammo[me.loaded].t + ')' : me.ammo.some(v => v) ? 'Recarregando ' + TK.game.ammo[me.ammo[me.sel] ? me.sel : me.ammo.findIndex(v => v)].t + '…' : 'Sem munição';
  $('#speed').textContent = Math.round(Math.abs(me.v) * 3.6) + ' km/h' + (me.v < -0.2 ? ' ré' : '') + (me.hide && !me.dead ? ' · camuflado: visto a ' + me.hide + ' m' : '');
  const rep = $('#repair'); if (me.rep) { rep.hidden = false; rep.lastElementChild.textContent = me.rep[0] === 'fire' ? 'Apagando o fogo' : 'Consertando (fique parado)'; rep.firstElementChild.firstElementChild.style.width = Math.round(me.rep[1] * 100) + '%'; }
  else { rep.hidden = me.dead || !(me.fires || ct.f & 64); if (!rep.hidden) { rep.lastElementChild.textContent = me.fires ? 'INCÊNDIO! Aperte R para apagar' : 'Esteira quebrada: pare e aperte R'; rep.firstElementChild.firstElementChild.style.width = '0'; } }
  const dead = $('#deadBox'); if (me.dead) { dead.hidden = false; dead.textContent = me.respawn > 0 ? 'Volta em ' + me.respawn + ' s' : me.respawn === 0 ? 'Voltando…' : 'Seu tanque foi destruído. Espaço troca a câmera para um aliado.'; } else dead.hidden = true;
}
function shortMod(k, name) { const M = { coax: 'MG coaxial', bowmg: 'MG do casco', engine: 'Motor', trans: 'Câmbio', diff: 'Diferencial', fdL: 'Redução esq.', fdR: 'Redução dir.', trackL: 'Esteira esq.', trackR: 'Esteira dir.', wheelsL: 'Rodas esq.', wheelsR: 'Rodas dir.', breech: 'Culatra', barrel: 'Cano', ring: 'Anel da torre', sight: 'Mira', radio: 'Rádio' }; return M[k] || name; }

// ================================================================ minimapa
function buildMinimapBase(M, T) { const N = 200, c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d'), img = x.createImageData(N, N), d = new Uint32Array(img.data.buffer);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const tx = Math.floor(i / N * T.w), ty = Math.floor((N - 1 - j) / N * T.h); d[j * N + i] = T.base[ty * T.w + tx]; }
  x.putImageData(img, 0, 0);
  for (const pr of M.props) { const b = pr.bb, s = N / M.size, X = (b[0] + M.half) * s, Y = N - (b[3] + M.half) * s, w = Math.max(1, (b[2] - b[0]) * s), h = Math.max(1, (b[3] - b[1]) * s);
    x.fillStyle = pr.struct ? '#4a3c34' : pr.kind === 'tree' ? 'rgba(40,70,36,.85)' : pr.kind === 'hedge' || pr.kind === 'bush' ? 'rgba(46,80,40,.8)' : 'rgba(90,84,70,.8)'; x.fillRect(X, Y, w, h); }
  return c; }
function minimap() { const c = $('#minimap'), x = c.getContext('2d'), N = c.width, M = st.M, s = N / M.size, P = (wx, wy) => [(wx + M.half) * s, N - (wy + M.half) * s];
  x.drawImage(st.mm, 0, 0, N, N);
  if (st.mode === 'dom') { const z = M.zone, [a, b] = P(z.x, z.y); const o = st.g ? st.g.z[1] : -1; x.strokeStyle = o === 0 ? TEAMCOL[0] : o === 1 ? TEAMCOL[1] : '#eee'; x.lineWidth = 2; x.beginPath(); x.arc(a, b, z.r * s, 0, Math.PI * 2); x.stroke(); }
  const me = myTank();
  if (me && st.me) { const [a, b] = P(me.x, me.y); x.strokeStyle = 'rgba(255,255,255,.18)'; x.lineWidth = 1; x.beginPath(); x.arc(a, b, st.me.view * s, 0, Math.PI * 2); x.stroke();
    const V = st.view; x.strokeStyle = 'rgba(255,255,255,.5)'; const hw = V.W / 2 / V.cam.S, hh = V.H / 2 / (V.cam.S * RENDER.SA); const [c0, c1] = P(V.cam.x - hw, V.cam.y + hh); x.strokeRect(c0, c1, hw * 2 * s, hh * 2 * s); }
  const now = performance.now() / 1000;
  for (const ct of st.tanks.values()) { const dead = ct.f & 1; const [a, b] = P(ct.x, ct.y);
    if (!ct.vis && ct.id !== st.myEnt && !dead) { const t = st.seenAt.get(ct.id); if (t && now - t < 6 && ct.team !== st.team) { x.fillStyle = 'rgba(255,107,79,.45)'; x.fillRect(a - 2, b - 2, 4, 4); } continue; }
    if (dead) { x.strokeStyle = '#777'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(a - 3, b - 3); x.lineTo(a + 3, b + 3); x.moveTo(a + 3, b - 3); x.lineTo(a - 3, b + 3); x.stroke(); continue; }
    x.save(); x.translate(a, b); x.rotate(-ct.h); x.fillStyle = ct.id === st.myEnt ? '#ffffff' : ct.team === st.team ? '#8fd18f' : '#ff6b4f';
    x.beginPath(); x.moveTo(6, 0); x.lineTo(-4, -4); x.lineTo(-2, 0); x.lineTo(-4, 4); x.closePath(); x.fill(); x.restore(); } }

return { start, stop, onSnap, quit, togglePause, get active() { return !!st; }, get state() { return st; }, diag: DIAG };
})();
