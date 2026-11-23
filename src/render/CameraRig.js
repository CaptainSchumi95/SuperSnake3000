import * as THREE from 'three';
import { WALL } from '../game/constants.js';

const _desired = new THREE.Vector3();
const _look = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _shake = new THREE.Vector3();

const damp = (k, dt) => 1 - Math.exp(-k * dt);

/**
 * Deliberate, spring-damped camera.
 *  - orbit: slow cinematic orbit of the arena (title / attract mode)
 *  - chase: sits behind and above the head along the snake's *horizontal* facing.
 *           It never rolls, swings smoothly through turns, drops below the head
 *           when climbing and rises when diving so you always see where you go.
 *  - death: slow orbit around the crash site.
 */
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'orbit';
    this.pos = new THREE.Vector3(0, 10, 26);
    this.look = new THREE.Vector3();
    this.yaw = 0;
    this.vert = 0;
    this.transition = 0;
    this.shake = 0;
    this.fovKick = 0;
    this.baseFov = 62;
    this.focus = new THREE.Vector3();
    this.titleOffset = 0; // shifts the arena sideways on the title screen
    camera.position.copy(this.pos);
  }

  setMode(mode, snap = false) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.transition = snap ? 0 : 1.4;
  }

  kick(fov = 3, shake = 0) {
    this.fovKick = Math.max(this.fovKick, fov);
    this.shake = Math.max(this.shake, shake);
  }

  /**
   * @param yawTarget  snake yaw in radians (unbounded, so turns never wrap)
   * @param vertical   -1 diving, 0 level, 1 climbing
   * @param speed01    0..1 progression, widens FOV slightly
   */
  update(dt, time, headPos, yawTarget, vertical, speed01) {
    const cam = this.camera;
    const blend = this.transition > 0 ? 0.35 : 1;
    this.transition = Math.max(0, this.transition - dt);

    const portrait = cam.aspect < 1;
    if (this.mode === 'orbit') {
      const a = time * 0.09;
      // Portrait screens: pull back and lift the arena above the title text.
      const r = portrait ? 25 / Math.max(0.5, cam.aspect) * 0.72 : 25;
      _desired.set(Math.sin(a) * r, 9 + Math.sin(time * 0.23) * 2.5, Math.cos(a) * r);
      _look.set(0, portrait ? -9 : -0.5, 0);
      // Offset the look target to the camera's left so the arena sits right of the title text.
      _right.set(Math.cos(a), 0, -Math.sin(a));
      _look.addScaledVector(_right, -this.titleOffset);
      this.pos.lerp(_desired, damp(1.6 * blend, dt));
      this.look.lerp(_look, damp(2.0 * blend, dt));
      this.yaw = yawTarget;
    } else if (this.mode === 'chase') {
      this.yaw += (yawTarget - this.yaw) * damp(7.5, dt);
      this.vert += (vertical - this.vert) * damp(4.0, dt);
      _fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const v = this.vert;
      const dist = 6.3 + Math.abs(v) * 1.4;
      const height = 3.0 - v * 1.4 + (v < 0 ? -v * 2.0 : 0);
      _desired.copy(headPos).addScaledVector(_fwd, -dist);
      _desired.y += height;
      const lim = WALL + 6;
      _desired.x = Math.max(-lim, Math.min(lim, _desired.x));
      _desired.y = Math.max(-WALL + 0.5, Math.min(lim, _desired.y));
      _desired.z = Math.max(-lim, Math.min(lim, _desired.z));
      _look.copy(headPos).addScaledVector(_fwd, 2.4);
      _look.y += v * 2.6 + 0.2;
      this.pos.lerp(_desired, damp(6.0 * blend, dt));
      this.look.lerp(_look, damp(10.0 * blend, dt));
    } else { // death: wide orbit around the arena, framing the crash site
      const a = time * 0.12;
      _desired.set(Math.sin(a) * 21, 8 + Math.sin(time * 0.3) * 1.5, Math.cos(a) * 21);
      _look.copy(this.focus).multiplyScalar(0.5);
      this.pos.lerp(_desired, damp(1.0, dt));
      this.look.lerp(_look, damp(2.0, dt));
    }

    this.shake = Math.max(0, this.shake - dt * 1.6);
    this.fovKick = Math.max(0, this.fovKick - dt * 9);
    const sh = this.shake * this.shake;
    _shake.set(
      Math.sin(time * 61.0) * sh * 0.45,
      Math.sin(time * 53.0 + 1.3) * sh * 0.45,
      Math.sin(time * 47.0 + 2.1) * sh * 0.45,
    );
    cam.position.copy(this.pos).add(_shake);
    cam.lookAt(this.look);
    // Narrow (portrait) screens get a wider vertical FOV so the sides stay visible.
    const aspectBoost = portrait ? (1 - cam.aspect) * 22 : 0;
    const fov = this.baseFov + aspectBoost + (this.mode === 'chase' ? speed01 * 6 : 0) + this.fovKick;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }
}
