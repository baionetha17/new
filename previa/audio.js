// Sons sintetizados na hora (sem arquivos): tiro, impacto, ricochete, explosão e motor.
const AUDIO = (() => {
  let ac = null, master = null, noise = null, eng = null, vol = 0.6;
  try { const v = localStorage.getItem('tanque.vol'); if (v !== null) vol = +v; } catch (e) {}
  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    master = ac.createGain(); master.gain.value = vol; master.connect(ac.destination);
    noise = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate); const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const att = dist => Math.max(0.03, 1 / (1 + (dist || 0) / 60));
  function burst(dur, f0, f1, gain, q, delay) { if (!ac) return; const t = ac.currentTime + (delay || 0);
    const src = ac.createBufferSource(); src.buffer = noise; const bp = ac.createBiquadFilter(); bp.type = 'lowpass'; bp.Q.value = q || 0.7;
    bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(master); src.start(t, Math.random()); src.stop(t + dur + 0.05); }
  function tone(dur, f0, f1, gain, type, delay) { if (!ac) return; const t = ac.currentTime + (delay || 0); const o = ac.createOscillator(); o.type = type || 'sine';
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05); }
  const delayOf = d => Math.min(1.2, (d || 0) / 340);
  return {
    init,
    setVol(v) { vol = v; if (master) master.gain.value = v; try { localStorage.setItem('tanque.vol', v); } catch (e) {} },
    get vol() { return vol; },
    cannon(d) { const a = att(d), dl = delayOf(d); burst(1.1, 2400, 60, 0.9 * a, 0.6, dl); tone(0.5, 90, 35, 0.7 * a, 'sine', dl); },
    hit(d, pen) { const a = att(d), dl = delayOf(d); burst(0.25, pen ? 1800 : 5200, 300, 0.55 * a, 2, dl); tone(0.18, pen ? 260 : 900, pen ? 120 : 600, 0.25 * a, 'square', dl); },
    ric(d) { const a = att(d), dl = delayOf(d); burst(0.12, 6000, 2000, 0.4 * a, 3, dl); tone(0.55, 2400, 700, 0.18 * a, 'sine', dl + 0.03); },
    boom(d, big) { const a = att(d), dl = delayOf(d); burst(big ? 2.6 : 1.3, big ? 1400 : 1800, 40, (big ? 1.0 : 0.7) * a, 0.5, dl); tone(big ? 1.4 : 0.6, 70, 25, 0.8 * a, 'sine', dl); },
    thud(d) { const a = att(d); burst(0.35, 700, 80, 0.35 * a, 0.8, delayOf(d)); },
    glass(d) { const a = att(d), dl = delayOf(d); burst(0.35, 9000, 2500, 0.3 * a, 4, dl); for (let i = 0; i < 4; i++) tone(0.12 + Math.random() * 0.2, 3000 + Math.random() * 3000, 2000, 0.05 * a, 'sine', dl + i * 0.04); },
    mg(d, fast) { const a = att(d), dl = delayOf(d); burst(0.05, fast ? 3200 : 2600, 400, 0.32 * a, 3, dl); tone(0.03, fast ? 180 : 140, 80, 0.2 * a, 'square', dl); },
    ping(d) { const a = att(d); tone(0.08, 2600 + Math.random() * 1200, 1500, 0.06 * a, 'sine', delayOf(d)); },
    crunch(d) { const a = att(d); burst(0.2, 1500, 300, 0.25 * a, 1.5, delayOf(d)); },
    reload() { tone(0.06, 900, 700, 0.12, 'square'); tone(0.08, 500, 400, 0.12, 'square', 0.09); },
    engine(on, v) { if (!ac) return;
      if (!eng && on) { const o = ac.createOscillator(); o.type = 'sawtooth'; const o2 = ac.createOscillator(); o2.type = 'square'; const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220; const g = ac.createGain(); g.gain.value = 0;
        o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(master); o.start(); o2.start(); eng = { o, o2, g, lp }; }
      if (!eng) return; const t = ac.currentTime, f = 28 + v * 5;
      eng.o.frequency.setTargetAtTime(f, t, 0.2); eng.o2.frequency.setTargetAtTime(f * 0.5, t, 0.2); eng.lp.frequency.setTargetAtTime(160 + v * 30, t, 0.2);
      eng.g.gain.setTargetAtTime(on ? 0.05 + v * 0.008 : 0, t, 0.3); }
  };
})();
