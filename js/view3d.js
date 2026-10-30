// Qball — 3D "cue's-eye" view (three.js r149, vendored in js/vendor).
// World axes match the physics: x along the table, y across, z up. Units: meters.
window.QB = window.QB || {};

(function () {
  const C = QB.C, R = C.BALL_R;
  const NOSE_H = C.CUSHION_H_FRAC * 2 * R;   // cushion nose height
  const RAIL_H = NOSE_H + 0.0005;            // rail cap flush with the cushion top (the cue must clear it)
  const WALK_ROOM = 1.0;                     // Walk mode: how far from the rails the player may walk (m)

  // ---- one cushion: sweep the cross-section along its face (jaw, nose, jaw), with filleted corners ----
  function cushionProfile() {
    // (d, z): d = distance behind the nose line (into the cushion), z = height. Goes from the cloth up the face,
    // round the nose, and back along the top to the rail.
    const pts = [[0.012, 0], [0.0055, 0.016], [0.0012, NOSE_H - 0.006]];
    const rc = 0.0045, cx = rc * 0.95, cz = RAIL_H - rc;              // rounded nose
    for (let k = 0; k <= 8; k++) { const a = Math.PI * (1.05 - 0.55 * k / 8); pts.push([cx + rc * Math.cos(a), cz + rc * Math.sin(a)]); }
    pts.push([0.02, RAIL_H], [C.CUSHION_W, RAIL_H]);
    return pts;
  }
  function filletPolyline(pts, radii) {      // radii[i] for the inner corners
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], p = pts[i], b = pts[i + 1], rf = radii[i] || 0;
      const u1 = norm2(p.x - a.x, p.y - a.y), u2 = norm2(b.x - p.x, b.y - p.y);
      const th = Math.acos(Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1])));
      if (rf <= 0 || th < 1e-3) { out.push(p); continue; }
      const t = Math.min(rf * Math.tan(th / 2), 0.45 * Math.hypot(p.x - a.x, p.y - a.y), 0.45 * Math.hypot(b.x - p.x, b.y - p.y));
      const s0 = { x: p.x - u1[0] * t, y: p.y - u1[1] * t }, s1 = { x: p.x + u2[0] * t, y: p.y + u2[1] * t };
      const n = 8;                            // quadratic Bezier through the corner ≈ the fillet arc
      for (let k = 0; k <= n; k++) { const q = k / n, w0 = (1 - q) * (1 - q), w1 = 2 * q * (1 - q), w2 = q * q;
        out.push({ x: w0 * s0.x + w1 * p.x + w2 * s1.x, y: w0 * s0.y + w1 * p.y + w2 * s1.y }); }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
  function norm2(x, y) { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; }
  function offsetPolyline(pts, d, inwardSign) {   // miter offset toward the cushion body
    const segN = [];
    for (let i = 0; i < pts.length - 1; i++) { const u = norm2(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y); segN.push([-u[1] * inwardSign, u[0] * inwardSign]); }
    return pts.map((p, i) => {
      const n0 = segN[Math.max(0, i - 1)], n1 = segN[Math.min(segN.length - 1, i)];
      const mx = n0[0] + n1[0], my = n0[1] + n1[1], k = 1 + n0[0] * n1[0] + n0[1] * n1[1];
      const f = k > 0.2 ? d / k : d / 0.2;
      return { x: p.x + mx * f, y: p.y + my * f };
    });
  }
  function cushionMesh(cu, mat) {
    const [Ja, Pa, Pb, Jb] = cu.pts;
    const isSide = (p) => Math.abs(p.x) < 0.25 && Math.abs(Math.abs(p.y) - 0) > 0.1 && Math.abs(p.x) < C.SIDE_MOUTH;
    const face = filletPolyline([Ja, Pa, Pb, Jb], [0, isSide(Pa) ? 0.016 : 0.007, isSide(Pb) ? 0.016 : 0.007, 0]);
    // which side is "inside the cushion": the cushion quad's orientation decides
    const area = (Pa.x - Ja.x) * (Pb.y - Ja.y) - (Pb.x - Ja.x) * (Pa.y - Ja.y) + (Pb.x - Ja.x) * (Jb.y - Ja.y) - (Jb.x - Ja.x) * (Pb.y - Ja.y);
    const inward = area > 0 ? 1 : -1;
    const prof = cushionProfile(), N = face.length, K = prof.length;
    const pos = [], uv = [], idx = [];
    const along = [0]; for (let i = 1; i < N; i++) along.push(along[i - 1] + Math.hypot(face[i].x - face[i - 1].x, face[i].y - face[i - 1].y));
    let vacc = 0;
    for (let k = 0; k < K; k++) {
      if (k) vacc += Math.hypot(prof[k][0] - prof[k - 1][0], prof[k][1] - prof[k - 1][1]);
      const row = offsetPolyline(face, prof[k][0], inward);
      for (let i = 0; i < N; i++) { pos.push(row[i].x, row[i].y, prof[k][1]); uv.push(along[i], vacc); }
    }
    for (let k = 0; k < K - 1; k++) for (let i = 0; i < N - 1; i++) {
      const a = k * N + i, b = a + 1, c = a + N, d = c + 1;
      if (inward > 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
    }
    // end caps at the pocket ends: profile row ends + the back corner at the cloth
    for (const end of [0, N - 1]) {
      const base = pos.length / 3, back = offsetPolyline(face, C.CUSHION_W, inward)[end];
      pos.push(back.x, back.y, 0); uv.push(0, 0);
      for (let k = 0; k < K - 1; k++) { const a = k * N + end, b = (k + 1) * N + end; if ((end === 0) === (inward > 0)) idx.push(base, b, a); else idx.push(base, a, b); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true;
    return m;
  }

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

      // cushions with a real profile, swept along jaw - nose - jaw: the nose sits at NOSE_H (where the physics
      // has it), the face below it slants back under the nose, and the top edge is rounded. The corners where the
      // nose turns into a jaw are curved (more at the side pockets). Visual only: the physics keeps straight jaws.
      for (const cu of T.cushions) S.add(cushionMesh(cu, cushMat));

      // rails: outer rectangle minus (cushion back line rectangle ∪ pocket circles)
      const X1 = T.L2 + c + rw, Y1 = T.W2 + c + rw, X0 = T.L2 + c, Y0 = T.W2 + c;
      // The outside of the table is rounded: corners with radius RC seen from above, and a rounded top edge (a
      // bull-nose of radius RN) all round. The flat rail top stops RN short of the outer edge, where the bull-nose
      // takes over; a skirt below it carries the outer face down to the apron.
      const RC = 0.07, RN = 0.022;
      const rrPts = (hw, hh, rc, step = 0.05) => {        // rounded rectangle, counter-clockwise, densely subdivided
        const pts = [], seg = (ax, ay, bx, by) => { const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step)); for (let i = 0; i < n; i++) pts.push(new THREE.Vector2(ax + (bx - ax) * i / n, ay + (by - ay) * i / n)); };
        const arc = (cx, cy, a0) => { for (let k = 0; k < 10; k++) { const a = a0 + (Math.PI / 2) * k / 10; pts.push(new THREE.Vector2(cx + rc * Math.cos(a), cy + rc * Math.sin(a))); } };
        seg(-hw + rc, -hh, hw - rc, -hh); arc(hw - rc, -hh + rc, -Math.PI / 2);
        seg(hw, -hh + rc, hw, hh - rc); arc(hw - rc, hh - rc, 0);
        seg(hw - rc, hh, -hw + rc, hh); arc(-hw + rc, hh - rc, Math.PI / 2);
        seg(-hw, hh - rc, -hw, -hh + rc); arc(-hw + rc, -hh + rc, Math.PI);
        return pts;
      };
      const outer = new THREE.Shape(rrPts(X1 - RN, Y1 - RN, RC - RN));
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
      // skirt: the outer face of the rails, from the apron up to where the bull-nose starts
      const skirtSh = new THREE.Shape(rrPts(X1, Y1, RC)); skirtSh.holes.push(new THREE.Path(rrPts(X1 - RN, Y1 - RN, RC - RN).reverse()));
      const skirtGeo = new THREE.ExtrudeGeometry(skirtSh, { depth: RAIL_H - RN + 0.08, bevelEnabled: false, curveSegments: 4 }); skirtGeo.translate(0, 0, -0.08);
      const skirt = new THREE.Mesh(skirtGeo, woodMat); skirt.receiveShadow = true; S.add(skirt);
      // bull-nose: a rounded wooden edge swept all round the top outer edge (grain along it)
      const nosePath = new THREE.CatmullRomCurve3(rrPts(X1 - RN, Y1 - RN, RC - RN, 0.03).map(v => new THREE.Vector3(v.x, v.y, RAIL_H - RN)), true);
      const noseLen = nosePath.getLength();
      const noseTex = tex(QB.Tex.wood(), noseLen, 0.25);
      const bull = new THREE.Mesh(new THREE.TubeGeometry(nosePath, 600, RN, 14, true),
        new THREE.MeshPhysicalMaterial({ map: noseTex, roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.25 }));
      bull.receiveShadow = true; S.add(bull);
      // apron (the table's wooden body) below the rail, rounded like the rails; its top sits just below the pocket cups
      const apronMat = new THREE.MeshPhysicalMaterial({ map: tex(QB.Tex.wood(), 1, 4), color: 0xb89a88, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.35 });
      const apronGeo = new THREE.ExtrudeGeometry(new THREE.Shape(rrPts(X1 - 0.012, Y1 - 0.012, RC - 0.012)),
        { depth: 0.156, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 4, curveSegments: 4 });
      const apron = new THREE.Mesh(apronGeo, apronMat);
      apron.position.z = -0.255 + 0.012; apron.castShadow = true; S.add(apron);
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
      const floorMat = new THREE.MeshStandardMaterial({ map: tex(QB.Tex.floorboards(), 4.4, 3.4), color: 0x9a8a7c, roughness: 0.6 });
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(8.8, 6.8), floorMat);          // exactly the room (walls at ±4.4, ±3.4)
      floor.position.z = FLOOR; floor.receiveShadow = true; S.add(floor);
      const rugMat = new THREE.MeshStandardMaterial({ map: tex(QB.Tex.rug()), roughness: 1 });
      const rugMesh = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 3.34), rugMat);
      rugMesh.position.z = FLOOR + 0.004; rugMesh.receiveShadow = true; S.add(rugMesh);
      const RX = 4.4, RY = 3.4, WALL_H = 3.0, WAIN = 0.85;             // room half-size (walls), wall height, panelling height
      const paper = tex(QB.Tex.wallpaper(), 1, 1), panelTex = tex(QB.Tex.wood(), 1, 1);
      // a wall: wallpaper above wood panelling, chair rail and baseboard; `hole` = a door opening {a, b, top}
      // (local x range along the wall and height). The planes face local −y; each wall is turned to face the table.
      const trimMat = new THREE.MeshStandardMaterial({ color: 0x3a1d0e, roughness: 0.5 });
      const wall = (cx, cy, len, rot, hole) => {
        const grp = new THREE.Group(); grp.position.set(cx, cy, FLOOR); grp.rotation.z = rot;
        const L0 = -len / 2, L1 = len / 2;
        const panel = (x0, x1, z0, z1, src, tile, zRef, color, rough) => {     // texture stays continuous across pieces
          const t = src.clone(); t.needsUpdate = true;
          t.repeat.set((x1 - x0) / tile, (z1 - z0) / tile); t.offset.set((x0 - L0) / tile, (z0 - zRef) / tile);
          const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), new THREE.MeshStandardMaterial({ map: t, color, roughness: rough }));
          m.rotation.x = Math.PI / 2; m.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2); grp.add(m);
        };
        const spans = hole ? [[L0, hole.a], [hole.b, L1]] : [[L0, L1]];
        for (const [x0, x1] of spans) {
          panel(x0, x1, WAIN, WALL_H, paper, 0.5, WAIN, 0xffffff, 0.9);
          panel(x0, x1, 0, WAIN, panelTex, 1.0, 0, 0x8a6e5c, 0.55);
          const rail = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.04, 0.06), trimMat); rail.position.set((x0 + x1) / 2, -0.02, WAIN); grp.add(rail);
          const base = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.03, 0.12), trimMat); base.position.set((x0 + x1) / 2, -0.015, 0.06); grp.add(base);
        }
        if (hole) panel(hole.a, hole.b, hole.top, WALL_H, paper, 0.5, WAIN, 0xffffff, 0.9);   // above the door
        S.add(grp);
        return grp;
      };
      // a panelled door, hinged on the corner side and standing ~10 cm ajar into the room; a dim hallway behind it
      const door = (grp, hole) => {
        const w = hole.b - hole.a, h = hole.top;
        const hall = new THREE.Mesh(new THREE.BoxGeometry(w + 1.4, 1.8, 2.6), new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide }));
        hall.position.set((hole.a + hole.b) / 2, 0.9 + 0.002, 1.3 - 0.002); grp.add(hall);  // dark space behind the wall (local +y)
        const cas = (sx, sz, x, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.035, sz), trimMat); m.position.set(x, -0.017, z); grp.add(m); };
        cas(0.08, h + 0.08, hole.a - 0.04, (h + 0.08) / 2); cas(0.08, h + 0.08, hole.b + 0.04, (h + 0.08) / 2); cas(w + 0.16, 0.08, (hole.a + hole.b) / 2, h + 0.04);
        const dTex = panelTex.clone(); dTex.needsUpdate = true; dTex.center.set(0.5, 0.5); dTex.rotation = Math.PI / 2; dTex.repeat.set(2.0, 0.9);
        const dMat = new THREE.MeshStandardMaterial({ map: dTex, color: 0xa07e64, roughness: 0.5 });
        const pivot = new THREE.Group(); pivot.position.set(hole.b - 0.005, -0.02, 0); grp.add(pivot);
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(w - 0.01, 0.04, h - 0.01), dMat); leaf.position.set(-(w - 0.01) / 2, 0, (h - 0.01) / 2); pivot.add(leaf);
        for (const side of [-1, 1]) {                                                    // raised panels on both faces
          for (const [col, row] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
            const pw = (w - 0.3) / 2, ph = row ? 0.95 : 0.75, px = -(w - 0.01) + 0.11 + col * (pw + 0.07) + pw / 2, pz = row ? 1.0 + 0.1 + ph / 2 : 0.12 + ph / 2;
            const pn = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.012, ph), dMat); pn.position.set(px, side * 0.024, pz); pivot.add(pn);
          }
        }
        const brass = new THREE.MeshStandardMaterial({ color: 0xc9a24a, roughness: 0.3, metalness: 0.8 });
        for (const side of [-1, 1]) {                                                    // knobs on both sides
          const knob = new THREE.Mesh(new THREE.SphereGeometry(0.028, 16, 12), brass); knob.position.set(-(w - 0.01) + 0.07, side * 0.065, 1.0); pivot.add(knob);
          const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.012, 0.045, 10), brass); neck.position.set(-(w - 0.01) + 0.07, side * 0.035, 1.0); pivot.add(neck);
        }
        pivot.rotation.z = Math.asin(0.10 / (w - 0.01));                                  // ajar: the latch edge 10 cm into the room
        // door stop: a brass spring stop with a rubber tip on the corner wall's baseboard, where the door would
        // otherwise hit the wall (it catches the door at about 100° open)
        const sw = w - 0.01, stopY = -sw * Math.sin(100 * Math.PI / 180) - 0.02, wallX = RX;   // (this wall's local x = world x)
        const rubber = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
        const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.008, 16), brass);
        plate.rotation.z = Math.PI / 2; plate.position.set(wallX - 0.034, stopY, 0.085); grp.add(plate);   // on the baseboard
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.008, 0.07, 10), brass);
        rod.rotation.z = Math.PI / 2; rod.position.set(wallX - 0.034 - 0.035, stopY, 0.085); grp.add(rod);
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.014, 14, 10), rubber);
        tip.scale.set(1.2, 1, 1); tip.position.set(wallX - 0.034 - 0.075, stopY, 0.085); grp.add(tip);
      };
      wall(0, -RY, 2 * RX, Math.PI);
      // the door: in the corner next to Böcklin's painting (north wall, near the foot-end corner)
      const dHole = { a: RX - 1.15, b: RX - 0.25, top: 2.05 };
      door(wall(0, RY, 2 * RX, 0, dHole), dHole);
      wall(-RX, 0, 2 * RY, Math.PI / 2); wall(RX, 0, 2 * RY, -Math.PI / 2);
      this.buildArt(FLOOR, RX, RY);
    }

    // ---- paintings in gilded frames, two per wall (js/art.js; see tools/embed-art.js) ----
    buildArt(FLOOR, RX, RY) {
      const art = QB.ART || []; if (!art.length) return;
      const byId = Object.fromEntries(art.map(a => [a.id, a]));
      const pick = (...ids) => ids.map(id => byId[id]).find(Boolean);
      // the wall behind the foot of the table (the one you face when shooting from the head) holds Rainer
      // Oberhänsli's paintings when they are in assets/art (oberhaensli-*.jpg); until then, two classics
      const ober = art.filter(a => /^oberhaensli/i.test(a.id));
      const slots = [
        { a: ober[0] || pick('klee-senecio'), x: RX, y: -1.2 }, { a: ober[1] || pick('hodler-genfersee'), x: RX, y: 1.2 },
        { a: pick('hodler-thunersee'), x: -RX, y: 1.2 }, { a: pick('hodler-niesen'), x: -RX, y: -1.2 },
        { a: pick('anker-dorfschule'), x: -1.6, y: RY }, { a: pick('boecklin-toteninsel'), x: 1.6, y: RY },
        { a: pick('vallotton-grasse'), x: 1.6, y: -RY }, { a: pick('giacometti-maloja'), x: -1.6, y: -RY },
      ];
      // gilded frame: molding with a carved (bump-mapped) ornament, corner rosettes, a gold inner bead
      const orn = document.createElement('canvas'); orn.width = 128; orn.height = 128;
      { const g = orn.getContext('2d'); g.fillStyle = '#808080'; g.fillRect(0, 0, 128, 128);
        for (let i = 0; i < 4; i++) { const cx = 16 + i * 32;
          g.strokeStyle = '#e8e8e8'; g.lineWidth = 5; g.beginPath(); g.arc(cx, 64, 13, 0, Math.PI * 2); g.stroke();       // scrolls
          g.fillStyle = '#f4f4f4'; g.beginPath(); g.arc(cx, 64, 5, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#d0d0d0'; g.beginPath(); g.arc(cx + 16, 30, 4, 0, Math.PI * 2); g.fill(); g.beginPath(); g.arc(cx + 16, 98, 4, 0, Math.PI * 2); g.fill(); }
        g.fillStyle = '#383838'; g.fillRect(0, 0, 128, 6); g.fillRect(0, 122, 128, 6); }
      const bump = new THREE.CanvasTexture(orn); bump.wrapS = bump.wrapT = THREE.RepeatWrapping; bump.repeat.set(14, 14);
      const gold = new THREE.MeshStandardMaterial({ color: 0xd4a640, roughness: 0.38, metalness: 0.55, bumpMap: bump, bumpScale: 0.004, emissive: 0x2a1a04 });
      const goldPlain = new THREE.MeshStandardMaterial({ color: 0xe0b85a, roughness: 0.3, metalness: 0.6, emissive: 0x2a1a04 });
      const rect = (w, h) => new THREE.Shape([new THREE.Vector2(-w / 2, -h / 2), new THREE.Vector2(w / 2, -h / 2), new THREE.Vector2(w / 2, h / 2), new THREE.Vector2(-w / 2, h / 2)]);
      const ring = (wo, ho, wi, hi, depth, bevel, mat) => {
        const sh = rect(wo, ho); sh.holes.push(rect(wi, hi));
        const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 1 });
        return new THREE.Mesh(g, mat);
      };
      for (const s of slots) {
        if (!s.a) continue;
        const img = new Image();
        const tex = new THREE.Texture(img); tex.encoding = THREE.sRGBEncoding; tex.anisotropy = 4;
        img.onload = () => {
          tex.needsUpdate = true;
          const asp = img.width / img.height, H = asp >= 1 ? 1.0 / asp : 1.0, W = asp >= 1 ? 1.0 : asp;   // long side 1 m
          const grp = new THREE.Group(); grp.up.set(0, 0, 1);
          const picMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, emissiveMap: tex, emissive: 0x2c2c2c });  // as if lit by a picture light
          grp.add(new THREE.Mesh(new THREE.PlaneGeometry(W, H), picMat));
          grp.userData.art = s.a;                    // (double-click: look at this painting)
          const fw = 0.085;
          const outer = ring(W + 2 * fw, H + 2 * fw, W + 0.01, H + 0.01, 0.03, 0.014, gold); outer.position.z = -0.02; grp.add(outer);
          const bead = ring(W + 0.02, H + 0.02, W - 0.004, H - 0.004, 0.012, 0.004, goldPlain); bead.position.z = -0.004; grp.add(bead);
          for (const [cx, cy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            const ro = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 10), goldPlain);
            ro.scale.set(1, 1, 0.55); ro.position.set(cx * (W / 2 + fw * 0.55), cy * (H / 2 + fw * 0.55), 0.038); grp.add(ro);
          }
          // brass plaque: artist · title · year
          const pc = document.createElement('canvas'); pc.width = 512; pc.height = 96;
          const pg = pc.getContext('2d'); pg.fillStyle = '#b8964a'; pg.fillRect(0, 0, 512, 96);
          pg.strokeStyle = '#7a5f26'; pg.lineWidth = 6; pg.strokeRect(3, 3, 506, 90);
          pg.fillStyle = '#2b1d08'; pg.textAlign = 'center'; pg.font = '600 30px Georgia, serif'; pg.fillText(s.a.artist || '', 256, 40);
          pg.font = 'italic 24px Georgia, serif'; pg.fillText(`${s.a.title || ''}${s.a.year ? ', ' + s.a.year : ''}`, 256, 74);
          const pt = new THREE.CanvasTexture(pc); pt.encoding = THREE.sRGBEncoding;
          const plaque = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.056), new THREE.MeshStandardMaterial({ map: pt, roughness: 0.4, metalness: 0.4, emissiveMap: pt, emissive: 0x222222 }));
          plaque.position.set(0, -H / 2 - fw - 0.07, 0.005); grp.add(plaque);
          // hang it: centre 1.80 m above the floor (well clear of the panelling below), facing into the room
          const z = FLOOR + 1.80, off = 0.045;
          const px = Math.abs(s.x) === RX ? s.x - Math.sign(s.x) * off : s.x, py = Math.abs(s.y) === RY ? s.y - Math.sign(s.y) * off : s.y;
          grp.position.set(px, py, z);
          grp.lookAt(Math.abs(s.x) === RX ? 0 : px, Math.abs(s.y) === RY ? 0 : py, z);
          this.scene.add(grp);
        };
        img.src = s.a.data;
      }
    }

    buildLights() {
      const S = this.scene;
      // soft fill for the whole room, plus a ceiling light so every wall is lit
      S.add(new THREE.HemisphereLight(0xfff4e0, 0x3a2c20, 0.5));
      const room = new THREE.PointLight(0xffe8c8, 0.55, 0, 1); room.position.set(0, 0, 2.15); S.add(room);
      // the billiard lamp: three shades on a bar, ~1 m above the cloth (WPA: at least 40"). Each shade holds a
      // spotlight that casts its own soft shadow, so every ball gets the faint triple shadow of a real table.
      // simple lighting (the "realistic shadows" setting off): one steady light from straight above
      const key = new THREE.DirectionalLight(0xfff2dc, 1.1);
      key.position.set(0.2, 0.15, 3); key.target.position.set(0, 0, 0);
      key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
      const sc = key.shadow.camera; sc.left = -2.0; sc.right = 2.0; sc.top = 1.35; sc.bottom = -1.35; sc.near = 1; sc.far = 4.5;
      key.shadow.bias = -0.0005; key.shadow.radius = 3;
      S.add(key); S.add(key.target);
      this.simpleLights = [key];
      for (const x of [-0.8, 0, 0.8]) { const l = new THREE.PointLight(0xfff0d0, 0.6, 3.0, 2); l.position.set(x, 0, 1.0); S.add(l); this.simpleLights.push(l); }
      this.lampLights = [];
      const lampZ = 1.0, xs = [-0.32, 0, 0.32].map(f => f * C.TABLE_L);
      // (the fixture is hidden when the camera is above it, e.g. in the overview after a shot, so it never blocks the table)
      const L = this.lampGroup = new THREE.Group(); S.add(L);
      const shadeOut = new THREE.MeshStandardMaterial({ color: 0x1f4a33, roughness: 0.35, metalness: 0.3, side: THREE.DoubleSide });
      const shadeIn = new THREE.MeshBasicMaterial({ color: 0xfff1cf, side: THREE.BackSide });
      const brass = new THREE.MeshStandardMaterial({ color: 0xb08a3c, roughness: 0.35, metalness: 0.8 });
      const prof = []; for (let k = 0; k <= 12; k++) { const t = k / 12; prof.push(new THREE.Vector2(0.03 + 0.17 * Math.sin((1 - t) * Math.PI / 2), 0.16 * t)); }
      const domeOut = new THREE.LatheGeometry(prof, 32), domeIn = new THREE.LatheGeometry(prof.map(v => new THREE.Vector2(v.x * 0.97, v.y)), 32);
      for (const x of xs) {
        for (const [geo, mat] of [[domeOut, shadeOut], [domeIn, shadeIn]]) {
          const m = new THREE.Mesh(geo, mat); m.rotation.x = Math.PI / 2; m.position.set(x, 0, lampZ); L.add(m);
        }
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfffbe8 }));
        bulb.position.set(x, 0, lampZ + 0.07); L.add(bulb);
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.08, 8), brass);
        stem.rotation.x = Math.PI / 2; stem.position.set(x, 0, lampZ + 0.2); L.add(stem);
        const sp = new THREE.SpotLight(0xfff1d6, 0.62, 0, 1.1, 0.65, 1);
        sp.position.set(x, 0, lampZ + 0.06); sp.target.position.set(x, 0, 0);
        sp.castShadow = true; sp.shadow.mapSize.set(1024, 1024); sp.shadow.bias = -0.0006; sp.shadow.radius = 4;
        sp.shadow.camera.near = 0.3; sp.shadow.camera.far = 2.5;
        S.add(sp); S.add(sp.target); this.lampLights.push(sp);
      }
      const barLen = xs[2] - xs[0] + 0.5;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(barLen, 0.045, 0.045), brass); bar.position.set(0, 0, lampZ + 0.24); L.add(bar);
      for (const x of [-barLen / 2 + 0.05, barLen / 2 - 0.05]) {          // hanging rods up to the ceiling
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1.0, 6), brass);
        rod.rotation.x = Math.PI / 2; rod.position.set(x, 0, lampZ + 0.24 + 0.5); L.add(rod);
      }
    }

    // realistic: the three lamp spotlights each cast shadows; otherwise one light from above (cheaper)
    setRealisticShadows(on) {
      for (const l of this.lampLights || []) l.visible = !!on;
      for (const l of this.simpleLights || []) l.visible = !on;
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
      // (arms reach 11 mm, past the 6.5 mm cue tip, so the ends show even with the tip right at the ball)
      const TH = 0.42, cw = 512, ch = 256, cvm = document.createElement('canvas'); cvm.width = cw; cvm.height = ch;
      const gm = cvm.getContext('2d');
      gm.fillStyle = 'rgba(230,30,35,0.85)';
      gm.fillRect(0, 0, cw, Math.max(1, 0.0003 / R / TH * ch));                              // joins the arms at the centre
      for (let y = 0; y < (0.011 / R) / TH * ch; y++) {                                        // four arms, 11 mm each
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
    get dist() { return 0.62 + (this.aimBack !== undefined ? this.aimBack : 0.22) + 0.70 * this.z; }    // aimBack: extra set-back (default 22 cm; test mode slider)
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
    // turning with the view cone: the point you look at swings round you at the same distance and height,
    // so the up/down viewing angle stays the same (and that point stays fixed while you walk)
    setYaw(yaw) {
      const w = this.walk; if (!w) return;
      yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
      if (!w.focus) { const t = this.walkPose().target; w.focus = [t[0], t[1], t[2]]; }   // what you look at now
      const d = Math.max(0.4, Math.hypot(w.focus[0] - w.x, w.focus[1] - w.y));
      w.focus = [w.x + Math.cos(yaw) * d, w.y + Math.sin(yaw) * d, w.focus[2]];
      w.yaw = yaw;
    }
    // the fixed point itself can be dragged on the map (e.g. onto a ball); it stays on the cloth
    focusAt(x, y) { const w = this.walk; return !!(w && w.focus) && Math.hypot(x - w.focus[0], y - w.focus[1]) < 0.08; }
    setFocus(x, y, z = 0, free = false) {      // free: any point in the room (walls, paintings ...), else on the cloth
      const w = this.walk; if (!w) return;
      const T = this.table;
      w.focus = free ? [x, y, z] : [Math.max(-T.L2, Math.min(T.L2, x)), Math.max(-T.W2, Math.min(T.W2, y)), z];
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
        let art = null; for (let q = o; q && !art; q = q.parent) art = q.userData && q.userData.art;
        if (art) { const c = new THREE.Vector3(); o.parent.getWorldPosition(c); return { x: c.x, y: c.y, z: c.z, ball: null, art, free: true }; }   // a painting: its centre
        if (Math.abs(p.x) <= T.L2 + 0.25 && Math.abs(p.y) <= T.W2 + 0.25 && p.z > -0.02 && p.z < 0.06)   // cloth, cushion or rail
          return { x: Math.max(-T.L2, Math.min(T.L2, p.x)), y: Math.max(-T.W2, Math.min(T.W2, p.y)), z: 0, ball: null };
        return { x: p.x, y: p.y, z: p.z, ball: null, free: true };                            // walls, floor, rug, lamp, legs ...
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
    // overview after the shot: high up behind the shot, on the cue line `back` metres behind where the cue ball was
    // (near the end of the cue), looking across the table. back / height can be tuned in test mode.
    overviewPose(aim, from, back = 1.8, height = 0.9) {
      const dx = Math.cos(aim), dy = Math.sin(aim), k = Math.max(1, 1.45 / (this.camera.aspect || 1.6)) * Math.max(0.8, C.TABLE_L / 2.54);
      const fx = from ? from.x : 0, fy = from ? from.y : 0;
      return { eye: [fx - dx * back * k, fy - dy * back * k, height * k],
        target: [0.5 * (fx + dx * 1.0), 0.5 * (fy + dy * 1.0), 0] };    // between the shot line and the table centre
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
      if (over) pose = st.shotCue ? this.overviewPose(st.shotCue.aim, st.shotCue, st.ovBack, st.ovHeight) : this.overviewPose(st.aimAngle);
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
        if (this.lampGroup) this.lampGroup.visible = pose.eye[2] < 1.3;
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
      this.cue.visible = (!!st.showCue && cue.onTable) || !!st.shotCue;   // after the shot the cue stays where it was
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
        // the cue at the ball (or, while the balls roll, where the shot was played: st.shotCue)
        const Q = st.shotCue || { x: cue.x, y: cue.y, aim: st.aimAngle, elev: st.elev || 0, tipX: st.tipX, tipY: st.tipY, pull: st.pull || 0 };
        const th = Q.elev || 0, ce = Math.cos(th), se = Math.sin(th);
        const dx = Math.cos(Q.aim), dy = Math.sin(Q.aim);
        let tx = Q.tipX, ty = Q.tipY; const rr = Math.hypot(tx, ty);
        if (rr > C.TIP_MAX) { tx *= C.TIP_MAX / rr; ty *= C.TIP_MAX / rr; }
        const a = tx * R, b = ty * R, c = R * Math.sqrt(Math.max(0, 1 - tx * tx - ty * ty));
        const e = [ce * dx, ce * dy, -se], rv = [dy, -dx, 0], uv = [se * dx, se * dy, ce];
        const gap = 0.006 + (Q.pull || 0);
        const P = [0, 1, 2].map(i => a * rv[i] + b * uv[i] - c * e[i] - gap * e[i]);
        this.cue.position.set(Q.x + P[0], Q.y + P[1], R + P[2]);
        this.cue.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-e[0], -e[1], -e[2]));
        // tip contact point on the ball surface: n = (a·r + b·u − c·e) / R; the cap's axis points along n,
        // with the cross arms along the cue's right / up directions
        if (st.showTipMark && !st.shotCue) {
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
