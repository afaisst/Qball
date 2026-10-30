// Qball — procedural sound effects (Web Audio, no sound files).
// Real pool sounds are short, broadband, quickly damped knocks, not ringing tones: every sound here is a mix of
// filtered noise bursts and low "thumps" with fast natural decays, a small room reverb, and a gentle limiter so
// a break with many collisions doesn't distort. Louder and brighter for harder hits, with a little random
// variation so repeated clicks don't sound identical.
window.QB = window.QB || {};

QB.Sound = (function () {
  let ac = null, out = null, verbIn = null, white = null, brown = null, rollGain = null, enabled = true, lastRoll = 0;

  function makeNoise(seconds, brownian) {
    const b = ac.createBuffer(1, Math.round(ac.sampleRate * seconds), ac.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (brownian) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return b;
  }
  // a small, dark room: a few early reflections, then a soft exponential tail
  function roomIR() {
    const len = Math.round(ac.sampleRate * 0.55), b = ac.createBuffer(2, len, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch); let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / ac.sampleRate, w = Math.random() * 2 - 1;
        lp += 0.25 * (w - lp);                                        // darken (wood, cloth, carpet absorb the highs)
        d[i] = lp * Math.exp(-t / 0.11);
      }
      for (const [ms, a] of [[7, 0.5], [13, 0.35], [21, 0.25], [29, 0.18]]) d[Math.round(ms / 1000 * ac.sampleRate) + ch * 17] += a;
    }
    return b;
  }
  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 5; comp.attack.value = 0.002; comp.release.value = 0.15;
      comp.connect(ac.destination);
      out = ac.createGain(); out.gain.value = 0.9; out.connect(comp);
      // (no room reverb: a reverb made from noise left an audible hiss after every click)
      verbIn = null;
      white = makeNoise(0.5, false); brown = makeNoise(2.0, true);
      // continuous cloth rumble for rolling balls (level set by roll())
      const src = ac.createBufferSource(); src.buffer = brown; src.loop = true;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 150; lp.Q.value = 0.5;   // a low murmur, no hiss
      rollGain = ac.createGain(); rollGain.gain.value = 0;
      src.connect(lp); lp.connect(rollGain); rollGain.connect(out); src.start();
    } catch (e) { ac = null; }
  }

  // one filtered noise burst: filter type / frequency / Q, peak gain, decay time constant (s), delay (s), reverb send
  function noise(type, freq, q, gain, tau, delay = 0, send = 0.3) {
    if (!ac || gain <= 0.002) return;
    const t = ac.currentTime + 0.004 + delay;
    const src = ac.createBufferSource(); src.buffer = white;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.0006); g.gain.setTargetAtTime(0, t + 0.0006, tau);
    src.connect(f); f.connect(g); g.connect(out);
    if (send > 0 && verbIn) { const s = ac.createGain(); s.gain.value = send; g.connect(s); s.connect(verbIn); }
    src.start(t, Math.random() * 0.4); src.stop(t + tau * 8 + 0.02);
  }
  // a short low "thump" with a slight downward pitch glide (body of the table, rubber, leather)
  function thump(f0, f1, gain, tau, delay = 0, send = 0.2) {
    if (!ac || gain <= 0.002) return;
    const t = ac.currentTime + 0.004 + delay;
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + tau * 3);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.002); g.gain.setTargetAtTime(0, t + 0.002, tau);
    o.connect(g); g.connect(out);
    if (send > 0 && verbIn) { const s = ac.createGain(); s.gain.value = send; g.connect(s); s.connect(verbIn); }
    o.start(t); o.stop(t + tau * 8 + 0.02);
  }
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const vary = () => 1 + (Math.random() - 0.5) * 0.14;

  return {
    init,
    set enabled(v) { enabled = v; if (!v && rollGain) rollGain.gain.value = 0; }, get enabled() { return enabled; },
    // ball against ball: a crisp, very short clack
    ball(speed) {
      if (!enabled) return;
      const a = Math.pow(clamp01(speed / 3), 0.8), r = vary(), v = 0.05 + 0.85 * a;
      noise('highpass', 4200 * r, 0.7, v * 0.55, 0.0012);                         // the click of the contact itself
      noise('bandpass', (2300 + 900 * a) * r, 0.9, v * 0.9, 0.005 + 0.003 * a);    // the bright body of the clack
      noise('bandpass', 1050 * r, 1.4, v * 0.3, 0.01);                            // a little lower "wood"
    },
    // cue tip on the cue ball: a softer leather "tock"
    cue(speed) {
      if (!enabled) return;
      const a = clamp01(speed / 6), r = vary();
      noise('bandpass', 1500 * r, 0.8, 0.22 + 0.55 * a, 0.006);
      noise('lowpass', 520, 0.7, 0.3 * a, 0.014);
      thump(220 * r, 150, 0.12 + 0.2 * a, 0.02);
    },
    miscue() {
      if (!enabled) return;
      this.cue(2.5);
      noise('bandpass', 2900, 1.5, 0.22, 0.03, 0.01);                              // the tip skidding off
    },
    // ball into the rubber cushion: a dull thud
    cushion(speed) {
      if (!enabled) return;
      const a = clamp01(speed / 4), r = vary();
      noise('lowpass', 650 * r, 0.6, 0.08 + 0.55 * a, 0.028);
      thump(125 * r, 85, 0.35 * a, 0.045);
      noise('bandpass', 1800 * r, 1.0, 0.1 * a, 0.004);                            // the cloth-covered nose, barely a click
    },
    // ball passing the jaws into the pocket (the landing is pocketDrop)
    pocket() {
      if (!enabled) return;
      noise('lowpass', 900, 0.7, 0.22, 0.02);
      thump(160, 110, 0.12, 0.03);
    },
    // ball landing in the pocket (speed = downward speed, m/s); onBalls: lands on balls already in the pocket
    pocketDrop(speed, onBalls) {
      if (!enabled) return;
      const a = clamp01(speed / 1.5);
      thump(105 * vary(), 70, 0.55 * a, 0.06, 0, 0.25);
      noise('lowpass', 420, 0.7, 0.35 * a, 0.035, 0, 0.25);
      if (onBalls) noise('bandpass', 1700 * vary(), 1.0, 0.3 * a, 0.006);           // muffled clack on the other balls
    },
    // balls knocking together inside a pocket (muffled by the pocket)
    ballInPocket(speed) {
      if (!enabled) return;
      const a = clamp01(speed / 1.2);
      noise('bandpass', 1500 * vary(), 1.0, 0.25 * a, 0.006);
      thump(140, 100, 0.12 * a, 0.02);
    },
    // cloth rumble of rolling balls: level 0..1 (call every frame; cheap)
    roll(level) {
      if (!ac || !rollGain) return;
      const g = enabled ? 0.07 * clamp01(level) : 0;
      if (Math.abs(g - lastRoll) < 0.004) return;
      lastRoll = g; rollGain.gain.setTargetAtTime(g, ac.currentTime, 0.06);
    },
  };
})();
