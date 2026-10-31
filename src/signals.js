'use strict';
/* ============================================================
   Bharat Rail Sim 3D — signalling (fresh engine)
   IR-style 4-aspect colour-light signalling: block autos, station
   homes & starters, single-line sections with loop crossings.
   All trains run +s; 'main' (player), 'far' (opposite), 'loop' tracks.
   ============================================================ */
class SignalBox {
  constructor(route, svc) {
    this.route = route;
    this.block = (route.block || 1400);
    this.single = !route.double;
    this.signals = [];
    const L = routeEnd(route);
    const loops = new Set(meetsOf(route, svc).map((m) => m.at).concat(route.loops || []));
    this.loops = [...loops].map((n) => stationByName(route, n)).filter(Boolean).sort((a, b) => a.km - b.km);
    // single-line sections run between consecutive loop stations
    this.sections = [];
    if (this.single) {
      const cuts = [0, ...this.loops.map((s) => s.km), L];
      for (let i = 0; i < cuts.length - 1; i++) this.sections.push({ a: cuts[i], b: cuts[i + 1] });
    }
    this.homeGuard = {};
    for (let i = 0; i < this.loops.length; i++) {
      const st = this.loops[i];
      this.signals.push({ id: 'H' + i, km: st.km - 420, track: 'main', kind: 'home', station: st.n, aspect: 'green' });
      this.signals.push({ id: 'S' + i, km: st.km + 220, track: 'main', kind: 'starter', station: st.n, aspect: 'green' });
      /* tokenless single line: this home protects the section BEYOND its loop;
         a train standing inside the loop refuge is neutral (that's the point of a loop) */
      if (this.sections[i + 1]) this.homeGuard['H' + i] = this.sections[i + 1];
    }
    if (!this.single) {
      const step = Math.max(this.block, 900);
      for (let km = step; km < L - 300; km += step)
        this.signals.push({ id: 'A' + this.signals.length, km, track: 'main', kind: 'auto', aspect: 'green' });
      for (let km = L - step; km > 300; km -= step)
        this.signals.push({ id: 'U' + this.signals.length, km, track: 'far', kind: 'auto', aspect: 'green' });
    }
    this.events = [];
  }

  _occupied(track, fromM, toM) {
    return this.trains.some((t) => t.track === track && t.s >= fromM && t.s - t.len <= toM);
  }
  _sectionOf(km) { return this.sections.find((sc) => km > sc.a && km <= sc.b) || null; }
  _sectionOccupied(sc) {
    /* only main-line trains occupy a section; loop refuges are neutral */
    return this.trains.some((t) => t.track === 'main' && t.s > sc.a && t.s - t.len < sc.b);
  }

  update(trains) {
    this.trains = trains;
    this.events.length = 0;
    const warn = this.single ? this.block : this.block;
    for (const sg of this.signals) {
      const ahead = trains
        .filter((t) => t.track === sg.track && t.s > sg.km)
        .map((t) => t.s - t.len - sg.km)
        .filter((d) => d > -40)
        .sort((a, b) => a - b);
      const gap = ahead.length ? ahead[0] : Infinity;
      if (sg.kind === 'home' && this.single) {
        const sc = this.homeGuard[sg.id];
        if (sc && this._sectionOccupied(sc)) { sg.aspect = 'red'; continue; }
      }
      if (gap < warn + 120) sg.aspect = 'red';
      else if (!this.single && gap < 2 * warn + 120) sg.aspect = 'yellow';
      else if (!this.single && gap < 3 * warn + 120) sg.aspect = 'yellow2';
      else sg.aspect = 'green';
    }
  }

  /* nearest signal ahead of a train on its own track */
  nextSignal(tr) {
    let best = null, bd = Infinity;
    for (const sg of this.signals) {
      if (sg.track !== tr.track) continue;
      const d = sg.km - tr.s;
      if (d > -20 && d < bd) { bd = d; best = sg; }
    }
    return best ? { sig: best, dist: bd } : null;
  }

  /* distance the driver must not pass (next red) — Infinity if line clear */
  stopTarget(tr) {
    const n = this.nextSignal(tr);
    if (n && n.sig.aspect === 'red') return tr.s + Math.max(n.dist, 0) - 12;
    return Infinity;
  }

  /* SPAD: front crossed a red this step */
  checkSpad(tr, prevS) {
    for (const sg of this.signals) {
      if (sg.track !== tr.track) continue;
      if (prevS < sg.km && tr.s >= sg.km && sg.aspect === 'red') {
        this.events.push({ type: 'spad', who: tr.label || tr.def.id, km: sg.km / KM });
        return sg;
      }
    }
    return null;
  }
}
