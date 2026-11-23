import { N, CELLS, cellIndex, inBounds, CMD_LEFT, CMD_RIGHT, CMD_UP, CMD_DOWN } from './constants.js';

const CMDS = [-1, CMD_LEFT, CMD_RIGHT, CMD_UP, CMD_DOWN];

/**
 * Simple greedy AI with a flood-fill safety check. Used for the title-screen
 * attract mode (and handy for soak-testing the simulation).
 */
export class Autopilot {
  constructor() {
    this.stamp = new Uint32Array(CELLS);
    this.gen = 1;
    this.stack = new Int32Array(CELLS);
    this.tmp = [0, 0, 0];
  }

  _reachable(game, sx, sy, sz, limit) {
    const occ = game.occ;
    const gen = ++this.gen;
    let top = 0, count = 0;
    this.stack[top++] = cellIndex(sx, sy, sz);
    this.stamp[cellIndex(sx, sy, sz)] = gen;
    while (top > 0 && count < limit) {
      const i = this.stack[--top];
      count++;
      const x = i % N, y = ((i / N) | 0) % N, z = (i / (N * N)) | 0;
      for (let k = 0; k < 6; k++) {
        const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
        const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
        const nz = z + (k === 4 ? 1 : k === 5 ? -1 : 0);
        if (!inBounds(nx, ny, nz)) continue;
        const j = cellIndex(nx, ny, nz);
        if (occ[j] || this.stamp[j] === gen) continue;
        this.stamp[j] = gen;
        this.stack[top++] = j;
      }
    }
    return count;
  }

  /** Returns the best command (or -1 to keep going). */
  decide(game) {
    const s = game.snake;
    const hx = s.x(0), hy = s.y(0), hz = s.z(0);
    const f = game.bonus.active ? game.bonus : game.food;
    const need = Math.min(80, s.length + 4);
    let best = -1, bestScore = -Infinity;
    for (let c = 0; c < CMDS.length; c++) {
      const cmd = CMDS[c];
      const d = this.tmp;
      if (!game.previewDir(cmd, d) && cmd >= 0) continue;
      if (game.wouldCollide(d[0], d[1], d[2])) continue;
      const nx = hx + d[0], ny = hy + d[1], nz = hz + d[2];
      const dist = Math.abs(f.x - nx) + Math.abs(f.y - ny) + Math.abs(f.z - nz);
      const room = this._reachable(game, nx, ny, nz, need);
      let score = -dist + (room >= need ? 0 : -200 + room) + (cmd < 0 ? 0.4 : 0) + Math.random() * 0.3;
      if (score > bestScore) { bestScore = score; best = cmd; }
    }
    return best;
  }
}
