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
      d[i * 4 + 3] = Math.abs(n - 0.5) * 2 * 12;      // up to ~5% opacity: a light felt texture
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

  // ---- per-pixel fibre noise on an existing canvas (rug, wallpaper) ---------------------------------------------
  function grain(c, amount, seed) {
    const g = c.getContext('2d'), img = g.getImageData(0, 0, c.width, c.height), d = img.data, rnd = rng(seed);
    for (let i = 0; i < d.length; i += 4) { const f = 1 + (rnd() - 0.5) * amount; d[i] *= f; d[i + 1] *= f; d[i + 2] *= f; }
    g.putImageData(img, 0, 0);
  }

  // ---- a rug: deep red field with a diamond lattice and a medallion, navy and gold borders -----------------------
  function rug(w = 1024, h = 744) {
    const key = 'rug' + w; if (cache[key]) return cache[key];
    const c = canvas(w, h), g = c.getContext('2d');
    const red = '#6b1d1f', red2 = '#7d2a29', navy = '#1d2741', gold = '#b48a3c', cream = '#d8c69a';
    g.fillStyle = navy; g.fillRect(0, 0, w, h);
    const band = (m, col) => { g.fillStyle = col; g.fillRect(m, m, w - 2 * m, h - 2 * m); };
    band(w * 0.018, cream); band(w * 0.024, navy);
    // border motif: small gold diamonds along the navy band
    g.fillStyle = gold;
    const bm = w * 0.024, bw = w * 0.05, step = w * 0.04;
    const dia = (x, y, r) => { g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath(); g.fill(); };
    for (let x = bm + step / 2; x < w - bm; x += step) { dia(x, bm + bw / 2, bw * 0.28); dia(x, h - bm - bw / 2, bw * 0.28); }
    for (let y = bm + step / 2; y < h - bm; y += step) { dia(bm + bw / 2, y, bw * 0.28); dia(w - bm - bw / 2, y, bw * 0.28); }
    band(bm + bw, cream); band(bm + bw + w * 0.006, red);
    // field: diamond lattice
    const f0 = bm + bw + w * 0.006, fx = f0, fy = f0, fw = w - 2 * f0, fh = h - 2 * f0, cell = w * 0.07;
    g.save(); g.beginPath(); g.rect(fx, fy, fw, fh); g.clip();
    g.strokeStyle = red2; g.lineWidth = w * 0.004;
    for (let k = -fh; k < fw + fh; k += cell) {
      g.beginPath(); g.moveTo(fx + k, fy); g.lineTo(fx + k + fh, fy + fh); g.stroke();
      g.beginPath(); g.moveTo(fx + k, fy + fh); g.lineTo(fx + k + fh, fy); g.stroke();
    }
    g.fillStyle = 'rgba(180,138,60,0.55)';
    for (let i = 0; i * cell < fw + cell; i++) for (let j = 0; j * cell < fh + cell; j++) dia(fx + i * cell + ((j % 2) ? cell / 2 : 0), fy + j * cell / 2 * 2, w * 0.006);
    // medallion
    const cx = w / 2, cy = h / 2;
    const rh = (rx, ry, col) => { g.fillStyle = col; g.beginPath(); g.moveTo(cx, cy - ry); g.lineTo(cx + rx, cy); g.lineTo(cx, cy + ry); g.lineTo(cx - rx, cy); g.closePath(); g.fill(); };
    rh(w * 0.2, h * 0.27, cream); rh(w * 0.19, h * 0.255, navy); rh(w * 0.15, h * 0.2, gold); rh(w * 0.14, h * 0.185, red);
    g.fillStyle = navy; g.beginPath(); g.ellipse(cx, cy, w * 0.06, h * 0.08, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = gold; g.beginPath(); g.ellipse(cx, cy, w * 0.025, h * 0.034, 0, 0, Math.PI * 2); g.fill();
    // corner pieces
    g.fillStyle = navy;
    for (const [x, y] of [[fx, fy], [fx + fw, fy], [fx, fy + fh], [fx + fw, fy + fh]]) { g.beginPath(); g.arc(x, y, w * 0.09, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = 'rgba(180,138,60,0.8)';
    for (const [x, y] of [[fx, fy], [fx + fw, fy], [fx, fy + fh], [fx + fw, fy + fh]]) { g.beginPath(); g.arc(x, y, w * 0.05, 0, Math.PI * 2); g.fill(); }
    g.restore();
    grain(c, 0.16, 21);                                     // wool fibres
    // a little wear in the middle (where people walk round the table)
    const vg = g.createRadialGradient(cx, cy, w * 0.1, cx, cy, w * 0.6);
    vg.addColorStop(0, 'rgba(255,240,220,0.05)'); vg.addColorStop(1, 'rgba(0,0,0,0.12)');
    g.fillStyle = vg; g.fillRect(0, 0, w, h);
    return (cache[key] = c);
  }

  // ---- floorboards: planks along x, 12 cm wide, staggered joints (tile = 2 m × 2 m, seamless) --------------------
  function floorboards(size = 1024) {
    const key = 'floor' + size; if (cache[key]) return cache[key];
    const c = canvas(size, size), g = c.getContext('2d'), rnd = rng(9), woodC = wood(512, 128, 13);
    const rows = 16, rh = size / rows;                      // 2 m / 16 = 12.5 cm planks
    for (let r = 0; r < rows; r++) {
      let x = -rnd() * size * 0.5;
      while (x < size) {
        const len = size * (0.35 + rnd() * 0.4);
        const sx = rnd() * 300, sy = rnd() * 80;
        for (const dx of [0, -size, size]) g.drawImage(woodC, sx, sy, 200, 40, x + dx, r * rh, len, rh);
        // tone variation per plank
        g.fillStyle = `rgba(${rnd() < 0.5 ? '255,220,170' : '30,15,5'},${(rnd() * 0.12).toFixed(3)})`;
        for (const dx of [0, -size, size]) g.fillRect(x + dx, r * rh, len, rh);
        g.fillStyle = 'rgba(0,0,0,0.55)';
        for (const dx of [0, -size, size]) g.fillRect(x + dx, r * rh, 1.5, rh);   // butt joint
        x += len;
      }
      g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(0, r * rh, size, 1.5);         // gap between rows
    }
    g.fillStyle = 'rgba(40,20,5,0.25)'; g.fillRect(0, 0, size, size);              // darker, aged finish
    return (cache[key] = c);
  }

  // ---- wallpaper: dark green with faint vertical stripes and a small repeating motif (tile = 0.5 m) ---------------
  function wallpaper(size = 512) {
    const key = 'wall' + size; if (cache[key]) return cache[key];
    const c = canvas(size, size), g = c.getContext('2d');
    g.fillStyle = '#26382f'; g.fillRect(0, 0, size, size);
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.05)';
      g.fillRect(i * size / 8, 0, size / 16, size);
    }
    g.fillStyle = 'rgba(200,170,110,0.10)';
    for (const [x, y] of [[size / 4, size / 4], [3 * size / 4, 3 * size / 4]]) {
      g.beginPath(); g.ellipse(x, y, size * 0.05, size * 0.09, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(x, y, size * 0.09, size * 0.03, 0, 0, Math.PI * 2); g.fill();
    }
    grain(c, 0.06, 31);
    return (cache[key] = c);
  }

  return { feltTile, feltOverlay, cloth, wood, rug, floorboards, wallpaper };
})();
