// Telas do jogo (menu, sala, tanque e munição, partida, placar, como jogar) e a conexão com a sala.
(() => {
'use strict';
const $ = s => document.querySelector(s), $$ = s => document.querySelectorAll(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TANKS = SIM.TANKS;
let myId = null, room = null, screen = 'menu', loadTank = null, lastRes = null, toastT = 0;
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };

// ================================================================ conexão
// Não há servidor: quem cria a sala roda o servidor num Web Worker (host/server.js) e os amigos
// se conectam direto no navegador dele pelo WebRTC (PeerJS). Fora de uma sala, a tela fala com o
// servidor local, que fica vazio até alguém criar sala.
const PEER_PREFIX = 'tanque-x1-sala-';
const PEER_OPTS = { debug: 1, config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }] } };
let worker = null, peer = null, remote = null, hostConns = new Map(), nextConn = 1, joining = null;
function startWorker() {
  if (worker) return;
  worker = new Worker('host/server.js');
  worker.onmessage = ev => { const { pid, d } = ev.data;
    if (pid === 'L') { if (!remote) recv(d); return; }
    const c = hostConns.get(pid); if (c && c.open) c.send(d); };
  worker.postMessage({ k: 'open', pid: 'L' });
}
function recv(txt) { let m; try { m = JSON.parse(txt); } catch (e) { return; } onMsg(m); }
function connect() { $('#conn').hidden = true; startWorker(); send({ t: 'hello', name: myName() }); }
function send(m) { const txt = JSON.stringify(m);
  if (remote) { if (remote.open) remote.send(txt); }
  else if (worker) worker.postMessage({ k: 'msg', pid: 'L', d: txt }); }
function dropPeer() { for (const pid of hostConns.keys()) worker.postMessage({ k: 'close', pid }); hostConns.clear(); if (peer) { try { peer.destroy(); } catch (e) {} } peer = null; }
// volta para o servidor local (fora de sala); se estava hospedando, derruba a sala para os amigos
function backToLocal() { if (joining) { clearTimeout(joining); joining = null; }
  const wasRemote = remote; remote = null; dropPeer(); if (wasRemote) send({ t: 'hello', name: myName() }); }
function lostRemote() { if (!remote) return; remote = null; dropPeer(); room = null; if (GAME.active) GAME.stop(); show('menu'); $('#conn').hidden = false; send({ t: 'hello', name: myName() }); }
const newCode = () => { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; return Array.from({ length: 4 }, () => A[(Math.random() * A.length) | 0]).join(''); };
function peerError(e) { const t = e && e.type;
  if (t === 'browser-incompatible') return 'Este navegador não tem WebRTC. Use Chrome, Edge ou Firefox atualizados.';
  if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') return 'Não deu para falar com o servidor de convites (PeerJS). Confira a internet e tente de novo.';
  return 'Erro de conexão: ' + (t || e); }
function hostRoom(tries) {
  backToLocal(); toast('Abrindo a sala…', true);
  const code = newCode(); peer = new Peer(PEER_PREFIX + code, PEER_OPTS); const me = peer;
  me.on('open', () => { if (peer !== me) return; send({ t: 'create', code }); });
  me.on('error', e => { if (peer !== me) return;
    if (e.type === 'unavailable-id' && (tries || 0) < 5) { dropPeer(); hostRoom((tries || 0) + 1); return; }
    if (e.type === 'peer-unavailable') return;
    toast(peerError(e)); });
  // se o servidor de convites cair no meio da partida, quem já entrou continua; só tenta reconectar para aceitar novos
  me.on('disconnected', () => { if (peer === me && !me.destroyed) setTimeout(() => { if (peer === me && !me.destroyed) me.reconnect(); }, 2000); });
  me.on('connection', c => { if (peer !== me) { c.close(); return; }
    const pid = 'r' + nextConn++;
    c.on('open', () => { hostConns.set(pid, c); worker.postMessage({ k: 'open', pid }); });
    c.on('data', d => { if (typeof d === 'string' && d.length < 65536) worker.postMessage({ k: 'msg', pid, d }); });
    const bye = () => { if (!hostConns.has(pid)) return; hostConns.delete(pid); worker.postMessage({ k: 'close', pid }); };
    c.on('close', bye); c.on('error', bye); });
}
function joinRoom(raw) {
  const code = String(raw || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (code.length !== 4) { toast('O código da sala tem 4 letras.'); return; }
  if (room) send({ t: 'leave' }); room = null;
  backToLocal(); toast('Procurando a sala ' + code + '…', true);
  const me = peer = new Peer(PEER_OPTS);
  const fail = msg => { if (peer !== me) return; clearTimeout(joining); joining = null; remote = null; dropPeer(); toast(msg); };
  joining = setTimeout(() => fail('A sala ' + code + ' não respondeu. Confira o código e se quem hospeda está com a aba aberta.'), 15000);
  me.on('error', e => fail(e.type === 'peer-unavailable' ? 'Sala ' + code + ' não encontrada. Confira o código.' : peerError(e)));
  me.on('open', () => { if (peer !== me) return;
    const c = me.connect(PEER_PREFIX + code, { reliable: true, serialization: 'raw' });
    c.on('open', () => { if (peer !== me) return; clearTimeout(joining); joining = null; remote = c;
      send({ t: 'hello', name: myName() }); send({ t: 'join', code }); });
    c.on('data', d => { if (remote === c) recv(typeof d === 'string' ? d : new TextDecoder().decode(d)); });
    c.on('close', () => { if (remote === c) lostRemote(); });
    c.on('error', () => { if (remote === c) lostRemote(); }); });
}
function leaveRoom() { send({ t: 'leave' }); room = null; backToLocal(); show('menu'); }
function myName() { return ($('#name').value || '').trim() || 'Tanquista'; }
function onMsg(m) {
  switch (m.t) {
    case 'welcome': myId = m.id; break;
    case 'rooms': renderRooms(m.rooms); break;
    case 'room': room = m.room; if (screen === 'menu' || screen === 'help') show('room'); if (screen === 'room') renderRoom(); if (screen === 'load') renderLoad(); if (screen === 'game' && !GAME.active) show('room'); break;
    case 'err': toast(m.msg); break;
    case 'start': startGame(m); break;
    case 's': GAME.onSnap(m); break;
    case 'end': endGame(m.res); break;
  }
}
function toast(msg, ok) { const el = $('#toast'); el.textContent = msg; el.className = 'toast' + (ok ? ' ok' : ''); el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, 3800); }
function show(name) { screen = name; for (const s of $$('.screen')) s.hidden = s.id !== 'scr-' + name;
  if (name === 'room') renderRoom(); if (name === 'load') renderLoad(); preview.active = name === 'load' ? 'load' : name === 'menu' ? 'menu' : null; }

// ================================================================ menu
$('#name').value = store.get('tanque.name', '');
$('#name').addEventListener('change', () => { store.set('tanque.name', myName()); send({ t: 'name', name: myName() }); });
$('#btnCreate').onclick = () => { AUDIO.init(); store.set('tanque.name', myName()); send({ t: 'name', name: myName() }); hostRoom(0); };
$('#btnJoin').onclick = () => { AUDIO.init(); store.set('tanque.name', myName()); joinRoom($('#code').value); };
$('#code').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnJoin').click(); });
window.addEventListener('beforeunload', () => { if (room && room.host === myId && !remote) dropPeer(); });
$('#btnHelp').onclick = () => show('help');
$('#btnHelpBack').onclick = () => show(room ? 'room' : 'menu');
$('#btnReconnect').onclick = connect;
function renderRooms(list) { const el = $('#roomList'); if (!el) return;
  if (!list.length) { el.innerHTML = '<p class="note">Nenhuma sala aberta ainda. Crie uma e passe o código para os amigos.</p>'; return; }
  el.innerHTML = list.map(r => `<div class="r"><div><b>${esc(r.code)}</b> <span>${esc(r.host)} · ${r.n} jogador${r.n > 1 ? 'es' : ''} · ${esc(r.mode)} · ${esc(r.map)} · ${esc(r.state)}</span></div><button class="small" data-join="${esc(r.code)}">Entrar</button></div>`).join('');
  for (const b of el.querySelectorAll('[data-join]')) b.onclick = () => { store.set('tanque.name', myName()); send({ t: 'name', name: myName() }); send({ t: 'join', code: b.dataset.join }); }; }
const code = new URLSearchParams(location.search).get('sala'); if (code) $('#code').value = code.toUpperCase();

// ================================================================ sala
const MODE_NOTES = { dm: 'Cada tanque tem uma vida. Vence o time que sobrar. No fim do tempo, vence quem tiver mais tripulantes vivos.',
  dom: 'Fique dentro do círculo no meio do mapa para tomar a zona. Zona tomada rende 1 ponto por segundo e cada abate vale 10. Vence quem fizer 100. Quem morre volta em 10 s.',
  tdm: 'Quem morre volta em 8 s. Vence o time que chegar primeiro ao número de abates.' };
const nameOf = id => { const p = room && room.players.find(p => p.id === id); return p ? p.name : '?'; };
function renderRoom() {
  if (!room) return; const host = room.host === myId; document.body.classList.toggle('is-host', host);
  $('#roomCode').textContent = room.code; $('#roomBusy').hidden = room.state !== 'match';
  for (const [id, v] of [['#setMode', room.mode], ['#setMap', room.map], ['#setTime', room.time], ['#setKills', room.kills]]) { const el = $(id); el.value = String(v); el.disabled = !host; }
  if (document.activeElement !== $('#setSeed')) $('#setSeed').value = room.seed; $('#setSeed').disabled = !host; $('#btnSeed').disabled = !host;
  $('#killsField').hidden = room.mode !== 'tdm'; $('#modeNote').textContent = MODE_NOTES[room.mode];
  $('#hostNote').textContent = host ? 'Você é o anfitrião: só você muda a partida e começa.' : 'Só o anfitrião (' + nameOf(room.host) + ') muda essas opções.';
  for (const team of [0, 1]) {
    const el = $('#team' + team), list = room.tanks.filter(t => t.team === team);
    el.innerHTML = list.length ? list.map(t => tankCard(t, host)).join('') : '<p class="note">Nenhum tanque neste time.</p>'; }
  for (const b of $$('[data-seat]')) b.onclick = () => send({ t: 'seat', tank: +b.dataset.tank, role: b.dataset.seat });
  for (const b of $$('[data-load]')) b.onclick = () => { loadTank = +b.dataset.load; show('load'); };
  for (const b of $$('[data-rm]')) b.onclick = () => send({ t: 'removeTank', tank: +b.dataset.rm });
  for (const b of $$('[data-swap]')) b.onclick = () => { const t = room.tanks.find(x => x.id === +b.dataset.swap); send({ t: 'tankSet', tank: t.id, team: 1 - t.team }); };
  $('#playerList').innerHTML = room.players.map(p => `<div class="plist"><span>${esc(p.name)}${p.id === room.host ? '<span class="host">anfitrião</span>' : ''}${p.id === myId ? ' (você)' : ''}</span><span class="${p.ready || p.id === room.host ? 'ok' : 'wait'}">${p.id === room.host ? '' : p.ready ? 'pronto' : 'esperando'}</span></div>`).join('');
  const me = room.players.find(p => p.id === myId);
  $('#btnReady').hidden = host; $('#btnReady').textContent = me && me.ready ? 'Não estou pronto' : 'Estou pronto';
  const seated = room.tanks.some(t => t.driver === myId || t.gunner === myId);
  $('#startNote').textContent = !seated ? 'Você ainda não está em nenhum tanque. Entre num posto ou crie o seu tanque.' : host ? 'Para testar sozinho, ponha uma IA no outro time.' : 'Quando todos estiverem prontos, o anfitrião começa.';
}
function tankCard(t, host) {
  const TK = TANKS[t.type], mine = t.driver === myId || t.gunner === myId, solo = t.driver && t.driver === t.gunner;
  const seat = (role, label, who) => { const meHere = who === myId; let btn = '';
    if (!t.bot && !who) btn = `<button class="small" data-seat="${role}" data-tank="${t.id}">Entrar</button>`;
    else if (!t.bot && meHere && solo) btn = `<button class="small" data-seat="${role}" data-tank="${t.id}" title="Fica só neste posto e libera o outro para um amigo">Só este posto</button>`;
    return `<div class="seat${meHere ? ' me' : ''}"><small>${label}</small>${t.bot ? 'IA' : who ? esc(nameOf(who)) : '<span class="note">livre</span>'}${btn}</div>`; };
  const canEdit = mine || (t.bot && host), ammo = TK.game.ammo.map((a, i) => a.t + ' ' + t.ammo[i]).join(' · ');
  return `<div class="tcard"><div class="tt"><b>${esc(TK.short)}</b><span>${esc(TK.game.country)} · ${TK.game.year}${t.bot ? ' · IA' : ''}</span></div>
    <div class="seats">${seat('driver', 'Motora (dirige)', t.driver)}${seat('gunner', 'Torre (mira e atira)', t.gunner)}</div>
    <div class="acts">${!t.bot && !mine && !t.driver && !t.gunner ? `<button class="small" data-seat="both" data-tank="${t.id}">Sozinho</button>` : ''}
      ${!t.bot && !solo && mine ? `<button class="small" data-seat="both" data-tank="${t.id}" ${(t.driver && t.driver !== myId) || (t.gunner && t.gunner !== myId) ? 'disabled' : ''}>Os dois postos</button>` : ''}
      ${canEdit ? `<button class="small primary" data-load="${t.id}">Tanque e munição</button><button class="small" data-swap="${t.id}">Trocar de time</button>` : ''}
      ${host || (mine && solo) ? `<button class="small" data-rm="${t.id}">Remover</button>` : ''}</div>
    <div class="ammoline">${ammo}</div></div>`; }
$('#setMode').onchange = e => send({ t: 'settings', mode: e.target.value });
$('#setMap').onchange = e => send({ t: 'settings', map: e.target.value });
$('#setTime').onchange = e => send({ t: 'settings', time: +e.target.value });
$('#setKills').onchange = e => send({ t: 'settings', kills: +e.target.value });
$('#setSeed').onchange = e => send({ t: 'settings', seed: Math.round(+e.target.value) });
$('#btnSeed').onclick = () => send({ t: 'settings', newSeed: true });
for (const b of $$('[data-add]')) b.onclick = () => send({ t: 'addTank', team: +b.dataset.add });
for (const b of $$('[data-bot]')) b.onclick = () => send({ t: 'addBot', team: +b.dataset.bot });
$('#btnReady').onclick = () => { const me = room.players.find(p => p.id === myId); send({ t: 'ready', v: !(me && me.ready) }); };
$('#btnStart').onclick = () => { AUDIO.init(); send({ t: 'start' }); };
$('#btnLeave').onclick = leaveRoom;
$('#btnCopy').onclick = () => { const url = location.origin + location.pathname + '?sala=' + room.code; const txt = 'Bora de tanque! Abre ' + url + ' e entra na sala ' + room.code;
  (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast('Convite copiado: ' + url, true), () => toast('Endereço: ' + url, true)); };

// ================================================================ tanque e munição
let draft = null;
function renderLoad() {
  const t = room && room.tanks.find(x => x.id === loadTank); if (!t) { show('room'); return; }
  if (!draft || draft.id !== t.id) draft = { id: t.id, type: t.type, ammo: t.ammo.slice() };
  const TK = TANKS[draft.type], G = TK.game;
  $('#loadTitle').textContent = TK.short + (t.bot ? ' (IA)' : '');
  $('#tankPick').innerHTML = Object.values(TANKS).map(k => `<button data-type="${k.key}" aria-pressed="${k.key === draft.type}"><b>${esc(k.short)}</b><span>${esc(k.game.country)} · ${k.game.year} · ${esc(k.game.gun)}</span></button>`).join('');
  for (const b of $$('#tankPick [data-type]')) b.onclick = () => { if (b.dataset.type === draft.type) return; draft.type = b.dataset.type; draft.ammo = TANKS[draft.type].game.ammo.map(a => a.def); preview.setTank(draft.type); renderLoad(); };
  const pl = TK.plates;
  const st = [['Velocidade', Math.round(G.vmax * 3.6) + ' km/h'], ['Ré', Math.round(G.vrev * 3.6) + ' km/h'], ['Giro da torre', G.trav + '°/s'],
    ['Recarga', G.reload.toFixed(1).replace('.', ',') + ' s'], ['Peso / motor', G.weight.toString().replace('.', ',') + ' t · ' + G.hp + ' cv'], ['Elevação', G.elev[0] + '° a +' + G.elev[1] + '°'],
    ['Frente do casco', draft.type === 'pz4' ? '50 mm reta' : '51 mm a ~50°'], ['Lateral do casco', (pl[5] ? pl[5].t : pl[4].t) + ' mm'], ['Frente da torre', pl[11].t + ' mm' + (draft.type === 'm4a1' ? ' a 30°' : '')]];
  $('#tankStats').innerHTML = st.map(([a, b]) => `<div><small>${a}</small><b>${b}</b></div>`).join('');
  $('#ammoRows').innerHTML = G.ammo.map((a, i) => `<div class="arow ${a.t}"><div><b>${esc(a.k)}</b><span class="ty">${a.t}</span>
      <div class="pen">${a.pen.length > 1 ? 'Penetra ' + a.pen.join(' / ') + ' mm a 100 / 500 / 1000 m' : 'Penetra ' + a.pen[0] + ' mm a qualquer distância'} · ${a.v} m/s</div><div class="d">${esc(a.d)}</div></div>
      <div class="cnt"><button class="small" data-dec="${i}">−</button><input type="number" min="0" max="${G.cap}" value="${draft.ammo[i]}" data-ammo="${i}" aria-label="Quantidade de ${esc(a.k)}"><button class="small" data-inc="${i}">+</button></div></div>`).join('');
  const total = () => draft.ammo.reduce((a, b) => a + b, 0);
  const fix = i => { const others = total() - draft.ammo[i]; draft.ammo[i] = Math.max(0, Math.min(G.cap - others, draft.ammo[i] | 0)); };
  const upd = () => { const n = total(); const el = $('#ammoTotal'); el.textContent = n + ' de ' + G.cap + ' tiros'; el.className = 'total' + (n === G.cap ? ' full' : '');
    for (const inp of $$('[data-ammo]')) inp.value = draft.ammo[+inp.dataset.ammo]; };
  for (const inp of $$('[data-ammo]')) inp.oninput = () => { const i = +inp.dataset.ammo; draft.ammo[i] = +inp.value || 0; fix(i); upd(); };
  for (const b of $$('[data-inc]')) b.onclick = () => { const i = +b.dataset.inc; draft.ammo[i] += 5; fix(i); upd(); };
  for (const b of $$('[data-dec]')) b.onclick = () => { const i = +b.dataset.dec; draft.ammo[i] = Math.max(0, draft.ammo[i] - 5); upd(); };
  $('#ammoDef').onclick = () => { draft.ammo = G.ammo.map(a => a.def); upd(); };
  $('#ammoMax').onclick = () => { draft.ammo = G.ammo.map((a, i) => i === 0 ? G.cap : 0); upd(); };
  $('#ammoHalf').onclick = () => { draft.ammo = G.ammo.map(a => Math.floor(a.def / 2)); upd(); };
  upd();
  $('#fichaBody').innerHTML = TK.ficha;
  preview.setTank(draft.type);
}
$('#btnLoadBack').onclick = () => { if (draft) send({ t: 'tankSet', tank: draft.id, type: draft.type, ammo: draft.ammo }); draft = null; show('room'); };
for (const b of $$('#prevSeg button')) b.onclick = () => { preview.mode = b.dataset.pv; for (const x of $$('#prevSeg button')) x.setAttribute('aria-pressed', x === b); $('#prevLegend').hidden = preview.mode !== 'cut'; };
$('#prevLegend').innerHTML = Object.values(SIM.CAT).map(c => `<span><i style="background:rgb(${c.c.join(',')})"></i>${c.n}</span>`).join('');

// ================================================================ prévia girando (menu e escolha de tanque)
const preview = { active: 'menu', mode: 'ext', type: null, tk: null, views: {}, t: 0, menuI: 0,
  setTank(type) { if (this.type === type && this.tk) return; this.type = type; this.tk = new SIM.Tank(type, 0); },
  frame(dt) {
    if (!this.active) return; const cv = this.active === 'load' ? $('#prevCanvas') : $('#menuCanvas'); if (!cv.offsetWidth) return;
    let V = this.views[this.active]; if (!V) V = this.views[this.active] = new RENDER.View(cv, 3); V.resize();
    this.t += dt;
    if (this.active === 'menu') { const k = Object.keys(TANKS), i = Math.floor(this.t / 9) % k.length; if (this.type !== k[i]) { this.setTank(k[i]); $('#menuCap').innerHTML = esc(TANKS[k[i]].name) + '<small>' + esc(TANKS[k[i]].sub) + '</small>'; } }
    const tk = this.tk; if (!tk) return;
    tk.h = this.t * 0.35; tk.ty = Math.sin(this.t * 0.6) * 0.6; tk.update();
    V.cam.x = 0.2; V.cam.y = 0.4; V.cam.S = Math.min(V.W / 8.5, V.H / 6.2);
    V.clear(RENDER.pack(0, 0, 0)); V.u32.fill(0);
    V.shadowGrid(tk.GH, tk.TH); V.shadowGrid(tk.GT, tk.TT);
    for (let i = 0; i < V.u32.length; i++) V.u32[i] = V.shadow[i] ? RENDER.pack(14, 16, 14) : 0; V.shadow.fill(0);
    V.splatTank(tk, 0, this.active === 'load' ? this.mode : 'ext'); V.outline();
    V.offc.putImageData(V.img, 0, 0); V.ctx.clearRect(0, 0, V.cv.width, V.cv.height); V.ctx.imageSmoothingEnabled = false; V.ctx.drawImage(V.off, 0, 0, V.W * V.PX, V.H * V.PX); }
};
let lastT = performance.now();
function loop(now) { const dt = Math.max(0, Math.min(0.05, (now - lastT) / 1000)); lastT = now; if (!GAME.active) preview.frame(dt); requestAnimationFrame(loop); }
requestAnimationFrame(loop);

// ================================================================ partida
function startGame(m) {
  $('#loading').hidden = false; show('game');
  setTimeout(() => { try { GAME.start(m, send, () => { show('room'); }); } finally { $('#loading').hidden = true; } }, 30);
}
$('#btnResume').onclick = () => GAME.togglePause(false);
$('#btnQuit').onclick = () => GAME.quit();
$('#vol').value = AUDIO.vol; $('#vol').oninput = e => AUDIO.setVol(+e.target.value);

// ================================================================ placar
function endGame(res) {
  lastRes = res; GAME.stop(); show('score');
  const mySlot = res.tanks.find(t => t.driver === myId || t.gunner === myId), myTeam = mySlot ? mySlot.team : 0;
  const title = $('#scoreTitle');
  if (res.winner === -1) { title.textContent = 'EMPATE'; title.className = 'result draw'; }
  else if (res.winner === myTeam) { title.textContent = 'VITÓRIA'; title.className = 'result win'; }
  else { title.textContent = 'DERROTA'; title.className = 'result lose'; }
  const mm = Math.floor(res.time / 60) + ':' + String(res.time % 60).padStart(2, '0');
  $('#scoreSub').textContent = res.modeName + ' · ' + mm + (res.mode !== 'dm' ? ' · placar ' + res.score[0] + ' × ' + res.score[1] : '') + (res.winner >= 0 ? ' · venceu o Time ' + (res.winner ? 'B' : 'A') : '');
  const who = t => t.bot ? 'IA' : [t.driver, t.gunner].filter((v, i, a) => v && a.indexOf(v) === i).map(id => esc(res.names[id] || '?')).join(' + ');
  const rows = res.tanks.slice().sort((a, b) => a.team - b.team || b.stats.kills - a.stats.kills).map(t => { const s = t.stats, acc = s.shots ? Math.round(100 * s.hits / s.shots) + '%' : '—';
    return `<tr class="t${t.team}${t === mySlot ? ' mine' : ''}"><td>Time ${t.team ? 'B' : 'A'}</td><td>${esc(TANKS[t.type].short)}</td><td>${who(t)}</td><td class="n">${s.shots}</td><td class="n">${s.hits} (${acc})</td><td class="n">${s.pens}</td><td class="n">${s.crew}</td><td class="n">${s.kills}</td><td class="n">${s.deaths}</td><td>${t.alive ? 'inteiro' : 'destruído'}</td></tr>`; }).join('');
  $('#scoreTable').innerHTML = '<thead><tr><th>Time</th><th>Tanque</th><th>Tripulação</th><th class="n">Tiros</th><th class="n">Acertos</th><th class="n">Penetrações</th><th class="n">Tripulantes abatidos</th><th class="n">Abates</th><th class="n">Mortes</th><th>Fim</th></tr></thead><tbody>' + rows + '</tbody>';
}
$('#btnScoreRoom').onclick = () => show(room ? 'room' : 'menu');
$('#btnScoreMenu').onclick = leaveRoom;

connect();
})();
