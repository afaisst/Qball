// Qball — tiny procedural sound effects (Web Audio, no assets).
window.QB = window.QB || {};

QB.Sound = (function () {
  let ac = null, noise = null, enabled = true;
  function init() {
    if (ac) return;
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      noise = ac.createBuffer(1, ac.sampleRate * 0.25, ac.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { ac = null; }
  }
  function burst(vol, freq, q, decay) {
    if (!enabled || !ac || vol <= 0.003) return;
    const t = ac.currentTime;
    const src = ac.createBufferSource(); src.buffer = noise;
    const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = ac.createGain();
    g.gain.setValueAtTime(Math.min(1, vol), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f); f.connect(g); g.connect(ac.destination);
    src.start(t); src.stop(t + decay + 0.02);
  }
  return {
    init,
    set enabled(v) { enabled = v; }, get enabled() { return enabled; },
    ball(speed) { burst(Math.min(1, speed / 4) * 1.6, 3200, 1.2, 0.05); },
    cushion(speed) { burst(Math.min(1, speed / 5) * 0.9, 380, 0.8, 0.09); },
    cue(speed) { burst(Math.min(1, speed / 6) * 0.9 + 0.1, 1800, 0.9, 0.04); },
    miscue() { burst(0.6, 900, 0.5, 0.08); setTimeout(() => burst(0.4, 2400, 2, 0.03), 25); },
    pocket() { burst(0.5, 160, 0.6, 0.25); setTimeout(() => burst(0.35, 260, 0.8, 0.15), 70); },
  };
})();
