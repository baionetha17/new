// Uma partida: o servidor é o único que move tanques, voa projéteis e calcula dano.
(() => {
const SIM = self.SIM, MAP = self.MAPGEN, { think } = self.BOT;

const TICK = 1 / 30, D2R = Math.PI / 180, G = 9.81;
const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const approach = (v, t, d) => v < t ? Math.min(t, v + d) : Math.max(t, v - d);
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const MODES = { dm: 'Mata-mata', dom: 'Dominação', tdm: 'Mata-mata infinito' };

class Match {
  constructor(room, send) {
    this.room = room; this.send = send;
    this.map = MAP.generate(room.seed, room.map, true);
    this.mode = room.mode; this.limit = room.time * 60; this.killGoal = room.kills;
    this.t = 0; this.tick = 0; this.ev = []; this.ents = []; this.shells = []; this.nextEnt = 1; this.nextShell = 1;
    this.score = [0, 0]; this.zone = { prog: 0, owner: -1 }; this.over = false; this.craters = []; this.fires = []; this.settleQ = new Set();
    const perTeam = [0, 0];
    this.slots = room.tanks.map(rt => ({ id: rt.id, team: rt.team, type: rt.type, bot: rt.bot, driver: rt.driver, gunner: rt.gunner,
      ammo: rt.ammo.slice(), spawnI: perTeam[rt.team]++ % 4, ent: null, respawnAt: -1,
      stats: { shots: 0, hits: 0, pens: 0, kills: 0, crew: 0, deaths: 0 } }));
    for (const s of this.slots) this.spawn(s);
  }
  // ---------------------------------------------------------------- entrada
  slotOf(pid) { return this.slots.find(s => s.driver === pid || s.gunner === pid); }
  input(pid, m) {
    const s = this.slotOf(pid); if (!s || !s.ent) return; const e = s.ent, I = e.inp, role = this.role(s, pid);
    if (role !== 'gunner') { I.thr = Math.sign(+m.thr || 0); I.steer = Math.sign(+m.steer || 0); }
    if (role !== 'driver') {
      if (Array.isArray(m.aim) && m.aim.length === 3 && m.aim.every(Number.isFinite)) I.aim = m.aim;
      if (Number.isInteger(m.fire) && m.fire !== I.fireN) { if (I.fireN !== undefined) I.fire = true; I.fireN = m.fire; }
      if (Number.isInteger(m.sel) && m.sel >= 0 && m.sel < e.tank.game.ammo.length) I.sel = m.sel; }
    if (Number.isInteger(m.rep) && m.rep !== I.repN) { if (I.repN !== undefined) I.repair = true; I.repN = m.rep; }
  }
  // quem está sozinho no tanque (o outro posto vazio) controla tudo
  role(s, pid) { const d = s.driver === pid || !s.driver, g = s.gunner === pid || !s.gunner; return d && g ? 'both' : d ? 'driver' : 'gunner'; }
  leave(pid) { for (const s of this.slots) { if (s.driver === pid) s.driver = null; if (s.gunner === pid) s.gunner = null; } }
  // ---------------------------------------------------------------- nascer
  spawn(s) {
    const id = this.nextEnt++, tk = new SIM.Tank(s.type, id), sp = this.map.spawns[s.team][s.spawnI];
    tk.x = sp[0] + (Math.random() - 0.5) * 4; tk.y = sp[1]; tk.h = s.team === 0 ? Math.PI / 2 : -Math.PI / 2; tk.update();
    // se o ponto estiver ocupado por outro tanque ou destroço, procura do lado
    for (let k = 0; k < 12 && this.blocked({ id, tank: tk }, tk.x, tk.y, tk.h); k++) tk.x += (k % 2 ? -1 : 1) * (k + 1) * 4;
    tk.update();
    tk.out = this.ev;
    const e = { id, slot: s, team: s.team, tank: tk, v: 0, loaded: null, reload: 0, sel: 0, ammo: s.ammo.slice(), reveal: 0, visTo: [false, false],
      inp: { thr: 0, steer: 0, aim: null, fire: false, sel: 0, repair: false }, deadKey: '', bot: null, spawnT: this.t };
    e.inp.aim = [tk.x + Math.cos(tk.h) * 50, tk.y + Math.sin(tk.h) * 50, 1];
    // munição nos racks: enche do último a ser usado para o primeiro
    let n = e.ammo.reduce((a, b) => a + b, 0);
    for (let i = tk.game.racks.length - 1; i >= 0; i--) { const r = tk.mk[tk.game.racks[i]]; r.count = Math.min(r.cap, n); n -= r.count; }
    const first = e.ammo.findIndex(c => c > 0); if (first >= 0) { this.takeRound(e, first); e.sel = first; e.inp.sel = first; }
    tk.onDestroyed = cause => this.onDestroyed(e, cause);
    s.ent = e; this.ents.push(e);
    this.ev.push(['spawn', id, s.type, s.team, r2(tk.x), r2(tk.y), r3(tk.h), s.id]);
    return e;
  }
  takeRound(e, type) { e.ammo[type]--; e.loaded = type; const tk = e.tank; for (const k of tk.game.racks) { const r = tk.mk[k]; if (r.count > 0) { r.count--; break; } } }
  // ---------------------------------------------------------------- passo da simulação
  step() {
    const dt = TICK; this.t += dt; this.tick++;
    for (const e of this.ents) {
      const tk = e.tank;
      if (!tk.destroyed) {
        if (e.slot.bot && e.slot.ent === e) think(this, e, dt);
        this.drive(e, dt); this.turret(e, dt); this.gun(e, dt);
        if (e.inp.repair) { e.inp.repair = false; tk.startRepair(); }
        tk.updateCrew(dt); tk.updRepair(dt, Math.abs(e.v) > 0.3 || e.inp.thr !== 0);
        if (e.reveal > 0) e.reveal -= dt;
      }
      tk.updFires(dt); tk.update(); tk.flush();
      const dk = tk.deadMods().join(','); if (dk !== e.deadKey) { e.deadKey = dk; this.ev.push(['md', e.id, tk.deadMods()]); }
    }
    for (const s of this.shells) this.stepShell(s, dt);
    this.stepFires(dt);
    if (this.tick % 6 === 0) this.settleAll();
    this.shells = this.shells.filter(s => s.alive);
    if (this.tick % 5 === 0) this.visibility();
    this.rules(dt);
    this.broadcast();
  }
  // ---------------------------------------------------------------- mobilidade
  drive(e, dt) {
    const tk = e.tank, g = tk.game, I = e.inp, ds = tk.driveState();
    let thr = I.thr, st = I.steer; if (ds.both || tk.repair && tk.repair.kind === 'fix') { thr = 0; st = 0; }
    const eng = tk.mk.engine; let pw = eng.hp < eng.max * 0.5 ? 0.55 : 1;
    if ((tk.mk.radiator && tk.mk.radiator.dead) || (tk.mk.clutch && tk.mk.clutch.dead) || (tk.mk.fans && tk.mk.fans.dead)) pw *= 0.75;
    pw *= this.slowAt(tk.x, tk.y, tk.h, g); if (e.rub) pw *= 0.55;
    let nx = tk.x, ny = tk.y, nh = tk.h;
    if (ds.L || ds.R) {
      e.v = approach(e.v, 0, 5 * dt);
      if (!(ds.L && ds.R) && (thr || st)) {
        const side = ds.L ? 1 : -1, dir = thr !== 0 ? Math.sign(thr) : Math.sign(st) * side;
        const dh = dir * side * g.turn * D2R * 0.45 * pw * dt;
        const px = tk.x - Math.sin(tk.h) * side * (g.wid / 2 - 0.2), py = tk.y + Math.cos(tk.h) * side * (g.wid / 2 - 0.2);
        const c = Math.cos(dh), s = Math.sin(dh), dx = tk.x - px, dy = tk.y - py;
        nx = px + c * dx - s * dy; ny = py + s * dx + c * dy; nh = tk.h + dh;
      }
    } else {
      const target = thr > 0 ? g.vmax * pw : thr < 0 ? -g.vrev : 0;
      const braking = thr === 0 || (e.v !== 0 && Math.sign(target) !== Math.sign(e.v));
      e.v = approach(e.v, target, (braking ? g.acc * 2.5 : g.acc * pw) * dt);
      const rate = g.turn * D2R * (Math.abs(e.v) < 0.5 ? 0.6 : 1 - 0.4 * Math.abs(e.v) / g.vmax) * pw;
      nh = tk.h + st * rate * dt; nx = tk.x + Math.cos(nh) * e.v * dt; ny = tk.y + Math.sin(nh) * e.v * dt;
    }
    if (nx === tk.x && ny === tk.y && nh === tk.h) return;
    // dentro de casa: parede de alvenaria só cede bem devagar, madeira e móveis um pouco mais rápido
    { const pr = this.pressing(e, nx, ny, nh); if (pr) { const cap = pr[0] > 6 ? 0.35 : pr[1] > 6 ? 1.1 : 1e9, sp = Math.abs(e.v);
      if (sp > cap) { const k = cap / sp; nx = tk.x + (nx - tk.x) * k; ny = tk.y + (ny - tk.y) * k; nh = tk.h + wrap(nh - tk.h) * Math.max(k, 0.3); e.v *= k; } } }
    if (this.blocked(e, nx, ny, nh)) {
      if (!this.blocked(e, tk.x, tk.y, nh)) { nx = tk.x; ny = tk.y; } else { nx = tk.x; ny = tk.y; nh = tk.h; }
      e.v *= -0.2;
    }
    this.crush(e, nx, ny, nh);
    tk.x = nx; tk.y = ny; tk.h = wrap(nh);
  }
  blocked(e, x, y, h) {
    const g = e.tank.game, hl = g.len / 2, hw = g.wid / 2, H = MAP.HALF - 3;
    if (Math.abs(x) > H || Math.abs(y) > H) return true;
    for (const id of MAP.propsAlong(this.map, x - 4, y - 4, x + 4, y + 4)) { const pr = this.map.props[id]; if (!pr.block || pr.collapsed) continue;
      if (MAP.obbHitsBox(x, y, h, hl, hw, pr.foot)) return true; }
    for (const o of this.ents) { if (o === e || o.id === e.id) continue; const t = o.tank; if (Math.hypot(t.x - x, t.y - y) > 8) continue;
      if (obbOverlap(x, y, h, hl, hw, t.x, t.y, t.h, t.game.len / 2, t.game.wid / 2)) return true; }
    return false;
  }
  // o que da casa está dentro da caixa do tanque: [alvenaria, resto], e se está passando por cima de entulho
  pressing(e, x, y, h) { const g = e.tank.game, hl = g.len / 2 + 0.05, hw = g.wid / 2; let a = 0, b = 0, c = 0, any = false;
    for (const id of MAP.propsAlong(this.map, x - 5, y - 5, x + 5, y + 5)) { const pr = this.map.props[id]; if (!pr.struct || pr.gone || !MAP.obbHitsBox(x, y, h, hl, hw, pr.foot)) continue;
      const n = MAP.push(pr, x, y, h, hl, hw, true); a += n[0]; b += n[1]; c += n[2]; any = true; }
    e.rub = c > 60; return any && (a || b) ? [a, b] : null; }
  // entulho e cratera deixam o tanque mais lento
  slowAt(x, y, h, g) { let f = 1;
    for (const c of this.craters) { const dx = x - c[0], dy = y - c[1]; if (dx * dx + dy * dy < c[2] * c[2]) { f = 0.6; break; } }
    for (const id of MAP.propsAlong(this.map, x - 4, y - 4, x + 4, y + 4)) { const pr = this.map.props[id]; if (!pr.rubble) continue;
      if (MAP.obbHitsBox(x, y, h, g.len / 2, g.wid / 2, pr.foot)) { f = Math.min(f, 0.4); break; } }
    return f; }
  crush(e, x, y, h) {
    const g = e.tank.game, hl = r2(g.len / 2 + 0.15), hw = r2(g.wid / 2 + 0.1), xq = r2(x), yq = r2(y), hq = r3(h);
    for (const id of MAP.propsAlong(this.map, x - 5, y - 5, x + 5, y + 5)) { const pr = this.map.props[id]; if (!(pr.crush || pr.struct) || pr.gone) continue;
      if (!MAP.obbHitsBox(x, y, h, hl, hw, pr.foot)) continue;
      if (pr.struct) { const hl2 = r2(g.len / 2 + 0.05), hw2 = r2(g.wid / 2), rem = MAP.push(pr, xq, yq, hq, hl2, hw2);
        if (rem.length) { this.ev.push(['pp', pr.id, xq, yq, hq, hl2, hw2]); this.settleQ.add(pr); } continue; }
      if ((pr.kind === 'tree' || pr.kind === 'pole') && !pr.fallen) { this.fellProp(pr, Math.cos(h), Math.sin(h)); e.v *= pr.kind === 'pole' ? 0.95 : 0.7; continue; }
      const zlo = pr.rubble ? MAP.RUBBLE_Z : 0, rem = MAP.crushBox(pr, xq, yq, hq, hl, hw, zlo, 2.6);
      if (rem.length) { this.ev.push(['pq', pr.id, xq, yq, hq, hl, hw, zlo]); e.v *= pr.kind === 'sand' || pr.kind === 'cart' ? 0.88 : 0.95; }
    }
  }
  fellProp(pr, dx, dy) { if (pr.gone || pr.fallen) return; const dir = MAP.fallDir(dx, dy); if (pr.fire) this.putOut(pr); MAP.fell(this.map, pr, dir); this.ev.push(['pd', pr.id, dir]); }
  turret(e, dt) {
    const tk = e.tank, g = tk.game, a = e.inp.aim;
    if (!a || tk.turretOff || !tk.hasSeat('gunner') || tk.mk.ring.dead) return;
    const want = Math.atan2(a[1] - tk.TT.o[1], a[0] - tk.TT.o[0]) - tk.h, diff = wrap(want - tk.ty);
    let rate = g.trav * D2R * dt; if (tk.seat.gunner !== g.seats.gunner) rate *= 0.8; if ((tk.mk.dkw && tk.mk.dkw.dead) || (tk.mk.aux && tk.mk.aux.dead)) rate *= 0.5;
    tk.ty = wrap(tk.ty + Math.max(-rate, Math.min(rate, diff)));
  }
  gun(e, dt) {
    const tk = e.tank, g = tk.game, I = e.inp, mk = tk.mk;
    if (I.sel !== e.sel) { e.sel = I.sel; if (e.loaded !== null && e.loaded !== e.sel && e.ammo[e.sel] > 0) { e.ammo[e.loaded]++; for (const k of g.racks) { const r = mk[k]; if (r.count < r.cap && !r.dead) { r.count++; break; } } e.loaded = null; e.reload = 0; } }
    const gunOk = !g.gunMods.some(k => mk[k].dead) && !tk.turretOff;
    if (e.loaded === null && gunOk && e.ammo.some(c => c > 0)) {
      const mul = tk.hasSeat('loader') ? (tk.seat.loader === g.seats.loader ? 1 : 1.25) : 2.2;
      e.reloadT = g.reload * mul; e.reload += dt / e.reloadT;
      if (e.reload >= 1) { const type = e.ammo[e.sel] > 0 ? e.sel : e.ammo.findIndex(c => c > 0); this.takeRound(e, type); e.reload = 0; }
    }
    if (I.fire) { I.fire = false; if (e.loaded !== null && gunOk && tk.hasSeat('gunner')) this.fire(e); }
  }
  // ---------------------------------------------------------------- tiro
  fire(e) {
    const tk = e.tank, g = tk.game, A = SIM.ammoObj(tk.TK, e.loaded), B = tk.TK.barrel;
    tk.update();
    const mz = SIM.toW(tk.TT, [B.x1 + 0.05, 0, B.z], [0, 0, 0]);
    let yaw = tk.h + tk.ty; const a = e.inp.aim || [mz[0] + Math.cos(yaw) * 100, mz[1] + Math.sin(yaw) * 100, 0];
    const dx = a[0] - mz[0], dy = a[1] - mz[1], d = Math.max(10, Math.min(1500, dx * Math.cos(yaw) + dy * Math.sin(yaw)));
    let el = SIM.elevFor(A.v, d, (a[2] || 0) - mz[2]); el = Math.max(g.elev[0] * D2R, Math.min(g.elev[1] * D2R, el));
    let disp = g.disp * (tk.mk[g.sightMod] && tk.mk[g.sightMod].dead ? 2.5 : 1) + g.moveDisp * Math.min(1, Math.abs(e.v) / g.vmax) + (tk.seat.gunner !== g.seats.gunner ? 0.0008 : 0);
    el += gauss() * disp; yaw += gauss() * disp;
    const vel = [Math.cos(el) * Math.cos(yaw) * A.v, Math.cos(el) * Math.sin(yaw) * A.v, Math.sin(el) * A.v];
    const s = { id: this.nextShell++, ent: e, A, pos: mz, vel, dist: 0, loss: 0, done: new Set(), alive: true };
    this.shells.push(s); e.loaded = null; e.reload = 0; e.reveal = 3; e.slot.stats.shots++;
    this.ev.push(['shot', s.id, e.id, r2(mz[0]), r2(mz[1]), r2(mz[2]), r2(vel[0]), r2(vel[1]), r2(vel[2]), A.t]);
  }
  stepShell(s, dt) {
    let rem = dt;
    while (rem > 1e-6 && s.alive) {
      const sp = Math.hypot(s.vel[0], s.vel[1], s.vel[2]), h = Math.min(rem, 3 / sp);
      const p0 = s.pos; s.vel[2] -= G * h; const p1 = [p0[0] + s.vel[0] * h, p0[1] + s.vel[1] * h, p0[2] + s.vel[2] * h];
      this.trace(s, p0, p1); if (!s.alive) return;
      s.pos = p1; s.dist += sp * h; rem -= h;
      if (s.dist > 2600 || Math.abs(p1[0]) > MAP.HALF + 60 || Math.abs(p1[1]) > MAP.HALF + 60) this.endShell(s, p1);
    }
  }
  trace(s, p0, p1) {
    const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], L = Math.hypot(d[0], d[1], d[2]); if (L < 1e-9) return;
    const dn = [d[0] / L, d[1] / L, d[2] / L], C = [];
    if (p1[2] < 0) C.push({ t: L * p0[2] / (p0[2] - p1[2]), k: 'g' });
    for (const e of this.ents) { if (s.done.has(e.id) || (e === s.ent && s.dist < 25)) continue;
      const tk = e.tank, ox = p0[0] - tk.x, oy = p0[1] - tk.y, oz = p0[2] - 1.3, R = 4.2;
      const b = ox * dn[0] + oy * dn[1] + oz * dn[2], c = ox * ox + oy * oy + oz * oz - R * R, disc = b * b - c; if (disc < 0) continue;
      const sq = Math.sqrt(disc), t0 = -b - sq, t1 = -b + sq; if (t0 > L || t1 < 0) continue; C.push({ t: Math.max(0, t0), k: 't', e }); }
    for (const id of MAP.propsAlong(this.map, p0[0], p0[1], p1[0], p1[1])) { const pr = this.map.props[id]; if (pr.gone || s.done.has('p' + id)) continue;
      const hit = MAP.rayBox(p0, dn, pr.bb, pr.bb[4]); if (!hit || hit[0] > L) continue; C.push({ t: hit[0], k: 'p', pr, t1: hit[1] }); }
    C.sort((a, b) => a.t - b.t);
    for (const c of C) {
      const at = [p0[0] + dn[0] * c.t, p0[1] + dn[1] * c.t, p0[2] + dn[2] * c.t];
      if (c.k === 'g') { this.groundImpact(s, at); return; }
      if (c.k === 't') { s.done.add(c.e.id);
        const tk = c.e.tank, was = tk.destroyed; tk.out = this.ev; tk.lastHitBy = s.ent.slot;
        const pen = Math.max(1, SIM.penAt(s.A.def, s.dist + c.t) - s.loss);
        const rep = tk.castShot([at[0] - dn[0] * 0.3, at[1] - dn[1] * 0.3, at[2] - dn[2] * 0.3], dn, s.A, pen, false, 9);
        if (rep.res !== 'miss' || rep.ground) {
          if (rep.res !== 'miss') this.afterHit(s, c.e, rep, was);
          if (rep.blast) this.propBlast(rep.blast, s.A);
          if (rep.ground && rep.res === 'miss') this.groundImpact(s, rep.end); else this.endShell(s, rep.end);
          return; }
        continue; }
      if (c.k === 'p') { s.done.add('p' + c.pr.id); if (this.throughProp(s, c.pr, p0, dn, c.t, c.t1)) return; }
    }
  }
  afterHit(s, target, rep, wasDestroyed) {
    const st = s.ent.slot.stats; if (!wasDestroyed && target.team !== s.ent.team) { st.hits++; if (rep.res === 'pen') st.pens++; st.crew += rep.crew.length; }
    this.ev.push(['hi', s.ent.id, target.id, rep.res, rep.plate || '', Math.round(rep.eff), Math.round(rep.pen), rep.crew, rep.mods.slice(0, 5), s.A.name]);
  }
  endShell(s, p) { if (!s.alive) return; s.alive = false; this.ev.push(['sh', s.id, r2(p[0]), r2(p[1]), r2(Math.max(0, p[2]))]); }
  groundImpact(s, p) {
    const A = s.A, big = A.t === 'HE' || A.fill > 300;
    const cr = r2(0.3 + A.cal / 300 + (big ? 0.5 : 0)); if (big) this.craters.push([p[0], p[1], cr * 1.2]);
    this.ev.push(['cr', r2(p[0]), r2(p[1]), cr, big ? 1 : 0], ['du', r2(p[0]), r2(p[1]), 0.1, big ? 30 : 18]);
    if (big) { this.ev.push(['fb', r2(p[0]), r2(p[1]), 0.2, r2(0.3 + A.fill / 1800), 0]);
      for (const e of this.ents) { const tk = e.tank; if (Math.hypot(tk.x - p[0], tk.y - p[1]) > 6) continue; const was = tk.destroyed; tk.lastHitBy = s.ent.slot;
        const rep = { mods: [], crew: [], res: null }; tk.heBlast([p[0], p[1], 0.15], A, [0, 0, 1], rep); if (rep.mods.length || rep.crew.length) this.afterHit(s, e, Object.assign(rep, { res: rep.res || 'non', plate: 'Explosão perto', eff: 0, pen: 0 }), was); }
      this.propBlast([p[0], p[1], 0.2], A); }
    this.endShell(s, p);
  }
  // atravessa um objeto do mapa voxel por voxel; devolve true se o projétil parou.
  // O furo é feito em bolinhas ao longo do caminho; o servidor manda só os pontos e cada navegador fura igual.
  throughProp(s, pr, p0, dn, t0, t1) {
    const A = s.A, p = [0, 0, 0], RT = r3(0.2 + A.cal / 700), RL = r3(0.14 + A.cal / 900), RW = r3(Math.min(0.12, RT)), PT = [], PL = [], PW = [];
    let last = -1, stopAt = null, pen = Math.max(0, SIM.penAt(A.def, s.dist + t0) - s.loss);
    const hole = (list, r) => { const q = [r2(p[0]), r2(p[1]), r2(p[2])], n = list.length;
      if (n && Math.abs(list[n - 3] - q[0]) + Math.abs(list[n - 2] - q[1]) + Math.abs(list[n - 1] - q[2]) < r * 0.6) return; list.push(q[0], q[1], q[2]); MAP.tunnel(pr, r, q); };
    for (let t = t0; t <= Math.min(t1, t0 + 40); t += 0.05) {
      p[0] = p0[0] + dn[0] * t; p[1] = p0[1] + dn[1] * t; p[2] = p0[2] + dn[2] * t; if (p[2] < 0) break;
      const idx = MAP.propAt(pr, p[0], p[1], p[2]); if (idx < 0 || idx === last) continue; last = idx; const m = pr.mat[idx]; if (!m) continue;
      // vidro: a janela inteira estilhaça e o projétil segue
      if (m === MAP.MAT.GLASS) { this.breakGlass(pr, MAP.winAt(pr, p[0], p[1], p[2], 0.7)); pen -= MAP.RES[m]; s.loss += MAP.RES[m]; continue; }
      if (MAP.SOFT[m]) { hole(PL, RL); pen -= MAP.RES[m]; s.loss += MAP.RES[m]; if (pen <= 0) { stopAt = p.slice(); break; } continue; }
      if (A.t === 'HE' || A.t === 'HEAT') { stopAt = p.slice(); break; }
      // tronco: o perfurante só fura (quem derruba árvore é a explosão)
      if (m === MAP.MAT.TRUNK && !pr.fallen) { hole(PW, RW); pen -= MAP.RES[m]; s.loss += MAP.RES[m]; this.ev.push(['sp', r2(p[0]), r2(p[1]), r2(p[2]), -r2(dn[0]), -r2(dn[1]), 0.3, 6, 0.6]); if (pen <= 0) { stopAt = p.slice(); break; } continue; }
      hole(PT, RT); pen -= MAP.RES[m]; s.loss += MAP.RES[m];
      if (pen <= 0) { stopAt = p.slice(); break; }
    }
    if (PL.length) this.ev.push(['pt', pr.id, RL, PL]);
    if (PW.length) this.ev.push(['pt', pr.id, RW, PW]);
    if (PT.length) this.ev.push(['pt', pr.id, RT, PT]);
    if (stopAt) {
      this.ev.push(['du', r2(stopAt[0]), r2(stopAt[1]), r2(stopAt[2]), 16], ['sp', r2(stopAt[0]), r2(stopAt[1]), r2(stopAt[2]), -r2(dn[0]), -r2(dn[1]), -r2(dn[2]), 18, 1]);
      if (A.t === 'HE' || A.fill > 300) { this.ev.push(['fb', r2(stopAt[0]), r2(stopAt[1]), r2(stopAt[2]), r2(0.3 + A.fill / 1800), 0]); this.propBlast(stopAt, A); }
      this.checkCollapse(pr); this.endShell(s, stopAt); return true; }
    this.checkCollapse(pr); return false;
  }
  propBlast(p, A, big) {
    const r = r3(big ? 2.6 : A.t === 'HE' ? 0.7 + Math.cbrt(A.fill) / 9 : A.fill > 300 ? 0.6 : 0); if (!r) return;
    const q = [r2(p[0]), r2(p[1]), r2(p[2])], fire = big || A.t === 'HE' || A.fill > 300;
    for (const id of MAP.propsAlong(this.map, p[0] - r - 1, p[1] - r - 1, p[0] + r + 1, p[1] + r + 1)) { const pr = this.map.props[id]; if (pr.gone) continue; const b = pr.bb;
      if (p[0] < b[0] - r || p[0] > b[2] + r || p[1] < b[1] - r || p[1] > b[3] + r || p[2] > b[4] + r) continue;
      // a explosão perto do tronco derruba árvore e poste
      if ((pr.kind === 'tree' || pr.kind === 'pole') && !pr.fallen && Math.hypot(pr.cx - p[0], pr.cy - p[1]) < r + 0.8 && p[2] < (pr.kind === 'pole' ? 7 : 4)) {
        this.fellProp(pr, pr.cx - p[0] || 1, pr.cy - p[1]); continue; }
      if (pr.win) for (let w = 0; w < pr.win.length; w++) { const W = pr.win[w], c = W.c; if (!W.broken && (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2 < (r * 2.2 + 1.6) ** 2) this.breakGlass(pr, w); }
      const rem = MAP.tunnel(pr, r, q); if (rem.length) { this.ev.push(['pt', pr.id, r, q]); this.checkCollapse(pr); }
      if (fire && !pr.fire && !pr.gone) this.maybeIgnite(pr, q, r); } }
  // ---------------------------------------------------------------- fogo no cenário
  maybeIgnite(pr, q, r) {
    if (!MAP.flammableNear(pr, q[0], q[1], q[2], r + 0.6)) return;
    const chance = { hay: 0.9, barn: 0.8, house: 0.6, cart: 0.5, fence: 0.35, tree: 0.3, hedge: 0.25 }[pr.kind] || 0.2; if (Math.random() > chance) return;
    const maxR = { hay: 2.6, house: 8, barn: 9, tree: 3.8, hedge: 3, cart: 2.5 }[pr.kind] || 2.2;
    pr.fire = { x: q[0], y: q[1], z: q[2], r: 0.5, maxR, t: 0, next: 0.6, idle: 0, life: 22 + Math.random() * 12, seed: (Math.random() * 1e6) | 0, n: 0 };
    this.fires.push(pr); this.ev.push(['pi', pr.id, q[0], q[1], q[2]]); }
  stepFires(dt) {
    for (const pr of this.fires) { const f = pr.fire; if (!f) continue; f.t += dt; if (f.t < f.next) continue; f.next += 1;
      f.r = Math.min(f.maxR, r2(f.r + 0.5)); const seed = (f.seed + f.n++) | 0;
      const rem = MAP.burn(pr, f.x, f.y, f.z, f.r, seed); this.ev.push(['pb', pr.id, f.x, f.y, f.z, f.r, seed]);
      if (!rem.length && f.r >= f.maxR) f.idle++;
      this.checkCollapse(pr);
      if (f.t > f.life || f.idle >= 3) this.putOut(pr); }
    this.fires = this.fires.filter(pr => pr.fire); }
  putOut(pr) { if (!pr.fire) return; pr.fire = null; this.ev.push(['pf', pr.id]); }
  // casa: o que perdeu apoio cai (a conta é feita aos poucos, juntando os estragos de alguns ticks)
  checkCollapse(pr) { if (pr.struct) this.settleQ.add(pr); }
  settleAll() { for (const pr of this.settleQ) if (MAP.settle(pr)) this.ev.push(['ps', pr.id]);
    this.settleQ.clear(); }
  breakGlass(pr, w) { if (w < 0 || !MAP.shatter(pr, w).length) return; this.ev.push(['pg', pr.id, w]); }
  // ---------------------------------------------------------------- visão
  visibility() {
    for (const e of this.ents) e.visTo = [e.team === 0 || e.tank.destroyed, e.team === 1 || e.tank.destroyed];
    for (const team of [0, 1]) {
      const obs = this.ents.filter(o => o.team === team && !o.tank.destroyed);
      for (const e of this.ents) { if (e.team === team || e.tank.destroyed) continue; const tk = e.tank; let vis = false;
        for (const o of obs) { const ot = o.tank, d = Math.hypot(ot.x - tk.x, ot.y - tk.y);
          if (d < 35 || (e.reveal > 0 && d < 800)) { vis = true; break; }
          const view = ot.game.view * (ot.hasSeat('commander') ? 1 : 0.65); if (d > view) continue;
          const eye = [ot.x, ot.y, 2.7];
          if (MAP.los(this.map, eye, [tk.x, tk.y, 2.2]) < 1 || MAP.los(this.map, eye, [tk.x, tk.y, 1.0]) < 1) { vis = true; break; } }
        e.visTo[team] = vis; }
    }
  }
  // ---------------------------------------------------------------- regras dos modos
  onDestroyed(e, cause) {
    const s = e.slot; s.stats.deaths++;
    if (cause === 'ammo') { const tk = e.tank; this.craters.push([tk.x, tk.y, 3.5]); this.ev.push(['cr', r2(tk.x), r2(tk.y), 2.6, 1]); this.propBlast([tk.x, tk.y, 1], null, true); }
    const killer = e.tank.lastHitBy && e.tank.lastHitBy.team !== e.team ? e.tank.lastHitBy : null;
    if (killer) killer.stats.kills++;
    const other = 1 - e.team;
    if (this.mode === 'tdm') this.score[other]++;
    if (this.mode === 'dom') this.score[other] += 10;
    if (this.mode !== 'dm' && s.ent === e) s.respawnAt = this.t + (this.mode === 'dom' ? 10 : 8);
    this.ev.push(['kill', killer && killer.ent ? killer.ent.id : 0, e.id, cause, killer ? killer.id : 0, s.id]);
  }
  rules(dt) {
    for (const s of this.slots) if (s.respawnAt >= 0 && this.t >= s.respawnAt) { s.respawnAt = -1; this.spawn(s); }
    const alive = [0, 0]; for (const s of this.slots) if (s.ent && !s.ent.tank.destroyed) alive[s.team]++;
    if (this.mode === 'dom') {
      const z = this.map.zone, inZ = [0, 0];
      for (const s of this.slots) { const e = s.ent; if (!e || e.tank.destroyed) continue; if (Math.hypot(e.tank.x - z.x, e.tank.y - z.y) < z.r) inZ[e.team]++; }
      const Z = this.zone, rate = 100 / 15 * dt;
      if (inZ[0] && !inZ[1]) Z.prog = Math.max(-100, Z.prog - rate * Math.min(2, inZ[0]));
      else if (inZ[1] && !inZ[0]) Z.prog = Math.min(100, Z.prog + rate * Math.min(2, inZ[1]));
      if (Z.prog <= -100) Z.owner = 0; else if (Z.prog >= 100) Z.owner = 1; else if (Z.owner === 0 && Z.prog > 0 || Z.owner === 1 && Z.prog < 0) Z.owner = -1;
      if (Z.owner >= 0) this.score[Z.owner] += dt;
      if (this.score[0] >= 100 || this.score[1] >= 100) return this.end(this.score[0] >= 100 ? 0 : 1);
    }
    if (this.mode === 'tdm' && (this.score[0] >= this.killGoal || this.score[1] >= this.killGoal)) return this.end(this.score[0] >= this.killGoal ? 0 : 1);
    if (this.mode === 'dm') {
      const teams = [0, 1].filter(t => this.slots.some(s => s.team === t));
      if (teams.length === 2 && this.t > 2) { if (!alive[0] && !alive[1]) return this.end(-1); if (!alive[0]) return this.end(1); if (!alive[1]) return this.end(0); }
      if (teams.length === 1 && !alive[teams[0]] && this.t > 2) return this.end(-1);
    }
    if (this.t >= this.limit) {
      if (this.mode === 'dm') { const crew = [0, 0]; for (const s of this.slots) if (s.ent && !s.ent.tank.destroyed) crew[s.team] += s.ent.tank.crewAlive();
        return this.end(crew[0] > crew[1] ? 0 : crew[1] > crew[0] ? 1 : -1); }
      return this.end(this.score[0] > this.score[1] ? 0 : this.score[1] > this.score[0] ? 1 : -1);
    }
  }
  end(winner) { if (this.over) return; this.over = true; this.winner = winner; this.broadcast(); if (this.onEnd) this.onEnd(this.results()); }
  results() {
    return { mode: this.mode, modeName: MODES[this.mode], winner: this.winner, score: this.score.map(v => Math.floor(v)), time: Math.round(this.t),
      tanks: this.slots.map(s => ({ id: s.id, team: s.team, type: s.type, bot: s.bot, driver: s.driver, gunner: s.gunner, stats: s.stats,
        alive: !!(s.ent && !s.ent.tank.destroyed) })) };
  }
  // ---------------------------------------------------------------- envio
  meState(e, pid) {
    const tk = e.tank, g = tk.game, s = e.slot, mk = tk.mk;
    const crew = []; for (const seat of ['commander', 'gunner', 'loader', 'driver', 'radio']) { const k = tk.seat[seat]; crew.push([seat, k ? mk[k].name : '', k && !mk[k].dead ? 1 : 0]); }
    const orig = Object.entries(g.seats).map(([seat, k]) => [seat, mk[k].name, mk[k].dead ? 0 : 1]);
    const show = ['engine', 'trans', g.driveBoth.includes('diff') ? 'diff' : 'fdL', 'trackL', 'trackR', 'wheelsL', 'wheelsR', 'breech', 'barrel', 'ring', 'sight', 'radio'].filter(k => mk[k]);
    if (g.driveL.includes('fdL')) show.splice(3, 0, 'fdR');
    return { id: e.id, role: this.role(s, pid),
      crew, orig, moving: tk.moving ? [tk.moving.to, Math.round(tk.moving.t / tk.moving.T * 100) / 100] : null,
      mods: show.map(k => [k, mk[k].name, Math.round(100 * mk[k].hp / mk[k].max), mk[k].dead ? 1 : 0]),
      ammo: e.ammo, loaded: e.loaded, reload: r2(e.reload), reloadT: r2(e.reloadT || g.reload), sel: e.sel,
      rep: tk.repair ? [tk.repair.kind, r2(tk.repair.t / tk.repair.T)] : null, fires: tk.fires.length, v: r2(e.v),
      dead: tk.destroyed ? 1 : 0, respawn: s.respawnAt >= 0 ? Math.max(0, Math.ceil(s.respawnAt - this.t)) : -1,
      view: Math.round(g.view * (tk.hasSeat('commander') ? 1 : 0.65)) };
  }
  broadcast() {
    const ev = this.ev; this.ev = []; for (const e of this.ents) e.tank.out = this.ev;
    const gs = { t: Math.max(0, Math.ceil(this.limit - this.t)), sc: this.score.map(v => Math.floor(v)), z: [Math.round(this.zone.prog), this.zone.owner], over: this.over ? 1 : 0, w: this.winner };
    const byTeam = [null, null];
    for (const team of [0, 1]) byTeam[team] = this.ents.filter(e => e.visTo[team] || e.team === team).map(e => { const tk = e.tank, ds = tk.driveState();
      let f = 0; if (tk.destroyed) f |= 1; if (tk.boom) f |= 2; for (const fi of tk.fires) f |= fi.boom ? 16 : fi.comp === 'fight' ? 4 : 8; if (tk.repair) f |= 32; if (ds.L || ds.R) f |= 64;
      return [e.id, r2(tk.x), r2(tk.y), r3(tk.h), r3(tk.ty), r2(e.v), f]; });
    for (const pid of this.room.players) {
      const s = this.slotOf(pid), team = s ? s.team : 0;
      const msg = { t: 's', T: r2(this.t), k: byTeam[team], g: gs, ev };
      if (s && s.ent) msg.me = this.meState(s.ent, pid);
      this.send(pid, msg);
    }
  }
}

function obbOverlap(ax, ay, ah, al, aw, bx, by, bh, bl, bw) {
  const A = corners(ax, ay, ah, al, aw), B = corners(bx, by, bh, bl, bw);
  for (const h of [ah, ah + Math.PI / 2, bh, bh + Math.PI / 2]) { const c = Math.cos(h), s = Math.sin(h); let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
    for (const p of A) { const d = p[0] * c + p[1] * s; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
    for (const p of B) { const d = p[0] * c + p[1] * s; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
    if (a1 < b0 || b1 < a0) return false; }
  return true;
}
function corners(x, y, h, l, w) { const c = Math.cos(h), s = Math.sin(h); return [[l, w], [l, -w], [-l, w], [-l, -w]].map(([u, v]) => [x + c * u - s * v, y + s * u + c * v]); }

self.MATCH = { Match, MODES, TICK };
})();
