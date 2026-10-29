// Qball — 3D "cue's-eye" view (three.js r149, vendored in js/vendor).
// World axes match the physics: x along the table, y across, z up. Units: meters.
window.QB = window.QB || {};

(function () {
  const C = QB.C, R = C.BALL_R;
  const NOSE_H = C.CUSHION_H_FRAC * 2 * R;   // cushion nose height
  const RAIL_H = NOSE_H + 0.0005;            // rail cap flush with the cushion top (the cue must clear it)
  const WALK_ROOM = 1.0;                     // Walk mode: how far from the rails the player may walk (m)

  class CueView {
    constructor(canvas, table) {
      this.canvas = canvas; this.table = table;
      if (THREE.ColorManagement) THREE.ColorManagement.legacyMode = false; // hex colors are sRGB
      const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      r.outputEncoding = THREE.sRGBEncoding;
      r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x0b0e11);
      this.camera = new THREE.PerspectiveCamera(42, 1, 0.01, 30);
      this.camera.up.set(0, 0, 1);
      this.z = 0.25;        // zoom 0..1: 0 = down on the cue (close, nearly level), 1 = standing up, far back
      this.frozen = null;   // camera pose kept while the balls roll
      this.balls = new Map();
      this.buildTable();
      this.buildLights();
      this.buildCue();
      this.buildAids();
    }

    // ---------------- scene construction ----------------
    buildTable() {
      const T = this.table, c = C.CUSHION_W, rw = C.RAIL_W, S = this.scene;
      const clothMat = new THREE.MeshStandardMaterial({ color: 0x1b7a4b, roughness: 0.95 });
      const cushMat = new THREE.MeshStandardMaterial({ color: 0x136640, roughness: 0.9 });
      const woodMat = new THREE.MeshStandardMaterial({ color: 0x5c2f15, roughness: 0.55 });
      const darkMat = new THREE.MeshStandardMaterial({ color: 0x120a05, roughness: 0.9 });
      const black = new THREE.MeshBasicMaterial({ color: 0x030303 });

      // cloth (out to the cushion back line)
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(C.TABLE_L + 2 * c, C.TABLE_W + 2 * c), clothMat);
      cloth.receiveShadow = true; S.add(cloth);

      // pocket drop holes on the cloth + a short black liner below
      for (const p of T.pockets) {
        const d = new THREE.Mesh(new THREE.CircleGeometry(p.r, 40), black);
        d.position.set(p.x, p.y, 0.0006); S.add(d);
        const liner = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r * 0.9, 0.12, 40, 1, true), new THREE.MeshBasicMaterial({ color: 0x050505, side: THREE.BackSide }));
        liner.rotation.x = Math.PI / 2; liner.position.set(p.x, p.y, -0.06); S.add(liner);
      }

      // cushions: extruded cushion polygons
      for (const cu of T.cushions) {
        const sh = new THREE.Shape(cu.pts.map(q => new THREE.Vector2(q.x, q.y)));
        const g = new THREE.ExtrudeGeometry(sh, { depth: NOSE_H, bevelEnabled: false });
        const m = new THREE.Mesh(g, cushMat); m.receiveShadow = true; m.castShadow = false; S.add(m);
      }

      // rails: outer rectangle minus (cushion back line rectangle ∪ pocket circles)
      const X1 = T.L2 + c + rw, Y1 = T.W2 + c + rw, X0 = T.L2 + c, Y0 = T.W2 + c;
      const outer = new THREE.Shape([new THREE.Vector2(-X1, -Y1), new THREE.Vector2(X1, -Y1), new THREE.Vector2(X1, Y1), new THREE.Vector2(-X1, Y1)]);
      const ring = [], step = 0.004;
      // Walk the rectangle counter-clockwise. A point that falls inside a pocket circle is pushed outward along the
      // edge normal onto the far side of the circle; between consecutive points on the same circle the arc is filled
      // in. That opens the rail around the pocket (side pockets included) instead of bulging into it.
      let lastPocket = null, lastAng = 0;
      const push = (x, y, pk, ang) => {
        if (pk && lastPocket === pk) {
          let da = Math.atan2(Math.sin(ang - lastAng), Math.cos(ang - lastAng));
          const n = Math.ceil(Math.abs(da) / 0.12);
          for (let k = 1; k < n; k++) { const a = lastAng + da * k / n; ring.push(new THREE.Vector2(pk.x + pk.r * Math.cos(a), pk.y + pk.r * Math.sin(a))); }
        }
        ring.push(new THREE.Vector2(x, y)); lastPocket = pk; lastAng = ang;
      };
      const edge = (ax, ay, bx, by, nx, ny) => {
        const n = Math.ceil(Math.hypot(bx - ax, by - ay) / step);
        for (let i = 0; i < n; i++) {
          let x = ax + (bx - ax) * i / n, y = ay + (by - ay) * i / n, hit = null;
          for (const p of T.pockets) {
            const qx = x - p.x, qy = y - p.y;
            if (qx * qx + qy * qy >= p.r * p.r) continue;
            const b = qx * nx + qy * ny, t = -b + Math.sqrt(b * b - (qx * qx + qy * qy - p.r * p.r));   // far intersection
            x += nx * t; y += ny * t; hit = p; break;
          }
          push(x, y, hit, hit ? Math.atan2(y - hit.y, x - hit.x) : 0);
        }
      };
      // start between pockets so the closing segment never cuts across a pocket
      edge(-X0 / 2, -Y0, X0, -Y0, 0, -1); edge(X0, -Y0, X0, Y0, 1, 0); edge(X0, Y0, -X0, Y0, 0, 1); edge(-X0, Y0, -X0, -Y0, -1, 0); edge(-X0, -Y0, -X0 / 2, -Y0, 0, -1);
      outer.holes.push(new THREE.Path(ring));
      const rail = new THREE.Mesh(new THREE.ExtrudeGeometry(outer, { depth: RAIL_H, bevelEnabled: false, curveSegments: 4 }), [woodMat, darkMat]);
      rail.receiveShadow = true; S.add(rail);
      // floor-level apron below the rail so the table has some body
      const apron = new THREE.Mesh(new THREE.BoxGeometry(2 * X1, 2 * Y1, 0.18), darkMat);
      apron.position.z = -0.0901; S.add(apron);

      // diamonds
      const dm = new THREE.MeshBasicMaterial({ color: 0xe9dcc0 });
      const dg = new THREE.CircleGeometry(0.008, 4);
      const off = c + rw / 2;
      const put = (x, y, rot) => { const m = new THREE.Mesh(dg, dm); m.position.set(x, y, RAIL_H + 0.0005); m.rotation.z = rot; m.scale.set(1, 0.7, 1); S.add(m); };
      for (let k = -3; k <= 3; k++) if (k) { put(k * C.TABLE_L / 8, T.W2 + off, Math.PI / 2); put(k * C.TABLE_L / 8, -T.W2 - off, Math.PI / 2); }
      for (let k = -1; k <= 1; k++) { put(-T.L2 - off, k * C.TABLE_W / 4, 0); put(T.L2 + off, k * C.TABLE_W / 4, 0); }

      // cloth markings: head string, kitchen box lines, half circle, spots, optional diamond grid
      const mk = QB.markings(T), lm = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22 });
      const line = (pts) => { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(q => new THREE.Vector3(q[0], q[1], 0.0007))), lm); S.add(l); };
      line([[T.headString, T.W2], [T.headString, -T.W2]]);
      for (const y of mk.boxY) line([[T.headString, y], [-T.L2, y]]);
      const arc = []; for (let i = 0; i <= 40; i++) { const a = Math.PI / 2 + Math.PI * i / 40; arc.push([T.headString + mk.dRadius * Math.cos(a), mk.dRadius * Math.sin(a)]); }
      line(arc);
      const spotM = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 });
      for (const q of [T.headSpot, T.footSpot, { x: 0, y: 0 }]) { const m = new THREE.Mesh(new THREE.CircleGeometry(0.005, 16), spotM); m.position.set(q.x, q.y, 0.0007); S.add(m); }
      this.gridGroup = new THREE.Group(); this.gridGroup.visible = false;
      const gm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }), gg = new THREE.CircleGeometry(0.0045, 12);
      for (const q of mk.grid) { const m = new THREE.Mesh(gg, gm); m.position.set(q.x, q.y, 0.0008); this.gridGroup.add(m); }
      S.add(this.gridGroup);

      // a dim floor far below
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: 0x17130f, roughness: 1 }));
      floor.position.z = -0.75; S.add(floor);
    }

    buildLights() {
      const S = this.scene;
      S.add(new THREE.HemisphereLight(0xfff4e0, 0x202020, 0.35));
      const key = new THREE.DirectionalLight(0xfff2dc, 1.1);
      key.position.set(0.2, 0.15, 3); key.target.position.set(0, 0, 0);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      const sc = key.shadow.camera; sc.left = -1.6; sc.right = 1.6; sc.top = 1.0; sc.bottom = -1.0; sc.near = 1; sc.far = 4;
      key.shadow.bias = -0.0005; key.shadow.radius = 3;
      S.add(key); S.add(key.target);
      // three pool lamps along the table for highlights
      for (const x of [-0.8, 0, 0.8]) {
        const l = new THREE.PointLight(0xfff0d0, 0.6, 3.0, 2);
        l.position.set(x, 0, 1.0); S.add(l);
      }
    }

    buildCue() {
      const g = this.cue = new THREE.Group();
      const L = C.CUE_LEN, hw = (d) => 0.0065 + (0.0145 - 0.0065) * (d / L);
      const seg = (d0, d1, color, rough = 0.5) => {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(hw(d1), hw(d0), d1 - d0, 24),
          new THREE.MeshStandardMaterial({ color, roughness: rough }));
        m.position.y = (d0 + d1) / 2; m.castShadow = true; g.add(m);
      };
      seg(0, 0.006, 0x3b6fd8, 0.9); seg(0.006, 0.03, 0xf2efe6); seg(0.03, 0.80, 0xe3c48f, 0.4);
      seg(0.80, 1.02, 0x2a1408); seg(1.02, 1.30, 0x151515, 0.8); seg(1.30, L, 0x2a1408);
      this.scene.add(g);
    }

    buildAids() {
      const mk = (color, opacity = 1) => {
        const l = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
        l.frustumCulled = false; this.scene.add(l); return l;
      };
      this.aimLine = mk(0xffffff, 0.8);
      this.obLine = mk(0xffd640, 0.95);
      this.cbLine = mk(0x78e6ff, 0.95);
      this.tanLine = mk(0xa0dcff, 0.5);
      this.ghost = new THREE.Mesh(new THREE.SphereGeometry(R, 24, 16),
        new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.35 }));
      this.scene.add(this.ghost);
    }

    // ---------------- balls ----------------
    ballMesh(b) {
      let m = this.balls.get(b.id);
      if (m && m.userData.num === b.num) return m;
      if (m) this.scene.remove(m);
      const tex = new THREE.CanvasTexture(ballTexture(b.num));
      tex.encoding = THREE.sRGBEncoding; tex.anisotropy = 4;
      m = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 32),
        new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08 }));
      m.castShadow = true; m.userData.num = b.num;
      this.scene.add(m); this.balls.set(b.id, m);
      return m;
    }

    // ---------------- per-frame ----------------
    resize() {
      const rect = this.canvas.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      this.renderer.setPixelRatio(window.devicePixelRatio || 1);
      this.renderer.setSize(rect.width, rect.height, false);
      this.camera.aspect = rect.width / rect.height;
      this.camera.updateProjectionMatrix();
    }
    // eye distance behind the cue ball and eye height, both from the zoom setting: zooming in brings the
    // eye closer and lower (more level, like getting down on the shot), zooming out stands you up
    // z = 0: down on the shot, eye ~62 cm behind the cue ball (chin over the cue, more of the stick in view)
    // z = 1: standing, eye ~0.86 m above the cloth
    get dist() { return 0.62 + 0.70 * this.z; }
    get height() { return 0.14 + 0.72 * Math.pow(this.z, 1.5); }
    zoom(deltaY) { this.z = Math.min(1, Math.max(0, this.z + deltaY * 0.0008)); }
    setGrid(on) { if (this.gridGroup) this.gridGroup.visible = !!on; }
    // ---------------- walking around the table (Walk mode) ----------------
    // The player stands on the floor around the table: anywhere outside the rails (plus a body gap) and inside
    // a "room" margin. The view is a free yaw + pitch. While the player is moved, the eyes stay on the spot of the
    // cloth they were looking at; dragging the 3D view looks around freely.
    walkArea() {
      const T = this.table, X = T.L2 + C.CUSHION_W + C.RAIL_W, Y = T.W2 + C.CUSHION_W + C.RAIL_W;
      return { X, Y, gap: 0.14, room: WALK_ROOM };
    }
    clampWalk(x, y) {
      const { X, Y, gap, room } = this.walkArea();
      x = Math.max(-(X + room), Math.min(X + room, x)); y = Math.max(-(Y + room), Math.min(Y + room, y));
      const ix = X + gap, iy = Y + gap;
      if (Math.abs(x) < ix && Math.abs(y) < iy) {          // inside the table: step out to the nearest side
        if (ix - Math.abs(x) < iy - Math.abs(y)) x = (x < 0 ? -1 : 1) * ix; else y = (y < 0 ? -1 : 1) * iy;
      }
      return [x, y];
    }
    // route from (x0,y0) to (x1,y1) around the table: corner waypoints if the straight line would cross it
    walkRoute(x0, y0, x1, y1) {
      const { X, Y, gap } = this.walkArea(), ix = X + gap + 0.02, iy = Y + gap + 0.02;
      // does the segment cross the rectangle |x|<ix, |y|<iy ? (slab test)
      let t0 = 0, t1 = 1; const dx = x1 - x0, dy = y1 - y0;
      for (const [p, d, lim] of [[x0, dx, ix], [y0, dy, iy]]) {
        if (Math.abs(d) < 1e-12) { if (Math.abs(p) >= lim) { t0 = 2; break; } continue; }
        let ta = (-lim - p) / d, tb = (lim - p) / d; if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      }
      if (t0 >= t1) return [[x1, y1]];
      // walk along the rectangle the shorter way: parameterise by perimeter position (counter-clockwise from (ix,-iy))
      const len = 4 * (ix + iy);
      const param = (x, y) => {                       // radial projection onto the rectangle, then arc position
        const k = Math.min(ix / Math.max(Math.abs(x), 1e-9), iy / Math.max(Math.abs(y), 1e-9)), px = x * k, py = y * k;
        if (Math.abs(px - ix) < 1e-6) return py + iy;
        if (Math.abs(py - iy) < 1e-6) return 2 * iy + (ix - px);
        if (Math.abs(px + ix) < 1e-6) return 2 * iy + 2 * ix + (iy - py);
        return 4 * iy + 2 * ix + (px + ix);
      };
      const corners = [[2 * iy, [ix, iy]], [2 * iy + 2 * ix, [-ix, iy]], [4 * iy + 2 * ix, [-ix, -iy]], [len, [ix, -iy]]];
      const s0 = param(x0, y0), s1 = param(x1, y1);
      let d = ((s1 - s0) % len + len) % len; const dir = d <= len / 2 ? 1 : -1; if (dir < 0) d = len - d;
      const pts = [];
      for (const [cs, c] of corners) for (const off of [0, len]) {     // corners passed on the way, in order
        const rel = dir > 0 ? ((cs + off - s0) % len + len) % len : ((s0 - cs - off) % len + len) % len;
        if (rel > 1e-6 && rel < d - 1e-6 && off === 0) pts.push([rel, c]);
      }
      pts.sort((u, v) => u[0] - v[0]);
      return [...pts.map(q => q[1]), [x1, y1]];
    }
    // stand up where you are (just outside the table, behind the shot), looking at `focus` (the cue ball)
    startWalk(focus) {
      if (this.walk) return;
      const e = this.lastPose ? this.lastPose.eye : [-this.table.L2 - 0.5, 0, 1];
      const t = this.lastPose ? this.lastPose.target : [0, 0, 0];
      const [x, y] = this.clampWalk(e[0], e[1]);
      this.walk = { x, y, yaw: Math.atan2(t[1] - e[1], t[0] - e[0]), pitch: -0.6, route: null,
        focus: focus ? [focus.x, focus.y] : [0, 0] };
      this.z = 1;            // walking = standing up
    }
    stopWalk() { this.walk = null; this.z = 1; }
    walkEyeH() { return 0.12 + 0.75 * this.z; }      // standing (z = 1) ... bent down low (z = 0)
    // the spot on the cloth the player is looking at now (null if looking above / off the table)
    gazeSpot() {
      const pose = this.walkPose(), e = pose.eye, t = pose.target, dz = t[2] - e[2];
      if (dz >= -1e-6) return null;
      const k = -e[2] / dz, gx = e[0] + (t[0] - e[0]) * k, gy = e[1] + (t[1] - e[1]) * k;
      return (Math.abs(gx) < this.table.L2 + 0.05 && Math.abs(gy) < this.table.W2 + 0.05) ? [gx, gy] : null;
    }
    // move the player: glide = walk there (around the table), otherwise jump (dragging the dot on the map)
    moveWalker(x, y, glide) {
      const w = this.walk; if (!w) return;
      if (!w.moving) { w.focus = this.gazeSpot(); w.moving = true; }   // start of a move: keep eyes on what you look at
      [x, y] = this.clampWalk(x, y);
      if (glide) w.route = this.walkRoute(w.x, w.y, x, y);
      else { w.route = null; w.x = x; w.y = y; }
    }
    endMove() { if (this.walk) this.walk.moving = false; }
    look(dYaw, dPitch) {
      const w = this.walk; if (!w) return;
      w.focus = null;
      w.yaw += dYaw; w.pitch = Math.max(-1.45, Math.min(0.35, w.pitch + dPitch));
    }
    walkerAt(x, y) { const w = this.walk; return !!w && Math.hypot(x - w.x, y - w.y) < 0.25; }
    stepWalk(dt) {
      const w = this.walk; if (!w || !w.route) return;
      let v = 2.0 * dt;                                     // walking speed (m/s)
      while (v > 0 && w.route.length) {
        const [tx, ty] = w.route[0], d = Math.hypot(tx - w.x, ty - w.y);
        if (d <= v) { w.x = tx; w.y = ty; v -= d; w.route.shift(); }
        else { w.x += (tx - w.x) / d * v; w.y += (ty - w.y) / d * v; v = 0; }
      }
      if (!w.route.length) w.route = null;
    }
    walkPose() {
      const w = this.walk, h = this.walkEyeH();
      let lean = (1 - this.z) * 0.6;                         // free look: zooming in = leaning over the table
      if (w.focus) {
        // eyes on a spot: face it, and zooming in = leaning toward it and getting down to it
        const fx = w.focus[0] - w.x, fy = w.focus[1] - w.y, dist = Math.max(1e-3, Math.hypot(fx, fy));
        w.yaw = Math.atan2(fy, fx);
        lean = Math.min((1 - this.z) * 0.6 * dist, Math.max(0, dist - 0.35));
        w.pitch = -Math.atan2(h, Math.max(0.05, dist - lean));
      }
      const dx = Math.cos(w.yaw), dy = Math.sin(w.yaw), cp = Math.cos(w.pitch), sp = Math.sin(w.pitch);
      const ex = w.x + dx * lean, ey = w.y + dy * lean;
      return { eye: [ex, ey, h], target: [ex + dx * cp, ey + dy * cp, h + sp] };
    }
    walkerOnMap() {
      if (!this.walk) return null;
      const { X, Y, room } = this.walkArea();
      const cam = this.camera, hfov = 2 * Math.atan(Math.tan(cam.fov * Math.PI / 360) * cam.aspect);
      return { x: this.walk.x, y: this.walk.y, yaw: this.walk.yaw, hfov, area: { X: X + room, Y: Y + room } };
    }

    freeze(pose) { this.frozen = pose; }
    unfreeze() { this.frozen = null; }
    poseFor(cb, aim, elev = 0) {
      const dx = Math.cos(aim), dy = Math.sin(aim);
      // normal pose from the zoom setting; the eye stays above the cue
      const hA = Math.max(this.height, R + this.dist * Math.tan(elev) + 0.08);
      const ahead = 0.9 + 0.3 * this.z;          // look a bit closer when down on the shot so the cue stays in frame
      const eyeA = [cb.x - dx * this.dist, cb.y - dy * this.dist, hA], tgtA = [cb.x + dx * ahead, cb.y + dy * ahead, 0];
      // raised cue: zoom out automatically (back and up) so the stick stays in view. Blend in between 2° and 12°.
      const f = Math.max(0, Math.min(1, (elev * 180 / Math.PI - 2) / 10));
      if (f <= 0) return { eye: eyeA, target: tgtA };
      // eye over the back part of the cue and well above it, so the stick is seen from above (not end-on)
      const back = C.CUE_LEN + C.MAX_PULL + 0.25, ce = Math.cos(elev), se = Math.sin(elev), hb = back * ce * 0.75;
      const eyeB = [cb.x - dx * hb, cb.y - dy * hb, R + hb * Math.tan(elev) + 0.35 + 0.3 * se], tgtB = [cb.x + dx * 0.25, cb.y + dy * 0.25, 0];
      // never zoom *in* compared to what the player chose
      const useB = Math.hypot(eyeB[0] - cb.x, eyeB[1] - cb.y) >= this.dist || eyeB[2] >= hA;
      const g = useB ? f : 0, mix = (a, b) => a.map((v, i) => v + (b[i] - v) * g);
      return { eye: mix(eyeA, eyeB), target: mix(tgtA, tgtB) };
    }

    // st: {balls, cue, aimAngle, elev(rad), tipX, tipY, pull, showCue, showAids, aim, cbPath}
    render(st) {
      const { cue } = st;
      // camera
      const now = performance.now(), dt = Math.min(0.05, (now - (this._t || now)) / 1000); this._t = now;
      if (this.walk) this.stepWalk(dt);
      let pose = this.walk ? this.walkPose() : this.frozen || (cue.onTable ? this.poseFor(cue, st.aimAngle, st.elev || 0) : this.lastPose);
      // standing up / going back to the shot: blend the camera over ~0.4 s instead of jumping
      const walking = !!this.walk;
      if (this._wasWalking !== undefined && walking !== this._wasWalking && this.lastPose) this.trans = { from: this.lastPose, t: 0 };
      this._wasWalking = walking;
      if (pose && this.trans) {
        this.trans.t += dt / 0.4;
        if (this.trans.t >= 1) this.trans = null;
        else {
          const u = this.trans.t * this.trans.t * (3 - 2 * this.trans.t), f = this.trans.from;
          const mix = (a, b) => a.map((v, i) => v + (b[i] - v) * u);
          pose = { eye: mix(f.eye, pose.eye), target: mix(f.target, pose.target) };
        }
      }
      if (pose) {
        this.lastPose = pose;
        this.camera.position.set(...pose.eye);
        this.camera.lookAt(...pose.target);
      }
      // drop meshes of balls that are no longer in the world (new rack / drill)
      for (const [id, mesh] of this.balls) if (!st.balls[id] || st.balls[id].num !== mesh.userData.num) { this.scene.remove(mesh); this.balls.delete(id); }
      // drill target zone on the cloth
      if (!this.zone) {
        this.zone = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: 0x78e6ff, transparent: true, opacity: 0.25, depthWrite: false }));
        this.zone.position.z = 0.0008; this.scene.add(this.zone);
      }
      this.zone.visible = !!st.zone;
      if (st.zone) { this.zone.position.x = st.zone.x; this.zone.position.y = st.zone.y; this.zone.scale.set(st.zone.r, st.zone.r, 1); }
      // chalk marks on the cloth
      this.chalkMeshes = this.chalkMeshes || [];
      const ch = st.chalk || [];
      while (this.chalkMeshes.length < ch.length) {
        if (!this.chalkTex) {
          const cv = document.createElement('canvas'); cv.width = cv.height = 64;
          const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
          gr.addColorStop(0, 'rgba(70,120,215,1)'); gr.addColorStop(1, 'rgba(70,120,215,0)');
          g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
          this.chalkTex = new THREE.CanvasTexture(cv);
        }
        const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: this.chalkTex, transparent: true, depthWrite: false }));
        this.scene.add(m); this.chalkMeshes.push(m);
      }
      this.chalkMeshes.forEach((m, i) => {
        const c = ch[i]; m.visible = !!c; if (!c) return;
        m.position.set(c.x, c.y, 0.0009); m.rotation.z = c.ang; m.scale.set(c.len, 0.0065, 1); m.material.opacity = c.a;
      });
      // balls
      const m4 = new THREE.Matrix4();
      for (const b of st.balls) {
        const m = this.ballMesh(b);
        m.visible = b.onTable;
        if (!b.onTable) continue;
        m.position.set(b.x, b.y, R);
        // local axes -> body axes (see ballTexture for which marking sits on which local axis)
        const [X, Y, Z] = b.num === 0 ? [b.ax, b.ay, b.az]
          : b.num >= 9 ? [b.ax, b.az, [-b.ay[0], -b.ay[1], -b.ay[2]]]
            : [b.az, b.ax, b.ay];
        m4.makeBasis(new THREE.Vector3(...X), new THREE.Vector3(...Y), new THREE.Vector3(...Z));
        m.quaternion.setFromRotationMatrix(m4);
      }
      // cue stick
      this.cue.visible = !!st.showCue && cue.onTable && !this.walk;   // no cue in hand while walking
      if (this.cue.visible) {
        const th = st.elev || 0, ce = Math.cos(th), se = Math.sin(th);
        const dx = Math.cos(st.aimAngle), dy = Math.sin(st.aimAngle);
        let tx = st.tipX, ty = st.tipY; const rr = Math.hypot(tx, ty);
        if (rr > C.TIP_MAX) { tx *= C.TIP_MAX / rr; ty *= C.TIP_MAX / rr; }
        const a = tx * R, b = ty * R, c = R * Math.sqrt(Math.max(0, 1 - tx * tx - ty * ty));
        const e = [ce * dx, ce * dy, -se], rv = [dy, -dx, 0], uv = [se * dx, se * dy, ce];
        const gap = 0.006 + (st.pull || 0);
        const P = [0, 1, 2].map(i => a * rv[i] + b * uv[i] - c * e[i] - gap * e[i]);
        this.cue.position.set(cue.x + P[0], cue.y + P[1], R + P[2]);
        this.cue.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-e[0], -e[1], -e[2]));
      }
      // aiming aids
      const show = !!st.showAids && st.aim;
      for (const o of [this.aimLine, this.obLine, this.cbLine, this.tanLine, this.ghost]) o.visible = false;
      if (st.showGhost && st.aim) { this.ghost.visible = true; this.ghost.position.set(st.aim.gx, st.aim.gy, R); }
      if (show) {
        const A = st.aim, z = 0.0015;
        setLine(this.aimLine, [cue.x, cue.y, z, A.gx, A.gy, z]);
        if (A.hit && A.hit.type === 'ball') {
          setLine(this.obLine, [A.ob.x, A.ob.y, z, A.obEnd.x, A.obEnd.y, z]);
          if (A.tangent && st.showTangent) setLine(this.tanLine, [A.gx, A.gy, z, A.gx + A.tangent.x * 0.3, A.gy + A.tangent.y * 0.3, z]);
        } else if (A.bounce) {
          setLine(this.obLine, [A.gx, A.gy, z, A.bounce.x, A.bounce.y, z]);
        }
        if (st.cbPath) {
          const pts = []; for (let i = 0; i < st.cbPath.length; i += 2) pts.push(st.cbPath[i], st.cbPath[i + 1], z + 0.0005);
          setLine(this.cbLine, pts);
        }
      }
      this.renderer.render(this.scene, this.camera);
    }
  }

  function setLine(line, arr) {
    line.geometry.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    line.geometry.computeBoundingSphere();
    line.visible = true;
  }

  // Equirectangular ball texture (SphereGeometry: canvas top = local +Y pole, middle row = equator,
  // u = 0.5 -> local +X, u = 0 / 1 -> local -X, u = 0.25 -> +Z, u = 0.75 -> -Z).
  //   cue ball : red dots on all six local axes          (local X,Y,Z = body ax, ay, az)
  //   solids   : number discs on local ±X                (local X = body az, matching the 2D view)
  //   stripes  : white caps at local ±Y, numbers on ±X  (local Y = body az, X = body ax)
  function ballTexture(num) {
    const W = 1024, H = 512, cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const col = QB.BALL_COLORS[num] || '#888';
    const angPx = (a) => a / Math.PI * H;
    const disc = (u, ang, fill, label) => {
      for (const du of [0, -1, 1]) { // wrap around the seam
        const x = (u + du) * W, y = H / 2, r = angPx(ang);
        g.fillStyle = fill; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
        if (label) {
          g.fillStyle = '#111'; g.font = `bold ${Math.round(r * 1.15)}px system-ui, sans-serif`;
          g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, x, y + r * 0.06);
        }
      }
    };
    if (num === 0) {
      g.fillStyle = '#f6f4ec'; g.fillRect(0, 0, W, H);
      const dr = 0.15;
      for (const u of [0, 0.25, 0.5, 0.75]) disc(u, dr, '#c8102e');
      g.fillStyle = '#c8102e'; g.fillRect(0, 0, W, angPx(dr)); g.fillRect(0, H - angPx(dr), W, angPx(dr));
    } else if (num >= 9) {
      g.fillStyle = '#f6f4ec'; g.fillRect(0, 0, W, H);
      const band = Math.PI / 2 - 0.85;
      g.fillStyle = col; g.fillRect(0, H / 2 - angPx(band), W, 2 * angPx(band));
      disc(0.5, 0.42, '#f6f4ec', String(num)); disc(0, 0.42, '#f6f4ec', String(num));
    } else {
      g.fillStyle = col; g.fillRect(0, 0, W, H);
      disc(0.5, 0.45, '#f6f4ec', String(num)); disc(0, 0.45, '#f6f4ec', String(num));
    }
    return cv;
  }

  QB.CueView = CueView;
})();
