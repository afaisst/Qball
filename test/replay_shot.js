// Replay a shot copied with "Copy last shot" and print what happens.
//   node test/replay_shot.js shot.json            (or pipe the JSON on stdin)
//   node test/replay_shot.js shot.json cushionModel=realistic muCushion=0.2   (override parameters)
global.window = global;
const path = require('path'), fs = require('fs');
const js = path.join(__dirname, '..', 'js');
require(path.join(js, 'constants.js')); require(path.join(js, 'table.js')); require(path.join(js, 'physics.js'));
const args = process.argv.slice(2);
const file = args.find(a => !a.includes('='));
const shot = JSON.parse(file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8'));
const over = {};
for (const a of args.filter(a => a.includes('='))) { const [k, v] = a.split('='); over[k] = isNaN(+v) ? v : +v; }
const T = QB.buildTable(), deg = 180 / Math.PI;
const w = new QB.World(T, Object.assign(QB.defaultParams(), shot.params || {}, over)); w.recordTrails = false;
for (const b of shot.balls) { const q = w.addBall(b.num, b.x, b.y); q.onTable = b.onTable !== false; }
const cb = w.balls.find(b => b.num === 0);
const imp = w.cueStrike(cb, shot.cueSpeed, shot.aimDeg / deg, shot.tipX, shot.tipY, (shot.elevDeg || 0) / deg);
const f = (v, d = 3) => (+v).toFixed(d), name = (id) => w.balls[id].num === 0 ? 'CB' : w.balls[id].num + '-ball';
console.log(`cue ${shot.cueSpeed} m/s, tip (${shot.tipX}, ${shot.tipY})R, elev ${shot.elevDeg || 0}°, aim ${shot.aimDeg}° -> ball ${f(imp.speed, 2)} m/s, launch ${f(imp.angle * deg, 2)}°${imp.miscue ? ' MISCUE' : ''}`);
console.log('params', JSON.stringify(w.params));
let n = 0;
while (w.substep(QB.C.DT) && w.time < 60) {
  for (const e of w.events) {
    const t = f(e.t, 3) + ' s';
    if (e.type === 'cushion') { const b = w.balls[e.ball]; console.log(`${t}  ${name(e.ball)} rail ${e.cushion} (${e.part}) at (${f(b.x)}, ${f(b.y)}), normal speed in ${f(e.speed, 2)} m/s, speed out ${f(b.speed, 2)} m/s, heading out ${f(Math.atan2(b.vy, b.vx) * deg, 1)}°`); }
    else if (e.type === 'ball') console.log(`${t}  ${name(e.a)} hits ${name(e.b)} at (${f(e.ax)}, ${f(e.ay)}), ${f(e.speed, 2)} m/s`);
    else if (e.type === 'pocket') console.log(`${t}  ${name(e.ball)} pocketed in ${e.pocketName}`);
  }
  w.events = [];
}
for (const b of w.balls) console.log(`final ${name(b.id)}: ${b.onTable ? `(${f(b.x)}, ${f(b.y)})` : 'pocketed'}`);
