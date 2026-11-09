// Qball — lessons. Two kinds:
//
// 1) Practice lessons (none at the moment; the first stop-shot lesson was one): the shot is set up, the player
//    tries it at several strengths, the app measures each shot.
//    { id, num, name, blurb, balls(T), aimAt (ball number), tipRange, bands, intro, steps, finish }
//      tipRange : what the tip may do — { x: [min, max], y: [min, max] } in ball radii
//      bands    : strength ranges by cue speed (m/s), in order
//      step     : { title, tip: { y, tol, label }, html, done(results) -> html }
//
// 2) Scripted lessons (script: true), written from a lesson script in lessons/*.txt. A lesson is a list of
//    set-ups ("scenes"); each set-up is a list of "beats" the player steps through with Next / Back in the coach
//    card. A beat sets the view and camera, which aiming aids show, extra marks, and what the player has to do.
//    { id, num, name, blurb, script: true, balls(T) (menu picture), tipRange, scenes, summary: {title, html} }
//    scene: { title, short, layout(T, earlier layouts) -> g, place (player places the ghost ball), beats,
//             result(g, r) -> {title, html} }
//      g (layout): { balls: [{num, x, y}], pts: { CB, OB, GB, P, ... named points }, obNum, aimAt: 'GB', ... }
//    beat: {
//      title, html (text, or a function (g) -> text),
//      view: '2d' | 'split' | '3d',
//      zoom: { at: name or [names] (zoom on their middle), k: magnification, dx, dy }   — 2D view; none = whole table
//      cam:  { along: [A, B], look: name, dist (m), tilt (°), fov (°), back (m) }  — 3D camera on the line A→B,
//            behind `look`, looking down at `tilt`; `back` = distance behind A instead of dist. none = cue view
//            or { side: name, toward: name, dist, height, ahead, flip, fov } — from the side of a ball, square to the line
//      aids: { aim, ghost, obpath, tangent, cbpath, eclipse, tipmark, overview } (true / false)
//      marks: { lines: [{ pts: [names], color }], dot: name (red aiming point), labels: [{ at, text, dx, dy }] }
//      task: 'shot' (the player shoots) | 'place' (the player drags the ghost ball) | 'demo' (the lesson shoots) | none (Next)
//      aim: 'free' (the player aims; aimStart: name) — otherwise the aim is fixed at layout.aimAt
//      z: cue-view zoom for the shot (0 = down on the cue … 1 = standing)
//      power: cue speed (m/s), a function (g) -> speed, or 'free'; none = found automatically. The player pulls the cue into
//            a blue band around it (± 12%, at least ± 0.2 m/s; powerTol: ± m/s); outside it the shot doesn't go
//      padClock: draw a clock on the cue-ball picture
//      tip:  where the tip has to be before the shot goes (or a function (g) -> that):
//            { axis: 'y' | 'x' | 'fixed' (the tip only moves up/down, sideways, or not at all), target: {x, y}, tol,
//              below / above: a point (tip anywhere below / above it, gap, max), label (for the status line), dot (false: no filled point), color }
//      tipShow: {x, y} — put the tip there (for pictures)
//      params: physics changes for this step (e.g. { cueEndMass: 0 } = no squirt); also on a scene
//      measure: { reversal: true | 'stun', path: true | 'one-rail', tag, label, color, dash } — marks that stay on the
//            table for the rest of the lesson (where the backspin ran out; the cue ball's path); clearMarks: [tags]
//      replay: { side: true (follow the cue ball from the side) | view: '2d', zoom, slow, text } — slow-motion replay
//      question: { title, options: [{id, label}], answer(r) -> id } — asked after the shot; wrong answers can be retried
//      point: [element ids] — things in the panel the text talks about pulse (e.g. 'tipPad'; lesson shots add the cue)
//      zone: {x, y, r} or (g) -> zone, success(r) -> true/false (else "Try again"), result(r, results, ok) -> {title, html}
//      key: name to keep the shot's measurements under (results.key, for later steps)
//    }
//    The measurements r: { revDist, stunDist, rollDist (m along the shot), d (cue ball after the contact: < 0 back),
//      cls: 'stop' | 'draw' | 'follow' | 'scratch', cushion, made, inZone, path, ... } (analyzeShot in main.js)
window.QB = window.QB || {};

(function () {
  const R = QB.C.BALL_R, D = Math.PI / 180;
  // Lesson 1 layout: the 9-ball in front of the top side pocket, the ghost ball right behind it. The cue ball is
  // the same distance from the ghost ball every time, turned by the cut angle (side -1 = to the left).
  function ghostLayout(T, cutDeg, side) {
    const pk = T.pockets.find(p => p.name === 'top-side');
    const P = { x: pk.x, y: pk.y }, OB = { x: 0, y: T.W2 - 0.22 }, GB = { x: 0, y: OB.y - 2 * R };
    const d = GB.y + T.W2 / 3;                        // straight shot: the cue ball two thirds of the way down
    const CB = { x: GB.x + side * d * Math.sin(cutDeg * D), y: GB.y - d * Math.cos(cutDeg * D) };
    return { balls: [{ num: 0, x: CB.x, y: CB.y }, { num: 9, x: OB.x, y: OB.y }], pts: { CB, OB, GB, P }, obNum: 9, cut: cutDeg, side, aimAt: 'GB' };
  }
  const pct = (deg) => Math.round((1 - Math.sin(deg * D)) * 100);
  const pocketLine = { lines: [{ pts: ['P', 'OB', 'GB'], color: '#ffd640' }], dot: 'GB' };
  const camPocket = { along: ['GB', 'P'], look: 'OB', dist: 0.55, tilt: 30, fov: 40 };     // behind the pocket line, ~30° down
  const camCueLine = { along: ['CB', 'GB'], look: 'GB', dist: 0.45, tilt: 4, fov: 24, raise: 0.25 };     // along the cue line, close up
  const shotHtml = `<p><b>Your turn.</b> The aim is set. Pull the cue on the right side of the 3D view down until it reaches the
    <b style="color:#4fb3ff">blue band</b> — that's the right strength — and let it go.</p>`;
  const NOTE = {
    10: `<p>The shot isn't straight any more, but you <b>still aim at the centre of the ghost ball</b>. Seen from the cue
      ball, that point (red dot) is no longer the centre of the 9: it is off to the side, about a third of the way to
      the edge — still <b>inside</b> the 9.</p>`,
    30: `<p>Again you aim at the centre of the ghost ball. At 30° that point is <b>exactly on the edge</b> of the 9.
      This is the famous <b>half-ball hit</b>: aim the middle of the cue ball at the edge of the object ball.</p>`,
    50: `<p>At 50° the aiming point is <b>outside</b> the 9 — literally in the air beside it. There is nothing to look at
      there, which makes this shot especially hard to aim at a point.</p>`,
  };
  const ECL = {
    10: '', 30: ' — exactly half of it',
    50: '. Here the aiming point is in the air, so this thin slice is the best thing to look at',
  };
  function cutScene(deg, short) {
    return {
      title: `${deg}° cut`, short, layout: (T) => ghostLayout(T, deg, -1),
      beats: [
        { title: 'Same ghost ball', view: '2d', zoom: { at: ['GB', 'CB'], k: 2.2 }, marks: pocketLine,
          html: `<p><b>A ${deg}° cut.</b> Only the cue ball has moved. The ghost ball is in <b>exactly the same place</b> as
            before: it depends only on the object ball and the pocket, not on where the cue ball is.</p>` },
        { title: 'Behind the pocket line', view: '3d', cam: camPocket, marks: pocketLine,
          html: `<p>From behind the pocket line again: ghost ball, 9-ball and pocket line up exactly as in the straight shot.</p>` },
        { title: 'From the cue ball', view: '3d', cam: camCueLine, marks: pocketLine, html: NOTE[deg] },
        { title: 'The eclipse', view: '3d', cam: camCueLine, marks: pocketLine, aids: { eclipse: true },
          html: `<p>The inset (top right) shows the view straight along the cue line. The dashed circle is the cue ball at
            the moment of contact — that is, the ghost ball. It covers <b>${pct(deg)}%</b> of the 9${ECL[deg]}.</p>
            <p>Aiming at a point on the ball is difficult. It is easier, and more accurate, to see <b>how much of the 9 the
            ghost ball covers</b> — the eclipse — and match that.</p>` },
        { title: 'Your shot', view: '3d', task: 'shot', z: 0.3, aids: { eclipse: true }, html: shotHtml },
      ],
      result: (g, r) => r.made
        ? { title: 'In!', html: `<p>You aimed at the centre of the ghost ball — ${deg === 10 ? 'a little off the centre of the 9' : deg === 30 ? 'the edge of the 9' : 'a point in the air beside the 9'} — with the cue ball covering ${pct(deg)}% of it, and the 9 went in.</p>` }
        : { title: 'Not this time', html: '<p>The 9 stayed out. Shoot again.</p>' },
    };
  }
  function placeScene(side, title) {
    return {
      title, short: side < 0 ? 'Your ghost ball' : 'Once more', place: true,
      // a random cut between 20° and 40°; the second one differs from the first by at least 7°
      layout: (T, prev) => {
        const first = prev && prev[4] ? prev[4].cut : null;
        let deg = 0;
        for (let k = 0; k < 50; k++) { deg = Math.round(20 + Math.random() * 20); if (first === null || Math.abs(deg - first) >= 7) break; }
        return ghostLayout(T, deg, side);
      },
      beats: [
        { title: 'Place the ghost ball', view: '2d', zoom: { at: ['P', 'CB'], k: 1.5, dy: -0.12 }, task: 'place', aimAt: 'OB',
          aids: { aim: false, ghost: false, tipmark: false },
          html: `<p><b>Now you set the ghost ball.</b> The aiming aids are off and the cut is new. Drag the white ball
            around the 9 to where the ghost ball has to be for the 9 to go into the top side pocket, then press
            <b>Confirm</b>.</p>` },
        { title: 'Aim and shoot', view: '3d', task: 'shot', aim: 'free', aimStart: 'OB', z: 0.3,
          aids: { aim: true, ghost: false, obpath: false },
          html: `<p>Your ghost ball is fixed. Now <b>aim at its centre</b>: drag left or right in the 3D view (Shift: fine;
            the arrow keys work too). The white line shows where the cue ball goes. Then pull the cue down into the
            <b style="color:#4fb3ff">blue band</b> and let it go.</p>` },
      ],
      result: (g, r) => {
        const why = `Your ghost ball was <b>${r.ghostErr.toFixed(1)}°</b> away from the right spot (green), and you aimed
          <b>${r.aimErrMm.toFixed(0)} mm</b> from its centre.`;
        if (r.made) return { title: 'In!', html: `<p>${why}</p><p>This was a ${g.cut}° cut: the cue ball covered about ${pct(g.cut)}% of the 9.</p>` };
        const main = r.ghostErr > 2.5 && r.ghostErr * 4 > r.aimErrMm ? 'The ghost ball was in the wrong place — look along the line from the pocket through the 9.'
          : 'Aim more carefully at the centre of your ghost ball.';
        return { title: 'Missed', html: `<p>${why}</p><p>${main}</p><p>Try again: place the ghost ball once more.</p>` };
      },
    };
  }

  // ---------------- Lessons 2–4: layouts and building blocks ----------------
  // shot strengths (cue speed, m/s); lessons 2 and 3 a little softer on smaller tables so the effects stay on the table
  const kk = (g) => (g && g.k) || 1;
  const P = {
    soft: (g) => 1.2 * kk(g), med: (g) => 1.8 * kk(g), firm: (g) => 2.4 * kk(g),     // lesson 2: ¼, medium, ¾
    side: (g) => 1.7 * kk(g),                                                     // lesson 3: one rail, then it stops
    stop: () => 2.0, stopSoft: () => 1.0, stopFirm: () => 4.0, push: () => 4.0,    // lesson 4
  };
  const cm = (m) => m === null || m === undefined ? '—' : Math.abs(m) < 0.01 ? 'less than 1 cm' : Math.abs(m) >= 1 ? `${Math.abs(m).toFixed(2)} m` : `${Math.round(Math.abs(m) * 100)} cm`;
  // Lesson 2: the cue ball alone, a quarter of the table from the foot rail, shooting the length of the table
  function spinLayout(T) {
    const CB = { x: T.L2 - 0.27 * T.L2 / 1.27, y: 0 }, AIM = { x: -T.L2, y: 0 };
    return { balls: [{ num: 0, x: CB.x, y: CB.y }], pts: { CB, AIM }, aimAt: 'AIM', k: Math.sqrt(T.L2 / 1.27) };
  }
  // Lesson 3: the cue ball a little before the middle of the table, shooting straight into the head rail
  function sideLayout(T) {
    const CB = { x: 0.47 * T.L2, y: 0 }, AIM = { x: -T.L2, y: 0 };
    return { balls: [{ num: 0, x: CB.x, y: CB.y }], pts: { CB, AIM, RAIL: { x: -T.L2 + 0.45, y: 0 } }, aimAt: 'AIM', k: Math.sqrt(T.L2 / 1.27) };
  }
  // Lesson 4: a straight shot at the 9 in front of the top side pocket. The stop-shot hitting point for the lesson's
  // strength is found by trying (it depends on the table and the physics settings); worked out once per lesson run.
  function stopLayout(T, dist, prev, tools) {
    const OB = { x: 0, y: T.W2 - 0.22 }, CB = { x: 0, y: OB.y - dist }, GB = { x: 0, y: OB.y - 2 * R }, pk = T.pockets.find(p => p.name === 'top-side');
    const g = { balls: [{ num: 0, x: CB.x, y: CB.y }, { num: 9, x: OB.x, y: OB.y }], pts: { CB, OB, GB, P: { x: pk.x, y: pk.y } },
      aimAt: 'GB', obNum: 9, dist, power: P.stop(), nominal: -0.1 };
    const old = prev && Object.values(prev).find(q => q && q.dist === dist && q.tuned);
    if (old) { g.nominal = old.nominal; g.tuned = true; }
    else if (tools && dist > 0.4) {               // (the close-up set-ups don't use the stop-shot point)
      let best = null;
      const tryTip = (ty) => {
        const r = tools.sim(g.balls, Math.PI / 2, P.stop(), 0, ty);
        if (r.d !== undefined && r.objIn.length && (!best || Math.abs(r.d) < best.e)) best = { ty, e: Math.abs(r.d) };
      };
      for (let ty = 0.04; ty >= -0.36; ty -= 0.04) tryTip(ty);          // coarse, then around the best one
      if (best) { const c = best.ty; for (let ty = c - 0.03; ty <= c + 0.031; ty += 0.01) if (Math.abs(ty - c) > 0.005) tryTip(ty); }
      if (best) { g.nominal = Math.round(best.ty * 100) / 100; g.tuned = true; }
    }
    return g;
  }
  const camSideCB = { side: 'CB', toward: 'AIM', dist: 0.55, height: 0.12, fov: 34, ahead: 0.25 };      // the cue ball from the side
  const camSideTip = { side: 'CB', toward: 'AIM', dist: 0.42, height: 0.03, fov: 30, ahead: -0.06, flip: true };   // cue tip and cue ball, low
  const sideZoom = { at: ['RAIL'], k: 1.5, dx: 0.3 };
  const greenDot = (label) => (g) => ({ axis: 'y', target: { x: 0, y: g.nominal }, tol: 0.04, dot: true, color: '#3fbf6f', label: label || 'on the green dot', clock: true });

  // a draw step (lesson 2): tip below the centre, strength fixed, slow replay from the side, the reversal point marked
  function drawScene(title, short, power, ty, mark, html, explain) {
    return { title, short, layout: (T) => spinLayout(T),
      beats: [
        { title, view: '3d', z: 0.15, padClock: true, task: 'shot', power, key: mark.tag,
          tip: { axis: 'y', target: { x: 0, y: ty }, tol: 0.07, clock: true, label: `at 6 o'clock${ty > -0.3 ? ', close to the centre' : ''} (blue point)` },
          replay: { side: true, slow: 0.35, text: '<p>Again from the side, in slow motion. Watch the spin of the cue ball: the ring with the arrow marks where the backspin runs out.</p>' },
          measure: { reversal: true, tag: mark.tag, label: mark.label, color: mark.color },
          html,
          result: (r, res) => ({ title: 'Where the backspin ran out', html: explain(r, res) }) },
      ] };
  }
  // a side-spin step (lesson 3): tip on the horizontal line, into the head rail, replay from above with the path marked
  function sideScene(title, short, tx, mark, where, explain, squirt) {
    return { title, short, layout: (T) => sideLayout(T), params: squirt ? undefined : { cueEndMass: 0 },
      beats: [
        { title, view: '3d', z: 0.15, padClock: true, task: 'shot', power: P.side, aids: { overview: false }, key: mark.tag,
          tip: { axis: 'x', target: { x: tx, y: 0 }, tol: 0.07, clock: true, label: `at ${where} (blue point)` },
          replay: { view: '2d', zoom: sideZoom, slow: 0.5, text: '<p>The same shot from above, in slow motion.</p>' },
          measure: { path: 'one-rail', tag: mark.tag, label: mark.label, color: mark.color || '#ffffff', dash: !!mark.dash },
          html: `<p>Put the tip at <b>${where}</b> (blue point) — it only moves sideways — and shoot with the cue pulled
            into the <b style="color:#4fb3ff">blue band</b> (about half strength).${squirt ? '' : ' <i>Squirt is switched off.</i>'}</p>`,
          result: (r, res) => ({ title: 'Off the cushion', html: explain(r, res) }) },
      ] };
  }
  // a stop-shot experiment (lesson 4): tip relative to the stop-shot point, strength fixed, slow replay, "what happened?"
  const ASK = { title: 'What happened?', options: [{ id: 'stop', label: 'A perfect stop shot' }, { id: 'draw', label: 'It drew back' }, { id: 'follow', label: 'It kept rolling forward' }],
    answer: (r) => r.cls === 'stop' ? 'stop' : r.cls === 'draw' ? 'draw' : 'follow' };
  const WHY = {
    draw: `<p>The cue ball still had <b>backspin</b> when it hit the 9. The 9 took the speed, and the backspin pulled the cue
      ball back: a <b>draw shot</b>.</p>`,
    follow: `<p>The backspin was <b>used up before</b> the cue ball reached the 9, and it had started to roll forward. After
      the hit that forward roll carried it on: it <b>followed</b>.</p>`,
    stop: `<p>The cue ball reached the 9 with no spin left, so it <b>stopped</b>.</p>`,
  };
  function stopScene(title, short, tip, power, html, note) {
    return { title, short, layout: (T, prev, tools) => stopLayout(T, 0.578, prev, tools),
      beats: [
        { title, view: '3d', z: 0.15, padClock: true, task: 'shot', power, tip,
          replay: { side: true, slow: power() > 3 ? 0.1 : power() < 1.5 ? 0.3 : 0.18, text: '<p>From the side, in slow motion.</p>' },
          html, question: ASK,
          result: (r) => ({ title: r.cls === 'stop' ? 'A stop shot' : r.cls === 'draw' ? 'It drew back' : 'It kept rolling forward',
            html: WHY[r.cls === 'scratch' ? 'follow' : r.cls] + (r.cls !== 'stop' ? note : '')
              + (r.d !== undefined ? `<p class="muted">The cue ball moved ${cm(r.d)} ${r.d < 0 ? 'back' : 'forward'} after the hit.</p>` : '') }) },
      ] };
  }

  QB.LESSONS = [
    {
      id: 'ghost', num: 1, name: 'Aiming with the ghost ball', script: true,
      blurb: 'Aim at the ghost ball: the spot the cue ball has to take. See it from above, from the pocket and from the cue ball, then place it yourself.',
      balls: (T) => ghostLayout(T, 30, -1).balls,
      tipRange: { x: [0, 0], y: [0, 0] },               // centre ball throughout
      scenes: [
        {
          title: 'Straight shot', short: 'Straight', layout: (T) => ghostLayout(T, 0, -1),
          beats: [
            { title: 'The ghost ball', view: '2d',
              html: `<p>To pocket a ball, the cue ball must send it along the line to the pocket. Picture a second ball
                touching the object ball on the side away from the pocket, exactly on the line from the pocket through the
                object ball. This imaginary ball is the <b>ghost ball</b>.</p>
                <p>The cue ball has to arrive exactly where the ghost ball sits — it <b>replaces the ghost ball</b>. So you
                don't aim at the object ball: you aim at the <b>centre of the ghost ball</b>. Because balls have a size
                (they are not points), that aiming point is offset from the object ball. Let's look at a few shots.</p>` },
            { title: 'Where the ghost ball is', view: '2d', zoom: { at: ['GB', 'OB'], k: 3.2 },
              marks: { lines: pocketLine.lines, dot: 'GB', labels: [{ at: 'GB', text: 'ghost ball', dx: -0.085, dy: -0.062 }, { at: 'OB', text: '9-ball', dx: 0.07, dy: -0.062 }] },
              html: `<p>Here it is: the dashed circle touching the 9. The yellow line runs from the pocket through the 9 to the
                ghost ball. If the cue ball takes the ghost ball's place, it pushes the 9 along that line into the pocket.</p>
                <p>The red dot is the centre of the ghost ball — your aiming point.</p>` },
            { title: 'Behind the pocket line', view: '3d', cam: camPocket, marks: pocketLine,
              html: `<p>The same from behind, looking down at about 30°: ghost ball, 9 and pocket lie on one line.</p>
                <p>The cue ball has to take the ghost ball's place, so the point to aim at is the <b>centre of the ghost
                ball</b> (red dot) — not the 9 itself.</p>` },
            { title: 'From the cue ball', view: '3d', cam: { along: ['CB', 'GB'], look: 'GB', back: 0.30, tilt: 8, fov: 34, raise: 0.25 }, marks: pocketLine,
              html: `<p>Now from behind the cue ball: cue ball, ghost ball, 9 and pocket are all on one line. In a straight
                shot the ghost ball sits right in front of the 9, so <b>its centre is right in front of the centre of the
                9</b>.</p><p class="key">Straight shot: aim at the centre of the object ball — a full hit.</p>` },
            { title: 'Your shot', view: '3d', task: 'shot', z: 0.3, html: shotHtml },
          ],
          result: (g, r) => r.made
            ? { title: 'In!', html: `<p>The 9 is in. The cue ball hit it full in the face${r.cbDist !== null && r.cbDist < 0.12 ? ` and stopped ${Math.round(r.cbDist * 100)} cm from where the ghost ball was` : ''}.</p>` }
            : { title: 'Not this time', html: '<p>The 9 stayed out. Shoot again.</p>' },
        },
        cutScene(10, '10°'),
        cutScene(30, '30°'),
        cutScene(50, '50°'),
        placeScene(-1, 'Your ghost ball'),
        placeScene(1, 'Your ghost ball, once more'),
      ],
      summary: {
        title: 'What we have learned',
        html: `<ul>
          <li>The <b>ghost ball</b> is a good aiming aid: it shows where the cue ball has to go, on the line from the pocket
            through the object ball. You aim at its centre.</li>
          <li>Aiming at a point on the object ball is difficult (and past 30° the point is in the air). Matching the
            <b>eclipse</b> — how much of the object ball the cue ball covers — is easier and more accurate.</li>
          <li>Getting good at angles still takes practice: many, many balls.</li></ul>
          <p>Try it in <i>Free practice</i>, or repeat the lesson for new angles in the last two set-ups.</p>`,
      },
    },

    // ======================================================================================================
    // Lesson 2 · follow and draw (lessons/lesson2.txt)
    // ======================================================================================================
    {
      id: 'followdraw', num: 2, name: 'Follow and draw', script: true, noSkip: true,
      blurb: 'Where to hit the cue ball for follow and draw — and how the strength and the hitting point move the spot where the backspin runs out.',
      balls: (T) => spinLayout(T).balls,
      scenes: [
        { title: 'Where to hit', short: 'Hitting points', layout: (T) => spinLayout(T),
          beats: [
            { title: 'The clock on the cue ball', view: '3d', z: 0.15, padClock: true, point: ['tipPad'],
              html: `<p>Where the cue tip meets the cue ball decides how it spins. Look at the <b>cue-ball picture</b> in the panel:
                it now shows a <b>clock</b>, and we name the hitting points by the hours:</p>
                <ul><li><b>12 o'clock</b> — above the centre: <b>follow</b> (topspin)</li>
                <li><b>6 o'clock</b> — below the centre: <b>draw</b> (backspin)</li>
                <li><b>3 and 9 o'clock</b> — right and left: <b>side spin</b></li></ul>
                <p>You can't hit too far out: past the <span style="color:#ff8a8a">dashed red ring</span> the tip slides off the
                ball — a <b>miscue</b>.</p>` },
            { title: 'This lesson: 12 and 6 o\'clock', view: '3d', z: 0.15, padClock: true, point: ['tipPad'],
              html: `<p>Here we only use <b>12 o'clock</b> (follow) and <b>6 o'clock</b> (draw); side spin is the next lesson.</p>
                <p>The aim is set for you. <b>Drag up or down</b> on the cue-ball picture until the tip sits on the
                <span style="color:#4fb3ff">blue point</span>. Then pull the cue on the right down into the
                <span style="color:#4fb3ff">blue band</span> — the strength for that shot — and let it go. If the tip is somewhere
                else, the shot won't go.</p>` },
          ] },
        { title: 'Follow', short: 'Follow', layout: (T) => spinLayout(T),
          beats: [
            { title: 'Follow: 12 o\'clock', view: '3d', z: 0.15, padClock: true, task: 'shot', power: P.med,
              tip: { axis: 'y', target: { x: 0, y: 0.45 }, tol: 0.07, clock: true, label: 'at 12 o\'clock (blue point)' },
              html: `<p>A <b>follow shot</b> sends the cue ball on after it hits the object ball — to move forward for the next ball,
                or to get away from a cushion. Put the tip at <b>12 o'clock</b>, near the top (blue point), and shoot with
                <b>medium</b> strength (the blue band on the cue).</p>`,
              result: (r) => ({ title: 'It rolls on', html: `<p>Hit high, the cue ball starts with extra <b>topspin</b> and rolls forward
                right away${r.rollDist !== null ? ` (it was rolling after ${cm(r.rollDist)})` : ''}. That forward roll is what carries it on
                through an object ball.</p>` }) },
          ] },
        drawScene('Draw', 'Draw', P.med, -0.45, { tag: 'med', label: 'medium', color: '#ffffff' },
          `<p>A <b>draw shot</b> brings the cue ball back after it hits the object ball. Put the tip at <b>6 o'clock</b>, near the
            bottom (blue point), and shoot with <b>medium</b> strength (the blue band on the cue). Watch the cue ball.</p>`,
          (r) => `<p>The cue ball left with <b>backspin</b> while sliding forward. Cloth friction eats the backspin; once it is
            used up — after <b>${cm(r.revDist)}</b> here (white ring and arrow) — the ball turns from backspin to forward spin and
            rolls on.</p>
            <p class="key">Right at that point the cue ball slides with no spin at all. An object ball hit there takes all of its
            speed (the balls are nearly perfectly elastic), and the cue ball <b>stops dead</b>: a stop shot.</p>
            <p>Next we'll see how to move this point.</p>`),
        drawScene('Softer', 'Softer', P.soft, -0.45, { tag: 'soft', label: 'soft', color: '#8fd3ff' },
          `<p>Same hitting point (6 o'clock, blue point), but now <b>softer</b>: about a quarter strength (the blue band has moved). Where will the backspin run
            out this time?</p>`,
          (r, res) => `<p>The backspin ran out after <b>${cm(r.revDist)}</b> (light-blue ring)${res.med ? ` — much earlier than at
            medium strength (${cm(res.med.revDist)})` : ''}.</p><p>A softer shot puts less backspin on the ball, so the cloth friction
            takes over sooner.</p>`),
        drawScene('Firmer', 'Firmer', P.firm, -0.45, { tag: 'firm', label: 'firm', color: '#f2c200' },
          `<p>Same hitting point again, now <b>firmer</b>: about three-quarter strength (blue band).</p>`,
          (r, res) => `<p>Now the backspin lasted <b>${cm(r.revDist)}</b> (yellow ring)${res.med ? `, farther than medium
            (${cm(res.med.revDist)})` : ''}${res.soft ? ` and soft (${cm(res.soft.revDist)})` : ''}.</p><p>More strength, more backspin:
            the reversal point moves away. That is how a stop shot works over a longer distance.</p>`),
        drawScene('Closer to the centre', 'Nearer centre', P.med, -0.15, { tag: 'low', label: 'nearer the centre', color: '#7ee0a0' },
          `<p>The hitting point matters too. Back to <b>medium</b> strength, but now hit only <b>a little below the centre</b>
            (blue point, about a quarter of the way down).</p>`,
          (r, res) => `<p>The backspin ran out after <b>${cm(r.revDist)}</b> (green ring)${res.med ? `, earlier than with the low hit
            at the same strength (${cm(res.med.revDist)})` : ''}.</p><p>Less spin again — this time not because of the strength but because
            of the <b>hitting point</b>. So there are two ways to move the reversal point: the <b>strength</b> and <b>how far below the
            centre</b> you hit.</p>`),
        { title: 'Centre ball', short: 'Centre ball', layout: (T) => spinLayout(T),
          beats: [
            { title: 'Centre ball, firm', view: '3d', z: 0.15, padClock: true, task: 'shot', power: P.firm, key: 'centre',
              tip: { axis: 'y', target: { x: 0, y: 0 }, tol: 0.05, clock: true, label: 'in the centre (blue point)' },
              replay: { side: true, slow: 0.35, text: '<p>From the side, in slow motion: how long does the ball slide without spin?</p>' },
              measure: { reversal: 'stun', tag: 'centre', label: 'centre: no spin up to here', color: '#ff9f43' },
              html: `<p>Last one: hit the cue ball in the <b>centre</b>, firmly (about three-quarter strength, blue band).</p>`,
              result: (r) => ({ title: 'A push', html: `<p>Hit hard in the centre, the cue ball is <b>pushed</b>: it slides with almost no
                spin${r.stunDist !== null ? ` for about <b>${cm(r.stunDist)}</b> (orange ring)` : ''} until friction has built up the
                forward roll.</p><p class="key">Within that distance a centre-ball hit gives a stop shot as well — useful for short
                stop shots.</p>` }) },
          ] },
        { title: 'Summary', short: 'Summary', layout: (T) => spinLayout(T),
          beats: [
            { title: 'Below the centre: draw', view: '3d', cam: camSideTip, padClock: true, tipShow: { x: 0, y: -0.45 }, tip: { axis: 'fixed', target: { x: 0, y: -0.45 } },
              html: `<p>Tip on the <b>bottom half</b> of the cue ball → <b>draw</b> (backspin). The point where the backspin runs out
                — where a stop shot happens — moves farther away with a <b>firmer</b> shot or a hit <b>farther below the
                centre</b>.</p>` },
            { title: 'Above the centre: follow', view: '3d', cam: camSideTip, padClock: true, tipShow: { x: 0, y: 0.45 }, tip: { axis: 'fixed', target: { x: 0, y: 0.45 } },
              html: `<p>Tip on the <b>top half</b> → <b>follow</b> (topspin). Just like draw, the follow gets stronger with a firmer shot
                or a hit farther from the centre.</p><p>Next lesson: <b>side spin</b>.</p>` },
          ] },
      ],
      summary: {
        title: 'What we have learned',
        html: `<ul><li>Tip <b>below the centre</b> → <b>draw</b>. The point where the backspin runs out (the stop-shot point) moves
          with the <b>strength</b> and with <b>how far below the centre</b> you hit.</li>
          <li>Tip <b>above the centre</b> → <b>follow</b>, stronger with more strength or a hit farther from the centre.</li>
          <li>A firm <b>centre-ball</b> hit pushes the cue ball: it slides without spin for a while — good for short stop shots.</li></ul>
          <p>Next: <b>Lesson 3 · Side spin</b>.</p>`,
      },
    },

    // ======================================================================================================
    // Lesson 3 · side spin (lessons/lesson3.txt)
    // ======================================================================================================
    {
      id: 'sidespin', num: 3, name: 'Side spin', script: true, noSkip: true,
      blurb: 'What side spin does: nothing on the way, a new angle off the cushion — and why the cue ball squirts off the aiming line.',
      balls: (T) => sideLayout(T).balls,
      scenes: [
        { title: 'Where to hit', short: 'Hitting points', layout: (T) => sideLayout(T),
          beats: [
            { title: '3 and 9 o\'clock', view: '3d', z: 0.15, padClock: true, point: ['tipPad'],
              html: `<p>The clock on the cue-ball picture again: <b>12</b> follow, <b>6</b> draw — and now <b>3 o'clock</b> (right) and
                <b>9 o'clock</b> (left): <b>side spin</b>, also called english. As before, stay inside the dashed red ring or you
                miscue.</p><p>In this lesson the tip only moves <b>sideways</b>.</p>` },
            { title: 'Side spin only acts at the cushion', view: '3d', z: 0.15, padClock: true,
              html: `<p>Side spin turns the ball around its <b>vertical axis</b>, like a spinning top. On the cloth that changes
                nothing: a ball with pure side spin rolls just as straight. It matters when the ball <b>hits a cushion</b>: the spin
                grips the felt on the cushion and changes the angle it comes off.</p>
                <p>There are two exceptions, <b>squirt</b> and <b>throw</b>, which bend the cue ball's or the object ball's path a
                little. We come to squirt later — for the next shots it is <b>switched off</b>.</p>` },
          ] },
        sideScene('Right, a little', 'Right ¼', 0.25, { tag: 'R1', label: 'right ¼' }, '3 o\'clock, a quarter of the way out',
          () => `<p>Straight into the cushion — and back out to the <b>right</b>: the spin gripped the felt on the cushion. The white line is
            the cue ball's path.</p>`),
        sideScene('Right, more', 'Right, full', 0.45, { tag: 'R2', label: 'right, full' }, '3 o\'clock, near the edge',
          () => `<p>More spin, a <b>wider angle</b> off the cushion. Compare the two white lines.</p>`),
        sideScene('Left, a little', 'Left ¼', -0.25, { tag: 'L1', label: 'left ¼' }, '9 o\'clock, a quarter of the way out',
          () => `<p>Left spin: it comes back to the <b>left</b> — the mirror image.</p>`),
        sideScene('Left, more', 'Left, full', -0.45, { tag: 'L2', label: 'left, full' }, '9 o\'clock, near the edge',
          () => `<p>More left spin, a wider angle to the left. Side spin works the same way on both sides.</p>`),
        { title: 'Squirt', short: 'Squirt', layout: (T) => sideLayout(T),
          beats: [
            { title: 'Squirt: off the aiming line', view: '2d', zoom: sideZoom, clearMarks: ['L1', 'L2'],
              html: `<p>Now the real thing. When the tip hits the cue ball off-centre, it also pushes it a little <b>sideways</b>: the
                cue ball leaves slightly <b>off the line you aimed</b>, away from the side you hit. That's <b>squirt</b> (cue-ball
                deflection). The farther off-centre, the more squirt.</p>
                <p>The two "right" paths from before stay on the table (white). Let's play the same shots again — with squirt
                <b>on</b>.</p>` },
          ] },
        sideScene('Right, a little — with squirt', 'Squirt ¼', 0.25, { tag: 'S1', label: 'right ¼, squirt', color: '#7ee0a0', dash: true }, '3 o\'clock, a quarter of the way out',
          (r) => `<p>Same shot, squirt on: the cue ball reached the cushion <b>${cm(r.cushion ? r.cushion.y : 0)}</b> to the
            ${r.cushion && r.cushion.y < 0 ? 'left' : 'right'} of where you aimed (green dashed line), so it comes off on a different
            path.</p>`, true),
        sideScene('Right, more — with squirt', 'Squirt, full', 0.45, { tag: 'S2', label: 'right full, squirt', color: '#7ee0a0', dash: true }, '3 o\'clock, near the edge',
          (r, res) => `<p>Hit farther from the centre, the cue ball squirts more: it hit the cushion <b>${cm(r.cushion ? r.cushion.y : 0)}</b>
            off the aiming line${res.S1 && res.S1.cushion ? ` (${cm(res.S1.cushion.y)} with the smaller side spin)` : ''}.</p>`, true),
        { title: 'Aiming with side spin', short: 'Summary', layout: (T) => sideLayout(T),
          beats: [
            { title: 'Correcting for squirt', view: '2d', zoom: sideZoom,
              html: `<p>To make up for squirt you aim a little to the <b>side of the spin</b>. How much depends on the <b>cue</b> (a
                lower-deflection shaft leads to less cue-ball deflection, or squirt) and on the shot — it takes practice and experience, and every cue plays a little
                differently.</p>
                <ul><li>Side spin takes effect when the ball <b>hits a cushion</b>.</li>
                <li>More spin with a hit <b>farther from the centre</b>, and with more strength.</li>
                <li>Side spin can be combined with follow or draw — that's a later lesson.</li></ul>` },
          ] },
      ],
      summary: {
        title: 'What we have learned',
        html: `<ul><li>Side spin takes effect when the cue ball <b>hits a cushion</b>; on the cloth it hardly changes the path.</li>
          <li>The effect grows with <b>how far from the centre</b> you hit and with the strength.</li>
          <li><b>Squirt</b> pushes the cue ball off the aiming line, away from the side you hit — more the farther off-centre.
          Correct for it by aiming a little to the side of the spin; how much depends on your cue.</li>
          <li>Side spin can be combined with follow or draw — a later lesson.</li></ul>
          <p>Next: <b>Lesson 4 · The stop shot</b>.</p>`,
      },
    },

    // ======================================================================================================
    // Lesson 4 · the stop shot I (lessons/lesson4.txt)
    // ======================================================================================================
    {
      id: 'stopshot', num: 4, name: 'The stop shot', script: true, noSkip: true,
      blurb: 'Stop the cue ball dead on a straight shot. Change the hitting point and the strength, see what happens, then stop it yourself.',
      balls: (T) => stopLayout(T, 0.578).balls,
      scenes: [
        { title: 'A simple stop shot', short: 'Stop shot', layout: (T, prev, tools) => stopLayout(T, 0.578, prev, tools),
          beats: [
            { title: 'The stop shot', view: '3d', z: 0.15, padClock: true,
              html: `<p>In <b>Lesson 2</b> you saw where a cue ball's backspin runs out: there it has no spin at all, and an object
                ball hit right there makes the cue ball <b>stop dead</b>. That's the <b>stop shot</b> — the first shot for placing
                the cue ball.</p><p>Here the 9 is straight in front of the side pocket.</p>` },
            { title: 'Hit the green dot', view: '3d', z: 0.15, padClock: true, task: 'shot', power: P.stop, tip: greenDot(),
              replay: { side: true, slow: 0.18, text: '<p>From the side, in slow motion: watch the cue ball\'s spin as it runs to the 9.</p>' },
              html: `<p>Put the tip on the <b style="color:#3fbf6f">green dot</b>, a little below the centre (drag up or down on the
                cue-ball picture), and shoot with the strength in the <b style="color:#4fb3ff">blue band</b> on the cue — the strength for a stop shot.</p>`,
              result: (r) => ({ title: r.cls === 'stop' ? 'Stopped' : 'Almost', html: `<p>The cue ball arrived just as its backspin was used
                up — no spin left — handed all its speed to the 9 and stopped${r.d !== undefined ? ` (it moved ${cm(r.d)} after the
                hit)` : ''}.</p><p>Now let's change things and see what happens.</p>` }) },
          ] },
        stopScene('Lower', 'Lower', (g) => ({ axis: 'y', below: g.nominal, gap: 0.06, clock: true, label: 'below the black ring (green line)' }), P.stop,
          `<p>First the <b>hitting point</b>. The black ring on the cue-ball picture is the stop-shot point. Now hit <b>lower</b> —
            anywhere on the green line below it. Same strength as before (blue band).</p>`,
          `<p>Lower means more backspin, so more of it was left at the 9.</p>`),
        stopScene('Higher', 'Higher', (g) => ({ axis: 'y', above: g.nominal, gap: 0.08, max: 0.2, clock: true, label: 'above the black ring (green line)' }), P.stop,
          `<p>Now hit <b>higher</b> than the stop-shot point (on the green line above the black ring). Same strength (blue band).</p>`,
          `<p>Higher means less backspin, and it ran out sooner.</p>`),
        stopScene('Softer', 'Softer', greenDot(), P.stopSoft,
          `<p>The other thing you can change is the <b>strength</b>. Back on the <b style="color:#3fbf6f">green dot</b> — but this
            time play it <b>softer</b>: the blue band on the cue has moved up.</p>`,
          `<p>A softer shot puts less backspin on the ball, and it has more time to wear off on the way.</p>`),
        stopScene('Firmer', 'Firmer', greenDot(), P.stopFirm,
          `<p>Same green dot, now <b>firmer</b>: the blue band has moved down.</p>`,
          `<p>A firmer shot puts more backspin on the ball and gives it less time to wear off.</p>`),
        { title: 'Your stop shot', short: 'Your turn', layout: (T, prev) => stopLayout(T, 0.628, prev),   // 5 cm farther than before
          beats: [
            { title: 'Your turn!', view: '3d', z: 0.15, padClock: true, task: 'shot', power: 'free',
              tip: { axis: 'y', clock: true, label: 'on the vertical line' },
              zone: (g) => ({ x: g.pts.GB.x, y: g.pts.GB.y, r: 0.035 }),
              html: `<p>The cue ball is now <b>5 cm farther</b> from the 9 than before, so the stop shot from before needs a little adjusting. Make the stop shot yourself: choose the hitting point (up or
                down) <b>and the strength</b> — pull the cue back as far as you like. The 9 has to go in and the cue ball has to stop
                in the <b style="color:#78e6ff">blue circle</b>.</p>`,
              success: (r) => r.made && r.inZone,
              result: (r, res, ok) => ok ? { title: 'Perfect stop shot!', html: `<p>The cue ball stopped right where it hit the 9.</p>` }
                : { title: 'Not quite', html: !r.made ? '<p>The 9 didn\'t go in. Try again.</p>'
                  : r.cls === 'follow' ? `<p>It <b>followed</b> ${cm(r.d)}. Hit a little <b>lower</b> or a little <b>firmer</b>.</p>`
                  : r.cls === 'draw' ? `<p>It <b>drew back</b> ${cm(r.d)}. Hit a little <b>higher</b> or a little <b>softer</b>.</p>`
                  : r.cls === 'scratch' ? '<p>The cue ball went in too. Try again.</p>' : '<p>So close — just outside the circle. Try again.</p>' } },
          ] },
        { title: 'Centre ball, firm', short: 'Centre ball', layout: (T, prev, tools) => stopLayout(T, 0.25, prev, tools),
          beats: [
            { title: 'Push it: centre ball', view: '3d', z: 0.15, padClock: true, task: 'demo', demo: { tipX: 0, tipY: 0, power: P.push },
              replay: { side: true, slow: 0.06, text: '<p>From the side: the cue ball slides into the 9 without spin.</p>' },
              html: `<p>One more way: the cue ball is now <b>close</b> to the 9 (25 cm). At a short distance like this you can hit the cue ball in the <b>centre</b> — firmly. It slides into the 9
                before the cloth has given it any roll, and stops. Watch.</p>`,
              result: (r) => ({ title: 'A stop shot with a centre-ball hit', html: `<p>No backspin needed: the cue ball was pushed, slid the
                short distance without spin and stopped${r.d !== undefined ? ` (it moved ${cm(r.d)} after the hit)` : ''}. Over a longer
                distance it would have started rolling, and followed.</p>` }) },
          ] },
      ],
      summary: {
        title: 'What we have learned',
        html: `<ul><li>A <b>stop shot</b>: the cue ball reaches the object ball with no spin — its backspin runs out exactly there.</li>
          <li>Control it with the <b>hitting point</b> (lower = more draw) and the <b>strength</b> (firmer = more draw).</li>
          <li>A firm <b>centre-ball</b> hit stops the cue ball too, but usually only over short distances.</li>
          <li>Along the way you also played your first <b>draw shots</b> — more about them in a later lesson.</li></ul>
          <p>Next: stop shots when the cue ball and the object ball are <b>not in a straight line</b>.</p>`,
      },
    },
  ];
  // lessons 2–4: the aim is fixed and the cue ball is what matters — no ghost ball (it would sit on a rail afterwards)
  for (const L of QB.LESSONS) if (L.id === 'followdraw' || L.id === 'sidespin' || L.id === 'stopshot')
    for (const sc of L.scenes) for (const b of sc.beats) b.aids = Object.assign({ ghost: false }, b.aids);
  // every lesson shot points at the cue to pull (after the cue-ball picture, while the tip isn't where it should be)
  for (const L of QB.LESSONS) if (L.script)
    for (const sc of L.scenes) for (const b of sc.beats) if (b.task === 'shot') b.point = (b.point || []).concat(['powerCue', 'powerCue2']);
})();
