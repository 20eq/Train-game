'use strict';
/* ============================================================
   Bharat Rail Sim 3D — three.js renderer (fresh engine)
   World streaming-free static build per route + per-frame pose
   updates. Designed for the vendored three r152 module.
   ============================================================ */
class R3D {
  constructor(canvas) {
    this.canvas = canvas;
    const T = THREE;
    this.renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.scene = new T.Scene();
    this.camera = new T.PerspectiveCamera(62, 1, 0.5, 9000);
    this.hemi = new T.HemisphereLight(0xbfd6e8, 0x6a6f5a, 0.9);
    this.sun = new T.DirectionalLight(0xfff2dc, 1.6);
    this.sun.position.set(600, 900, 300);
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.moon = new T.DirectionalLight(0x9db4e8, 0);
    this.moon.position.set(-500, 700, -300);
    this.scene.add(this.moon);
    this._stars = this._mkStars();
    this._rain = null;
    this.trainGrp = new T.Group();
    this.scene.add(this.trainGrp);
    this._sigMats = {};
    this._onResize();
    window.addEventListener('resize', () => this._onResize());
  }
  _onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  mat(c, opts) { return new THREE.MeshLambertMaterial(Object.assign({ color: c }, opts || {})); }

  /* ================= world build ================= */
  build(route, path, lay, svc) {
    const T = THREE;
    this.route = route; this.p = path; this.lay = lay;
    this.theme = THEMES[route.theme] || THEMES.mumbai;
    if (this.world) { this.scene.remove(this.world); this.world.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
    this.world = new T.Group();
    this.scene.add(this.world);
    this._sky();

    /* ---------- terrain: one merged vertex-coloured mesh ---------- */
    const tf = this.tf = WB.makeTerrainFn(route, path);
    const step = path.L > 120000 ? 56 : 34, half = 760, across = 30;
    const nx = Math.floor(path.L / step) + 1, nz = across;
    const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3);
    const cLow = new T.Color(this.theme.ground), cSoil = new T.Color(this.theme.soil || this.theme.ground);
    const cHigh = new T.Color('#8e8676'), cGreen = new T.Color('#6f8757');
    const nilgiri = route.theme === 'nilgiri';
    for (let ix = 0; ix < nx; ix++) {
      const x = ix * step, y0 = path.ys[Math.min(path.N - 1, ix)];
      for (let iz = 0; iz < nz; iz++) {
        const z = (iz / (nz - 1) - 0.5) * 2 * half;
        const zc = z + (path.zs[Math.min(path.N - 1, ix)] || 0); /* follow the curve loosely */
        const h = tf(x, z);
        const k = (ix * nz + iz) * 3;
        pos[k] = x; pos[k + 1] = h; pos[k + 2] = zc;
        const t = clamp((h - y0) / 90, 0, 1);
        const c = cLow.clone().lerp(cSoil, 0.4 + 0.3 * Math.sin(x * 0.002 + z * 0.01) ** 2).lerp(cHigh, t * t).lerp(cGreen, nilgiri ? 0.45 * (1 - t) : 0.18 * (1 - t));
        col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
      }
    }
    const idx = [];
    for (let ix = 0; ix < nx - 1; ix++) for (let iz = 0; iz < nz - 1; iz++) {
      const a = ix * nz + iz, b = a + nz;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const tg = new T.BufferGeometry();
    tg.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    tg.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    tg.setIndex(idx); tg.computeVertexNormals();
    this.world.add(new T.Mesh(tg, new T.MeshLambertMaterial({ vertexColors: true })));

    /* ---------- track ---------- */
    this.world.add(this._ribbon(path, (m) => 0, 3.4, 0.24, this.theme.ballast || '#6d6a63'));   // ballast
    for (const s of [-0.72, 0.72]) this.world.add(this._ribbon(path, (m) => s, 0.14, 0.42, '#7c8087')); // rails
    this.world.add(this._sleepers(path, 0));
    for (const lp of lay.loops) {
      const off = (m) => WB.loopOffsetAt(lp, m) + 2.6 * Math.sign(WB.loopOffsetAt(lp, m) || 1);
      this.world.add(this._ribbon(path, off, 2.6, 0.2, this.theme.ballast || '#6d6a63'));
      for (const s of [-0.62, 0.62]) this.world.add(this._ribbon(path, (m) => off(m) + s, 0.12, 0.4, '#7c8087'));
      this.world.add(this._sleepers(path, off));
    }
    /* ---------- structures ---------- */
    for (const pf of lay.platforms) this._platform(pf);
    for (const tu of lay.tunnels) this._tunnel(tu, path);
    for (const vd of lay.viaducts) this._viaduct(vd, path);
    for (const cx of lay.crossings) this._crossing(cx, path);
    this._poles(lay.poles, path, route);
    this._props(lay, path);
    this._nameboards(lay.platforms, path);
    this._signals(svc);
  }

  _sky() {
    const T = THREE, sky = this.theme.sky;
    const geo = new T.SphereGeometry(8200, 24, 12);
    const map = {};
    const frag = ['dayTop', 'dayBot', 'duskTop', 'duskBot', 'nightTop', 'nightBot'].map((k) => { map[k] = new T.Color(sky[k]); return ''; }).join('');
    const m = new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false,
      uniforms: { dayTop: { value: map.dayTop }, dayBot: { value: map.dayBot }, duskTop: { value: map.duskTop }, duskBot: { value: map.duskBot }, nightTop: { value: map.nightTop }, nightBot: { value: map.nightBot }, uDusk: { value: 0 }, uNight: { value: 0 } },
      vertexShader: 'varying vec3 vp; void main(){ vp = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vp; uniform vec3 dayTop,dayBot,duskTop,duskBot,nightTop,nightBot; uniform float uDusk,uNight;
        void main(){ float h = clamp(vp.y/8200.0,0.0,1.0);
        vec3 day = mix(dayBot,dayTop,pow(h,0.6)); vec3 dusk = mix(duskBot,duskTop,pow(h,0.6)); vec3 ni = mix(nightBot,nightTop,pow(h,0.6));
        vec3 c = mix(mix(day,dusk,uDusk),ni,uNight);
        c = mix(c, vec3(0.015,0.02,0.03), clamp(-vp.y/1200.0,0.0,1.0)); /* below horizon: darken to ground tone */
        gl_FragColor = vec4(c,1.0); }`,
    });
    this.skyDome = new T.Mesh(geo, m);
    this.scene.add(this.skyDome);
    this.scene.fog = new THREE.Fog(0xffffff, 900, 7000);
  }

  _mkStars() {
    const T = THREE, n = 900, p = new Float32Array(n * 3);
    const r = mulberry32(99);
    for (let i = 0; i < n; i++) {
      const th = r() * TAU, ph = Math.acos(r() * 0.9), R = 7800;
      p[i * 3] = R * Math.sin(ph) * Math.cos(th); p[i * 3 + 1] = R * Math.cos(ph) + 200; p[i * 3 + 2] = R * Math.sin(ph) * Math.sin(th);
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(p, 3));
    const pts = new T.Points(g, new T.PointsMaterial({ color: 0xcfd8ff, size: 7, sizeAttenuation: false, transparent: true, opacity: 0 }));
    this.scene.add(pts);
    return pts;
  }

  /* flat ribbon following the path at lateral offset fn(m), width w, height y */
  _ribbon(path, offFn, w, y, color) {
    const T = THREE, n = Math.floor(path.L / 12) + 1;
    const pos = new Float32Array(n * 2 * 3), idx = [];
    for (let i = 0; i < n; i++) {
      const m = Math.min(path.L, i * 12);
      const q = WB.posAt(path, m, 0), o = offFn(m);
      /* perpendicular in xz plane */
      pos[i * 6] = q.x; pos[i * 6 + 1] = q.y + y; pos[i * 6 + 2] = q.z + (o - w / 2);
      pos[i * 6 + 3] = q.x; pos[i * 6 + 4] = q.y + y; pos[i * 6 + 5] = q.z + (o + w / 2);
      if (i < n - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    return new T.Mesh(g, this.mat(color));
  }

  _sleepers(path, offFn) {
    const T = THREE, n = Math.floor(path.L / 1.6);
    const g = new T.BoxGeometry(0.24, 0.16, 2.5);
    const im = new T.InstancedMesh(g, this.mat('#5b5148'), n);
    const M = new T.Matrix4(), q = new T.Quaternion(), up = new T.Vector3(0, 1, 0), s = new T.Vector3(1, 1, 1), v = new T.Vector3();
    for (let i = 0; i < n; i++) {
      const m = i * 2.4, o = typeof offFn === 'function' ? offFn(m) : (offFn || 0);
      const p = WB.posAt(path, m, o);
      v.set(p.x, p.y + 0.12, p.z);
      q.setFromAxisAngle(up, -p.yaw);
      M.compose(v, q, s); im.setMatrixAt(i, M);
    }
    return im;
  }

  _platform(pf) {
    const T = THREE, q = WB.posAt(this.p, pf.km * KM, 0);
    const g = new T.Group();
    const h = 0.9;
    const slab = new T.Mesh(new T.BoxGeometry(pf.len, h, 7), this.mat('#9a958c'));
    slab.position.set(q.x, q.y + h / 2, q.z + 5.4); g.add(slab);
    const edge = new T.Mesh(new T.BoxGeometry(pf.len, 0.1, 0.5), this.mat('#d8d4c8'));
    edge.position.set(q.x, q.y + h + 0.05, q.z + 5.4 - 3.2); g.add(edge);
    if (pf.len > 90) {
      const roof = new T.Mesh(new T.BoxGeometry(Math.min(pf.len * 0.55, 130), 0.3, 6), this.mat('#b33a2f'));
      roof.position.set(q.x, q.y + 4.4, q.z + 6.2); g.add(roof);
      for (const dx of [-Math.min(pf.len * 0.24, 55), 0, Math.min(pf.len * 0.24, 55)]) {
        const post = new T.Mesh(new T.BoxGeometry(0.3, 3.6, 0.3), this.mat('#4c5158'));
        post.position.set(q.x + dx, q.y + 2.2, q.z + 6.2); g.add(post);
      }
    }
    /* waiting commuters on the platform */
    const rng = mulberry32(Math.floor(pf.km));
    const n = Math.max(4, Math.floor(pf.len / 16));
    const body = new T.InstancedMesh(new T.CylinderGeometry(0.18, 0.22, 1.1, 5), this.mat('#cfcabd'), n);
    const heads = new T.InstancedMesh(new T.SphereGeometry(0.15, 6, 6), this.mat('#b98866'), n);
    const M2 = new T.Matrix4(), s2 = new T.Vector3(1, 1, 1), idq = new T.Quaternion(), v2 = new T.Vector3();
    for (let i = 0; i < n; i++) {
      const x = q.x + (rng() - 0.5) * pf.len * 0.9;
      const z = q.z + 4.4 + rng() * 2.6;
      v2.set(x, q.y + 0.9 + 0.55, z); M2.compose(v2, idq, s2); body.setMatrixAt(i, M2);
      v2.set(x + (rng() - 0.5) * 0.1, q.y + 0.9 + 1.28, z); M2.compose(v2, idq, s2); heads.setMatrixAt(i, M2);
    }
    this._crowdColors(body, n, rng);
    this.world.add(body, heads);
    this.world.add(g);
  }

  _nameboards(platforms, path) {
    const T = THREE, cv = document.createElement('canvas');
    cv.width = 512; cv.height = 128;
    const ctx = cv.getContext('2d');
    for (const pf of platforms) {
      const q = WB.posAt(path, pf.km * KM, 11);
      ctx.clearRect(0, 0, 512, 128);
      ctx.fillStyle = '#11304f'; ctx.fillRect(0, 0, 512, 128);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 54px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(pf.n.slice(0, 20), 256, 58);
      ctx.font = '34px sans-serif'; ctx.fillStyle = '#ffd76e';
      ctx.fillText((pf.loc || '').slice(0, 18), 256, 106);
      const tex = new T.CanvasTexture(cv);
      const board = new T.Mesh(new T.PlaneGeometry(7, 1.75), new T.MeshBasicMaterial({ map: tex, side: T.DoubleSide }));
      board.position.set(q.x, q.y + 3.6, q.z);
      const post = new T.Mesh(new T.BoxGeometry(0.22, 3.8, 0.22), this.mat('#3c4148'));
      post.position.set(q.x, q.y + 1.9, q.z);
      this.world.add(board, post);
    }
  }

  _tunnel(tu, path) {
    const T = THREE, n = Math.floor((tu.b - tu.a) / 8) + 2;
    const pos = [], idx = [];
    const R = 4.4;
    for (let i = 0; i < n; i++) {
      const m = tu.a + Math.min(tu.b - tu.a, i * 8);
      const q = WB.posAt(path, m, 0);
      for (let a = 0; a < 10; a++) {
        const th = Math.PI * (a / 9);
        pos.push(q.x, q.y + Math.sin(th) * R + 0.4, q.z + Math.cos(th) * R * 0.85 + 2.6 * Math.cos(th) * 0 + 0);
      }
      if (i < n - 1) {
        const b0 = i * 10;
        for (let a = 0; a < 9; a++) idx.push(b0 + a, b0 + a + 10, b0 + a + 1, b0 + a + 1, b0 + a + 10, b0 + a + 11);
      }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    this.world.add(new T.Mesh(g, new T.MeshLambertMaterial({ color: '#4a423c', side: T.BackSide })));
    for (const e of [tu.a, tu.b]) {
      const q = WB.posAt(path, e, 0);
      const portal = new T.Mesh(new T.BoxGeometry(2.2, 10.4, 15), this.mat('#6a625a'));
      portal.position.set(q.x, q.y + 3.4, q.z + 1.6);
      this.world.add(portal);
    }
  }

  _viaduct(vd, path) {
    const T = THREE, n = Math.floor((vd.b - vd.a) / 12) + 2;
    const pos = new Float32Array(n * 2 * 3), idx = [];
    for (let i = 0; i < n; i++) {
      const m = vd.a + Math.min(vd.b - vd.a, i * 12);
      const q = WB.posAt(path, m, 0);
      pos[i * 6] = q.x; pos[i * 6 + 1] = q.y - 1.4; pos[i * 6 + 2] = q.z - 2.6;
      pos[i * 6 + 3] = q.x; pos[i * 6 + 4] = q.y - 1.4; pos[i * 6 + 5] = q.z + 2.6;
      if (i < n - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    this.world.add(new T.Mesh(g, this.mat('#b8b2a6')));
    for (let m = vd.a + 14; m < vd.b; m += 28) {
      const q = WB.posAt(path, m, 0);
      const tfh = this.tf ? this.tf(q.x, q.z) : q.y - 20;
      const hgt = Math.max(2, q.y - 1.4 - tfh);
      const pier = new T.Mesh(new T.BoxGeometry(2.4, hgt, 2.4), this.mat('#a8a296'));
      pier.position.set(q.x, q.y - 1.4 - hgt / 2, q.z);
      this.world.add(pier);
    }
  }

  _crossing(cx, path) {
    const T = THREE, q = WB.posAt(path, cx.km, 0);
    const road = new T.Mesh(new T.BoxGeometry(7, 0.14, 13), this.mat('#5c5c58'));
    road.position.set(q.x, q.y + 0.22, q.z);
    this.world.add(road);
    for (const s of [-8, 8]) {
      const post = new T.Mesh(new T.BoxGeometry(0.25, 2.6, 0.25), this.mat('#c8b428'));
      post.position.set(q.x + s, q.y + 1.3, q.z + 6.4);
      this.world.add(post);
    }
  }

  _poles(list, path, route) {
    const T = THREE, n = list.length;
    const im = new T.InstancedMesh(new T.BoxGeometry(0.26, 7, 0.26), this.mat('#585c60'), n);
    const M = new T.Matrix4(), q4 = new T.Quaternion(), up = new T.Vector3(0, 1, 0), s1 = new T.Vector3(1, 1, 1), v = new T.Vector3();
    const pts = [];
    list.forEach((m, i) => {
      const p = WB.posAt(path, m, route.double ? -4.6 : -4.2);
      v.set(p.x, p.y + 3.5, p.z);
      q4.setFromAxisAngle(up, -p.yaw);
      M.compose(v, q4, s1); im.setMatrixAt(i, M);
      pts.push(new T.Vector3(p.x, p.y + 6.6, p.z));
    });
    this.world.add(im);
    if (pts.length > 1) this.world.add(new T.Line(new T.BufferGeometry().setFromPoints(pts), new T.LineBasicMaterial({ color: 0x30343a })));
  }

  _props(lay, path) {
    const T = THREE, trees = lay.props.filter((p) => p.kind === 'tree'), blds = lay.props.filter((p) => p.kind === 'building');
    const M = new T.Matrix4(), q4 = new T.Quaternion(), up = new T.Vector3(0, 1, 0), s1 = new T.Vector3(), v = new T.Vector3();
    if (trees.length) {
      const trunk = new T.InstancedMesh(new T.CylinderGeometry(0.22, 0.3, 2.6, 5), this.mat('#6b4a34'), trees.length);
      const crown = new T.InstancedMesh(new T.ConeGeometry(2.1, 5.4, 7), this.mat('#3f6b34'), trees.length);
      const palm = ['mumbai', 'mumbai_cr', 'chennai', 'konkan'].includes(this.route.theme);
      trees.forEach((p, i) => {
        const q = WB.posAt(path, p.m, p.z);
        const h = this.tf ? this.tf(q.x, q.z) : q.y;
        v.set(q.x, h + 1.3, q.z); q4.setFromAxisAngle(up, p.rot); s1.set(1, 1, 1);
        M.compose(v, q4, s1); trunk.setMatrixAt(i, M);
        v.set(q.x, h + (palm ? 4.4 : 4.6), q.z); s1.set(p.s, p.s * (palm ? 0.8 : 1), p.s);
        M.compose(v, q4, s1); crown.setMatrixAt(i, M);
      });
      s1.set(1, 1, 1);
      this.world.add(trunk, crown);
    }
    if (blds.length) {
      const im = new T.InstancedMesh(new T.BoxGeometry(9, 7, 9), new T.MeshLambertMaterial({ vertexColors: false, color: 0xb0a694 }), blds.length);
      blds.forEach((p, i) => {
        const q = WB.posAt(path, p.m, p.z);
        const h = this.tf ? this.tf(q.x, q.z) : q.y;
        v.set(q.x, h + 3.5 * p.s, q.z);
        q4.setFromAxisAngle(up, p.rot);
        s1.set(p.s, p.s * (0.7 + (p.s % 0.5)), p.s);
        M.compose(v, q4, s1); im.setMatrixAt(i, M);
      });
      this.world.add(im);
    }
    function routeIsPalm() { return ['mumbai', 'mumbai_cr', 'chennai', 'konkan'].includes(this.route && this.route.theme); }
  }

  _signals(svc) {
    /* visual signal posts at each box signal — aspect colour updated per frame */
    const T = THREE;
    this._sigMats = {};
    if (!this.boxSig) this.boxSig = null;
  }

  attachSignals(box) {
    /* build signal posts from the SignalBox (after Game created) */
    const T = THREE;
    this._sigPostGrp = new T.Group();
    this._sigMats = {};
    for (const sg of box.signals) {
      const q = WB.posAt(this.p, clamp(sg.km, 0, this.p.L), 0);
      const side = sg.track === 'far' ? -3.4 : 3.4;
      const g = new T.Group();
      const mast = new T.Mesh(new T.BoxGeometry(0.22, 4.6, 0.22), this.mat('#3a3f45'));
      mast.position.y = 2.3; g.add(mast);
      const head = new T.Mesh(new T.BoxGeometry(0.5, 1.5, 0.4), this.mat('#1c1f24'));
      head.position.y = 4.9; g.add(head);
      const lamp = new T.Mesh(new T.SphereGeometry(0.22, 8, 8), new T.MeshBasicMaterial({ color: 0x22cc66 }));
      lamp.position.set(0, 5.5, 0.24); g.add(lamp);
      g.position.set(q.x, q.y, q.z + side);
      this._sigPostGrp.add(g);
      this._sigMats[sg.id] = lamp.material;
    }
    this.world.add(this._sigPostGrp);
  }
  updateSignals(box) {
    for (const sg of box.signals) {
      const m = this._sigMats && this._sigMats[sg.id];
      if (!m) continue;
      m.color.setHex(sg.aspect === 'red' ? 0xff3226 : sg.aspect === 'yellow' ? 0xffb300 : sg.aspect === 'yellow2' ? 0xffe066 : 0x2adf6a);
    }
  }

  /* ================= trains ================= */
  _crowdColors(im, n, rng) {
    const cols = [0xd8d3c8, 0x9fb3c8, 0xc8a8b8, 0xb8c4a8, 0xe0d8c0, 0x8ea6b8, 0xd6c2a0, 0xc07870];
    for (let i = 0; i < n; i++) im.setColorAt(i, new THREE.Color(cols[Math.floor(rng() * cols.length)]));
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }

  /* packed-local door crowds: one instanced bunch per car (car-local, moves free) */
  _carCrowd(car, def, rng, dense) {
    const T = THREE, doors = 4;
    const n = Math.max(3, Math.round(doors * (dense ? 2.2 : 1.2)));
    const body = new T.InstancedMesh(new T.CylinderGeometry(0.17, 0.2, 1.05, 5), this.mat('#cfcabd'), n);
    const head = new T.InstancedMesh(new T.SphereGeometry(0.145, 6, 6), this.mat('#b98866'), n);
    const M = new T.Matrix4(), s = new T.Vector3(1, 1, 1), q = new T.Quaternion(), v = new T.Vector3();
    const fr = [0.17, 0.38, 0.62, 0.83];
    for (let i = 0; i < n; i++) {
      const cx = (fr[i % doors] + (rng() - 0.5) * 0.06 - 0.5) * def.cars[0].len;
      const side = (i % 2 ? 1 : -1) * (3.1 / 2 + 0.12);
      const y0 = 0.55 + rng() * 0.12;
      v.set(cx, y0 + 0.52, side + (rng() - 0.5) * 0.14);
      M.compose(v, q, s); body.setMatrixAt(i, M);
      v.set(cx + (rng() - 0.5) * 0.08, y0 + 1.22, side + (rng() - 0.5) * 0.1);
      M.compose(v, q, s); head.setMatrixAt(i, M);
    }
    this._crowdColors(body, n, rng);
    car.add(body, head);
  }

  buildTrain(def, isPlayer) {
    const T = THREE;
    const LIV = { wr_violet: ['#e9e2d2', '#5c3a8e'], cr_crimson: ['#8c2438', '#e8ddc0'], ch_green: ['#e9e2d2', '#1d6b4a'], kol_blue: ['#e9e2d2', '#2a4d9b'], memu: ['#e9e2d2', '#3a5fa8'], dmu: ['#b8c4cc', '#3a5fa8'], wdp4d: ['#d84b27', '#f5e9d8'], wdg4: ['#3a6ec2', '#f2c518'], wap7: ['#e8e6e0', '#c23b2e'], lhb: ['#41598f', '#dfe3e8'], icf: ['#7c2436', '#e8ddc0'], vb: ['#eceef2', '#1e3a8a'], nmr: ['#2b3d8f', '#e8c34a'], boxn: ['#8a6a4e', '#6a4e38'] };
    const grp = new T.Group();
    const cars = [];
    def.cars.forEach((c, i) => {
      const car = new T.Group();
      const [body, band] = LIV[c.livery] || ['#9aa0a6', '#d0d4d8'];
      const H = { dtc: 3.4, mc: 3.4, tc: 3.3, 'memu-m': 3.5, 'dmu-p': 3.5, 'loco-e': 3.9, 'loco-d': 4.0, wdg4: 4.1, steam: 3.2, tender: 2.6, ac1: 3.6, ac2: 3.6, ac3: 3.6, sl: 3.6, gs: 3.6, pc: 3.6, dq: 3.5, vb: 3.5, rack: 2.9, boxn: 3.0, flat: 1.6, tank: 3.2 }[c.k] || 3.4;
      const W = 3.1;
      const bm = new T.Mesh(new T.BoxGeometry(c.len, H, W), this.mat(body));
      bm.position.y = 1.5 + H / 2; car.add(bm);
      const bnd = new T.Mesh(new T.BoxGeometry(c.len * 1.001, H * 0.16, W + 0.04), this.mat(band));
      bnd.position.y = 1.5 + H * 0.3; car.add(bnd);
      for (const s of [-(W / 2 + 0.03), W / 2 + 0.03]) {
        const win = new T.Mesh(new T.BoxGeometry(c.len * 0.86, H * 0.22, 0.06), this.mat('#16202a'));
        win.position.set(0, 1.5 + H * 0.62, s); car.add(win);
      }
      for (const bx of [-c.len * 0.32, c.len * 0.32]) {
        const bog = new T.Mesh(new T.BoxGeometry(2.6, 0.7, W * 0.86), this.mat('#23262b'));
        bog.position.set(bx, 0.75, 0); car.add(bog);
      }
      if (c.panto || (def.pantoCars && c.k === 'mc')) {
        const pa = new T.Mesh(new T.BoxGeometry(1.6, 0.1, 0.12), this.mat('#2c2f34'));
        pa.position.y = 1.5 + H + 0.6; pa.rotation.z = 0.5; car.add(pa);
      }
      if (i === 0 && isPlayer) {
        const lamp = new T.Mesh(new T.SphereGeometry(0.26, 8, 8), new T.MeshBasicMaterial({ color: 0xfff3c2 }));
        lamp.position.set(c.len / 2 + 0.12, 2.3, 0); car.add(lamp);
        this.lampMesh = lamp;
        this.headlight = new T.SpotLight(0xfff0cc, 2.2, 190, 0.42, 0.5, 1.2);
        this.headlight.position.set(0, 3.2, 0);
        car.add(this.headlight);
        car.add(this.headlight.target);
        this.headlight.target.position.set(60, 0, 0);
      }
      grp.add(car);
      cars.push(car);
    });
    if (def.cls === 'EMU') {
      const rng = mulberry32(1234 + def.cars.length * 7);
      cars.forEach((car, i) => this._carCrowd(car, def, rng, isPlayer || rng() > 0.35));
    }
    this.trainGrp.add(grp);
    const handle = { grp, cars };
    if (isPlayer) this.playerHandle = handle;
    return handle;
  }
  removeTrain(handle) {
    this.trainGrp.remove(handle.grp);
    handle.cars.forEach((c) => c.traverse((o) => { if (o.geometry) o.geometry.dispose(); }));
  }

  /* place all train visuals from game state */
  updateTrainVisuals(game, handles) {
    for (const tr of game.trains) {
      const h = handles.get(tr);
      if (!h) continue;
      const hidden = tr.track === 'far' && false;
      tr._carIdx = tr._carIdx || 0;
      h.cars.forEach((car, i) => {
        const pose = WB.carPose(this.p, tr.def, tr.s, i);
        car.position.set(pose.x, pose.y - 1.5 + 1.5, pose.z);
        car.rotation.y = -pose.yaw;
        car.visible = !(tr.track === 'gone');
      });
      h.grp.visible = tr.track !== 'gone';
    }
  }

  /* ================= environment per frame ================= */
  setCabView(inCab) {
    /* no interior is modelled: hide the lead car's exterior in cab view */
    if (this.lampMesh) this.lampMesh.visible = !inCab;
    if (this.playerHandle) this.playerHandle.cars[0].visible = !inCab;
  }

  setDayNight(tod /* hours 0-24 */) {
    const T = THREE;
    const ang = ((tod - 6) / 24) * TAU; /* 6h sunrise east */
    const elev = Math.sin(ang);
    this.sun.position.set(Math.cos(ang) * 900, Math.max(-100, elev * 1000), 350);
    const day = clamp(elev * 1.6 + 0.25, 0, 1);
    const dusk = clamp(1 - Math.abs(elev) * 3.2, 0, 1);
    this.skyDome.material.uniforms.uDusk.value = clamp(dusk * 1.3, 0, 1);
    this.skyDome.material.uniforms.uNight.value = clamp(1 - elev * 5 - 0.2, 0, 1);
    this.sun.intensity = 1.65 * day;
    this.sun.color.setHSL(0.09 + 0.04 * day, 0.6, 0.6 + 0.3 * day);
    this.hemi.intensity = 0.25 + 0.75 * day;
    this.moon.intensity = clamp(1 - day * 3, 0, 1) * 0.22;
    this.hemi.color.setHex(day > 0.5 ? 0xbfd6e8 : 0x36405e);
    this._stars.material.opacity = clamp(1 - day * 2.2, 0, 0.9);
    const fogC = new T.Color().setHSL(0.58, 0.25, 0.16 + 0.62 * day);
    this.scene.fog.color = fogC;
    this.renderer.setClearColor(fogC);
    this._day = day;
  }
  setWeather(rain) {
    const T = THREE;
    if (rain > 0 && !this._rain) {
      const n = 2400, p = new Float32Array(n * 3), r = mulberry32(7);
      for (let i = 0; i < n; i++) { p[i * 3] = (r() - 0.5) * 160; p[i * 3 + 1] = r() * 60; p[i * 3 + 2] = (r() - 0.5) * 160; }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(p, 3));
      this._rain = new T.Points(g, new T.PointsMaterial({ color: 0xa8c0d8, size: 0.14, transparent: true, opacity: 0.7 }));
      this.scene.add(this._rain);
    }
    if (this._rain) this._rain.visible = rain > 0;
    this._rainAmt = rain;
  }
  animateRain(dt, camPos) {
    if (!this._rain || !this._rain.visible) return;
    const p = this._rain.geometry.attributes.position;
    const fall = 42 * dt;
    for (let i = 0; i < p.count; i++) {
      let y = p.getY(i) - fall;
      if (y < 0) y += 60;
      p.setY(i, y);
    }
    p.needsUpdate = true;
    this._rain.position.set(camPos.x, camPos.y - 10, camPos.z);
    this.scene.fog.far = 7000 - 4300 * (this._rainAmt || 0);
  }

  render(camera) { this.renderer.render(this.scene, camera || this.camera); }
}
