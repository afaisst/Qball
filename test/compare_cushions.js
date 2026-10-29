global.window=global;const d=process.cwd();require(d+'/js/constants.js');require(d+'/js/table.js');require(d+'/js/physics.js');
const T=QB.buildTable(), R=QB.C.BALL_R;
const cfgs={
 'old default (simple, μr .010, e .98)':{cushionModel:'simple',muRoll:0.01,eCushion:0.98,muSlide:0.2},
 'your values (simple, μr .022, e .72)':{cushionModel:'simple',muRoll:0.022,eCushion:0.72},
 'realistic, μr .010, e .72':{cushionModel:'realistic',muRoll:0.01,eCushion:0.72},
 'realistic, μr .010, e .85':{cushionModel:'realistic',muRoll:0.01,eCushion:0.85},
 'realistic, μr .022, e .72':{cushionModel:'realistic',muRoll:0.022,eCushion:0.72},
};
function W(c){const w=new QB.World(T,Object.assign(QB.defaultParams(),c));w.recordTrails=false;return w;}
for(const [name,c] of Object.entries(cfgs)){
  // A: rolling ball head-on into foot rail: speed once rolling again / speed into rail
  let w=W(c); let b=w.addBall(0,1.0,0); w.strike(b,1.5,0,0,0.4); let vin=null,vout=null;
  while(w.substep(QB.C.DT)){ for(const e of w.events){ if(e.type==='cushion'&&!vin) vin=e.speed; if(vin&&e.type==='roll'&&!vout) vout=Math.hypot(e.vx,e.vy);} w.events=[]; if(vout) break; if(vin && b.slip()<1e-5 && !vout){ vout=b.speed; break;} }
  // B: path length of a 2 m/s center-ball shot at 25 deg from head spot
  w=W(c); b=w.addBall(0,-0.635,0); w.strike(b,2.0,25*Math.PI/180); let L=0,px=b.x,py=b.y,n=0;
  while(w.substep(QB.C.DT)){L+=Math.hypot(b.x-px,b.y-py);px=b.x;py=b.y;}
  n=w.events.filter(e=>e.type==='cushion').length;
  // C: center-ball speed needed for an up-and-back lag (start x=-1.15, stop near x=-1.15 after foot rail)
  let lo=0.3,hi=8; for(let i=0;i<30;i++){const v=(lo+hi)/2; const w2=W(c); const bb=w2.addBall(0,-1.15,0); w2.strike(bb,v,0); w2.runToRest(40); const ev=w2.events; const foot=ev.some(e=>e.type==='cushion'&&e.cushion==='foot'); const head=ev.some(e=>e.type==='cushion'&&e.cushion==='head'); if(head) hi=v; else if(!foot||bb.x>-1.15) lo=v; else hi=v; }
  console.log(name.padEnd(40), 'rail retention (rolling→rolling):',(vout/vin).toFixed(2),' | 2 m/s shot path:',L.toFixed(1),'m,',n,'rails',' | lag speed:',((lo+hi)/2).toFixed(2),'m/s');
}
