import * as THREE from 'three';

/* ============================================================
   Bharat Rail Sim 3D — mesh/scene builders
   ============================================================ */
export const R3D = {
  cache: {},

  mat(color, opts) {
    const key = color + JSON.stringify(opts || {});
    if (!this.cache[key]) this.cache[key] = new THREE.MeshLambertMaterial(Object.assign({ color }, opts));
    return this.cache[key];
  },

  /* ---------- whole scene ---------- */
  buildScene(route, path, scat) {
    const th = THEMES[route.theme];
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xbfd4e0, 300, 2600);
    const hemi = new THREE.HemisphereLight(0xcfe4f0, 0x54553e, 0.9);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.6);
    sun.position.set(200, 300, 100);
    scene.add(sun);
    scene.add(sun.target);

    // sky dome with vertex-gradient shader
    const skyUniforms = {
      top: { value: new THREE.Color('#8ec8e8') },
      bot: { value: new THREE.Color('#d8ecec') },
      off: { value: 120 }, exp: { value: 1.4 },
    };
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(5200, 24, 12),
      new THREE.ShaderMaterial({
        uniforms: skyUniforms, side: THREE.BackSide, depthWrite: false,
        vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: 'uniform vec3 top; uniform vec3 bot; uniform float off; uniform float exp; varying vec3 vP; void main(){ float h = normalize(vP+vec3(0,off,0)).y; gl_FragColor = vec4(mix(bot,top,pow(max(h,0.0),exp)),1.0); }',
      })
    );
    scene.add(sky);
    // stars
    const starG = new THREE.BufferGeometry();
    {
      const pos = [];
      const r = mulberry32(77);
      for (let i = 0; i < 700; i++) {
        const a = r() * Math.PI * 2, b = r() * Math.PI * 0.48;
        pos.push(Math.cos(a) * Math.cos(b) * 4800, Math.sin(b) * 4800 + 200, Math.sin(a) * Math.cos(b) * 4800);
      }
      starG.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    }
    const stars = new THREE.Points(starG, new THREE.PointsMaterial({ color: 0xffffff, size: 7, transparent: true, opacity: 0, fog: false, sizeAttenuation: true }));
    scene.add(stars);
    // sun disc
    const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(60, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffeeb0, fog: false }));
    scene.add(sunDisc);

    // terrain
    this.buildTerrain(scene, route, path, th);
    // water
    if (th.sea !== undefined || th.river || th.lake) this.buildWater(scene, route, path, th);
    // track
    this.buildTrack(scene, route, path);
    if (route.electrified) this.buildCatenary(scene, route, path, scat);
    this.buildTunnels(scene, route, path);
    this.buildViaducts(scene, route, path, scat);
    this.buildStations(scene, route, path);
    this.buildTrees(scene, scat);
    this.buildBuildings(scene, scat);
    const signals = this.buildSignals(scene, route, path);
    const gates = this.buildGates(scene, scat);
    // rain
    const rain = this.buildRain(scene);

    return { scene, hemi, sun, sky: skyUniforms, stars, sunDisc, signals, gates, rain };
  },

  /* ---------- terrain ---------- */
  buildTerrain(scene, route, path, th) {
    const terrain = World3D.makeTerrainFn(route, path);
    const DX = path.L > 100 * KM ? 24 : 14, DU = 20, W = 700; // cell size, half-width
    const nx = Math.floor(path.L / DX) + 2, nu = Math.floor((W * 2) / DU) + 1;
    const nV = nx * nu;
    const pos = new Float32Array(nV * 3), col = new Float32Array(nV * 3);
    const gBase = new THREE.Color(th.ground), gGrass = new THREE.Color('#6f8f4e'), gDry = new THREE.Color('#9a8f66');
    const cCorr = new THREE.Color('#7d7a6e');
    const cTmp = new THREE.Color();
    let p = 0;
    for (let i = 0; i < nx; i++) {
      const x = i * DX;
      const zi = clamp(Math.round(x / World3D.DS), 0, path.N - 1);
      const zc = path.zs[zi];
      for (let j = 0; j < nu; j++) {
        const u = -W + j * DU;
        const z = zc + u;
        const h = terrain(x, z);
        pos[p * 3] = x; pos[p * 3 + 1] = h; pos[p * 3 + 2] = z;
        // colour: corridor gravel → grass/dry mix, rocky high
        const d = Math.abs(u);
        if (d < World3D.CORRIDOR * 0.7) cTmp.copy(cCorr);
        else cTmp.copy(gGrass).lerp(gDry, clamp(0.35 + 0.4 * Math.sin(x * 0.0021 + z * 0.0031), 0, 1));
        if (h > 60) cTmp.lerp(gDry, clamp((h - 60) / 90, 0, 0.7));
        const v = 0.92 + 0.16 * ((i * 7 + j * 13) % 5) / 5;
        col[p * 3] = cTmp.r * v; col[p * 3 + 1] = cTmp.g * v; col[p * 3 + 2] = cTmp.b * v;
        p++;
      }
    }
    const idx = [];
    for (let i = 0; i < nx - 1; i++) for (let j = 0; j < nu - 1; j++) {
      const a = i * nu + j, b = a + nu;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.receiveShadow = false;
    scene.add(mesh);
  },

  /* ---------- water ---------- */
  buildWater(scene, route, path, th) {
    const mat = new THREE.MeshLambertMaterial({ color: th.sea || '#3f7d96', transparent: true, opacity: 0.88 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(path.L + 4000, 6000), mat);
    mesh.rotation.x = -Math.PI / 2;
    const zc0 = path.zs[0];
    const side = th.seaSide === 'left' ? -1 : 1;
    mesh.position.set(path.L / 2, 0.4, zc0 + side * ((th.seaDist || 190) + 2800));
    if (th.sea === undefined && !th.river) mesh.position.z = zc0 + 170 + 400; // lakes
    mesh.position.y = -0.4;
    scene.add(mesh);
    this.waterMat = mat;
  },

  /* ---------- track ---------- */
  buildTrack(scene, route, path) {
    const L = path.L;
    // ballast ribbon
    const step = 14, n = Math.floor(L / step);
    const pos = new Float32Array((n + 1) * 2 * 3);
    let p = 0;
    for (let i = 0; i <= n; i++) {
      const q = World3D.posAt(path, i * step, 0);
      for (const lat of [-3.3, 3.3]) {
        pos[p * 3] = q.x + q.rx * lat; pos[p * 3 + 1] = q.y - 0.5; pos[p * 3 + 2] = q.z + q.rz * lat;
        p++;
      }
    }
    const idx = [];
    for (let i = 0; i < n; i++) {
      const a = i * 2, b = a + 2;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    scene.add(new THREE.Mesh(g, this.mat('#6b675e')));

    // sleepers (instanced)
    const slG = new THREE.BoxGeometry(0.24, 0.16, 2.5);
    const nS = Math.floor(L / 0.65);
    const sleepers = new THREE.InstancedMesh(slG, this.mat('#4a3c2c'), nS);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(1, 1, 1), pv = new THREE.Vector3();
    for (let i = 0; i < nS; i++) {
      const pt = World3D.posAt(path, i * 0.65, 0);
      q.setFromAxisAngle(up, pt.yaw);
      pv.set(pt.x, pt.y - 0.02, pt.z);
      m4.compose(pv, q, sc);
      sleepers.setMatrixAt(i, m4);
    }
    scene.add(sleepers);
    // rails (instanced segments)
    const rl = 7, nR = Math.floor(L / rl);
    const railG = new THREE.BoxGeometry(rl, 0.16, 0.09);
    const rails = new THREE.InstancedMesh(railG, this.mat('#8b9096'), nR * 2);
    let ri = 0;
    for (let i = 0; i < nR; i++) {
      const pt = World3D.posAt(path, i * rl + rl / 2, 0);
      const yaw = Math.atan2(-pt.tz, pt.tx);
      const pitch = Math.asin(clamp(pt.ty, -1, 1));
      const e = new THREE.Euler(0, yaw, 0);
      for (const lat of [-0.72, 0.72]) {
        q.setFromEuler(e);
        pv.set(pt.x + pt.rx * lat, pt.y + 0.16, pt.z + pt.rz * lat);
        m4.compose(pv, q, sc);
        rails.setMatrixAt(ri++, m4);
      }
    }
    scene.add(rails);
    // rack rail
    if (route.rack) {
      const rackG = new THREE.BoxGeometry(rl, 0.12, 0.16);
      const rack = new THREE.InstancedMesh(rackG, this.mat('#b89b3e'), nR);
      for (let i = 0; i < nR; i++) {
        const pt = World3D.posAt(path, i * rl + rl / 2, 0);
        q.setFromEuler(new THREE.Euler(0, Math.atan2(-pt.tz, pt.tx), 0));
        pv.set(pt.x, pt.y + 0.1, pt.z);
        m4.compose(pv, q, sc);
        rack.setMatrixAt(i, m4);
      }
      scene.add(rack);
    }
  },

  /* ---------- catenary ---------- */
  buildCatenary(scene, route, path, scat) {
    const poleG = new THREE.CylinderGeometry(0.09, 0.12, 7.2, 6);
    const poles = new THREE.InstancedMesh(poleG, this.mat('#4a4e55'), scat.poles.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(1, 1, 1), pv = new THREE.Vector3();
    scat.poles.forEach((po, i) => {
      q.setFromAxisAngle(up, 0);
      pv.set(po.x, po.y + 3.6, po.z);
      m4.compose(pv, q, sc);
      poles.setMatrixAt(i, m4);
    });
    scene.add(poles);
    // contact wire
    const pts = [];
    for (let x = 0; x < path.L; x += 13) {
      const pt = World3D.posAt(path, x, 0);
      pts.push(new THREE.Vector3(pt.x, pt.y + 5.4, pt.z));
    }
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x33363c })));
  },

  /* ---------- tunnels ---------- */
  buildTunnels(scene, route, path) {
    const rock = this.mat('#5c6650');
    const concrete = this.mat('#8d897e');
    for (const tu of route.tunnels || []) {
      const x0 = tu[0] * KM, x1 = tu[1] * KM, len = x1 - x0;
      const c = World3D.posAt(path, (x0 + x1) / 2, 0);
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.4, len, 10, 1, true, 0, Math.PI), new THREE.MeshLambertMaterial({ color: '#23201c', side: THREE.DoubleSide }));
      tube.rotation.z = Math.PI / 2; // cylinder axis → x
      tube.rotation.order = 'ZYX';
      tube.rotation.y = Math.atan2(-c.tz, c.tx);
      tube.rotation.x = Math.asin(clamp(c.ty, -1, 1));
      tube.position.set(c.x, c.y + 0.5, c.z);
      scene.add(tube);
      // raise hill over the tunnel so it reads as a mountain
      for (const px of [x0, x1]) {
        const pt = World3D.posAt(path, px, 0);
        const frame = new THREE.Mesh(new THREE.BoxGeometry(2.6, 9.4, 11), concrete);
        frame.position.set(pt.x, pt.y + 3.6, pt.z);
        frame.rotation.y = Math.atan2(-pt.tz, pt.tx);
        scene.add(frame);
      }
    }
  },

  /* ---------- viaducts ---------- */
  buildViaducts(scene, route, path, scat) {
    if (!scat.piers.length) return;
    const pierG = new THREE.BoxGeometry(3, 1, 4.4);
    const piers = new THREE.InstancedMesh(pierG, this.mat('#9a968c'), scat.piers.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), pv = new THREE.Vector3();
    scat.piers.forEach((pi, i) => {
      const h = Math.max(2, pi.yTop - pi.yBot - 1.4);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0);
      pv.set(pi.x, pi.yBot + h / 2, pi.z);
      m4.compose(pv, q, new THREE.Vector3(1, h, 1));
      piers.setMatrixAt(i, m4);
    });
    scene.add(piers);
    // deck ribbon per viaduct
    for (const vi of route.viaducts || []) {
      const x0 = vi[0] * KM, x1 = vi[1] * KM, step = 14, n = Math.floor((x1 - x0) / step);
      if (n < 1) continue;
      const pos = new Float32Array((n + 1) * 2 * 3);
      let p = 0;
      for (let i = 0; i <= n; i++) {
        const pt = World3D.posAt(path, x0 + i * step, 0);
        for (const lat of [-3.6, 3.6]) {
          pos[p * 3] = pt.x + pt.rx * lat; pos[p * 3 + 1] = pt.y - 0.62; pos[p * 3 + 2] = pt.z + pt.rz * lat;
          p++;
        }
      }
      const idx = [];
      for (let i = 0; i < n; i++) { const a = i * 2, b = a + 2; idx.push(a, b, a + 1, b, b + 1, a + 1); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setIndex(idx); g.computeVertexNormals();
      scene.add(new THREE.Mesh(g, this.mat('#a19d92')));
    }
  },

  /* ---------- stations ---------- */
  buildStations(scene, route, path) {
    const boards = [];
    for (const st of route.stations) {
      const grp = new THREE.Group();
      const n = Math.max(6, Math.floor(st.plat / 14));
      const step = st.plat / n;
      // platform segments follow curvature
      const pm = this.mat('#b6b2a8');
      for (let i = 0; i < n; i++) {
        const m = st.km + step * (i + 0.5);
        const pt = World3D.posAt(path, m, 5.6);
        const seg = new THREE.Mesh(new THREE.BoxGeometry(step * 1.02, 1.1, 7.6), pm);
        seg.position.set(pt.x, pt.y + 0.55, pt.z);
        seg.rotation.y = Math.atan2(-pt.tz, pt.tx);
        grp.add(seg);
      }
      // canopy
      if (st.plat > 90) {
        const mid = st.km + st.plat / 2;
        const ct = World3D.posAt(path, mid, 6.4);
        const can = new THREE.Mesh(new THREE.BoxGeometry(st.plat * 0.86, 0.3, 9), this.mat('#c8b23c'));
        can.position.set(ct.x, ct.y + 5.2, ct.z);
        can.rotation.y = Math.atan2(-ct.tz, ct.tx);
        grp.add(can);
        for (let i = 0; i < n; i += 2) {
          const m = st.km + step * (i + 0.5);
          const pt = World3D.posAt(path, m, 8.4);
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 4.2, 5), this.mat('#5a6a72'));
          post.position.set(pt.x, pt.y + 3, pt.z);
          grp.add(post);
        }
      }
      // name board
      const bpt = World3D.posAt(path, st.km + st.plat / 2, 10.2);
      const board = this.textBoard(st.n.toUpperCase(), st.loc || '', '#f5e94a', '#111', 900, 190);
      board.position.set(bpt.x, bpt.y + 4.6, bpt.z);
      board.rotation.y = Math.PI; // face the track
      grp.add(board);
      boards.push({ st, x: st.km + st.plat / 2 });
      // lamps (emissive, night)
      const lampM = new THREE.MeshBasicMaterial({ color: 0x554a33 });
      for (let i = 0; i < n; i += 3) {
        const m = st.km + step * (i + 0.5);
        const pt = World3D.posAt(path, m, 6.2);
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 5), lampM);
        lamp.position.set(pt.x, pt.y + 5.0, pt.z);
        grp.add(lamp);
      }
      scene.add(grp);
    }
    return boards;
  },

  textBoard(main, sub, bg, fg, w, h) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const c = cv.getContext('2d');
    c.fillStyle = bg; c.fillRect(0, 0, w, h);
    c.strokeStyle = fg; c.lineWidth = 6; c.strokeRect(3, 3, w - 6, h - 6);
    c.fillStyle = fg; c.textAlign = 'center';
    c.font = `bold ${h * 0.38}px Arial`;
    c.fillText(main, w / 2, h * 0.46, w - 20);
    if (sub) { c.font = `${h * 0.3}px sans-serif`; c.fillText(sub, w / 2, h * 0.85, w - 30); }
    const tex = new THREE.CanvasTexture(cv);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w / 90, h / 90), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    return mesh;
  },

  /* ---------- trees & buildings (instanced) ---------- */
  buildTrees(scene, scat) {
    const kinds = {};
    for (const t of scat.trees) (kinds[t.k] = kinds[t.k] || []).push(t);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), pv = new THREE.Vector3();
    const trunkM = this.mat('#6a4a2e');
    for (const k of Object.keys(kinds)) {
      const list = kinds[k];
      const crownGeo = (k === 'pine' || k === 'eucalyptus') ? new THREE.ConeGeometry(1.6, 5.2, 7) : new THREE.SphereGeometry(1.9, 7, 6);
      const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), list.length);
      const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.2, 1, 5), trunkM, list.length);
      const col = new THREE.Color();
      list.forEach((t, i) => {
        const hTrunk = k === 'palm' ? 4.5 * t.s : k === 'pine' ? 1.2 * t.s : 1.6 * t.s;
        q.setFromAxisAngle(up, 0);
        pv.set(t.x, t.y + hTrunk / 2, t.z);
        m4.compose(pv, q, new THREE.Vector3(t.s, Math.max(0.5, hTrunk), t.s));
        trunks.setMatrixAt(i, m4);
        const cy = k === 'palm' ? hTrunk + 1.1 * t.s : hTrunk + 2.2 * t.s;
        pv.set(t.x, t.y + cy, t.z);
        m4.compose(pv, q, new THREE.Vector3(t.s, t.s, t.s));
        crowns.setMatrixAt(i, m4);
        col.set(k === 'palm' ? '#3f7a3a' : k === 'gulmohar' ? '#c45a3c' : k === 'pine' ? '#28502e' : k === 'eucalyptus' ? '#5d8a52' : '#4f7a3c');
        col.offsetHSL(0, 0, (hashStr(String(i)) % 100) / 500 - 0.1);
        crowns.setColorAt(i, col);
      });
      scene.add(trunks); scene.add(crowns);
    }
  },
  buildBuildings(scene, scat) {
    if (!scat.buildings.length) return;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pv = new THREE.Vector3();
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), scat.buildings.length);
    const col = new THREE.Color();
    scat.buildings.forEach((b, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (hashStr(b.col + i) % 100) / 100 * 0.6 - 0.3);
      pv.set(b.x, b.y + b.h / 2, b.z);
      m4.compose(pv, q, new THREE.Vector3(b.w, b.h, b.d));
      inst.setMatrixAt(i, m4);
      col.set(b.col); col.offsetHSL(0, 0, (b.tone - 0.5) * 0.14);
      inst.setColorAt(i, col);
    });
    scene.add(inst);
  },

  /* ---------- signals ---------- */
  buildSignals(scene, route, path) {
    const out = [];
    const poleM = this.mat('#3f434a');
    for (const sig of route.signals3d || []) {
      const pt = World3D.posAt(path, sig.km, -3.4);
      const grp = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 5, 6), poleM);
      pole.position.set(pt.x, pt.y + 2.5, pt.z);
      grp.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.2, 0.3), poleM);
      head.position.set(pt.x, pt.y + 5.4, pt.z);
      grp.add(head);
      const lamps = [];
      const cols = { g: 0x2fbf4f, y: 0xf5c518, r: 0xe8352c };
      [['g', 5.9], ['y1', 5.35], ['y2', 4.8], ['r', 4.25]].forEach(([k, h]) => {
        const m = new THREE.MeshBasicMaterial({ color: 0x26262a });
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), m);
        lamp.position.set(pt.x, pt.y + h, pt.z + 0.12);
        grp.add(lamp);
        lamps.push({ k, m });
      });
      scene.add(grp);
      out.push({ sig, lamps, cols });
    }
    return out;
  },

  /* ---------- level crossing gates ---------- */
  buildGates(scene, scat) {
    const out = [];
    const postM = this.mat('#c23c2c');
    const armM = this.mat('#e8e4da');
    for (const g of scat.gates) {
      const pivots = [];
      for (const side of [-1, 1]) {
        const pt = World3D.posAt({ xs: [g.x], ys: [0], zs: [g.z], tx: [1], ty: [0], tz: [0], N: 1, L: 1, ds: 1 }, 0, 0);
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 3.4, 0.22), postM);
        post.position.set(g.x + side * 4.5, 1.7, g.z + 4.2);
        scene.add(post);
        const piv = new THREE.Group();
        piv.position.set(g.x + side * 4.5, 3.1, g.z + 4.2);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 4.4), armM);
        arm.position.z = -2.2;
        piv.add(arm);
        scene.add(piv);
        pivots.push({ piv, side });
      }
      out.push({ x: g.x, pivots, closed: false });
    }
    return out;
  },

  /* ---------- rain ---------- */
  buildRain(scene) {
    const N = 1400;
    const pos = new Float32Array(N * 3);
    const r = mulberry32(5);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (r() - 0.5) * 90; pos[i * 3 + 1] = r() * 40; pos[i * 3 + 2] = (r() - 0.5) * 90;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xaec6e0, size: 0.14, transparent: true, opacity: 0 }));
    pts.frustumCulled = false;
    scene.add(pts);
    return pts;
  },

  /* ---------- trains ---------- */
  buildTrain(def) {
    const LIV = { wr_violet: ['#e9e2d2', '#5c3a8e'], cr_crimson: ['#8c2438', '#e8ddc0'], ch_green: ['#e9e2d2', '#1d6b4a'], kol_blue: ['#e9e2d2', '#2a4d9b'], memu: ['#e9e2d2', '#3a5fa8'], dmu: ['#e9e2d2', '#3a5fa8'], wdp4d: ['#d84b27', '#f5e9d8'], wdg4: ['#3a6ec2', '#f2c518'], wap7: ['#e8e6e0', '#c23b2e'], lhb: ['#41598f', '#dfe3e8'], icf: ['#7c2436', '#e8ddc0'], vb: ['#eceef2', '#1e3a8a'], nmr: ['#2b3d8f', '#e8c34a'], boxn: ['#8a6a4e', '#6a4e38'] };
    const grp = new THREE.Group();
    const cars = [];
    def.cars.forEach((c, i) => {
      const car = new THREE.Group();
      const [body, band] = LIV[c.livery] || ['#888', '#ccc'];
      const H = { dtc: 3.4, mc: 3.4, tc: 3.3, 'memu-m': 3.5, 'dmu-p': 3.5, 'loco-e': 3.9, 'loco-d': 4.0, wdg4: 4.1, steam: 3.2, tender: 2.6, ac1: 3.6, ac2: 3.6, ac3: 3.6, sl: 3.6, gs: 3.6, pc: 3.6, dq: 3.5, vb: 3.5, rack: 2.9, boxn: 3.0 }[c.k] || 3.4;
      const W = 3.1;
      const bodyM = new THREE.MeshLambertMaterial({ color: body });
      const bm = new THREE.Mesh(new THREE.BoxGeometry(c.len, H, W), bodyM);
      bm.position.y = 1.5 + H / 2;
      car.add(bm);
      // livery band
      const bnd = new THREE.Mesh(new THREE.BoxGeometry(c.len * 1.001, H * 0.16, W + 0.04), this.mat(band));
      bnd.position.y = 1.5 + H * 0.32;
      car.add(bnd);
      // window strip
      const win = new THREE.Mesh(new THREE.BoxGeometry(c.len * 0.86, H * 0.22, W + 0.06), this.mat('#1c2830'));
      win.position.y = 1.5 + H * 0.62;
      car.add(win);
      // roof
      const rf = new THREE.Mesh(new THREE.BoxGeometry(c.len * 0.96, 0.22, W * 0.86), this.mat('#8a8d92'));
      rf.position.y = 1.5 + H + 0.1;
      car.add(rf);
      // bogies + wheels
      const wheels = [];
      for (const bx of [-c.len * 0.3, c.len * 0.3]) {
        const bog = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.5, 2.4), this.mat('#26282c'));
        bog.position.set(bx, 0.85, 0);
        car.add(bog);
        for (const wx of [-0.95, 0.95]) for (const wz of [-0.75, 0.75]) {
          const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.16, 10), this.mat('#3a3c40'));
          wh.rotation.x = Math.PI / 2;
          wh.position.set(bx + wx, 0.48, wz);
          car.add(wh); wheels.push(wh);
        }
      }
      // pantograph
      let panto = null;
      if (c.panto || (def.pantoCars && (c.k === 'mc' || c.k === 'memu-m'))) {
        panto = new THREE.Group();
        const a1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.6, 0.08), this.mat('#555'));
        a1.position.set(0.5, H + 2.1, 0); a1.rotation.z = 0.5;
        const a2 = a1.clone(); a2.position.x = -0.5; a2.rotation.z = -0.5;
        const bar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.06, 0.1), this.mat('#666'));
        bar.position.y = H + 2.9;
        panto.add(a1, a2, bar);
        panto.position.y = 0;
        car.add(panto);
      }
      grp.add(car);
      cars.push({ grp: car, wheels, def: c, H });
    });
    // headlight on lead car
    const head = new THREE.SpotLight(0xfff6d8, 0, 220, 0.32, 0.5, 1.2);
    head.position.set(def.cars[0].len / 2 + 0.5, 3.4, 0);
    const tgt = new THREE.Object3D();
    tgt.position.set(def.cars[0].len / 2 + 60, 0.5, 0);
    grp.add(tgt); head.target = tgt;
    grp.add(head);
    return { grp, cars, head };
  },

  poseTrain(t, path, built) {
    const def = t.def;
    const dir = t.dir || 1;
    built.cars.forEach((car, i) => {
      const p = World3D.carPose(path, def, t.s, dir, i);
      car.grp.position.set(p.x, p.y, p.z);
      car.grp.rotation.set(0, 0, 0);
      car.grp.rotation.order = 'YXZ';
      car.grp.rotation.y = Math.atan2(-p.tz, p.tx);
      car.grp.rotation.x = Math.asin(clamp(p.ty, -1, 1));
      const rot = t.wheelDist / 0.48;
      for (const w of car.wheels) w.rotation.z = -rot * dir;
    });
  },
};
