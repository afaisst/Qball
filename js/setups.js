// Qball — ball setups: game racks (8/9/10-ball), free practice, and practice drills.
// Drills are inspired by Billiard University Exam I "Fundamentals" (F1–F5) by Dr. Dave Alciatore
// and Bob Jewett (https://billiarduniversity.org/testing/exams/). Positions here are our own
// approximations on a 9-ft table, not the official BU diagrams.
window.QB = window.QB || {};

(function () {
  const C = QB.C, R = C.BALL_R, D = C.TABLE_L / 8;   // one diamond = 0.3175 m
  const GAP = 0.0002;                                 // tiny gap between racked balls

  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  // Rack positions: apex on the foot spot, rows growing toward the foot rail (+x).
  function rackSpots(table, rows) {
    const apex = table.footSpot, dx = Math.sqrt(3) * (R + GAP / 2), dy = 2 * R + GAP, spots = [];
    rows.forEach((n, r) => { for (let i = 0; i < n; i++) spots.push({ x: apex.x + r * dx, y: (i - (n - 1) / 2) * dy, row: r, col: i, n }); });
    return spots;
  }
  const kitchenCue = (table) => ({ num: 0, x: table.headSpot.x, y: 0 });

  const GAMES = [
    {
      id: '8ball', name: '8-Ball', blurb: '15 balls in a triangle, 8 in the middle. Break from behind the head string.',
      balls(table) {
        const s = rackSpots(table, [1, 2, 3, 4, 5]);
        const solids = shuffle([1, 2, 3, 4, 5, 6, 7]), stripes = shuffle([9, 10, 11, 12, 13, 14, 15]);
        const nums = new Array(15);
        const idx = (r, c) => s.findIndex(q => q.row === r && q.col === c);
        nums[idx(2, 1)] = 8;                                   // 8-ball in the center
        const flip = Math.random() < 0.5;                      // one solid and one stripe in the back corners
        nums[idx(4, 0)] = flip ? solids.pop() : stripes.pop();
        nums[idx(4, 4)] = flip ? stripes.pop() : solids.pop();
        const rest = shuffle(solids.concat(stripes));
        for (let i = 0; i < 15; i++) if (nums[i] === undefined) nums[i] = rest.pop();
        return [kitchenCue(table)].concat(s.map((q, i) => ({ num: nums[i], x: q.x, y: q.y })));
      },
    },
    {
      id: '9ball', name: '9-Ball', blurb: 'Diamond rack, 1-ball on the foot spot, 9-ball in the center. Run them in order.',
      balls(table) {
        const s = rackSpots(table, [1, 2, 3, 2, 1]);
        const rest = shuffle([2, 3, 4, 5, 6, 7, 8]);
        return [kitchenCue(table)].concat(s.map((q, i) => ({ num: i === 0 ? 1 : (q.row === 2 && q.col === 1) ? 9 : rest.pop(), x: q.x, y: q.y })));
      },
    },
    {
      id: '10ball', name: '10-Ball', blurb: 'Triangle of 10, 1-ball at the apex, 10-ball in the middle of the third row.',
      balls(table) {
        const s = rackSpots(table, [1, 2, 3, 4]);
        const rest = shuffle([2, 3, 4, 5, 6, 7, 8, 9]);
        return [kitchenCue(table)].concat(s.map((q, i) => ({ num: i === 0 ? 1 : (q.row === 2 && q.col === 1) ? 10 : rest.pop(), x: q.x, y: q.y })));
      },
    },
    {
      id: 'free', name: 'Free practice', blurb: 'Cue ball and the 1-ball. A pocketed 1-ball is re-spotted.',
      balls(table) { return [kitchenCue(table), { num: 1, x: table.footSpot.x, y: 0 }]; },
    },
    {
      id: 'place', menu: 'drills', name: 'Free Ball Placement', blurb: 'Set up any position yourself: drag balls from the panel onto the table, then shoot. Pocketed balls go back to the panel.',
      balls(table) {
        const out = [kitchenCue(table)];
        for (let n = 1; n <= 15; n++) out.push({ num: n, x: 0, y: 0, onTable: false });
        return out;
      },
      // picture for the menu card: a few balls placed by hand
      preview(table) {
        return [kitchenCue(table), { num: 3, x: 0.35, y: 0.2 }, { num: 8, x: 0.9, y: -0.3 }, { num: 12, x: -0.1, y: -0.35 }, { num: 6, x: 0.7, y: 0.42 }];
      },
    },
  ];

  // ---------------- Drills ----------------
  // Common geometry: target pocket = top-right corner; object ball on the diagonal toward that pocket.
  function geom(table, obDiamonds) {
    const p = table.pockets.find(q => q.name === 'top-right');
    const u = { x: Math.SQRT1_2, y: Math.SQRT1_2 };          // direction object ball -> pocket
    const ob = { x: p.mouth.x - u.x * obDiamonds * D, y: p.mouth.y - u.y * obDiamonds * D };
    const g = { x: ob.x - 2 * R * u.x, y: ob.y - 2 * R * u.y }; // ghost ball for a straight-in shot
    return { p, u, ob, g };
  }
  // cue ball for a cut of `cutDeg` (positive: cue ball comes from the lower side), `dist` from the ghost ball
  function cutCB(G, cutDeg, dist) {
    const th = Math.atan2(G.u.y, G.u.x) - cutDeg * Math.PI / 180;
    const gx = G.ob.x - 2 * R * G.u.x, gy = G.ob.y - 2 * R * G.u.y;
    return { cb: { x: gx - dist * Math.cos(th), y: gy - dist * Math.sin(th) }, g: { x: gx, y: gy }, aim: th };
  }

  const DRILLS = [
    {
      id: 'straight', name: 'Straight-in', tag: 'Aim',
      goal: 'Pocket the object ball in the marked corner. Each level moves the cue ball farther back.',
      setup(table, lv) {
        const G = geom(table, 0.5), dist = (1 + 0.5 * (lv - 1)) * D;
        return { balls: [{ num: 0, x: G.ob.x - G.u.x * dist, y: G.ob.y - G.u.y * dist }, { num: 1, ...G.ob }], pocket: G.p.name };
      },
    },
    {
      id: 'cut', name: 'Cut shots', tag: 'BU F1',
      goal: 'Pocket the object ball. Each level makes the cut thinner (5° → 65°).',
      setup(table, lv) {
        const G = geom(table, 1), c = cutCB(G, 5 + 10 * (lv - 1), 2 * D);
        return { balls: [{ num: 0, ...c.cb }, { num: 1, ...G.ob }], pocket: G.p.name };
      },
    },
    {
      id: 'stop', name: 'Stop shot', tag: 'BU F2',
      goal: 'Pocket the ball and stop the cue ball dead: it must end touching the ghost-ball circle. The distance grows each level.',
      setup(table, lv) {
        const G = geom(table, 1), dist = 0.5 * lv * D;
        return { balls: [{ num: 0, x: G.ob.x - G.u.x * dist, y: G.ob.y - G.u.y * dist }, { num: 1, ...G.ob }], pocket: G.p.name,
          zone: { type: 'circle', x: G.g.x, y: G.g.y, r: 2 * R } };
      },
    },
    {
      id: 'follow', name: 'Follow to target', tag: 'BU F3',
      goal: 'Cue and object ball one diamond apart, a ~30° cut. Pocket it and follow the cue ball into the target circle.',
      setup(table, lv, world) {
        const G = geom(table, 2), c = cutCB(G, 30, 1 * D);
        const balls = [{ num: 0, ...c.cb }, { num: 1, ...G.ob }];
        // target: where a natural-roll shot at a level-dependent speed actually ends (current physics)
        const speeds = [1.1, 1.35, 1.6, 1.9, 2.25, 2.65, 3.1];
        const t = simulateEnd(table, world, balls, c.aim, speeds[lv - 1], 0, 0.4);
        return { balls, pocket: G.p.name, zone: { type: 'circle', x: t.x, y: t.y, r: 0.09 } };
      },
    },
    {
      id: 'draw', name: 'Draw back', tag: 'BU F4',
      goal: 'Straight-in shot: pocket the ball and draw the cue ball back to where it started (inside the circle).',
      setup(table, lv) {
        const G = geom(table, 1), dist = 0.5 * lv * D;
        const cb = { x: G.ob.x - G.u.x * dist, y: G.ob.y - G.u.y * dist };
        return { balls: [{ num: 0, ...cb }, { num: 1, ...G.ob }], pocket: G.p.name, zone: { type: 'circle', x: cb.x, y: cb.y, r: 0.5 * D } };
      },
    },
    {
      id: 'stun', name: 'Stun to target', tag: 'BU F5',
      goal: '30° cut. Pocket the ball and send the cue ball along the tangent line into the target. The target moves farther out each level.',
      setup(table, lv) {
        const G = geom(table, 2), c = cutCB(G, 30, 1.5 * D);
        const d = { x: Math.cos(c.aim), y: Math.sin(c.aim) }, dn = d.x * G.u.x + d.y * G.u.y;
        let tx = d.x - dn * G.u.x, ty = d.y - dn * G.u.y; const tl = Math.hypot(tx, ty); tx /= tl; ty /= tl;
        const s = 0.15 + 0.07 * (lv - 1);
        return { balls: [{ num: 0, ...c.cb }, { num: 1, ...G.ob }], pocket: G.p.name,
          zone: { type: 'circle', x: c.g.x + tx * s, y: c.g.y + ty * s, r: 0.09 } };
      },
    },
    {
      id: 'wagon', name: 'Wagon wheel', tag: 'BU F7',
      goal: 'Same 30° cut every time; the target moves around the table like the spokes of a wheel. Pocket the ball and land the cue ball in the circle: choose your spin and speed.',
      setup(table, lv, world) {
        const G = geom(table, 2), c = cutCB(G, 30, 1.5 * D);
        const balls = [{ num: 0, ...c.cb }, { num: 1, ...G.ob }];
        // each spoke = where a particular spin/speed combination really ends (current physics)
        const spokes = [[0, 1.4], [0.2, 1.6], [0.4, 1.8], [0, 3.0], [0.4, 2.6], [0.5, 4.5], [-0.5, 4.0]];
        const [tipY, v] = spokes[lv - 1];
        const t = simulateEnd(table, world, balls, c.aim, v, 0, tipY);
        return { balls, pocket: G.p.name, zone: { type: 'circle', x: t.x, y: t.y, r: lv <= 3 ? 0.10 : 0.13 } };
      },
    },
    // ---------- pattern drills: ball in hand, run the balls ----------
    {
      id: 'lshape', name: 'L-drill', tag: 'Pattern', type: 'pattern', order: 'any',
      goal: 'Nine balls in an L that boxes in a corner pocket: one on the foot spot, four across the table and four along the long rail. Ball in hand, run them all without missing.',
      balls(table) {
        // corner ball on the foot spot; legs toward the bottom long rail and toward the foot rail (bottom-right pocket)
        const cx = table.footSpot.x, cy = table.footSpot.y, sp = 0.135, out = [{ x: cx, y: cy }];
        for (let k = 1; k <= 4; k++) out.push({ x: cx, y: cy - k * sp });   // across the table
        for (let k = 1; k <= 4; k++) out.push({ x: cx + k * sp, y: cy });   // along the long rail direction
        const nums = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
        return out.map((q, i) => ({ num: nums[i], ...q }));
      },
    },
    {
      id: 'linelong', name: 'Line-up (long)', tag: 'Dr. Dave', type: 'pattern', order: 'any',
      goal: 'Line-of-balls drill: nine balls on the long string down the middle of the table. Ball in hand, clear them in any order without missing.',
      balls(table) {
        const nums = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
        return nums.map((n, i) => ({ num: n, x: -0.95 + i * 0.2375, y: 0 }));
      },
    },
    {
      id: 'lineshort', name: 'Cross line (short)', tag: 'Dr. Dave', type: 'pattern', order: 'any',
      goal: 'Nine balls across the table on the line between the side pockets. Ball in hand, clear them in any order.',
      balls(table) {
        const nums = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
        return nums.map((n, i) => ({ num: n, x: 0, y: -0.48 + i * 0.12 }));
      },
    },
    {
      id: 'rails', name: 'Balls on the rail', tag: 'Pattern', type: 'pattern', order: 'any',
      goal: 'Eight balls frozen to the long rails at the diamonds. Ball in hand: rail cut shots down the rail, in any order.',
      balls(table) {
        const nums = shuffle([1, 2, 3, 4, 5, 6, 7, 8]), out = [], yy = table.W2 - R - 0.0005;
        for (const x of [-3, -1, 1, 3]) for (const sgn of [1, -1]) out.push({ x: x * D, y: sgn * yy });
        return out.map((q, i) => ({ num: nums[i], ...q }));
      },
    },
    {
      id: 'gridballs', name: 'Diamond grid', tag: 'Pattern', type: 'pattern', order: 'any',
      levels: { min: 5, max: 15, start: 15, label: 'balls' },
      goal: 'All balls sit on the practice-marking spots (where lines between opposite diamonds cross); the spots change every try. Ball in hand, run them in any order.',
      balls(table, n) {
        const spots = shuffle(QB.markings(table).grid.slice()).slice(0, n);
        return spots.map((q, i) => ({ num: i + 1, x: q.x, y: q.y }));
      },
    },
    {
      id: 'threeball', name: '3-ball drill', tag: 'Dr. Dave', type: 'pattern', order: 'sequence',
      levels: { min: 3, max: 9, start: 3, label: 'balls' },
      goal: 'Random balls (new layout each try). Ball in hand, pocket them in numerical order. Run 3 balls reliably, then add more with "harder".',
      balls(table, n) { return randomBalls(table, Array.from({ length: n }, (_, i) => i + 1)); },
    },
    {
      id: 'random', name: 'Random layout', tag: 'Random', type: 'pattern', order: 'any',
      levels: { min: 3, max: 9, start: 5, label: 'balls' },
      goal: 'Balls scattered randomly, a new layout every try. Ball in hand, run them in any order.',
      balls(table, n) { return randomBalls(table, Array.from({ length: n }, (_, i) => i + 1)); },
    },
    {
      id: 'ghost', name: 'Play the ghost (9-ball)', tag: 'Dr. Dave', type: 'pattern', order: 'rotation',
      goal: 'The 1–9 spread randomly, ball in hand. Hit the lowest ball first every shot and pocket something. Run the rack to beat the ghost; your score is the balls pocketed over 10 racks.',
      balls(table) { return randomBalls(table, [1, 2, 3, 4, 5, 6, 7, 8, 9]); },
    },
  ];

  // Random, non-overlapping positions away from the pockets and cushions.
  function randomBalls(table, nums) {
    const out = [], mx = table.L2 - R - 0.03, my = table.W2 - R - 0.03;
    for (const n of nums) {
      for (let tries = 0; tries < 500; tries++) {
        const x = (Math.random() * 2 - 1) * mx, y = (Math.random() * 2 - 1) * my;
        if (table.pockets.some(p => Math.hypot(x - p.x, y - p.y) < p.r + 0.07)) continue;
        if (out.some(q => Math.hypot(q.x - x, q.y - y) < 2 * R + 0.012)) continue;
        out.push({ num: n, x, y }); break;
      }
    }
    return out;
  }

  // Simulate a shot and return the cue ball's final position (used to place reachable targets).
  function simulateEnd(table, world, balls, aim, cueSpeed, tipX, tipY) {
    const w = new QB.World(table, Object.assign({}, world ? world.params : QB.defaultParams()));
    w.recordTrails = false;
    for (const b of balls) w.addBall(b.num, b.x, b.y);
    w.cueStrike(w.balls[0], cueSpeed, aim, tipX, tipY);
    w.runToRest(20, 0.0005);
    const cb = w.balls[0];
    return cb.onTable ? { x: cb.x, y: cb.y } : { x: balls[0].x, y: balls[0].y };
  }

  // ---------------- Mini table diagram for menu cards ----------------
  function drawDiagram(canvas, table, setup) {
    const dpr = window.devicePixelRatio || 1, Wc = canvas.clientWidth || 220, Hc = canvas.clientHeight || 124;
    canvas.width = Math.round(Wc * dpr); canvas.height = Math.round(Hc * dpr);
    const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
    const outerL = C.TABLE_L + 2 * (C.CUSHION_W + C.RAIL_W), outerW = C.TABLE_W + 2 * (C.CUSHION_W + C.RAIL_W);
    const s = Math.min(W / outerL, H / outerW) * 0.96, ox = W / 2, oy = H / 2;
    const X = (x) => ox + x * s, Y = (y) => oy - y * s;
    ctx.fillStyle = '#4f2a14';
    ctx.fillRect(X(-outerL / 2), Y(outerW / 2), outerL * s, outerW * s);
    ctx.fillStyle = '#17784a';
    ctx.fillRect(X(-table.L2 - C.CUSHION_W), Y(table.W2 + C.CUSHION_W), (C.TABLE_L + 2 * C.CUSHION_W) * s, (C.TABLE_W + 2 * C.CUSHION_W) * s);
    for (const p of table.pockets) {
      ctx.fillStyle = '#050505'; ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), p.r * s, 0, Math.PI * 2); ctx.fill();
      if (setup.pocket === p.name) { ctx.strokeStyle = '#f2c200'; ctx.lineWidth = 2 * dpr; ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), p.r * s + 3 * dpr, 0, Math.PI * 2); ctx.stroke(); }
    }
    if (setup.zone) {
      const z = setup.zone;
      ctx.fillStyle = 'rgba(120,230,255,0.25)'; ctx.strokeStyle = 'rgba(120,230,255,0.9)'; ctx.lineWidth = 1.2 * dpr;
      ctx.beginPath(); ctx.arc(X(z.x), Y(z.y), Math.max(z.r * s, 3 * dpr), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    const cb = setup.balls.find(b => b.num === 0), obs = setup.balls.filter(b => b.num !== 0);
    if (setup.pocket && obs.length === 1) { // arrows: cue -> object ball -> pocket
      const p = table.pockets.find(q => q.name === setup.pocket), o = obs[0];
      ctx.setLineDash([3 * dpr, 3 * dpr]); ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1 * dpr;
      ctx.beginPath(); ctx.moveTo(X(cb.x), Y(cb.y)); ctx.lineTo(X(o.x), Y(o.y)); ctx.stroke();
      ctx.strokeStyle = 'rgba(242,194,0,0.9)';
      ctx.beginPath(); ctx.moveTo(X(o.x), Y(o.y)); ctx.lineTo(X(p.mouth.x), Y(p.mouth.y)); ctx.stroke(); ctx.setLineDash([]);
    }
    const br = Math.max(R * s, 2.2 * dpr);
    for (const b of setup.balls) {
      if (b.onTable === false) continue;
      ctx.fillStyle = QB.BALL_COLORS[b.num] || '#888';
      ctx.beginPath(); ctx.arc(X(b.x), Y(b.y), br, 0, Math.PI * 2); ctx.fill();
      if (b.num >= 9) { ctx.fillStyle = '#f6f4ec'; ctx.beginPath(); ctx.arc(X(b.x), Y(b.y), br * 0.55, 0, Math.PI * 2); ctx.fill(); }
    }
  }

  QB.Setups = { GAMES, DRILLS, drawDiagram, randomBalls, DIAMOND: D };
})();
