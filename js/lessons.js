// Qball — lessons. Two kinds:
//
// 1) Practice lessons (the stop shot): the shot is set up, the player tries it at several strengths, the app
//    measures each shot.
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
//      zoom: { at: name or [names] (zoom on their middle), k: magnification }   — 2D view; none = whole table
//      cam:  { along: [A, B], look: name, dist (m), tilt (°), fov (°), back (m) }  — 3D camera on the line A→B,
//            behind `look`, looking down at `tilt`; `back` = distance behind A instead of dist. none = cue view
//      aids: { aim, ghost, obpath, tangent, cbpath, eclipse, tipmark, overview } (true / false)
//      marks: { lines: [{ pts: [names], color }], dot: name (red aiming point), labels: [{ at, text, dx, dy }] }
//      task: 'shot' (the player shoots, strength fixed) | 'place' (the player drags the ghost ball) | none (Next)
//      aim: 'free' (the player aims; aimStart: name) — otherwise the aim is fixed at layout.aimAt
//      z: cue-view zoom for the shot (0 = down on the cue … 1 = standing)
//    }
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
  const shotHtml = `<p><b>Your turn.</b> The aim is set and the strength is fixed. Pull the cue on the right side of the
    3D view down and let it go (or drag back on the table in the 2D view).</p>`;
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
            the arrow keys work too). The white line shows where the cue ball goes. Then pull the cue down and let it go
            — the strength is fixed.</p>` },
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

  {
    id: 'stop', num: 2, name: 'The stop shot',
    blurb: 'Stop the cue ball dead where it hits the object ball. Strength and a slightly lower hit are all it takes.',
    // straight in: object ball 20 cm in front of the top side pocket, cue ball 50 cm behind it
    balls: (T) => [{ num: 0, x: 0, y: T.W2 - 0.20 - 0.50 }, { num: 1, x: 0, y: T.W2 - 0.20 }],
    aimAt: 1,
    tipRange: { x: [0, 0], y: [-0.6, 0] },          // only on the vertical line through the centre, at or below it
    bands: [
      { id: 'soft', name: 'Soft', max: 1.4 },
      { id: 'medium', name: 'Medium', max: 3.2 },
      { id: 'hard', name: 'Hard', max: Infinity },
    ],
    intro: {
      title: 'Lesson 2 · The stop shot',
      html: `<p>A <b>stop shot</b> leaves the cue ball exactly where it hits the object ball. It is the first position
        shot every player learns, and the base for follow and draw.</p>
        <p>The shot is set up for you: a straight shot into the side pocket. The aim is fixed. You only control
        <b>two things</b>:</p>
        <ul><li><b>Strength</b> — how far you pull the cue back. The meter in the panel shows <i>soft</i>, <i>medium</i> or <i>hard</i>.</li>
        <li><b>How low you hit the cue ball</b> — on the cue-ball diagram, along the line straight down from the centre.</li></ul>
        <p>After each shot the balls are set up again.</p>`,
    },
    steps: [
      {
        title: 'Center ball',
        tip: { y: 0, tol: 0.03, label: 'at the centre' },
        html: `<p><b>Step 1 · Hit the centre of the cue ball.</b> Leave the tip in the middle of the diagram.</p>
          <p>Shoot three times: <b>soft</b>, <b>medium</b> and <b>hard</b>. Watch what the cue ball does after it hits
          the object ball.</p>`,
        done: (r) => `<p>What happened?</p>${r}
          <p>Hit in the centre, the cue ball first <b>slides</b> over the cloth. Friction then makes it start
          <b>rolling</b> forward.</p>
          <ul><li><b>Soft:</b> it is already rolling when it arrives, and that forward roll carries it on after the hit —
          it <b>follows</b>.</li>
          <li><b>Medium and hard:</b> it arrives still sliding, hands all its speed to the object ball and
          <b>stops</b>.</li></ul>
          <p class="key">A sliding cue ball stops. A rolling cue ball follows.</p>`,
      },
      {
        title: 'A little below center',
        tip: { y: -0.15, tol: 0.07, label: 'on the green marker, a little below the centre' },
        html: `<p><b>Step 2 · Hit a little below the centre.</b> Move the tip down to the <b style="color:#3fbf6f">green
          marker</b> on the cue-ball diagram (about a sixth of the way to the edge).</p>
          <p>That gives the cue ball a little <b>backspin</b>, which cancels the forward roll it picks up on the way.
          Try <b>soft</b>, <b>medium</b> and <b>hard</b> again.</p>`,
        done: (r) => `<p>Compare:</p>${r}
          <ul><li><b>Soft:</b> the backspin has worn off and turned into roll — it still follows, but much less.</li>
          <li><b>Medium:</b> the backspin is used up just as it reaches the object ball — it <b>stops dead</b>.</li>
          <li><b>Hard:</b> backspin is still left at contact — it <b>draws back</b>.</li></ul>
          <p class="key">To stop the ball, hit lower the softer you play and the farther the object ball is.</p>`,
      },
    ],
    finish: {
      title: 'Well done!',
      html: `<p>You have the stop shot: <b>centre ball and firm</b> when the balls are close, <b>a little lower</b> when
        you play softer or the object ball is farther away.</p>
        <p>Try it in <i>Free practice</i> with longer distances, or repeat the lesson.</p>`,
    },
  },
  ];
})();
