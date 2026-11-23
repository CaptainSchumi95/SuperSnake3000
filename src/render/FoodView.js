import * as THREE from 'three';
import { HALF, WALL } from '../game/constants.js';

let glowTexture = null;
export function getGlowTexture() {
  if (glowTexture) return glowTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.2, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  glowTexture = new THREE.CanvasTexture(c);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}

// Thin additive lines fade out near the camera so they never fill the screen.
const BEAM_VERT = /* glsl */`
  varying vec2 vUv;
  varying float vNear;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNear = smoothstep(1.0, 3.5, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const BEAM_FRAG = /* glsl */`
  uniform vec3 uColor; uniform float uTime; uniform float uLen; uniform float uOpacity;
  varying vec2 vUv;
  varying float vNear;
  void main() {
    // Clamp: with MSAA, varyings can be extrapolated slightly outside [0,1] and pow(<0) = NaN.
    float y = clamp(vUv.y, 0.0, 1.0);
    float a = pow(y, 1.6) * 0.65 + 0.08;
    float pulse = smoothstep(0.0, 0.2, fract(y * uLen * 0.35 - uTime * 0.9)) * 0.5 + 0.5;
    gl_FragColor = vec4(uColor * a * pulse * uOpacity * vNear, 1.0);
  }`;

function easeOutBack(t) {
  const c1 = 1.9, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/** One collectible: faceted gem with an HDR core, halo, point light and a floor beam. */
class Orb {
  constructor(scene, { color, emissive, geometry, lightColor, haloColor }) {
    this.group = new THREE.Group();
    this.gemMat = new THREE.MeshStandardMaterial({
      color, emissive, emissiveIntensity: 2.4, roughness: 0.15, metalness: 0.3, flatShading: true,
    });
    this.gem = new THREE.Mesh(geometry, this.gemMat);
    this.gem.castShadow = true;
    this.group.add(this.gem);

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 12, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 4, 4) }),
    );
    this.group.add(core);

    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getGlowTexture(), color: haloColor, blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, fog: false,
    }));
    this.halo.scale.setScalar(2.4);
    this.group.add(this.halo);

    this.light = new THREE.PointLight(lightColor, 0, 7, 2);
    this.group.add(this.light);
    scene.add(this.group);

    this.beamMat = new THREE.ShaderMaterial({
      vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG,
      uniforms: { uColor: { value: haloColor.clone() }, uTime: { value: 0 }, uLen: { value: 1 }, uOpacity: { value: 1 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const beamGeo = new THREE.CylinderGeometry(0.03, 0.03, 1, 8, 1, true);
    beamGeo.translate(0, 0.5, 0);
    this.beam = new THREE.Mesh(beamGeo, this.beamMat);
    scene.add(this.beam);

    this.pos = new THREE.Vector3();
    this.appear = 0;     // 0..1 spawn animation
    this.active = false;
    this.blink = 1;
    this.group.visible = false;
    this.beam.visible = false;
  }

  spawn(x, y, z) {
    this.pos.set(x - HALF, y - HALF, z - HALF);
    this.appear = 0;
    this.active = true;
    this.group.visible = true;
    this.beam.visible = true;
  }

  hide() {
    this.active = false;
    this.group.visible = false;
    this.beam.visible = false;
  }

  update(time, dt, lightIntensity) {
    if (!this.active) return;
    this.appear = Math.min(1, this.appear + dt * 2.6);
    const s = easeOutBack(this.appear) * this.blink;
    const bob = Math.sin(time * 2.2) * 0.06;
    this.group.position.set(this.pos.x, this.pos.y + bob, this.pos.z);
    this.group.scale.setScalar(Math.max(0.0001, s));
    this.gem.rotation.set(time * 0.7, time * 1.1, 0);
    this.halo.material.opacity = 0.55 + 0.25 * Math.sin(time * 4.0);
    this.light.intensity = lightIntensity * this.appear * this.blink;

    const h = this.pos.y + WALL;
    this.beam.position.set(this.pos.x, -WALL, this.pos.z);
    this.beam.scale.set(1, Math.max(0.01, h - 0.3), 1);
    this.beamMat.uniforms.uLen.value = h;
    this.beamMat.uniforms.uTime.value = time;
    this.beamMat.uniforms.uOpacity.value = this.appear * this.blink;
  }
}

export class FoodView {
  constructor(scene) {
    this.food = new Orb(scene, {
      color: new THREE.Color(1.0, 0.35, 0.75),
      emissive: new THREE.Color(1.0, 0.25, 0.7),
      geometry: new THREE.IcosahedronGeometry(0.3, 0),
      lightColor: 0xff4fb8,
      haloColor: new THREE.Color(1.6, 0.45, 1.1),
    });
    this.bonus = new Orb(scene, {
      color: new THREE.Color(1.0, 0.8, 0.35),
      emissive: new THREE.Color(1.0, 0.65, 0.15),
      geometry: new THREE.OctahedronGeometry(0.34, 0),
      lightColor: 0xffc04a,
      haloColor: new THREE.Color(1.8, 1.25, 0.4),
    });
    // Ghost copies fly into the head after the sim has already consumed an orb,
    // so the visual swallow lines up with the (interpolated) head reaching it.
    this.ghostFood = this._ghost(scene, this.food);
    this.ghostBonus = this._ghost(scene, this.bonus);
  }

  _ghost(scene, orb) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(orb.gem.geometry, orb.gemMat));
    const halo = new THREE.Sprite(orb.halo.material);
    halo.scale.setScalar(2.0);
    g.add(halo);
    g.visible = false;
    scene.add(g);
    return g;
  }

  update(game, time, dt, active) {
    const b = game.bonus;
    if (b.active && b.time < 2.2) this.bonus.blink = Math.sin(time * 18) > -0.3 ? 1 : 0.35;
    else this.bonus.blink = 1;
    this.food.update(time, dt, active ? 6 : 3);
    this.bonus.update(time, dt, 6);
  }
}

const RAY_FRAG = /* glsl */`
  uniform vec3 uColor; uniform float uTime; uniform float uLen; uniform float uOpacity;
  varying vec2 vUv;
  varying float vNear;
  void main() {
    float y = clamp(vUv.y, 0.0, 1.0);
    float d = fract(y * uLen * 2.0 - uTime * 3.0);
    float dash = smoothstep(0.0, 0.15, d) * (1.0 - smoothstep(0.45, 0.6, d));
    float fade = smoothstep(0.0, 0.25, y) * (0.5 + 0.5 * y);
    gl_FragColor = vec4(uColor * dash * fade * uOpacity * vNear, 1.0);
  }`;

const _dir = new THREE.Vector3();
const _end = new THREE.Vector3();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const C_SAFE = new THREE.Color(0.3, 1.4, 1.3);
const C_WARN = new THREE.Color(1.6, 0.9, 0.2);
const C_DANGER = new THREE.Color(2.0, 0.2, 0.3);

/** Dashed "line of travel" from the head to the next obstacle; turns red when a crash is near. */
export class GuideRay {
  constructor(scene) {
    const geo = new THREE.CylinderGeometry(0.022, 0.022, 1, 6, 1, true);
    geo.translate(0, 0.5, 0);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: BEAM_VERT, fragmentShader: RAY_FRAG,
      uniforms: { uColor: { value: C_SAFE.clone() }, uTime: { value: 0 }, uLen: { value: 1 }, uOpacity: { value: 1 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.freeCells = 99;
  }

  /** Count free cells straight ahead of the simulated head. Cheap; called once per tick. */
  measure(game) {
    const s = game.snake, d = game.dir;
    let n = 0;
    while (n < 20 && !game.wouldCollide(d[0] * (n + 1), d[1] * (n + 1), d[2] * (n + 1))) n++;
    this.freeCells = n;
    const x = s.x(0) + d[0] * (n + 0.5) - HALF;
    const y = s.y(0) + d[1] * (n + 0.5) - HALF;
    const z = s.z(0) + d[2] * (n + 0.5) - HALF;
    _end.set(x, y, z);
    this.endPoint = this.endPoint || new THREE.Vector3();
    this.endPoint.copy(_end);
  }

  update(headPos, time, opacity) {
    if (!this.endPoint || opacity <= 0.001) { this.mesh.visible = false; return; }
    this.mesh.visible = true;
    _dir.subVectors(this.endPoint, headPos);
    const len = Math.max(0.05, _dir.length() - 0.4);
    _dir.normalize();
    _q.setFromUnitVectors(UP, _dir);
    this.mesh.quaternion.copy(_q);
    this.mesh.position.copy(headPos).addScaledVector(_dir, 0.4);
    this.mesh.scale.set(1, len, 1);
    const u = this.mat.uniforms;
    u.uLen.value = len;
    u.uTime.value = time;
    const f = this.freeCells;
    if (f <= 1) u.uColor.value.copy(C_DANGER).multiplyScalar(0.7 + 0.5 * Math.sin(time * 20));
    else if (f <= 3) u.uColor.value.copy(C_WARN);
    else u.uColor.value.copy(C_SAFE);
    u.uOpacity.value = opacity;
  }
}
