'use strict';
/* ============================================================
   Bharat Rail Sim — procedural audio (WebAudio)
   ============================================================ */
const Snd = {
  ready: false, muted: false, master: null,
  init() {
    if (this.ready) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const c = this.ctx;
      this.master = c.createGain(); this.master.gain.value = 0.8; this.master.connect(c.destination);
      // noise buffer
      const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
      // rolling noise
      this.roll = this.mkNoise({ type: 'bandpass', f: 400, q: 0.7, g: 0 });
      this.rumble = this.mkNoise({ type: 'lowpass', f: 120, q: 0.5, g: 0 });
      this.wind = this.mkNoise({ type: 'highpass', f: 1800, q: 0.4, g: 0 });
      // rain
      this.rain = this.mkNoise({ type: 'highpass', f: 2600, q: 0.3, g: 0 });
      // motor (EMU whine)
      this.mot1 = this.mkOsc('sawtooth', 0, 0);
      this.mot2 = this.mkOsc('sine', 0, 0);
      // diesel engine
      this.eng = this.mkOsc('sawtooth', 0, 0);
      this.engLP = c.createBiquadFilter(); this.engLP.type = 'lowpass'; this.engLP.frequency.value = 220;
      this.engG = c.createGain(); this.engG.gain.value = 0;
      this.eng.connect(this.engLP); this.engLP.connect(this.engG); this.engG.connect(this.master);
      this.ready = true;
    } catch (e) { /* audio unavailable */ }
  },
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  mkNoise(f) {
    const c = this.ctx, src = c.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const flt = c.createBiquadFilter(); flt.type = f.type; flt.frequency.value = f.f; flt.Q.value = f.q;
    const g = c.createGain(); g.gain.value = f.g;
    src.connect(flt); flt.connect(g); g.connect(this.master); src.start();
    return { flt, g };
  },
  mkOsc(type, f, g) {
    const c = this.ctx, o = c.createOscillator(); o.type = type; o.frequency.value = f;
    const gn = c.createGain(); gn.gain.value = g; o.connect(gn); gn.connect(this.master); o.start();
    return { o, g: gn };
  },
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.8; },

  /* continuous update */
  update(dt, s) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime;
    const v = s.v, kmh = v * 3.6;
    // rolling
    const rg = Math.min(0.22, kmh / 500) * (s.inTunnel ? 1.6 : 1);
    this.roll.g.gain.setTargetAtTime(rg, t, 0.1);
    this.roll.flt.frequency.setTargetAtTime(200 + kmh * 9, t, 0.1);
    this.rumble.g.gain.setTargetAtTime(Math.min(0.2, kmh / 320), t, 0.15);
    this.wind.g.gain.setTargetAtTime(kmh > 55 ? Math.min(0.06, (kmh - 55) / 900) : 0, t, 0.2);
    // rail joints / clatter
    if (kmh > 3 && s.wheelDist !== undefined) {
      const dw = s.wheelDist - (this._lastWheel !== undefined ? this._lastWheel : s.wheelDist);
      if (dw < 0) this._lastWheel = s.wheelDist; // resync after reset / new train
      else if (dw > 24) { this._lastWheel = s.wheelDist; this.clack(kmh); }
    }
    // traction sounds
    if (s.sound === 'emu' || s.sound === 'memu') {
      const f = 120 + kmh * 7 + s.notch * 26;
      const g = (kmh > 1 && s.notch > 0) ? 0.028 + s.notch * 0.012 : (kmh > 1 ? 0.008 : 0);
      this.mot1.o.frequency.setTargetAtTime(f, t, 0.08);
      this.mot2.o.frequency.setTargetAtTime(f * 2.01, t, 0.08);
      this.mot1.g.gain.setTargetAtTime(g * 0.8, t, 0.15);
      this.mot2.g.gain.setTargetAtTime(g * 0.5, t, 0.15);
      this.engG.gain.setTargetAtTime(0, t, 0.1);
    } else if (s.sound === 'diesel' || s.sound === 'dmu') {
      const rpm = s.sound === 'dmu' ? (0.35 + s.notch * 0.65) : (0.25 + s.notch * 0.75);
      this.eng.o.frequency.setTargetAtTime(46 + rpm * 68, t, 0.25);
      this.engLP.frequency.setTargetAtTime(140 + rpm * 260, t, 0.25);
      this.engG.gain.setTargetAtTime(0.05 + rpm * 0.075, t, 0.2);
      this.mot1.g.gain.setTargetAtTime(0, t, 0.1); this.mot2.g.gain.setTargetAtTime(0, t, 0.1);
    } else if (s.sound === 'electric') {
      const f = 90 + kmh * 4.4 + s.notch * 18;
      this.mot1.o.frequency.setTargetAtTime(f, t, 0.08);
      this.mot2.o.frequency.setTargetAtTime(f * 1.5, t, 0.08);
      const g = (kmh > 1 && s.notch > 0) ? 0.02 + s.notch * 0.009 : 0.005;
      this.mot1.g.gain.setTargetAtTime(g, t, 0.15); this.mot2.g.gain.setTargetAtTime(g * 0.6, t, 0.15);
      this.engG.gain.setTargetAtTime(0, t, 0.1);
    } else if (s.sound === 'steam') {
      this.mot1.g.gain.setTargetAtTime(0, t, 0.1); this.mot2.g.gain.setTargetAtTime(0, t, 0.1);
      this.engG.gain.setTargetAtTime(0.015 + s.notch * 0.02, t, 0.3);
      this.eng.o.frequency.setTargetAtTime(60 + s.notch * 40, t, 0.3);
    }
    // brake squeal
    const squeal = (s.brake > 0.25 && kmh > 1.5 && kmh < 45) ? (1 - kmh / 45) * s.brake : 0;
    if (squeal > 0.05 && Math.random() < 0.25) this.squealTone(2400 + Math.random() * 1400, squeal * 0.035);
    // rain
    this.rain.g.gain.setTargetAtTime(s.rain ? 0.06 : 0, t, 0.5);
  },
  stopAll() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    for (const n of [this.roll, this.rumble, this.wind, this.rain]) n.g.gain.setTargetAtTime(0, t, 0.1);
    for (const n of [this.mot1, this.mot2]) n.g.gain.setTargetAtTime(0, t, 0.1);
    if (this.engG) this.engG.gain.setTargetAtTime(0, t, 0.1);
  },

  /* one-shots */
  env(g, t0, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  },
  clack(kmh) {
    if (!this.ready) return;
    const c = this.ctx, t0 = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900 + Math.random() * 500; f.Q.value = 2;
    const g = c.createGain(); src.connect(f); f.connect(g); g.connect(this.master);
    this.env(g, t0, 0.002, Math.min(0.09, kmh / 450), 0.05);
    src.start(t0); src.stop(t0 + 0.08);
  },
  hiss(long) {
    if (!this.ready) return;
    const c = this.ctx, t0 = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 3000;
    const g = c.createGain(); src.connect(f); f.connect(g); g.connect(this.master);
    this.env(g, t0, 0.01, 0.06, long ? 0.9 : 0.3);
    src.start(t0); src.stop(t0 + 1.2);
  },
  squealTone(freq, vol) {
    if (!this.ready) return;
    const c = this.ctx, t0 = c.currentTime;
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
    const g = c.createGain(); o.connect(g); g.connect(this.master);
    this.env(g, t0, 0.03, vol, 0.25);
    o.start(t0); o.stop(t0 + 0.35);
  },
  chuff(strength) { // steam
    if (!this.ready) return;
    const c = this.ctx, t0 = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500 + strength * 700;
    const g = c.createGain(); src.connect(f); f.connect(g); g.connect(this.master);
    this.env(g, t0, 0.012, 0.05 + strength * 0.11, 0.16);
    src.start(t0); src.stop(t0 + 0.3);
  },
  /* horns — slot-aware so AI horns never clash with the player's */
  _hornSlots: {},
  hornStart(type, slot, vol) {
    slot = slot || 'player';
    if (!this.ready || this._hornSlots[slot]) return;
    const c = this.ctx, t0 = c.currentTime, nodes = [], g = c.createGain();
    g.gain.value = 0; g.connect(this.master);
    const add = (type2, f, v) => {
      const o = c.createOscillator(); o.type = type2; o.frequency.value = f;
      const og = c.createGain(); og.gain.value = v; o.connect(og); og.connect(g); o.start(); nodes.push(o);
    };
    if (type === 'emu') { add('sawtooth', 350, 0.4); add('sawtooth', 440, 0.35); add('square', 220, 0.12); }
    else if (type === 'vb') { add('sawtooth', 480, 0.4); add('sawtooth', 600, 0.3); }
    else if (type === 'steam') { add('sine', 620, 0.5); add('sine', 790, 0.4); add('sine', 990, 0.25); }
    else { add('sawtooth', 290, 0.5); add('sawtooth', 345, 0.45); add('square', 145, 0.15); }
    g.gain.setTargetAtTime(vol !== undefined ? vol * 0.16 : 0.16, t0, 0.03);
    this._hornSlots[slot] = { g, nodes };
  },
  hornEnd(slot) {
    slot = slot || 'player';
    const h = this._hornSlots[slot];
    if (!h) return;
    const t0 = this.ctx.currentTime;
    h.g.gain.setTargetAtTime(0, t0, 0.06);
    setTimeout(() => h.nodes.forEach((o) => { try { o.stop(); } catch (e) {} }), 400);
    delete this._hornSlots[slot];
  },
  aiHorn(type, vol) { // distant horn — own slot + volume, player horn unaffected
    if (!this.ready) return;
    this.hornStart(type === 'steam' ? 'steam' : 'loco', 'ai', vol);
    setTimeout(() => this.hornEnd('ai'), 700);
  },
  doorBeeps(n) {
    if (!this.ready) return;
    const c = this.ctx;
    for (let i = 0; i < n; i++) {
      const t0 = c.currentTime + i * 0.45;
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = 780;
      const g = c.createGain(); o.connect(g); g.connect(this.master);
      this.env(g, t0, 0.01, 0.09, 0.18);
      o.start(t0); o.stop(t0 + 0.25);
    }
  },
  chime() { // IR announcement chime
    if (!this.ready) return;
    const c = this.ctx, notes = [523, 659, 784];
    notes.forEach((f, i) => {
      const t0 = c.currentTime + i * 0.42;
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = c.createGain(); o.connect(g); g.connect(this.master);
      this.env(g, t0, 0.02, 0.12, 0.5);
      o.start(t0); o.stop(t0 + 0.6);
    });
  },
  guardWhistle() {
    if (!this.ready) return;
    const c = this.ctx, t0 = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2800; f.Q.value = 8;
    const g = c.createGain(); src.connect(f); f.connect(g); g.connect(this.master);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.07, t0 + 0.03);
    g.gain.setValueAtTime(0.07, t0 + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);
    src.start(t0); src.stop(t0 + 0.6);
  },
  thunder() {
    if (!this.ready) return;
    const c = this.ctx, t0 = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 150;
    const g = c.createGain(); src.connect(f); f.connect(g); g.connect(this.master);
    this.env(g, t0, 0.05, 0.3, 2.2);
    src.start(t0); src.stop(t0 + 2.6);
  },
};

/* ---------- spoken announcements (browser speech synthesis) ---------- */
const Say = {
  on: true, last: 0,
  supported() { return typeof window !== 'undefined' && window.speechSynthesis; },
  voiceFor(lang) {
    if (!this.supported()) return null;
    const vs = window.speechSynthesis.getVoices() || [];
    const pref = { hi: ['hi-IN', 'hi'], ta: ['ta-IN', 'ta'], bn: ['bn-IN', 'bn'], kn: ['kn-IN', 'kn'], mr: ['mr-IN', 'hi-IN'], en: ['en-IN', 'en-GB', 'en'] }[lang] || ['en-IN', 'en'];
    for (const p of pref) { const v = vs.find((x) => x.lang && x.lang.toLowerCase().startsWith(p.toLowerCase())); if (v) return v; }
    return vs.find((x) => x.lang && x.lang.startsWith('en')) || vs[0] || null;
  },
  speak(text, lang, rate) {
    if (!this.on || !this.supported()) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      const v = this.voiceFor(lang || 'en');
      if (v) { u.voice = v; u.lang = v.lang; }
      u.rate = rate || 1; u.volume = 0.9;
      window.speechSynthesis.speak(u);
    } catch (e) {}
  },
  station(next, lang, local, terminal) {
    Snd.chime();
    const now = performance.now();
    if (now - this.last < 4000) return; this.last = now;
    this.speak((terminal ? 'We have arrived at ' : 'Next station: ') + next + '.', 'en');
    if (local) setTimeout(() => this.speak(local, lang, 0.95), 2400);
  },
  warn(text) { this.speak(text, 'en'); },
};
