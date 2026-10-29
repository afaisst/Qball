<p align="center"><img src="assets/icon.svg" width="96" alt="Qball icon"></p>

<h1 align="center">Qball</h1>

<p align="center"><b>A realistic billiards (pool) simulator in the browser, for playing and practicing.</b><br>
Real ball physics (sliding, rolling, spin, squirt, throw, cushions), 9- and 10-ball, drills, and a 3D cue's-eye view.</p>

![Qball: top view, 3D cue view and the control panel](assets/screenshot.png)

## Quick start

No install, no build, no server. Plain HTML + JavaScript.

```bash
git clone https://github.com/afaisst/Qball.git
cd Qball
open index.html        # or double-click index.html (macOS); any modern browser works
```

Everything runs offline. The only library, [three.js](https://threejs.org) (r149, for the 3D view), is vendored in `js/vendor/`.

To host it, any static web host works. For example, turn on **GitHub Pages** (Settings → Pages → *Deploy from branch* → `main` / root) and the game is at `https://afaisst.github.io/Qball/`.

## Features

- **Physics, not animation:** every ball carries a velocity and a spin vector. Sliding and rolling friction, side-spin decay, cue-tip contact with miscues, squirt (cue deflection), swerve/massé with an elevated cue, ball–ball throw, and a research-based cushion model ([Mathavan et al. 2010](#references)). See [Physics model](#physics-model).
- **Spin and elevation:** pick the tip contact point on a cue-ball diagram and raise the cue butt on a side view. Hitting outside the dashed ring is a miscue.
- **Rail clearance:** near a cushion, the cue has to pass over the rail. The part of the cue ball you can't reach is shaded red, and raising the cue shrinks it.
- **Games:** 8-, 9- and 10-ball racks plus free practice. 9-ball and 10-ball use (simplified) foul rules with ball in hand.
- **Drills:** Billiard University–style target drills with level progression and scoring, and pattern drills (L-drill, line-ups, rail balls, diamond grid, Dr. Dave's 3-ball drill, random layouts, play the ghost).
- **Free ball placement:** build any position from all 15 balls.
- **Views:** 2D top view, a 3D cue's-eye view, or both (split). The 3D view has drag-to-aim, a pull-back cue to shoot, zoom from "down on the shot" to standing, and a **walk mode** to look at the layout from around the table.
- **Aiming aids** (each can be turned off): aim line, ghost ball, object-ball path, cue-ball path after contact, tangent line, ball trails, practice markings.
- **Test mode** for physics experiments: exact inputs, sliders for every physics parameter, shot reports, replay, slow motion, and copy/paste of complete shots as JSON.

## How to play

### Shooting (top view)

| Action | How |
|---|---|
| Aim | Move the mouse. <kbd>←</kbd> <kbd>→</kbd> fine-tune (<kbd>Shift</kbd> coarse, <kbd>Alt</kbd> extra fine). <kbd>Space</kbd> locks the aim. |
| Shoot | Press on the table, drag back to pull the cue, release. <kbd>Esc</kbd> cancels. |
| Spin | Click/drag on the cue-ball diagram, or <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd>. <kbd>C</kbd> or double-click centers it. |
| Cue elevation | Drag the side-view diagram, or <kbd>E</kbd> raise / <kbd>Q</kbd> lower. Double-click for a level cue. |
| Ball in hand | Drag the cue ball where you want it. |
| View | 2D / Split / 3D in the top bar. <kbd>V</kbd> cycles; the choice is remembered. |
| Test mode | The small *test mode* link at the bottom right, or <kbd>T</kbd>. |

### 3D cue view

- **Aim:** drag left/right (<kbd>Shift</kbd> for fine steps). The 3D view doesn't follow the mouse.
- **Shoot:** drag the little cue on the right side down to pull back, then release.
- **Zoom:** mouse wheel. Zooming in gets you down on the shot (eye just above the cue); zooming out stands you up. When you raise the cue, the view backs off automatically so the whole stick stays visible.
- **Map:** in 3D-only view, a small top-view map appears for ball in hand and arranging balls; the 🗺 button shows it any time.
- **Walk mode:** press **🚶 walk** to stand up where you are. On the map, drag the blue dot to move or click where to go; you walk around the table, not through it. While you move, your eyes stay on the spot you were looking at. Drag the 3D view to look around (↔ turn, ↕ up/down); the wheel bends you down. Press walk again, double-click the map, or pick up the cue to return to your shot.

### Games

- **9-ball / 10-ball (solo practice, simplified WPA rules):** hit the lowest-numbered ball first, and after contact pocket a ball or drive any ball to a rail. A scratch is a foul too. Any foul gives ball in hand anywhere, and a game ball pocketed on a foul is re-spotted. Legally pocketing the 9 (or 10) wins the rack. Not yet included: break requirements, call shots, the three-foul rule, push-out.
- **8-ball:** the rack with ball in hand for the break (no 8-ball rules yet).
- **Free practice:** the cue ball and the 1-ball.

The panel shows the rack: balls still on the table are faded, pocketed ones are solid, and the next ball is ringed.

### Drills

- **Target drills** (inspired by the Billiard University Exam I: cut shots, stop, follow, draw, stun, wagon wheel): you start at level 4. A make moves you up a level and a miss moves you down. After 10 shots, the score is the final level plus makes at the top level. The target pocket pulses yellow, and cue-ball targets are cyan circles.
- **Pattern drills:** take ball in hand, then run the balls. Every shot must pocket a ball, and a miss or scratch ends the try. You get 10 tries. Drills: L-drill, diamond grid, long line-up, cross line, balls on the rails, Dr. Dave's 3-ball drill, random layouts, play the ghost.
- **Free Ball Placement:** drag any of the 15 balls onto the table. *Arrange* (<kbd>M</kbd>) moves balls; dragging a ball off the table or double-clicking it removes it. *↺ Last setup* restores the position before the last shot.

Draw shots and raised-cue shots leave a small chalk mark on the cloth, like on a real table.

### Test mode

- Drag any ball (<kbd>Shift</kbd> or *Move balls*), or type exact positions in meters.
- **Shoot precisely:** aim angle, cue speed (m/s), tip offset, elevation, or an exact cut angle (*Set cut*). <kbd>Enter</kbd> shoots, <kbd>R</kbd> replays the identical shot, <kbd>X</kbd> stops all balls.
- **Physics sliders** for every parameter below, plus a choice of cushion model.
- **Shot report** (cut angle, departure angles, speeds), live ball state (sliding/rolling, ω), trails, contact positions, full-physics path preview, and slow motion.
- **Share a shot:** *Copy last shot* puts the full shot on the clipboard as JSON: positions, aim, speed, tip, elevation and all physics settings. *Load shot…* sets it up again, and `node test/replay_shot.js shot.json` replays it in the terminal.

## Physics model

`js/physics.js`. SI units, origin at the table center, +x toward the foot rail, +y toward the top rail.

| Quantity | Default |
|---|---|
| Table | 9 ft, 2.54 × 1.27 m playing surface |
| Pockets | corner mouth 4.5″, side 5″, jaw angles 142° / 104° |
| Ball | R = 28.575 mm, m = 0.17 kg |
| Sliding friction μs | 0.11 |
| Rolling resistance μr | 0.022 |
| Side-spin decay | 20 rad/s² |
| Ball–ball restitution | 0.95 |
| Ball–ball friction | μ = 0.00995 + 0.108·e^(−1.088·slip) (measured curve) |
| Cushion model | Mathavan 2010 (alternatives: Han 2005, simple) |
| Cushion restitution / friction | e = 0.85 (−0.004 per m/s), μc = 0.25, nose at 63.5% of ball height |
| Cue | 0.54 kg, end mass 3 g (squirt), tip friction 0.66, max speed 6 m/s, elevation 0–80° |
| Timestep | 0.2 ms, with exact rewind to each collision |

The defaults were tuned by feel against real shots (e.g. 3-rail and kick shots) and can all be changed in test mode.

**Ball motion.** Each ball has linear velocity **v** and angular velocity **ω**. The slip of the contact point on the cloth decides the phase:

- **Sliding:** friction μs·g opposes the slip. A center-ball hit turns into rolling at 5/7 of its initial speed.
- **Rolling:** rolling resistance μr·g, with spin locked to the velocity.
- **Side spin** decays at a constant rate.

Each phase has constant acceleration, so it is integrated analytically, and phase changes happen at the exact time.

**Cue strike.** The pull-back sets the cue speed V. The tip hits the ball at the chosen offset (a, b) on a cue tilted by elevation θ. The impulse magnitude is

`F = (1+e)·V·(ê·k) / ((ê·k)²/M + 1/m + |OP×k|²/I)`

which reduces to Alciatore's TP A.30 for a level cue. This gives speed and all three spin components, so an elevated cue with english produces **swerve and massé**. If the contact angle exceeds the tip friction limit, the shot is a **miscue**: the tip slides, and you get a weak, off-line, nearly spinless hit. **Squirt** comes from the shaft's effective end mass (TP A.31).

**Ball–ball collisions.** A normal impulse with restitution, plus friction at the contact. Friction uses the measured μ(slip) curve and the spins of both balls. This produces cut-induced throw (≈3.5° for a slow 30° stun cut, <1° when fast) and spin-induced throw, and transfers a little spin to the object ball.

**Cushions** (selectable):

- **Mathavan 2010** (default): the impact is integrated through compression and restitution. Friction acts both at the cushion nose and at the slate, where the cushion presses the ball into the cloth. Topspin, slide and running/reverse english all shape the rebound.
- **Han 2005:** a single impulse at the cushion nose with restitution and friction.
- **Simple:** reflect the normal velocity and keep rolling. Not physical; kept for comparison.

**Pockets:** the jaws are real line segments (balls can rattle). A ball drops when its center enters the pocket's drop circle.

## Tests

```bash
node test/physics_test.js      # rolling speed 5/7, slide/roll distances, 30°/90° rules, cushion, pockets,
                               # stop/draw/follow, english off the rail, squirt, throw, massé, miscues
node test/compare_cushions.js  # compares the cushion models
node test/replay_shot.js shot.json [param=value …]   # replays a copied shot, listing every contact
```

The tests need [Node.js](https://nodejs.org) and print measured values next to the theoretical ones.

## Project structure

```
index.html          page layout
css/style.css       styles
js/constants.js     table, ball, cue dimensions and physics defaults
js/table.js         table geometry: cushions, pocket jaws, diamonds, spots
js/physics.js       ball motion, collisions, cushion models, cue impact
js/render.js        2D top view (canvas)
js/view3d.js        3D cue view and walk mode (three.js)
js/setups.js        game racks and drill definitions
js/audio.js         sounds (Web Audio, generated)
js/main.js          input, game and drill logic, UI
js/vendor/          three.js r149 (MIT license)
test/               command-line physics tests (Node.js)
assets/             icon and screenshot
```

## Roadmap

- 8-ball rules and a two-player mode (turns, fouls, groups, called shots)
- Break rules for 9/10-ball, push-out, three-foul rule
- Jump shots (vertical ball motion) and the table-friction impulse during elevated hits
- More drills

## References

- D. G. Alciatore, *The Illustrated Principles of Pool and Billiards* and his technical proofs at [drdavepoolinfo.com](https://drdavepoolinfo.com) (cue–ball impact TP A.30, squirt TP A.31, throw).
- S. Mathavan, M. R. Jackson, R. M. Parkin, "A theoretical analysis of billiard ball dynamics under cushion impacts," *Proc. IMechE Part C* 224 (2010).
- H. Han, "Dynamics in carom and three cushion billiards," *J. Mech. Sci. Technol.* 19 (2005).
- Drills inspired by the [Billiard University](https://billiarduniversity.org/) exams and [Dr. Dave's drill pages](https://drdavepoolinfo.com/). Ball positions are approximations, not the official diagrams.

## Credits

Created by Andreas Faisst. The 3D view uses [three.js](https://threejs.org) (MIT license, see `js/vendor/three.LICENSE.txt`).
