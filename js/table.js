// Qball — table geometry: cushion noses, pocket jaws (as line segments) and drop holes.
window.QB = window.QB || {};

QB.buildTable = function () {
  const C = QB.C;
  const L2 = C.TABLE_L / 2, W2 = C.TABLE_W / 2, c = C.CUSHION_W;
  const deg = Math.PI / 180;
  const pockets = [];
  const corner = {}; // keyed "sx,sy"
  const side = {};   // keyed sy

  // ---- Corner pockets ----
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const d = C.CORNER_MOUTH / Math.SQRT2;
    const beta = (180 - C.CORNER_JAW_ANGLE) * deg;
    const tJaw = c / Math.sin(beta);
    const Pl = { x: sx * (L2 - d), y: sy * W2 };        // nose end on long rail
    const Ps = { x: sx * L2, y: sy * (W2 - d) };        // nose end on short rail
    const Jl = { x: Pl.x + sx * Math.cos(beta) * tJaw, y: Pl.y + sy * Math.sin(beta) * tJaw };
    const Js = { x: Ps.x + sx * Math.sin(beta) * tJaw, y: Ps.y + sy * Math.cos(beta) * tJaw };
    const axis = { x: sx / Math.SQRT2, y: sy / Math.SQRT2 };
    const mid = { x: (Pl.x + Ps.x) / 2, y: (Pl.y + Ps.y) / 2 };
    const p = {
      id: pockets.length, kind: 'corner',
      name: (sy > 0 ? 'top' : 'bottom') + '-' + (sx > 0 ? 'right' : 'left'),
      mouth: mid, axis,
      x: mid.x + axis.x * C.CORNER_HOLE_OFFSET,
      y: mid.y + axis.y * C.CORNER_HOLE_OFFSET,
      r: C.CORNER_HOLE_R,
    };
    pockets.push(p);
    corner[sx + ',' + sy] = { Pl, Ps, Jl, Js, pocket: p };
  }

  // ---- Side pockets ----
  for (const sy of [-1, 1]) {
    const h = C.SIDE_MOUTH / 2;
    const a = C.SIDE_JAW_ANGLE * deg;
    const tJaw = c / Math.sin(a);
    const R_ = { x: h, y: sy * W2 }, L_ = { x: -h, y: sy * W2 };
    const JR = { x: R_.x + Math.cos(a) * tJaw, y: R_.y + sy * Math.sin(a) * tJaw };
    const JL = { x: L_.x - Math.cos(a) * tJaw, y: L_.y + sy * Math.sin(a) * tJaw };
    const p = {
      id: pockets.length, kind: 'side', name: (sy > 0 ? 'top' : 'bottom') + '-side',
      mouth: { x: 0, y: sy * W2 }, axis: { x: 0, y: sy },
      x: 0, y: sy * (W2 + C.SIDE_HOLE_OFFSET), r: C.SIDE_HOLE_R,
    };
    pockets.push(p);
    side[sy] = { R: R_, L: L_, JR, JL, pocket: p };
  }

  // ---- Cushions: [jawEndA, noseA, noseB, jawEndB] ----
  const cushions = [];
  for (const sy of [-1, 1]) {
    const cl = corner['-1,' + sy], cr = corner['1,' + sy], s = side[sy];
    cushions.push({ name: (sy > 0 ? 'top' : 'bottom') + '-left', pts: [cl.Jl, cl.Pl, s.L, s.JL] });
    cushions.push({ name: (sy > 0 ? 'top' : 'bottom') + '-right', pts: [s.JR, s.R, cr.Pl, cr.Jl] });
  }
  for (const sx of [-1, 1]) {
    const cb = corner[sx + ',-1'], ct = corner[sx + ',1'];
    cushions.push({ name: sx > 0 ? 'foot' : 'head', pts: [cb.Js, cb.Ps, ct.Ps, ct.Js] });
  }

  // Collision segments (each cushion: jaw, nose, jaw)
  const segments = [];
  for (const cu of cushions) {
    for (let i = 0; i < 3; i++) {
      const a = cu.pts[i], b = cu.pts[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
      segments.push({ a, b, dx, dy, len, ux: dx / len, uy: dy / len, cushion: cu.name, kind: i === 1 ? 'nose' : 'jaw' });
    }
  }

  return {
    L2, W2, pockets, cushions, segments,
    headString: -L2 / 2,
    headSpot: { x: -L2 / 2, y: 0 },
    footSpot: { x: L2 / 2, y: 0 },
  };
};

// Closest point on segment s to point p.
QB.closestOnSeg = function (s, px, py) {
  let t = ((px - s.a.x) * s.ux + (py - s.a.y) * s.uy);
  if (t < 0) t = 0; else if (t > s.len) t = s.len;
  return { x: s.a.x + s.ux * t, y: s.a.y + s.uy * t, t };
};

// Ray-cast a moving circle (radius r) from (ox,oy) along unit (dx,dy).
// Returns earliest hit {t, type:'ball'|'cushion', ball?, seg?, nx, ny, cx, cy} or null.
QB.castCircle = function (table, balls, ox, oy, dx, dy, r, excludeId) {
  let best = null;
  const consider = (t, info) => { if (t >= 0 && (!best || t < best.t)) best = Object.assign({ t }, info); };

  // circle (center q, radius rr) vs ray
  const rayCircle = (qx, qy, rr) => {
    const fx = ox - qx, fy = oy - qy;
    const b = fx * dx + fy * dy, cc = fx * fx + fy * fy - rr * rr;
    if (cc < 0) return b < 0 ? 0 : -1; // already overlapping: hit now if moving inward
    const disc = b * b - cc;
    if (disc < 0) return -1;
    const t = -b - Math.sqrt(disc);
    return t >= 0 ? t : -1;
  };

  for (const b of balls) {
    if (!b.onTable || b.id === excludeId) continue;
    const t = rayCircle(b.x, b.y, 2 * r);
    if (t >= 0) consider(t, { type: 'ball', ball: b });
  }

  for (const s of table.segments) {
    // Line part: normal of segment (either side)
    let nx = -s.uy, ny = s.ux;
    const dist0 = (ox - s.a.x) * nx + (oy - s.a.y) * ny;
    if (dist0 < 0) { nx = -nx; ny = -ny; }
    const d0 = Math.abs(dist0);
    const vn = dx * nx + dy * ny;
    if (vn < 0 && d0 >= r) {
      const t = (d0 - r) / -vn;
      const hx = ox + dx * t, hy = oy + dy * t;
      const proj = (hx - s.a.x) * s.ux + (hy - s.a.y) * s.uy;
      if (proj >= 0 && proj <= s.len) consider(t, { type: 'cushion', seg: s, nx, ny });
    }
    for (const e of [s.a, s.b]) {
      const t = rayCircle(e.x, e.y, r);
      if (t > 0) {
        const hx = ox + dx * t, hy = oy + dy * t, l = Math.hypot(hx - e.x, hy - e.y);
        consider(t, { type: 'cushion', seg: s, nx: (hx - e.x) / l, ny: (hy - e.y) / l });
      }
    }
  }
  for (const p of table.pockets) {
    const t = rayCircle(p.x, p.y, p.r);
    if (t >= 0) consider(t, { type: 'pocket', pocket: p });
  }
  if (best) { best.cx = ox + dx * best.t; best.cy = oy + dy * best.t; }
  return best;
};
