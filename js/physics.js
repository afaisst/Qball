// Qball — physics engine.
//
// Ball state: position (x,y), linear velocity (vx,vy), angular velocity (wx,wy,wz).
// Contact-point slip with the cloth:  u = v + w x (-R z)  =  (vx - R*wy, vy + R*wx).
//
// Motion phases (classic Leckie-Greenspan / Han model):
//   sliding  (|u| > 0): kinetic friction  F = -muSlide*m*g * u_hat
//                       dv/dt = -muSlide*g*u_hat,  dw/dt = (R z x F)... => slip decays as 7/2*muSlide*g
//   rolling  (|u| = 0): rolling resistance dv/dt = -muRoll*g*v_hat, w locked to v
//   side spin wz decays at a constant rate (spinDecel) independent of the above.
// Each phase has constant acceleration, so motion is integrated analytically within a
// substep and phase changes are hit exactly. Collisions are found per substep and the
// colliding balls are rewound to the exact moment of contact before applying impulses.
window.QB = window.QB || {};

(function () {
  const C = QB.C;
  const R = C.BALL_R;

  // ---------------- Ball ----------------
  class Ball {
    constructor(id, num, x, y) {
      this.id = id; this.num = num;
      this.x = x; this.y = y;
      this.vx = 0; this.vy = 0;
      this.wx = 0; this.wy = 0; this.wz = 0;
      this.onTable = true;
      this.pocketedIn = null;
      // body-fixed axes expressed in world frame (for rendering rotation)
      this.ax = [1, 0, 0]; this.ay = [0, 1, 0]; this.az = [0, 0, 1];
      randomizeOrientation(this);
      this.trail = [];
    }
    get speed() { return Math.hypot(this.vx, this.vy); }
    slip() { return Math.hypot(this.vx - R * this.wy, this.vy + R * this.wx); }
    motion() {
      if (!this.onTable) return 'off';
      if (this.slip() > C.U_EPS) return 'sliding';
      if (this.speed > C.V_EPS) return 'rolling';
      if (Math.abs(this.wz) > 1e-3) return 'spinning';
      return 'stopped';
    }
    stop() { this.vx = this.vy = this.wx = this.wy = this.wz = 0; }
    snapshot() { return { id: this.id, num: this.num, x: this.x, y: this.y, onTable: this.onTable }; }
  }
  QB.Ball = Ball;

  function randomizeOrientation(b) {
    // random rotation so number discs don't all face up identically
    const ang = Math.random() * Math.PI * 2, axis = norm3([Math.random() - .5, Math.random() - .5, Math.random() - .5]);
    rotateBody(b, axis[0] * ang, axis[1] * ang, axis[2] * ang);
  }

  function norm3(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }

  // Rotate body axes by rotation vector (rx,ry,rz) (axis * angle), Rodrigues formula.
  function rotateBody(b, rx, ry, rz) {
    const th = Math.hypot(rx, ry, rz);
    if (th < 1e-12) return;
    const kx = rx / th, ky = ry / th, kz = rz / th, c = Math.cos(th), s = Math.sin(th);
    const rot = (v) => {
      const dot = kx * v[0] + ky * v[1] + kz * v[2];
      const cx = ky * v[2] - kz * v[1], cy = kz * v[0] - kx * v[2], cz = kx * v[1] - ky * v[0];
      v[0] = v[0] * c + cx * s + kx * dot * (1 - c);
      v[1] = v[1] * c + cy * s + ky * dot * (1 - c);
      v[2] = v[2] * c + cz * s + kz * dot * (1 - c);
    };
    rot(b.ax); rot(b.ay); rot(b.az);
  }

  function orthonormalize(b) {
    const a = norm3(b.ax);
    let y = b.ay; const d = a[0] * y[0] + a[1] * y[1] + a[2] * y[2];
    y = norm3([y[0] - d * a[0], y[1] - d * a[1], y[2] - d * a[2]]);
    b.ax = a; b.ay = y;
    b.az = [a[1] * y[2] - a[2] * y[1], a[2] * y[0] - a[0] * y[2], a[0] * y[1] - a[1] * y[0]];
  }

  // Cue-tip impact, after Alciatore "Pool physics" TP A.30/A.31 and Leckie & Greenspan, generalised to
  // an elevated cue and tip slip (miscue).
  //   aim: horizontal direction of the cue, elev: cue elevation (rad, butt raised, tip pointing down)
  //   tipX/tipY: contact offset in units of R, as seen looking down the cue (right / up in the cue frame)
  // Cue axis e = (cos(elev) d, -sin(elev)); contact point P = O + a r + b u - c e (a=tipX R, b=tipY R, c=sqrt(R^2-a^2-b^2)).
  // Impulse direction k:  k = e while the tip can hold (tan of the angle between e and the contact
  // normal <= tip friction), otherwise the tip slides (MISCUE) and k = normal + mu_kinetic * tangent.
  // Magnitude (restitution e_tip along k, cue constrained to move along its axis):
  //   F = (1+e_tip) V (e.k) / ( (e.k)^2/M + 1/m + |OP x k|^2 / I )
  // Ball: dv = F k / m (vertical part absorbed by the slate, no jumping yet), dw = OP x F k / I.
  // Squirt (shaft end mass m_e) rotates the launch direction away from the english side:
  //   tan(s) = 5/2 (a/R) sqrt(1-(a/R)^2) / (1 + m/m_e + 5/2 (1-(a/R)^2))
  QB.cueImpact = function (P, cueSpeed, aim, tipX = 0, tipY = 0, elev = 0) {
    const m = C.BALL_M, M = C.CUE_MASS, eT = C.TIP_E, I = 0.4 * m * R * R;
    const dx = Math.cos(aim), dy = Math.sin(aim), ce = Math.cos(elev), se = Math.sin(elev);
    let rho2 = tipX * tipX + tipY * tipY;
    if (rho2 > C.TIP_MAX * C.TIP_MAX) { const f = C.TIP_MAX / Math.sqrt(rho2); tipX *= f; tipY *= f; rho2 = C.TIP_MAX * C.TIP_MAX; }
    const a = tipX * R, b = tipY * R, c = R * Math.sqrt(1 - rho2);
    const e = [ce * dx, ce * dy, -se];        // cue axis
    const r = [dy, -dx, 0];                    // cue-frame right
    const u = [se * dx, se * dy, ce];          // cue-frame up
    const OP = [a * r[0] + b * u[0] - c * e[0], a * r[1] + b * u[1] - c * e[1], a * r[2] + b * u[2] - c * e[2]];
    const n = [-OP[0] / R, -OP[1] / R, -OP[2] / R]; // contact normal, into the ball
    const mu = P.tipFriction;
    const tanA = Math.sqrt(rho2) / Math.sqrt(1 - rho2);
    const miscue = tanA > mu + 1e-9;
    let k = e;
    if (miscue) {
      const en = e[0] * n[0] + e[1] * n[1] + e[2] * n[2];
      let t = [e[0] - en * n[0], e[1] - en * n[1], e[2] - en * n[2]];
      const tl = Math.hypot(t[0], t[1], t[2]) || 1; t = t.map(v => v / tl);
      // once the chalk lets go the tip slides with a much lower kinetic friction -> weak, spinless, off-line hit
      const muk = C.TIP_MU_KINETIC;
      k = [n[0] + muk * t[0], n[1] + muk * t[1], n[2] + muk * t[2]];
      const kl = Math.hypot(k[0], k[1], k[2]); k = k.map(v => v / kl);
    }
    const ek = e[0] * k[0] + e[1] * k[1] + e[2] * k[2];
    const L = cross(OP, k), L2 = L[0] * L[0] + L[1] * L[1] + L[2] * L[2];
    const F = Math.max(0, (1 + eT) * cueSpeed * ek / (ek * ek / M + 1 / m + L2 / I));
    // a miscue is a glancing, truncated contact: the tip skids off, so only part of the stroke is transferred
    const Fm = miscue ? F * C.MISCUE_TRANSFER : F;
    let vx = Fm * k[0] / m, vy = Fm * k[1] / m;
    const w = [Fm * L[0] / I, Fm * L[1] / I, Fm * L[2] / I];
    let squirt = 0;
    const me = P.cueEndMass || 0;
    if (!miscue && me > 0 && tipX !== 0) {
      const aa = Math.max(-0.99, Math.min(0.99, tipX));
      squirt = Math.atan(2.5 * aa * Math.sqrt(1 - aa * aa) / (1 + m / me + 2.5 * (1 - aa * aa)));
      const cs = Math.cos(squirt), sn = Math.sin(squirt);
      [vx, vy] = [vx * cs - vy * sn, vx * sn + vy * cs];
    }
    const speed = Math.hypot(vx, vy);
    return { speed, vx, vy, w, squirt, miscue, angle: speed > 1e-9 ? Math.atan2(vy, vx) : aim, vz: Fm * k[2] / m, tanA, mu };
  };
  // Largest tip offset at which the tip can still hold (miscue limit), in units of R.
  QB.miscueLimit = function (P) { const mu = P.tipFriction; return mu / Math.sqrt(1 + mu * mu); };
  function cross(p, q) { return [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]]; }

  // Ball-ball friction coefficient vs. contact slip speed (Alciatore TP A.14 fit to measurements).
  function ballFriction(P, slip) { return (P.ballFriction || 0) * (0.00995 + 0.108 * Math.exp(-1.088 * slip)); }

  // Realistic cushion impulse (after Han 2005 / Mathavan 2010, single-impulse form).
  // The cushion nose touches the ball at height h = CUSHION_H_FRAC*2R above the slate, i.e. at
  // angle theta above the ball's equator. The contact impulse = normal part (restitution e,
  // directed through the ball center, partly downward into the slate) + Coulomb friction (muCushion)
  // opposing the slip of the contact point. Friction at the cushion contact is what converts a rolling
  // ball's topspin on a rail hit, so a rolling ball comes off the rail skidding and loses speed.
  // (nx,ny) = unit normal pointing from the cushion into the table.
  // contact angle above the equator for a cushion nose at height h = frac * 2R
  function cushionAngle(P) {
    const frac = P.cushionHeight || QB.C.CUSHION_H_FRAC;
    const st = Math.max(0, Math.min(0.95, frac * 2 - 1));
    return [st, Math.sqrt(1 - st * st)];
  }
  // speed-dependent cushion restitution: e(v) = e0 - k * v_normal (clamped)
  function cushionE(P, vn) { return Math.max(0.2, Math.min(1, P.eCushion - (P.eCushionSlope || 0) * vn)); }

  function cushionImpulse(b, nx, ny, P) {
    const [SIN_T, COS_T] = cushionAngle(P);
    // local frame: X into the cushion, Y along the rail (Z up, right-handed)
    const Xx = -nx, Xy = -ny, Yx = -Xy, Yy = Xx;
    const vX = b.vx * Xx + b.vy * Xy, vY = b.vx * Yx + b.vy * Yy;
    const wX = b.wx * Xx + b.wy * Xy, wY = b.wx * Yx + b.wy * Yy, wZ = b.wz;
    const c = vX * COS_T;                    // approach speed along the contact normal
    if (c <= 0) return;
    const m = 1;                             // impulses per unit mass
    const Pn = (1 + cushionE(P, vX)) * m * c;
    // slip of the contact point along t1 = (-sin, 0, cos) and t2 = Y
    const s1 = -vX * SIN_T - R * wY;
    const s2 = vY + R * wZ * COS_T - R * wX * SIN_T;
    const sl = Math.hypot(s1, s2);
    let P1 = 0, P2 = 0;
    if (sl > 1e-12) {
      const stick = sl * 2 * m / 7;          // impulse that would stop the slip (effective mass 2m/7)
      const fr = Math.min(stick, (P.muCushion || 0) * Pn);
      P1 = -fr * s1 / sl; P2 = -fr * s2 / sl;
    }
    // total impulse in local frame
    const PX = -Pn * COS_T - P1 * SIN_T, PY = P2, PZ = -Pn * SIN_T + P1 * COS_T;
    const vX2 = vX + PX / m, vY2 = vY + PY / m;   // PZ absorbed by the slate (no jumping)
    const k = 5 / (2 * m * R);                    // R / I
    const wX2 = wX - k * PY * SIN_T;
    const wY2 = wY + k * (PX * SIN_T - PZ * COS_T);
    const wZ2 = wZ + k * PY * COS_T;
    b.vx = vX2 * Xx + vY2 * Yx; b.vy = vX2 * Xy + vY2 * Yy;
    b.wx = wX2 * Xx + wY2 * Yx; b.wy = wX2 * Xy + wY2 * Yy; b.wz = wZ2;
  }

  // Cushion impact after Mathavan, Jackson & Parkin (2010), "A theoretical analysis of billiard ball
  // dynamics under cushion impacts", Proc. IMechE C 224. The impact is integrated in small steps of the
  // normal impulse P at the cushion contact I (at angle theta above the equator), with
  //   - Coulomb friction at the cushion contact (muCushion) along the slip at I,
  //   - the slate reaction at the table contact C: the cushion force pushes the ball down, so the slate
  //     pushes back (dP_C = dP (sin theta + mu_w * u1 cos theta)) and cloth friction (muSlide) acts at C,
  //   - compression until the normal approach speed at I is zero, then restitution until the work done
  //     equals e^2 x compression work (energetic coefficient of restitution).
  // Spin and speed are coupled at both contacts, so english, follow/draw and slide all change the rebound.
  function cushionMathavan(b, nx, ny, P) {
    const [st, ct] = cushionAngle(P);
    const Xx = -nx, Xy = -ny, Yx = -Xy, Yy = Xx;   // X into the cushion, Y along the rail, Z up
    let vX = b.vx * Xx + b.vy * Xy, vY = b.vx * Yx + b.vy * Yy;
    let wX = b.wx * Xx + b.wy * Xy, wY = b.wx * Yx + b.wy * Yy, wZ = b.wz;
    const c0 = vX * ct;
    if (c0 <= 0) return;
    const e = cushionE(P, vX), muw = P.muCushion || 0, mus = P.muSlide || 0;
    const kI = 1 / (0.4 * R * R);                   // 1 / (I/m)
    const N = 400, dP = c0 / N;                      // per-unit-mass impulse step
    let Wc = 0, Wr = 0, compress = true, target = 0;
    for (let i = 0; i < 20 * N; i++) {
      // slip at the cushion contact I, components along t1 = (-st, 0, ct) and t2 = Y
      const s1 = -vX * st - R * wY, s2 = vY + R * wZ * ct - R * wX * st;
      const sI = Math.hypot(s1, s2), u1 = sI > 1e-9 ? s1 / sI : 0, u2 = sI > 1e-9 ? s2 / sI : 0;
      // slip at the table contact C = v + w x (0,0,-R)
      const cX = vX - R * wY, cY = vY + R * wX;
      const sC = Math.hypot(cX, cY), e1 = sC > 1e-9 ? cX / sC : 0, e2 = sC > 1e-9 ? cY / sC : 0;
      // impulse increments
      const fI = muw * dP;
      const dPC = Math.max(0, dP * (st + muw * u1 * ct));
      const fC = mus * dPC;
      const FIx = -ct * dP + fI * u1 * st, FIy = -fI * u2, FIz = -st * dP - fI * u1 * ct;
      const FCx = -fC * e1, FCy = -fC * e2;
      // linear (vertical cancels by construction)
      const c = vX * ct;                             // normal approach speed at I before the step
      vX += FIx + FCx; vY += FIy + FCy;
      // angular: r_I x F_I + r_C x F_C
      wX += kI * R * (-st * FIy + FCy);
      wY += kI * R * (st * FIx - ct * FIz - FCx);
      wZ += kI * R * (ct * FIy);
      const c2 = vX * ct;
      const dW = 0.5 * (c + c2) * dP;
      if (compress) {
        Wc += dW;
        if (c2 <= 0) { compress = false; target = e * e * Wc; }
      } else {
        Wr -= dW;
        if (Wr >= target) break;
      }
    }
    b.vx = vX * Xx + vY * Yx; b.vy = vX * Xy + vY * Yy;
    b.wx = wX * Xx + wY * Yx; b.wy = wX * Xy + wY * Yy; b.wz = wZ;
  }
  QB._cushion = { cushionMathavan, cushionImpulse }; // exposed for tests

  // ---------------- World ----------------
  class World {
    constructor(table, params) {
      this.table = table;
      this.params = params || QB.defaultParams();
      this.balls = [];
      this.time = 0;
      this.events = [];
      this.recordTrails = true;
      this.trailEvery = 0.004; // s between trail samples
      this._trailT = 0;
      this._steps = 0;
    }

    addBall(num, x, y) { const b = new Ball(this.balls.length, num, x, y); this.balls.push(b); return b; }
    ball(num) { return this.balls.find(b => b.num === num); }
    isMoving() { return this.balls.some(b => b.onTable && b.motion() !== 'stopped'); }

    // Raw strike: set the cue ball's state directly.
    // speed: cue-ball speed (m/s), angle: travel direction (rad),
    // tipX / tipY: impulse offset from center in units of R (right / up, relative to travel).
    // Impulse J = m v applied at offset d gives w = d x J / I  ->  |w| = 5 v d / (2 R^2):
    //   tipY = +0.4  -> natural roll (topspin),  tipY < 0 -> backspin (draw),
    //   tipX > 0 (right english) -> counter-clockwise spin seen from above (wz > 0).
    strike(ball, speed, angle, tipX = 0, tipY = 0, info) {
      const dx = Math.cos(angle), dy = Math.sin(angle);
      ball.vx = speed * dx; ball.vy = speed * dy;
      const k = 5 * speed / (2 * R); // per unit (offset/R)
      ball.wx = -dy * k * tipY; ball.wy = dx * k * tipY;   // horizontal axis perpendicular to travel
      ball.wz = k * tipX;
      this.events.push(Object.assign({ type: 'strike', t: this.time, ball: ball.id, speed, angle, tipX, tipY }, info || {}));
    }

    // Cue strike: cue (stick) speed V along `aim`, tip offset (tipX, tipY) in R, cue elevation `elev` (rad).
    cueStrike(ball, cueSpeed, aim, tipX = 0, tipY = 0, elev = 0) {
      const imp = QB.cueImpact(this.params, cueSpeed, aim, tipX, tipY, elev);
      ball.vx = imp.vx; ball.vy = imp.vy;
      ball.wx = imp.w[0]; ball.wy = imp.w[1]; ball.wz = imp.w[2];
      this.events.push({ type: 'strike', t: this.time, ball: ball.id, speed: imp.speed, angle: imp.angle,
        tipX, tipY, elev, cueSpeed, aim, squirt: imp.squirt, miscue: imp.miscue });
      return imp;
    }
    // Advance by `dt` seconds of simulated time using fixed substeps.
    step(dt) {
      const h = C.DT;
      let n = Math.max(1, Math.round(dt / h));
      for (let i = 0; i < n; i++) this.substep(h);
    }

    substep(h) {
      const P = this.params;
      let any = false;
      for (const b of this.balls) {
        if (!b.onTable) continue;
        if (b.motion() === 'stopped') continue;
        any = true;
        this.advanceBall(b, h);
      }
      this.time += h;
      if (!any) return false;
      this.resolveCollisions(h);
      this.checkPockets();
      if (++this._steps % 500 === 0) for (const b of this.balls) orthonormalize(b);
      if (this.recordTrails) {
        this._trailT += h;
        if (this._trailT >= this.trailEvery) {
          this._trailT = 0;
          for (const b of this.balls) if (b.onTable && b.speed > C.V_EPS) b.trail.push(b.x, b.y);
        }
      }
      return true;
    }

    // Analytic motion of one ball over time h (no collisions).
    advanceBall(b, h) {
      const P = this.params, g = C.G;
      let guard = 0;
      while (h > 1e-12 && guard++ < 6) {
        const ux = b.vx - R * b.wy, uy = b.vy + R * b.wx;
        const slip = Math.hypot(ux, uy);
        const sp = Math.hypot(b.vx, b.vy);
        let tau;
        if (slip > C.U_EPS) {
          // ---- sliding ----
          const a = P.muSlide * g, uhx = ux / slip, uhy = uy / slip;
          const tS = 2 * slip / (7 * a);
          tau = Math.min(h, tS);
          const ax = -a * uhx, ay = -a * uhy;
          const awx = -5 * a * uhy / (2 * R), awy = 5 * a * uhx / (2 * R);
          b.x += b.vx * tau + 0.5 * ax * tau * tau;
          b.y += b.vy * tau + 0.5 * ay * tau * tau;
          rotateBody(b, (b.wx + 0.5 * awx * tau) * tau, (b.wy + 0.5 * awy * tau) * tau, b.wz * tau);
          b.vx += ax * tau; b.vy += ay * tau;
          b.wx += awx * tau; b.wy += awy * tau;
          if (tau >= tS) {
            // exact transition to rolling
            b.wy = b.vx / R; b.wx = -b.vy / R;
            this.events.push({ type: 'roll', t: this.time, ball: b.id, vx: b.vx, vy: b.vy });
          }
        } else if (sp > C.V_EPS) {
          // ---- rolling ----
          const a = P.muRoll * g, vhx = b.vx / sp, vhy = b.vy / sp;
          const tR = sp / a;
          tau = Math.min(h, tR);
          const d = sp * tau - 0.5 * a * tau * tau, vMid = sp - 0.5 * a * tau;
          b.x += vhx * d; b.y += vhy * d;
          rotateBody(b, -vhy * vMid / R * tau, vhx * vMid / R * tau, b.wz * tau);
          const sNew = tau >= tR ? 0 : sp - a * tau;
          b.vx = vhx * sNew; b.vy = vhy * sNew;
          b.wy = b.vx / R; b.wx = -b.vy / R;
          if (sNew === 0) this.events.push({ type: 'stop', t: this.time, ball: b.id });
        } else {
          // ---- only spinning in place (or stopped) ----
          tau = h;
          b.vx = b.vy = b.wx = b.wy = 0;
          rotateBody(b, 0, 0, b.wz * tau);
        }
        // side-spin decay (independent)
        if (b.wz !== 0) {
          const dw = P.spinDecel * tau;
          b.wz = Math.abs(b.wz) <= dw ? 0 : b.wz - Math.sign(b.wz) * dw;
        }
        h -= tau;
      }
    }

    resolveCollisions(h) {
      const P = this.params, balls = this.balls, segs = this.table.segments;
      const D = 2 * R, D2 = D * D;
      for (let iter = 0; iter < 4; iter++) {
        let hit = false;
        // ---- ball-ball ----
        for (let i = 0; i < balls.length; i++) {
          const a = balls[i]; if (!a.onTable) continue;
          for (let j = i + 1; j < balls.length; j++) {
            const b = balls[j]; if (!b.onTable) continue;
            const px = b.x - a.x, py = b.y - a.y, d2 = px * px + py * py;
            if (d2 >= D2 - 1e-12) continue;
            const wx = b.vx - a.vx, wy = b.vy - a.vy;
            const pw = px * wx + py * wy;
            if (pw >= 0) { // overlapping but separating: just separate
              const d = Math.sqrt(d2) || 1e-9, push = (D - d) / 2 + 1e-9;
              a.x -= px / d * push; a.y -= py / d * push; b.x += px / d * push; b.y += py / d * push;
              continue;
            }
            // rewind to exact contact time (linear motion over the rewind interval)
            const ww = wx * wx + wy * wy;
            let s = ww > 0 ? (pw + Math.sqrt(Math.max(0, pw * pw - ww * (d2 - D2)))) / ww : 0;
            s = Math.min(Math.max(s, 0), h);
            a.x -= a.vx * s; a.y -= a.vy * s; b.x -= b.vx * s; b.y -= b.vy * s;
            let nx = b.x - a.x, ny = b.y - a.y; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
            const vrel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny; // >0 approaching
            const pre = { avx: a.vx, avy: a.vy, bvx: b.vx, bvy: b.vy, aSlip: a.slip(), bSlip: b.slip(), aw: [a.wx, a.wy, a.wz], bw: [b.wx, b.wy, b.wz] };
            let throwJ = 0;
            if (vrel > 0) {
              const J = (1 + P.eBall) / 2 * vrel; // normal impulse per unit mass (equal masses)
              // Contact-point slip (3D) before the impulse: u = (vA + wA x R n) - (vB + wB x (-R n))
              const ux = (a.vx - R * a.wz * ny) - (b.vx + R * b.wz * ny);
              const uy = (a.vy + R * a.wz * nx) - (b.vy - R * b.wz * nx);
              const uz = R * (a.wx * ny - a.wy * nx) + R * (b.wx * ny - b.wy * nx);
              const un = ux * nx + uy * ny;
              const tx = ux - un * nx, ty = uy - un * ny, tz = uz;     // tangential part
              const sl = Math.hypot(tx, ty, tz);
              a.vx -= J * nx; a.vy -= J * ny; b.vx += J * nx; b.vy += J * ny;
              if (sl > 1e-9 && P.ballFriction > 0) {
                // Coulomb friction, capped at the impulse that stops the slip (effective mass m/7)
                const Jt = Math.min(ballFriction(P, sl) * J, sl / 7);
                const hx = tx / sl, hy = ty / sl, hz = tz / sl;
                a.vx -= Jt * hx; a.vy -= Jt * hy; b.vx += Jt * hx; b.vy += Jt * hy; // vertical part -> slate
                // both balls get the same spin change: dw = -(5/2R) Jt (n x h)
                const k5 = 5 / (2 * R) * Jt;
                const cx = ny * hz, cy = -nx * hz, cz = nx * hy - ny * hx;
                a.wx -= k5 * cx; a.wy -= k5 * cy; a.wz -= k5 * cz;
                b.wx -= k5 * cx; b.wy -= k5 * cy; b.wz -= k5 * cz;
                throwJ = Jt;
              }
            }
            a.x += a.vx * s; a.y += a.vy * s; b.x += b.vx * s; b.y += b.vy * s;
            this.events.push({
              type: 'ball', t: this.time - s, a: a.id, b: b.id, speed: vrel, nx, ny,
              ax: a.x - a.vx * s, ay: a.y - a.vy * s, bx: b.x - b.vx * s, by: b.y - b.vy * s,
              pre, post: { avx: a.vx, avy: a.vy, bvx: b.vx, bvy: b.vy }, throwJ,
            });
            hit = true;
          }
        }
        // ---- ball-cushion ----
        for (const b of balls) {
          if (!b.onTable) continue;
          for (const sg of segs) {
            const q = QB.closestOnSeg(sg, b.x, b.y);
            let nx = b.x - q.x, ny = b.y - q.y; const d = Math.hypot(nx, ny);
            if (d >= R || d === 0) continue;
            nx /= d; ny /= d;
            const vn = b.vx * nx + b.vy * ny;
            if (vn >= 0) { b.x += nx * (R - d); b.y += ny * (R - d); continue; }
            let s = Math.min((R - d) / -vn, h);
            b.x -= b.vx * s; b.y -= b.vy * s;
            if (P.cushionModel === 'mathavan') cushionMathavan(b, nx, ny, P);
            else if (P.cushionModel === 'realistic') cushionImpulse(b, nx, ny, P);
            else {
              // 'simple': normal velocity reversed and scaled by e, tangential unchanged, and the
              // rolling-equivalent spin mirrored the same way (keeps a rolling ball rolling).
              // Not physical: a frictionless impulse through the center cannot change the spin.
              const k = (1 + P.eCushion) * vn;
              b.vx -= k * nx; b.vy -= k * ny;
              let ex = R * b.wy, ey = -R * b.wx;
              const en = ex * nx + ey * ny, ke = (1 + P.eCushion) * en;
              ex -= ke * nx; ey -= ke * ny;
              b.wy = ex / R; b.wx = -ey / R;
            }
            b.x += b.vx * s; b.y += b.vy * s;
            this.events.push({ type: 'cushion', t: this.time - s, ball: b.id, cushion: sg.cushion, part: sg.kind, speed: -vn });
            hit = true;
          }
        }
        if (!hit) break;
      }
    }

    checkPockets() {
      const T = this.table;
      for (const b of this.balls) {
        if (!b.onTable) continue;
        for (const p of T.pockets) {
          if ((b.x - p.x) ** 2 + (b.y - p.y) ** 2 < p.r * p.r) { this.pocket(b, p); break; }
        }
        // safety net: anything that escaped the table is pocketed in the nearest pocket
        if (b.onTable && (Math.abs(b.x) > T.L2 + 0.2 || Math.abs(b.y) > T.W2 + 0.2)) {
          let best = T.pockets[0], bd = 1e9;
          for (const p of T.pockets) { const d = Math.hypot(b.x - p.x, b.y - p.y); if (d < bd) { bd = d; best = p; } }
          this.pocket(b, best);
        }
      }
    }

    pocket(b, p) {
      const ex = b.x, ey = b.y, evx = b.vx, evy = b.vy;   // how it went in (for the drop animation)
      b.onTable = false; b.pocketedIn = p.id;
      b.trail.push(p.x, p.y);
      b.x = p.x; b.y = p.y; b.stop();
      this.events.push({ type: 'pocket', t: this.time, ball: b.id, pocket: p.id, pocketName: p.name, x: ex, y: ey, vx: evx, vy: evy });
    }

    clearTrails() { for (const b of this.balls) b.trail = []; }

    // Deep-ish copy for prediction runs.
    clone() {
      const w = new World(this.table, Object.assign({}, this.params));
      for (const b of this.balls) {
        const c = new Ball(b.id, b.num, b.x, b.y);
        Object.assign(c, { vx: b.vx, vy: b.vy, wx: b.wx, wy: b.wy, wz: b.wz, onTable: b.onTable });
        c.ax = b.ax.slice(); c.ay = b.ay.slice(); c.az = b.az.slice();
        w.balls.push(c);
      }
      return w;
    }

    // Run until everything stops (or time cap). Returns elapsed time.
    runToRest(maxT = C.MAX_SIM_TIME, dt = C.DT) {
      const t0 = this.time;
      while (this.time - t0 < maxT) {
        if (!this.substep(dt)) break;
      }
      return this.time - t0;
    }
  }
  QB.World = World;
})();
