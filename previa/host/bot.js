(() => {
// IA simples para testar sozinho: avança, para a uns 200 m, deixa o casco angulado e atira.
const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

function think(M, e, dt) {
  const tk = e.tank, I = e.inp;
  const B = e.bot || (e.bot = { t: 0, chk: 0, lx: tk.x, ly: tk.y, rev: 0, err: [0, 0], errT: 0, fireT: 1 + Math.random() * 2, goal: null, side: Math.random() < 0.5 ? 1 : -1, last: null });
  B.t += dt; B.errT -= dt; B.fireT -= dt;
  // alvo: o inimigo visível mais perto
  let tgt = null, best = 1e9;
  for (const o of M.ents) { if (o.team === e.team || o.tank.destroyed || !o.visTo[e.team]) continue; const d = Math.hypot(o.tank.x - tk.x, o.tank.y - tk.y); if (d < best) { best = d; tgt = o; } }
  if (tgt) { B.last = [tgt.tank.x, tgt.tank.y]; if (!B.seen) { B.seen = true; B.fireT = Math.max(B.fireT, 2.5 + Math.random() * 2); } } else B.seen = false;
  if (tgt && best > 320) tgt = null;
  const ds = tk.driveState();
  // fogo ou peça quebrada: conserta quando der
  if ((tk.fires.length || ((ds.L || ds.R) && !tgt) || (ds.L && ds.R)) && !tk.repair) { I.repair = true; }
  let gx, gy, stop = false, angleTo = null;
  if (tgt && best < 260) { stop = true; angleTo = Math.atan2(tgt.tank.y - tk.y, tgt.tank.x - tk.x) + B.side * 0.5; }
  else if (tgt) { gx = tgt.tank.x; gy = tgt.tank.y; }
  else if (M.mode === 'dom') { gx = M.map.zone.x + B.side * 12; gy = M.map.zone.y; }
  else if (B.last) { gx = B.last[0]; gy = B.last[1]; if (Math.hypot(gx - tk.x, gy - tk.y) < 15) B.last = null; }
  else { if (!B.goal || Math.hypot(B.goal[0] - tk.x, B.goal[1] - tk.y) < 20) B.goal = [(Math.random() - 0.5) * 300, (e.team === 0 ? 1 : -1) * (40 + Math.random() * 140)]; gx = B.goal[0]; gy = B.goal[1]; }
  let thr = 0, st = 0;
  const want = angleTo !== null ? angleTo : Math.atan2(gy - tk.y, gx - tk.x), diff = wrap(want - tk.h);
  if (Math.abs(diff) > 0.06) st = Math.sign(diff);
  if (!stop) thr = Math.abs(diff) < 1.0 ? 1 : 0;
  // preso: dá ré girando
  B.chk += dt;
  if (B.chk > 2) { const moved = Math.hypot(tk.x - B.lx, tk.y - B.ly); if (thr > 0 && moved < 1.5) B.rev = 1.6; B.chk = 0; B.lx = tk.x; B.ly = tk.y; }
  if (B.rev > 0) { B.rev -= dt; thr = -1; st = B.side; }
  if (tk.repair) { thr = 0; st = 0; }
  I.thr = thr; I.steer = st;
  // mira com um erro que muda de tempos em tempos
  if (tgt) {
    if (B.errT <= 0) { const s = 2.5 * (1 + best / 100); B.err = [(Math.random() - 0.5) * s, (Math.random() - 0.5) * s]; B.errT = 1.5; }
    I.aim = [tgt.tank.x + B.err[0], tgt.tank.y + B.err[1], 1.5];
    const yaw = tk.h + tk.ty, aimYaw = Math.atan2(I.aim[1] - tk.TT.o[1], I.aim[0] - tk.TT.o[0]);
    if (e.loaded !== null && Math.abs(wrap(aimYaw - yaw)) < 0.02 && B.fireT <= 0 && Math.abs(e.v) < 1.5) { I.fire = true; B.fireT = 1.5 + Math.random() * 2.5; }
  } else {
    I.aim = [tk.x + Math.cos(tk.h) * 60, tk.y + Math.sin(tk.h) * 60, 0];
  }
}

self.BOT = { think };
})();
