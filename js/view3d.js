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
      // procedural textures (js/textures.js): cloth with fibres, nap and light wear; felt cushions; grained wood
      const tex = (cv, rx, ry) => {
        const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding; t.anisotropy = 8;
        if (rx) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); }
        return t;
      };
      // the cloth has real holes at the pockets (cut out of its texture's alpha), so you can see into the pocket
      const Lc = C.TABLE_L + 2 * c, Wc = C.TABLE_W + 2 * c, src = QB.Tex.cloth(T, Lc, Wc);
      const holed = document.createElement('canvas'); holed.width = src.width; holed.height = src.height;
      const hg = holed.getContext('2d'); hg.drawImage(src, 0, 0); hg.globalCompositeOperation = 'destination-out';
      for (const p of T.pockets) {
        hg.beginPath(); hg.arc((p.x + Lc / 2) / Lc * src.width, (Wc / 2 - p.y) / Wc * src.height, p.r / Lc * src.width, 0, Math.PI * 2); hg.fill();
      }
      const clothMat = new THREE.MeshStandardMaterial({ map: tex(holed), roughness: 0.95, alphaTest: 0.5 });
      const cushMat = new THREE.MeshStandardMaterial({ map: tex(QB.Tex.feltTile('#136640'), 4, 4), roughness: 0.92 });  // UV in metres: 25 cm tiles
      const woodMat = new THREE.MeshPhysicalMaterial({ map: tex(QB.Tex.wood(), 1, 4), roughness: 0.45, clearcoat: 0.45, clearcoatRoughness: 0.3 }); // 1 m × 25 cm
      const darkMat = new THREE.MeshStandardMaterial({ color: 0x120a05, roughness: 0.9 });
      const black = new THREE.MeshBasicMaterial({ color: 0x030303 });

      // cloth (out to the cushion back line)
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(C.TABLE_L + 2 * c, C.TABLE_W + 2 * c), clothMat);
      cloth.receiveShadow = true; S.add(cloth);

      // pockets: a dark cup (straight liner + bottom) below the hole in the cloth; dropped balls end up in here
      // (7 cm deep: a pocketed ball sits with its top just below the cloth, where you can see it)
      const linerMat = new THREE.MeshStandardMaterial({ color: 0x060606, roughness: 1, side: THREE.BackSide });
      const bottomMat = new THREE.MeshStandardMaterial({ color: 0x040404, roughness: 1 });
      for (const p of T.pockets) {
        const liner = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r + 0.02, 0.07, 40, 1, true), linerMat);   // the bag widens a little
        liner.rotation.x = Math.PI / 2; liner.position.set(p.x, p.y, -0.035); liner.receiveShadow = true; S.add(liner);
        const bottom = new THREE.Mesh(new THREE.CircleGeometry(p.r + 0.02, 40), bottomMat);
        bottom.position.set(p.x, p.y, -0.069); bottom.receiveShadow = true; S.add(bottom);
      }

      // cushions: extruded cushion polygons
      for (const cu of T.cushions) {
        const sh = new THREE.Shape(cu.pts.map(q => new THREE.Vector2(q.x, q.y)));
        const g = new THREE.ExtrudeGeometry(sh, { depth: NOSE_H, bevelEnabled: false });
        const m = new THREE.Mesh(g, cushMat); m.receiveShadow = true; m.castShadow = false; S.add(m);
      }

      // rails: outer rectangle minus (cushion back line rectangle ∪ pocket circles)
      const X1 = T.L2 + c + rw, Y1 = T.W2 + c + rw, X0 = T.L2 + c, Y0 = T.W2 + c;
      // outer edge subdivided (so the cap triangles stay local and the wood grain can follow each rail)
      const outerPts = [], sub = (ax, ay, bx, by) => { const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 0.05); for (let i = 0; i < n; i++) outerPts.push(new THREE.Vector2(ax + (bx - ax) * i / n, ay + (by - ay) * i / n)); };
      sub(-X1, -Y1, X1, -Y1); sub(X1, -Y1, X1, Y1); sub(X1, Y1, -X1, Y1); sub(-X1, Y1, -X1, -Y1);
      const outer = new THREE.Shape(outerPts);
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
      // the rail body reaches 8 cm below the cloth (down to the apron, below the pocket cups)
      const railGeo = new THREE.ExtrudeGeometry(outer, { depth: RAIL_H + 0.08, bevelEnabled: false, curveSegments: 4 });
      railGeo.translate(0, 0, -0.08);
      {   // wood grain along each rail: the caps' UVs are (x, y) in metres; swap to (y, x) on the head and foot rails
        const pos = railGeo.attributes.position, uv = railGeo.attributes.uv, cap = railGeo.groups[0];
        for (let t = cap.start; t < cap.start + cap.count; t += 3) {
          let cx = 0, cy = 0; for (let k = 0; k < 3; k++) { cx += pos.getX(t + k) / 3; cy += pos.getY(t + k) / 3; }
          const shortRail = (X1 - Math.abs(cx)) < (Y1 - Math.abs(cy));            // closer to an end rail (mitre line)
          for (let k = 0; k < 3; k++) { const x = pos.getX(t + k), y = pos.getY(t + k); uv.setXY(t + k, shortRail ? y : x, shortRail ? x : y); }
        }
        uv.needsUpdate = true;
      }
      const rail = new THREE.Mesh(railGeo, [woodMat, darkMat]);
      rail.receiveShadow = true; S.add(rail);
      // apron (the table's wooden body) below the rail; its top sits just below the pocket cups
      const apronMat = new THREE.MeshPhysicalMaterial({ map: tex(QB.Tex.wood(), 3, 0.25), color: 0xb89a88, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.35 });
      const apron = new THREE.Mesh(new THREE.BoxGeometry(2 * X1, 2 * Y1, 0.18), apronMat);
      apron.position.z = -0.075 - 0.09; apron.castShadow = true; S.add(apron);
      // ---- the room: the cloth is 77 cm above the floor ----
      const FLOOR = -0.77, apronBottom = -0.255;
      // six turned legs (corners and the middle of the long sides), grain running along the leg
      const legTex = tex(QB.Tex.wood(), 0.4, 1); legTex.center.set(0.5, 0.5); legTex.rotation = Math.PI / 2;
      const legMat = new THREE.MeshPhysicalMaterial({ map: legTex, color: 0xb89a88, roughness: 0.45, clearcoat: 0.4, clearcoatRoughness: 0.3 });
      const H = apronBottom - FLOOR;                                    // leg length
      const prof = [[0, 0], [0.055, 0], [0.06, 0.02], [0.045, 0.05], [0.042, 0.12], [0.05, 0.2], [0.07, 0.27], [0.075, 0.31],
        [0.06, 0.36], [0.045, 0.4], [0.05, 0.43], [0.065, 0.45], [0.065, H - 0.04], [0.075, H - 0.03], [0.075, H], [0, H]]
        .map(([r, y]) => new THREE.Vector2(r, y));
      const legGeo = new THREE.LatheGeometry(prof, 24);
      const blockGeo = new THREE.BoxGeometry(0.15, 0.15, 0.12);
      for (const [lx, ly] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1]]) {
        const x = lx * (X1 - 0.13), y = ly * (Y1 - 0.13);
        const leg = new THREE.Mesh(legGeo, legMat); leg.rotation.x = Math.PI / 2; leg.position.set(x, y, FLOOR);
        leg.castShadow = true; leg.receiveShadow = true; S.add(leg);
        const blk = new THREE.Mesh(blockGeo, legMat); blk.position.set(x, y, apronBottom - 0.06 + 0.06); S.add(blk);
      }

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

      // wooden floor, a rug under the table, and walls with wood panelling and wallpaper
      const floorMat = new THREE.MeshStandardMaterial({ map: tex(QB.Tex.floorboards(), 5, 5), color: 0x9a8a7c, roughness: 0.6 });
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), floorMat);
      floor.position.z = FLOOR; floor.receiveShadow = true; S.add(floor);
      const rugMat = new THREE.MeshStandardMaterial({ map: tex(QB.Tex.rug()), roughness: 1 });
      const rugMesh = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 3.34), rugMat);
      rugMesh.position.z = FLOOR + 0.004; rugMesh.receiveShadow = true; S.add(rugMesh);
      const RX = 4.4, RY = 3.4, WALL_H = 3.0;                          // room half-size (walls) and wall height
      const paper = tex(QB.Tex.wallpaper(), 1, 1), panelTex = tex(QB.Tex.wood(), 1, 1);
      const wall = (cx, cy, len, rot) => {
        const grp = new THREE.Group(); grp.position.set(cx, cy, FLOOR); grp.rotation.z = rot;
        const pt = paper.clone(); pt.needsUpdate = true; pt.repeat.set(len / 0.5, (WALL_H - 1.0) / 0.5);
        const up = new THREE.Mesh(new THREE.PlaneGeometry(len, WALL_H - 1.0), new THREE.MeshStandardMaterial({ map: pt, roughness: 0.9 }));
        up.rotation.x = Math.PI / 2; up.position.set(0, 0, 1.0 + (WALL_H - 1.0) / 2); grp.add(up);
        const wt = panelTex.clone(); wt.needsUpdate = true; wt.repeat.set(len / 1.0, 1);
        const low = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.0), new THREE.MeshStandardMaterial({ map: wt, color: 0x8a6e5c, roughness: 0.55 }));
        low.rotation.x = Math.PI / 2; low.position.set(0, 0, 0.5); grp.add(low);
        const trimMat = new THREE.MeshStandardMaterial({ color: 0x3a1d0e, roughness: 0.5 });
        const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.04, 0.06), trimMat); rail.position.set(0, -0.02, 1.0); grp.add(rail);
        const base = new THREE.Mesh(new THREE.BoxGeometry(len, 0.03, 0.12), trimMat); base.position.set(0, -0.015, 0.06); grp.add(base);
        S.add(grp);
      };
      // a wall's planes face local −y; each wall is turned to face the table
      wall(0, -RY, 2 * RX, Math.PI); wall(0, RY, 2 * RX, 0); wall(-RX, 0, 2 * RY, Math.PI / 2); wall(RX, 0, 2 * RY, -Math.PI / 2);
    }

    buildLights() {
      const S = this.scene;
      S.add(new THREE.HemisphereLight(0xfff4e0, 0x2a2018, 0.45));
      const key = new THREE.DirectionalLight(0xfff2dc, 1.1);
      key.position.set(0.2, 0.15, 3); key.target.position.set(0, 0, 0);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      const sc = key.shadow.camera; sc.left = -2.0; sc.right = 2.0; sc.top = 1.35; sc.bottom = -1.35; sc.near = 1; sc.far = 4.5;   // (incl. the table's shadow on the rug)
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
      // where the tip will hit the cue ball: a small, thin red "+" (about 6 mm across, 0.5 mm lines) painted on a
      // thin cap that sits on the ball surface
      const TH = 0.12, cw = 512, ch = 128, cvm = document.createElement('canvas'); cvm.width = cw; cvm.height = ch;
      const gm = cvm.getContext('2d');
      gm.fillStyle = 'rgba(230,30,35,0.85)';
      gm.fillRect(0, 0, cw, Math.max(1, 0.0003 / R / TH * ch));                              // joins the arms at the centre
      for (let y = 0; y < (0.003 / R) / TH * ch; y++) {                                        // four arms, 3 mm each
        const th = Math.max(0.004, (y + 0.5) / ch * TH), half = Math.min(cw / 8, ((0.00025 / R) / Math.sin(th)) / (2 * Math.PI) * cw);
        for (const x0 of [0, cw / 4, cw / 2, 3 * cw / 4, cw]) gm.fillRect(x0 - half, y, 2 * half, 1);
      }
      const capTex = new THREE.CanvasTexture(cvm); capTex.encoding = THREE.sRGBEncoding;
      this.tipMark = new THREE.Mesh(new THREE.SphereGeometry(R + 0.0003, 64, 16, 0, Math.PI * 2, 0, TH),
        new THREE.MeshBasicMaterial({ map: capTex, transparent: true, depthWrite: false }));
      this.tipMark.visible = false;
      this.scene.add(this.tipMark);
    }

    // ---------------- balls ----------------
    ballMesh(b) {
      let m = this.balls.get(b.id);
      if (m && m.userData.num === b.num) return m;
      if (m) this.scene.remove(m);
      const cv = ballTexture(b.num), tex = new THREE.CanvasTexture(cv.color), rough = new THREE.CanvasTexture(cv.rough);
      tex.encoding = THREE.sRGBEncoding; tex.anisotropy = 4; rough.anisotropy = 4;
      // satin rather than mirror-like; the roughness map makes chalk smudges and scuffs duller
      m = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 32),
        new THREE.MeshPhysicalMaterial({ map: tex, roughness: 1, roughnessMap: rough, clearcoat: 0.35, clearcoatRoughness: 0.3 }));
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
    // stand up where you are (just outside the table, behind the shot), facing the way you were looking
    startWalk() {
      if (this.walk) return;
      const e = this.lastPose ? this.lastPose.eye : [-this.table.L2 - 0.5, 0, 1];
      const t = this.lastPose ? this.lastPose.target : [0, 0, 0];
      const [x, y] = this.clampWalk(e[0], e[1]);
      this.walk = { x, y, yaw: Math.atan2(t[1] - e[1], t[0] - e[0]), route: null, focus: null };
      this.zShot = this.z;   // remember the zoom of the shot, to restore it when coming back
      this.z = 1;            // walking = standing up
    }
    stopWalk() { if (!this.walk) return; this.walk = null; this.z = this.zShot !== undefined ? this.zShot : 1; }
    walkEyeH() { return 0.12 + 0.75 * this.z; }      // standing (z = 1) ... bent down low (z = 0)
    // Walk mode: the dot on the map moves you, the view cone on the map turns you, and zoom (wheel / pinch on
    // the 3D view) bends you down. Turning with the cone fixes a point on the table (the middle of where the
    // line of sight crosses it); while you walk you keep facing that point. Pointing off the table = no fixed
    // point, and the view direction then stays the same while you walk.
    moveWalker(x, y, glide) {
      const w = this.walk; if (!w) return;
      [x, y] = this.clampWalk(x, y);
      if (glide) w.route = this.walkRoute(w.x, w.y, x, y);     // click: walk there (around the table)
      else { w.route = null; w.x = x; w.y = y; }               // drag the dot: follow it
    }
    endMove() { /* nothing to reset */ }
    setYaw(yaw) {
      const w = this.walk; if (!w) return;
      w.yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
      w.focus = this.rayFocus(w.x, w.y, w.yaw);
    }
    // the fixed point itself can be dragged on the map (e.g. onto a ball); it stays on the cloth
    focusAt(x, y) { const w = this.walk; return !!(w && w.focus) && Math.hypot(x - w.focus[0], y - w.focus[1]) < 0.08; }
    setFocus(x, y, z = 0) {
      const w = this.walk; if (!w) return;
      const T = this.table;
      w.focus = [Math.max(-T.L2, Math.min(T.L2, x)), Math.max(-T.W2, Math.min(T.W2, y)), z];
    }
    // What is under the pointer in the 3D view? A ray from the camera through the pixel; the first thing it hits
    // counts (a ball in front hides the one behind it). Returns {x, y, z, ball} or null (floor, sky, ...).
    pick(clientX, clientY, balls) {
      const rect = this.canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      const rc = this.raycaster || (this.raycaster = new THREE.Raycaster());
      rc.setFromCamera(ndc, this.camera);
      const T = this.table;
      for (const hit of rc.intersectObjects(this.scene.children, true)) {
        const o = hit.object;
        if (!o.isMesh || !o.visible) continue;
        let skip = false;
        for (let q = o; q; q = q.parent) if (q === this.cue || q === this.ghost) skip = true;   // see-through helpers
        if (skip || (o.material && o.material.transparent && o.material.opacity < 0.6)) continue;
        for (const b of balls) {                                                            // a ball?
          const m = this.balls.get(b.id);
          if (m === o && b.onTable) return { x: b.x, y: b.y, z: R, ball: b };
        }
        const p = hit.point;
        if (Math.abs(p.x) <= T.L2 + 0.25 && Math.abs(p.y) <= T.W2 + 0.25)                   // cloth, cushion or rail
          return { x: Math.max(-T.L2, Math.min(T.L2, p.x)), y: Math.max(-T.W2, Math.min(T.W2, p.y)), z: 0, ball: null };
        return null;                                                                          // floor etc.
      }
      return null;
    }
    rayFocus(x, y, yaw) {    // middle of the stretch where the ray from (x,y) crosses the cloth, or null
      const T = this.table, dx = Math.cos(yaw), dy = Math.sin(yaw);
      let t0 = -Infinity, t1 = Infinity;
      for (const [p, d, lim] of [[x, dx, T.L2], [y, dy, T.W2]]) {
        if (Math.abs(d) < 1e-9) { if (Math.abs(p) >= lim) return null; continue; }
        let a = (-lim - p) / d, b = (lim - p) / d; if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      }
      t0 = Math.max(t0, 0.3);
      if (t1 <= t0) return null;
      const t = (t0 + t1) / 2;
      return [x + dx * t, y + dy * t];
    }
    hfov() { const cam = this.camera; return 2 * Math.atan(Math.tan(cam.fov * Math.PI / 360) * cam.aspect); }
    walkerAt(x, y) { const w = this.walk; return !!w && Math.hypot(x - w.x, y - w.y) < 0.25; }
    coneAt(x, y) {           // is (x,y) on the view cone drawn on the map?
      const w = this.walk; if (!w) return false;
      const d = Math.hypot(x - w.x, y - w.y); if (d < 0.1 || d > 1.9) return false;
      let da = Math.atan2(y - w.y, x - w.x) - w.yaw; da = Math.atan2(Math.sin(da), Math.cos(da));
      return Math.abs(da) < this.hfov() / 2 + 0.15;
    }
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
      // standing (z = 1): eye 0.87 m; zoomed in: leaning over the table (same lean with or without a fixed point)
      const w = this.walk, h = this.walkEyeH();
      let lean = (1 - this.z) * 0.6;
      if (w.focus) {         // keep facing the fixed point and look right at it
        const fx = w.focus[0] - w.x, fy = w.focus[1] - w.y, dist = Math.hypot(fx, fy);
        if (dist > 1e-3) w.yaw = Math.atan2(fy, fx);
        lean = Math.min(lean, Math.max(0, dist - 0.35));
        const dx = Math.cos(w.yaw), dy = Math.sin(w.yaw);
        return { eye: [w.x + dx * lean, w.y + dy * lean, h], target: [w.focus[0], w.focus[1], w.focus[2] || 0] };
      }
      const ahead = 0.55 + 1.0 * this.z;   // no fixed point: look at the cloth ahead
      const dx = Math.cos(w.yaw), dy = Math.sin(w.yaw), ex = w.x + dx * lean, ey = w.y + dy * lean;
      return { eye: [ex, ey, h], target: [ex + dx * ahead, ey + dy * ahead, 0] };
    }
    // the cue held by the walking player: on the line of sight, butt at the hip, tip forward and a little down
    heldCue() {
      const w = this.walk, h = this.walkEyeH(), lean = (1 - this.z) * 0.6;
      const dx = Math.cos(w.yaw), dy = Math.sin(w.yaw), rx = dy, ry = -dx;           // forward, right
      const bx = w.x + dx * (lean - 0.15) + rx * 0, by = w.y + dy * (lean - 0.15) + ry * 0, bz = Math.max(0.06, h - 0.6);
      const tz = Math.max(0.04, bz - 0.22), horiz = Math.sqrt(Math.max(0, C.CUE_LEN * C.CUE_LEN - (bz - tz) ** 2));
      const tip = [bx + dx * horiz, by + dy * horiz, tz];
      const L = C.CUE_LEN, toButt = [(bx - tip[0]) / L, (by - tip[1]) / L, (bz - tz) / L];
      return { tip, toButt };
    }
    walkerOnMap() {
      if (!this.walk) return null;
      const { X, Y, room } = this.walkArea();
      return { x: this.walk.x, y: this.walk.y, yaw: this.walk.yaw, focus: this.walk.focus, hfov: this.hfov(), area: { X: X + room, Y: Y + room } };
    }

    // high view from behind the shot line that shows the whole table (farther back in a narrow window)
    overviewPose(aim) {
      const dx = Math.cos(aim), dy = Math.sin(aim), k = Math.max(1, 1.45 / (this.camera.aspect || 1.6));
      return { eye: [-dx * 2.6 * k, -dy * 2.6 * k, 2.2 * k], target: [-dx * 0.2, -dy * 0.2, 0] };
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
      // after the shot: pull back to an overview of the whole table (from the shooter's side) while the balls roll
      const over = !!st.overview && !this.walk;
      if (over) pose = this.overviewPose(st.aimAngle);
      if (this._wasOver !== undefined && over !== this._wasOver && this.lastPose) this.trans = { from: this.lastPose, t: 0, dur: over ? 0.9 : 0.6 };
      this._wasOver = over;
      // standing up / going back to the shot: blend the camera over ~0.4 s instead of jumping
      const walking = !!this.walk;
      if (this._wasWalking !== undefined && walking !== this._wasWalking && this.lastPose) this.trans = { from: this.lastPose, t: 0 };
      this._wasWalking = walking;
      if (pose && walking && this.lastPose && !this.trans) {
        const k = 1 - Math.exp(-dt * 14), L = this.lastPose, mix = (a, b) => a.map((v, i) => v + (b[i] - v) * k);
        pose = { eye: mix(L.eye, pose.eye), target: mix(L.target, pose.target) };
      }
      if (pose && this.trans) {
        this.trans.t += dt / (this.trans.dur || 0.4);
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
      // balls dropping into a pocket get their own copy of the mesh (the real ball may already be re-spotted)
      this.dropMeshes = this.dropMeshes || new Map();
      const live = new Set(st.drops || []);
      for (const [d, dm] of this.dropMeshes) if (!live.has(d)) { this.scene.remove(dm); this.dropMeshes.delete(d); }
      for (const d of live) {
        let dm = this.dropMeshes.get(d);
        if (!dm) {
          const src = this.ballMesh(d.b);
          dm = new THREE.Mesh(src.geometry, src.material); dm.castShadow = true; dm.quaternion.copy(src.quaternion);
          this.scene.add(dm); this.dropMeshes.set(d, dm);
        }
        dm.position.set(d.x, d.y, d.z);
        const sp = Math.hypot(d.vx, d.vy);          // rolling as it goes
        if (sp > 1e-4) dm.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(-d.vy / sp, d.vx / sp, 0), sp * dt / R));
      }
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
      // while walking the cue "walks with you": carried see-through at your side, pointing the way you look
      this.cue.visible = !!st.showCue && cue.onTable;
      const ghost = !!this.walk;
      if (this.cue.userData.ghost !== ghost) {
        this.cue.userData.ghost = ghost;
        this.cue.traverse((o) => { if (o.material) { o.material.transparent = ghost; o.material.opacity = ghost ? 0.35 : 1; o.material.depthWrite = !ghost; o.castShadow = !ghost; o.material.needsUpdate = true; } });
      }
      if (this.cue.visible && this.walk) {
        const W = this.heldCue();
        this.cue.position.set(...W.tip);
        this.cue.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...W.toButt));
      } else if (this.cue.visible) {
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
        // tip contact point on the ball surface: n = (a·r + b·u − c·e) / R; the cap's axis points along n,
        // with the cross arms along the cue's right / up directions
        if (st.showTipMark) {
          const n = new THREE.Vector3(...[0, 1, 2].map(i => a * rv[i] + b * uv[i] - c * e[i])).normalize();
          const right = new THREE.Vector3(...rv); right.addScaledVector(n, -right.dot(n)).normalize();
          const zAx = new THREE.Vector3().crossVectors(right, n);
          this.tipMark.setRotationFromMatrix(new THREE.Matrix4().makeBasis(right, n, zAx));
          this.tipMark.position.set(cue.x, cue.y, R);
          this.tipMark.visible = true;
        }
      }
      if (!(this.cue.visible && !this.walk && st.showTipMark)) this.tipMark.visible = false;
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
        } else if (A.bounce && st.showBounce !== false) {    // cue ball off the cushion (part of the cue-ball path)
          setLine(this.obLine, [A.gx, A.gy, z, A.bounce.x, A.bounce.y, z]);
        }
        if (st.cbPath) {
          const pts = []; for (let i = 0; i < st.cbPath.length; i += 2) pts.push(st.cbPath[i], st.cbPath[i + 1], z + 0.0005);
          setLine(this.cbLine, pts);
        }
      }
      if (st.drawMain !== false) this.renderer.render(this.scene, this.camera);
      if (st.eclipse) this.renderEclipse(st);
    }

    // ---- "eclipse" inset: the exact view along the cue line --------------------------------------------------
    // An orthographic camera sits at the cue-ball centre, at ball height, looking along the line to the ghost ball.
    // The cue ball itself is hidden and drawn as an outline instead, so you see how much of the object ball it
    // covers (the ball fraction): full ball, ¾, ½, ¼ ... A thin cut shows a sliver of overlap.
    renderEclipse(st) {
      const el = st.eclipse, A = st.aim, cue = st.cue;
      if (!this.ecl) {
        const r = new THREE.WebGLRenderer({ canvas: el.gl, antialias: true });
        r.outputEncoding = THREE.sRGBEncoding; r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
        this.ecl = { r, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0.001, 6) };
        this.ecl.cam.up.set(0, 0, 1);
      }
      const { r, cam } = this.ecl, rect = el.gl.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      const W = Math.max(1, Math.round(rect.width * dpr)), H = Math.max(1, Math.round(rect.height * dpr));
      if (el.gl.width !== W || el.gl.height !== H) { r.setPixelRatio(1); r.setSize(W, H, false); el.ov.width = W; el.ov.height = H; }
      const g = el.ov.getContext('2d'); g.clearRect(0, 0, W, H);
      const ok = A && A.hit && A.hit.type === 'ball' && cue.onTable;
      el.box.classList.toggle('empty', !ok);
      if (!ok) { r.clear(); el.label.textContent = 'no ball on the aim line'; return; }
      const dx = A.gx - cue.x, dy = A.gy - cue.y, dl = Math.hypot(dx, dy) || 1, ux = dx / dl, uy = dy / dl;
      const halfH = 2.1 * R, halfW = halfH * W / H;
      cam.left = -halfW; cam.right = halfW; cam.top = halfH; cam.bottom = -halfH; cam.updateProjectionMatrix();
      cam.position.set(cue.x, cue.y, R); cam.lookAt(cue.x + ux, cue.y + uy, R);
      // hide what would block or clutter the view
      const cbMesh = this.balls.get(cue.id);
      const hide = [cbMesh, this.cue, this.ghost, this.tipMark, this.aimLine, this.obLine, this.cbLine, this.tanLine].filter(Boolean);
      const was = hide.map(o => o.visible); hide.forEach(o => { o.visible = false; });
      r.render(this.scene, cam);
      hide.forEach((o, i) => { o.visible = was[i]; });
      // cue-ball silhouette (radius R, centred on the line) and the overlap as a number
      const k = H / (2 * halfH), cx = W / 2, cy = H / 2, rad = R * k;
      g.fillStyle = 'rgba(255,255,255,0.18)'; g.beginPath(); g.arc(cx, cy, rad, 0, Math.PI * 2); g.fill();
      g.setLineDash([5 * dpr, 4 * dpr]); g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 1.5 * dpr;
      g.beginPath(); g.arc(cx, cy, rad, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1 * dpr;
      g.beginPath(); g.moveTo(cx, cy - rad * 1.25); g.lineTo(cx, cy + rad * 1.25); g.stroke();
      const ob = A.ob, off = Math.abs((ob.x - cue.x) * -uy + (ob.y - cue.y) * ux);   // OB centre's distance from the line
      const frac = Math.max(0, 1 - off / (2 * R));
      el.label.textContent = frac > 0.995 ? 'full ball' : frac < 0.005 ? 'no overlap' : `${Math.round(frac * 100)}% ball (cut ${Math.abs(A.cutDeg).toFixed(0)}°)`;
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
    return wear(cv, num);
  }

  // Light wear, different for every ball (but the same each time): faint blue chalk smudges (more on the cue
  // ball), tiny scuffs and specks, and a slightly uneven surface. Also returns a roughness map in which the
  // marks are duller than the polished surface. Everything is kept very faint.
  function wear(cv, num) {
    const W = cv.width, H = cv.height, g = cv.getContext('2d');
    const rc = document.createElement('canvas'); rc.width = W / 4; rc.height = H / 4;
    const r = rc.getContext('2d'), k = 1 / 4;
    r.fillStyle = 'rgb(105,105,105)'; r.fillRect(0, 0, rc.width, rc.height);          // base roughness ≈ 0.41
    let seed = 1234567 + num * 7919;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    // round-looking spot on the sphere: stretch it in u toward the poles (equirectangular map)
    const spot = (ctx, x, y, ang, s, fill) => {
      const theta = Math.max(0.25, Math.sin(y / H * Math.PI)), ry = ang / Math.PI * H * s, rx = ry / theta;
      for (const dx of [0, -W * s, W * s]) {
        const gr = ctx.createRadialGradient(x * s + dx, y * s, 0, x * s + dx, y * s, ry);
        gr.addColorStop(0, fill); gr.addColorStop(1, fill.replace(/[\d.]+\)$/, '0)'));
        ctx.save(); ctx.translate(x * s + dx, y * s); ctx.scale(rx / ry, 1); ctx.translate(-(x * s + dx), -y * s);
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x * s + dx, y * s, ry, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
    };
    // 1) slightly uneven surface
    for (let i = 0; i < 260; i++) {
      const x = rnd() * W, y = (0.05 + 0.9 * rnd()) * H, a = 0.03 + rnd() * 0.08;
      spot(g, x, y, a, 1, rnd() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)');
    }
    // 2) chalk smudges (cue chalk is blue): several on the cue ball, a few on object balls
    const nChalk = num === 0 ? 9 : 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < nChalk; i++) {
      const x = rnd() * W, y = (0.12 + 0.76 * rnd()) * H, a = 0.035 + rnd() * (num === 0 ? 0.06 : 0.045);
      const alpha = (num === 0 ? 0.62 : 0.46) * (0.6 + 0.4 * rnd());
      spot(g, x, y, a, 1, `rgba(60,110,200,${alpha.toFixed(3)})`);
      for (let j = 0; j < 3; j++) spot(g, x + (rnd() - 0.5) * a * H * 0.8, y + (rnd() - 0.5) * a * H * 0.8, a * 0.35, 1, `rgba(45,95,190,${(alpha * 0.9).toFixed(3)})`);
      spot(r, x, y, a * 1.2, k, 'rgba(200,200,200,0.8)');                           // chalk is dull
    }
    // 3) scuffs: short faint curved scratches, and specks
    g.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      const x = rnd() * W, y = (0.1 + 0.8 * rnd()) * H, len = 6 + rnd() * 26, ang = rnd() * Math.PI, bend = (rnd() - 0.5) * 10;
      const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len * 0.6;
      const light = rnd() < 0.6;
      g.strokeStyle = light ? `rgba(255,255,255,${(0.22 + rnd() * 0.15).toFixed(3)})` : `rgba(40,40,40,${(0.18 + rnd() * 0.12).toFixed(3)})`;
      g.lineWidth = 1.2 + rnd() * 1.4;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo((x + ex) / 2 + bend, (y + ey) / 2 - bend, ex, ey); g.stroke();
      r.strokeStyle = 'rgba(190,190,190,0.6)'; r.lineWidth = 1;
      r.beginPath(); r.moveTo(x * k, y * k); r.lineTo(ex * k, ey * k); r.stroke();
    }
    for (let i = 0; i < 70; i++) {
      const x = rnd() * W, y = (0.06 + 0.88 * rnd()) * H;
      g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.25)' : 'rgba(60,60,60,0.2)';
      g.fillRect(x, y, 2, 2);
    }
    return { color: cv, rough: rc };
  }

  QB.CueView = CueView;
})();
