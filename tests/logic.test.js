// Headless tests for the simulation layer. Run: npm test
import assert from 'node:assert/strict';
import { Game } from '../src/game/Game.js';
import { Autopilot } from '../src/game/Autopilot.js';
import { N, cellIndex, CMD_LEFT, CMD_RIGHT, CMD_UP, CMD_DOWN, START_LENGTH } from '../src/game/constants.js';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { console.error('  ✗', name); throw e; }
}

const head = (g) => [g.snake.x(0), g.snake.y(0), g.snake.z(0)];
function occupiedCount(g) { let c = 0; for (const v of g.occ) c += v; return c; }
function placeFoodFarAway(g) { g.food.x = 0; g.food.y = 0; g.food.z = 0; }

console.log('SuperSnake 3000 – simulation tests');

test('starts alive, length 4, moving -Z', () => {
  const g = new Game();
  assert.equal(g.alive, true);
  assert.equal(g.length, START_LENGTH);
  assert.deepEqual(g.dir, [0, 0, -1]);
  assert.equal(occupiedCount(g), START_LENGTH);
});

test('moves one cell per tick and keeps length', () => {
  const g = new Game(); placeFoodFarAway(g);
  const [x, y, z] = head(g);
  g.tick();
  assert.deepEqual(head(g), [x, y, z - 1]);
  assert.equal(g.length, START_LENGTH);
  assert.equal(occupiedCount(g), START_LENGTH);
});

test('relative turns: left, right, up, down are genuinely 3D', () => {
  const g = new Game(); placeFoodFarAway(g);
  g.enqueue(CMD_LEFT); g.tick();
  assert.deepEqual(g.dir, [-1, 0, 0]);
  g.enqueue(CMD_UP); g.tick();
  assert.deepEqual(g.dir, [0, 1, 0]);
  const yBefore = g.snake.y(0);
  g.tick();
  assert.equal(g.snake.y(0), yBefore + 1, 'climbing changes Y');
  g.enqueue(CMD_DOWN); g.tick(); // levels out forward (facing -X)
  assert.deepEqual(g.dir, [-1, 0, 0]);
  g.enqueue(CMD_DOWN); g.tick();
  assert.deepEqual(g.dir, [0, -1, 0]);
  g.enqueue(CMD_RIGHT); g.tick(); // from a dive, right of facing(-X) is -Z
  assert.deepEqual(g.dir, [0, 0, -1]);
  assert.equal(g.alive, true);
});

test('repeated command while climbing is ignored, no reversal possible', () => {
  const g = new Game(); placeFoodFarAway(g);
  g.enqueue(CMD_UP); g.tick();
  g.enqueue(CMD_UP); g.tick();
  assert.deepEqual(g.dir, [0, 1, 0]);
});

test('queued double-tap performs a U-turn over two ticks', () => {
  const g = new Game(); placeFoodFarAway(g);
  g.enqueue(CMD_LEFT); g.enqueue(CMD_LEFT);
  g.tick(); assert.deepEqual(g.dir, [-1, 0, 0]);
  g.tick(); assert.deepEqual(g.dir, [0, 0, 1]);
  assert.equal(g.alive, true);
});

test('eating increases score and length, respawns food in a free cell', () => {
  const g = new Game();
  const events = [];
  g.onEvent = (t) => events.push(t);
  const [x, y, z] = head(g);
  g.food.x = x; g.food.y = y; g.food.z = z - 1;
  g.tick();
  assert.equal(g.score, 10);
  assert.ok(events.includes('eat'));
  assert.equal(g.occ[cellIndex(g.food.x, g.food.y, g.food.z)], 0, 'food not on body');
  placeFoodFarAway(g);
  g.tick(); g.tick();
  assert.equal(g.length, START_LENGTH + 2, 'grew by 2');
  assert.equal(occupiedCount(g), g.length);
  assert.ok(g.rate > 6, 'speed increased');
});

test('combo multiplies consecutive quick eats', () => {
  const g = new Game();
  for (let i = 0; i < 3; i++) {
    const [x, y, z] = head(g);
    g.food.x = x; g.food.y = y; g.food.z = z - 1;
    g.tick();
  }
  assert.equal(g.score, 10 + 20 + 30);
  assert.equal(g.combo, 3);
});

test('wall collision ends the game', () => {
  const g = new Game(); placeFoodFarAway(g);
  let died = null;
  g.onEvent = (t, d) => { if (t === 'die') died = d.cause; };
  for (let i = 0; i < N + 2 && g.alive; i++) g.tick();
  assert.equal(g.alive, false);
  assert.equal(died, 'wall');
});

test('self collision ends the game', () => {
  const g = new Game(); placeFoodFarAway(g);
  g.grow = 4; g.tick(); g.tick(); g.tick(); g.tick(); // length 8
  let died = null;
  g.onEvent = (t, d) => { if (t === 'die') died = d.cause; };
  g.enqueue(CMD_LEFT); g.tick();
  g.enqueue(CMD_LEFT); g.tick();
  g.enqueue(CMD_LEFT); g.tick();
  assert.equal(g.alive, false);
  assert.equal(died, 'self');
});

test('chasing your own tail (moving into the vacating tail cell) is legal', () => {
  const g = new Game(); placeFoodFarAway(g);
  // length 4 in a 2x2 loop: L L L L forever
  for (let i = 0; i < 12; i++) { g.enqueue(CMD_LEFT); g.tick(); }
  assert.equal(g.alive, true);
});

test('autopilot soak: 20 games, food always in free in-bounds cells, occupancy consistent', () => {
  const ai = new Autopilot();
  let maxLen = 0;
  for (let game = 0; game < 20; game++) {
    const g = new Game(); g.reset(1234 + game);
    for (let t = 0; t < 3000 && g.alive; t++) {
      const c = ai.decide(g);
      if (c >= 0) g.enqueue(c);
      g.tick();
      const f = g.food;
      assert.ok(f.x >= 0 && f.x < N && f.y >= 0 && f.y < N && f.z >= 0 && f.z < N);
      if (g.alive) {
        assert.equal(g.occ[cellIndex(f.x, f.y, f.z)], 0, 'food never inside the body');
        assert.equal(occupiedCount(g), g.length, 'occupancy matches length');
      }
    }
    maxLen = Math.max(maxLen, g.length);
  }
  assert.ok(maxLen > 20, `autopilot should eat plenty (max length ${maxLen})`);
  console.log(`    (autopilot best length ${maxLen})`);
});

console.log(`\n${passed} tests passed`);
