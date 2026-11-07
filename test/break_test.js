// Break statistics: average over N racks (random rack order, cue ball anywhere on the head string, tiny aim jitter).
// usage: node test/break_test.js [8ball|9ball|10ball] ['{"tipE":0.9,...} params'] [cue speeds, e.g. 6,9] [N]
global.window = global;
const Q=__dirname+'/../js/';
require(Q+'constants.js'); require(Q+'table.js'); require(Q+'physics.js'); require(Q+'setups.js');
const C=QB.C,R=C.BALL_R,T=QB.buildTable();
const game=process.argv[2]||'9ball', over=JSON.parse(process.argv[3]||'{}'), speeds=(process.argv[4]||'6').split(',').map(Number), N=+(process.argv[5]||12);
let seed=7; Math.random=()=>(seed=(seed*16807)%2147483647)/2147483647;
const g=QB.Setups.GAMES.find(x=>x.id===game);
for(const v of speeds){
  const acc={pocketed:0,rails:0,travel:0,maxV:0,ms:0,cbScratch:0};
  for(let k=0;k<N;k++){
    const w=new QB.World(T,Object.assign(QB.defaultParams(),over)); w.recordTrails=false;
    for(const b of g.balls(T)) w.addBall(b.num,b.x,b.y);
    const cb=w.balls.find(b=>b.num===0); cb.x=T.headString; cb.y=(Math.random()-0.5)*0.3;
    const apex=w.balls.filter(b=>b.num).sort((a,b)=>a.x-b.x)[0];
    const aim=Math.atan2(apex.y-cb.y,apex.x-cb.x)+(Math.random()-0.5)*0.004;
    const imp=w.cueStrike(cb,v,aim,0,-0.05,0);
    const start=Object.fromEntries(w.balls.map(b=>[b.id,[b.x,b.y]])); const touched=new Set(); let t=0;
    const t0=Date.now();
    while(t<20){ if(!w.substep(C.DT)) break; t+=C.DT; for(const e of w.events) if(e.type==='cushion') touched.add(e.ball); w.events=[];
      if(t<0.4) for(const b of w.balls) if(b.num) acc.maxV=Math.max(acc.maxV,Math.hypot(b.vx,b.vy)); }
    acc.ms+=Date.now()-t0;
    const obs=w.balls.filter(b=>b.num);
    acc.pocketed+=obs.filter(b=>!b.onTable).length; acc.rails+=obs.filter(b=>touched.has(b.id)).length;
    acc.travel+=obs.map(b=>b.onTable?Math.hypot(b.x-start[b.id][0],b.y-start[b.id][1]):1).reduce((a,c)=>a+c,0)/obs.length;
    if(!cb.onTable) acc.cbScratch++;
    acc.ballV=imp.speed;
  }
  console.log(`${game} cue ${v} m/s (CB ${acc.ballV.toFixed(1)} m/s): pocketed ${(acc.pocketed/N).toFixed(2)}, balls to a rail ${(acc.rails/N).toFixed(1)}, mean travel ${(acc.travel/N).toFixed(2)} m, fastest OB ${acc.maxV.toFixed(1)} m/s, scratches ${acc.cbScratch}/${N}, ${(acc.ms/N).toFixed(0)} ms/break`);
}
