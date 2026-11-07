# Qball — physics and code

The player's guide is the [README](../README.md). This page is for the curious: how the simulation works, how to test it, and how the code is organised.

## Physics model

`js/physics.js`. SI units, origin at the table center, +x toward the foot rail, +y toward the top rail.

| Quantity | Default |
|---|---|
| Table | 9 ft, 2.54 × 1.27 m playing surface |
| Pockets | corner mouth 4.5″, side 5″, jaw angles 142° / 104° |
| Ball | R = 28.575 mm, m = 0.17 kg |
| Sliding friction μs | 0.11 |
| Rolling resistance μr | 0.0155 |
| Side-spin decay | 20 rad/s² |
| Ball–ball restitution | 0.975 |
| Ball–ball friction | μ = 0.00995 + 0.108·e^(−1.088·slip) (measured curve) |
| Cushion model | Mathavan 2010 (alternatives: Han 2005, simple) |
| Cushion restitution / friction | e = 0.85 (−0.018 per m/s), μc = 0.25, nose at 63.5% of ball height |
| Playing cue | 0.54 kg (19 oz), tip efficiency 0.80, end mass 3 g (squirt), tip friction 0.66, max speed 6 m/s (cue ball ≈ 8 m/s), elevation 0–80° |
| Break cue | 0.567 kg (20 oz), phenolic tip: efficiency 0.90, tip friction 0.55 (miscues sooner), end mass 8 g, max speed 9 m/s (cue ball ≈ 13 m/s) |
| Ball contact (groups) | Hertz, E = 5 GPa, ν = 0.35 (contact ≈ 0.25 ms) |
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

**Groups of touching balls (the break, frozen balls).** One-pair-at-a-time impulses fail in a rack: the order of the pairs decides where the energy goes, and on the break the head ball handed almost everything to one neighbour, so a single ball shot out of a back corner at nearly the cue ball's speed while the rest barely moved. Real balls are a little elastic; a contact lasts about 0.25 ms, much longer than a push needs to cross the tiny gaps in a rack, so all the contacts act together. When a collision involves a ball that touches (within 1.5 mm) other balls, the whole group is integrated with Hertz contact forces (F ∝ δ^1.5) in 2 µs steps until every contact lets go, with the same restitution and ball–ball friction as the impulse model (the two agree within 0.3° of throw for a single pair). On the break the energy now spreads through the rack: the back corner balls and the wing balls leave fastest, the head ball slowly, and the cue ball stops or bounces back a little. A frozen combination passes nearly all the speed to the far ball.

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
node test/break_test.js 8ball '{}' 6,9 20             # break statistics over 20 racks at cue speeds 6 and 9 m/s
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
js/textures.js      procedural cloth, felt, wood, rug, floor and wallpaper textures
js/art.js           the paintings (generated by tools/embed-art.js from assets/art/)
tools/embed-art.js  packs assets/art/*.jpg into js/art.js
js/setups.js        game racks and drill definitions
js/lessons.js       lessons: setups, limits, steps, camera moves and texts
lessons/            lesson scripts (plain text) the lessons are written from
js/audio.js         sounds, synthesized in the browser (Web Audio): ball clacks, cue tip, cushion thuds, pocket drops, cloth rumble, room reverb
js/main.js          input, game and drill logic, UI
js/vendor/          three.js r149 (MIT license)
test/               command-line physics tests (Node.js)
docs/physics.md     this page
assets/             icon, screenshots, the paintings (assets/art)
```

## Writing lessons

Lesson scripts are written as plain text in [`lessons/`](../lessons) (for example `lessons/lesson1.txt`: the steps, the set-ups as little sketches, what the player sees and does) and turned into lesson definitions in `js/lessons.js`. The comment at the top of that file describes both kinds of lesson:

- **Practice lessons** (the stop shot): balls, what the player may change, strength bands, steps and texts.
- **Scripted lessons** (the ghost ball): set-ups made of *beats*. Each beat sets the view, a 2D zoom, a 3D camera move, which aiming aids show, extra marks (lines, the aiming dot, labels), and what the player has to do (read and press Next, take the shot, or place the ghost ball).

## References

- D. G. Alciatore, *The Illustrated Principles of Pool and Billiards* and his technical proofs at [drdavepoolinfo.com](https://drdavepoolinfo.com) (cue–ball impact TP A.30, squirt TP A.31, throw).
- S. Mathavan, M. R. Jackson, R. M. Parkin, "A theoretical analysis of billiard ball dynamics under cushion impacts," *Proc. IMechE Part C* 224 (2010).
- H. Han, "Dynamics in carom and three cushion billiards," *J. Mech. Sci. Technol.* 19 (2005).
