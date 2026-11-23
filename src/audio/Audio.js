// Fully procedural sound: no audio files. Everything is synthesized with Web Audio.

const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.musicLevel = 0;
  }

  /** Must be called from a user gesture (browser autoplay policy). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.8 : 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    // Small generated reverb for a sense of underwater space.
    this.reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 2.2;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    this.reverb.buffer = ir;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.35;
    this.reverb.connect(this.wet).connect(this.master);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);
    this.sfx.connect(this.reverb);

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    this._startAmbient();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.05);
  }

  _startAmbient() {
    const ctx = this.ctx;
    this.amb = ctx.createGain();
    this.amb.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 3;
    this.ambFilter = lp;
    lp.connect(this.amb).connect(this.master);
    this.amb.connect(this.reverb);
    // Root + fifth + soft ninth, slightly detuned for movement.
    for (const [n, det, g] of [[38, -4, 0.5], [45, 3, 0.32], [52, 6, 0.12], [38, 7, 0.3]]) {
      const o = ctx.createOscillator();
      o.type = n === 52 ? 'sine' : 'triangle';
      o.frequency.value = midi(n);
      o.detune.value = det;
      const gn = ctx.createGain(); gn.gain.value = g;
      o.connect(gn).connect(lp);
      o.start();
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 220;
    lfo.connect(lfoGain).connect(lp.frequency);
    lfo.start();
  }

  /** 0 = silent, ~1 = in game. Smoothly fades the ambient drone. */
  setMusic(level) {
    if (!this.ctx || level === this.musicLevel) return;
    this.musicLevel = level;
    this.amb.gain.setTargetAtTime(0.11 * level, this.ctx.currentTime, 0.8);
  }

  /** Rising intensity: filter opens as the snake speeds up. */
  setIntensity(x) {
    if (!this.ctx) return;
    const k = Math.min(1, Math.max(0, x));
    this.ambFilter.frequency.setTargetAtTime(380 + k * 700, this.ctx.currentTime, 1.0);
  }

  _tone(freq, t0, dur, { type = 'sine', gain = 0.2, attack = 0.005, glide = 0, dest = this.sfx } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * glide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  _noise(t0, dur, { gain = 0.2, freq = 1200, q = 1, type = 'bandpass', sweep = 0 } = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t0); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(freq * sweep, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  _ready() { return this.ctx && this.enabled && this.ctx.state === 'running'; }

  eat(combo, eaten) {
    if (!this._ready()) return;
    const t = this.ctx.currentTime;
    const step = Math.min(PENTA.length - 3, (combo - 1) * 2 + (eaten % 2));
    const base = 72 + PENTA[step];
    this._tone(midi(base), t, 0.18, { type: 'triangle', gain: 0.22 });
    this._tone(midi(base + 7), t + 0.06, 0.28, { type: 'sine', gain: 0.18 });
    this._tone(midi(base + 12), t + 0.06, 0.4, { type: 'sine', gain: 0.06 });
    this._noise(t, 0.08, { gain: 0.05, freq: 6000, q: 0.7, type: 'highpass' });
  }

  bonus() {
    if (!this._ready()) return;
    const t = this.ctx.currentTime;
    [0, 4, 7, 12, 16, 19].forEach((n, i) =>
      this._tone(midi(79 + n), t + i * 0.045, 0.35, { type: 'triangle', gain: 0.13 }));
  }

  turn() {
    if (!this._ready()) return;
    const t = this.ctx.currentTime;
    this._tone(1500, t, 0.045, { type: 'sine', gain: 0.035, glide: 0.6 });
  }

  spawn() {
    if (!this._ready()) return;
    const t = this.ctx.currentTime;
    this._tone(midi(96), t, 0.25, { type: 'sine', gain: 0.025 });
  }

  die() {
    if (!this._ready()) return;
    const t = this.ctx.currentTime;
    this._tone(220, t, 0.9, { type: 'sawtooth', gain: 0.12, glide: 0.18 });
    this._tone(110, t, 1.1, { type: 'square', gain: 0.06, glide: 0.25 });
    this._noise(t, 0.7, { gain: 0.25, freq: 2400, q: 0.8, type: 'lowpass', sweep: 0.08 });
    this._tone(55, t, 0.6, { type: 'sine', gain: 0.35, glide: 0.5 });
  }

  start() {
    if (!this._ready()) return;
    const t = this.ctx.currentTime;
    [0, 7, 12].forEach((n, i) => this._tone(midi(60 + n), t + i * 0.07, 0.5, { type: 'triangle', gain: 0.1 }));
    this._noise(t, 0.6, { gain: 0.06, freq: 300, q: 1, type: 'bandpass', sweep: 8 });
  }

  ui() {
    if (!this._ready()) return;
    this._tone(midi(84), this.ctx.currentTime, 0.08, { type: 'sine', gain: 0.06 });
  }

  pause(on) {
    if (!this.ctx) return;
    this.sfx.gain.setTargetAtTime(on ? 0.4 : 0.9, this.ctx.currentTime, 0.05);
    this.ambFilter.frequency.setTargetAtTime(on ? 200 : 450, this.ctx.currentTime, 0.2);
  }
}
