// Shared, renderer-agnostic constants for the simulation.

/** Cells per arena edge. Odd so there is a true centre cell. */
export const N = 13;
export const CELLS = N * N * N;
/** World-space offset so the arena is centred on the origin (cell c -> c - HALF). */
export const HALF = (N - 1) / 2;
/** Half extent of the arena box in world units (walls sit at ±WALL). */
export const WALL = N / 2;

export const cellIndex = (x, y, z) => x + y * N + z * N * N;
export const inBounds = (x, y, z) =>
  x >= 0 && y >= 0 && z >= 0 && x < N && y < N && z < N;

// Commands are relative to the snake (see Game.applyCommand).
export const CMD_LEFT = 0;
export const CMD_RIGHT = 1;
export const CMD_UP = 2;
export const CMD_DOWN = 3;

/** Horizontal forward vector for a yaw step (0 = -Z, +1 = 90° to the left). */
export function yawVector(yaw) {
  const k = ((yaw % 4) + 4) % 4;
  switch (k) {
    case 0: return [0, 0, -1];
    case 1: return [-1, 0, 0];
    case 2: return [0, 0, 1];
    default: return [1, 0, 0];
  }
}

// Difficulty / scoring tuning.
export const START_RATE = 6.0;       // cells per second at the start
export const MAX_EXTRA_RATE = 7.0;   // asymptotic extra speed
export const RATE_CURVE = 20;        // foods to reach ~63% of the extra speed
export const START_LENGTH = 4;
export const GROW_PER_FOOD = 2;
export const COMBO_WINDOW = 5.0;     // seconds between foods to keep a combo
export const MAX_COMBO = 5;
export const BONUS_EVERY = 4;        // a golden orb appears after every Nth food
export const BONUS_LIFETIME = 7.0;   // seconds
