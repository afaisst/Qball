// Qball — canvas rendering (top-down).
window.QB = window.QB || {};

(function () {
  const C = QB.C, R = C.BALL_R;

  class Renderer {
    constructor(canvas, table) {
      this.canvas = canvas; this.ctx = canvas.getContext('2d');
      this.table = table;
      this.tableLayer = document.createElement('canvas');
      this.view = { scale: 300, ox: 0, oy: 0, dpr: 1 };
      this.margin = 0;             // extra floor shown around the table (m), e.g. the walking area in Walk mode
      this.practiceGrid = false;   // dots at every diamond-to-diamond line intersection
    }

    resize() {
      const dpr = window.devicePixelRatio || 1;
      const rect = this.canvas.getBoundingClientRect();
      this.canvas.width = Math.max(1, Math.round(rect.width * dpr));     // (hidden in 3D-only view -> 1x1)
      this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
      const outerL = C.TABLE_L + 2 * (C.CUSHION_W + C.RAIL_W + this.margin) + 0.10;
      const outerW = C.TABLE_W + 2 * (C.CUSHION_W + C.RAIL_W + this.margin) + 0.10;
      const s = Math.min(this.canvas.width / outerL, this.canvas.height / outerW);
      this.view = { scale: s, ox: this.canvas.width / 2, oy: this.canvas.height / 2, dpr };
      this.tableLayer.width = this.canvas.width; this.tableLayer.height = this.canvas.height;
      this.drawTable(this.tableLayer.getContext('2d'));
    }

    // world (m) -> canvas px  (y flipped so +y is up)
    sx(x) { return this.view.ox + x * this.view.scale; }
    sy(y) { return this.view.oy - y * this.view.scale; }
    toWorld(clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect(), v = this.view;
      const px = (clientX - rect.left) * v.dpr, py = (clientY - rect.top) * v.dpr;
      return { x: (px - v.ox) / v.scale, y: -(py - v.oy) / v.scale };
    }
    px(m) { return m * this.view.scale; }

    // ---------------- Table (pre-rendered) ----------------
    drawTable(ctx) {
      const T = this.table, c = C.CUSHION_W, rw = C.RAIL_W;
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      const X0 = -T.L2 - c - rw, Y0 = T.W2 + c + rw;
      const w = this.px(C.TABLE_L + 2 * (c + rw)), h = this.px(C.TABLE_W + 2 * (c + rw));

      // drop shadow + wooden frame
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = this.px(0.05); ctx.shadowOffsetY = this.px(0.015);
      const wood = ctx.createLinearGradient(0, this.sy(Y0), 0, this.sy(-Y0));
      wood.addColorStop(0, '#6b3b1f'); wood.addColorStop(0.5, '#4f2a14'); wood.addColorStop(1, '#3d1f0e');
      ctx.fillStyle = wood;
      roundRect(ctx, this.sx(X0), this.sy(Y0), w, h, this.px(0.05)); ctx.fill();
      ctx.restore();
      // inner rail edge highlight
      ctx.strokeStyle = 'rgba(255,220,170,0.15)'; ctx.lineWidth = Math.max(1, this.px(0.004));
      roundRect(ctx, this.sx(X0) + this.px(0.012), this.sy(Y0) + this.px(0.012), w - this.px(0.024), h - this.px(0.024), this.px(0.04)); ctx.stroke();

      // cloth (out to the cushion back line)
      const cl = ctx.createRadialGradient(this.sx(0), this.sy(0), this.px(0.2), this.sx(0), this.sy(0), this.px(1.5));
      cl.addColorStop(0, '#1a7a4c'); cl.addColorStop(1, '#105a37');
      ctx.fillStyle = cl;
      ctx.fillRect(this.sx(-T.L2 - c), this.sy(T.W2 + c), this.px(C.TABLE_L + 2 * c), this.px(C.TABLE_W + 2 * c));

      // pockets (drop holes)
      for (const p of T.pockets) {
        const g = ctx.createRadialGradient(this.sx(p.x), this.sy(p.y), 0, this.sx(p.x), this.sy(p.y), this.px(p.r));
        g.addColorStop(0, '#000'); g.addColorStop(0.8, '#0b0b0b'); g.addColorStop(1, '#222');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(this.sx(p.x), this.sy(p.y), this.px(p.r), 0, Math.PI * 2); ctx.fill();
      }

      // cushions
      for (const cu of T.cushions) {
        ctx.beginPath();
        cu.pts.forEach((pt, i) => i ? ctx.lineTo(this.sx(pt.x), this.sy(pt.y)) : ctx.moveTo(this.sx(pt.x), this.sy(pt.y)));
        ctx.closePath();
        ctx.fillStyle = '#0d5131'; ctx.fill();
        // nose highlight
        ctx.beginPath();
        ctx.moveTo(this.sx(cu.pts[1].x), this.sy(cu.pts[1].y)); ctx.lineTo(this.sx(cu.pts[2].x), this.sy(cu.pts[2].y));
        ctx.strokeStyle = 'rgba(120,220,160,0.35)'; ctx.lineWidth = Math.max(1, this.px(0.003)); ctx.stroke();
      }

      // head string, spots
      ctx.setLineDash([this.px(0.01), this.px(0.012)]);
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = Math.max(1, this.px(0.002));
      ctx.beginPath(); ctx.moveTo(this.sx(T.headString), this.sy(T.W2)); ctx.lineTo(this.sx(T.headString), this.sy(-T.W2)); ctx.stroke();
      // kitchen: two box lines from the head string to the head rail at the 1st diamonds (break box) + half circle
      for (const y of QB.markings(T).boxY) {
        ctx.beginPath(); ctx.moveTo(this.sx(T.headString), this.sy(y)); ctx.lineTo(this.sx(-T.L2), this.sy(y)); ctx.stroke();
      }
      const dR = QB.markings(T).dRadius;
      ctx.beginPath(); ctx.arc(this.sx(T.headString), this.sy(0), this.px(dR), Math.PI / 2, Math.PI * 1.5); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      for (const s of [T.headSpot, T.footSpot, { x: 0, y: 0 }]) {
        ctx.beginPath(); ctx.arc(this.sx(s.x), this.sy(s.y), this.px(0.005), 0, Math.PI * 2); ctx.fill();
      }
      // optional practice grid: dots where the lines between opposite diamonds cross
      if (this.practiceGrid) {
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        for (const q of QB.markings(T).grid) { ctx.beginPath(); ctx.arc(this.sx(q.x), this.sy(q.y), this.px(0.0045), 0, Math.PI * 2); ctx.fill(); }
      }

      // diamonds (sights) on the rail center line
      const dOff = c + rw / 2;
      ctx.fillStyle = '#e9dcc0';
      const diamond = (x, y) => {
        const r = this.px(0.009);
        ctx.beginPath(); ctx.moveTo(this.sx(x), this.sy(y) - r); ctx.lineTo(this.sx(x) + r * 0.7, this.sy(y));
        ctx.lineTo(this.sx(x), this.sy(y) + r); ctx.lineTo(this.sx(x) - r * 0.7, this.sy(y)); ctx.closePath(); ctx.fill();
      };
      for (let k = -3; k <= 3; k++) if (k) { diamond(k * C.TABLE_L / 8, T.W2 + dOff); diamond(k * C.TABLE_L / 8, -T.W2 - dOff); }
      for (let k = -1; k <= 1; k++) { diamond(-T.L2 - dOff, k * C.TABLE_W / 4); diamond(T.L2 + dOff, k * C.TABLE_W / 4); }
    }

    // ---------------- Frame ----------------
    clear() {
      const ctx = this.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.drawImage(this.tableLayer, 0, 0);
    }

    drawTrails(balls, opts = {}) {
      const ctx = this.ctx;
      ctx.save();
      ctx.lineWidth = Math.max(1, this.px(opts.width || 0.003));
      if (opts.dash) ctx.setLineDash(opts.dash.map(d => this.px(d)));
      for (const b of balls) {
        const tr = b.trail; if (!tr || tr.length < 4) continue;
        ctx.strokeStyle = opts.color || (b.num === 0 ? 'rgba(255,255,255,0.55)' : hexA(QB.BALL_COLORS[b.num], 0.75));
        if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
        ctx.beginPath();
        ctx.moveTo(this.sx(tr[0]), this.sy(tr[1]));
        for (let i = 2; i < tr.length; i += 2) ctx.lineTo(this.sx(tr[i]), this.sy(tr[i + 1]));
        ctx.lineTo(this.sx(b.x), this.sy(b.y));
        ctx.stroke();
      }
      ctx.restore();
    }

    drawContactMarks(marks) {
      const ctx = this.ctx;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.setLineDash([this.px(0.004), this.px(0.004)]);
      ctx.lineWidth = Math.max(1, this.px(0.0015));
      for (const m of marks) { ctx.beginPath(); ctx.arc(this.sx(m.x), this.sy(m.y), this.px(R), 0, Math.PI * 2); ctx.stroke(); }
      ctx.restore();
    }

    drawBall(b, highlight) {
      if (!b.onTable) return;
      const ctx = this.ctx, x = this.sx(b.x), y = this.sy(b.y), r = this.px(R);
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(x + r * 0.18, y + r * 0.22, r * 1.02, r * 0.95, 0, 0, Math.PI * 2); ctx.fill();

      ctx.save();
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
      const col = QB.BALL_COLORS[b.num] || '#888';
      const stripe = b.num >= 9;
      ctx.fillStyle = (b.num === 0) ? col : col;
      ctx.fillRect(x - r, y - r, 2 * r, 2 * r);

      // surface features rotate with the ball (body axes)
      const cap = (v, ang, fill) => { // disc of angular radius `ang` centered on body direction v
        const vz = v[2]; if (vz < -Math.sin(ang)) return;
        const k = r * Math.cos(ang);
        const cx = x + v[0] * k, cy = y - v[1] * k;
        const a = r * Math.sin(ang), bb = r * Math.sin(ang) * Math.max(Math.abs(vz), 0.05);
        const rot = Math.atan2(-v[1], v[0]);
        ctx.fillStyle = fill;
        ctx.beginPath(); ctx.ellipse(cx, cy, bb, a, rot, 0, Math.PI * 2); ctx.fill();
      };
      if (b.num === 0) {
        for (const ax of [b.ax, b.ay, b.az]) {
          cap(ax, 0.16, '#c8102e'); cap([-ax[0], -ax[1], -ax[2]], 0.16, '#c8102e');
        }
      } else {
        if (stripe) { cap(b.az, 0.85, '#f8f6ee'); cap([-b.az[0], -b.az[1], -b.az[2]], 0.85, '#f8f6ee'); }
        const nd = stripe ? b.ax : b.az;
        for (const s of [1, -1]) {
          const v = [nd[0] * s, nd[1] * s, nd[2] * s];
          cap(v, 0.5, '#f8f6ee');
          if (v[2] > 0.45) {
            ctx.fillStyle = '#111'; ctx.font = `bold ${Math.round(r * 0.8 * v[2])}px system-ui, sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(String(b.num), x + v[0] * r * 0.85, y - v[1] * r * 0.85 + r * 0.04);
          }
        }
      }
      // shading
      const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r * 1.05);
      g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(0.25, 'rgba(255,255,255,0.08)');
      g.addColorStop(0.7, 'rgba(0,0,0,0.0)'); g.addColorStop(1, 'rgba(0,0,0,0.45)');
      ctx.fillStyle = g; ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
      ctx.restore();
      if (highlight) {
        ctx.strokeStyle = highlight; ctx.lineWidth = Math.max(1.5, this.px(0.003));
        ctx.beginPath(); ctx.arc(x, y, r + this.px(0.004), 0, Math.PI * 2); ctx.stroke();
      }
    }

    // Aiming aids. `aim` = result of QB.computeAim()
    drawAim(aim, opts = {}) {
      if (!aim) return;
      const ctx = this.ctx, lw = Math.max(1, this.px(0.0022));
      ctx.save();
      ctx.lineCap = 'round';
      // ghost ball only (lines turned off)
      if (opts.lines === false) {
        if (opts.ghost !== false) {
          ctx.setLineDash([this.px(0.006), this.px(0.005)]); ctx.lineWidth = lw; ctx.strokeStyle = 'rgba(255,255,255,0.8)';
          ctx.beginPath(); ctx.arc(this.sx(aim.gx), this.sy(aim.gy), this.px(R), 0, Math.PI * 2); ctx.stroke();
        }
        ctx.restore(); return;
      }
      // cue ball -> ghost ball / contact
      ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(this.sx(aim.cb.x), this.sy(aim.cb.y)); ctx.lineTo(this.sx(aim.gx), this.sy(aim.gy)); ctx.stroke();
      // ghost ball
      if (opts.ghost !== false) {
        ctx.setLineDash([this.px(0.006), this.px(0.005)]);
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.beginPath(); ctx.arc(this.sx(aim.gx), this.sy(aim.gy), this.px(R), 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }

      if (aim.hit && aim.hit.type === 'ball') {
        // object-ball path (line of centers)
        ctx.strokeStyle = 'rgba(255,214,64,0.95)'; ctx.lineWidth = lw * 1.2;
        ctx.beginPath(); ctx.moveTo(this.sx(aim.ob.x), this.sy(aim.ob.y)); ctx.lineTo(this.sx(aim.obEnd.x), this.sy(aim.obEnd.y)); ctx.stroke();
        if (aim.obHit && aim.obHit.type === 'pocket') {
          ctx.fillStyle = 'rgba(255,214,64,0.9)';
          ctx.beginPath(); ctx.arc(this.sx(aim.obEnd.x), this.sy(aim.obEnd.y), this.px(0.008), 0, Math.PI * 2); ctx.fill();
        }
        // contact point marker on object ball
        ctx.fillStyle = '#ff4d4d';
        ctx.beginPath(); ctx.arc(this.sx(aim.contact.x), this.sy(aim.contact.y), Math.max(2, this.px(0.0035)), 0, Math.PI * 2); ctx.fill();
        // cue-ball tangent line (stun / 90° rule)
        if (opts.tangent !== false && aim.tangent) {
          ctx.setLineDash([this.px(0.008), this.px(0.008)]);
          ctx.strokeStyle = 'rgba(160,220,255,0.6)'; ctx.lineWidth = lw;
          ctx.beginPath(); ctx.moveTo(this.sx(aim.gx), this.sy(aim.gy));
          ctx.lineTo(this.sx(aim.gx + aim.tangent.x * 0.3), this.sy(aim.gy + aim.tangent.y * 0.3)); ctx.stroke();
          ctx.setLineDash([]);
        }
        // cut angle label (test mode only)
        // place label beside the ghost ball, on the cue-ball (tangent) side, away from the OB path
        if (opts.cutLabel !== false) {
        const side = aim.tangent || { x: -aim.n.y, y: aim.n.x };
        const lwx = aim.gx + side.x * 0.055 - aim.n.x * 0.03, lwy = aim.gy + side.y * 0.055 - aim.n.y * 0.03;
        ctx.font = `600 ${Math.max(11, Math.round(this.px(0.022)))}px system-ui, sans-serif`;
        const lx = this.sx(lwx) - ctx.measureText('00.0°').width / 2, ly = this.sy(lwy);
        const txt = `${Math.abs(aim.cutDeg).toFixed(1)}°`;
        ctx.font = `600 ${Math.max(11, Math.round(this.px(0.022)))}px system-ui, sans-serif`;
        const tw = ctx.measureText(txt).width;
        ctx.fillStyle = 'rgba(0,0,0,0.55)'; roundRect(ctx, lx - 4, ly - this.px(0.016), tw + 8, this.px(0.026), 4); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(txt, lx, ly - this.px(0.003));
        }
      } else if (aim.hit && aim.hit.type === 'cushion' && aim.bounce) {
        ctx.setLineDash([this.px(0.008), this.px(0.008)]);
        ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = lw;
        ctx.beginPath(); ctx.moveTo(this.sx(aim.gx), this.sy(aim.gy));
        ctx.lineTo(this.sx(aim.bounce.x), this.sy(aim.bounce.y)); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    // tipX: side offset of the cue tip in units of R (+ = right of the cue ball as seen by the shooter)
    // elev: cue elevation (rad) -> the stick is foreshortened in top view
    drawCue(cb, angle, pullBack, alpha = 1, tipX = 0, elev = 0) {
      const ctx = this.ctx;
      const dx = Math.cos(angle), dy = Math.sin(angle);
      const nx = -dy, ny = dx;   // left-pointing normal
      const off = -tipX * R;     // shift along the left normal
      const tipD = R * Math.sqrt(Math.max(0, 1 - tipX * tipX)) + 0.008 + pullBack, len = C.CUE_LEN;
      const tip = { x: cb.x - dx * tipD + nx * off, y: cb.y - dy * tipD + ny * off };
      const fs = Math.cos(elev);
      const P = (d, half) => [this.sx(tip.x - dx * d * fs + nx * half), this.sy(tip.y - dy * d * fs + ny * half)];
      const poly = (d0, d1, h0, h1, fill) => {
        ctx.beginPath();
        let p = P(d0, h0); ctx.moveTo(p[0], p[1]); p = P(d1, h1); ctx.lineTo(p[0], p[1]);
        p = P(d1, -h1); ctx.lineTo(p[0], p[1]); p = P(d0, -h0); ctx.lineTo(p[0], p[1]);
        ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
      };
      const hw = (d) => 0.0065 + (0.0145 - 0.0065) * (d / len);
      ctx.save(); ctx.globalAlpha = alpha;
      // shadow
      const sh = 1 + 4 * Math.sin(elev); // raised cue -> shadow further away
      ctx.save(); ctx.translate(this.px(0.012 * sh), this.px(0.018 * sh)); poly(0, len, hw(0), hw(len), 'rgba(0,0,0,0.3)'); ctx.restore();
      poly(0, 0.006, hw(0), hw(0.006), '#3b6fd8');                 // chalked tip
      poly(0.006, 0.03, hw(0.006), hw(0.03), '#f2efe6');           // ferrule
      poly(0.03, 0.80, hw(0.03), hw(0.80), '#e3c48f');             // maple shaft
      poly(0.80, 1.02, hw(0.80), hw(1.02), '#2a1408');             // forearm
      poly(1.02, 1.30, hw(1.02), hw(1.30), '#1a1a1a');             // wrap
      poly(1.30, len, hw(1.30), hw(len), '#2a1408');               // butt
      ctx.restore();
    }

    // Short preview of the cue ball's path after first contact (flat array x0,y0,x1,y1,...)
    drawCBPath(pts, opts = {}) {
      const ctx = this.ctx;
      ctx.save();
      ctx.strokeStyle = 'rgba(120,230,255,0.9)'; ctx.lineWidth = Math.max(1.2, this.px(0.0025)); ctx.lineCap = 'round';
      if (opts.dash) ctx.setLineDash([this.px(0.008), this.px(0.007)]);
      ctx.beginPath(); ctx.moveTo(this.sx(pts[0]), this.sy(pts[1]));
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(this.sx(pts[i]), this.sy(pts[i + 1]));
      ctx.stroke();
      const n = pts.length;
      if (n >= 6 && opts.arrow !== false) { // arrow head
        const x1 = pts[n - 2], y1 = pts[n - 1], x0 = pts[n - 6], y0 = pts[n - 5];
        const a = Math.atan2(-(y1 - y0), x1 - x0), L = this.px(0.012);
        const X = this.sx(x1), Y = this.sy(y1);
        ctx.fillStyle = 'rgba(120,230,255,0.9)';
        ctx.beginPath(); ctx.moveTo(X, Y);
        ctx.lineTo(X - L * Math.cos(a - 0.45), Y - L * Math.sin(a - 0.45));
        ctx.lineTo(X - L * Math.cos(a + 0.45), Y - L * Math.sin(a + 0.45)); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }

    // blue chalk smudges on the cloth
    drawChalk(marks) {
      const ctx = this.ctx;
      ctx.save();
      for (const m of marks) {
        const x = this.sx(m.x), y = this.sy(m.y), L = this.px(m.len), W = this.px(0.0065);
        const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(L, 1));
        g.addColorStop(0, `rgba(70,120,215,${m.a})`); g.addColorStop(1, 'rgba(70,120,215,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(x, y, Math.max(L, 1.5), Math.max(W, 1), -m.ang, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    // drill target: a cue-ball zone and the target pocket
    drawZone(z) {
      const ctx = this.ctx;
      ctx.save();
      ctx.fillStyle = 'rgba(120,230,255,0.16)'; ctx.strokeStyle = 'rgba(120,230,255,0.85)';
      ctx.lineWidth = Math.max(1.5, this.px(0.003)); ctx.setLineDash([this.px(0.01), this.px(0.006)]);
      ctx.beginPath(); ctx.arc(this.sx(z.x), this.sy(z.y), this.px(z.r), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    drawPocketMark(name) {
      const p = this.table.pockets.find(q => q.name === name); if (!p) return;
      const ctx = this.ctx, t = (performance.now() % 1600) / 1600;
      ctx.save();
      ctx.strokeStyle = `rgba(242,194,0,${0.55 + 0.35 * Math.sin(t * Math.PI * 2)})`; ctx.lineWidth = Math.max(2, this.px(0.005));
      ctx.beginPath(); ctx.arc(this.sx(p.x), this.sy(p.y), this.px(p.r + 0.012), 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    // the walking player on the map: a dot with a view cone
    drawWalker(w) {
      if (!w) return;
      // big dot + a view cone as wide as the 3D camera's horizontal field of view
      const ctx = this.ctx, x = this.sx(w.x), y = this.sy(w.y), r = Math.max(10, this.px(0.085)), a = -w.yaw;
      const half = (w.hfov || 1.0) / 2, reach = Math.max(r * 7, this.px(1.3));
      ctx.save();
      if (w.area) {                 // the floor you can walk on
        ctx.strokeStyle = 'rgba(79,179,255,0.35)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
        ctx.strokeRect(this.sx(-w.area.X), this.sy(w.area.Y), this.px(2 * w.area.X), this.px(2 * w.area.Y));
        ctx.setLineDash([]);
      }
      const g = ctx.createRadialGradient(x, y, r, x, y, reach);
      g.addColorStop(0, 'rgba(79,179,255,0.55)'); g.addColorStop(1, 'rgba(79,179,255,0.08)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, reach, a - half, a + half); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(140,205,255,0.9)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x + Math.cos(a - half) * reach, y + Math.sin(a - half) * reach); ctx.lineTo(x, y);
      ctx.lineTo(x + Math.cos(a + half) * reach, y + Math.sin(a + half) * reach); ctx.stroke();
      ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 6;
      ctx.fillStyle = '#4fb3ff'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      // nose: which way you face
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r * 1.0, y + Math.sin(a) * r * 1.0);
      ctx.lineTo(x + Math.cos(a + 2.4) * r * 0.45, y + Math.sin(a + 2.4) * r * 0.45);
      ctx.lineTo(x + Math.cos(a - 2.4) * r * 0.45, y + Math.sin(a - 2.4) * r * 0.45); ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    drawLabel(cb, text) {
      const ctx = this.ctx;
      ctx.save();
      ctx.font = `600 ${Math.max(10, Math.round(this.px(0.018)))}px system-ui, sans-serif`;
      const x = this.sx(cb.x) - ctx.measureText(text).width / 2, y = this.sy(cb.y) - this.px(0.06);
      const tw = ctx.measureText(text).width;
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; roundRect(ctx, x - 5, y - this.px(0.014), tw + 10, this.px(0.024), 4); ctx.fill();
      ctx.fillStyle = '#f2c200'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y - this.px(0.002));
      ctx.restore();
    }

    drawPowerGauge(cb, angle, frac) {
      if (frac <= 0) return;
      const ctx = this.ctx;
      const x = this.sx(cb.x) + this.px(0.05), y = this.sy(cb.y) - this.px(0.07);
      const w = this.px(0.12), h = this.px(0.012);
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; roundRect(ctx, x, y, w, h, h / 2); ctx.fill();
      const g = ctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, '#5fd35f'); g.addColorStop(0.6, '#f2c200'); g.addColorStop(1, '#e53935');
      ctx.fillStyle = g; roundRect(ctx, x, y, Math.max(h, w * frac), h, h / 2); ctx.fill();
    }
  }
  QB.Renderer = Renderer;

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // ---------------- Table markings (shared by the 2D and 3D views) ----------------
  QB.markings = function (T) {
    const dx = C.TABLE_L / 8, dy = C.TABLE_W / 4, grid = [];
    for (let k = -3; k <= 3; k++) for (let j = -1; j <= 1; j++) grid.push({ x: k * dx, y: j * dy });
    return { boxY: [dy, -dy], dRadius: dy, grid };
  };

  // ---------------- Aim geometry ----------------
  // Ghost-ball prediction (no throw, no squirt): object ball leaves along the line of centers.
  QB.computeAim = function (world, cb, angle) {
    if (!cb || !cb.onTable) return null;
    const T = world.table, dx = Math.cos(angle), dy = Math.sin(angle);
    const hit = QB.castCircle(T, world.balls, cb.x, cb.y, dx, dy, R, cb.id);
    if (!hit) return null;
    const res = { cb, hit, gx: hit.cx, gy: hit.cy, angle };
    if (hit.type === 'ball') {
      const ob = hit.ball;
      let nx = ob.x - hit.cx, ny = ob.y - hit.cy; const l = Math.hypot(nx, ny); nx /= l; ny /= l;
      res.ob = ob; res.n = { x: nx, y: ny };
      res.contact = { x: hit.cx + nx * R, y: hit.cy + ny * R };
      // signed cut angle between aim direction and line of centers
      res.cutDeg = Math.atan2(dx * ny - dy * nx, dx * nx + dy * ny) * 180 / Math.PI;
      // cue-ball tangent direction (component of aim perpendicular to n)
      const dn = dx * nx + dy * ny; let tx = dx - dn * nx, ty = dy - dn * ny; const tl = Math.hypot(tx, ty);
      res.tangent = tl > 1e-6 ? { x: tx / tl, y: ty / tl } : null;
      const oh = QB.castCircle(T, world.balls, ob.x, ob.y, nx, ny, R, ob.id);
      res.obHit = oh;
      res.obEnd = oh ? { x: oh.cx, y: oh.cy } : { x: ob.x + nx * 3, y: ob.y + ny * 3 };
    } else if (hit.type === 'cushion') {
      const P = world.params, vn = dx * hit.nx + dy * hit.ny;
      let rx = dx - vn * hit.nx - P.eCushion * vn * hit.nx, ry = dy - vn * hit.ny - P.eCushion * vn * hit.ny;
      const rl = Math.hypot(rx, ry) || 1; rx /= rl; ry /= rl;
      const nh = QB.castCircle(T, world.balls, hit.cx + rx * 1e-4, hit.cy + ry * 1e-4, rx, ry, R, cb.id);
      const L = nh ? Math.min(nh.t, 0.5) : 0.5;
      res.bounce = { x: hit.cx + rx * L, y: hit.cy + ry * L };
    }
    return res;
  };
})();
