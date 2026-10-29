// Qball — procedural textures (no image files): billiard cloth, cushion felt and rail wood.
// Everything is generated once in the browser, deterministically (same look every time), and seamless where it
// tiles. Used by the 3D view (as three.js textures) and the 2D top view (as canvas patterns).
window.QB = window.QB || {};

QB.Tex = (function () {
  const cache = {};
  const rng = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

  // smooth periodic value noise on a grid of gw × gh cells (wraps at the edges)
  function noiseField(gw, gh, rnd) {
    const v = new Float32Array(gw * gh); for (let i = 0; i < v.length; i++) v[i] = rnd() * 2 - 1;
    return (u, w) => {             // u, w in cell units (any real number)
      const x0 = Math.floor(u), y0 = Math.floor(w), fx = u - x0, fy = w - y0;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const at = (x, y) => v[((y % gh + gh) % gh) * gw + ((x % gw + gw) % gw)];
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
      return a + (b - a) * sy;
    };
  }

  // ---- felt: fine fibres + a little mottling, as a colour tile (3D cushions) -------------------------------------
  function feltTile(color, size = 256, seed = 11) {
    const key = 'felt' + color + size + seed; if (cache[key]) return cache[key];
    const c = canvas(size, size), g = c.getContext('2d'), img = g.createImageData(size, size), d = img.data;
    const rnd = rng(seed), mot = noiseField(8, 8, rnd), [r0, g0, b0] = hex(color);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const n = (rnd() - 0.5) * 0.10 + mot(x / size * 8, y / size * 8) * 0.03 + (((x * 7 + y * 3) % 5) - 2) * 0.004;
      const i = (y * size + x) * 4, f = 1 + n;
      d[i] = r0 * f; d[i + 1] = g0 * f; d[i + 2] = b0 * f; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return (cache[key] = c);
  }

  // ---- felt overlay (grey noise with alpha) for the 2D cloth ---------------------------------------------------
  function feltOverlay(size = 192, seed = 5) {
    const key = 'feltO' + size; if (cache[key]) return cache[key];
    const c = canvas(size, size), g = c.getContext('2d'), img = g.createImageData(size, size), d = img.data, rnd = rng(seed);
    for (let i = 0; i < size * size; i++) {
      const n = rnd(), light = n > 0.5;
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = light ? 255 : 0;
      d[i * 4 + 3] = Math.abs(n - 0.5) * 2 * 8;       // up to ~3% opacity: just a hint of felt
    }
    g.putImageData(img, 0, 0);
    return (cache[key] = c);
  }

  // ---- the whole cloth for the 3D table: colour, fibres, nap and very light wear --------------------------------
  // (wPx × hPx covers the cloth plane, which reaches out to the cushion backs: L × W metres)
  function cloth(table, L, W, wPx = 2048, color = '#1b7a4b') {
    const key = 'cloth' + wPx; if (cache[key]) return cache[key];
    const hPx = Math.round(wPx * W / L), c = canvas(wPx, hPx), g = c.getContext('2d'), img = g.createImageData(wPx, hPx), d = img.data;
    const rnd = rng(77), mot = noiseField(24, 12, rnd), nap = noiseField(6, 256, rnd), [r0, g0, b0] = hex(color);
    const mpp = L / wPx;                                   // metres per pixel
    const hs = table.headSpot, fs = table.footSpot;
    for (let py = 0; py < hPx; py++) {
      const y = W / 2 - (py + 0.5) * mpp;
      for (let px = 0; px < wPx; px++) {
        const x = -L / 2 + (px + 0.5) * mpp;
        let n = (rnd() - 0.5) * 0.085;                                                 // fibres
        n += mot(px / wPx * 24, py / hPx * 12) * 0.022;                                 // mottling (~10 cm)
        n += nap(px / wPx * 6, py / hPx * 256) * 0.012;                                 // nap: faint streaks along the table
        // wear: the lane the cue ball travels on the break, the rack area, and the head spot
        if (x > hs.x - 0.1 && x < fs.x + 0.12) n += 0.022 * Math.exp(-(y * y) / (2 * 0.07 * 0.07));
        n += 0.02 * Math.exp(-((x - fs.x - 0.08) ** 2 + y * y) / (2 * 0.11 * 0.11));
        n += 0.015 * Math.exp(-((x - hs.x) ** 2 + y * y) / (2 * 0.04 * 0.04));
        const i = (py * wPx + px) * 4, f = 1 + n;
        d[i] = Math.min(255, r0 * f); d[i + 1] = Math.min(255, g0 * f); d[i + 2] = Math.min(255, b0 * f); d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return (cache[key] = c);
  }

  // ---- wood: grain running along x, seamless in both directions -------------------------------------------------
  // (w × h px; the 3D view maps 1024 px to 1 m along the grain and 256 px to 0.25 m across)
  function wood(w = 1024, h = 256, seed = 3) {
    const key = 'wood' + w + h + seed; if (cache[key]) return cache[key];
    const c = canvas(w, h), g = c.getContext('2d'), img = g.createImageData(w, h), d = img.data, rnd = rng(seed);
    const warp = noiseField(6, 4, rnd), fine = noiseField(64, 32, rnd), pores = noiseField(256, 128, rnd);
    const light = hex('#7d4526'), mid = hex('#5e3018'), dark = hex('#3f1d0c');
    const lines = 7;                                          // growth lines per tile height (integer -> seamless)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h;
      // growth rings: lines along x, gently waving; the wave only depends on x so the tile stays periodic in y
      let t = v * lines + warp(u * 6, v * 4) * 0.9 + Math.sin(u * Math.PI * 2 * 2 + 1.3) * 0.25;
      t = t - Math.floor(t);
      const ring = Math.pow(Math.sin(t * Math.PI), 6);          // narrow dark late-wood bands
      const f = fine(u * 64, v * 32) * 0.5 + 0.5;               // streaks along the grain
      const pore = pores(u * 256, v * 128) > 0.72 ? 0.12 : 0;   // small dark pores, stretched along x
      let k = 0.35 + 0.35 * f - 0.45 * ring - pore;             // 0 = dark ... 1 = light
      k = Math.max(0, Math.min(1, k));
      const a = k < 0.5 ? dark : mid, b = k < 0.5 ? mid : light, s = k < 0.5 ? k * 2 : (k - 0.5) * 2;
      const i = (y * w + x) * 4;
      d[i] = a[0] + (b[0] - a[0]) * s; d[i + 1] = a[1] + (b[1] - a[1]) * s; d[i + 2] = a[2] + (b[2] - a[2]) * s; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return (cache[key] = c);
  }

  return { feltTile, feltOverlay, cloth, wood };
})();
