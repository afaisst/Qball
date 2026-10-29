// Qball — lessons: step-by-step introductions. Each lesson sets up the balls, limits what the player can change
// (so the lesson is about one thing), and walks through steps with short explanations. The app (main.js) runs
// them: it shows the pop-ups, enforces the limits, measures every shot and resets the balls afterwards.
//
// A lesson:  { id, num, name, blurb, balls(T), aimAt (ball number), tipRange, bands, intro, steps, finish }
//   tipRange : what the tip may do — { x: [min, max], y: [min, max] } in ball radii
//   bands    : strength ranges by cue speed (m/s), in order
//   step     : { title, tip: { y, tol, label }, html, done(results) -> html }
//              (the step is complete when every band has been tried with the tip where the step wants it)
window.QB = window.QB || {};

QB.LESSONS = [
  {
    id: 'stop', num: 1, name: 'The stop shot',
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
      title: 'Lesson 1 · The stop shot',
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
