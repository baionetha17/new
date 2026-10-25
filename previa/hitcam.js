// Câmera de acerto (canto superior esquerdo): o tanque atingido em raio-X girando devagar, o projétil chegando em câmera lenta,
// os estilhaços se espalhando por dentro e o que foi danificado ou destruído. Quando é o nosso tanque que leva o tiro,
// aparece um painel menor embaixo. H revê o último acerto nosso.
const HITCAM = (() => {
'use strict';
const { toW, CAT, setRz } = SIM;
const SA = RENDER.SA, CA = RENDER.CA, LIGHT = RENDER.LIGHT, pack = RENDER.pack;
const BG = pack(16, 20, 24);
const RES = { pen: ['PENETROU', '#e5583f'], non: ['NÃO PENETROU', '#9fc2a6'], ric: ['RICOCHETE', '#e8b64a'], kill: ['DESTRUÍDO', '#ff5a3a'], boom: ['MUNIÇÃO DETONOU', '#ff7a2a'], miss: ['ERROU', '#9aa0a6'] };
// caveira em pixel art (7 x 7)
const SKULL = ['.XXXXX.', 'XXXXXXX', 'X..X..X', 'X..X..X', 'XXX.XXX', '.XXXXX.', '.X.X.X.'];
let big = null, small = null, last = null;

function panel(id) { const box = document.getElementById(id); if (!box) return null; const cv = box.querySelector('canvas'); return { box, cv, V: null, cur: null }; }
function init() { big = panel('hitcam'); small = panel('hitcamIn'); hide(); }
function hide() { for (const P of [big, small]) if (P) { P.cur = null; P.box.hidden = true; } }
// d: evento 'hc' desmontado; tank: o SIM.Tank do alvo (o mesmo do jogo, com os furos de verdade)
function show(which, d, tank) { const P = which === 'in' ? small : big; if (!P || !tank) return;
  P.box.hidden = false; if (!P.V) P.V = new RENDER.View(P.cv, 2); else { P.V.cw = 0; P.V.resize(); }
  P.cur = prep({ which, d, tank, t: 0, dur: which === 'in' ? 4.2 : 5.6 }); if (which === 'out') last = { d, tank }; }
function replay() { if (last) show('out', last.d, last.tank); return !!last; }
function unpack(e) { return { from: e[1], to: e[2], kind: e[3], ammo: e[4], res: e[5], plate: e[6], t: e[7], eff: e[8], pen: e[9], ang: e[10], dist: e[11], ty: e[12], path: e[13], frags: e[14], mods: e[15], crew: e[16] }; }

function prep(c) { const d = c.d, P = []; for (let i = 0; i + 2 < d.path.length; i += 3) P.push([d.path[i], d.path[i + 1], d.path[i + 2]]);
  // direção de chegada no sistema do casco: a câmera fica do lado de quem atirou, um pouco de lado para o caminho não ficar de ponta
  let dir = [0, 1, -0.2]; if (P.length > 1) { const a = P[0], b = P[1], L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1; dir = [(b[0] - a[0]) / L, (b[1] - a[1]) / L, (b[2] - a[2]) / L]; }
  const phi = Math.atan2(dir[1], dir[0]); c.h0 = Math.PI / 2 + 0.6 - phi;
  if (P.length === 1) { const q = P[0]; P.unshift([q[0] - dir[0] * 4, q[1] - dir[1] * 4, q[2] + 2]); }   // explosão perto: o projétil cai de cima
  // o primeiro trecho (de fora até a placa) leva 0,9 s; dentro do tanque o resto do caminho leva 0,45 s
  const seg = []; let inside = 0; for (let i = 1; i < P.length; i++) { const L = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1], P[i][2] - P[i - 1][2]); seg.push(L); if (i > 1) inside += L; }
  c.P = P; c.seg = seg; c.tIn = 0.35; c.tHit = c.tIn + 0.9; c.tEnd = c.tHit + (P.length > 2 ? 0.45 : 0); c.inside = inside || 1;
  c.hit = new Map(d.mods.map(([id, dead]) => [id, dead])); c.crew = new Set(d.crew);
  return c; }
// ponto do caminho no tempo t (null antes de sair)
function headAt(c, t) { const P = c.P; if (t <= c.tIn) return null; if (t <= c.tHit) { const u = (t - c.tIn) / (c.tHit - c.tIn); return lerp3(P[0], P[1], u * u * 0.3 + u * 0.7); }
  if (P.length <= 2 || t >= c.tEnd) return null; let s = (t - c.tHit) / (c.tEnd - c.tHit) * c.inside;
  for (let i = 1; i < c.seg.length; i++) { if (s <= c.seg[i]) return lerp3(P[i], P[i + 1], s / (c.seg[i] || 1)); s -= c.seg[i]; } return P[P.length - 1]; }
const lerp3 = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];

function frame(dt) { for (const P of [big, small]) { if (!P || !P.cur) continue; const c = P.cur; c.t += dt;
  if (c.t >= c.dur) { P.cur = null; P.box.hidden = true; continue; }
  P.box.style.opacity = Math.min(1, c.t / 0.2, (c.dur - c.t) / 0.5).toFixed(2);
  try { draw(P, c); } catch (e) { P.cur = null; P.box.hidden = true; } } }

function draw(P, c) { const V = P.V; V.resize(); const tk = c.tank, d = c.d, t = c.t;
  V.u32.fill(BG); V.zb.fill(Infinity);
  const W = V.W, H = V.H; if (!V.ac || V.ac.length !== W * H) { V.ac = new Uint8Array(W * H); V.as = new Float32Array(W * H); } else { V.ac.fill(0); V.as.fill(0); }
  V.cam.S = Math.min(W * 0.8 / 7, H * 0.95 / 5.4); V.cam.x = 0; V.cam.y = 1.25 * CA / SA - 0.35 / SA; V.cam.ox = V.cam.oy = 0;
  // pose de vitrine: casco no centro girando devagar, torre na posição da hora do tiro
  const sv = { x: tk.x, y: tk.y, h: tk.h, ty: tk.ty }, hd = c.h0 + 0.16 * Math.sin(t * 0.55) - 0.05 * t;
  tk.x = 0; tk.y = 0; tk.h = hd; tk.ty = d.ty; tk.update();
  const showT = !tk.turretOff, reveal = t >= c.tHit + 0.25, pulse = reveal ? 0.5 + 0.5 * Math.cos((t - c.tHit) * 9) * Math.max(0, 1 - (t - c.tHit - 0.25) / 1.6) : 0;
  try {
    for (const pass of [0, 1]) { splat(V, tk, tk.GH, tk.TH, c, pass, reveal, pulse); if (showT) splat(V, tk, tk.GT, tk.TT, c, pass, reveal, pulse); }
    xray(V);
    const Q = [0, 0, 0], R = [0, 0, 0], w = p => toW(tk.TH, p, [0, 0, 0]);
    // caminho do projétil: risco que acompanha a ponta; depois fica marcado (vermelho por dentro do tanque)
    const head = headAt(c, t), PP = c.P, done = t >= c.tEnd;
    const seg = (A, B, ins) => { const pa = V.proj(...w(A), Q), pb = V.proj(...w(B), R); V.line(pa[0], pa[1], pb[0], pb[1], 255, ins ? 120 : 236, ins ? 80 : 170, done ? 0.8 : 0.95, true); };
    if (t > c.tIn) { seg(PP[0], t >= c.tHit ? PP[1] : head, false);
      let left = done ? Infinity : t > c.tHit ? (t - c.tHit) / (c.tEnd - c.tHit) * c.inside : -1;
      for (let i = 2; i < PP.length && left > 0; i++) { const Lg = c.seg[i - 1]; if (left >= Lg) { seg(PP[i - 1], PP[i], true); left -= Lg; } else { seg(PP[i - 1], lerp3(PP[i - 1], PP[i], left / (Lg || 1)), true); left = 0; } }
      if (head) { V.proj(...w(head), Q); V.disc(Q[0], Q[1], 1.6, 255, 250, 220, 1, true); } }
    // clarão na placa
    if (t >= c.tHit && t < c.tHit + 0.35) { V.proj(...w(PP[1]), Q); const u = (t - c.tHit) / 0.35; V.disc(Q[0], Q[1], 2 + u * 7, 255, 220, 140, 0.9 * (1 - u), true); }
    // estilhaços: cada um cresce do ponto de entrada até onde parou
    const F = d.frags; if (F.length && t > c.tHit) for (let i = 0, n = 0; i + 6 < F.length; i += 7, n++) { const dl = MAPGEN.h3(n, 3, 1, 7) * 0.35, u = Math.min(1, (t - c.tHit - 0.04 - dl) / 0.4); if (u <= 0) continue;
      const a = [F[i], F[i + 1], F[i + 2]], b = [F[i + 3], F[i + 4], F[i + 5]], hit = F[i + 6], fade = Math.max(0.35, 1 - Math.max(0, t - c.tHit - 1.6) / 2);
      const pa = V.proj(...w(a), Q), pb = V.proj(...w(lerp3(a, b, u)), R); V.line(pa[0], pa[1], pb[0], pb[1], 255, hit ? 214 : 150, hit ? 120 : 60, (hit ? 0.95 : 0.6) * fade, true);
      if (u < 1) V.plot(pb[0], pb[1], 255, 240, 200, 1, true); }
  } finally { tk.x = sv.x; tk.y = sv.y; tk.h = sv.h; tk.ty = sv.ty; tk.update(); }
  V.present(); text(P, c, reveal);
}
// pass 0: miolo (módulos e tripulantes) opaco; pass 1: blindagem e peças de fora contadas como camadas de vidro na frente do miolo
function splat(V, tk, g, T, c, pass, reveal, pulse) {
  const R = T.R, o = T.o, pv = T.p, cam = V.cam, S = cam.S, s = Math.max(1, Math.ceil(0.1 * S * 1.08)), hs = s / 2, sv = Math.max(1, Math.ceil(0.1 * S * (SA + CA) * 1.02)), hv = sv / 2, W = V.W, H = V.H;
  const MOD = tk.MOD, zb = V.zb, u32 = V.u32, ac = V.ac, as = V.as, L0 = LIGHT[0], L1 = LIGHT[1], L2 = LIGHT[2];
  for (let a = 0; a < g.list.length; a++) { const idx = g.list[a], mat = g.mat[idx]; if (!mat) continue;
    const m = mat === 2 ? MOD[g.mod[idx]] : null, core = m && (!m.ext || (reveal && c.hit.has(m.id)));
    if ((pass === 0) !== !!core) continue;
    const lx = g.cx[a] - pv[0], ly = g.cy[a] - pv[1], lz = g.cz[a] - pv[2];
    const wx = o[0] + R[0] * lx + R[1] * ly + R[2] * lz, wy = o[1] + R[3] * lx + R[4] * ly + R[5] * lz, wz = o[2] + R[6] * lx + R[7] * ly + R[8] * lz;
    const X = wx - cam.x, Y = wy - cam.y, sx = W / 2 + X * S, sy = H / 2 - (Y * SA + wz * CA) * S, dd = Y * CA - wz * SA;
    if (sx < -s || sy < -s || sx > W + s || sy > H + s) continue;
    const nx = g.lnx[idx], ny = g.lny[idx], nz = g.lnz[idx], wnx = R[0] * nx + R[1] * ny + R[2] * nz, wny = R[3] * nx + R[4] * ny + R[5] * nz, wnz = R[6] * nx + R[7] * ny + R[8] * nz;
    const sh = 0.55 + 0.55 * Math.max(0, wnx * L0 + wny * L1 + wnz * L2) + 0.08 * wnz;
    const x0 = (sx - hs) | 0, y0 = (sy - hv) | 0;
    if (pass === 1) { for (let yy = y0; yy < y0 + sv; yy++) { if (yy < 0 || yy >= H) continue; const row = yy * W; for (let xx = x0; xx < x0 + s; xx++) { if (xx < 0 || xx >= W) continue; const p = row + xx;
        if (dd < zb[p] && ac[p] < 250) { ac[p]++; as[p] += sh; } } } continue; }
    let col;
    if (m.kind === 'crew') { const killed = reveal && c.crew.has(m.id); col = killed ? [235, 70, 50] : m.dead && !c.crew.has(m.id) ? [92, 92, 92] : m.dead ? [70, 190, 210] : [70, 190, 210];
      if (killed) col = mixc(col, [255, 255, 255], pulse * 0.5); }
    else if (reveal && c.hit.has(m.id)) { const dead = c.hit.get(m.id); col = dead ? [228, 62, 44] : [236, 192, 64]; col = mixc(col, [255, 255, 255], pulse * 0.45); }
    else { const cc = CAT[m.kind].c; col = m.dead ? [70, 52, 48] : [cc[0] * 0.5 + 30, cc[1] * 0.5 + 30, cc[2] * 0.5 + 30]; }
    const r = Math.min(255, col[0] * sh), gg = Math.min(255, col[1] * sh), b = Math.min(255, col[2] * sh), pc = pack(r, gg, b);
    for (let yy = y0; yy < y0 + sv; yy++) { if (yy < 0 || yy >= H) continue; const row = yy * W; for (let xx = x0; xx < x0 + s; xx++) { if (xx < 0 || xx >= W) continue; const p = row + xx;
      if (dd < zb[p]) { zb[p] = dd; u32[p] = pc; } } } } }
const mixc = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
// junta as camadas de blindagem: cada camada clareia um pouco (vidro fosco); a borda do casco ganha um contorno claro
function xray(V) { const W = V.W, H = V.H, u = V.u32, ac = V.ac, as = V.as;
  for (let p = 0; p < W * H; p++) { const n = ac[p]; if (!n) continue; const a = 1 - Math.pow(0.74, Math.min(n, 6)), k = as[p] / n, c = u[p];
    const ar = 128 * k, ag = 140 * k, ab = 150 * k;
    u[p] = pack((c & 255) * (1 - a) + ar * a, ((c >> 8) & 255) * (1 - a) + ag * a, ((c >> 16) & 255) * (1 - a) + ab * a); }
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const p = y * W + x; if (!ac[p]) continue;
    if (!ac[p - 1] || !ac[p + 1] || !ac[p - W] || !ac[p + W]) { const c = u[p]; u[p] = pack(((c & 255) + 200) / 2, (((c >> 8) & 255) + 212) / 2, (((c >> 16) & 255) + 220) / 2); } } }

function skull(ctx, x, y, sc, col) { ctx.fillStyle = 'rgba(0,0,0,.8)'; for (let j = 0; j < 7; j++) for (let i = 0; i < 7; i++) if (SKULL[j][i] === 'X') ctx.fillRect(x + i * sc - 1, y + j * sc - 1, sc + 2, sc + 2);
  ctx.fillStyle = col; for (let j = 0; j < 7; j++) for (let i = 0; i < 7; i++) if (SKULL[j][i] === 'X') ctx.fillRect(x + i * sc, y + j * sc, sc, sc); }
function text(P, c, reveal) { const ctx = P.V.ctx, d = c.d, w = P.V.cw, sm = c.which === 'in', t = c.t;
  ctx.save(); ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.85)';
  const head = sm ? 'FOMOS ATINGIDOS' : SIM.TANKS[c.tank.key].short.toUpperCase();
  ctx.font = '600 ' + (sm ? 11 : 12) + 'px "Barlow Condensed", sans-serif'; ctx.fillStyle = sm ? '#ffb3a3' : '#c9ccc0'; ctx.strokeText(head, 8, 6); ctx.fillText(head, 8, 6);
  if (t >= c.tHit) { const [lab, col] = RES[d.res] || [String(d.res).toUpperCase(), '#ddd'], a = Math.min(1, (t - c.tHit) / 0.15);
    ctx.globalAlpha = a; ctx.font = (sm ? 16 : 22) + 'px "Saira Stencil One", Impact, sans-serif'; ctx.fillStyle = col; ctx.strokeText(lab, 8, sm ? 19 : 21); ctx.fillText(lab, 8, sm ? 19 : 21);
    ctx.font = '500 ' + (sm ? 11 : 12.5) + 'px "Barlow Condensed", sans-serif'; ctx.fillStyle = '#e4e6dc';
    const l1 = d.ammo + (d.plate ? ' · ' + d.plate : ''), l2 = d.eff ? (sm ? 'Pen ' + d.pen + ' mm · efetiva ' + d.eff + ' mm · ' + d.dist + ' m' : 'Pen ' + d.pen + ' mm · efetiva ' + d.eff + ' mm (' + Math.round(d.t) + ' mm a ' + d.ang + '°) · ' + d.dist + ' m') : d.dist + ' m';
    ctx.strokeText(l1, 8, sm ? 37 : 46); ctx.fillText(l1, 8, sm ? 37 : 46);
    ctx.font = '500 ' + (sm ? 10.5 : 12) + 'px "Barlow Condensed", sans-serif'; ctx.fillStyle = '#b9c0b4'; ctx.strokeText(l2, 8, sm ? 50 : 62); ctx.fillText(l2, 8, sm ? 50 : 62); ctx.globalAlpha = 1; }
  if (reveal) { const MOD = c.tank.MOD, H = P.V.ch, a = Math.min(1, (t - c.tHit - 0.25) / 0.3); ctx.globalAlpha = a; let y = H - 8;
    const dead = [], dmg = []; for (const [id, dd] of c.hit) { const m = MOD[id]; if (!m || m.kind === 'crew') continue; (dd ? dead : dmg).push(short(m.name)); }
    ctx.font = '500 ' + (sm ? 10.5 : 12) + 'px "Barlow Condensed", sans-serif'; ctx.textBaseline = 'bottom';
    const line = (txt, col) => { if (!txt) return; ctx.fillStyle = col; ctx.strokeText(txt, 8, y); ctx.fillText(txt, 8, y); y -= sm ? 13 : 15; };
    const nl = sm ? 3 : 4; line(dmg.slice(0, nl).join(', ') + (dmg.length > nl ? '…' : ''), '#ecc040');
    line(dead.slice(0, nl).join(', ') + (dead.length > nl ? '…' : ''), '#ff6a50');
    if (c.crew.size) { const names = [...c.crew].map(id => MOD[id] ? MOD[id].name : '?'), sc = sm ? 1 : 2, x0 = 8, yy = y - 7 * sc;
      let x = x0; for (const n of names) { skull(ctx, x, yy, sc, '#f2efe6'); ctx.fillStyle = '#f2efe6'; ctx.textBaseline = 'top'; ctx.strokeText(n, x + 7 * sc + 4, yy - 1); ctx.fillText(n, x + 7 * sc + 4, yy - 1); x += 7 * sc + 10 + ctx.measureText(n).width; if (x > w - 60) { x = x0; } } }
    ctx.globalAlpha = 1; }
  ctx.restore(); }
function short(n) { return n.replace(/^Munição /, 'Mun. ').replace(/^Combustível /, 'Comb. ').replace(/ do casco$/, '').replace(/^Redução final /, 'Redução ').slice(0, 22); }

return { init, show, hide, replay, frame, unpack, skull };
})();
