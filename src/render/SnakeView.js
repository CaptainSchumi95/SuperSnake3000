import * as THREE from 'three';
import { CELLS, HALF } from '../game/constants.js';

const SUB = 4;                 // body spheres per cell
const SP = 1 / SUB;            // spacing in cell units
const CAP = CELLS * SUB + 16;  // instance capacity (whole arena)
const R_BASE = 0.40;
const MAX_BULGES = 12;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _f = new THREE.Vector3();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _back = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

// Body colour ramp (linear HDR-ish values; stripes multiply these).
const C_HEAD = new THREE.Color(0.02, 0.85, 0.62);
const C_MID = new THREE.Color(0.05, 0.30, 1.00);
const C_TAIL = new THREE.Color(0.75, 0.10, 0.90);
const C_DEAD = new THREE.Color(1.6, 0.25, 0.35);
const _c = new THREE.Color();

function bodyMaterial() {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.38,
    metalness: 0.1,
    clearcoat: 0.85,
    clearcoatRoughness: 0.22,
    iridescence: 0.45,
    iridescenceIOR: 1.35,
    iridescenceThicknessRange: [180, 520],
    emissive: 0xffffff,
    emissiveIntensity: 0.22,
    envMapIntensity: 0.8,
  });
  mat.onBeforeCompile = (sh) => {
    // Tint emissive per instance so stripes and swallowed orbs glow.
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n totalEmissiveRadiance *= vColor;\n#endif',
    );
    // Coils that pass close to the camera dissolve with an ordered dither, so
    // your own body never blocks the view.
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', `
        const float BAYER[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
        void main() {`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        {
          float camFade = smoothstep(1.6, 3.6, length(vViewPosition));
          vec2 bp = mod(floor(gl_FragCoord.xy), 4.0);
          if (camFade < (BAYER[int(bp.x + bp.y * 4.0)] + 0.5) / 16.0) discard;
        }`);
  };
  return mat;
}

/**
 * Renders the snake from the grid simulation.
 *
 * The body is a smooth curve through cell centres with every 90° corner rounded
 * by a quadratic Bézier. The visual head trails the simulated head by half a
 * cell, so a turn decided on a tick begins curving exactly at that tick with no
 * popping. Body spheres are sampled along the curve by arc length, so stripes
 * and swallow-bulges travel with the body naturally.
 */
export class SnakeView {
  constructor(scene, particles) {
    this.scene = scene;
    this.particles = particles;

    this.material = bodyMaterial();
    const geo = new THREE.SphereGeometry(1, 18, 12);
    this.body = new THREE.InstancedMesh(geo, this.material, CAP);
    this.body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.body.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
    this.body.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.body.castShadow = true;
    this.body.frustumCulled = false;
    this.body.count = 0;
    scene.add(this.body);

    this.P = new Float32Array(CAP * 3);  // centreline samples
    this.R = new Float32Array(CAP);      // radii

    this.bulges = new Float32Array(MAX_BULGES);
    this.bulgeCount = 0;

    this._buildHead();

    this.headPos = new THREE.Vector3();
    this.headForward = new THREE.Vector3(0, 0, -1);
    this.prevUp = new THREE.Vector3(0, 1, 0);
    this.gulp = 0;
    this.tongueT = 0;
    this.visible = true;
    this.dissolved = 0;
  }

  _buildHead() {
    const head = new THREE.Group();
    this.headMat = new THREE.MeshPhysicalMaterial({
      color: C_HEAD, roughness: 0.32, metalness: 0.1, clearcoat: 0.9, clearcoatRoughness: 0.15,
      iridescence: 0.5, iridescenceIOR: 1.35, emissive: C_HEAD, emissiveIntensity: 0.3, envMapIntensity: 0.8,
    });
    const skull = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), this.headMat);
    skull.scale.set(0.47, 0.38, 0.62);
    skull.position.z = -0.08;
    skull.castShadow = true;
    head.add(skull);

    const brow = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), this.headMat);
    brow.scale.set(0.42, 0.3, 0.45);
    brow.position.set(0, 0.08, 0.12);
    head.add(brow);

    this.eyeMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(0.9, 1.0, 0.95), emissiveIntensity: 3.2 });
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x020205 });
    const eyeGeo = new THREE.SphereGeometry(0.105, 16, 12);
    const pupilGeo = new THREE.SphereGeometry(0.06, 12, 8);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, this.eyeMat);
      eye.position.set(sx * 0.25, 0.17, -0.3);
      head.add(eye);
      const pupil = new THREE.Mesh(pupilGeo, pupilMat);
      pupil.scale.set(0.35, 1.15, 0.6);
      pupil.position.set(sx * 0.29, 0.19, -0.37);
      head.add(pupil);
    }

    // Forked tongue that flicks every few seconds.
    const tongueMat = new THREE.MeshStandardMaterial({ color: 0xff2a55, emissive: 0xff1040, emissiveIntensity: 1.6 });
    const tongue = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.015, 0.32), tongueMat);
    stem.position.z = -0.16;
    tongue.add(stem);
    for (const sx of [-1, 1]) {
      const fork = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.012, 0.12), tongueMat);
      fork.position.set(sx * 0.03, 0, -0.36);
      fork.rotation.y = sx * -0.45;
      tongue.add(fork);
    }
    tongue.position.set(0, -0.08, -0.6);
    tongue.scale.z = 0.001;
    head.add(tongue);
    this.tongue = tongue;

    this.head = head;
    this.scene.add(head);
  }

  reset() {
    this.bulgeCount = 0;
    this.gulp = 0;
    this.dissolved = 0;
    this.prevUp.set(0, 1, 0);
    this.head.visible = true;
    this.head.scale.setScalar(1);
    this._snapHead = true;
  }

  /** Start a swallow bulge travelling from the head down the body. */
  swallow() {
    if (this.bulgeCount < MAX_BULGES) this.bulges[this.bulgeCount++] = 0;
    this.gulp = 1;
  }

  /** Point on the smoothed path at distance u (cells) behind the simulated head. */
  _eval(s, u, out) {
    if (u < 0.5) {
      // Straight segment c0 -> c1 (also extrapolates for u < 0).
      const x0 = s.x(0), y0 = s.y(0), z0 = s.z(0);
      out.set(
        x0 + (s.x(1) - x0) * u - HALF,
        y0 + (s.y(1) - y0) * u - HALF,
        z0 + (s.z(1) - z0) * u - HALF,
      );
      return out;
    }
    const k = Math.floor(u);
    const f = u - k;
    let v, t;
    if (f < 0.5) { v = k; t = f + 0.5; } else { v = k + 1; t = f - 0.5; }
    const px = s.x(v - 1), py = s.y(v - 1), pz = s.z(v - 1);
    const vx = s.x(v), vy = s.y(v), vz = s.z(v);
    const nx = s.x(v + 1), ny = s.y(v + 1), nz = s.z(v + 1);
    // Bézier from mid(P,V) via V to mid(V,N)
    const it = 1 - t;
    const w0 = it * it * 0.5, w1 = 2 * t * it, w2 = t * t * 0.5;
    out.set(
      w0 * (px + vx) + w1 * vx + w2 * (vx + nx) - HALF,
      w0 * (py + vy) + w1 * vy + w2 * (vy + ny) - HALF,
      w0 * (pz + vz) + w1 * vz + w2 * (vz + nz) - HALF,
    );
    return out;
  }

  /**
   * @param game     simulation
   * @param alpha    interpolation factor between ticks (0..1)
   * @param push     extra forward travel of the head (used for the crash lunge), cells
   * @param time     seconds
   * @param dt       frame delta
   * @param dissolve -1 when alive, else 0..1 death dissolve progress
   */
  update(game, alpha, push, time, dt, dissolve) {
    const s = game.snake;
    const uh = 1.5 - alpha - push;
    const lv = game.prevLength + alpha * (game.length - game.prevLength);
    const bodyLen = Math.max(0.5, lv - 1);
    let count = Math.floor(bodyLen / SP) + 1;
    if (count > CAP) count = CAP;
    const pathPos = game.ticks + alpha + push; // absolute travelled distance of the head

    // Advance swallow bulges.
    for (let i = 0; i < this.bulgeCount; i++) {
      this.bulges[i] += dt * 7.5;
      if (this.bulges[i] > bodyLen + 1) {
        this.bulges[i] = this.bulges[--this.bulgeCount];
        i--;
      }
    }

    // Pass 1: centreline + radii.
    const P = this.P, R = this.R;
    const taperLen = Math.min(4.0, bodyLen * 0.6);
    for (let j = 0; j < count; j++) {
      const sj = j * SP;
      this._eval(s, uh + sj, _a);
      P[j * 3] = _a.x; P[j * 3 + 1] = _a.y; P[j * 3 + 2] = _a.z;
      const tt = Math.min(1, Math.max(0, (bodyLen - sj) / taperLen));
      let r = R_BASE * (0.3 + 0.7 * Math.sqrt(tt));
      if (sj < 1) r *= 0.9 + 0.1 * sj;
      r *= 1 + 0.035 * Math.sin(time * 3.2 - sj * 1.3);
      for (let b = 0; b < this.bulgeCount; b++) {
        const d = (sj - this.bulges[b]) / 0.55;
        r *= 1 + 0.32 * Math.exp(-d * d);
      }
      R[j] = r;
    }

    // Pass 2: lateral slither (wave fixed along the path, like a real snake) + write instances.
    const mat = this.body.instanceMatrix.array;
    const col = this.body.instanceColor.array;
    const dissolveS = dissolve >= 0 ? dissolve * (bodyLen + 1) - 0.5 : -1;
    let emitFrom = this.dissolved;
    for (let j = 0; j < count; j++) {
      const sj = j * SP;
      const j0 = j > 0 ? j - 1 : j, j1 = j < count - 1 ? j + 1 : j;
      // tangent (towards head)
      let tx = P[j0 * 3] - P[j1 * 3], tz = P[j0 * 3 + 2] - P[j1 * 3 + 2];
      const ty = P[j0 * 3 + 1] - P[j1 * 3 + 1];
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl; tz /= tl;
      // side = T x Y (fades out naturally on vertical stretches)
      const env = Math.min(1, sj * 0.7) * 0.075;
      const wave = Math.sin((pathPos - sj) * 2.3 + time * 1.2) * env;
      const x = P[j * 3] - tz * wave;
      const y = P[j * 3 + 1];
      const z = P[j * 3 + 2] + tx * wave;

      let r = R[j];
      if (dissolve >= 0 && sj < dissolveS) {
        if (j >= emitFrom) {
          this.particles.emit(x, y, z, 3, _c.copy(C_DEAD).lerp(C_MID, Math.random() * 0.5), 2.2, 0.32, 1.1, 0.4);
          emitFrom = j + 1;
        }
        r = 0;
      }

      const o = j * 16;
      mat[o] = r; mat[o + 1] = 0; mat[o + 2] = 0; mat[o + 3] = 0;
      mat[o + 4] = 0; mat[o + 5] = r; mat[o + 6] = 0; mat[o + 7] = 0;
      mat[o + 8] = 0; mat[o + 9] = 0; mat[o + 10] = r; mat[o + 11] = 0;
      mat[o + 12] = x; mat[o + 13] = y; mat[o + 14] = z; mat[o + 15] = 1;

      // Colour: gradient along the body, chevron stripes, glow where an orb is being swallowed.
      const g = sj / Math.max(1, bodyLen);
      if (g < 0.45) _c.copy(C_HEAD).lerp(C_MID, g / 0.45);
      else _c.copy(C_MID).lerp(C_TAIL, (g - 0.45) / 0.55);
      const stripe = 0.5 + 0.5 * Math.cos(sj * Math.PI * 2 / 1.5);
      let k = 0.42 + 0.8 * stripe * stripe;
      for (let b = 0; b < this.bulgeCount; b++) {
        const d = (sj - this.bulges[b]) / 0.5;
        k += 2.2 * Math.exp(-d * d);
      }
      if (dissolve >= 0) { _c.lerp(C_DEAD, Math.min(1, dissolve * 4 + 0.3)); k *= 1.4; }
      col[j * 3] = _c.r * k; col[j * 3 + 1] = _c.g * k; col[j * 3 + 2] = _c.b * k;
    }
    this.dissolved = emitFrom;
    this.body.count = count;
    const im = this.body.instanceMatrix, ic = this.body.instanceColor;
    if (im.addUpdateRange) {
      im.clearUpdateRanges(); im.addUpdateRange(0, count * 16);
      ic.clearUpdateRanges(); ic.addUpdateRange(0, count * 3);
    }
    im.needsUpdate = true;
    ic.needsUpdate = true;

    this._updateHead(s, uh, time, dt, dissolve);
  }

  _updateHead(s, uh, time, dt, dissolve) {
    this._eval(s, uh, this.headPos);
    this._eval(s, uh - 0.12, _a);
    this._eval(s, uh + 0.12, _b);
    _f.subVectors(_a, _b).normalize();
    this.headForward.copy(_f);

    // Up = world up projected off the forward axis; keep previous up when diving/climbing.
    _up.copy(Y).addScaledVector(_f, -_f.dot(Y));
    if (_up.lengthSq() < 0.04) _up.copy(this.prevUp).addScaledVector(_f, -_f.dot(this.prevUp));
    _up.normalize();
    this.prevUp.copy(_up);
    _back.copy(_f).negate();
    _right.crossVectors(_up, _back).normalize();
    _m.makeBasis(_right, _up, _back);
    _q.setFromRotationMatrix(_m);
    if (this._snapHead) { this.head.quaternion.copy(_q); this._snapHead = false; }
    else this.head.quaternion.slerp(_q, 1 - Math.exp(-28 * dt));
    this.head.position.copy(this.headPos);

    this.gulp = Math.max(0, this.gulp - dt * 4);
    const g = this.gulp;
    const sc = 1 + 0.22 * Math.sin(g * Math.PI) ;
    this.head.scale.set(sc, sc, sc);

    // Tongue flick.
    this.tongueT += dt;
    const period = 2.6;
    const ph = this.tongueT % period;
    const flick = ph < 0.32 ? Math.sin((ph / 0.32) * Math.PI) : 0;
    this.tongue.scale.z = 0.001 + flick;
    this.tongue.rotation.x = Math.sin(time * 40) * 0.12 * flick;

    if (dissolve >= 0 && this.head.visible) {
      this.head.visible = false;
      _c.setRGB(1.6, 0.4, 0.5);
      this.particles.emit(this.headPos.x, this.headPos.y, this.headPos.z, 70, _c, 6, 0.45, 1.3, 0.3);
      _c.setRGB(0.6, 1.8, 1.6);
      this.particles.emit(this.headPos.x, this.headPos.y, this.headPos.z, 30, _c, 3.5, 0.3, 1.0, 0.3);
    }
  }
}
