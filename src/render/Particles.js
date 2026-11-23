import * as THREE from 'three';

const VERT = /* glsl */`
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aAlpha;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uPixelRatio * (300.0 / max(0.5, -mv.z));
    vColor = aColor;
    vAlpha = aAlpha;
  }`;

const FRAG = /* glsl */`
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    if (vAlpha <= 0.0) discard;
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float core = smoothstep(1.0, 0.0, d);
    gl_FragColor = vec4(vColor * (core * core + core * 0.4) * vAlpha, 1.0);
  }`;

/**
 * Fixed-size pooled particle system (one draw call, additive). Emission reuses
 * slots in a ring; nothing is allocated after construction.
 */
export class Particles {
  constructor(scene, capacity = 2048) {
    this.cap = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity);
    this.next = 0;
    this.active = 0;

    const g = new THREE.BufferGeometry();
    const mk = (arr, n) => new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
    this.aPos = mk(this.pos, 3);
    this.aCol = mk(this.col, 3);
    this.aSize = mk(this.size, 1);
    this.aAlpha = mk(this.alpha, 1);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aColor', this.aCol);
    g.setAttribute('aSize', this.aSize);
    g.setAttribute('aAlpha', this.aAlpha);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uPixelRatio: { value: 1 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
  }

  /**
   * Emit `count` particles at (x,y,z). Color is a THREE.Color (HDR values allowed).
   * `dir` (optional THREE.Vector3) biases the velocity.
   */
  emit(x, y, z, count, color, speed = 3, size = 0.25, life = 0.9, spread = 0.1, dir = null) {
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.cap;
      const i3 = i * 3;
      // random direction on a sphere
      const u = Math.random() * 2 - 1;
      const t = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const sp = speed * (0.35 + Math.random() * 0.65);
      let vx = s * Math.cos(t) * sp, vy = u * sp, vz = s * Math.sin(t) * sp;
      if (dir) { vx += dir.x; vy += dir.y; vz += dir.z; }
      this.pos[i3] = x + (Math.random() - 0.5) * spread;
      this.pos[i3 + 1] = y + (Math.random() - 0.5) * spread;
      this.pos[i3 + 2] = z + (Math.random() - 0.5) * spread;
      this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
      const k = 0.75 + Math.random() * 0.5;
      this.col[i3] = color.r * k; this.col[i3 + 1] = color.g * k; this.col[i3 + 2] = color.b * k;
      this.maxLife[i] = this.life[i] = life * (0.6 + Math.random() * 0.6);
      this.size0[i] = size * (0.6 + Math.random() * 0.8);
      this.alpha[i] = 1;
    }
    this.active = this.cap; // conservative; recomputed in update
  }

  update(dt, pixelRatio) {
    this.material.uniforms.uPixelRatio.value = pixelRatio;
    if (this.active === 0) return;
    let alive = 0;
    const drag = Math.exp(-2.6 * dt);
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) { if (this.alpha[i] !== 0) { this.alpha[i] = 0; this.size[i] = 0; } continue; }
      alive++;
      this.life[i] -= dt;
      const i3 = i * 3;
      this.vel[i3] *= drag; this.vel[i3 + 1] = this.vel[i3 + 1] * drag + 0.6 * dt; this.vel[i3 + 2] *= drag;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const f = Math.max(0, this.life[i] / this.maxLife[i]);
      this.alpha[i] = f * f * (3 - 2 * f);
      this.size[i] = this.size0[i] * (0.4 + 0.6 * f);
    }
    this.active = alive;
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aAlpha.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.alpha.fill(0);
    this.size.fill(0);
    this.active = 1; // flush once
  }
}
