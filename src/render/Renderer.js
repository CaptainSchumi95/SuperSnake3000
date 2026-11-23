import * as THREE from 'three';

/*
 * Lean HDR pipeline (replaces EffectComposer):
 *   1. scene  -> sceneRT   (half-float, MSAA on High; the only multisampled target, one resolve)
 *   2. bloom  -> dual-filter (Kawase) down/up chain on small non-MSAA targets
 *   3. final  -> one full-screen pass: scene + bloom, ACES tone map, sRGB,
 *                vignette, edge chromatic fringe, grain, danger flash
 * EffectComposer ping-ponged through two MSAA targets and paid a resolve per
 * pass; measured on an Iris Xe at 1080p that alone cost ~22 ms/frame.
 */

const FS_VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const PREFILTER_FRAG = /* glsl */`
  uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold; uniform float uKnee;
  varying vec2 vUv;
  vec3 safe(vec3 c) {
    // Guard against NaN/Inf from any shader: they would smear over the whole screen.
    if (!(c.r + c.g + c.b < 1.0e5)) return vec3(0.0);
    return min(max(c, vec3(0.0)), vec3(48.0));
  }
  void main() {
    vec3 s = safe(texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb);
    s += safe(texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb);
    s += safe(texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb);
    s += safe(texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb);
    s *= 0.25;
    float br = max(s.r, max(s.g, s.b));
    float rq = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
    rq = rq * rq / (4.0 * uKnee + 1.0e-4);
    float w = max(rq, br - uThreshold) / max(br, 1.0e-4);
    gl_FragColor = vec4(s * w, 1.0);
  }`;

const DOWN_FRAG = /* glsl */`
  uniform sampler2D tSrc; uniform vec2 uTexel;
  varying vec2 vUv;
  void main() {
    vec2 o = uTexel;
    vec3 s = texture2D(tSrc, vUv).rgb * 4.0;
    s += texture2D(tSrc, vUv - o).rgb;
    s += texture2D(tSrc, vUv + o).rgb;
    s += texture2D(tSrc, vUv + vec2(o.x, -o.y)).rgb;
    s += texture2D(tSrc, vUv - vec2(o.x, -o.y)).rgb;
    gl_FragColor = vec4(s * 0.125, 1.0);
  }`;

const UP_FRAG = /* glsl */`
  uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uRadius;
  varying vec2 vUv;
  void main() {
    vec2 o = uTexel * uRadius;
    vec3 s = texture2D(tSrc, vUv + vec2(-2.0 * o.x, 0.0)).rgb;
    s += texture2D(tSrc, vUv + vec2(-o.x, o.y)).rgb * 2.0;
    s += texture2D(tSrc, vUv + vec2(0.0, 2.0 * o.y)).rgb;
    s += texture2D(tSrc, vUv + vec2(o.x, o.y)).rgb * 2.0;
    s += texture2D(tSrc, vUv + vec2(2.0 * o.x, 0.0)).rgb;
    s += texture2D(tSrc, vUv + vec2(o.x, -o.y)).rgb * 2.0;
    s += texture2D(tSrc, vUv + vec2(0.0, -2.0 * o.y)).rgb;
    s += texture2D(tSrc, vUv + vec2(-o.x, -o.y)).rgb * 2.0;
    gl_FragColor = vec4(s / 12.0, 1.0);
  }`;

const FINAL_FRAG = /* glsl */`
  uniform sampler2D tScene; uniform sampler2D tBloom;
  uniform float uBloom, uExposure, uTime, uFlash, uAberration;
  uniform vec3 uFlashColor;
  varying vec2 vUv;

  // ACES filmic fit (same curve as three.js ACESFilmicToneMapping).
  vec3 RRTAndODTFit(vec3 v) {
    vec3 a = v * (v + 0.0245786) - 0.000090537;
    vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return a / b;
  }
  vec3 aces(vec3 c) {
    const mat3 IN = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
    const mat3 OUT = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
    c *= uExposure / 0.6;
    c = OUT * RRTAndODTFit(IN * c);
    return clamp(c, 0.0, 1.0);
  }
  vec3 toSRGB(vec3 c) {
    return mix(pow(c, vec3(0.41666)) * 1.055 - 0.055, c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308))));
  }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

  void main() {
    vec2 c = vUv - 0.5;
    float r2 = dot(c, c);
    vec2 off = c * r2 * uAberration;
    vec3 col;
    col.g = texture2D(tScene, vUv).g;
    col.r = texture2D(tScene, vUv + off).r;
    col.b = texture2D(tScene, vUv - off).b;
    if (!(col.r + col.g + col.b < 1.0e5)) col = vec3(0.0);
    col = max(col, vec3(0.0)) + texture2D(tBloom, vUv).rgb * uBloom;
    col += uFlashColor * uFlash * (0.15 + r2 * 2.2);
    col = toSRGB(aces(col));
    col *= mix(0.58, 1.0, smoothstep(0.85, 0.2, r2 * 1.6));
    col += (hash(vUv * 1000.0 + uTime) - 0.5) * 0.016;
    gl_FragColor = vec4(col, 1.0);
  }`;

export const QUALITY = {
  high: { maxDpr: 1.5, samples: 4, shadowMap: 2048, bloomLevels: 5, minScale: 0.8 },
  low: { maxDpr: 1, samples: 0, shadowMap: 1024, bloomLevels: 4, minScale: 0.6 },
};

/**
 * Owns the WebGL renderer and the post pipeline; handles resize and adaptive
 * quality (resolution scale first, then — in Auto mode — the lighter preset).
 */
export class Renderer {
  constructor(canvas, scene, camera, quality = 'auto') {
    this.scene = scene;
    this.camera = camera;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true,
    });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NoToneMapping; // done in the final pass
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;

    this.bloomStrength = 1.3;
    this.exposure = 1.05;
    this._initPost();

    this.dprScale = 1;
    this._frameAcc = 0;
    this._frameN = 0;
    this._slowWindows = 0;
    this._fastWindows = 0;
    this.setQuality(quality);
    window.addEventListener('resize', () => this.resize());
  }

  _initPost() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    const mk = (frag, uniforms, blending = THREE.NoBlending) => new THREE.ShaderMaterial({
      vertexShader: FS_VERT, fragmentShader: frag, uniforms,
      depthTest: false, depthWrite: false, blending,
    });
    this.matPrefilter = mk(PREFILTER_FRAG, {
      tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 0.65 }, uKnee: { value: 0.45 },
    });
    this.matDown = mk(DOWN_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.matUp = mk(UP_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1.0 } }, THREE.AdditiveBlending);
    this.matFinal = mk(FINAL_FRAG, {
      tScene: { value: null }, tBloom: { value: null },
      uBloom: { value: 1 }, uExposure: { value: 1 }, uTime: { value: 0 }, uFlash: { value: 0 },
      uAberration: { value: 0.024 }, uFlashColor: { value: new THREE.Color(1, 0.15, 0.25) },
    });
    this.quad = new THREE.Mesh(geo, this.matFinal);
    this.quad.frustumCulled = false;
    this.postScene = new THREE.Scene();
    this.postScene.add(this.quad);
    this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.mips = [];
  }

  /** mode: 'auto' (starts high, steps down to low if the GPU can't keep up), 'high' or 'low'. */
  setQuality(mode) {
    this.mode = ['auto', 'high', 'low'].includes(mode) ? mode : 'auto';
    this._applyPreset(this.mode === 'low' ? 'low' : 'high');
  }

  _applyPreset(name) {
    this.presetName = name;
    this.quality = QUALITY[name];
    this.dprScale = 1;
    this._slowWindows = 0;
    this._fastWindows = 0;
    this._buildTargets();
    this.resize();
    if (this.onQualityChange) this.onQualityChange(this.quality);
  }

  _buildTargets() {
    if (this.sceneRT) this.sceneRT.dispose();
    for (const m of this.mips) m.dispose();
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: this.quality.samples });
    this.mips = [];
    for (let i = 0; i < this.quality.bloomLevels; i++) {
      this.mips.push(new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false }));
    }
  }

  get pixelRatio() {
    return Math.min(window.devicePixelRatio || 1, this.quality.maxDpr) * this.dprScale;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = this.pixelRatio;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    const bw = Math.max(1, Math.round(w * pr)), bh = Math.max(1, Math.round(h * pr));
    this.sceneRT.setSize(bw, bh);
    let mw = bw, mh = bh;
    for (const m of this.mips) {
      mw = Math.max(1, mw >> 1); mh = Math.max(1, mh >> 1);
      m.setSize(mw, mh);
    }
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Called once per frame with the real (unclamped) frame time in seconds. */
  adapt(frameDt) {
    this._frameAcc += frameDt;
    this._frameN++;
    if (this._frameAcc < 1.0) return;
    const avg = this._frameAcc / this._frameN;
    this._frameAcc = 0; this._frameN = 0;
    if (document.hidden) return;
    if (avg > 1 / 48) { this._slowWindows++; this._fastWindows = 0; }
    else if (avg < 1 / 57) { this._fastWindows++; this._slowWindows = 0; }
    else { this._slowWindows = 0; this._fastWindows = 0; }
    if (this._slowWindows >= 2) {
      this._slowWindows = 0;
      if (this.dprScale > this.quality.minScale) {
        this.dprScale = Math.max(this.quality.minScale, this.dprScale - 0.1);
        this.resize();
      } else if (this.mode === 'auto' && this.presetName === 'high') {
        // Resolution alone isn't enough: switch to the lighter pipeline at full sharpness.
        this._applyPreset('low');
      }
    } else if (this._fastWindows >= 8 && this.dprScale < 1) {
      this.dprScale = Math.min(1, this.dprScale + 0.1);
      this._fastWindows = 0;
      this.resize();
    }
  }

  _pass(material, target, clear = true) {
    const r = this.renderer;
    this.quad.material = material;
    r.setRenderTarget(target);
    const ac = r.autoClear;
    r.autoClear = clear;
    r.render(this.postScene, this.postCam);
    r.autoClear = ac;
  }

  render(time, flash) {
    const r = this.renderer;
    r.setRenderTarget(this.sceneRT);
    r.render(this.scene, this.camera);

    // Bloom: prefilter (threshold + NaN guard) at half res, then dual-filter down/up.
    const mips = this.mips;
    const pf = this.matPrefilter.uniforms;
    pf.tSrc.value = this.sceneRT.texture;
    pf.uTexel.value.set(1 / this.sceneRT.width, 1 / this.sceneRT.height);
    this._pass(this.matPrefilter, mips[0]);
    const dn = this.matDown.uniforms;
    for (let i = 1; i < mips.length; i++) {
      dn.tSrc.value = mips[i - 1].texture;
      dn.uTexel.value.set(1 / mips[i - 1].width, 1 / mips[i - 1].height);
      this._pass(this.matDown, mips[i]);
    }
    const up = this.matUp.uniforms;
    for (let i = mips.length - 1; i > 0; i--) {
      up.tSrc.value = mips[i].texture;
      up.uTexel.value.set(1 / mips[i].width, 1 / mips[i].height);
      this._pass(this.matUp, mips[i - 1], false); // additive accumulate
    }

    const f = this.matFinal.uniforms;
    f.tScene.value = this.sceneRT.texture;
    f.tBloom.value = mips[0].texture;
    f.uBloom.value = this.bloomStrength / mips.length;
    f.uExposure.value = this.exposure;
    f.uTime.value = time % 100;
    f.uFlash.value = flash;
    this._pass(this.matFinal, null);
  }
}
