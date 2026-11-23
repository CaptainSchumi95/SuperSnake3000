import {
  N, CELLS, cellIndex, inBounds, yawVector,
  CMD_LEFT, CMD_RIGHT, CMD_UP, CMD_DOWN,
  START_RATE, MAX_EXTRA_RATE, RATE_CURVE, START_LENGTH, GROW_PER_FOOD,
  COMBO_WINDOW, MAX_COMBO, BONUS_EVERY, BONUS_LIFETIME,
} from './constants.js';
import { Snake } from './Snake.js';

/** Small, fast, seedable PRNG (mulberry32). */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const QUEUE_MAX = 3;

/**
 * Pure simulation of SuperSnake 3000. Grid based, fixed tick.
 * Knows nothing about rendering; communicates through `onEvent(type, data)`.
 */
export class Game {
  constructor(onEvent = () => {}) {
    this.onEvent = onEvent;
    this.snake = new Snake();
    this.occ = new Uint8Array(CELLS);   // 1 = body
    this.queue = new Int8Array(QUEUE_MAX);
    this.queueLen = 0;
    this.food = { x: 0, y: 0, z: 0 };
    this.bonus = { x: 0, y: 0, z: 0, active: false, time: 0 };
    this.dir = [0, 0, -1];
    this.reset(1);
  }

  reset(seed = (Math.random() * 2 ** 32) >>> 0) {
    this.rng = makeRng(seed);
    this.occ.fill(0);
    this.queueLen = 0;
    this.yaw = 0;
    const f = yawVector(this.yaw);
    this.dir[0] = f[0]; this.dir[1] = f[1]; this.dir[2] = f[2];
    const c = (N - 1) >> 1;
    // Head slightly behind centre so the first seconds have runway ahead.
    this.snake.reset(c, c, c + 2, this.dir[0], this.dir[1], this.dir[2], START_LENGTH);
    for (let i = 0; i < START_LENGTH; i++) {
      this.occ[cellIndex(this.snake.x(i), this.snake.y(i), this.snake.z(i))] = 1;
    }
    this.prevLength = START_LENGTH;
    this.grow = 0;
    this.score = 0;
    this.eaten = 0;
    this.combo = 1;
    this.comboTime = 0;   // seconds left to extend the combo
    this.time = 0;        // simulated seconds
    this.ticks = 0;
    this.alive = true;
    this.won = false;
    this.deathCause = null;
    this.lastTurnTick = -1;
    this.bonus.active = false;
    this._updateRate();
    this.spawnFood();
  }

  _updateRate() {
    this.rate = START_RATE + MAX_EXTRA_RATE * (1 - Math.exp(-this.eaten / RATE_CURVE));
    this.interval = 1 / this.rate;
  }

  get length() { return this.snake.length; }

  isVertical() { return this.dir[1] !== 0; }

  /** Queue a relative command; consumed one per tick so fast double-taps work. */
  enqueue(cmd) {
    if (!this.alive || this.queueLen >= QUEUE_MAX) return false;
    this.queue[this.queueLen++] = cmd;
    return true;
  }

  _dequeue() {
    const c = this.queue[0];
    for (let i = 1; i < this.queueLen; i++) this.queue[i - 1] = this.queue[i];
    this.queueLen--;
    return c;
  }

  /**
   * Controls (camera never rolls; world up is always up):
   *  LEFT/RIGHT – turn 90° in the horizontal plane (also levels out of a climb/dive).
   *  UP/DOWN    – climb/dive. Pressing the opposite one while climbing/diving levels out forward.
   * Returns true if the heading changed. A 180° reversal is impossible by construction.
   */
  applyCommand(cmd, dirOut = this.dir) {
    const d = dirOut;
    if (cmd === CMD_LEFT || cmd === CMD_RIGHT) {
      this.yaw += cmd === CMD_LEFT ? 1 : -1;
      const f = yawVector(this.yaw);
      d[0] = f[0]; d[1] = 0; d[2] = f[2];
      return true;
    }
    const want = cmd === CMD_UP ? 1 : -1;
    if (d[1] === 0) { d[0] = 0; d[1] = want; d[2] = 0; return true; }
    if (d[1] === -want) {
      const f = yawVector(this.yaw);
      d[0] = f[0]; d[1] = 0; d[2] = f[2];
      return true;
    }
    return false; // already moving that way
  }

  /** Preview the heading a command would produce without mutating state. */
  previewDir(cmd, out) {
    out[0] = this.dir[0]; out[1] = this.dir[1]; out[2] = this.dir[2];
    if (cmd < 0) return true;
    const yaw = this.yaw;
    const changed = this.applyCommand(cmd, out);
    this.yaw = yaw;
    return changed;
  }

  /** True if moving the head by d would collide right now. */
  wouldCollide(dx, dy, dz) {
    const s = this.snake;
    const x = s.x(0) + dx, y = s.y(0) + dy, z = s.z(0) + dz;
    if (!inBounds(x, y, z)) return true;
    const i = cellIndex(x, y, z);
    if (!this.occ[i]) return false;
    const L = s.length - 1;
    // Moving into the tail's cell is legal when the tail moves away this tick.
    return !(this.grow === 0 && x === s.x(L) && y === s.y(L) && z === s.z(L));
  }

  /** Advance the simulation by one grid step. */
  tick() {
    if (!this.alive) return;
    while (this.queueLen > 0) {
      if (this.applyCommand(this._dequeue())) { this.lastTurnTick = this.ticks; this.onEvent('turn'); break; }
    }
    const s = this.snake;
    const d = this.dir;
    const nx = s.x(0) + d[0], ny = s.y(0) + d[1], nz = s.z(0) + d[2];

    this.prevLength = s.length;

    if (!inBounds(nx, ny, nz)) return this._die('wall');
    const ni = cellIndex(nx, ny, nz);
    const growing = this.grow > 0;
    const tl = s.length - 1;
    const ti = cellIndex(s.x(tl), s.y(tl), s.z(tl));
    if (this.occ[ni] && !(ni === ti && !growing)) return this._die('self');

    if (growing) { this.grow--; s.length++; } else { this.occ[ti] = 0; }
    s.push(nx, ny, nz);
    this.occ[ni] = 1;

    this.ticks++;
    this.time += this.interval;
    if (this.comboTime > 0) {
      this.comboTime -= this.interval;
      if (this.comboTime <= 0) { this.comboTime = 0; this.combo = 1; this.onEvent('comboEnd'); }
    }

    const fd = this.food;
    if (nx === fd.x && ny === fd.y && nz === fd.z) this._eat(false);

    const b = this.bonus;
    if (b.active) {
      if (nx === b.x && ny === b.y && nz === b.z) {
        b.active = false;
        this._eat(true);
      } else {
        b.time -= this.interval;
        if (b.time <= 0) { b.active = false; this.onEvent('bonusExpired'); }
      }
    }
  }

  _eat(isBonus) {
    if (this.comboTime > 0) this.combo = Math.min(MAX_COMBO, this.combo + 1);
    this.comboTime = COMBO_WINDOW;
    const points = (isBonus ? 50 : 10) * this.combo;
    this.score += points;
    this.grow += isBonus ? 1 : GROW_PER_FOOD;
    const s = this.snake;
    if (isBonus) {
      this.onEvent('bonus', { points, x: s.x(0), y: s.y(0), z: s.z(0), combo: this.combo });
      return;
    }
    this.eaten++;
    this._updateRate();
    this.onEvent('eat', { points, x: s.x(0), y: s.y(0), z: s.z(0), combo: this.combo });
    if (!this.spawnFood()) { this.won = true; this._die('win'); return; }
    if (this.eaten % BONUS_EVERY === 0 && !this.bonus.active) this.spawnBonus();
  }

  _die(cause) {
    this.alive = false;
    this.deathCause = cause;
    this.queueLen = 0;
    this.onEvent('die', { cause });
  }

  _cellFree(x, y, z) {
    if (this.occ[cellIndex(x, y, z)]) return false;
    const f = this.food, b = this.bonus;
    if (x === f.x && y === f.y && z === f.z) return false;
    if (b.active && x === b.x && y === b.y && z === b.z) return false;
    return true;
  }

  /**
   * Pick a fair cell: empty, not right next to the head, not directly in the
   * next couple of steps, preferably a comfortable distance away and (early on)
   * away from the outer shell. Falls back to any empty cell.
   */
  _pickCell(out) {
    const s = this.snake;
    const hx = s.x(0), hy = s.y(0), hz = s.z(0);
    const d = this.dir;
    for (let attempt = 0; attempt < 400; attempt++) {
      const strict = attempt < 250;
      const lo = strict && this.eaten < 12 ? 1 : 0;
      const span = N - lo * 2;
      const x = lo + ((this.rng() * span) | 0);
      const y = lo + ((this.rng() * span) | 0);
      const z = lo + ((this.rng() * span) | 0);
      if (!this._cellFree(x, y, z)) continue;
      const dx = x - hx, dy = y - hy, dz = z - hz;
      const cheb = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
      if (cheb < 2) continue;
      // Not on the head's immediate straight line (would be "free" food).
      const along = dx * d[0] + dy * d[1] + dz * d[2];
      const offAxis = Math.abs(dx - along * d[0]) + Math.abs(dy - along * d[1]) + Math.abs(dz - along * d[2]);
      if (offAxis === 0 && along > 0 && along <= 3) continue;
      if (strict) {
        const man = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
        if (man < 4 || man > 13) continue;
      }
      out.x = x; out.y = y; out.z = z;
      return true;
    }
    // Exhaustive fallback (late game / nearly full board).
    const start = (this.rng() * CELLS) | 0;
    for (let k = 0; k < CELLS; k++) {
      const i = (start + k) % CELLS;
      const x = i % N, y = ((i / N) | 0) % N, z = (i / (N * N)) | 0;
      if (this._cellFree(x, y, z) && !(x === hx && y === hy && z === hz)) {
        out.x = x; out.y = y; out.z = z;
        return true;
      }
    }
    return false;
  }

  spawnFood() {
    const ok = this._pickCell(this.food);
    if (ok) this.onEvent('foodSpawn', this.food);
    return ok;
  }

  spawnBonus() {
    if (this._pickCell(this.bonus)) {
      this.bonus.active = true;
      this.bonus.time = BONUS_LIFETIME;
      this.onEvent('bonusSpawn', this.bonus);
    }
  }
}
