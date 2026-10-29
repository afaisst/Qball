// Qball — app controller: input, game flow, test mode UI.
(function () {
  const C = QB.C, R = C.BALL_R, DEG = 180 / Math.PI;
  const $ = (id) => document.getElementById(id);

  const table = QB.buildTable();
  const world = new QB.World(table, QB.defaultParams());
  const renderer = new QB.Renderer($('table'), table);
  let view3d = null;   // 3D cue's-eye view (needs WebGL + three.js)
  try { if (window.THREE) view3d = new QB.CueView($('cueView'), table); } catch (e) { console.warn('Cue view unavailable:', e); }
  const stageEl = $('stage');
  const cueViewOn = () => !!view3d && S.view !== '2d';
  // ---- touch (iPad / tablet): there is no hover, so aiming is done by dragging and shooting with the side cue ----
  // Touch mode can also be switched on for a mouse (button in the top bar): then the mouse works like a finger.
  const realTouch = (ev) => ev.pointerType === 'touch' || ev.pointerType === 'pen';
  const isTouchPtr = (ev) => realTouch(ev) || !!S.touchMode;
  function noteInput(ev) {
    const t = isTouchPtr(ev);
    if (t !== document.body.classList.contains('touch')) { document.body.classList.toggle('touch', t); setTimeout(onResize, 0); }
  }
  try { if (navigator.maxTouchPoints > 0 && window.matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch'); } catch (e) { /* ignore */ }
  window.addEventListener('pointerdown', noteInput, true);

  // ---------------- App state ----------------
  const S = {
    mode: 'play',          // 'play' | 'test'
    view: 'split',         // '2d' | 'split' | '3d'
    mapOn: false,          // 3D-only view: show the small top-view map
    phase: 'aim',          // 'aim' | 'pull' | 'strike' | 'moving' | 'drag'
    aim: 0,                // rad
    aimLocked: false,
    pull: 0,               // m
    pullStart: null,
    strikeT: 0, strikeFrom: 0, strikeSpeed: 0,
    dragBall: null, dragOffset: null,
    moveMode: false,
    ballInHand: 'kitchen', // false | 'kitchen' | 'anywhere' (play mode)
    acc: 0,                // physics time accumulator
    timeScale: 1,
    setup: null,           // snapshot of ball positions before the last shot
    lastShot: null,        // {angle, speed (cue), tipX, tipY}
    tipX: 0, tipY: 0,      // cue tip contact point, units of R (right / up, as seen by the shooter)
    elev: 0,               // cue elevation, degrees (0 = level)
    refCueSpeed: 2.5,      // cue speed for the after-contact preview when not pulling (play mode)
    cbPath: null, cbKey: '', cbT: 0,
    report: null,
    contacts: [],          // ghost positions at ball-ball contacts (last shot)
    prediction: null, predKey: '', predT: 0,
    pointer: null,
    shiftDown: false,
    selBall: null,         // object ball shown in the test-mode setup inputs
    chalk: [],             // blue chalk marks left on the cloth by draw / elevated shots
    act: { kind: 'game', id: 'free', shots: 0, pocketed: [] },   // current game / drill
  };

  let cue = null, ob = null;
  // Replace all balls on the table (list of {num, x, y}); the cue ball is num 0.
  function setBalls(list) {
    world.balls = [];
    for (const b of list) { const q = world.addBall(b.num, b.x, b.y); if (b.onTable === false) q.onTable = false; }
    cue = world.balls.find(b => b.num === 0);
    ob = world.balls.find(b => b.num !== 0) || null;
    S.selBall = ob;
    S.setup = null; S.lastShot = null; S.prediction = null; S.predKey = ''; S.cbKey = ''; S.cbPath = null; S.report = null;
    world.events = []; S.contacts = []; S.phase = 'aim'; S.acc = 0; S.pull = 0; S.chalk = [];
    if (view3d) view3d.unfreeze();
  }
  setBalls(QB.Setups.GAMES.find(g => g.id === 'free').balls(table));
  S.aim = Math.atan2(ob.y - cue.y, ob.x - cue.x);

  // ---------------- Helpers ----------------
  // Pull-back sets the cue (stick) speed; the cue-ball speed then also depends on the tip offset.
  const speedFromPull = (p) => C.MAX_CUE_SPEED * Math.min(1, p / C.MAX_PULL);
  const pullFromSpeed = (v) => C.MAX_PULL * Math.min(1, v / C.MAX_CUE_SPEED);
  // ---------------- Cue over the rail ----------------
  // Within RAIL_RANGE of the cushion behind the cue ball the cue has to pass over the cushion. With a level cue
  // that means hitting high on the ball; raising the cue frees up lower contact points. If the chosen contact
  // point can't be reached, the cue is displaced upward (toward follow) to the lowest point that clears.
  const RAIL_RANGE = 0.20, NOSE_TOP = C.CUSHION_H_FRAC * 2 * R, CUE_R = 0.0065;
  // What the cue has to pass over: the cushions (nose to rail, including the jaw facings). At a pocket there is no
  // cushion: the cue passes over the mouth, the throat and the hole, and the first thing it meets is the rail
  // behind the hole. So near a pocket the obstacle is set back and lower contact points (draw) become possible.
  // Open area = playing surface ∪ each pocket's mouth (between the jaws) ∪ its throat + hole (convex hull).
  const openPolys = (() => {
    const hull = (pts) => {                 // monotone chain, counter-clockwise
      pts = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
      const cr = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
      const lo = [], up = [];
      for (const q of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
      for (let i = pts.length - 1; i >= 0; i--) { const q = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
      return lo.slice(0, -1).concat(up.slice(0, -1));
    };
    const ends = [];                        // cushion ends: nose end P and jaw end J (at the rail)
    for (const cu of table.cushions) { ends.push({ P: cu.pts[1], J: cu.pts[0] }); ends.push({ P: cu.pts[2], J: cu.pts[3] }); }
    const polys = [hull([{ x: -table.L2, y: -table.W2 }, { x: table.L2, y: -table.W2 }, { x: table.L2, y: table.W2 }, { x: -table.L2, y: table.W2 }])];
    for (const pk of table.pockets) {
      const two = ends.slice().sort((e, f) => Math.hypot(e.P.x - pk.mouth.x, e.P.y - pk.mouth.y) - Math.hypot(f.P.x - pk.mouth.x, f.P.y - pk.mouth.y)).slice(0, 2);
      polys.push(hull([two[0].P, two[0].J, two[1].J, two[1].P]));                        // mouth, between the jaws
      const circ = []; for (let k = 0; k < 32; k++) circ.push({ x: pk.x + pk.r * Math.cos(k * Math.PI / 16), y: pk.y + pk.r * Math.sin(k * Math.PI / 16) });
      polys.push(hull([two[0].J, two[1].J, ...circ]));                                   // throat and hole
    }
    return polys;
  })();
  const inPoly = (poly, x, y) => {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) < -1e-9) return false;
    }
    return true;
  };
  const exitPoly = (poly, x, y, ux, uy) => {  // distance along (ux,uy) from (x,y) (inside) to the polygon edge
    let t = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], nx = b.y - a.y, ny = -(b.x - a.x);   // outward normal (CCW)
      const dn = ux * nx + uy * ny;
      if (dn > 1e-12) t = Math.min(t, ((a.x - x) * nx + (a.y - y) * ny) / dn);
    }
    return Math.max(0, t);
  };
  function noseDist(px, py, ux, uy) {        // distance from (px,py) along (ux,uy) to the first rail/cushion the cue crosses
    let t = 0;
    for (let k = 0; k < 6; k++) {             // hop from one open region into the next (table -> mouth -> throat/hole)
      const x = px + ux * (t + 1e-5), y = py + uy * (t + 1e-5);
      let best = -1;
      for (const poly of openPolys) if (inPoly(poly, x, y)) best = Math.max(best, t + 1e-5 + exitPoly(poly, x, y, ux, uy));
      if (best <= t + 1e-5) break;
      t = best;
    }
    return t;
  }
  const nearRail = () => !!cue && cue.onTable && noseDist(cue.x, cue.y, -Math.cos(S.aim), -Math.sin(S.aim)) < RAIL_RANGE;
  // clearance (m) between the bottom of the cue and the cushion top for a hit at (a, b) in units of R; >= 0 = OK
  function railClear(a, b) {
    const th = S.elev / DEG, ct = Math.cos(th), sn = Math.sin(th), dx = Math.cos(S.aim), dy = Math.sin(S.aim);
    const c = Math.sqrt(Math.max(0, 1 - a * a - b * b)), along = R * (b * sn - c * ct);
    const px = cue.x + along * dx + R * a * dy, py = cue.y + along * dy - R * a * dx;   // contact point (horizontal)
    const pz = R + R * (b * ct + c * sn);                                               // contact point height
    return pz + noseDist(px, py, -dx, -dy) * Math.tan(th) - CUE_R - NOSE_TOP;
  }
  // effective tip position actually used for the shot
  function computeEffTip() {
    let x = S.tipX, y = S.tipY, moved = false, blocked = false;
    if (nearRail() && railClear(x, y) < 0) {
      const ymax = Math.sqrt(Math.max(0, C.TIP_MAX * C.TIP_MAX - x * x));
      let yy = y; while (yy < ymax && railClear(x, yy) < 0) yy += 0.005;
      yy = Math.min(yy, ymax); blocked = railClear(x, yy) < 0;
      y = Math.round(yy * 1000) / 1000; moved = true;
    }
    S.eff = { x, y, moved, blocked };
    return S.eff;
  }
  const eff = () => S.eff || computeEffTip();
  const impactNow = (cueSpeed) => QB.cueImpact(world.params, cueSpeed, S.aim, eff().x, eff().y, S.elev / DEG);
  const launchAngle = () => impactNow(1).angle; // aim + squirt (+ miscue deflection)
  const squirtLine = () => $('optSquirtLine').checked;  // helper lines follow the real launch direction?
  const normAng = (a) => Math.atan2(Math.sin(a), Math.cos(a));

  function setStatus(msg, flash) {
    const el = $('status'); el.textContent = msg; el.classList.toggle('flash', !!flash);
  }
  function defaultStatus() {
    if (S.ballInHand) return setStatus(`Ball in hand (${S.ballInHand === 'kitchen' ? 'behind the head string' : 'anywhere'}) — drag the cue ball, then aim & shoot`);
    if (S.act.kind === 'drill' && S.mode !== 'test') return setStatus(drillById(S.act.id).goal);
    if (S.act.kind === 'lesson') return setStatus(lessonStatus());
    if (placeMode() && S.arrange) return setStatus('Arrange: drag balls from the panel onto the table (drag a ball off the table or double-click it to remove). Then click the Arranging button (or press M) to shoot.');
    setStatus(S.mode === 'test'
      ? 'Test mode — drag balls to set up, aim, then pull back & release (or Enter to shoot at the set speed)'
      : 'Aim with the mouse · press & drag back to pull the cue · release to shoot');
  }

  function validSpot(b, x, y) {
    if (Math.abs(x) > table.L2 - R || Math.abs(y) > table.W2 - R) return false;
    for (const o of world.balls) if (o !== b && o.onTable && Math.hypot(o.x - x, o.y - y) < 2 * R - 1e-9) return false;
    return true;
  }
  // Clamp to table and resolve overlaps by pushing out from other balls.
  function placeBall(b, x, y, region) {
    const xmax = region === 'kitchen' ? table.headString : table.L2 - R;
    x = Math.max(-table.L2 + R, Math.min(xmax, x));
    y = Math.max(-table.W2 + R, Math.min(table.W2 - R, y));
    for (let k = 0; k < 3; k++) for (const o of world.balls) {
      if (o === b || !o.onTable) continue;
      const dx = x - o.x, dy = y - o.y, d = Math.hypot(dx, dy);
      if (d < 2 * R) { const s = (2 * R + 1e-6) / (d || 1e-6); x = o.x + (d ? dx : 1) * s; y = o.y + (d ? dy : 0) * s; }
    }
    if (validSpot(b, x, y) && (region !== 'kitchen' || x <= table.headString + 1e-9)) {
      b.x = x; b.y = y; b.onTable = true; b.stop(); b.trail = [];
      return true;
    }
    return false;
  }
  function spotBall(b, spot) {
    // try the spot, then spiral outward until a free position is found
    for (let k = 0; k < 2000; k++) {
      const r = k * 0.0015, a = k * 0.7;
      const x = spot.x + r * Math.cos(a), y = spot.y + r * Math.sin(a);
      if (validSpot(b, x, y)) { b.x = x; b.y = y; b.onTable = true; b.stop(); b.pocketedIn = null; b.trail = []; return; }
    }
  }

  function clearShotMarks() { world.clearTrails(); S.contacts = []; }
  function snapshot() { return world.balls.map(b => ({ x: b.x, y: b.y, onTable: b.onTable })); }
  function restore(snap) {
    if (!snap) return;
    world.balls.forEach((b, i) => { b.x = snap[i].x; b.y = snap[i].y; b.onTable = snap[i].onTable; b.pocketedIn = null; b.stop(); b.trail = []; });
    S.contacts = []; S.phase = 'aim'; S.acc = 0;
  }

  // ---------------- Shooting ----------------
  function beginStrike(speed) {
    if (!cue.onTable || speed <= 0) return;
    S.strikeSpeed = speed;
    S.strikeFrom = Math.max(S.pull, pullFromSpeed(speed));
    S.strikeT = 0;
    S.phase = 'strike';
  }
  function doStrike() {
    S.setup = snapshot();
    const T = computeEffTip();
    S.lastShot = { angle: S.aim, speed: S.strikeSpeed, tipX: T.x, tipY: T.y, elev: S.elev, params: Object.assign({}, world.params) };
    if (S.mode === 'play') S.refCueSpeed = S.strikeSpeed;
    world.events = []; world.clearTrails(); S.contacts = [];
    if (view3d) view3d.freeze(view3d.poseFor(cue, S.aim, S.elev / DEG));   // keep watching from where the shot was taken
    // chalk mark: with draw (low hit) or a raised cue the chalked spot on the cue ball is pressed into
    // the cloth right away and leaves a little blue smudge just ahead of where the ball sat
    if (T.y < -0.2 || S.elev > 15) {
      const f = 0.006 + Math.random() * 0.014, j = (Math.random() - 0.5) * 0.004;
      S.chalk.push({ x: cue.x + Math.cos(S.aim) * f - Math.sin(S.aim) * j, y: cue.y + Math.sin(S.aim) * f + Math.cos(S.aim) * j,
        ang: S.aim, len: 0.012 + Math.min(0.014, S.strikeSpeed * 0.003), a: 0.55 + Math.random() * 0.25 });
      if (S.chalk.length > 40) S.chalk.shift();
    }
    const imp = world.cueStrike(cue, S.strikeSpeed, S.aim, T.x, T.y, S.elev / DEG);
    S.report = { cueSpeed: S.strikeSpeed, speed: imp.speed, squirt: imp.squirt, tipX: T.x, tipY: T.y, elev: S.elev, miscue: imp.miscue, launch: imp.angle,
      w0: [cue.wx, cue.wy, cue.wz], angle: S.aim, t0: world.time, cushions: 0, pockets: [], first: null, cbRoll: null,
      lowest: Math.min(...world.balls.filter(b => b.num !== 0 && b.onTable).map(b => b.num)) };
    if (imp.miscue) QB.Sound.miscue(); else QB.Sound.cue(imp.speed);
    S.ballInHand = false;
    S.pull = 0; S.phase = 'moving'; S.acc = 0;
    if (imp.miscue) setStatus('Miscue! The tip slid off the cue ball.', true); else setStatus('Rolling…');
  }

  function processEvents() {
    const rep = S.report;
    for (const e of world.events) {
      if (e.type === 'ball') {
        QB.Sound.ball(e.speed);
        S.contacts.push({ x: e.ax, y: e.ay }, { x: e.bx, y: e.by });
        if (rep && !rep.firstHit && (e.a === cue.id || e.b === cue.id))
          rep.firstHit = { num: world.balls[e.a === cue.id ? e.b : e.a].num, t: e.t };
        if (rep && !rep.first && (e.a === cue.id || e.b === cue.id)) {
          const cueIsA = e.a === cue.id;
          const vin = cueIsA ? [e.pre.avx, e.pre.avy] : [e.pre.bvx, e.pre.bvy];
          const cOut = cueIsA ? [e.post.avx, e.post.avy] : [e.post.bvx, e.post.bvy];
          const oOut = cueIsA ? [e.post.bvx, e.post.bvy] : [e.post.avx, e.post.avy];
          const n = cueIsA ? [e.nx, e.ny] : [-e.nx, -e.ny];
          const inAng = Math.atan2(vin[1], vin[0]);
          const w = cueIsA ? e.pre.aw : e.pre.bw, vm = Math.hypot(vin[0], vin[1]) || 1e-9;
          // follow/draw ratio: spin about the horizontal axis perpendicular to travel, in units of rolling spin
          const rollRatio = (w[1] * vin[0] - w[0] * vin[1]) * R / (vm * vm);
          const rel = (v) => normAng(Math.atan2(v[1], v[0]) - inAng) * DEG;
          rep.first = {
            t: e.t - rep.t0, vin: Math.hypot(vin[0], vin[1]),
            slip: cueIsA ? e.pre.aSlip : e.pre.bSlip,
            cut: rel(n), obDir: rel(oOut), obSpeed: Math.hypot(oOut[0], oOut[1]),
            cbDir: rel(cOut), cbSpeed: Math.hypot(cOut[0], cOut[1]), inAng, rollRatio, wz: w[2],
          };
        }
      } else if (e.type === 'cushion') {
        QB.Sound.cushion(e.speed);
        if (rep) { rep.cushions++; (rep.railTimes = rep.railTimes || []).push(e.t); }
      } else if (e.type === 'pocket') {
        QB.Sound.pocket();
        startDrop(e);
        if (rep) rep.pockets.push({ ball: world.balls[e.ball].num, pocket: e.pocketName });
      } else if (e.type === 'roll' && rep && rep.first && !rep.cbRoll && e.ball === cue.id && e.t > rep.t0 + rep.first.t) {
        rep.cbRoll = { dir: normAng(Math.atan2(e.vy, e.vx) - rep.first.inAng) * DEG, speed: Math.hypot(e.vx, e.vy) };
      }
    }
    world.events = [];
  }

  function endShot() {
    processEvents();
    if (view3d) view3d.unfreeze();
    S.phase = 'aim';
    const rep = S.report;
    if (rep) rep.duration = world.time - rep.t0;
    const msgs = [];
    if (rep) for (const p of rep.pockets) msgs.push(`${p.ball === 0 ? 'Cue ball' : p.ball + '-ball'} → ${p.pocket} pocket`);
    const scratched = !cue.onTable;
    if (scratched) {
      if (S.mode === 'test' && S.act.kind !== 'drill') { msgs.push('Scratch!'); spotBall(cue, S.setup ? S.setup[cue.id] : table.headSpot); }
      else if (S.act.kind === 'game') {
        // ball in hand: anywhere, except after a scratch on the 8-ball break (behind the head string)
        const kitchen = S.act.id === '8ball' && S.act.shots === 0;
        spotBall(cue, table.headSpot); S.ballInHand = kitchen ? 'kitchen' : 'anywhere';
        msgs.push(`Scratch — ball in hand${kitchen ? ' behind the head string' : ''}`);
      }
    }
    if (S.act.kind === 'game') afterGameShot(rep, msgs);
    else if (S.act.kind === 'drill') afterDrillShot(rep, scratched);
    else if (S.act.kind === 'lesson') afterLessonShot(rep, scratched);
    renderReport();
    if (S.act.kind !== 'drill' && S.act.kind !== 'lesson') { if (msgs.length) setStatus(msgs.join(' · '), true); else defaultStatus(); }
    updateActivityUI();
    syncInputs(true);
  }

  // ---------------- Input ----------------
  const canvas = $('table');
  function ballAt(p) {
    let best = null;
    for (const b of world.balls) if (b.onTable && Math.hypot(b.x - p.x, b.y - p.y) < R * 1.3) best = b;
    return best;
  }
  const placeMode = () => S.act.kind === 'game' && S.act.id === 'place';
  const isMap = () => S.view === '3d';     // in 3D-only view the top view is the small map
  function returnToShot() {
    // the cue came along: you're back at the shot, aiming the way you were facing
    if (view3d && view3d.walk) { view3d.stopWalk(); S.walkDrag = false; setStatus('Back at your shot, aiming the way you were facing.'); }
  }
  // Walk mode (3D only): stand up where you are; move the blue dot on the map, drag the 3D view to look around
  function startWalking() {
    if (!view3d || S.view !== '3d' || view3d.walk) return;
    view3d.startWalk();
    setStatus('Walking: drag the blue dot on the map to move (or click where to go) · drag the blue view cone to look at a spot (you keep facing it as you walk) · wheel / pinch on the 3D view to bend down · 🚶 again, double-click the map or pick up the cue: back to your shot.');
  }
  function toggleWalk() { if (view3d && view3d.walk) returnToShot(); else startWalking(); }
  function canDrag(b, shift) {
    if (!b) return false;
    if (S.mode === 'test') return b === cue || S.moveMode || shift;
    if (placeMode()) return S.arrange || shift || b === cue;   // free ball placement: arrange anything
    return b === cue && !!S.ballInHand;   // ball in hand after a scratch / for the break
  }

  canvas.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    QB.Sound.init();
    const p = renderer.toWorld(ev.clientX, ev.clientY);
    S.pointer = p;
    const b = S.phase === 'aim' ? ballAt(p) : null;
    if (isMap() && !(b && canDrag(b, ev.shiftKey))) {
      // 3D-only view: the small map never aims or shoots; it places balls in hand and steers walking
      if (view3d) {
        startWalking();
        if (view3d.walk) {
          // drag the blue dot to move, drag the view cone to turn, click anywhere else to walk there
          const w = view3d.walk;
          if (view3d.focusAt(p.x, p.y)) S.walkDrag = 'focus';      // the fixed point (crosshair)
          else if (view3d.walkerAt(p.x, p.y)) S.walkDrag = 'dot';
          else if (view3d.coneAt(p.x, p.y)) { S.walkDrag = 'cone'; S.coneDrag = { yaw0: w.yaw, a0: Math.atan2(p.y - w.y, p.x - w.x) }; }
          else S.walkDrag = 'glide';
          if (S.walkDrag === 'dot' || S.walkDrag === 'glide') view3d.moveWalker(p.x, p.y, S.walkDrag === 'glide');
          canvas.setPointerCapture(ev.pointerId);
        }
      }
      return;
    }
    if (S.phase !== 'aim') return;
    if (canDrag(b, ev.shiftKey)) {
      S.phase = 'drag'; S.dragBall = b; S.dragOffset = { x: b.x - p.x, y: b.y - p.y };
      canvas.classList.add('grabbing');
    } else if ((S.mode === 'test' && S.moveMode) || (placeMode() && S.arrange)) {
      return;
    } else if (isTouchPtr(ev)) {
      // touch: drag to aim. Starting on/near the cue ball = fine aiming (sideways finger motion turns the cue slowly).
      if (!cue.onTable || S.aimLocked) return;
      const nearR = Math.max(0.08, 30 * renderer.view.dpr / renderer.view.scale);
      const fine = Math.hypot(p.x - cue.x, p.y - cue.y) < nearR;
      S.touchAim = { fine, a0: S.aim, p0: p };
      if (!fine) touchAimTo(p);
    } else if (cue.onTable) {
      // press anywhere: drag back to pull the cue and shoot; a plain click (no drag) freezes / unfreezes the aim
      S.phase = 'pull'; S.pullStart = p; S.pull = 0; S.pressPx = { x: ev.clientX, y: ev.clientY };
    } else return;
    canvas.setPointerCapture(ev.pointerId);
  });

  function touchAimTo(p) {
    const t = S.touchAim; if (!t) return;
    if (t.fine) {          // 1 cm of sideways finger motion (on the table scale) ≈ 0.1°
      const nx = -Math.sin(t.a0), ny = Math.cos(t.a0);
      S.aim = normAng(t.a0 + ((p.x - t.p0.x) * nx + (p.y - t.p0.y) * ny) / 5);
    } else if (Math.hypot(p.x - cue.x, p.y - cue.y) > R * 1.3) S.aim = Math.atan2(p.y - cue.y, p.x - cue.x);
  }
  canvas.addEventListener('pointermove', (ev) => {
    const p = renderer.toWorld(ev.clientX, ev.clientY);
    if (S.touchAim) { S.pointer = p; touchAimTo(p); return; }
    S.pointer = p;
    if (S.walkDrag === 'focus') {            // move the fixed point; it snaps onto a ball when dropped near one
      let fx = p.x, fy = p.y;
      for (const b of world.balls) if (b.onTable && Math.hypot(b.x - p.x, b.y - p.y) < 0.04) { fx = b.x; fy = b.y; }
      view3d.setFocus(fx, fy);
      return;
    }
    if (S.walkDrag === 'cone') {             // turn: the cone follows the pointer around the dot
      const w = view3d.walk; if (w) view3d.setYaw(S.coneDrag.yaw0 + normAng(Math.atan2(p.y - w.y, p.x - w.x) - S.coneDrag.a0));
      return;
    }
    if (S.walkDrag) { view3d.moveWalker(p.x, p.y, S.walkDrag === 'glide'); return; }
    if (S.phase === 'drag') {
      const region = (S.mode === 'play' && S.dragBall === cue && S.ballInHand === 'kitchen') ? 'kitchen' : null;
      const nx = p.x + S.dragOffset.x, ny = p.y + S.dragOffset.y;
      if (placeMode() && S.dragBall !== cue && (Math.abs(nx) > table.L2 + 0.03 || Math.abs(ny) > table.W2 + 0.03)) {
        S.dragBall.onTable = false;          // dragged off the table -> back to the panel
      } else placeBall(S.dragBall, nx, ny, region);
      clearShotMarks();
      syncInputs();
    } else if (S.phase === 'pull') {
      const dx = Math.cos(S.aim), dy = Math.sin(S.aim);
      const back = -((p.x - S.pullStart.x) * dx + (p.y - S.pullStart.y) * dy);
      S.pull = Math.max(0, Math.min(C.MAX_PULL, back));
    } else if (S.phase === 'aim' && !S.aimLocked && cue.onTable && !isMap() && ev.pointerType === 'mouse' && !S.touchMode) {
      if (Math.hypot(p.x - cue.x, p.y - cue.y) > R * 1.3) S.aim = Math.atan2(p.y - cue.y, p.x - cue.x);   // aim follows the mouse
    }
    // cursor hint
    canvas.classList.toggle('grab', (S.phase === 'aim' && canDrag(ballAt(p), ev.shiftKey || S.shiftDown))
      || (isMap() && !!view3d && !!view3d.walk && (view3d.focusAt(p.x, p.y) || view3d.walkerAt(p.x, p.y) || view3d.coneAt(p.x, p.y))));
  });

  canvas.addEventListener('pointerup', (ev) => {
    canvas.classList.remove('grabbing');
    if (S.touchAim) { S.touchAim = null; return; }
    if (S.walkDrag) {
      S.walkDrag = false; view3d.endMove();
      // touch has no double-click: a quick double tap on the map returns to the shot
      if (isTouchPtr(ev)) { const now = performance.now(); if (now - (S.lastMapTap || 0) < 350) { returnToShot(); S.lastMapTap = 0; } else S.lastMapTap = now; }
      return;
    }
    if (S.phase === 'drag') {
      if (S.dragBall !== cue) S.selBall = S.dragBall;
      if (placeMode()) updateActivityUI();
      S.phase = 'aim'; S.dragBall = null; S.setup = null; syncInputs(true); return;
    }
    if (S.phase === 'pull') {
      const moved = S.pressPx ? Math.hypot(ev.clientX - S.pressPx.x, ev.clientY - S.pressPx.y) : 99;
      if (S.pull > 0.004) { beginStrike(speedFromPull(S.pull)); if (S.clickLock) { S.aimLocked = false; S.clickLock = false; } }
      else {
        S.phase = 'aim'; S.pull = 0;
        if (moved < 6) {                     // a click: freeze the aim (so you can go to the panel), click again to release
          S.aimLocked = !S.aimLocked; S.clickLock = S.aimLocked;
          setStatus(S.aimLocked ? 'Aim frozen — set spin and elevation, then drag back on the table to shoot. Click again to release.' : 'Aim follows the mouse again.');
        }
      }
    }
  });
  canvas.addEventListener('pointercancel', () => { if (S.walkDrag) { S.walkDrag = false; view3d.endMove(); } });
  canvas.addEventListener('pointercancel', () => { S.touchAim = null; if (S.phase === 'pull' || S.phase === 'drag') { S.phase = 'aim'; S.pull = 0; } });

  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Shift') S.shiftDown = true;
    if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT' || ev.target.tagName === 'TEXTAREA') { if (ev.key === 'Enter') ev.target.blur(); return; }
    const k = ev.key;
    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
      if (S.phase !== 'aim') return;
      const step = (ev.shiftKey ? 1 : ev.altKey ? 0.01 : 0.1) / DEG;
      S.aim = normAng(S.aim + ((k === 'ArrowLeft' || k === 'ArrowUp') ? step : -step));
      S.aimLocked = true; S.clickLock = false; ev.preventDefault();
    } else if (k === ' ') { S.aimLocked = !S.aimLocked; S.clickLock = false; ev.preventDefault(); }
    else if (k === 'Escape') { if (!$('menu').hidden) showMenu(null); else if (S.phase === 'pull') { S.phase = 'aim'; S.pull = 0; } }
    else if (k === 'Enter') { if (S.phase === 'aim' && S.mode === 'test') shootFromPanel(); }
    else if (k === 't' || k === 'T') setMode(S.mode === 'test' ? 'play' : 'test');
    else if (k === 'v' || k === 'V') setView({ '2d': 'split', split: '3d', '3d': '2d' }[S.view]);
    else if (S.mode === 'test' && (k === 'r' || k === 'R')) replay();
    else if (S.mode === 'test' && (k === 'm' || k === 'M')) toggleMove();
    else if (placeMode() && (k === 'm' || k === 'M')) setArrange(!S.arrange);
    else if (S.mode === 'test' && (k === 'x' || k === 'X')) stopAll();
    else if ('wasdWASD'.includes(k) && k.length === 1) {
      const st = ev.shiftKey ? 0.01 : 0.05, kk = k.toLowerCase();
      setTip(S.tipX + (kk === 'd' ? st : kk === 'a' ? -st : 0), S.tipY + (kk === 'w' ? st : kk === 's' ? -st : 0));
    } else if (k === 'c' || k === 'C') setTip(0, 0);
    else if ('qeQE'.includes(k) && k.length === 1) setElev(S.elev + (k.toLowerCase() === 'e' ? 1 : -1) * (ev.shiftKey ? 5 : 1));
  });
  window.addEventListener('keyup', (ev) => { if (ev.key === 'Shift') S.shiftDown = false; });

  // ---------------- Test-mode actions ----------------
  function shootFromPanel() {
    const v = parseFloat($('inSpeed').value);
    if (!(v > 0)) return;
    S.pull = 0; beginStrike(Math.min(v, 20));
  }
  function replay() {
    if (!S.lastShot || !S.setup || S.phase === 'strike') return;
    restore(S.setup);
    S.aim = S.lastShot.angle;           // (no aim lock: the mouse aims again once the replay is done)
    setTip(S.lastShot.tipX, S.lastShot.tipY); setElev(S.lastShot.elev || 0);
    S.pull = 0; beginStrike(S.lastShot.speed);
  }
  function stopAll() { for (const b of world.balls) b.stop(); }
  function toggleMove() { S.moveMode = !S.moveMode; $('btnMove').classList.toggle('on', S.moveMode); }
  function setCut() {
    const ob = S.selBall;
    if (!cue.onTable || !ob || !ob.onTable) return;
    const phi = parseFloat($('inCut').value) / DEG;
    const d = Math.hypot(ob.x - cue.x, ob.y - cue.y);
    const s = 2 * R * Math.sin(phi) / d;
    if (Math.abs(s) > 1) return;
    // ghost-ball geometry gives the launch direction; subtract squirt to get the cue aim
    // if the helper lines include squirt, compensate so the real launch direction gives this cut
    S.aim = normAng(Math.atan2(ob.y - cue.y, ob.x - cue.x) - Math.asin(s) - (squirtLine() ? launchAngle() - S.aim : 0));
    S.aimLocked = true;
  }

  // ---------------- Cue tip (spin) selector ----------------
  const tipCanvas = $('tipPad');
  function setTip(x, y) {
    if (S.act.kind === 'lesson') {             // lessons limit where the tip may go
      const L = lessonById(S.act.id), tr = L.tipRange;
      if (tr) { x = Math.max(tr.x[0], Math.min(tr.x[1], x)); y = Math.max(tr.y[0], Math.min(tr.y[1], y)); }
    }
    const r = Math.hypot(x, y), m = C.TIP_MAX;
    if (r > m) { x *= m / r; y *= m / r; }
    S.tipX = Math.round(x * 1000) / 1000; S.tipY = Math.round(y * 1000) / 1000;
    drawTipPad(); syncTipInputs(); if (typeof drawElevPad === 'function') drawElevPad();
  }
  function tipLabel() {
    const v = eff().y, h = eff().x, parts = [];
    if (Math.abs(v) < 0.005 && Math.abs(h) < 0.005) return 'center ball';
    if (Math.abs(v) >= 0.005) parts.push(`${v > 0 ? 'follow' : 'draw'} ${Math.abs(v).toFixed(2)}R`);
    if (Math.abs(h) >= 0.005) parts.push(`${h > 0 ? 'right' : 'left'} ${Math.abs(h).toFixed(2)}R`);
    return parts.join(' · ');
  }
  function tipWords() {
    const v = eff().y, h = eff().x, parts = [];
    const mag = (a) => a < 0.15 ? 'a little ' : a < 0.35 ? '' : 'strong ';
    if (Math.abs(v) < 0.03 && Math.abs(h) < 0.03) return 'center';
    if (Math.abs(v) >= 0.03) parts.push(mag(Math.abs(v)) + (v > 0 ? 'follow' : 'draw'));
    if (Math.abs(h) >= 0.03) parts.push(mag(Math.abs(h)) + (h > 0 ? 'right' : 'left') + ' english');
    return parts.join(' + ');
  }
  function drawTipPad() {
    const ctx = tipCanvas.getContext('2d'), dpr = window.devicePixelRatio || 1;
    const css = tipCanvas.clientWidth || 150;
    if (tipCanvas.width !== Math.round(css * dpr)) { tipCanvas.width = tipCanvas.height = Math.round(css * dpr); }
    const W = tipCanvas.width, c = W / 2, r = W * 0.42;
    ctx.clearRect(0, 0, W, W);
    // ball
    const g = ctx.createRadialGradient(c - r * 0.35, c - r * 0.4, r * 0.1, c, c, r);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.6, '#ecebe4'); g.addColorStop(1, '#a9a79d');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.fill();
    // grid
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = dpr;
    for (const f of [-0.5, 0, 0.5]) {
      ctx.beginPath(); ctx.moveTo(c - r, c + f * r); ctx.lineTo(c + r, c + f * r); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(c + f * r, c - r); ctx.lineTo(c + f * r, c + r); ctx.stroke();
    }
    // miscue limit
    ctx.setLineDash([4 * dpr, 4 * dpr]); ctx.strokeStyle = 'rgba(200,16,46,0.6)';
    ctx.beginPath(); ctx.arc(c, c, r * QB.miscueLimit(world.params), 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    // natural-roll marker (0.4R above center)
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.arc(c, c - 0.4 * r, 2 * dpr, 0, Math.PI * 2); ctx.fill();
    // near a rail: shade the part of the ball the cue can't reach at this elevation (it would hit the cushion)
    const E = computeEffTip();
    if (cue && nearRail()) {
      const n = 44, cell = 2 * r / n;
      ctx.save(); ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = 'rgba(220,40,40,0.38)';
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const a = (i + 0.5) / n * 2 - 1, b = 1 - (j + 0.5) / n * 2;
        if (a * a + b * b > 1) continue;
        if (railClear(a, b) < 0) ctx.fillRect(c - r + i * cell, c - r + j * cell, cell + 0.6, cell + 0.6);
      }
      ctx.restore();
    }
    // tip (12.75 mm tip -> radius ~0.22R): chosen point (outline) and the point the cue really reaches (filled)
    if (E.moved) {
      ctx.setLineDash([3 * dpr, 3 * dpr]); ctx.strokeStyle = 'rgba(30,30,30,0.7)'; ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.arc(c + S.tipX * r, c - S.tipY * r, r * 0.12, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
    if (S.act.kind === 'lesson') lessonPadOverlay(ctx, c, r, dpr);
    const tx = c + E.x * r, ty = c - E.y * r;
    const mis = Math.hypot(E.x, E.y) > QB.miscueLimit(world.params) + 1e-9;
    ctx.fillStyle = mis || E.blocked ? 'rgba(220,40,40,0.9)' : 'rgba(59,111,216,0.85)';
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * dpr;
    ctx.beginPath(); ctx.arc(tx, ty, r * 0.12, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    $('tipVal').textContent = (S.mode === 'test' ? tipLabel() : tipWords()) + (E.blocked ? ' — raise the cue!' : E.moved ? ' (over the rail)' : '') + (mis ? ' — MISCUE' : '');
    $('tipVal').classList.toggle('warn', mis || E.blocked);
    S.padKey = padKey();
  }
  // the pad depends on where the cue ball is and where we aim (rail shading): redraw when that changes
  const padKey = () => cue ? [cue.x.toFixed(3), cue.y.toFixed(3), S.aim.toFixed(3), S.elev, S.tipX, S.tipY, cue.onTable].join('|') : '';
  function tipFromEvent(ev) {
    const rect = tipCanvas.getBoundingClientRect(), c = rect.width / 2, r = rect.width * 0.42;
    setTip((ev.clientX - rect.left - c) / r, -(ev.clientY - rect.top - c) / r);
  }
  tipCanvas.addEventListener('pointerdown', (ev) => { tipCanvas.setPointerCapture(ev.pointerId); tipFromEvent(ev); });
  tipCanvas.addEventListener('pointermove', (ev) => { if (ev.buttons & 1) tipFromEvent(ev); });
  tipCanvas.addEventListener('dblclick', () => setTip(0, 0));
  // ---------------- Cue elevation selector (side view) ----------------
  const elevCanvas = $('elevPad');
  function setElev(deg) {
    if (S.act.kind === 'lesson') deg = 0;      // lessons are played with a level cue
    S.elev = Math.round(Math.max(0, Math.min(C.MAX_ELEV, deg)) * 10) / 10;
    drawTipPad(); drawElevPad();
    const el = $('inElev'); if (el && document.activeElement !== el) el.value = S.elev.toFixed(1);
  }
  function drawElevPad() {
    const ctx = elevCanvas.getContext('2d'), dpr = window.devicePixelRatio || 1;
    const css = elevCanvas.clientWidth || 120;
    if (elevCanvas.width !== Math.round(css * dpr)) { elevCanvas.width = elevCanvas.height = Math.round(css * dpr); }
    const W = elevCanvas.width, r = W * 0.17, cx = W * 0.70, cy = W * 0.80 - r;
    ctx.clearRect(0, 0, W, W);
    // cloth
    ctx.fillStyle = '#145c39'; ctx.fillRect(0, cy + r, W, W - cy - r);
    // ball
    const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
    g.addColorStop(0, '#fff'); g.addColorStop(0.6, '#ecebe4'); g.addColorStop(1, '#a9a79d');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    // cue: from the contact point back along the cue axis (side view, cue comes from the left)
    const th = S.elev / DEG, ce = Math.cos(th), se = Math.sin(th);
    const E = eff(), rho2 = Math.min(0.9, E.x * E.x + E.y * E.y), c = Math.sqrt(1 - rho2), b = E.y;
    const Px = cx + r * (b * se - c * ce), Py = cy - r * (b * ce + c * se);
    const L = W * 0.9, ex = ce, ey = se;  // cue axis in screen coords (y down): tip points right & down, butt up-left
    const bx = Px - ex * L, by = Py - ey * L;
    const nx = -ey, ny = ex;
    const w0 = r * 0.16, w1 = r * 0.34;
    ctx.fillStyle = '#e3c48f';
    ctx.beginPath(); ctx.moveTo(Px + nx * w0, Py + ny * w0); ctx.lineTo(bx + nx * w1, by + ny * w1);
    ctx.lineTo(bx - nx * w1, by - ny * w1); ctx.lineTo(Px - nx * w0, Py - ny * w0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#3b6fd8'; ctx.beginPath(); ctx.arc(Px, Py, w0 * 1.1, 0, Math.PI * 2); ctx.fill();
    // angle arc
    if (S.elev > 0.5) {
      ctx.strokeStyle = 'rgba(242,194,0,0.9)'; ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.arc(Px, Py, r * 1.9, Math.PI, Math.PI + th); ctx.stroke();
      ctx.setLineDash([3 * dpr, 3 * dpr]); ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath(); ctx.moveTo(Px, Py); ctx.lineTo(Px - r * 2.6, Py); ctx.stroke(); ctx.setLineDash([]);
    }
    $('elevVal').textContent = S.elev < 0.05 ? 'level' : S.mode === 'test' ? `${S.elev.toFixed(1)}°`
      : S.elev < 10 ? 'slightly raised' : S.elev < 35 ? 'raised' : 'massé';
  }
  function elevFromEvent(ev) {
    const rect = elevCanvas.getBoundingClientRect(), W = rect.width;
    const cx = W * 0.70, cy = W * 0.80 - W * 0.17;
    const dx = cx - (ev.clientX - rect.left), dy = cy - (ev.clientY - rect.top);
    setElev(Math.atan2(dy, Math.max(1e-3, dx)) * DEG);
  }
  elevCanvas.addEventListener('pointerdown', (ev) => { elevCanvas.setPointerCapture(ev.pointerId); elevFromEvent(ev); });
  elevCanvas.addEventListener('pointermove', (ev) => { if (ev.buttons & 1) elevFromEvent(ev); });
  elevCanvas.addEventListener('dblclick', () => setElev(0));

  function syncTipInputs() {
    for (const [id, key] of [['inTipX', 'tipX'], ['inTipY', 'tipY']]) {
      const el = $(id); if (el && document.activeElement !== el) el.value = S[key].toFixed(3);
    }
  }

  function setMode(m) {
    S.mode = m;
    document.body.classList.toggle('test', m === 'test');
    $('testBadge').hidden = m !== 'test';
    $('lnkTest').textContent = m === 'test' ? 'leave test mode' : 'test mode';
    if (m === 'play') { S.moveMode = false; $('btnMove').classList.remove('on'); }
    world.recordTrails = true;
    clearShotMarks();
    setTimeout(onResize, 0);
    drawTipPad(); drawElevPad();
    defaultStatus(); syncInputs(true);
  }

  // ---------------- Games & drills ----------------
  const gameById = (id) => QB.Setups.GAMES.find(g => g.id === id);
  const drillById = (id) => QB.Setups.DRILLS.find(d => d.id === id);
  function aimAt(b) { if (b && cue) S.aim = Math.atan2(b.y - cue.y, b.x - cue.x); }

  function startGame(id) {
    const g = gameById(id);
    setBalls(g.balls(table));
    S.act = { kind: 'game', id, shots: 0, pocketed: [], rack: world.balls.filter(b => b.num !== 0).map(b => b.num).sort((x, y) => x - y), won: false };
    S.ballInHand = id === 'place' ? false : 'kitchen'; S.aimLocked = false;
    S.arrange = id === 'place';
    aimAt(world.balls.find(b => b.num === 1) || ob);
    updateActivityUI(); defaultStatus(); renderReport(); syncInputs(true);
  }
  function startDrill(id, n) {
    const d = drillById(id);
    if (d.type === 'pattern') {
      S.act = { kind: 'drill', pattern: true, id, n: n || (d.levels ? d.levels.start : null), attempt: 1, attempts: 10,
        cleared: 0, total: 0, potted: 0, done: false, last: null };
      setupPatternAttempt();
      return;
    }
    S.act = { kind: 'drill', id, pos: 4, shot: 1, bonus: 0, done: false, last: null };
    setupDrillAttempt();
  }
  // Pattern drills: ball in hand, then run the balls. Each shot must be legal and pocket a ball.
  function setupPatternAttempt() {
    const a = S.act, d = drillById(a.id);
    const balls = d.balls(table, a.n);
    // start the cue ball in the kitchen, at the spot farthest from the object balls (it's ball in hand anyway)
    let best = table.headSpot, bestD = -1;
    for (let ix = 0; ix <= 6; ix++) for (let iy = -4; iy <= 4; iy++) {
      const q = { x: -table.L2 + 0.1 + ix * (table.L2 / 2 - 0.1) / 6, y: iy * (table.W2 - 0.1) / 4 };
      const dmin = Math.min(...balls.map(b => Math.hypot(b.x - q.x, b.y - q.y))) - 0.02 * Math.abs(iy);
      if (dmin > bestD) { bestD = dmin; best = q; }
    }
    setBalls([{ num: 0, x: best.x, y: best.y }].concat(balls));
    spotBall(cue, best);
    a.rack = balls.map(b => b.num).sort((x, y) => x - y);
    a.potted = 0; a.zone = null; a.pocket = null;
    S.ballInHand = 'anywhere'; S.aimLocked = false;
    aimAt(world.balls.filter(b => b.num !== 0).sort((p, q) => p.num - q.num)[0]);
    updateActivityUI(); renderReport(); syncInputs(true);
    setStatus(`Try ${a.attempt} of ${a.attempts} — ball in hand. ${d.order === 'any' ? 'Any order.' : d.order === 'sequence' ? 'Pocket them in numerical order.' : 'Hit the lowest ball first each shot.'}`);
  }
  function afterPatternShot(rep, scratched) {
    const a = S.act, d = drillById(a.id); if (a.done || !rep) return;
    const potted = rep.pockets.filter(p => p.ball !== 0).map(p => p.ball);
    const fh = rep.firstHit;
    let why = null;
    if (scratched) why = 'scratch';
    else if (!fh) why = 'no ball hit';
    else if (d.order !== 'any' && fh.num !== rep.lowest) why = `wrong ball first (hit the ${fh.num}, needed the ${rep.lowest})`;
    else if (!potted.length) why = 'nothing pocketed';
    else if (d.order === 'sequence' && !potted.includes(rep.lowest)) why = `the ${rep.lowest} must go first`;
    const left = world.balls.filter(b => b.num !== 0 && b.onTable).length;
    if (!why) {
      a.potted += potted.length;
      if (left > 0) { setStatus(`✓ ${potted.length > 1 ? potted.length + ' balls' : 'Ball'} down — ${left} to go`, true); updateActivityUI(); return; }
      a.cleared++; a.total += a.potted; a.last = { ok: true, msg: `✓ Cleared all ${a.potted}!` };
    } else {
      a.total += a.potted; a.last = { ok: false, msg: `✗ ${why} — ${a.potted} of ${a.rack.length} pocketed` };
    }
    if (a.attempt >= a.attempts) {
      a.done = true;
      if (!cue.onTable) { spotBall(cue, table.headSpot); S.ballInHand = 'anywhere'; }
      setStatus(`${a.last.msg}. Drill finished: cleared ${a.cleared} of ${a.attempts}, ${a.total} balls pocketed.`, true);
    } else {
      a.attempt++;
      setStatus(`${a.last.msg} — next layout coming…`, true);
      S.phase = 'wait';
      const act = a;
      setTimeout(() => { if (S.act === act && S.phase === 'wait') setupPatternAttempt(); }, 1600);
    }
  }
  function setupDrillAttempt() {
    const a = S.act, d = drillById(a.id);
    const st = d.setup(table, a.pos, world);
    setBalls(st.balls);
    a.zone = st.zone || null; a.pocket = st.pocket;
    S.ballInHand = false; S.aimLocked = false;
    aimAt(ob);
    updateActivityUI(); defaultStatus(); renderReport(); syncInputs(true);
  }
  function restartActivity() {
    if (S.phase === 'moving') stopAll();
    if (S.act.kind === 'drill') startDrill(S.act.id, S.act.n);
    else if (S.act.kind === 'lesson') startLesson(S.act.id);
    else startGame(S.act.id);
  }

  function afterGameShot(rep, msgs) {
    const a = S.act;
    a.shots++;
    if (rep) for (const p of rep.pockets) if (p.ball !== 0) a.pocketed.push(p.ball);
    if (a.id === 'place') return;                // free ball placement: pocketed balls simply return to the panel
    if (a.id === 'free') {                       // free practice: re-spot the object ball
      if (ob && !ob.onTable) spotBall(ob, table.footSpot);
      return;
    }
    const gameBall = a.id === '9ball' ? 9 : a.id === '10ball' ? 10 : 8;
    const pottedNow = rep ? rep.pockets.filter(p => p.ball !== 0).map(p => p.ball) : [];
    if ((a.id === '9ball' || a.id === '10ball') && rep && !a.won) {
      // Rotation rules (WPA, simplified for solo practice):
      //  - the cue ball must hit the lowest-numbered ball first,
      //  - after that contact a ball must be pocketed or some ball (cue ball included) must reach a rail,
      //  - scratch is a foul. Any foul -> ball in hand anywhere; a game ball pocketed on a foul is re-spotted.
      let foul = null;
      const fh = rep.firstHit;
      if (!cue.onTable || rep.pockets.some(p => p.ball === 0)) foul = 'scratch';
      else if (!fh) foul = 'no ball hit';
      else if (fh.num !== rep.lowest) foul = `wrong ball first (hit the ${fh.num}, needed the ${rep.lowest})`;
      else if (!pottedNow.length && !(rep.railTimes || []).some(t => t >= fh.t - 1e-9)) foul = 'no rail after contact';
      const gbDown = pottedNow.includes(gameBall);
      const respotGB = () => {
        const gb = world.balls.find(b => b.num === gameBall);
        spotBall(gb, table.footSpot); a.pocketed = a.pocketed.filter(n => n !== gameBall);
      };
      if (foul) {
        S.ballInHand = 'anywhere';
        if (foul !== 'scratch') msgs.push(`Foul: ${foul} — ball in hand`);
        if (gbDown) { respotGB(); msgs.push(`${gameBall}-ball re-spotted`); }
      } else if (gbDown) {
        const others = world.balls.filter(b => b.num !== 0 && b.onTable).length;
        if (a.id === '10ball' && others > 0) { respotGB(); msgs.push('10-ball pocketed early — re-spotted'); }
        else { a.won = true; msgs.push(`🏆 ${gameBall}-ball made — rack won in ${a.shots} shot${a.shots === 1 ? '' : 's'}! Re-rack from the panel.`); }
      }
      return;
    }
    const left = world.balls.filter(b => b.num !== 0 && b.onTable).length;
    if (left === 0) msgs.push(`Rack cleared in ${a.shots} shot${a.shots === 1 ? '' : 's'}! 🎱 Re-rack from the panel.`);
    else if (pottedNow.includes(gameBall)) msgs.push(`The ${gameBall}-ball is down (${left} ball${left === 1 ? '' : 's'} left) — re-rack or keep practicing.`);
  }

  function afterDrillShot(rep, scratched) {
    const a = S.act; if (a.done) return;
    if (a.pattern) return afterPatternShot(rep, scratched);
    const d = drillById(a.id);
    const obBall = world.balls.find(b => b.num !== 0);
    const pocketName = obBall && !obBall.onTable && obBall.pocketedIn != null ? table.pockets[obBall.pocketedIn].name : null;
    let ok = pocketName === a.pocket && !scratched;
    let why = '';
    if (!pocketName) why = 'object ball not pocketed';
    else if (pocketName !== a.pocket) why = 'wrong pocket';
    else if (scratched) why = 'scratch';
    if (ok && a.zone) {
      const inZone = Math.hypot(cue.x - a.zone.x, cue.y - a.zone.y) <= a.zone.r;
      if (!inZone) { ok = false; why = 'cue ball missed the target'; }
    }
    // Billiard University progression: make it -> up a level, miss -> down a level (1..7); bonus for makes at 7
    const lvl = a.pos;
    if (ok) { if (lvl === 7) a.bonus++; a.pos = Math.min(7, lvl + 1); } else a.pos = Math.max(1, lvl - 1);
    a.last = { ok, why, lvl };
    if (a.shot >= 10) {
      a.done = true;
      a.score = Math.min(10, a.pos + a.bonus);
      setStatus(`${ok ? '✓' : '✗'} ${ok ? 'Made it' : why}. Drill finished — score ${a.score} / 10.`, true);
    } else {
      a.shot++;
      setStatus(`${ok ? '✓ Made it' : '✗ ' + why} — next: level ${a.pos}`, true);
      S.phase = 'wait';
      const act = a;
      setTimeout(() => { if (S.act === act && S.phase === 'wait') setupDrillAttempt(); }, 1400);
    }
  }
  function changeDrillLevel(delta) {
    const a = S.act; if (a.kind !== 'drill' || S.phase === 'moving') return;
    if (a.pattern) {   // pattern drills with a ball count: change it and start over
      const lv = drillById(a.id).levels; if (!lv) return;
      startDrill(a.id, Math.max(lv.min, Math.min(lv.max, a.n + delta)));
      return;
    }
    a.pos = Math.max(1, Math.min(7, a.pos + delta));
    setupDrillAttempt();
  }

  function updateActivityUI() {
    $('lessonHud').hidden = S.act.kind !== 'lesson';
    if (S.act.kind === 'lesson') return updateLessonUI();
    const a = S.act, isDrill = a.kind === 'drill';
    const d = isDrill ? drillById(a.id) : null, g = !isDrill ? gameById(a.id) : null;
    $('actTitle').textContent = isDrill ? `Drill · ${d.name}` : g.name;
    $('actInfo').textContent = isDrill ? d.goal : g.blurb;
    $('drillHud').hidden = !isDrill;
    const hasLevels = isDrill && (!a.pattern || !!d.levels);
    for (const el of document.querySelectorAll('.drill-only')) el.hidden = !hasLevels;
    $('btnRack').textContent = isDrill ? 'Restart drill' : a.id === 'place' ? 'Clear table' : 'Re-rack';
    for (const el of document.querySelectorAll('.place-only')) el.hidden = a.id !== 'place';
    if (a.id === 'place') arrangeButton();
    $('levelDots').hidden = !!a.pattern;
    if (isDrill && a.pattern) {
      $('drillShotLbl').textContent = 'Try';
      $('drillShot').textContent = a.done ? 'done' : `${a.attempt} / ${a.attempts}`;
      $('drillScoreLbl').textContent = 'Cleared · balls';
      $('drillScore').textContent = `${a.cleared} · ${a.total + (a.done ? 0 : a.potted)}`;
      const r = $('drillResult');
      r.textContent = a.last ? a.last.msg : (d.levels ? `${a.n} ${d.levels.label} — "harder" adds one` : 'Run them all without missing.');
      r.className = 'result' + (a.last ? (a.last.ok ? ' ok' : ' bad') : '');
    } else if (isDrill) {
      $('drillShotLbl').textContent = 'Shot'; $('drillScoreLbl').textContent = 'Score';
      $('levelDots').innerHTML = [1, 2, 3, 4, 5, 6, 7].map(i => `<span class="${i === a.pos ? 'on' : ''}">${i}</span>`).join('');
      $('drillShot').textContent = a.done ? 'done' : `${a.shot} / 10`;
      $('drillScore').textContent = a.done ? `${a.score} / 10` : (a.bonus ? `bonus ${a.bonus}` : '–');
      const r = $('drillResult');
      r.textContent = a.last ? (a.last.ok ? `✓ Made it at level ${a.last.lvl}` : `✗ ${a.last.why} (level ${a.last.lvl})`) : 'Level 4 to start. Make it to move up.';
      r.className = 'result' + (a.last ? (a.last.ok ? ' ok' : ' bad') : '');
    }
    const showTray = (!isDrill && a.id !== 'free') || !!a.pattern;
    $('trayBox').hidden = !showTray;
    if (showTray) {
      const onTable = new Set(world.balls.filter(b => b.num !== 0 && b.onTable).map(b => b.num));
      const rotation = a.id === '9ball' || a.id === '10ball' || (a.pattern && drillById(a.id).order !== 'any');
      const next = rotation && onTable.size ? Math.min(...onTable) : null;
      const place = a.id === 'place';
      $('tray').innerHTML = (a.rack || []).map(n => {
        const cls = place ? (onTable.has(n) ? 'up' : 'down avail') : (onTable.has(n) ? 'up' : 'down');
        const tip = place ? (onTable.has(n) ? 'on the table (drag it there)' : 'drag onto the table') : (onTable.has(n) ? 'on the table' : 'pocketed');
        return `<i data-n="${n}" class="${n >= 9 ? 'stripe ' : ''}${cls}${n === next ? ' next' : ''}" style="background:${QB.BALL_COLORS[n]}" title="${n}-ball ${tip}"><b>${n}</b></i>`;
      }).join('');
      $('trayLabel').textContent = a.id === 'place' ? 'Drag a ball onto the table (faded = already on the table)'
        : rotation ? 'Balls (pocketed = solid, next ball ringed)' : 'Balls (pocketed = solid)';
    }
  }

  // ---------------- Lessons (js/lessons.js): step-by-step introductions ----------------
  const lessonById = (id) => QB.LESSONS.find(l => l.id === id);
  const lessonStepObj = () => { const a = S.act, L = lessonById(a.id); return L.steps[a.step] || null; };
  function startLesson(id) {
    const L = lessonById(id);
    S.act = { kind: 'lesson', id, step: 0, results: L.steps.map(() => ({})), done: false, last: null };
    placeLessonBalls();
    setTip(0, 0); setElev(0);
    updateActivityUI(); renderReport(); syncInputs(true); defaultStatus();
    lessonModal(L.intro.title, L.intro.html, [{ label: "Let's start", primary: true, run: () => showLessonStep() }]);
  }
  function placeLessonBalls() {
    const a = S.act, L = lessonById(a.id);
    if (S.phase === 'moving') stopAll();
    setBalls(L.balls(table));
    S.ballInHand = false; S.aimLocked = true; S.clickLock = false;
    const ob = world.balls.find(b => b.num === L.aimAt);
    a.aim = Math.atan2(ob.y - cue.y, ob.x - cue.x); S.aim = a.aim;
    a.start = { cx: cue.x, cy: cue.y, ox: ob.x, oy: ob.y };
    clearShotMarks();
  }
  function showLessonStep() {
    const a = S.act, L = lessonById(a.id), st = lessonStepObj();
    if (!st) return;
    lessonModal(`Step ${a.step + 1} of ${L.steps.length} · ${st.title}`, st.html, [{ label: 'Got it', primary: true }]);
    updateActivityUI(); defaultStatus(); drawTipPad();
  }
  function lessonBand(speed) { const L = lessonById(S.act.id); return L.bands.find(b => speed < b.max) || L.bands[L.bands.length - 1]; }
  function lessonStatus() {
    const a = S.act, st = lessonStepObj();
    if (a.done || !st) return 'Lesson complete — repeat it, or pick another lesson from the Lessons tab.';
    const left = lessonById(a.id).bands.filter(b => !a.results[a.step][b.id]).map(b => b.name.toLowerCase());
    return `${st.title}: tip ${st.tip.label} · still to try: ${left.join(', ')}`;
  }
  function tipOkForStep(st) { return st && Math.abs(S.tipX) < 0.02 && Math.abs(S.tipY - st.tip.y) <= st.tip.tol; }
  function describeResult(r) {
    if (r.scratch) return 'cue ball went in the pocket';
    const cm = Math.round(Math.abs(r.d) * 100);
    return r.cls === 'stop' ? `stopped${cm >= 1 ? ` (${cm} cm)` : ''}` : r.cls === 'follow' ? `followed ${cm} cm` : `drew back ${cm} cm`;
  }
  function afterLessonShot(rep, scratched) {
    const a = S.act, L = lessonById(a.id), st = lessonStepObj();
    if (!st || a.done || !S.lastShot) { setTimeout(placeLessonBalls, 900); return; }
    const band = lessonBand(S.lastShot.speed);
    // how far the cue ball travelled after the hit, along the shot line (+ = follow, − = draw)
    const ux = Math.cos(a.aim), uy = Math.sin(a.aim), hx = a.start.ox - ux * 2 * R, hy = a.start.oy - uy * 2 * R;
    const d = cue.onTable ? (cue.x - hx) * ux + (cue.y - hy) * uy : 0;
    const res = { d, scratch: scratched, cls: scratched ? 'scratch' : Math.abs(d) <= 0.05 ? 'stop' : d > 0 ? 'follow' : 'draw' };
    const counts = tipOkForStep(st);
    if (counts) a.results[a.step][band.id] = res;
    a.last = { band: band.name, res, counts };
    setStatus(counts ? `${band.name}: ${describeResult(res)}.` : `${band.name}: ${describeResult(res)} — but for this step put the tip ${st.tip.label}. This one doesn't count.`, true);
    updateActivityUI();
    const complete = L.bands.every(b => a.results[a.step][b.id]);
    setTimeout(() => {
      if (S.act !== a) return;
      placeLessonBalls(); updateActivityUI();
      if (!complete) return;
      const rows = L.bands.map(b => `<tr><td><b>${b.name}</b></td><td>${describeResult(a.results[a.step][b.id])}</td></tr>`).join('');
      const last = a.step === L.steps.length - 1;
      lessonModal(`Step ${a.step + 1} · ${st.title}`, st.done(`<table>${rows}</table>`), [{ label: last ? 'Finish' : 'Next step', primary: true, run: () => {
        if (last) { a.done = true; updateActivityUI(); defaultStatus();
          lessonModal(L.finish.title, L.finish.html, [{ label: 'Repeat the lesson', run: () => startLesson(L.id) }, { label: 'All lessons', run: () => showMenu('lessons') }, { label: 'Close', primary: true }]);
        } else { a.step++; setTip(0, 0); showLessonStep(); }
      } }]);
    }, 1300);
  }
  function updateLessonUI() {
    const a = S.act, L = lessonById(a.id), st = lessonStepObj();
    $('actTitle').textContent = `Lesson ${L.num} · ${L.name}`;
    $('actInfo').textContent = a.done ? 'Lesson complete.' : st ? `Step ${a.step + 1}: ${st.title.toLowerCase()} — put the tip ${st.tip.label}, then shoot soft, medium and hard.` : '';
    $('drillHud').hidden = true; $('trayBox').hidden = true;
    for (const el of document.querySelectorAll('.drill-only, .place-only')) el.hidden = true;
    $('btnRack').textContent = 'Restart lesson';
    $('lessonSteps').innerHTML = L.steps.map((s, i) => `<span class="${i === a.step && !a.done ? 'on' : i < a.step || a.done ? 'done' : ''}">${i + 1}. ${s.title}</span>`).join('');
    $('lessonBands').innerHTML = L.bands.map(b => `<span data-b="${b.id}">${b.name}</span>`).join('');
    const res = a.done ? {} : a.results[a.step] || {};
    $('lessonResults').innerHTML = a.done ? '<span class="ok">✓</span><span class="ok">All steps done.</span>'
      : L.bands.map(b => `<span class="b">${b.name}</span>${res[b.id] ? `<span class="ok">✓ ${describeResult(res[b.id])}</span>` : '<span class="todo">not yet</span>'}`).join('');
    S.lessonMeterKey = null;
  }
  // strength meter: which band the current pull (or the last shot) is in
  function lessonMeter() {
    const L = lessonById(S.act.id);
    const v = S.phase === 'pull' ? speedFromPull(S.pull) : S.phase === 'strike' ? S.strikeSpeed : null;
    const id = v !== null && v !== undefined ? lessonBand(v).id : '';
    if (id === S.lessonMeterKey) return;
    S.lessonMeterKey = id;
    for (const el of document.querySelectorAll('#lessonBands span')) el.classList.toggle('on', el.dataset.b === id);
  }
  // on the cue-ball diagram: the line the tip may move on, and the step's target
  function lessonPadOverlay(ctx, c, r, dpr) {
    const L = lessonById(S.act.id), st = lessonStepObj(), tr = L.tipRange;
    ctx.save();
    ctx.strokeStyle = 'rgba(59,111,216,0.45)'; ctx.lineWidth = 3 * dpr; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(c + tr.x[0] * r, c - tr.y[1] * r); ctx.lineTo(c + tr.x[0] * r, c - tr.y[0] * r); ctx.stroke();
    if (st && !S.act.done) {
      ctx.strokeStyle = '#3fbf6f'; ctx.lineWidth = 2.5 * dpr; ctx.setLineDash([4 * dpr, 3 * dpr]);
      ctx.beginPath(); ctx.arc(c, c - st.tip.y * r, r * 0.17, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }
  // pop-up: title, html, buttons [{label, primary, run}]
  function lessonModal(title, html, buttons) {
    $('lmTitle').textContent = title; $('lmBody').innerHTML = html;
    const box = $('lmBtns'); box.innerHTML = '';
    for (const b of buttons) {
      const el = document.createElement('button'); el.textContent = b.label; if (b.primary) el.className = 'primary';
      el.onclick = () => { $('lessonModal').hidden = true; if (b.run) b.run(); };
      box.appendChild(el);
    }
    $('lessonModal').hidden = false;
  }
  $('btnLessonHelp').onclick = () => { if (S.act.kind === 'lesson' && !S.act.done) showLessonStep(); };

  // ---------------- Free ball placement ----------------
  function setArrange(on) { S.arrange = !!on; arrangeButton(); defaultStatus(); }
  function arrangeButton() {
    $('btnArrange').classList.toggle('on', !!S.arrange);
    $('btnArrange').textContent = S.arrange ? '✋ Arranging — click to shoot (M)' : '✋ Arrange balls (M)';
  }
  // drag a ball from the panel onto the table
  const trayEl = $('tray');
  trayEl.addEventListener('pointerdown', (ev) => {
    const it = ev.target.closest('i[data-n]'); if (!it || !placeMode() || S.phase !== 'aim') return;
    const b = world.balls.find(q => q.num === +it.dataset.n); if (!b) return;
    if (b.onTable) return;                                  // already on the table: drag it there
    S.trayDrag = { ball: b, x: ev.clientX, y: ev.clientY, moved: false };
    document.body.classList.add('placing');
    ev.preventDefault();
  });
  window.addEventListener('pointermove', (ev) => {
    const d = S.trayDrag; if (!d) return;
    if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 4) d.moved = true;
    const r = canvas.getBoundingClientRect();
    const inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
    const p = renderer.toWorld(ev.clientX, ev.clientY);
    if (inside && Math.abs(p.x) < table.L2 && Math.abs(p.y) < table.W2) { placeBall(d.ball, p.x, p.y); clearShotMarks(); }
    else d.ball.onTable = false;
  });
  window.addEventListener('pointerup', () => {
    const d = S.trayDrag; if (!d) return;
    S.trayDrag = null; document.body.classList.remove('placing');
    if (!d.moved && !d.ball.onTable) spotBall(d.ball, table.footSpot);   // a plain click puts it near the foot spot
    S.setup = null; updateActivityUI();
  });
  canvas.addEventListener('dblclick', (ev) => {
    const b = S.phase === 'aim' ? ballAt(renderer.toWorld(ev.clientX, ev.clientY)) : null;
    if (placeMode() && b && b !== cue) { b.onTable = false; b.stop(); updateActivityUI(); return; }
    if (isMap()) returnToShot();          // double-click the map: back to the shooting position, standing
  });
  $('btnArrange').onclick = () => setArrange(!S.arrange);
  $('btnRestoreSetup').onclick = () => { if (S.phase !== 'moving' && S.setup) { restore(S.setup); updateActivityUI(); setStatus('Back to the position before the last shot.', true); } };

  // ---------------- Menus ----------------
  function showMenu(which) {
    $('menu').hidden = !which;
    $('menuGames').hidden = which !== 'games';
    $('menuDrills').hidden = which !== 'drills';
    $('menuLessons').hidden = which !== 'lessons';
    $('tabLessons').classList.toggle('active', which === 'lessons');
    $('tabTable').classList.toggle('active', !which);
    $('tabGames').classList.toggle('active', which === 'games');
    $('tabDrills').classList.toggle('active', which === 'drills');
    if (which) buildCards(which);
  }
  let cardsBuilt = {};
  function buildCards(which) {
    if (cardsBuilt[which]) return;
    cardsBuilt[which] = true;
    if (which === 'lessons') {
      const box = $('lessonCards'); box.innerHTML = '';
      for (const L of QB.LESSONS) {
        const card = document.createElement('button'); card.className = 'card';
        card.innerHTML = `<canvas></canvas><div class="cbody"><div class="ctitle">${L.name}<span class="ctag">Lesson ${L.num}</span></div><div class="cdesc">${L.blurb}</div></div>`;
        box.appendChild(card);
        requestAnimationFrame(() => QB.Setups.drawDiagram(card.querySelector('canvas'), table, { balls: L.balls(table) }));
        card.onclick = () => { showMenu(null); startLesson(L.id); };
      }
      return;
    }
    const box = $(which === 'games' ? 'gameCards' : 'drillCards');
    // Free Ball Placement is implemented like a game but listed first under Drills
    const items = which === 'games' ? QB.Setups.GAMES.filter(g => g.menu !== 'drills')
      : QB.Setups.GAMES.filter(g => g.menu === 'drills').concat(QB.Setups.DRILLS);
    box.innerHTML = '';
    for (const it of items) {
      const card = document.createElement('button');
      card.className = 'card';
      const tag = it.tag || (it.id === 'place' ? 'Your setup' : '');
      card.innerHTML = `<canvas></canvas><div class="cbody"><div class="ctitle">${it.name}${tag ? `<span class="ctag">${tag}</span>` : ''}</div><div class="cdesc">${it.blurb || it.goal}</div></div>`;
      box.appendChild(card);
      const isGame = !!QB.Setups.GAMES.find(g => g.id === it.id);
      const setup = isGame ? { balls: it.preview ? it.preview(table) : it.balls(table) }
        : it.type === 'pattern' ? { balls: [{ num: 0, x: table.headSpot.x, y: 0 }].concat(it.balls(table, it.levels ? it.levels.start : 0)) }
        : it.setup(table, 4, world);
      requestAnimationFrame(() => QB.Setups.drawDiagram(card.querySelector('canvas'), table, setup));
      card.onclick = () => { showMenu(null); if (QB.Setups.GAMES.find(g => g.id === it.id)) startGame(it.id); else startDrill(it.id); };
    }
  }

  // ---------------- Share / reproduce shots ----------------
  // A shot = pre-shot ball positions + aim + cue speed + tip + elevation + all physics parameters.
  function shotJSON() {
    const r4 = (v) => Math.round(v * 1e5) / 1e5;
    let balls, sh;
    if (S.lastShot && S.setup) {
      balls = world.balls.map((b, i) => ({ num: b.num, x: r4(S.setup[i].x), y: r4(S.setup[i].y), onTable: S.setup[i].onTable }));
      sh = S.lastShot;
    } else {
      balls = world.balls.map(b => ({ num: b.num, x: r4(b.x), y: r4(b.y), onTable: b.onTable }));
      sh = { angle: S.aim, speed: parseFloat($('inSpeed').value) || 2, tipX: S.tipX, tipY: S.tipY, elev: S.elev, params: world.params };
    }
    return JSON.stringify({ qball: 1, balls, aimDeg: Math.round(sh.angle * DEG * 1e4) / 1e4, cueSpeed: sh.speed,
      tipX: sh.tipX, tipY: sh.tipY, elevDeg: sh.elev || 0, params: sh.params || world.params });
  }
  function copyShot() {
    const txt = shotJSON(), ta = $('shotText');
    $('shareBox').hidden = false; ta.value = txt; ta.select();
    const done = () => setStatus('Shot copied to the clipboard (also shown in the box) — paste it into the chat to share it.', true);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, () => { document.execCommand('copy'); done(); });
      else { document.execCommand('copy'); done(); }
    } catch (e) { setStatus('Copy the selected text in the box below.', true); }
  }
  function loadShot(shootNow) {
    let o;
    try { o = JSON.parse($('shotText').value); } catch (e) { setStatus('Could not read the shot text (not valid JSON).', true); return; }
    if (!o || !Array.isArray(o.balls)) { setStatus('That is not a Qball shot.', true); return; }
    if (S.phase !== 'aim') stopAll();
    if (o.params) { Object.assign(world.params, o.params); buildParams(); }
    const same = o.balls.length === world.balls.length && o.balls.every(sb => world.balls.some(q => q.num === sb.num));
    if (!same) { setBalls(o.balls); S.act = { kind: 'game', id: 'free', shots: 0, pocketed: [] }; updateActivityUI(); }
    for (const sb of o.balls) {
      const b = world.balls.find(q => q.num === sb.num); if (!b) continue;
      b.x = sb.x; b.y = sb.y; b.onTable = sb.onTable !== false; b.pocketedIn = null; b.stop(); b.trail = [];
    }
    clearShotMarks();
    S.aim = normAng((o.aimDeg || 0) / DEG); S.aimLocked = true;
    setTip(o.tipX || 0, o.tipY || 0); setElev(o.elevDeg || 0);
    if (o.cueSpeed) $('inSpeed').value = (+o.cueSpeed).toFixed(3);
    S.setup = snapshot(); S.lastShot = { angle: S.aim, speed: +o.cueSpeed || 2, tipX: S.tipX, tipY: S.tipY, elev: S.elev, params: Object.assign({}, world.params) };
    S.phase = 'aim'; syncInputs(true);
    setStatus('Shot loaded (aim locked — Space to release).', true);
    if (shootNow) { S.pull = 0; beginStrike(S.lastShot.speed); }
  }

  // ---------------- Panel wiring ----------------
  $('btnCopyShot').onclick = copyShot;
  $('btnLoadShot').onclick = () => { $('shareBox').hidden = false; $('shotText').value = ''; $('shotText').focus(); };
  $('btnApplyShot').onclick = () => loadShot(false);
  $('btnApplyShoot').onclick = () => loadShot(true);
  $('lnkTest').onclick = (e) => { e.preventDefault(); setMode(S.mode === 'test' ? 'play' : 'test'); };
  $('tabTable').onclick = () => showMenu(null);
  $('tabGames').onclick = () => showMenu('games');
  $('tabDrills').onclick = () => showMenu('drills');
  $('tabLessons').onclick = () => showMenu('lessons');
  $('btnMenu').onclick = () => showMenu(S.act.kind === 'lesson' ? 'lessons' : S.act.kind === 'drill' || S.act.id === 'place' ? 'drills' : 'games');
  $('btnRack').onclick = restartActivity;
  $('btnEasier').onclick = () => changeDrillLevel(-1);
  $('btnHarder').onclick = () => changeDrillLevel(+1);
  $('btnMove').onclick = toggleMove;
  $('btnRestore').onclick = () => { if (S.phase !== 'moving') restore(S.setup); };
  $('btnShoot').onclick = () => { if (S.phase === 'aim') shootFromPanel(); };
  $('btnReplay').onclick = replay;
  $('btnStop').onclick = stopAll;
  $('btnSetCut').onclick = setCut;
  $('btnTipCenter').onclick = () => setTip(0, 0);
  $('btnLevel').onclick = () => setElev(0);
  $('inElev').addEventListener('change', (e) => { const v = parseFloat(e.target.value); if (isFinite(v)) setElev(v); });
  $('optSquirtLine').onchange = () => { S.cbKey = ''; };
  $('optGrid').onchange = (e) => { renderer.practiceGrid = e.target.checked; renderer.resize(); if (view3d) view3d.setGrid(e.target.checked); };
  $('inTipX').addEventListener('change', (e) => { const v = parseFloat(e.target.value); if (isFinite(v)) setTip(v, S.tipY); });
  $('inTipY').addEventListener('change', (e) => { const v = parseFloat(e.target.value); if (isFinite(v)) setTip(S.tipX, v); });
  $('optSound').onchange = (e) => { QB.Sound.enabled = e.target.checked; };
  // Touch mode toggle: hidden on touch-only devices (touch mode is always on there)
  const touchOnly = (() => { try { return window.matchMedia('(hover: none) and (pointer: coarse)').matches; } catch (e) { return false; } })();
  function setTouchMode(on, quiet) {
    S.touchMode = !!on && !touchOnly;
    $('btnTouch').classList.toggle('on', S.touchMode);
    if (S.touchMode) document.body.classList.add('touch');
    else if (!touchOnly) document.body.classList.remove('touch');
    try { localStorage.setItem('qball.touch', S.touchMode ? '1' : '0'); } catch (e) { /* ignore */ }
    setTimeout(onResize, 0);
    if (!quiet) setStatus(S.touchMode ? 'Touch mode: drag on the table to aim (start on the cue ball for fine aiming), shoot with the cue on the right.' : 'Touch mode off: the aim follows the mouse; click to freeze it.', true);
  }
  $('btnTouch').hidden = touchOnly;
  $('btnTouch').onclick = () => setTouchMode(!S.touchMode);
  { let saved = false; try { saved = localStorage.getItem('qball.touch') === '1'; } catch (e) { /* ignore */ } if (saved) setTouchMode(true, true); }
  $('optTimeScale').oninput = (e) => { S.timeScale = parseFloat(e.target.value); $('tsVal').textContent = S.timeScale.toFixed(2) + '×'; };

  const posInputs = [['cbx', () => cue, 'x'], ['cby', () => cue, 'y'], ['obx', () => S.selBall, 'x'], ['oby', () => S.selBall, 'y']];
  for (const [id, gb, key] of posInputs) {
    $(id).addEventListener('change', (e) => {
      const b = gb();
      if (S.phase !== 'aim' || !b) return;
      const v = parseFloat(e.target.value); if (!isFinite(v)) return;
      const nx = key === 'x' ? v : b.x, ny = key === 'y' ? v : b.y;
      if (!validSpot(b, nx, ny)) { setStatus('That spot is off the table or overlaps another ball', true); }
      else { b.x = nx; b.y = ny; b.onTable = true; b.stop(); S.setup = null; clearShotMarks(); }
      syncInputs(true);
    });
  }
  $('inAim').addEventListener('change', (e) => {
    const v = parseFloat(e.target.value); if (!isFinite(v)) return;
    S.aim = normAng(v / DEG); S.aimLocked = true;
  });

  // physics sliders
  const PARAMS = [
    { key: 'muSlide', label: 'Sliding friction μs', min: 0.05, max: 0.40, step: 0.005, fmt: 3, note: 'ball–cloth while skidding (typ. 0.15–0.25)' },
    { key: 'muRoll', label: 'Rolling resistance μr', min: 0.002, max: 0.05, step: 0.0005, fmt: 4, note: 'literature 0.005–0.015 (fast–slow cloth)' },
    { key: 'eBall', label: 'Ball–ball restitution', min: 0.5, max: 1.0, step: 0.005, fmt: 3, note: '1 = perfectly elastic; phenolic balls ≈ 0.92–0.98' },
    { key: 'cushionModel', label: 'Cushion model', type: 'select',
      options: [['mathavan', 'Mathavan 2010 (cushion + slate friction)'], ['realistic', 'Han 2005 (single impulse)'], ['simple', 'Simple (spin mirrored, no friction)']],
      note: 'Mathavan: the impact is integrated through compression and restitution with friction at the cushion and at the slate. Han: one instantaneous impulse at the cushion only.' },
    { key: 'cushionHeight', label: 'Cushion nose height (× ball diameter)', min: 0.55, max: 0.75, step: 0.005, fmt: 3, note: 'WPA 0.625–0.645; higher contact = more topspin turned around at the rail' },
    { key: 'eCushion', label: 'Cushion restitution', min: 0.4, max: 1.0, step: 0.005, fmt: 3, note: 'normal-impulse restitution at the cushion nose' },
    { key: 'eCushionSlope', label: 'Cushion e drop per m/s', min: 0, max: 0.1, step: 0.002, fmt: 3, note: 'e = e₀ − k·v_normal: hard hits sink in and come off deader ("speed shortens the angle"); 0 = speed-independent' },
    { key: 'muCushion', label: 'Cushion friction μc', min: 0, max: 0.5, step: 0.01, fmt: 2, note: 'ball–rubber friction (Mathavan / Han models; typ. ≈ 0.2)' },
    { key: 'cueEndMass', label: 'Cue end mass (squirt), kg', min: 0, max: 0.03, step: 0.001, fmt: 3, note: 'side spin deflects the cue ball off the aim line; 0 = no squirt, low-deflection shaft ≈ 0.005' },
    { key: 'tipFriction', label: 'Tip friction (chalk)', min: 0.3, max: 1.0, step: 0.01, fmt: 2, note: 'miscue when the tip offset exceeds μ/√(1+μ²) (dashed ring); 0.66 → 0.55R' },
    { key: 'ballFriction', label: 'Ball–ball friction (throw) ×', min: 0, max: 3, step: 0.05, fmt: 2, note: '× measured curve μ ≈ 0.01–0.11 vs slip speed; 0 = no throw' },
    { key: 'spinDecel', label: 'Side-spin decay, rad/s²', min: 0, max: 40, step: 0.5, fmt: 1, note: 'how fast vertical-axis spin dies on the cloth' },
  ];
  function buildParams() {
    const box = $('params'); box.innerHTML = '';
    for (const p of PARAMS) {
      const lab = document.createElement('label'); lab.className = 'slider';
      if (p.type === 'select') {
        lab.innerHTML = `${p.label}<select id="p_${p.key}">${p.options.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select><small>${p.note}</small>`;
        box.appendChild(lab);
        const sel = lab.querySelector('select');
        sel.value = world.params[p.key];
        sel.onchange = () => { world.params[p.key] = sel.value; };
        continue;
      }
      lab.innerHTML = `${p.label} <b id="pv_${p.key}"></b><input type="range" id="p_${p.key}" min="${p.min}" max="${p.max}" step="${p.step}"><small>${p.note}</small>`;
      box.appendChild(lab);
      const inp = lab.querySelector('input');
      inp.value = world.params[p.key];
      lab.querySelector('b').textContent = (+world.params[p.key]).toFixed(p.fmt);
      inp.oninput = () => { world.params[p.key] = parseFloat(inp.value); lab.querySelector('b').textContent = (+inp.value).toFixed(p.fmt); drawTipPad(); };
    }
  }
  $('btnDefaults').onclick = () => { world.params = Object.assign(world.params, QB.defaultParams()); buildParams(); };
  buildParams();

  function syncInputs(force) {
    for (const [id, gb, key] of posInputs) {
      const el = $(id), b = gb();
      if (force || document.activeElement !== el) el.value = b && b.onTable ? b[key].toFixed(4) : '';
    }
    const sb = S.selBall;
    $('obName').textContent = sb ? `${sb.num}-ball` : 'Object';
    $('obDot').style.background = sb ? QB.BALL_COLORS[sb.num] : '';
  }

  function renderReport() {
    const r = S.report, el = $('report');
    if (!r) { el.innerHTML = '<span class="muted">Take a shot…</span>'; return; }
    const f = (v, d = 2) => (v === undefined || v === null || !isFinite(v)) ? '–' : v.toFixed(d);
    let h = '<table>';
    h += `<tr><td>Cue speed</td><td>${f(r.cueSpeed)} m/s</td></tr>`;
    h += `<tr><td>Tip offset (x, y)</td><td>${f(r.tipX)}R, ${f(r.tipY)}R</td></tr>`;
    h += `<tr><td>Cue-ball speed off tip</td><td>${f(r.speed)} m/s</td></tr>`;
    { // spin off the tip: horizontal spin perpendicular to travel in units of rolling spin, plus side spin
      const c = Math.cos(r.launch), sn = Math.sin(r.launch), v = Math.max(r.speed, 1e-9);
      const roll = (r.w0[1] * c - r.w0[0] * sn) * R / v, masse = (r.w0[0] * c + r.w0[1] * sn);
      h += `<tr><td>Spin off tip: follow/draw</td><td>${f(roll, 2)}× roll</td></tr>`;
      h += `<tr><td>Spin off tip: side / massé axis</td><td>${f(r.w0[2], 1)} / ${f(masse, 1)} rad/s</td></tr>`;
    }
    h += `<tr><td>Cue elevation</td><td>${f(r.elev, 1)}°</td></tr>`;
    h += `<tr><td>Aim angle / squirt</td><td>${f(r.angle * DEG, 2)}° / ${f(r.squirt * DEG, 2)}°</td></tr>`;
    if (r.miscue) h += `<tr><td style="color:#ff6b6b">Miscue</td><td style="color:#ff6b6b">launch ${f(normAng(r.launch - r.angle) * DEG, 1)}° off the aim</td></tr>`;
    if (r.first) {
      const a = r.first;
      h += `<tr><td colspan=2 class="sub">First contact (t = ${f(a.t, 3)} s)</td></tr>`;
      h += `<tr><td>CB speed at impact</td><td>${f(a.vin)} m/s</td></tr>`;
      h += `<tr><td>CB state at impact</td><td>${a.slip < 1e-3 ? 'rolling' : 'sliding (slip ' + f(a.slip) + ' m/s)'}</td></tr>`;
      h += `<tr><td>CB spin at impact</td><td>${f(a.rollRatio, 2)}× roll ${a.rollRatio > 0.98 ? '(natural)' : a.rollRatio < -0.02 ? '(draw)' : a.rollRatio < 0.02 ? '(stun)' : '(follow)'}</td></tr>`;
      h += `<tr><td>CB side spin at impact</td><td>${f(a.wz, 1)} rad/s</td></tr>`;
      h += `<tr><td>Cut angle (line of centers)</td><td>${f(a.cut, 2)}°</td></tr>`;
      h += `<tr><td>OB direction</td><td>${f(a.obDir, 2)}°</td></tr>`;
      h += `<tr><td>Throw (OB dir − line of centers)</td><td>${f(a.obDir - a.cut, 2)}°</td></tr>`;
      h += `<tr><td>OB speed</td><td>${f(a.obSpeed)} m/s</td></tr>`;
      h += `<tr><td>CB direction right after</td><td>${f(a.cbDir, 2)}°</td></tr>`;
      h += `<tr><td>CB speed right after</td><td>${f(a.cbSpeed)} m/s</td></tr>`;
      if (r.cbRoll) h += `<tr><td>CB direction once rolling</td><td>${f(r.cbRoll.dir, 2)}°</td></tr>`;
      h += `<tr><td colspan=2 class="muted" style="font-size:11px;padding-top:2px">Angles relative to the cue ball's incoming direction.</td></tr>`;
    }
    if (r.duration !== undefined) {
      h += `<tr><td colspan=2 class="sub">Result</td></tr>`;
      h += `<tr><td>Duration</td><td>${f(r.duration, 2)} s</td></tr>`;
      h += `<tr><td>Cushion hits</td><td>${r.cushions}</td></tr>`;
      h += `<tr><td>Pocketed</td><td>${r.pockets.length ? r.pockets.map(p => (p.ball === 0 ? 'CB' : p.ball) + ' → ' + p.pocket).join(', ') : 'none'}</td></tr>`;
    }
    el.innerHTML = h + '</table>';
  }

  let liveT = 0;
  function renderLive(now) {
    if (S.mode !== 'test' || now - liveT < 100) return;
    liveT = now;
    let h = '<table>';
    for (const b of world.balls) {
      const name = b.num === 0 ? 'Cue' : b.num + '-ball';
      h += `<tr><td>${name}</td><td>${b.onTable ? b.motion() + ' · ' + b.speed.toFixed(3) + ' m/s' : 'pocketed'}</td></tr>`;
      if (b.onTable && b.motion() !== 'stopped') {
        h += `<tr><td style="padding-left:10px">ω (x,y,z) rad/s</td><td>${b.wx.toFixed(1)}, ${b.wy.toFixed(1)}, ${b.wz.toFixed(1)}</td></tr>`;
      }
    }
    h += `<tr><td>Sim time</td><td>${S.report ? (world.time - S.report.t0).toFixed(2) : '0.00'} s</td></tr>`;
    $('live').innerHTML = h + '</table>';
  }

  // ---------------- Prediction (test mode) ----------------
  function updatePrediction(now) {
    if (S.mode !== 'test' || !$('optPredict').checked || !(S.phase === 'aim' || S.phase === 'pull') || !cue.onTable) { S.prediction = null; return; }
    const speed = S.phase === 'pull' && S.pull > 0 ? speedFromPull(S.pull) : parseFloat($('inSpeed').value) || 0;
    const P = world.params;
    const key = [S.aim.toFixed(6), speed.toFixed(3), eff().x, eff().y, S.elev, ...world.balls.map(b => b.x.toFixed(5) + ',' + b.y.toFixed(5) + b.onTable), JSON.stringify(P)].join('|');
    if (key === S.predKey || now - S.predT < 60) return;
    S.predKey = key; S.predT = now;
    const w = world.clone();
    w.recordTrails = true; w.trailEvery = 0.008;
    w.cueStrike(w.balls[cue.id], speed, S.aim, eff().x, eff().y, S.elev / DEG);
    w.runToRest(12, 0.0005);
    S.prediction = w.balls;
  }

  // ---------------- Cue-ball path after first contact (short preview) ----------------
  // Simulates the shot with the current tip offset and draws the cue ball's path from the first
  // ball contact for ~0.6 m (or up to the next cushion): shows draw / follow / stun.
  function updateCBPath(now) {
    if (!$('optCBPath').checked || !(S.phase === 'aim' || S.phase === 'pull') || !cue.onTable) { S.cbPath = null; return; }
    const speed = (S.phase === 'pull' && S.pull > 0) ? speedFromPull(S.pull)
      : S.mode === 'test' ? (parseFloat($('inSpeed').value) || 0) : S.refCueSpeed;
    S.cbSpeed = speed;
    $('previewVal').textContent = `preview at ${speed.toFixed(2)} m/s cue speed${S.phase === 'pull' ? ' (pull)' : S.mode === 'test' ? ' (test-panel speed)' : ' (last shot)'}`;
    const real = squirtLine();
    const key = [S.aim.toFixed(6), speed.toFixed(3), eff().x, eff().y, S.elev, real, ...world.balls.map(b => b.x.toFixed(5) + ',' + b.y.toFixed(5) + b.onTable), JSON.stringify(world.params)].join('|');
    if (key === S.cbKey || now - S.cbT < 40) return;
    S.cbKey = key; S.cbT = now;
    const w = world.clone(); w.recordTrails = false;
    // With the 'ideal' helper lines (default) the preview ignores squirt so it starts at the drawn ghost ball.
    if (!real) w.params.cueEndMass = 0;
    const c = w.balls[cue.id];
    w.cueStrike(c, speed, S.aim, eff().x, eff().y, S.elev / DEG);
    let contact = false, pts = [], dist = 0, px = 0, py = 0, done = false;
    const pre = real ? [c.x, c.y] : null; let qx = c.x, qy = c.y;   // pre-contact (curved) path
    for (let i = 0; i < 12000 && !done; i++) {
      if (!w.substep(0.0005)) break;
      for (const e of w.events) {
        if (e.type === 'ball' && !contact && (e.a === c.id || e.b === c.id)) {
          contact = true; px = e.a === c.id ? e.ax : e.bx; py = e.a === c.id ? e.ay : e.by; pts.push(px, py);
        } else if (e.type === 'cushion' && e.ball === c.id) { if (contact) done = true; else { S.cbPath = null; return; } }
        else if (e.type === 'pocket' && e.ball === c.id) done = true;
      }
      w.events = [];
      if (pre && !contact && Math.hypot(c.x - qx, c.y - qy) > 0.005) { qx = c.x; qy = c.y; pre.push(qx, qy); }
      if (contact) {
        const d = Math.hypot(c.x - px, c.y - py);
        if (d > 0.005 || done) { dist += d; px = c.x; py = c.y; pts.push(px, py); }
        if (dist > 0.6 || c.motion() === 'stopped') done = true;
      }
    }
    S.cbPath = contact && pts.length >= 4 ? pts : null;
    S.cbPre = pre && contact && pts.length ? pre.concat([pts[0], pts[1]]) : null;
  }

  // ---------------- Main loop ----------------
  let last = performance.now();
  // ---------------- balls dropping into a pocket (visual only; the physics has already pocketed them) ----------------
  // The ball keeps the speed it went in with, falls, bangs off the pocket wall (the deeper it is, the closer the wall:
  // a fast ball rattles, a slow one circles the rim) and settles in the pocket bag, which is a little wider than the
  // hole. It stays there (on top of any balls already in that pocket) until it is re-spotted or the balls are re-racked.
  S.drops = [];
  const DROP_FLOOR = -0.068 + R;                // ball centre resting on the pocket bottom (pocket 7 cm deep in 3D)
  const BAG_EXTRA = 0.02;                       // the bag reaches 2 cm under the rail / cloth beyond the hole
  function startDrop(e) {
    const b = world.balls[e.ball], p = table.pockets[e.pocket];
    if (!b || !p) return;
    let x = e.x !== undefined ? e.x : p.x, y = e.y !== undefined ? e.y : p.y;
    const d = Math.hypot(x - p.x, y - p.y);
    if (d > p.r) { x = p.x + (x - p.x) / d * p.r; y = p.y + (y - p.y) / d * p.r; }   // (balls that left the table)
    S.drops = S.drops.filter(q => q.b !== b);
    S.drops.push({ b, p, x, y, z: R, vx: e.vx || 0, vy: e.vy || 0, vz: 0, t: 0, leaving: 0 });
  }
  function stepDrops(dt) {
    for (const d of S.drops) {
      if (world.balls.indexOf(d.b) < 0) { d.gone = true; continue; }        // a new rack replaced the balls
      if (d.b.onTable) {                                                     // re-spotted: finish the drop, then vanish
        d.leaving += dt;
        if (d.t > 0.9 || d.leaving > 0.9) { d.gone = true; continue; }
      }
    }
    S.drops = S.drops.filter(d => !d.gone);
    for (let h = dt; h > 1e-9; h -= 0.002) {
      const s = Math.min(h, 0.002);
      for (const d of S.drops) dropStep(d, s);
      // balls in the same pocket push each other apart and stack up
      for (let i = 0; i < S.drops.length; i++) for (let j = i + 1; j < S.drops.length; j++) {
        const a = S.drops[i], c = S.drops[j];
        if (a.p !== c.p) continue;
        const dx = c.x - a.x, dy = c.y - a.y, dz = c.z - a.z, dist = Math.hypot(dx, dy, dz);
        if (dist >= 2 * R || dist < 1e-9) continue;
        const nx = dx / dist, ny = dy / dist, nz = dz / dist, push = (2 * R - dist) / 2;
        a.x -= nx * push; a.y -= ny * push; a.z -= nz * push; c.x += nx * push; c.y += ny * push; c.z += nz * push;
        const vn = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny + (c.vz - a.vz) * nz;
        if (vn < 0) { const jn = -(1 + 0.3) * vn / 2; a.vx -= jn * nx; a.vy -= jn * ny; a.vz -= jn * nz; c.vx += jn * nx; c.vy += jn * ny; c.vz += jn * nz; }
      }
    }
  }
  function dropStep(d, s) {
    const p = d.p; d.t += s;
    // vertical: free fall, bounce on the pocket bottom
    d.vz -= 9.81 * s; d.z += d.vz * s;
    if (d.z < DROP_FLOOR) { d.z = DROP_FLOOR; d.vz = d.vz < -0.25 ? -d.vz * 0.3 : 0; }
    // horizontal: the hole edge, then the bag wall; the deeper the ball, the farther out it can go
    d.x += d.vx * s; d.y += d.vy * s;
    const sink = Math.min(1, Math.max(0, (R - d.z) / R)), rw = p.r + (BAG_EXTRA - R) * sink;
    const dx = d.x - p.x, dy = d.y - p.y, dist = Math.hypot(dx, dy);
    if (dist > rw && dist > 1e-9) {
      const nx = dx / dist, ny = dy / dist, vn = d.vx * nx + d.vy * ny;
      d.x = p.x + nx * rw; d.y = p.y + ny * rw;
      if (vn > 0) { d.vx -= 1.45 * vn * nx; d.vy -= 1.45 * vn * ny; }        // restitution 0.45, keeps the sideways speed
      const k = Math.exp(-s * 1.5); d.vx *= k; d.vy *= k;                     // rubbing along the wall
    }
    if (d.z <= DROP_FLOOR + 1e-4 || Math.abs(d.vz) < 0.02) {                 // on the bottom (or resting on a ball)
      const k = Math.exp(-s * 2.2); d.vx *= k; d.vy *= k;
      if (Math.hypot(d.vx, d.vy) < 0.01) { d.vx = 0; d.vy = 0; }
    }
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (S.act.kind === 'lesson' && S.phase !== 'moving' && S.act.aim !== undefined) S.aim = S.act.aim;   // fixed aim
    if (S.act.kind === 'lesson') lessonMeter();
    if (S.phase === 'aim' || S.phase === 'pull' || S.phase === 'drag') {
      computeEffTip();
      if (padKey() !== S.padKey) { drawTipPad(); drawElevPad(); }
    }

    if (S.phase === 'strike') {
      S.strikeT += dt;
      const dur = 0.07;
      if (S.strikeT >= dur) doStrike();
    }
    if (S.phase === 'moving') {
      S.acc += dt * S.timeScale;
      let n = 0;
      while (S.acc >= C.DT && n < 4000) { world.substep(C.DT); S.acc -= C.DT; n++; }
      processEvents();
      if (!world.isMoving()) endShot();
      else syncInputs();
    }
    if (S.drops.length) stepDrops(dt * S.timeScale);
    updatePrediction(now);
    updateCBPath(now);
    draw();
    renderLive(now);
    requestAnimationFrame(frame);
  }

  function draw() {
    renderer.clear();
    const test = S.mode === 'test';
    if (S.chalk.length) renderer.drawChalk(S.chalk);
    // drill target: pocket and cue-ball zone
    if (S.act.kind === 'drill') { renderer.drawPocketMark(S.act.pocket); if (S.act.zone) renderer.drawZone(S.act.zone); }
    if (test && S.prediction) renderer.drawTrails(S.prediction, { dash: [0.012, 0.01], alpha: 0.7, width: 0.0025 });
    if ($('optTrails').checked) {
      renderer.drawTrails(world.balls);
      if (test && $('optContacts').checked) renderer.drawContactMarks(S.contacts);
    }
    // walking: the cue walks with you, so the aim follows the direction you face (unless the aim is locked)
    if (view3d && view3d.walk && S.phase === 'aim' && !S.aimLocked && cue.onTable) S.aim = normAng(view3d.walk.yaw);
    let aim = null;
    const aidsOn = $('optAimLine').checked, ghostOn = $('optGhost').checked;
    if ((S.phase === 'aim' || S.phase === 'pull') && cue.onTable) {
      aim = QB.computeAim(world, cue, squirtLine() ? launchAngle() : S.aim);
      if ((aidsOn || ghostOn) && !(placeMode() && S.arrange)) renderer.drawAim(aim, { tangent: $('optTangent').checked, cutLabel: test, lines: aidsOn, ghost: ghostOn, bounce: $('optCBPath').checked });
      if (S.cbPath && !(placeMode() && S.arrange)) renderer.drawCBPath(S.cbPath);
      if (S.cbPath && S.cbPre && S.elev > 0.5 && Math.abs(S.tipX) > 0.005) renderer.drawCBPath(S.cbPre, { dash: true, arrow: false });
      if (S.ballInHand && S.phase === 'aim') renderer.drawLabel(cue, 'ball in hand — drag me');
      else if (S.aimLocked) renderer.drawLabel(cue, S.clickLock ? 'aim frozen · click to release' : 'aim locked · Space');
      $('cutVal').textContent = aim && aim.hit.type === 'ball' ? `${aim.cutDeg.toFixed(2)}°` : '–';
    }
    for (const d of S.drops) {                 // (drawn under the cloth's hole only; a ball under the rail is hidden)
      const depth = Math.max(0, R - d.z);
      renderer.drawBall(d.b, null, { x: d.x, y: d.y, scale: Math.max(0.35, 1 - depth / 0.2), shade: Math.min(0.75, depth / 0.1), clip: d.p });
    }
    for (const b of world.balls) {
      const hl = (S.phase === 'drag' && S.dragBall === b) ? 'rgba(79,179,255,0.9)'
        : (b === cue && S.ballInHand && S.phase === 'aim') ? 'rgba(242,194,0,0.8)' : null;
      renderer.drawBall(b, hl);
    }
    const arranging = placeMode() && S.arrange;
    const showCue = cue.onTable && (S.phase === 'aim' || S.phase === 'pull' || S.phase === 'strike') && !(test && S.moveMode) && !arranging;
    let pb = S.pull;
    if (S.phase === 'strike') pb = S.strikeFrom * Math.max(0, 1 - S.strikeT / 0.07);
    updateMap();
    if (isMap() && view3d && view3d.walk) renderer.drawWalker(view3d.walkerOnMap());
    drawPowerCue(pb);                          // (hidden widgets have zero size and are skipped)
    const eclOn = !!view3d && $('optEclipse').checked && (S.phase === 'aim' || S.phase === 'pull') && cue.onTable && !arranging;
    $('eclipse').hidden = !eclOn;
    if (cueViewOn() || eclOn) view3d.render({ drops: S.drops, drawMain: cueViewOn(), overview: S.phase === 'moving' && $('optOverview').checked, eclipse: eclOn ? eclEls : null, balls: world.balls, cue, aimAngle: S.aim, elev: S.elev / DEG, tipX: eff().x, tipY: eff().y,
      pull: pb, showCue, showAids: !!aim && aidsOn && !arranging, showGhost: !!aim && ghostOn && !arranging, showTipMark: $('optTipMark').checked && !arranging, showBounce: $('optCBPath').checked, aim, cbPath: arranging ? null : S.cbPath, showTangent: $('optTangent').checked,
      zone: S.act.kind === 'drill' ? S.act.zone : null, chalk: S.chalk });
    if (showCue) {
      if (view3d && view3d.walk) {           // walking: the cue is carried by the player (on the map: at the blue dot)
        const w = view3d.walk, dx = Math.cos(w.yaw), dy = Math.sin(w.yaw);
        renderer.drawCue({ x: w.x + dx * 1.3, y: w.y + dy * 1.3 }, w.yaw, 0, 0.45);   // centred on the dot and the view cone
      } else renderer.drawCue(cue, S.aim, pb, 1, eff().x, S.elev / DEG);
      if (S.phase === 'pull') renderer.drawPowerGauge(cue, S.aim, S.pull / C.MAX_PULL);
    }
    // panel readouts
    const v = S.phase === 'pull' ? speedFromPull(S.pull) : S.phase === 'strike' ? S.strikeSpeed : 0;
    $('powerFill').style.width = (100 * Math.min(1, v / C.MAX_CUE_SPEED)) + '%';
    $('powerVal').textContent = v.toFixed(2) + ' m/s';
    const imp = impactNow(v);
    $('ballSpeedVal').textContent = imp.speed.toFixed(2) + ' m/s';
    $('squirtVal').textContent = Math.abs(imp.squirt) < 1e-6 ? '–' : `${Math.abs(imp.squirt * DEG).toFixed(2)}° ${imp.squirt > 0 ? 'left' : 'right'}`;
    $('aimVal').textContent = (S.aim * DEG).toFixed(2) + '°';
    $('lockVal').textContent = S.aimLocked ? 'ON' : 'off'; $('lockVal').classList.toggle('warn', S.aimLocked);
    const ai = $('inAim'); if (document.activeElement !== ai) ai.value = (S.aim * DEG).toFixed(2);
  }

  const eclEls = { box: $('eclipse'), gl: $('eclipseGL'), ov: $('eclipseOV'), label: $('eclipseLabel') };
  function onResize() { renderer.resize(); if (view3d) view3d.resize(); }

  // ---------------- Views: 2D only / split / 3D only ----------------
  function setView(v) {
    if (!view3d) v = '2d';
    if (v !== '3d' && view3d) view3d.stopWalk();
    S.view = v;
    renderer.autoRotate = v !== '3d';         // the small map in 3D-only view always stays landscape
    stageEl.classList.toggle('no3d', v === '2d');
    stageEl.classList.toggle('only3d', v === '3d');
    if (v !== 'split') stageEl.classList.remove('swapped');
    for (const b of document.querySelectorAll('#viewSeg button')) b.classList.toggle('active', b.dataset.view === v);
    $('btnSwap').hidden = v !== 'split';
    $('btnMap').hidden = v !== '3d';
    $('btnWalk').hidden = v !== '3d';
    try { localStorage.setItem('qball.view', v); } catch (e) { /* ignore */ }
    S.mapShown = null;   // force a layout refresh
    setTimeout(onResize, 0);
  }
  function swapViews() { if (S.view !== 'split') return; stageEl.classList.toggle('swapped'); setTimeout(onResize, 0); }
  for (const b of document.querySelectorAll('#viewSeg button')) b.onclick = () => setView(b.dataset.view);
  $('btnSwap').onclick = swapViews;
  $('btnHide3d').onclick = () => setView('2d');
  $('btnMap').onclick = () => { S.mapOn = !S.mapOn; };
  $('btnWalk').onclick = toggleWalk;
  // 3D-only view: the small top-view map shows when asked for, and whenever balls must be placed by hand
  // drag the map by its grip; the position is kept as fractions of the free space, so it survives resizes
  const mapGrip = $('mapGrip'); let mapDrag = null;
  const MAP_TOP = 36;                         // stay below the 3D view's top bar (walk / map buttons)
  let mapPos = null; try { mapPos = JSON.parse(localStorage.getItem('qball.mapPos') || 'null'); } catch (e) { /* ignore */ }
  function placeMap() {
    if (!mapPos || !S.mapShown) { stageEl.classList.remove('mapmoved'); return; }
    const sr = stageEl.getBoundingClientRect(), mr = $('pane2d').getBoundingClientRect();
    const freeX = Math.max(0, sr.width - mr.width - 8), freeY = Math.max(0, sr.height - mr.height - MAP_TOP - 4);
    stageEl.style.setProperty('--map-x', (4 + mapPos.fx * freeX).toFixed(0) + 'px');
    stageEl.style.setProperty('--map-y', (MAP_TOP + mapPos.fy * freeY).toFixed(0) + 'px');
    stageEl.classList.add('mapmoved');
  }
  mapGrip.addEventListener('pointerdown', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    const mr = $('pane2d').getBoundingClientRect();
    mapDrag = { dx: ev.clientX - mr.left, dy: ev.clientY - mr.top };
    mapGrip.setPointerCapture(ev.pointerId);
  });
  mapGrip.addEventListener('pointermove', (ev) => {
    if (!mapDrag) return;
    const sr = stageEl.getBoundingClientRect(), mr = $('pane2d').getBoundingClientRect();
    const freeX = Math.max(1, sr.width - mr.width - 8), freeY = Math.max(1, sr.height - mr.height - MAP_TOP - 4);
    const x = ev.clientX - sr.left - mapDrag.dx - 4, y = ev.clientY - sr.top - mapDrag.dy - MAP_TOP;
    mapPos = { fx: Math.min(1, Math.max(0, x / freeX)), fy: Math.min(1, Math.max(0, y / freeY)) };
    placeMap();
  });
  const endMapDrag = () => { if (!mapDrag) return; mapDrag = null; try { localStorage.setItem('qball.mapPos', JSON.stringify(mapPos)); } catch (e) { /* ignore */ } };
  mapGrip.addEventListener('pointerup', endMapDrag);
  mapGrip.addEventListener('pointercancel', endMapDrag);
  mapGrip.addEventListener('dblclick', (ev) => { ev.stopPropagation(); mapPos = null; try { localStorage.removeItem('qball.mapPos'); } catch (e) { /* ignore */ } placeMap(); });
  window.addEventListener('resize', () => placeMap());

  function updateMap() {
    const walking = !!(view3d && view3d.walk);
    const want = S.view === '3d' && (S.mapOn || walking || !!S.ballInHand || (placeMode() && S.arrange));
    let changed = false;
    if (want !== S.mapShown) { S.mapShown = want; stageEl.classList.toggle('showmap', want); $('btnMap').classList.toggle('on', want); changed = true; }
    if (walking !== S.mapWalking) {
      // Walk mode: the map zooms out to show the floor around the table, so there is room to move the player
      S.mapWalking = walking;
      stageEl.classList.toggle('walking', walking);
      $('btnWalk').classList.toggle('on', walking);
      renderer.margin = walking ? 1.05 : 0;
      const ext = (m) => [C.TABLE_L + 2 * (C.CUSHION_W + C.RAIL_W + m) + 0.10, C.TABLE_W + 2 * (C.CUSHION_W + C.RAIL_W + m) + 0.10];
      const [aw, ah] = ext(renderer.margin);
      $('pane2d').style.aspectRatio = `${aw.toFixed(3)} / ${ah.toFixed(3)}`;
      $('mapHint').textContent = walking
        ? 'drag the dot to walk · drag the cone or the ⌖, or double-click in the 3D view, to choose what to look at · double-click the map: back to your shot'
        : 'click the map to walk · double-click: back to your shot';
      const vh = document.querySelector('#pane3d .vhint');
      if (vh) { if (!vh.dataset.shot) vh.dataset.shot = vh.textContent;
        vh.textContent = walking ? 'walking · double-click a ball or spot here to look at it · move with the dot on the map, turn with the cone · wheel / pinch: bend down · 🚶 again: back to your shot' : vh.dataset.shot; }
      changed = true;
    }
    if (changed) { onResize(); placeMap(); }
  }

  // 3D scene input: drag left/right = aim (no hover aiming); wheel = zoom (in: closer and lower, out: standing up)
  const cv3 = $('cueView'); let drag3 = null;
  const touches3 = new Map(); let pinch = null;          // two fingers on the 3D view: pinch to zoom
  const pinchDist = () => { const [a, b] = [...touches3.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  cv3.addEventListener('pointerdown', (ev) => {
    if (realTouch(ev)) {
      touches3.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (touches3.size === 2 && view3d) {
        if (drag3 && !view3d.walk) S.aim = drag3.aim;    // the first finger was not an aim after all
        drag3 = null; cv3.classList.remove('dragging');
        pinch = { d: pinchDist(), z: view3d.z };
        cv3.setPointerCapture(ev.pointerId);
        return;
      }
      if (touches3.size > 2) return;
    }
    if (ev.button !== 0 || !cue.onTable || S.phase !== 'aim' || (view3d && view3d.walk)) return;   // walking: no dragging here
    QB.Sound.init();
    drag3 = { id: ev.pointerId, x: ev.clientX, lx: ev.clientX, ly: ev.clientY, aim: S.aim };
    cv3.setPointerCapture(ev.pointerId);
    cv3.classList.add('dragging');
  });
  cv3.addEventListener('pointermove', (ev) => {
    if (touches3.has(ev.pointerId)) touches3.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pinch && touches3.size >= 2) {
      const zRaw = pinch.z - (pinchDist() - pinch.d) * 0.004;
      view3d.z = Math.min(1, Math.max(0, zRaw));
      if (zRaw > 1.3 && !view3d.walk) startWalking();       // pinched out past standing: start walking
      return;
    }
    if (!drag3 || drag3.id !== ev.pointerId || S.phase !== 'aim' || view3d.walk) return;
    const k = (ev.shiftKey ? 0.01 : 0.03 + 0.09 * view3d.z) / DEG;   // rad per pixel; finer when zoomed in
    S.aim = normAng(drag3.aim + (ev.clientX - drag3.x) * k);   // grab the table: it moves with the pointer
  });
  const end3 = (ev) => {
    touches3.delete(ev.pointerId); if (touches3.size < 2) pinch = null;
    if (drag3 && drag3.id === ev.pointerId) { drag3 = null; cv3.classList.remove('dragging'); }
  };
  cv3.addEventListener('pointerup', end3);
  cv3.addEventListener('pointercancel', end3);
  let zoomOutPush = 0, zoomOutT = 0;
  // double-click (double-tap) in the 3D view: look at that spot / ball. While walking it becomes the fixed point;
  // from the shot it stands you up into walk mode (3D-only view) looking at it.
  function stareAt(clientX, clientY) {
    if (!view3d) return;
    const hit = view3d.pick(clientX, clientY, world.balls);
    if (!hit) return;
    if (!view3d.walk) { if (S.view !== '3d' || S.phase !== 'aim') return; startWalking(); if (!view3d.walk) return; }
    view3d.setFocus(hit.x, hit.y, hit.z);
    setStatus(hit.ball ? `Looking at the ${hit.ball.num === 0 ? 'cue ball' : hit.ball.num + '-ball'} — you keep facing it as you walk.` : 'Looking at that spot — you keep facing it as you walk.');
  }
  cv3.addEventListener('dblclick', (ev) => { if (!realTouch(ev)) stareAt(ev.clientX, ev.clientY); });
  let lastTap3 = null;
  cv3.addEventListener('pointerup', (ev) => {
    if (!realTouch(ev)) return;
    const now = performance.now();
    if (lastTap3 && now - lastTap3.t < 350 && Math.hypot(ev.clientX - lastTap3.x, ev.clientY - lastTap3.y) < 25) { lastTap3 = null; stareAt(ev.clientX, ev.clientY); }
    else lastTap3 = { t: now, x: ev.clientX, y: ev.clientY };
  });

  cv3.addEventListener('wheel', (ev) => {
    if (!view3d) return;
    ev.preventDefault();
    const atTop = view3d.z >= 1 - 1e-9;
    view3d.zoom(ev.deltaY);
    // keep zooming out once standing -> start walking (3D-only view)
    const now = performance.now();
    if (atTop && ev.deltaY > 0 && !view3d.walk && S.view === '3d') {
      zoomOutPush = (now - zoomOutT < 400 ? zoomOutPush : 0) + ev.deltaY; zoomOutT = now;
      if (zoomOutPush > 250) { zoomOutPush = 0; startWalking(); }
    } else zoomOutPush = 0;
  }, { passive: false });

  // the little cue on the side of the 3D view (and of the 2D view on touch screens): drag it down to pull back, release to shoot
  const powerCues = [$('powerCue'), $('powerCue2')]; let pcDrag = null;
  for (const pc of powerCues) {
    pc.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0 || S.phase !== 'aim' || !cue.onTable || pcDrag) return;
      QB.Sound.init();
      returnToShot();                          // picking up the cue walks you back to your shot
      pcDrag = { y: ev.clientY, el: pc, id: ev.pointerId }; S.phase = 'pull'; S.pull = 0;
      pc.setPointerCapture(ev.pointerId);
    });
    pc.addEventListener('pointermove', (ev) => {
      if (!pcDrag || pcDrag.id !== ev.pointerId || S.phase !== 'pull') return;
      const h = pc.getBoundingClientRect().height * 0.62;          // full pull = 62% of the widget height
      S.pull = Math.max(0, Math.min(C.MAX_PULL, (ev.clientY - pcDrag.y) / h * C.MAX_PULL));
    });
    pc.addEventListener('pointerup', (ev) => { if (pcDrag && pcDrag.id === ev.pointerId) endPc(false); });
    pc.addEventListener('pointercancel', (ev) => { if (pcDrag && pcDrag.id === ev.pointerId) endPc(true); });
  }
  function endPc(cancel) {
    if (!pcDrag) return; pcDrag = null;
    if (S.phase !== 'pull') return;
    if (!cancel && S.pull > 0.004) beginStrike(speedFromPull(S.pull)); else { S.phase = 'aim'; S.pull = 0; }
  }
  function drawPowerCue(pb) { for (const pc of powerCues) drawPowerCueOn(pc, pb); }
  function drawPowerCueOn(pc, pb) {
    const dpr = window.devicePixelRatio || 1, W = Math.round(pc.clientWidth * dpr), H = Math.round(pc.clientHeight * dpr);
    if (!W || !H) return;
    if (pc.width !== W || pc.height !== H) { pc.width = W; pc.height = H; }
    const ctx = pc.getContext('2d'); ctx.clearRect(0, 0, W, H);
    const frac = Math.min(1, pb / C.MAX_PULL), cx = W * 0.58, top = H * 0.06, travel = H * 0.62;
    // track + power fill
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; roundRectPath(ctx, W * 0.12, top, W * 0.14, travel + H * 0.04, W * 0.07); ctx.fill();
    if (frac > 0) {
      const g = ctx.createLinearGradient(0, top, 0, top + travel);
      g.addColorStop(0, '#5fd35f'); g.addColorStop(0.6, '#f2c200'); g.addColorStop(1, '#e53935');
      ctx.fillStyle = g; roundRectPath(ctx, W * 0.12, top, W * 0.14, Math.max(W * 0.14, travel * frac + H * 0.04), W * 0.07); ctx.fill();
    }
    // cue ball at the top, cue below it, pulled back by the current pull
    const br = W * 0.16;
    ctx.fillStyle = '#f2f0e8'; ctx.beginPath(); ctx.arc(cx, top + br, br, 0, Math.PI * 2); ctx.fill();
    const tipY = top + 2 * br + H * 0.015 + travel * frac, len = H * 0.85;
    const w0 = W * 0.045, w1 = W * 0.11;
    const seg = (a, b, col) => { const ya = tipY + a * len, yb = tipY + b * len, wa = w0 + (w1 - w0) * a, wb = w0 + (w1 - w0) * b;
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(cx - wa, ya); ctx.lineTo(cx + wa, ya); ctx.lineTo(cx + wb, yb); ctx.lineTo(cx - wb, yb); ctx.closePath(); ctx.fill(); };
    seg(0, 0.01, '#3b6fd8'); seg(0.01, 0.04, '#f2efe6'); seg(0.04, 0.55, '#e3c48f'); seg(0.55, 0.7, '#2a1408'); seg(0.7, 0.88, '#151515'); seg(0.88, 1, '#2a1408');
    // label
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = `${Math.round(10 * dpr)}px system-ui, sans-serif`; ctx.textAlign = 'center';
    ctx.fillText(S.phase === 'pull' ? 'release' : 'pull ↓', cx, H - 6 * dpr);
  }
  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  window.addEventListener('resize', onResize);
  let savedView = 'split'; try { savedView = localStorage.getItem('qball.view') || 'split'; } catch (e) { /* ignore */ }
  setView(savedView);
  onResize();
  setTip(0, 0); setElev(0); updateActivityUI(); defaultStatus(); syncInputs(true); renderReport();
  window.addEventListener('resize', () => { drawTipPad(); drawElevPad(); });
  requestAnimationFrame(frame);

  // expose for console debugging / automated tests
  window.qb = { railDist: (x, y, a) => noseDist(x, y, -Math.cos(a), -Math.sin(a)), eff: () => computeEffTip(), world, table, renderer, S, get cue() { return cue; }, get ob() { return ob; }, setMode, startGame, startDrill, showMenu, replay, setCut, restartActivity, shootFromPanel, setTip, setElev, view3d, swapViews, setView, shotJSON, loadShot };
})();
