import { CELLS } from './constants.js';

/** Number of vacated cells kept behind the tail so the renderer can interpolate smoothly. */
export const GHOSTS = 4;

/**
 * Snake body stored as a ring buffer of cell coordinates.
 * Index 0 is the head, index length-1 the tail; indices length..length+GHOSTS-1
 * are recently vacated cells (history) used only for rendering.
 * No allocations after construction.
 */
export class Snake {
  constructor() {
    this.cap = CELLS + GHOSTS + 4;
    this.xs = new Int16Array(this.cap);
    this.ys = new Int16Array(this.cap);
    this.zs = new Int16Array(this.cap);
    this.head = 0;
    this.length = 0;
  }

  _slot(i) {
    let s = this.head + i;
    if (s >= this.cap) s -= this.cap;
    return s;
  }

  x(i) { return this.xs[this._slot(i)]; }
  y(i) { return this.ys[this._slot(i)]; }
  z(i) { return this.zs[this._slot(i)]; }

  /** Lay out a straight snake whose head is at (x,y,z), body trailing along -(dx,dy,dz). */
  reset(x, y, z, dx, dy, dz, length) {
    this.head = 0;
    this.length = length;
    for (let i = 0; i < length + GHOSTS; i++) {
      this.xs[i] = x - dx * i;
      this.ys[i] = y - dy * i;
      this.zs[i] = z - dz * i;
    }
  }

  /** Push a new head. Caller decides whether length grows. */
  push(x, y, z) {
    this.head = this.head === 0 ? this.cap - 1 : this.head - 1;
    this.xs[this.head] = x;
    this.ys[this.head] = y;
    this.zs[this.head] = z;
  }
}
