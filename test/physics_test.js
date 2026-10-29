// Node test harness for the physics engine
global.window = global;
require('../js/constants.js'); require('../js/table.js'); require('../js/physics.js');
const C = QB.C, R = C.BALL_R, T = QB.buildTable();
const deg = 180/Math.PI;
const PP = QB.defaultParams(), MS = PP.muSlide, MR = PP.muRoll, G = 9.81;
console.log('defaults', JSON.stringify(PP));
function world(){ const w = new QB.World(T); w.recordTrails=false; return w; }

// 1) sliding -> rolling at 5/7 v0
{ const w = world(); const cb = w.addBall(0,-1,0); w.strike(cb,2,0);
  let rollEv=null; while(!rollEv){ w.substep(C.DT); rollEv = w.events.find(e=>e.type==='roll'); }
  console.log('1) roll speed', Math.hypot(rollEv.vx,rollEv.vy).toFixed(4),'expect',(2*5/7).toFixed(4),
    ' slide dist', (cb.x+1).toFixed(4),'expect',((4-(10/7)**2)/(2*MS*G)).toFixed(4),
    ' t',rollEv.t.toFixed(4),'expect',(2*2/(7*MS*G)).toFixed(4)); }

// 2) rolling distance: v=1.4286 -> stop distance v^2/(2 mu_r g)
{ const w = world(); const cb = w.addBall(0,-1.2,0); w.strike(cb,0.5,0, 0, 0.4); // natural roll (tip at 0.4R)
  const x0=cb.x; w.runToRest(); console.log('2) natural roll 0.5 m/s: dist',(cb.x-x0).toFixed(4),'expect',(0.25/(2*MR*G)).toFixed(4), 'state',cb.motion()); }

// 3) half-ball hit with rolling cue ball (30deg rule), stun (90deg rule)
function cut(cutDeg, tipY, eBall, dist=0.6){
  const w = world(); if(eBall!==undefined) w.params.eBall=eBall;
  const cb = w.addBall(0,-0.6,0); const ob = w.addBall(1,0,0);
  const phi=cutDeg/deg; // ghost ball at ob - 2R*(cos phi, sin phi) ; aim along +x from line
  const gx = ob.x - 2*R*Math.cos(phi), gy = ob.y - 2*R*Math.sin(phi);
  cb.y = gy; cb.x = gx - dist; // move cb so it travels along +x to ghost
  w.strike(cb, 2, 0, 0, tipY);
  let col=null, rollAfter=null;
  for(let i=0;i<200000 && !(col && rollAfter);i++){ w.substep(C.DT);
    for(const e of w.events){ if(e.type==='ball' && !col) col=e; if(col && e.type==='roll' && e.ball===0 && e.t>col.t && !rollAfter) rollAfter=e; } }
  const obDir = Math.atan2(col.post.bvy,col.post.bvx)*deg;
  const cbDir0 = Math.atan2(col.post.avy,col.post.avx)*deg;
  const cbDir1 = rollAfter? Math.atan2(rollAfter.vy,rollAfter.vx)*deg : NaN;
  return {obDir,cbDir0,cbDir1, rollingAtImpact: Math.abs(col.pre.avx - 0)>0};
}
for (const [c,tip,lab,dist] of [[30,0.4,'rolling CB',0.6],[30,0,'stun (center ball, 5 cm away)',0.05],[45,0.4,'rolling CB',0.6]]) {
  const r = cut(c,tip,undefined,dist); console.log(`3) cut ${c}° ${lab}: OB dir ${r.obDir.toFixed(2)}° (expect ±${c}), CB immediately ${r.cbDir0.toFixed(2)}°, CB after roll ${r.cbDir1.toFixed(2)}°`);
}
{ const r = cut(30,0.4,1.0); console.log('   e=1 half-ball rolling CB final deflection', r.cbDir1.toFixed(2),'(theory 33.7°)'); }

// 4) cushion: straight into foot rail
{ const w=world(); const cb=w.addBall(0,1.0,0); w.strike(cb,2,0,0,0.4);
  let ev=null; while(!ev){ w.substep(C.DT); ev=w.events.find(e=>e.type==='cushion'); }
  const vin=ev.speed; w.substep(C.DT); console.log('4) cushion in',vin.toFixed(4),'out',(-cb.vx).toFixed(4),'ratio',(-cb.vx/vin).toFixed(4),'state',cb.motion()); }

// 5) pocket: shoot cue ball into top-right corner along diagonal from table center
{ const w=world(); const cb=w.addBall(0,0.4,0.0); const p=T.pockets.find(p=>p.name==='top-right');
  const ang=Math.atan2(p.mouth.y-cb.y,p.mouth.x-cb.x); w.strike(cb,1.5,ang);
  w.runToRest(); console.log('5) corner pocket:', w.events.filter(e=>e.type!=='roll').map(e=>e.type+(e.pocketName?':'+e.pocketName:'')).join(','));}
{ const w=world(); const cb=w.addBall(0,0.3,-0.2); const p=T.pockets.find(p=>p.name==='top-side');
  const ang=Math.atan2(p.mouth.y-cb.y,p.mouth.x-cb.x); w.strike(cb,1.5,ang);
  w.runToRest(); console.log('5b) side pocket at angle', (ang*deg).toFixed(1), w.events.filter(e=>e.type!=='roll').map(e=>e.type+(e.pocketName?':'+e.pocketName:'')).join(','));}
// 6) energy check: long shot bouncing many rails stays on table
{ const w=world(); const cb=w.addBall(0,-0.3,0.1); w.strike(cb,7,0.3); const t=w.runToRest();
  const n=w.events.filter(e=>e.type==='cushion').length; console.log('6) hard shot: time',t.toFixed(2),'s, cushions',n,'onTable',cb.onTable, 'pos',cb.x.toFixed(3),cb.y.toFixed(3)); }
// timing
{ const t0=Date.now(); const w=world(); const cb=w.addBall(0,-0.3,0.1); w.addBall(1,0.5,0.05); w.strike(cb,5,0.05); w.runToRest(); console.log('perf: full sim ms', Date.now()-t0, 'simtime', w.time.toFixed(2)); }

// ---------------- Spin (cue tip offset) ----------------
const P0 = QB.defaultParams();
function shotLine(tipY, dist, cueV){ // straight shot CB -> OB along +x; CB displacement within 1 s after contact
  const w = world(); const cb = w.addBall(0, 0.3 - 2*R - dist, 0); const ob = w.addBall(1, 0.3, 0);
  w.cueStrike(cb, cueV, 0, 0, tipY); let col=null;
  while (w.substep(C.DT)) { if(!col) col = w.events.find(e=>e.type==='ball'); else if (w.time - col.t > 1.0) break; }
  return { dx: cb.x - col.ax, spinRatio: (col.pre.aw[1]*R)/col.pre.avx };
}
for (const [lab, tipY] of [['stop  (center)',0],['draw  (-0.5R)',-0.5],['follow(+0.5R)',0.5]]) {
  const r = shotLine(tipY, 0.15, 2.0);
  console.log(`7) ${lab}: spin at impact ω·R/v = ${r.spinRatio.toFixed(2)}, CB moves ${(r.dx*100).toFixed(1)} cm in the 1 s after contact`);
}
// rail english: rolling ball at 45° into the top rail, running vs reverse english
for (const [lab, tipX] of [['running (+0.4R)',0.4],['none',0],['reverse (-0.4R)',-0.4]]) {
  const w = world(); const W2 = T.W2;
  const cb = w.addBall(0, -0.9, W2 - 0.3); const a = Math.PI/4;
  w.strike(cb, 1.5, a, tipX, 0.4); let ev=null; // exact 45°, natural roll + side spin
  while (w.substep(C.DT)) { const c = w.events.find(e=>e.type==='cushion'); if (c && !ev){ ev=c; break; } }
  for (let i=0;i<5;i++) w.substep(C.DT);
  const out0 = Math.atan2(-cb.vy, cb.vx)*deg, sp0 = cb.speed;
  while (cb.slip() > 1e-5 && w.substep(C.DT)) {}
  const outAng = Math.atan2(-cb.vy, cb.vx)*deg; // angle from rail
  console.log(`8) rail english ${lab}: in at 45°, leaves at ${out0.toFixed(1)}° from rail (${sp0.toFixed(2)} m/s), once rolling ${outAng.toFixed(1)}° (${cb.speed.toFixed(2)} m/s)`);
}
// squirt
{ const imp = QB.cueImpact(P0, 3, 0, 0.5, 0); console.log(`9) squirt at 0.5R right english: ${(imp.squirt*deg).toFixed(2)}° to the left; ball speed center vs 0.5R: ${QB.cueImpact(P0,3,0).speed.toFixed(2)} vs ${imp.speed.toFixed(2)} m/s`); }

// ---------------- Throw (ball-ball friction), elevation (masse), miscue ----------------
function throwOf(cueV, tipX, tipY, cutDeg, dist){
  const w = world(); w.params.cueEndMass = 0;
  const ob = w.addBall(1, 0.3, 0), phi = cutDeg/deg;
  const cb = w.addBall(0, ob.x - 2*R*Math.cos(phi) - dist, ob.y - 2*R*Math.sin(phi));
  w.cueStrike(cb, cueV, 0, tipX, tipY); let col = null;
  while (!col && w.substep(C.DT)) col = w.events.find(e => e.type === 'ball');
  const obDir = Math.atan2(col.post.avy, col.post.avx)*deg, loc = Math.atan2(-col.ny, -col.nx)*deg;
  let t = obDir - loc; while (t > 180) t -= 360; while (t < -180) t += 360; return t;
}
for (const [lab, v, x, y, c, d] of [['stun 30° cut, slow', 1.0, 0, 0, 30, 0.05], ['stun 30° cut, fast', 4.5, 0, 0, 30, 0.05],
  ['rolling 30° cut, slow', 1.0, 0, 0.4, 30, 0.6], ['straight, right english', 1.5, 0.4, 0, 0, 0.05]])
  console.log(`10) throw ${lab}: ${throwOf(v, x, y, c, d).toFixed(2)}° (cut-induced throw reduces the cut; right english throws OB left)`);
{ const w = world(); const cb = w.addBall(0, -0.8, 0); w.cueStrike(cb, 2, 0, 0.4, -0.2, 40/deg); for (let i = 0; i < 4000; i++) w.substep(C.DT);
  console.log(`11) masse: 40° elevation, right english, 0.8 s: CB at (${cb.x.toFixed(3)}, ${cb.y.toFixed(3)}) -> curved ${cb.y < -0.02 ? 'right ✓' : 'NOT right ✗'}`); }
{ const P = QB.defaultParams(), ok = QB.cueImpact(P, 3, 0, 0, -0.5), mis = QB.cueImpact(P, 3, 0, 0.7, 0);
  console.log(`12) miscue limit ${QB.miscueLimit(P).toFixed(3)}R; 0.5R draw: ${ok.speed.toFixed(2)} m/s miscue=${ok.miscue}; 0.7R english: ${mis.speed.toFixed(2)} m/s, ${(mis.angle*deg).toFixed(1)}° off line, miscue=${mis.miscue}`); }
