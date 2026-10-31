'use strict';
/* ============================================================
   Bharat Rail Sim 3D — procedural audio (fresh engine, WebAudio)
   ============================================================ */
const Snd = {
  ready: false, muted: false,
  init() {
    if (this.ready) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const c = (this.ctx = new AC());
      this.master = c.createGain(); this.master.gain.value = 0.75; this.master.connect(c.destination);
      const nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = nb.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.noise = nb;
      this.roll = this._noise('bandpass', 320, 0.8);
      this.rumble = this._noise('lowpass', 110, 0.6);
      this.wind = this._noise('highpass', 1900, 0.5);
      this.rain = this._noise('highpass', 2700, 0.35);
      this.motor = c.createOscillator(); this.motor.type = 'sawtooth'; this.motorG = c.createGain(); this.motorG.gain.value = 0;
      this.motorF = c.createBiquadFilter(); this.motorF.type = 'bandpass'; this.motorF.frequency.value = 900; this.motorF.Q.value = 2;
      this.motor.connect(this.motorF); this.motorF.connect(this.motorG); this.motorG.connect(this.master); this.motor.start();
      this.eng = c.createOscillator(); this.eng.type = 'sawtooth'; this.engG = c.createGain(); this.engG.gain.value = 0;
      this.engF = c.createBiquadFilter(); this.engF.type = 'lowpass'; this.engF.frequency.value = 240;
      this.eng.connect(this.engF); this.engF.connect(this.engG); this.engG.connect(this.master); this.eng.start();
      this.tunnelF = c.createBiquadFilter(); /* simple tunnel tone: boost low band via rumble gain */
      this.ready = true;
    } catch (e) { /* audio unavailable — game stays silent */ }
  },
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  _noise(type, f, q) {
    const c = this.ctx, src = c.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const g = c.createGain(); g.gain.value = 0;
    src.connect(fl); fl.connect(g); g.connect(this.master); src.start();
    return g;
  },
  _g(node, v, t) { if (this.ready) node.gain.setTargetAtTime(this.muted ? 0 : v, this.ctx.currentTime, t || 0.1); },
  update(dt, st) {
    if (!this.ready) return;
    const v = st.v || 0, kmh = v * 3.6, not = st.notch || 0, brk = st.brake || 0;
    const tv = Math.min(1, kmh / 110);
    this._g(this.roll, tv * 0.5 * (st.inTunnel ? 1.5 : 1), 0.2);
    this._g(this.rumble, tv * tv * 0.5, 0.2);
    this._g(this.wind, tv * tv * tv * 0.55, 0.25);
    this._g(this.rain, st.rain ? 0.24 : 0, 0.4);
    if (st.sound === 'emu') {
      this.motor.frequency.setTargetAtTime(140 + not * 380 + tv * 160, this.ctx.currentTime, 0.08);
      this._g(this.motorG, 0.032 + not * 0.075, 0.1);
      this._g(this.engG, 0, 0.2);
    } else if (st.sound === 'diesel' || st.sound === 'dmu') {
      this.eng.frequency.setTargetAtTime(52 + not * 66, this.ctx.currentTime, 0.15);
      this._g(this.engG, 0.05 + not * 0.11, 0.15);
      this._g(this.motorG, 0, 0.2);
    } else { /* steam: low chuff handled by events; idle hiss */
      this._g(this.engG, 0.028 + not * 0.02, 0.2);
      this._g(this.motorG, 0, 0.2);
    }
  },
  chuff() { this._blip(90, 0.16, 0.10); },
  horn(kind) {
    if (!this.ready || this.muted) return;
    const t0 = this.ctx.currentTime, dual = kind !== 'steam';
    const mk = (f, g) => {
      const o = this.ctx.createOscillator(), og = this.ctx.createGain();
      o.type = 'sawtooth'; o.frequency.value = f;
      og.gain.setValueAtTime(0, t0); og.gain.linearRampToValueAtTime(g, t0 + 0.05);
      og.gain.setTargetAtTime(0, t0 + 0.9, 0.18);
      o.connect(og); og.connect(this.master); o.start(t0); o.stop(t0 + 1.8);
    };
    if (dual) { mk(310, 0.16); mk(415, 0.12); } else { mk(440, 0.13); }
  },
  ding() { this._blip(1150, 0.5, 0.06, 'sine'); },
  /* three-note door chime, then guard's whistle */
  doorChime() { this._blip(988, 0.12, 0.07, 'sine'); setTimeout(() => this._blip(1319, 0.12, 0.07, 'sine'), 140); setTimeout(() => this._blip(988, 0.2, 0.07, 'sine'), 280); },
  whistle() {
    if (!this.ready || this.muted) return;
    const t0 = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(1900, t0); o.frequency.exponentialRampToValueAtTime(1350, t0 + 0.32);
    g.gain.setValueAtTime(0.12, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.4);
    o.connect(g); g.connect(this.master); o.start(t0); o.stop(t0 + 0.45);
  },
  _blip(f, dur, g, type) {
    if (!this.ready || this.muted) return;
    const t0 = this.ctx.currentTime, o = this.ctx.createOscillator(), og = this.ctx.createGain();
    o.type = type || 'square'; o.frequency.value = f;
    og.gain.setValueAtTime(g, t0); og.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(og); og.connect(this.master); o.start(t0); o.stop(t0 + dur + 0.05);
  },
};
