// Servidor do jogo rodando num Web Worker no navegador de quem cria a sala.
// O ui.js repassa as mensagens: as do próprio jogador chegam como 'L', as dos amigos chegam pelo PeerJS.
importScripts('../shared/sim.js', '../shared/map.js', 'bot.js', 'match.js');
const { Match, MODES, TICK } = self.MATCH;
const SIM = self.SIM, MAP = self.MAPGEN;

// ---------------------------------------------------------------- jogadores e salas
const players = new Map(), rooms = new Map();
let nextId = 1, nextTank = 1;
const send = (pid, msg) => { const p = players.get(pid); if (p && p.ws.readyState === 1) p.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); };
const cleanName = n => String(n || '').replace(/[<>&"]/g, '').trim().slice(0, 16) || 'Tanquista';
function newCode() { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; let c; do { c = Array.from({ length: 4 }, () => A[(Math.random() * A.length) | 0]).join(''); } while (rooms.has(c)); return c; }
const defAmmo = type => SIM.TANKS[type].game.ammo.map(a => a.def);
const newSeed = () => 10000000 + Math.floor(Math.random() * 89999999);

function roomState(r) {
  return { code: r.code, host: r.host, mode: r.mode, map: r.map, seed: r.seed, time: r.time, kills: r.kills, state: r.match ? 'match' : 'lobby',
    players: r.players.map(id => { const p = players.get(id); return { id, name: p ? p.name : '?', ready: !!(p && p.ready) }; }),
    tanks: r.tanks.map(t => ({ id: t.id, team: t.team, type: t.type, driver: t.driver, gunner: t.gunner, bot: t.bot, ammo: t.ammo })) };
}
const pushRoom = r => { const st = { t: 'room', room: roomState(r) }; for (const id of r.players) send(id, st); };
function roomList() { return [...rooms.values()].map(r => ({ code: r.code, host: (players.get(r.host) || {}).name || '?', n: r.players.length, mode: MODES[r.mode], map: MAP.THEMES[r.map].short, state: r.match ? 'Em partida' : 'Na sala' })); }
function pushLists() { const m = { t: 'rooms', rooms: roomList() }; for (const p of players.values()) if (!p.room) send(p.id, m); }
const err = (pid, msg) => send(pid, { t: 'err', msg });

function unseat(r, pid) { for (const t of r.tanks) { if (t.driver === pid) t.driver = null; if (t.gunner === pid) t.gunner = null; }
  r.tanks = r.tanks.filter(t => t.bot || t.driver || t.gunner); }
function leaveRoom(p) {
  const r = rooms.get(p.room); p.room = null; p.ready = false; if (!r) return;
  r.players = r.players.filter(id => id !== p.id); unseat(r, p.id);
  if (r.match) r.match.leave(p.id);
  if (!r.players.length) { if (r.match) stopMatch(r); rooms.delete(r.code); }
  else { if (r.host === p.id) r.host = r.players[0]; pushRoom(r); }
  pushLists();
}
function startMatch(r) {
  const m = new Match(r, send); r.match = m;
  m.onEnd = res => {
    const names = {}; for (const id of r.players) { const p = players.get(id); if (p) names[id] = p.name; }
    res.names = names;
    setTimeout(() => { for (const id of r.players) { send(id, { t: 'end', res }); const p = players.get(id); if (p) p.ready = false; } stopMatch(r); pushRoom(r); pushLists(); }, 1500);
  };
  for (const id of r.players) {
    const s = m.slotOf(id);
    send(id, { t: 'start', seed: r.seed, map: r.map, mode: r.mode, modeName: MODES[r.mode], time: r.time, kills: r.kills, slot: s ? s.id : null, team: s ? s.team : 0,
      tanks: r.tanks.map(t => ({ id: t.id, team: t.team, type: t.type, driver: t.driver, gunner: t.gunner, bot: t.bot })), names: Object.fromEntries(r.players.map(i => [i, (players.get(i) || {}).name])) });
  }
  let last = Date.now(), acc = 0;
  r.timer = setInterval(() => { const now = Date.now(); acc += Math.min(0.25, (now - last) / 1000); last = now;
    while (acc >= TICK && r.match) { acc -= TICK; try { r.match.step(); } catch (e) { console.log('Erro na partida:', e); } if (r.match && r.match.over) break; } }, 1000 * TICK / 2);
  pushLists();
}
function stopMatch(r) { if (r.timer) clearInterval(r.timer); r.timer = null; r.match = null; }

function handle(p, m) {
  const r = p.room ? rooms.get(p.room) : null;
  switch (m.t) {
    case 'hello': p.name = cleanName(m.name); send(p.id, { t: 'welcome', id: p.id }); send(p.id, { t: 'rooms', rooms: roomList() }); return;
    case 'name': p.name = cleanName(m.name); if (r) pushRoom(r); return;
    case 'list': send(p.id, { t: 'rooms', rooms: roomList() }); return;
    case 'create': {
      // só o próprio dono do navegador cria sala, com o código que o PeerJS já reservou
      if (!p.local) return;
      if (r) leaveRoom(p);
      const code = /^[A-Z]{4}$/.test(m.code) && !rooms.has(m.code) ? m.code : newCode(), nr = { code, host: p.id, players: [p.id], tanks: [], mode: 'dm', map: 'kursk', seed: newSeed(), time: 10, kills: 10, match: null, timer: null };
      rooms.set(code, nr); p.room = code;
      nr.tanks.push({ id: nextTank++, team: 0, type: 'pz4', driver: p.id, gunner: p.id, bot: false, ammo: defAmmo('pz4') });
      pushRoom(nr); pushLists(); return; }
    case 'join': {
      const nr = rooms.get(String(m.code || '').toUpperCase().trim()); if (!nr) return err(p.id, 'Sala não encontrada.');
      if (nr.match) return err(p.id, 'Essa sala está no meio de uma partida. Espere acabar.');
      if (nr.players.length >= 8) return err(p.id, 'Sala cheia.');
      if (r) leaveRoom(p);
      nr.players.push(p.id); p.room = nr.code; p.ready = false;
      const t0 = nr.tanks.filter(t => t.team === 0).length, t1 = nr.tanks.filter(t => t.team === 1).length, team = t1 <= t0 ? 1 : 0;
      if (nr.tanks.length < 8) nr.tanks.push({ id: nextTank++, team, type: team ? 'm4a1' : 'pz4', driver: p.id, gunner: p.id, bot: false, ammo: defAmmo(team ? 'm4a1' : 'pz4') });
      pushRoom(nr); pushLists(); return; }
    case 'leave': if (r) leaveRoom(p); send(p.id, { t: 'rooms', rooms: roomList() }); return;
  }
  if (!r) return;
  const isHost = r.host === p.id, tank = r.tanks.find(t => t.id === m.tank);
  const mine = tank && (tank.driver === p.id || tank.gunner === p.id);
  if (m.t === 'input') { if (r.match) r.match.input(p.id, m); return; }
  if (m.t === 'quit') { if (r.match) { r.match.leave(p.id); send(p.id, { t: 'room', room: roomState(r) }); } return; }
  if (r.match) return;
  switch (m.t) {
    case 'settings': if (!isHost) return;
      if (m.mode in MODES) r.mode = m.mode; if (m.map in MAP.THEMES) r.map = m.map;
      if (Number.isInteger(m.seed) && m.seed > 0 && m.seed < 1e9) r.seed = m.seed; if (m.newSeed) r.seed = newSeed();
      if ([5, 10, 15].includes(m.time)) r.time = m.time; if ([5, 10, 15, 20].includes(m.kills)) r.kills = m.kills; break;
    case 'addTank': { if (r.tanks.length >= 8) return err(p.id, 'Máximo de 8 tanques.'); const team = m.team ? 1 : 0;
      unseat(r, p.id); const type = team ? 'm4a1' : 'pz4'; r.tanks.push({ id: nextTank++, team, type, driver: p.id, gunner: p.id, bot: false, ammo: defAmmo(type) }); break; }
    case 'addBot': { if (!isHost) return; if (r.tanks.length >= 8) return err(p.id, 'Máximo de 8 tanques.'); const team = m.team ? 1 : 0, type = m.type in SIM.TANKS ? m.type : team ? 'm4a1' : 'pz4';
      r.tanks.push({ id: nextTank++, team, type, driver: null, gunner: null, bot: true, ammo: defAmmo(type) }); break; }
    case 'seat': { if (!tank || tank.bot) return; const role = m.role; if (!['both', 'driver', 'gunner'].includes(role)) return;
      const free = x => !x || x === p.id;
      if ((role !== 'gunner' && !free(tank.driver)) || (role !== 'driver' && !free(tank.gunner))) return err(p.id, role === 'both' ? 'Esse tanque já tem tripulação. Escolha um posto livre.' : 'Esse posto já está ocupado.');
      for (const t of r.tanks) { if (t === tank) continue; if (t.driver === p.id) t.driver = null; if (t.gunner === p.id) t.gunner = null; }
      if (role === 'both') tank.driver = tank.gunner = p.id;
      else if (role === 'driver') { tank.driver = p.id; if (tank.gunner === p.id) tank.gunner = null; }
      else { tank.gunner = p.id; if (tank.driver === p.id) tank.driver = null; }
      r.tanks = r.tanks.filter(t => t.bot || t.driver || t.gunner); break; }
    case 'tankSet': { if (!tank || !(mine || (tank.bot && isHost))) return;
      if (m.type in SIM.TANKS && m.type !== tank.type) { tank.type = m.type; tank.ammo = defAmmo(m.type); }
      if (Array.isArray(m.ammo)) { const G = SIM.TANKS[tank.type].game; const a = m.ammo.slice(0, G.ammo.length).map(v => Math.max(0, Math.min(G.cap, v | 0)));
        while (a.length < G.ammo.length) a.push(0); let sum = a.reduce((x, y) => x + y, 0); for (let i = a.length - 1; sum > G.cap && i >= 0; i--) { const cut = Math.min(a[i], sum - G.cap); a[i] -= cut; sum -= cut; }
        tank.ammo = a; }
      if (m.team === 0 || m.team === 1) tank.team = m.team; break; }
    case 'removeTank': { if (!tank || !(isHost || mine)) return; r.tanks = r.tanks.filter(t => t !== tank); break; }
    case 'ready': p.ready = !!m.v; break;
    case 'start': { if (!isHost) return;
      const humans = r.tanks.filter(t => !t.bot); if (!r.tanks.length) return err(p.id, 'Ninguém tem tanque.');
      const unseated = r.players.filter(id => !r.tanks.some(t => t.driver === id || t.gunner === id)).map(id => players.get(id).name);
      if (unseated.length) return err(p.id, 'Sem tanque: ' + unseated.join(', ') + '. Cada jogador precisa ocupar um posto.');
      const notReady = r.players.filter(id => id !== r.host && !players.get(id).ready).map(id => players.get(id).name);
      if (notReady.length) return err(p.id, 'Ainda não estão prontos: ' + notReady.join(', ') + '.');
      for (const t of r.tanks) { const sum = t.ammo.reduce((a, b) => a + b, 0); if (!sum) return err(p.id, 'Um tanque está sem munição. Escolha a munição antes.'); }
      if (!humans.length && !r.tanks.length) return;
      startMatch(r); return; }
    default: return;
  }
  pushRoom(r);
}

self.onmessage = ev => {
  const { k, pid, d } = ev.data;
  if (k === 'open') {
    if (players.has(pid)) return;
    const ws = { readyState: 1, send: txt => postMessage({ pid, d: txt }) };
    players.set(pid, { id: pid, name: 'Tanquista', ws, room: null, ready: false, local: pid === 'L' });
  } else if (k === 'msg') {
    const p = players.get(pid); if (!p) return;
    let m; try { m = JSON.parse(d); } catch { return; } if (!m || typeof m.t !== 'string') return;
    try { handle(p, m); } catch (e) { console.log('Erro:', e); }
  } else if (k === 'close') {
    const p = players.get(pid); if (!p) return;
    p.ws.readyState = 3; if (p.room) leaveRoom(p); players.delete(pid);
  }
};

// pré-monta os modelos dos tanques para a primeira partida não engasgar
for (const k in SIM.TANKS) SIM.getTemplate(k);
