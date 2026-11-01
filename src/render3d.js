'use strict';
/* ============================================================
   Bharat Rail Sim 3D — three.js renderer (fresh engine)
   World streaming-free static build per route + per-frame pose
   updates. Designed for the vendored three r152 module.
   ============================================================ */
function theme_water(th) { return (th && th.sea) || (th && th.river && '#3a6f86'); }

class R3D {
  constructor(canvas) {
    this.canvas = canvas;
    const T = THREE;
    this.renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.scene = new T.Scene();
    this.camera = new T.PerspectiveCamera(62, 1, 0.5, 9000);
    this.hemi = new T.HemisphereLight(0xbfd6e8, 0x7a7458, 0.55);
    this.sun = new T.DirectionalLight(0xfff2dc, 1.35);
    this.sun.position.set(600, 900, 300);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.near = 100; sc.far = 2600; sc.left = -450; sc.right = 450; sc.top = 450; sc.bottom = -450;
    this.sun.shadow.bias = -0.0004;
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
    this.buildCab();
    this.scene.add(this.camera); /* camera children (cab) must be in the graph to render */
  }
  _onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  mat(c, opts) { return new THREE.MeshLambertMaterial(Object.assign({ color: c }, opts || {})); }

  mergeGeos(geos) {
    const pos = [], norm = [], uv = [], idx = [];
    let off = 0;
    for (const g of geos) {
      const p = g.getAttribute('position'), n = g.getAttribute('normal'), u = g.getAttribute('uv'), ix = g.getIndex();
      for (let i = 0; i < p.count; i++) {
        pos.push(p.getX(i), p.getY(i), p.getZ(i));
        norm.push(n.getX(i), n.getY(i), n.getZ(i));
        uv.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
      }
      for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + off);
      off += p.count;
    }
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g2.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
    g2.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g2.setIndex(idx);
    return g2;
  }

  bx(w, h, d, x, y, z) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; }

  /* one merged dark-detail geometry per car type: windows, door recesses,
     8 wheels, bogie detail, underframe, inter-car connectors */
  carDetailGeo(k, len, H, W) {
    const key = k + '|' + len + '|' + H;
    if (!this._detailGeo) this._detailGeo = {};
    if (this._detailGeo[key]) return this._detailGeo[key];
    const T = THREE, parts = [];
    const y0 = 1.5, winY = y0 + H * 0.62, winH = H * 0.24;
    const drive = k === 'dtc' || k === 'memu-d' || k === 'dmu-p';
    const x0 = -len / 2 + (drive ? 3.4 : 1.9), x1 = len / 2 - 1.9;
    for (const s of [1, -1]) {
      const z = s * (W / 2 + 0.035);
      for (let wx = x0 + 0.9; wx + 1.35 <= x1; wx += 2.15) parts.push(this.bx(1.35, winH, 0.06, wx + 0.67, winY, z));
      for (const dx of [len * 0.16, -len * 0.16]) parts.push(this.bx(1.15, H * 0.58, 0.05, dx, y0 + H * 0.30, z)); /* doors */
    }
    for (const bcx of [-len * 0.32, len * 0.32]) for (const ax of [-1.05, 1.05]) for (const s of [1, -1]) {
      const wg = new T.CylinderGeometry(0.42, 0.42, 0.2, 10);
      wg.rotateX(Math.PI / 2);
      wg.translate(bcx + ax, 0.48, s * 1.06);
      parts.push(wg);
    }
    for (const s of [1, -1]) parts.push(this.bx(0.7, 0.75, 1.6, s * (len / 2 + 0.1), y0 + 0.5, 0)); /* connectors */
    parts.push(this.bx(len * 0.52, 0.55, W * 0.58, 0, y0 + 0.42, 0));                            /* underframe gear */
    const g = this.mergeGeos(parts);
    this._detailGeo[key] = g;
    return g;
  }

  /* panto + roof equipment, merged, cached per car height */
  roofGeo(len, H, panto) {
    const key = 'roof' + len + '|' + H + (panto ? 'a' : 'b');
    if (!this._roofGeo) this._roofGeo = {};
    if (this._roofGeo[key]) return this._roofGeo[key];
    const parts = [this.bx(2.4, 0.3, 1.9, len * 0.18, 1.5 + H + 0.18, 0)]; /* AC/rectifier box */
    if (panto) {
      parts.push(this.bx(1.2, 0.08, 1.5, -len * 0.22, 1.5 + H + 0.25, 0));  /* base frame */
      parts.push(this.bx(1.45, 0.09, 0.1, -len * 0.22 + 0.5, 1.5 + H + 0.6, 0));  /* lower arm */
      parts.push(this.bx(1.45, 0.09, 0.1, -len * 0.22 - 0.45, 1.5 + H + 0.95, 0)); /* upper arm */
      parts.push(this.bx(0.18, 0.09, 1.6, -len * 0.22 - 1.05, 1.5 + H + 1.18, 0)); /* head + horns */
    }
    const g = this.mergeGeos(parts);
    this._roofGeo[key] = g;
    return g;
  }

  scaleUV(geo, su, sv) {
    const uv = geo.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    uv.needsUpdate = true;
    return geo;
  }

  loadTex(name, rx, ry) {
    const t = new THREE.TextureLoader().load('tex/' + name + '.jpg');
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx || 1, ry || 1);
    t.anisotropy = 8;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /* ================= world build ================= */
  build(route, path, lay, svc) {
    const T = THREE;
    this.route = route; this.p = path; this.lay = lay;
    this.theme = THEMES[route.theme] || THEMES.mumbai;
    if (theme_water(this.theme)) this._waterColor = theme_water(this.theme);
    if (this.world) { this.scene.remove(this.world); this.world.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
    this.world = new T.Group();
    this.scene.add(this.world);
    this._sky();

    /* ---------- terrain: one merged vertex-coloured mesh ---------- */
    const tf = this.tf = WB.makeTerrainFn(route, path);
    const fbmPatch = (a, b) => WB.fbm2(a, b); /* keep WB bound */
    const step = path.L > 120000 ? 56 : 34, half = 760, across = 30;
    const nx = Math.floor(path.L / step) + 1, nz = across;
    const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3);
    const cLow = new T.Color(this.theme.ground).multiplyScalar(0.8), cSoil = new T.Color(this.theme.soil || this.theme.ground).multiplyScalar(0.85);
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
        /* patchy grass/earth variation so the ground never reads as one flat plane */
        const patch = fbmPatch(x / 90 + z / 130, x / 47 - z / 71);
        c.lerp(cGreen, clamp(0.22 + patch * 0.5, 0, 0.72) * (1 - t * 0.7));
        c.multiplyScalar(0.86 + 0.28 * fbmPatch(x / 17 + 40, z / 23 - 15));
        col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
      }
    }
    const idx = [];
    for (let ix = 0; ix < nx - 1; ix++) for (let iz = 0; iz < nz - 1; iz++) {
      const a = ix * nz + iz, b = a + nz;
      idx.push(a, a + 1, b, a + 1, b + 1, b); /* counter-clockwise from above: faces up */
    }
    const uv = new Float32Array(nx * nz * 2);
    for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
      const k = (ix * nz + iz) * 2;
      uv[k] = (ix * step) / 7; uv[k + 1] = ((iz / (nz - 1)) * 2 * half) / 7;
    }
    const tg = new T.BufferGeometry();
    tg.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    tg.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    tg.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    tg.setIndex(idx); tg.computeVertexNormals();
    this.groundTex = this.loadTex('grass', 1, 1);
    const terrMesh = new T.Mesh(tg, new T.MeshLambertMaterial({ vertexColors: true, map: this.groundTex }));
    terrMesh.receiveShadow = true;
    this.world.add(terrMesh);

    /* distant skirts: coarse rows of the SAME terrain fn beyond the detailed strip
       (row 0 = the strip edge, so the seam is seamless by construction) */
    {
      const rows = [760, 1250, 1900, 2700, 3600, 4700];
      const xStep = Math.max(step * 6, 180);
      const nx2 = Math.floor(path.L / xStep) + 1;
      const sp = [], sc2 = [], si = [];
      const base = new T.Color(this.theme.ground).multiplyScalar(0.8), high2 = new T.Color('#857c6c');
      const hazeC = new T.Color('#aab6ae');
      const jit = fbm(hashStr(route.id + '-skirt'), 3);
      const VI = (ix, side, ri) => ix * 2 * rows.length + (side < 0 ? rows.length : 0) + ri; /* matches push order */
      for (let ix = 0; ix <= nx2; ix++) {
        const x = Math.min(path.L, ix * xStep);
        const zi = Math.min(path.N - 1, Math.round(x / path.DS));
        const zc = path.zs[zi] || 0, yc = path.ys[zi];
        for (const side of [1, -1]) {
          for (let ri = 0; ri < rows.length; ri++) {
            const lat = rows[ri];
            const h = tf(x, side * lat) + (ri ? jit(x / 900 + side * 3.7 + ri * 11.3) * 15 * ri : 0);
            sp.push(x, h, zc + side * lat);
            const c2 = base.clone().lerp(high2, clamp((h - yc) / 160, 0, 0.85));
            c2.lerp(hazeC, clamp((lat - 760) / 3000, 0, 1) * 0.6);
            sc2.push(c2.r, c2.g, c2.b);
          }
        }
      }
      for (let ix = 0; ix < nx2; ix++) {
        for (const side of [1, -1]) {
          for (let ri = 0; ri < rows.length - 1; ri++) {
            const a = VI(ix, side, ri), a2 = VI(ix, side, ri + 1);
            const b = VI(ix + 1, side, ri), b2 = VI(ix + 1, side, ri + 1);
            si.push(a, a2, b, a2, b2, b);
          }
        }
      }
      const sg = new T.BufferGeometry();
      sg.setAttribute('position', new T.Float32BufferAttribute(sp, 3));
      sg.setAttribute('color', new T.Float32BufferAttribute(sc2, 3));
      sg.setIndex(si); sg.computeVertexNormals();
      const skm = new T.Mesh(sg, new T.MeshLambertMaterial({ vertexColors: true }));
      skm.receiveShadow = true;
      this.world.add(skm);
    }

    /* endless under-plane: guarantees land everywhere the strip doesn't reach */
    {
      let eMin = Infinity;
      for (let i = 0; i < path.N; i += 8) eMin = Math.min(eMin, path.ys[i]);
      const pg = new T.PlaneGeometry(80000, 80000);
      pg.rotateX(-Math.PI / 2);
      const pgUv = pg.getAttribute('uv');
      for (let i = 0; i < pgUv.count; i++) pgUv.setXY(i, pgUv.getX(i) * 2500, pgUv.getY(i) * 2500);
      const pm = new T.Mesh(pg, new T.MeshLambertMaterial({ color: 0xcfd4c2, map: this.groundTex }));
      pm.receiveShadow = true;
      pm.position.set(path.L / 2, eMin - 30, 0);
      this.world.add(pm);
    }

    /* ---------- track ---------- */
    this.world.add(this._ribbon(path, (m) => 0, 5.6, 0.1, '#57534c'));                          // formation
this.ballastTex = this.loadTex('ballast', 1, 1);
    this.world.add(this._ribbon(path, (m) => 0, 3.4, 0.24, null, this.ballastTex));   // ballast
    for (const s of [-0.72, 0.72]) this.world.add(this._ribbon(path, (m) => s, 0.14, 0.42, '#7c8087')); // rails
    this.world.add(this._sleepers(path, 0));
    if (route.double) {
      /* second line for oncoming traffic */
      this.world.add(this._ribbon(path, (m) => -4.9, 3.2, 0.24, null, this.ballastTex));
      for (const s of [-5.58, -4.22]) this.world.add(this._ribbon(path, (m) => s, 0.13, 0.42, '#7c8087'));
      this.world.add(this._sleepers(path, (m) => -4.9));
    }
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
    this._skyline(route, path);
    this._clouds(route);
    this._water(lay.water || [], path);
    this._props(lay, path);
    this._kmPosts(lay.milestones, path);
    this._whistleBoards(lay, path);
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
        vec3 ground = vec3(0.16,0.17,0.14) * (0.25 + 0.75*day); /* hazy land tone below horizon */
        c = mix(c, ground, clamp(-vp.y/500.0,0.0,1.0));
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
  _ribbon(path, offFn, w, y, color, tex) {
    const T = THREE, n = Math.floor(path.L / 12) + 1;
    const pos = new Float32Array(n * 2 * 3), idx = [], uv = new Float32Array(n * 2 * 2);
    for (let i = 0; i < n; i++) {
      const m = Math.min(path.L, i * 12);
      const q = WB.posAt(path, m, 0), o = offFn(m);
      /* perpendicular in xz plane */
      pos[i * 6] = q.x; pos[i * 6 + 1] = q.y + y; pos[i * 6 + 2] = q.z + (o - w / 2);
      pos[i * 6 + 3] = q.x; pos[i * 6 + 4] = q.y + y; pos[i * 6 + 5] = q.z + (o + w / 2);
      uv[i * 4] = 0; uv[i * 4 + 1] = m / 2.5;
      uv[i * 4 + 2] = 1; uv[i * 4 + 3] = m / 2.5;
      if (i < n - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const material = tex ? new T.MeshLambertMaterial({ map: tex }) : this.mat(color);
    const mesh = new T.Mesh(g, material);
    mesh.receiveShadow = true;
    return mesh;
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
    const T = THREE, q = WB.posAt(this.p, pf.km, 0); /* pf.km is metres */
    const g = new T.Group();
    const h = 0.9;
    if (!this.concreteTex) this.concreteTex = this.loadTex('concrete', 1, 1);
    const slab = new T.Mesh(this.scaleUV(new T.BoxGeometry(pf.len, h, 7), pf.len / 2.5, 7 / 2.5), new T.MeshLambertMaterial({ color: 0xcfcabd, map: this.concreteTex }));
    slab.castShadow = true; slab.receiveShadow = true;
    slab.position.set(q.x, q.y + h / 2, q.z + 5.4); g.add(slab);
    const edge = new T.Mesh(new T.BoxGeometry(pf.len, 0.1, 0.5), this.mat('#d8d4c8'));
    edge.position.set(q.x, q.y + h + 0.05, q.z + 5.4 - 3.2); g.add(edge);
    /* iconic yellow safety line */
    const yline = new T.Mesh(new T.BoxGeometry(pf.len, 0.04, 0.45), this.mat('#e3b52e'));
    yline.position.set(q.x, q.y + h + 0.03, q.z + 5.4 - 2.1); g.add(yline);
    /* full-length canopy with rib posts */
    const rl = pf.len * 0.94;
    if (!this.roofTex) this.roofTex = this.loadTex('roof', 1, 1);
    const roofGeo = this.scaleUV(new T.BoxGeometry(rl, 0.26, 6.4), rl / 2.6, 6.4 / 2.6);
    const roof = new T.Mesh(roofGeo, new T.MeshLambertMaterial({ color: 0xb33a2f, map: this.roofTex }));
    roof.position.set(q.x, q.y + 4.35, q.z + 6.4); roof.castShadow = true; g.add(roof);
    const nRib = Math.max(2, Math.floor(rl / 14));
    const rib = new T.InstancedMesh(new T.BoxGeometry(0.24, 3.5, 0.24), this.mat('#4c5158'), nRib);
    for (let i = 0; i < nRib; i++) {
      const M = new T.Matrix4();
      M.setPosition(q.x - rl / 2 + (i + 0.5) * (rl / nRib), q.y + 2.35, q.z + 6.4);
      rib.setMatrixAt(i, M);
    }
    g.add(rib);
    /* benches + vendor stalls */
    for (const f of [-0.32, 0.1, 0.38]) {
      const bench = new T.Mesh(new T.BoxGeometry(2.4, 0.5, 0.55), this.mat('#7c5a38'));
      bench.position.set(q.x + f * pf.len, q.y + h + 0.25, q.z + 7.6);
      bench.castShadow = true; g.add(bench);
    }
    if (pf.len > 150) {
      for (const [f, col] of [[-0.42, '#3f7fb8'], [0.46, '#c8752f']]) {
        const stall = new T.Mesh(new T.BoxGeometry(2.8, 2.3, 2), this.mat(col));
        stall.position.set(q.x + f * pf.len, q.y + h + 1.15, q.z + 8.4);
        stall.castShadow = true; g.add(stall);
        const awn = new T.Mesh(new T.BoxGeometry(3.2, 0.12, 2.5), this.mat('#2f4f6f'));
        awn.position.set(q.x + f * pf.len, q.y + h + 2.4, q.z + 7.8); g.add(awn);
      }
    }
    /* foot over bridge at major stations */
    if (pf.len >= 240) {
      const deck = new T.Mesh(new T.BoxGeometry(2.6, 0.24, 16), this.mat('#8a8f96'));
      deck.position.set(q.x, q.y + 6.2, q.z + 3.5); deck.castShadow = true; g.add(deck);
      for (const rz of [3.5 - 8 + 0.35, 3.5 + 8 - 0.35]) { /* railings both edges */
        const rail = new T.Mesh(new T.BoxGeometry(2.6, 0.09, 0.09), this.mat('#4c5158'));
        rail.position.set(q.x, q.y + 6.85, q.z + rz); g.add(rail);
      }
      for (const dz of [-4.2, 11.2]) { /* stair towers UNDER the deck ends */
        const tower = new T.Mesh(new T.BoxGeometry(3, 6.2, 2.4), this.mat('#9aa0a8'));
        tower.position.set(q.x, q.y + 3.1, q.z + dz); tower.castShadow = true; g.add(tower);
        for (const sx of [-0.9, 0.9]) { /* stair slot windows */
          const slot = new T.Mesh(new T.BoxGeometry(0.5, 4.4, 0.1), this.mat('#2a2f36'));
          slot.position.set(q.x + sx, q.y + 3.1, q.z + dz + (dz < 0 ? 1.22 : -1.22)); g.add(slot);
        }
      }
    }
    /* Indian Railways platform clock on the canopy edge */
    if (pf.len >= 150) {
      const ccv = document.createElement('canvas');
      ccv.width = ccv.height = 128;
      const c2 = ccv.getContext('2d');
      c2.fillStyle = '#f5f2ea'; c2.beginPath(); c2.arc(64, 64, 60, 0, Math.PI * 2); c2.fill();
      c2.strokeStyle = '#22262b'; c2.lineWidth = 6; c2.beginPath(); c2.arc(64, 64, 58, 0, Math.PI * 2); c2.stroke();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        c2.beginPath(); c2.lineWidth = 4;
        c2.moveTo(64 + Math.sin(a) * 46, 64 - Math.cos(a) * 46);
        c2.lineTo(64 + Math.sin(a) * 52, 64 - Math.cos(a) * 52);
        c2.stroke();
      }
      const hand = (a, l, w, col) => { c2.strokeStyle = col; c2.lineWidth = w; c2.beginPath(); c2.moveTo(64, 64); c2.lineTo(64 + Math.sin(a) * l, 64 - Math.cos(a) * l); c2.stroke(); };
      hand(0.9, 26, 6, '#16181c'); hand(2.4, 38, 5, '#16181c'); hand(4.4, 44, 2, '#c8331f');
      const ctex = new T.CanvasTexture(ccv);
      for (const fx of [-pf.len * 0.22, pf.len * 0.22]) {
        const clk = new T.Mesh(new T.CircleGeometry(0.62, 20), new T.MeshBasicMaterial({ map: ctex, side: T.DoubleSide }));
        clk.position.set(q.x + fx, q.y + 0.9 + 3.45, q.z + 3.15);
        clk.rotation.y = Math.PI;
        g.add(clk);
      }
    }
    /* platform lamps every ~40 m */
    {
      const nL = Math.max(2, Math.floor(pf.len / 40));
      for (let i = 0; i < nL; i++) {
        const lx = q.x - pf.len / 2 + (i + 0.5) * (pf.len / nL);
        const post = new T.Mesh(new T.CylinderGeometry(0.06, 0.09, 5.2, 5), this.mat('#3c4148'));
        post.position.set(lx, q.y + 0.9 + 2.6, q.z + 8.9);
        this.world.add(post);
        if (!this._lampMats) this._lampMats = [];
        const head = new T.Mesh(new T.SphereGeometry(0.2, 6, 6), new T.MeshBasicMaterial({ color: 0xfff2cc, transparent: true, opacity: 0.15 }));
        head.position.set(lx, q.y + 0.9 + 5.3, q.z + 8.9);
        this.world.add(head);
        this._lampMats.push(head.material);
      }
    }
    /* waiting commuters on the platform */
    const rng = mulberry32(Math.floor(pf.km));
    const n = Math.min(46, Math.max(6, Math.floor(pf.len / 9)));
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
    if (!this._walkers) this._walkers = [];
    this._walkers.push({
      im: body, n, x0: q.x, y: q.y + 0.9 + 0.55, z: q.z + 4.4 + 1.6,
      span: Math.min(pf.len * 0.8, 180),
      speed: Array.from({ length: n }, () => 0.5 + rng() * 0.9),
      off: Array.from({ length: n }, () => rng() * 100),
      M: new THREE.Matrix4(),
    });
  }

  _skyline(route, path) {
    /* distant high-rises for metro themes */
    if (!['mumbai', 'mumbai_cr', 'chennai', 'kolkata'].includes(route.theme)) return;
    const T = THREE, rng = mulberry32(hashStr(route.id + 'sky'));
    const n = 34;
    const im = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), this.mat('#8f97a4'), n);
    im.castShadow = false;
    const M = new T.Matrix4(), q = new T.Quaternion(), s = new T.Vector3(), v = new T.Vector3();
    for (let i = 0; i < n; i++) {
      const m = rng() * Math.min(path.L, 26000);
      const p = WB.posAt(path, m, 0);
      const h = 26 + rng() * 68;
      v.set(p.x, p.y + h / 2 - 8, p.z + (rng() < 0.7 ? 1 : -1) * (620 + rng() * 520));
      s.set(14 + rng() * 22, h, 14 + rng() * 22);
      M.compose(v, q, s);
      im.setMatrixAt(i, M);
    }
    this.world.add(im);
  }

  _clouds(route) {
    const T = THREE, rng = mulberry32(hashStr(route.id + 'cld'));
    const n = 14;
    const im = new T.InstancedMesh(
      new T.SphereGeometry(1, 7, 5),
      new T.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.82, fog: false }),
      n * 5);
    const M = new T.Matrix4(), q = new T.Quaternion(), s = new T.Vector3(), v = new T.Vector3();
    let k = 0;
    for (let i = 0; i < n; i++) {
      const cx = rng() * 60000, cz = (rng() - 0.5) * 9000, cy = 320 + rng() * 160;
      for (let j = 0; j < 5; j++) {
        v.set(cx + (rng() - 0.5) * 180, cy + (rng() - 0.5) * 26, cz + (rng() - 0.5) * 90);
        s.set(50 + rng() * 90, 16 + rng() * 18, 40 + rng() * 60);
        M.compose(v, q, s);
        im.setMatrixAt(k++, M);
      }
    }
    this.clouds = im;
    this.scene.add(im);
  }

  animateClouds(dt, camPos) {
    if (!this.clouds) return;
    this.clouds.position.x += dt * 1.6; /* slow drift */
    this.clouds.position.x = ((this.clouds.position.x + 2000) % 4000) - 2000;
    this.clouds.position.z = camPos.z * 0.9;
  }

  _water(list, path) {
    /* sea/river planes hugging the route, just under the rail grade */
    const T = THREE;
    if (!this.waterMat) this.waterMat = new T.MeshLambertMaterial({ color: 0x2f7f9e, emissive: 0x123244 });
    if (this._waterColor) this.waterMat.color.set(this._waterColor);
    for (const wseg of list) {
      const a = clamp(wseg.a, 0, path.L), b = clamp(wseg.b, 0, path.L);
      if (b - a < 800) continue;
      const n = Math.max(4, Math.floor((b - a) / 400));
      const g = new T.Group();
      for (let i = 0; i < n; i++) {
        const m0 = a + ((b - a) * i) / n, m1 = a + ((b - a) * (i + 1)) / n;
        const mid = (m0 + m1) / 2;
        const q = WB.posAt(path, mid, 0);
        const plane = new T.Mesh(new T.PlaneGeometry((m1 - m0) + 80, 3400), this.waterMat);
        plane.rotateX(-Math.PI / 2);
        plane.rotateZ(-q.yaw);
        plane.position.set(mid, q.y - 5.5, q.z + wseg.side * 1720);
        g.add(plane);
      }
      this.world.add(g);
    }
  }

  updateNightGlow(day) {
    const lit = clamp(1 - day * 2.2, 0, 1);
    if (this._windowGlows) for (const m of this._windowGlows) m.opacity = lit * 0.92;
    if (this._lampMats) for (const m of this._lampMats) m.opacity = 0.15 + lit * 0.85;
  }

  animateWater(t) {
    if (this.waterMat) this.waterMat.emissive.setHex(0x123244).multiplyScalar(0.9 + 0.1 * Math.sin(t * 1.7));
  }

  /* whistle + caution boards: W before every station approach, LW at the last one */
  _whistleBoards(lay, path) {
    const T = THREE, cv = document.createElement('canvas');
    cv.width = 128; cv.height = 128;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#f4f0e6'; ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = '#c8331f'; ctx.lineWidth = 10; ctx.strokeRect(6, 6, 116, 116);
    ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 74px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('W', 64, 92);
    const tex = new T.CanvasTexture(cv);
    for (const pf of lay.platforms) {
      for (const [dm, off] of [[820, -3.6], [420, -3.6]]) {
        const m = Math.max(50, pf.km - dm);
        const q = WB.posAt(path, m, off);
        const b = new T.Mesh(new T.PlaneGeometry(1.15, 1.15), new T.MeshBasicMaterial({ map: tex, side: T.DoubleSide }));
        b.position.set(q.x, q.y + 2.3, q.z);
        const p = new T.Mesh(new T.BoxGeometry(0.1, 2.3, 0.1), this.mat('#5a5f66'));
        p.position.set(q.x, q.y + 1.15, q.z);
        this.world.add(b, p);
      }
    }
  }

  _kmPosts(list, path) {
    if (!list || !list.length) return;
    const T = THREE;
    const im = new T.InstancedMesh(new T.BoxGeometry(0.14, 1, 0.14), this.mat('#e8e4da'), list.length);
    const M = new T.Matrix4();
    list.forEach((m, i) => {
      const p = WB.posAt(path, m, -3.4);
      M.makeTranslation(p.x, p.y + 0.5, p.z);
      im.setMatrixAt(i, M);
    });
    this.world.add(im);
  }

  _nameboards(platforms, path) {
    const T = THREE, cv = document.createElement('canvas');
    cv.width = 512; cv.height = 170;
    const ctx = cv.getContext('2d');
    const devanagari = { mumbai: 1, mumbai_cr: 1, konkan: 1, deccan: 1, nilgiri: 0, chennai: 0, kolkata: 0 };
    const REG = {
      mumbai: (n) => ({ hi: { 'Borivali': 'बोरीवली', 'Virar': 'विरार', 'Dahisar': 'दहिसर', 'Mumbai Central': 'मुंबई सेंट्रल', 'Bandra': 'बांद्रा', 'Andheri': 'अंधेरी', 'Bhayandar': 'भायंदर', 'Vasai': 'वसई', 'Dadar': 'दादर', 'Khar': 'खार' }[n] || '' }),
      mumbai_cr: (n) => ({ hi: { 'Kalyan': 'कल्याण', 'Thane': 'ठाणे', 'Dadar': 'दादर', 'CST': 'सीएसएमटी', 'Mulund': 'मुलुंड', 'Bhandup': 'भांडुप', 'Ghatkopar': 'घाटकोपर' }[n] || '' }),
    };
    for (const pf of platforms) {
      const q = WB.posAt(path, pf.km, 11); /* metres */
      ctx.clearRect(0, 0, 512, 170);
      ctx.fillStyle = '#11304f'; ctx.fillRect(0, 0, 512, 170);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 50px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(pf.n.slice(0, 20), 256, 52);
      const thm = this.route ? this.route.theme : 'mumbai';
      const reg = (REG[thm] && REG[thm](pf.n).hi) || '';
      ctx.font = '38px sans-serif'; ctx.fillStyle = '#ffd76e';
      if (reg) ctx.fillText(reg, 256, 102);
      ctx.font = '28px sans-serif'; ctx.fillStyle = '#cfe0f2';
      ctx.fillText((pf.loc || '').slice(0, 18).toUpperCase(), 256, reg ? 148 : 120);
      const tex = new T.CanvasTexture(cv);
      const board = new T.Mesh(new T.PlaneGeometry(7, 2.3), new T.MeshBasicMaterial({ map: tex, side: T.DoubleSide }));
      board.position.set(q.x, q.y + 3.9, q.z);
      const post = new T.Mesh(new T.BoxGeometry(0.22, 4.2, 0.22), this.mat('#3c4148'));
      post.position.set(q.x, q.y + 2.1, q.z);
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
    if (!this.asphaltTex) this.asphaltTex = this.loadTex('asphalt', 2, 4);
    const road = new T.Mesh(new T.BoxGeometry(8, 0.14, 14), new T.MeshLambertMaterial({ color: 0x9c9c98, map: this.asphaltTex }));
    road.position.set(q.x, q.y + 0.2, q.z);
    this.world.add(road);
    /* striped gate arms, down across the road */
    for (const s of [-1, 1]) {
      const post = new T.Mesh(new T.BoxGeometry(0.3, 2.8, 0.3), this.mat('#c8b428'));
      post.position.set(q.x, q.y + 1.4, q.z + s * 6.8);
      this.world.add(post);
      const arm = new T.Mesh(new T.BoxGeometry(7.4, 0.22, 0.22), this.mat('#d8d4c8'));
      arm.position.set(q.x + s * 3.4, q.y + 1.05, q.z + s * 4.6);
      arm.rotation.y = s * 0.35;
      this.world.add(arm);
      for (let b = -2; b <= 2; b++) { /* red stripes */
        const st = new T.Mesh(new T.BoxGeometry(0.7, 0.24, 0.24), this.mat('#c23b2e'));
        st.position.set(q.x + s * (3.4 + b * 1.4), q.y + 1.05 + s * b * 0.48, q.z + s * 4.6 + s * b * -0.17);
        st.rotation.y = s * 0.35;
        this.world.add(st);
      }
    }
    /* waiting road traffic on both sides */
    const rng = mulberry32(Math.floor(cx.km));
    const cols = [0xb8b8c0, 0x3a5fa8, 0xc23b2e, 0xd8d8d0, 0x3c3c40];
    const nVeh = 3 + Math.floor(rng() * 4);
    for (let i = 0; i < nVeh; i++) {
      const bike = rng() < 0.45;
      const side = rng() < 0.5 ? -1 : 1;
      const w = bike ? 0.7 : 1.9, hh = bike ? 1.2 : 1.4, l = bike ? 1.9 : 4.1;
      const v = new T.Mesh(new T.BoxGeometry(l, hh, w), this.mat(cols[Math.floor(rng() * cols.length)]));
      v.position.set(q.x - 9 - rng() * 22, q.y + 0.2 + hh / 2, q.z + side * (rng() * 3.4));
      v.castShadow = true;
      this.world.add(v);
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
      trunk.castShadow = true;
        v.set(q.x, h + (palm ? 4.4 : 4.6), q.z); s1.set(p.s, p.s * (palm ? 0.8 : 1), p.s);
        crown.castShadow = true;
        M.compose(v, q4, s1); crown.setMatrixAt(i, M);
      });
      s1.set(1, 1, 1);
      this.world.add(trunk, crown);
    }
    if (blds.length) {
      const im = new T.InstancedMesh(new T.BoxGeometry(9, 7, 9), new T.MeshLambertMaterial({ vertexColors: false, color: 0xb0a694 }), blds.length);
      im.castShadow = true; im.receiveShadow = true;
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
  /* one extruded, bevelled body per unique size — every train reuses it */
  carBodyGeo(len, H, W) {
    const T = THREE, key = len + 'x' + H + 'x' + W;
    if (!this._carGeo) this._carGeo = {};
    if (this._carGeo[key]) return this._carGeo[key];
    const s = new T.Shape();
    const w = W / 2, r = Math.min(0.55, H * 0.22);
    s.moveTo(-w, 0);
    s.lineTo(-w, H - 1.1);                       /* side wall */
    s.quadraticCurveTo(-w, H, -w + 0.75, H + r * 0.35);  /* shoulder */
    s.quadraticCurveTo(0, H + r, w - 0.75, H + r * 0.35); /* curved roof */
    s.quadraticCurveTo(w, H, w, H - 1.1);
    s.lineTo(w, 0);
    s.closePath();
    const g = new T.ExtrudeGeometry(s, { depth: len, bevelEnabled: true, bevelThickness: 0.3, bevelSize: 0.22, bevelSegments: 2, steps: 1 });
    g.rotateY(Math.PI / 2);            /* extrude along -X so head sits at +len */
    g.translate(-len / 2, 1.5, 0);     /* centre like the old box */
    g.computeVertexNormals();
    this._carGeo[key] = g;
    return g;
  }

  _crowdColors(im, n, rng) {
    const cols = [0xd8d3c8, 0x9fb3c8, 0xc8a8b8, 0xb8c4a8, 0xe0d8c0, 0x8ea6b8, 0xd6c2a0, 0xc07870];
    for (let i = 0; i < n; i++) im.setColorAt(i, new THREE.Color(cols[Math.floor(rng() * cols.length)]));
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }

  /* a slice of each platform crowd walks along it (living platform) */
  updateCrowdWalk(dt, t) {
    if (!this._walkers) return;
    const M = new THREE.Matrix4();
    for (const w of this._walkers) {
      for (let i = 0; i < w.n; i += 2) {
        const ph = (t * w.speed[i % w.speed.length] + w.off[i]) % w.span;
        const x = w.x0 - w.span / 2 + ph;
        M.setPosition(x, w.y, w.z + Math.sin((t + w.off[i]) * 0.9) * 0.14);
        w.im.setMatrixAt(i, M);
      }
      w.im.instanceMatrix.needsUpdate = true;
    }
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
    const LIV = { wr_violet: ['#5e4a9c', '#efe9da'], cr_crimson: ['#9e2436', '#efe9da'], ch_green: ['#dde4d8', '#1d6b4a'], kol_blue: ['#dde4d8', '#2a4d9b'], memu: ['#35569b', '#efe9da'], dmu: ['#8ba3b5', '#3a5fa8'], wdp4d: ['#d84b27', '#f5e9d8'], wdg4: ['#3a6ec2', '#f2c518'], wap7: ['#e8e6e0', '#c23b2e'], lhb: ['#41598f', '#dfe3e8'], icf: ['#7c2436', '#e8ddc0'], vb: ['#eceef2', '#1e3a8a'], nmr: ['#2b3d8f', '#e8c34a'], boxn: ['#8a6a4e', '#6a4e38'] };
    const grp = new T.Group();
    const cars = [];
    def.cars.forEach((c, i) => {
      const car = new T.Group();
      const emuLiv = { mumbai: 'wr_violet', mumbai_cr: 'cr_crimson', chennai: 'ch_green', kolkata: 'kol_blue' }[this.route.theme] || 'memu';
      const [body, band] = LIV[c.livery || (['dtc', 'mc', 'tc'].includes(c.k) ? emuLiv : null)] || LIV[emuLiv];
      const H = { dtc: 3.4, mc: 3.4, tc: 3.3, 'memu-m': 3.5, 'dmu-p': 3.5, 'loco-e': 3.9, 'loco-d': 4.0, wdg4: 4.1, steam: 3.2, tender: 2.6, ac1: 3.6, ac2: 3.6, ac3: 3.6, sl: 3.6, gs: 3.6, pc: 3.6, dq: 3.5, vb: 3.5, rack: 2.9, boxn: 3.0, flat: 1.6, tank: 3.2 }[c.k] || 3.4;
      const W = 3.1;
      if (!this.trainTex) this.trainTex = this.loadTex('trainmetal', 1, 1);
      if (!this._lmat) this._lmat = {};
      const mk = (col) => (this._lmat[col] = this._lmat[col] || new T.MeshLambertMaterial({ color: col, map: this.trainTex }));
      const driveEnd = ['dtc', 'memu-d', 'dmu-p'].includes(c.k);
      const bm = new T.Mesh(this.carBodyGeo(c.len, H, W),
        [mk(driveEnd ? '#e3aa2f' : body), mk(body)]); /* caps = cab ends */
      bm.castShadow = true; bm.receiveShadow = true; car.add(bm);
      const cabEnd = i === 0 || i === def.cars.length - 1; /* cab end faces are the yellow caps */      const bnd = new T.Mesh(new T.BoxGeometry(c.len * 1.001, H * 0.2, W + 0.05), this.mat(band));
      bnd.position.y = 1.5 + H * 0.26; car.add(bnd);
      if (!this._darkMat) this._darkMat = this.mat('#1a232c');
      const det = new T.Mesh(this.carDetailGeo(c.k, c.len, H, W), this._darkMat);
      det.castShadow = true; car.add(det);
      if (!this._glowMat) {
        this._glowMat = new T.MeshBasicMaterial({ color: 0xffe9b0, transparent: true, opacity: 0 });
        if (!this._windowGlows) this._windowGlows = [];
        this._windowGlows.push(this._glowMat);
      }
      if (!this._glowGeoCache) this._glowGeoCache = {};
      const gk = c.k + '|' + c.len + '|' + H;
      if (!this._glowGeoCache[gk]) {
        const gp = [];
        const driveG = ['dtc', 'memu-d', 'dmu-p'].includes(c.k);
        const gx0 = -c.len / 2 + (driveG ? 3.4 : 1.9), gx1 = c.len / 2 - 1.9;
        for (const s of [1, -1]) for (let wx = gx0 + 0.9; wx + 1.35 <= gx1; wx += 2.15) gp.push(this.bx(1.25, H * 0.2, 0.07, wx + 0.67, 1.5 + H * 0.62, s * (W / 2 + 0.04)));
        this._glowGeoCache[gk] = this.mergeGeos(gp);
      }
      const glow = new T.Mesh(this._glowGeoCache[gk], this._glowMat);
      car.add(glow);
      for (const bx of [-c.len * 0.32, c.len * 0.32]) {
        const bog = new T.Mesh(new T.BoxGeometry(2.6, 0.7, W * 0.86), this.mat('#23262b'));
        bog.position.set(bx, 0.75, 0); car.add(bog);
      }
      if (!this._roofMat) this._roofMat = this.mat('#31363c');
      const roof = new T.Mesh(this.roofGeo(c.len, H, c.panto || (def.pantoCars && c.k === 'mc')), this._roofMat);
      roof.castShadow = true; car.add(roof);
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
  trackOffset(tr) {
    /* lateral world-z offset so each track is a separate line of rails */
    if (tr.track === 'far') return this.route && this.route.double ? -4.9 : -5.6;
    if (tr.track === 'loop') return 5.2;
    return 0;
  }
  updateTrainVisuals(game, handles) {
    for (const tr of game.trains) {
      const h = handles.get(tr);
      if (!h) continue;
      const zOff = this.trackOffset(tr);
      h.cars.forEach((car, i) => {
        const pose = WB.carPose(this.p, tr.def, tr.s, i);
        car.position.set(pose.x, pose.y, pose.z + zOff);
        car.rotation.y = -pose.yaw;
        car.visible = !(tr.track === 'gone');
      });
      h.grp.visible = tr.track !== 'gone';
    }
  }

  /* ================= environment per frame ================= */
  buildCab() {
    /* minimal cab: console + window frame posts, added to camera-space once */
    const T = THREE;
    this.cab = new T.Group();
    const desk = new T.Mesh(new T.BoxGeometry(1.5, 0.34, 0.4), this.mat('#26292e'));
    desk.position.set(0.25, -0.78, -1.15);
    this.cab.add(desk);
    const screen = new T.Mesh(new T.BoxGeometry(0.42, 0.26, 0.03), new T.MeshBasicMaterial({ color: 0x0e1a26 }));
    screen.position.set(0.25, -0.62, -1.28);
    this.cab.add(screen);
    for (const s of [-1, 1]) {
      const post = new T.Mesh(new T.BoxGeometry(0.08, 1.35, 0.08), this.mat('#33373d'));
      post.position.set(s * 1.28, 0.1, -1.3);
      this.cab.add(post);
    }
    const roof = new T.Mesh(new T.BoxGeometry(2.6, 0.08, 0.6), this.mat('#2b2f34'));
    roof.position.set(0, 0.74, -1.2);
    this.cab.add(roof);
    this.camera.add(this.cab);
    this.cab.visible = false;
  }

  setCabView(inCab) {
    /* no interior is modelled: hide the lead car's exterior in cab view */
    if (this.lampMesh) this.lampMesh.visible = !inCab;
    if (this.playerHandle) this.playerHandle.cars[0].visible = !inCab;
    if (this.cab) this.cab.visible = !!inCab;
  }

  followSun(focus) {
    /* keep the shadow box around the player */
    const d = this.sun.position.clone().normalize().multiplyScalar(900);
    this.sun.position.set(focus.x + d.x, Math.max(150, focus.y + d.y), focus.z + d.z);
    this.sun.target.position.set(focus.x, focus.y, focus.z);
    this.sun.target.updateMatrixWorld();
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
    this.sun.intensity = 1.35 * day;
    this.sun.color.setHSL(0.09 + 0.04 * day, 0.6, 0.6 + 0.3 * day);
    this.hemi.intensity = 0.18 + 0.5 * day;
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
    /* keep the sky dome & stars centred on the camera (routes run far from origin) */
    if (this.skyDome) this.skyDome.position.set(camPos.x, 0, camPos.z);
    if (this._stars) this._stars.position.set(camPos.x, 0, camPos.z);
    /* fog distance tracks rain even after it clears */
    this.scene.fog.far = 7000 - 4300 * (this._rainAmt || 0);
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
  }

  render(camera) { this.renderer.render(this.scene, camera || this.camera); }
}
