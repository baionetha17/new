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
    slots: Object.fromEntries(msg.tanks.map(t => [t.id, t])), me: null, myEnt: null, g: null, shells: new Map(), tracers: [], heat: new Set(),
    mouse: { x: 0, y: 0, in: false }, keys: {}, rmb: false, camOff: [0, 0], fireN: 0, repN: 0, sel: 0, aim: [0, 0, 0], hover: null, hoverT: 0,
    offset: null, lastSnap: 0, feed: [], shake: 0, paused: false, spec: null, last: performance.now(), hudT: 0, mmT: 0, reloadLocal: 0, seenAt: new Map(), loadedPrev: null };
  st.view.cam.S = 64 / 6.6;
  st.mm = buildMinimapBase(M, T);
  $('#hudMode').textContent = msg.modeName + ' · ' + MAPGEN.THEMES[msg.map].short;
  $('#feed').innerHTML = ''; $('#centerMsg').hidden = true; $('#pause').hidden = true; $('#analysis').hidden = true;
  bindInput(cv);
  clearInterval(inTimer); inTimer = setInterval(sendInput, 33);
  cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
}
function stop() { clearInterval(inTimer); cancelAnimationFrame(raf); unbindInput(); AUDIO.engine(false, 0); st = null; }

// ================================================================ rede
function onSnap(m) {
  if (!st) return;
  const now = performance.now() / 1000;
  const off = m.T - now; st.offset = st.offset === null ? off : Math.max(off, st.offset + (off - st.offset) * 0.02);
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
  if (m.me) { const prev = st.me; st.me = m.me; st.myEnt = m.me.id;
    if (prev && prev.loaded === null && m.me.loaded !== null) AUDIO.reload();
    st.reloadLocal = m.me.reload; if (prev && prev.id !== m.me.id) { st.camOff = [0, 0]; } }
}
function tankOf(id) { return st.tanks.get(id); }
function myTank() { return st.myEnt ? st.tanks.get(st.myEnt) : null; }
function distTo(p) { const c = st.view.cam; return Math.hypot(p[0] - c.x, p[1] - c.y); }
function handleEv(e) {
  const V = st.view, T = st.T, M = st.M;
  switch (e[0]) {
    case 'spawn': { const [, id, type, team, x, y, h, slot] = e; const tk = new SIM.Tank(type, id); tk.x = x; tk.y = y; tk.h = h; tk.update();
      const ct = { id, type, team, slot, tk, ci: st.ciNext++ % 200, snaps: [{ t: 0, x, y, h, ty: 0, v: 0 }], vis: true, x, y, h, ty: 0, v: 0, f: 0, trail: [x, y], smoke: 0 };
      st.byCi[ct.ci] = ct; st.tanks.set(id, ct); break; }
    case 'sp': V.sparks([e[1], e[2], e[3]], [e[4], e[5], e[6]], e[7], e[8]); break;
    case 'db': { const ct = tankOf(e[7]); if (!ct) break; const g = ct.tk.grid(e[8]), i = e[9]; V.debris([e[1], e[2], e[3]], [e[4], e[5], e[6]], [g.cr[i], g.cg[i], g.cb[i]], e[10]); break; }
    case 'du': V.dust([e[1], e[2], e[3]], e[4]); break;
    case 'fb': { const p = [e[1], e[2], e[3]]; V.fireball(p, e[4], e[5]); AUDIO.boom(distTo(p), e[4] > 0.5); if (distTo(p) < 25) st.shake = Math.max(st.shake, 0.5); break; }
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
      for (let i = 0; i < 260; i++) { const a = Math.random() * Math.PI * 2, u = Math.random(); V.particles.push({ k: 3, x: c[0], y: c[1], z: c[2] + 0.4, vx: Math.cos(a) * u * 7, vy: Math.sin(a) * u * 7, vz: 4 + Math.random() * 12, life: 5 + Math.random() * 8, col: Math.random() < 0.5 ? [60, 62, 64] : [40, 36, 32], sz: 1 }); }
      AUDIO.boom(distTo(c), true); RENDER.stampScorch(T, ct.x, ct.y, 5); break; }
    case 'rs': { const ct = tankOf(e[1]); if (ct) ct.tk.restoreTrack(e[2]); break; }
    case 'md': { const ct = tankOf(e[1]); if (ct) ct.tk.setDead(e[2]); break; }
    case 'shot': { const [, sid, eid, x, y, z, vx, vy, vz, kind] = e; const sp = Math.hypot(vx, vy, vz);
      st.shells.set(sid, { pos: [x, y, z], prev: [x, y, z], vel: [vx, vy, vz], t: 0, kind, from: eid });
      V.muzzle([x, y, z], [vx / sp, vy / sp, vz / sp]); AUDIO.cannon(distTo([x, y])); if (eid === st.myEnt) st.shake = Math.max(st.shake, 0.35); break; }
    case 'sh': { const s = st.shells.get(e[1]); if (s) { s.end = [e[2], e[3], e[4]]; s.endT = 0.06; } break; }
    case 'cr': RENDER.stampCrater(T, e[1], e[2], e[3]); AUDIO.thud(distTo([e[1], e[2]])); break;
    case 'pr': { const pr = M.props[e[1]]; if (!pr) break; const P = [0, 0, 0]; let n = 0;
      for (const idx of e[2]) { if (!pr.mat[idx]) continue; MAPGEN.propCenter(pr, idx, P); const col = [pr.cr[idx], pr.cg[idx], pr.cb[idx]];
        if (e[3]) { RENDER.paint(T, P[0] + (Math.random() - .5) * 0.6, P[1] + (Math.random() - .5) * 0.6, col.map(v => v * 0.8), 0.7); if (Math.random() < 0.08) V.chunk(P.slice(), col, 0.6, 2.5); }
        else if (n++ < 40 || Math.random() < 0.15) V.chunk(P.slice(), col, 1.2, 2.5);
        pr.mat[idx] = 0; }
      if (e[3] && Math.random() < 0.3) AUDIO.crunch(distTo(P));
      RENDER.shadeProp(pr); RENDER.reshadow(T, pr); break; }
    case 'pd': { const pr = M.props[e[1]]; if (!pr || pr.gone) break; const P = [0, 0, 0], dx = e[2], dy = e[3], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
      for (let a = 0; a < pr.list.length; a++) { const idx = pr.list[a]; if (!pr.mat[idx]) continue; MAPGEN.propCenter(pr, idx, P); const col = [pr.cr[idx], pr.cg[idx], pr.cb[idx]];
        // a árvore deita na direção do empurrão: cada voxel cai a uma distância igual à sua altura
        const fx = pr.cx + ux * P[2] + (P[0] - pr.cx) * 0.8, fy = pr.cy + uy * P[2] + (P[1] - pr.cy) * 0.8;
        if ((a & 1) === 0) RENDER.paint(T, fx, fy, col.map(v => v * 0.85), pr.mat[idx] === 2 ? 0.9 : 0.55);
        if (a % 9 === 0) V.particles.push({ k: 3, x: P[0], y: P[1], z: P[2], vx: ux * P[2] * 0.9 + (Math.random() - .5), vy: uy * P[2] * 0.9 + (Math.random() - .5), vz: 0.5, life: 1.2 + Math.random(), col, sz: 2.5 });
        pr.mat[idx] = 0; }
      pr.gone = true; V.dust([pr.cx + ux * 3, pr.cy + uy * 3, 0.3], 14, [110, 120, 80]); AUDIO.crunch(distTo([pr.cx, pr.cy])); RENDER.reshadow(T, pr); break; }
    case 'pc': { const pr = M.props[e[1]]; if (!pr) break; pr.collapsed = true; const P = [0, 0, 0];
      for (let a = 0; a < pr.list.length; a++) { const idx = pr.list[a]; if (!pr.mat[idx]) continue; MAPGEN.propCenter(pr, idx, P); if (P[2] <= 1.1) continue; const col = [pr.cr[idx], pr.cg[idx], pr.cb[idx]];
        RENDER.paint(T, P[0] + (Math.random() - .5) * 2.5, P[1] + (Math.random() - .5) * 2.5, col.map(v => v * 0.8), 0.6);
        if (a % 14 === 0) V.chunk(P.slice(), col, 1.4, 2.5); pr.mat[idx] = 0; }
      for (let i = 0; i < 6; i++) V.dust([pr.cx + (Math.random() - .5) * 6, pr.cy + (Math.random() - .5) * 6, 0.5], 12, [150, 140, 120]);
      AUDIO.boom(distTo([pr.cx, pr.cy]), false); RENDER.shadeProp(pr); RENDER.reshadow(T, pr); break; }
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
function slotName(id) { const s = st.slots[id]; if (!s) return '?'; if (s.bot) return 'IA (' + SIM.TANKS[s.type].short + ')';
  const n = [s.driver, s.gunner].filter((v, i, a) => v && a.indexOf(v) === i).map(p => st.names[p] || '?'); return n.join(' + ') || SIM.TANKS[s.type].short; }
function feed(text, cls) { const el = document.createElement('div'); el.className = 'f ' + (cls || ''); el.textContent = text; const box = $('#feed'); box.prepend(el); while (box.children.length > 6) box.lastChild.remove(); setTimeout(() => el.classList.add('old'), 6000); setTimeout(() => el.remove(), 9000); }
let centerT = 0;
function showCenter(text, dur) { const el = $('#centerMsg'); el.textContent = text; el.hidden = false; centerT = dur || 2.5; }

// ================================================================ entrada
const handlers = {};
function bindInput(cv) {
  handlers.kd = e => { if (!st) return; if (e.target.tagName === 'INPUT') return; const k = e.key.toLowerCase(); AUDIO.init();
    if (k === 'escape') { togglePause(); e.preventDefault(); return; }
    if (st.paused) return;
    st.keys[k] = true;
    if (k >= '1' && k <= '5') { const i = +k - 1; const tk = myTank(); if (tk && i < tk.tk.game.ammo.length) st.sel = i; }
    if (k === 'r') st.repN++;
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
function zoomLimits() { const V = st.view; return [Math.max(0.7, Math.max(V.W, V.H / RENDER.SA) / (2 * ZOOM_MAX_M)), 42]; }
function zoom(f) { const [a, b] = zoomLimits(); st.view.cam.S = clamp(st.view.cam.S * f, a, b); }
function sendInput() { if (!st || !net) return; const k = st.keys, p = st.paused;
  const thr = p ? 0 : (k.w || k.arrowup ? 1 : 0) - (k.s || k.arrowdown ? 1 : 0), steer = p ? 0 : (k.a || k.arrowleft ? 1 : 0) - (k.d || k.arrowright ? 1 : 0);
  net({ t: 'input', thr, steer, aim: st.aim.map(v => Math.round(v * 100) / 100), fire: st.fireN, sel: st.sel, rep: st.repN }); }
function togglePause(force) { st.paused = force !== undefined ? force : !st.paused; $('#pause').hidden = !st.paused; }
function cycleSpec() { const me = myTank(); if (me && !(me.f & 1)) { st.spec = null; return; }
  const list = [...st.tanks.values()].filter(c => c.team === st.team && !(c.f & 1) && c.vis); if (!list.length) { st.spec = null; return; }
  const i = list.findIndex(c => c.id === st.spec); st.spec = list[(i + 1) % list.length].id; }
function quit() { net({ t: 'quit' }); const fn = onExit; stop(); if (fn) fn(); }

// ================================================================ quadro
function frame(nowMs) {
  if (!st) return; raf = requestAnimationFrame(frame);
  const dt = Math.min(0.05, (nowMs - st.last) / 1000); st.last = nowMs;
  const V = st.view; V.resize();
  const now = nowMs / 1000, rt = st.offset === null ? 0 : now + st.offset - 0.1;
  // poses interpoladas
  for (const ct of st.tanks.values()) {
    const S = ct.snaps; let a = S[0], b = S[S.length - 1];
    if (S.length > 1) { for (let i = S.length - 1; i > 0; i--) if (S[i - 1].t <= rt) { a = S[i - 1]; b = S[i]; break; } }
    const u = b.t > a.t ? clamp((rt - a.t) / (b.t - a.t), 0, 1) : 1;
    const x = lerp(a.x, b.x, u), y = lerp(a.y, b.y, u), h = lerpA(a.h, b.h, u), ty = lerpA(a.ty, b.ty, u);
    const tk = ct.tk; tk.x = x; tk.y = y; tk.h = h; if (!tk.turretFly) tk.ty = ty; tk.update(); ct.x = x; ct.y = y; ct.h = h;
    if (Math.hypot(x - ct.trail[0], y - ct.trail[1]) > 0.3) { if (Math.hypot(x - ct.trail[0], y - ct.trail[1]) < 4) RENDER.stampTracks(st.T, x, y, h, tk.game.wid); ct.trail = [x, y]; }
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
  const [zmin, zmax] = zoomLimits(); cam.S = clamp(cam.S, zmin, zmax);
  if (st.shake > 0) { st.shake = Math.max(0, st.shake - dt * 1.2); cam.ox = (Math.random() - .5) * st.shake * 0.6; cam.oy = (Math.random() - .5) * st.shake * 0.6; } else { cam.ox = cam.oy = 0; }
  // projéteis
  for (const [id, s] of st.shells) { s.t += dt; s.prev = s.pos.slice();
    if (s.end) { s.endT -= dt; s.pos = s.end; if (s.endT <= 0) st.shells.delete(id); continue; }
    s.vel[2] -= G * dt; for (let a = 0; a < 3; a++) s.pos[a] += s.vel[a] * dt; if (s.pos[2] < 0 || s.t > 6) st.shells.delete(id); }
  // calor das placas atingidas esfria
  for (const key of st.heat) { const [id, gid, i] = key.split(',').map(Number); const ct = tankOf(id); if (!ct) { st.heat.delete(key); continue; } const g = ct.tk.grid(gid); g.heat[i] -= dt * 0.35; if (g.heat[i] <= 0) { g.heat[i] = 0; st.heat.delete(key); } }
  V.updParticles(dt);
  // ---- desenho
  V.ground(st.T);
  if (st.g && st.mode === 'dom') { const z = st.M.zone, o = st.g.z[1]; const col = o === 0 ? [214, 164, 64] : o === 1 ? [111, 168, 220] : [230, 230, 220]; V.groundRing(z.x, z.y, z.r, col, 0.75); V.groundRing(z.x, z.y, z.r - 0.4, col, 0.35); }
  const drawn = [];
  for (const ct of st.tanks.values()) { const show = ct.vis || ct.id === st.myEnt || (ct.f & 1); if (!show || !V.tankOnScreen(ct.tk)) continue; drawn.push(ct); }
  for (const ct of drawn) { V.shadowGrid(ct.tk.GH, ct.tk.TH); V.shadowGrid(ct.tk.GT, ct.tk.TT); }
  V.applyShadow();
  for (const pr of st.M.props) if (!pr.gone) V.splatProp(pr, 512 + pr.id);
  for (const ct of drawn) V.splatTank(ct.tk, ct.ci, ct.id === st.myEnt && cam.S > 20 ? 'cut' : 'ext');
  V.outline();
  drawAntennas(drawn);
  V.drawParticles();
  drawShells(dt);
  V.present();
  // ---- por cima
  updateAim(now);
  overlay(dt, drawn);
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
    if (Math.random() < dt * rate) { const v = toW(tk.TH, [TK.ring[0] + (Math.random() - .5), TK.ring[1] + (Math.random() - .5), TK.ringZ], [0, 0, 0]); V.particles.push({ k: 2, x: v[0], y: v[1], z: v[2], vx: 0, vy: 0, vz: 0.9, life: 5, max: 5, r0: 0.2, r1: 1.4, col: [44, 42, 40] }); } }
}
function drawAntennas(list) { const V = st.view, P = [0, 0, 0], Q = [0, 0, 0];
  for (const ct of list) { const tk = ct.tk, an = tk.TK.antenna; if ((ct.f & 1) && an.on === 'h') continue; if (tk.turretOff && an.on === 't') continue; const T = an.on === 'h' ? tk.TH : tk.TT;
    V.proj(...toW(T, an.a, [0, 0, 0]), P); V.proj(...toW(T, an.b, [0, 0, 0]), Q); V.line(P[0], P[1], Q[0], Q[1], 28, 30, 32, 0.9, false); } }
function drawShells(dt) { const V = st.view, P = [0, 0, 0], Q = [0, 0, 0];
  for (const s of st.shells.values()) { const sp = Math.hypot(s.vel[0], s.vel[1], s.vel[2]) || 1, tail = Math.min(18, sp * 0.03);
    const b = [s.pos[0] - s.vel[0] / sp * tail, s.pos[1] - s.vel[1] / sp * tail, s.pos[2] - s.vel[2] / sp * tail];
    V.proj(...s.pos, P); V.proj(...b, Q); const he = s.kind === 'HE' || s.kind === 'HEAT'; V.line(Q[0], Q[1], P[0], P[1], 255, he ? 170 : 235, he ? 80 : 160, 0.9, true); V.plot(P[0], P[1], 255, 255, 230, 1, true); }
  for (let i = st.tracers.length - 1; i >= 0; i--) { const t = st.tracers[i]; t.t -= dt; if (t.t <= 0) { st.tracers.splice(i, 1); continue; } const a = Math.min(1, t.t * 2);
    for (let k = 1; k < t.pts.length; k++) { V.proj(...t.pts[k - 1], P); V.proj(...t.pts[k], Q); V.line(P[0], P[1], Q[0], Q[1], 255, 235, 160, a, true); } } }

// ================================================================ mira e análise
function aimFromScreen(mx, my) { const V = st.view, x = (mx / V.PX) | 0, y = (my / V.PX) | 0; if (x < 0 || y < 0 || x >= V.W || y >= V.H) return null;
  const id = V.idb[y * V.W + x];
  if (id > 0) { const v = id - 1, code = v >>> 20, idx = v & 0xFFFFF;
    if (code < 512) { const ct = st.byCi[code >> 1]; if (ct) { const g = ct.tk.grid(code & 1); if (g.mat[idx]) return { p: toW(ct.tk.tf(g), gCenter(g, idx, [0, 0, 0]), [0, 0, 0]), ct }; } }
    else { const pr = st.M.props[code - 512]; if (pr && pr.mat[idx]) return { p: MAPGEN.propCenter(pr, idx, [0, 0, 0]), pr }; } }
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
  const rl = $('#reload'); rl.firstElementChild.style.width = (me.loaded !== null ? 100 : Math.round(st.reloadLocal * 100)) + '%';
  rl.lastElementChild.textContent = me.loaded !== null ? 'Carregado: ' + TK.game.ammo[me.loaded].k + ' (' + TK.game.ammo[me.loaded].t + ')' : me.ammo.some(v => v) ? 'Recarregando ' + TK.game.ammo[me.ammo[me.sel] ? me.sel : me.ammo.findIndex(v => v)].t + '…' : 'Sem munição';
  $('#speed').textContent = Math.round(Math.abs(me.v) * 3.6) + ' km/h' + (me.v < -0.2 ? ' ré' : '');
  const rep = $('#repair'); if (me.rep) { rep.hidden = false; rep.lastElementChild.textContent = me.rep[0] === 'fire' ? 'Apagando o fogo' : 'Consertando (fique parado)'; rep.firstElementChild.firstElementChild.style.width = Math.round(me.rep[1] * 100) + '%'; }
  else { rep.hidden = me.dead || !(me.fires || ct.f & 64); if (!rep.hidden) { rep.lastElementChild.textContent = me.fires ? 'INCÊNDIO! Aperte R para apagar' : 'Esteira quebrada: pare e aperte R'; rep.firstElementChild.firstElementChild.style.width = '0'; } }
  const dead = $('#deadBox'); if (me.dead) { dead.hidden = false; dead.textContent = me.respawn > 0 ? 'Volta em ' + me.respawn + ' s' : me.respawn === 0 ? 'Voltando…' : 'Seu tanque foi destruído. Espaço troca a câmera para um aliado.'; } else dead.hidden = true;
}
function shortMod(k, name) { const M = { engine: 'Motor', trans: 'Câmbio', diff: 'Diferencial', fdL: 'Redução esq.', fdR: 'Redução dir.', trackL: 'Esteira esq.', trackR: 'Esteira dir.', wheelsL: 'Rodas esq.', wheelsR: 'Rodas dir.', breech: 'Culatra', barrel: 'Cano', ring: 'Anel da torre', sight: 'Mira', radio: 'Rádio' }; return M[k] || name; }

// ================================================================ minimapa
function buildMinimapBase(M, T) { const N = 200, c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d'), img = x.createImageData(N, N), d = new Uint32Array(img.data.buffer);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const tx = Math.floor(i / N * T.w), ty = Math.floor((N - 1 - j) / N * T.h); d[j * N + i] = T.base[ty * T.w + tx]; }
  x.putImageData(img, 0, 0);
  for (const pr of M.props) { const b = pr.bb, s = N / M.size, X = (b[0] + M.half) * s, Y = N - (b[3] + M.half) * s, w = Math.max(1, (b[2] - b[0]) * s), h = Math.max(1, (b[3] - b[1]) * s);
    x.fillStyle = pr.kind === 'house' ? '#4a3c34' : pr.kind === 'tree' ? 'rgba(40,70,36,.85)' : pr.kind === 'hedge' ? 'rgba(46,80,40,.8)' : 'rgba(90,84,70,.8)'; x.fillRect(X, Y, w, h); }
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

return { start, stop, onSnap, quit, togglePause, get active() { return !!st; }, get state() { return st; } };
})();
