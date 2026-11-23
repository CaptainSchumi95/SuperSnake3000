import * as THREE from 'three';
import { N, WALL } from '../game/constants.js';

export const PALETTE = {
  teal: new THREE.Color(0.1, 0.95, 0.85),
  magenta: new THREE.Color(1.0, 0.3, 0.72),
  gold: new THREE.Color(1.0, 0.78, 0.3),
  danger: new THREE.Color(1.0, 0.12, 0.22),
};

const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }`;

const SKY_FRAG = /* glsl */`
  uniform float uTime;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 top = vec3(0.010, 0.014, 0.040);
    vec3 hor = vec3(0.060, 0.030, 0.120);
    vec3 bot = vec3(0.004, 0.018, 0.030);
    // All pow() bases are clamped: both ternary branches may be evaluated on some GPUs.
    vec3 col = h > 0.0 ? mix(hor, top, pow(max(h, 0.0), 0.55)) : mix(hor, bot, pow(max(-h, 0.0), 0.45));
    float n = (sin(d.x * 3.1 + uTime * 0.03) * sin(d.z * 2.7 + d.y * 4.0)) * 0.5 + 0.5;
    n *= sin(d.x * 7.3 - d.y * 5.1 + d.z * 3.3 + uTime * 0.02) * 0.5 + 0.5;
    col += vec3(0.09, 0.02, 0.13) * pow(max(n, 0.0), 3.0) * (1.0 - abs(h));
    col += vec3(0.00, 0.06, 0.07) * pow(max(1.0 - abs(h), 0.0), 10.0);
    gl_FragColor = vec4(col, 1.0);
  }`;

/**
 * Arena walls. Each face acts as a "radar": it shows where the head, food and
 * bonus project onto it, glows red when the head is about to hit it, and fades
 * when the camera is outside that face. This is the core depth cue of the game.
 */
const WALL_VERT = /* glsl */`
  varying vec3 vPos;
  varying vec3 vN;
  void main() {
    vPos = position;
    vN = normal;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const WALL_FRAG = /* glsl */`
  uniform vec3 uHead, uHeadSim, uFood, uBonus, uCam, uDir;
  uniform float uBonusOn, uHalf, uTime, uHeadOn, uFoodOn;
  uniform vec3 uTeal, uDanger, uFoodCol, uBonusCol;
  varying vec3 vPos;
  varying vec3 vN;

  vec2 planeUV(vec3 p, vec3 n) {
    return abs(n.x) > 0.5 ? p.yz : (abs(n.y) > 0.5 ? p.xz : p.xy);
  }

  float marker(vec3 target, vec3 n, float r0, out float dist, out vec2 axis) {
    vec3 d = vPos - target;
    d -= n * dot(d, n);
    dist = length(d);
    axis = abs(planeUV(d, n));
    return 0.0;
  }

  void main() {
    vec3 n = normalize(vN);
    vec2 uv = planeUV(vPos + uHalf, n);
    vec2 w = fwidth(uv) * 1.3;
    vec2 f = abs(fract(uv) - 0.5);
    vec2 l = smoothstep(0.5 - w, vec2(0.5), f);
    float grid = max(l.x, l.y);

    vec2 e = min(uv, 2.0 * uHalf - uv);
    float ed = min(e.x, e.y);
    float edge = 1.0 - smoothstep(0.0, 0.05 + w.x * 1.5, ed);
    float edgeGlow = exp(-ed * 2.5);

    float pulse = 0.55 + 0.45 * sin(uTime * 13.0);

    // --- head projection ---
    float rh; vec2 ah;
    marker(uHead, n, 0.5, rh, ah);
    // Danger uses the simulated head (the visual head trails it by up to 1.5 cells).
    float wallDist = uHalf - dot(uHeadSim, n);
    float visDist = uHalf - dot(uHead, n);
    float prox = 1.0 - smoothstep(0.5, 8.0, visDist);
    float heading = step(0.5, dot(uDir, n));
    float danger = (1.0 - smoothstep(1.5, 3.5, wallDist)) * heading;
    float hRing = smoothstep(0.36, 0.43, rh) * (1.0 - smoothstep(0.45, 0.52, rh));
    float hDisc = 1.0 - smoothstep(0.0, 0.42, rh);
    float hHalo = exp(-rh * rh * 0.5);
    vec3 headCol = mix(uTeal, uDanger, danger);
    float headI = (hRing * 1.5 + hDisc * 0.25 + hHalo * 0.18) * (0.2 + prox) * uHeadOn;
    headI *= mix(1.0, 0.6 + pulse * 1.6, danger);

    // --- food projection with faint alignment lines across the face ---
    float rf; vec2 af;
    marker(uFood, n, 0.4, rf, af);
    float fRing = smoothstep(0.28, 0.34, rf) * (1.0 - smoothstep(0.36, 0.42, rf));
    float fDot = 1.0 - smoothstep(0.05, 0.14, rf);
    float fHalo = exp(-rf * rf * 1.5);
    float fLine = (1.0 - smoothstep(0.0, 0.035 + w.x, min(af.x, af.y)));
    float foodI = (fRing * 1.3 + fDot * 1.2 + fHalo * 0.2 + fLine * 0.09) * uFoodOn;

    // --- bonus ---
    float rb; vec2 ab;
    marker(uBonus, n, 0.4, rb, ab);
    float bRing = smoothstep(0.30, 0.36, rb) * (1.0 - smoothstep(0.38, 0.45, rb));
    float bonusI = (bRing * 1.4 + exp(-rb * rb * 1.5) * 0.25) * uBonusOn;

    vec3 col = vec3(0.10, 0.36, 0.60) * grid * 0.20;
    col += vec3(0.25, 0.85, 1.0) * edge * 1.8 + vec3(0.10, 0.35, 0.60) * edgeGlow * 0.10;
    col += headCol * headI;
    col += uFoodCol * foodI;
    col += uBonusCol * bonusI;
    // Grid lines light up red around the impact point when about to crash.
    col += uDanger * danger * (grid * hHalo * 1.4 + 0.05 * pulse);

    // Faces the camera is outside of fade out so they never block the view.
    float outside = smoothstep(uHalf - 0.3, uHalf + 1.5, dot(uCam, n));
    col *= mix(1.0, 0.15, outside);
    gl_FragColor = vec4(col, 1.0);
  }`;

const PLANKTON_VERT = /* glsl */`
  attribute float aSeed;
  uniform float uTime, uPixelRatio;
  varying float vA;
  varying vec3 vC;
  void main() {
    vec3 p = position;
    p.x += sin(uTime * 0.13 + aSeed * 6.28) * 1.2;
    p.y += sin(uTime * 0.09 + aSeed * 12.0) * 0.9;
    p.z += cos(uTime * 0.11 + aSeed * 9.0) * 1.2;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    vA = 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * (0.6 + aSeed * 1.8) + aSeed * 40.0));
    vC = mix(vec3(0.2, 0.9, 1.0), vec3(0.85, 0.35, 1.0), fract(aSeed * 7.13));
    gl_PointSize = (1.2 + aSeed * 2.8) * uPixelRatio * (50.0 / max(1.0, -mv.z));
  }`;

const PLANKTON_FRAG = /* glsl */`
  varying float vA;
  varying vec3 vC;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vC * a * a * vA * 0.9, 1.0);
  }`;

const GLOW_FRAG = /* glsl */`
  uniform vec3 uColor; uniform float uTime;
  varying vec2 vUv;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float a = pow(max(0.0, 1.0 - d), 2.2) * (0.85 + 0.15 * sin(uTime * 0.5));
    gl_FragColor = vec4(uColor * a, 1.0);
  }`;
const UV_VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

export class World {
  constructor(scene, renderer) {
    this.scene = scene;
    scene.background = new THREE.Color(0x03040b);
    scene.fog = new THREE.FogExp2(0x070616, 0.012);

    this._buildSky();
    this._buildEnvironment(renderer);
    this._buildLights();
    this._buildArena();
    this._buildAtmosphere();
  }

  _buildSky() {
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      uniforms: { uTime: { value: 0 } },
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(200, 32, 16), this.skyMat);
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    this.scene.add(sky);
  }

  /** Procedural studio for reflections: dark violet void with a teal softbox and a magenta rim panel. */
  _buildEnvironment(renderer) {
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x0b0820);
    const panel = (color, intensity, w, h, pos) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }),
      );
      m.position.copy(pos);
      m.lookAt(0, 0, 0);
      env.add(m);
    };
    panel(0x40fff0, 3.5, 6, 3, new THREE.Vector3(-4, 7, 3));
    panel(0xff4fd8, 2.5, 3, 7, new THREE.Vector3(8, 1, -4));
    panel(0xfff1d6, 5.0, 2, 2, new THREE.Vector3(1, 9, -2));
    panel(0x3050ff, 1.2, 12, 4, new THREE.Vector3(0, -6, 6));
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envTexture = pmrem.fromScene(env, 0.03).texture;
    this.scene.environment = this.envTexture;
    pmrem.dispose();
    env.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }

  _buildLights() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0x4a6dff, 0x2a0b3a, 0.55));

    const key = new THREE.DirectionalLight(0xd8ecff, 2.4);
    key.position.set(2.5, 22, 4);
    key.target.position.set(0, 0, 0);
    key.castShadow = true;
    const sc = key.shadow.camera;
    sc.left = -WALL - 1.5; sc.right = WALL + 1.5; sc.top = WALL + 1.5; sc.bottom = -WALL - 1.5;
    sc.near = 5; sc.far = 40;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.03;
    key.shadow.mapSize.set(2048, 2048);
    this.key = key;
    s.add(key, key.target);

    const rim = new THREE.DirectionalLight(0xff4fd8, 1.1);
    rim.position.set(-9, 4, -11);
    s.add(rim);
  }

  setShadowMapSize(size) {
    const sh = this.key.shadow;
    if (sh.mapSize.x === size) return;
    sh.mapSize.set(size, size);
    if (sh.map) { sh.map.dispose(); sh.map = null; }
  }

  _buildArena() {
    // Floor inside the cube: receives the snake's shadow (vertical position cue).
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(N, N),
      new THREE.MeshStandardMaterial({ color: 0x1b2348, roughness: 0.5, metalness: 0.3, envMapIntensity: 0.6 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -WALL - 0.02;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Plinth gives the arena physical weight beneath the floor.
    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(N + 0.7, 0.6, N + 0.7),
      new THREE.MeshStandardMaterial({ color: 0x0c0f22, roughness: 0.25, metalness: 0.85 }),
    );
    plinth.position.y = -WALL - 0.33;
    this.scene.add(plinth);
    const trim = new THREE.Mesh(
      new THREE.BoxGeometry(N + 0.74, 0.05, N + 0.74),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 1.4, 1.6) }),
    );
    trim.position.y = -WALL - 0.55;
    this.scene.add(trim);

    this.wallMat = new THREE.ShaderMaterial({
      vertexShader: WALL_VERT, fragmentShader: WALL_FRAG,
      uniforms: {
        uHead: { value: new THREE.Vector3() },
        uHeadSim: { value: new THREE.Vector3() },
        uFood: { value: new THREE.Vector3() },
        uBonus: { value: new THREE.Vector3() },
        uCam: { value: new THREE.Vector3() },
        uDir: { value: new THREE.Vector3(0, 0, -1) },
        uBonusOn: { value: 0 },
        uHeadOn: { value: 1 },
        uFoodOn: { value: 1 },
        uHalf: { value: WALL },
        uTime: { value: 0 },
        uTeal: { value: PALETTE.teal.clone().multiplyScalar(1.3) },
        uDanger: { value: PALETTE.danger.clone().multiplyScalar(1.6) },
        uFoodCol: { value: PALETTE.magenta.clone().multiplyScalar(1.4) },
        uBonusCol: { value: PALETTE.gold.clone().multiplyScalar(1.6) },
      },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, fog: false,
    });
    const walls = new THREE.Mesh(new THREE.BoxGeometry(N, N, N), this.wallMat);
    walls.renderOrder = 5;
    this.scene.add(walls);
  }

  _buildAtmosphere() {
    // Drifting bioluminescent plankton: fully GPU animated, zero CPU per frame.
    const COUNT = 1600;
    const pos = new Float32Array(COUNT * 3);
    const seed = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      const r = 14 + Math.pow(Math.random(), 0.7) * 55;
      const t = Math.random() * Math.PI * 2;
      const u = Math.random() * 2 - 1;
      const s = Math.sqrt(1 - u * u);
      pos[i * 3] = r * s * Math.cos(t);
      pos[i * 3 + 1] = r * u * 0.7;
      pos[i * 3 + 2] = r * s * Math.sin(t);
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.planktonMat = new THREE.ShaderMaterial({
      vertexShader: PLANKTON_VERT, fragmentShader: PLANKTON_FRAG,
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(g, this.planktonMat);
    pts.frustumCulled = false;
    this.scene.add(pts);

    // Two slow orbital rings for parallax and scale.
    const ringMat = (c, o) => new THREE.MeshBasicMaterial({
      color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    this.rings = new THREE.Group();
    const r1 = new THREE.Mesh(new THREE.TorusGeometry(15, 0.035, 6, 160), ringMat(new THREE.Color(0.2, 1.2, 1.3), 0.35));
    r1.rotation.x = Math.PI / 2 + 0.18;
    const r2 = new THREE.Mesh(new THREE.TorusGeometry(18.5, 0.025, 6, 180), ringMat(new THREE.Color(1.2, 0.35, 1.0), 0.25));
    r2.rotation.x = Math.PI / 2 - 0.32;
    r2.rotation.y = 0.4;
    this.rings.add(r1, r2);
    this.ring1 = r1; this.ring2 = r2;
    this.scene.add(this.rings);

    // Soft glow in the abyss below the arena.
    this.glowMat = new THREE.ShaderMaterial({
      vertexShader: UV_VERT, fragmentShader: GLOW_FRAG,
      uniforms: { uColor: { value: new THREE.Color(0.10, 0.20, 0.45) }, uTime: { value: 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), this.glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = -WALL - 6;
    this.scene.add(glow);
  }

  /** Per-frame uniform updates only; no allocations. */
  update(time, camera, pixelRatio, head, headSim, dir, food, bonus, bonusOn, headOn, foodOn) {
    this.skyMat.uniforms.uTime.value = time;
    this.planktonMat.uniforms.uTime.value = time;
    this.planktonMat.uniforms.uPixelRatio.value = pixelRatio;
    this.glowMat.uniforms.uTime.value = time;
    const u = this.wallMat.uniforms;
    u.uTime.value = time;
    u.uHead.value.copy(head);
    u.uHeadSim.value.copy(headSim);
    u.uDir.value.copy(dir);
    u.uFood.value.copy(food);
    u.uBonus.value.copy(bonus);
    u.uBonusOn.value = bonusOn;
    u.uHeadOn.value = headOn;
    u.uFoodOn.value = foodOn;
    u.uCam.value.copy(camera.position);
    this.ring1.rotation.z = time * 0.03;
    this.ring2.rotation.z = -time * 0.02;
  }
}
