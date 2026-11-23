import * as THREE from 'three';
import { Game } from './game/Game.js';
import { Autopilot } from './game/Autopilot.js';
import { HALF, START_RATE, MAX_EXTRA_RATE, COMBO_WINDOW } from './game/constants.js';
import { Renderer } from './render/Renderer.js';
import { World, PALETTE } from './render/World.js';
import { Particles } from './render/Particles.js';
import { SnakeView } from './render/SnakeView.js';
import { FoodView, GuideRay } from './render/FoodView.js';
import { CameraRig } from './render/CameraRig.js';
import { Audio } from './audio/Audio.js';
import { Input } from './input/Input.js';
import { UI } from './ui/UI.js';

// ---------- persistence (never throws) ----------
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } },
};
const settings = Object.assign({ quality: 'auto', sound: true }, store.get('ss3000.settings', {}));
let best = Number(store.get('ss3000.best', 0)) || 0;

// ---------- scene ----------
const canvas = document.getElementById('scene');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 500);

const renderer = new Renderer(canvas, scene, camera, settings.quality);
const world = new World(scene, renderer.renderer);
world.setShadowMapSize(renderer.quality.shadowMap);
renderer.onQualityChange = (q) => world.setShadowMapSize(q.shadowMap);

const particles = new Particles(scene);
const snakeView = new SnakeView(scene, particles);
const foodView = new FoodView(scene);
const guide = new GuideRay(scene);
const rig = new CameraRig(camera);
const audio = new Audio();
audio.enabled = settings.sound;
const ai = new Autopilot();

// ---------- state ----------
let state = 'title';      // title | ready | playing | paused | dying | over
let pausedFrom = 'playing';
let attract = true;       // title-screen autopilot
let acc = 0;              // fixed-timestep accumulator
let stateT = 0;
let deathT = 0;
let flash = 0;
let alpha = 0;
let hintVisible = true;
const dirVec = new THREE.Vector3();
const headSim = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const tmpC = new THREE.Color();

// Orbs consumed by the simulation fly into the visual head before the swallow plays.
const pending = [
  { active: false, bonus: false, start: new THREE.Vector3(), t: 0, dur: 0.2, points: 0, combo: 1, ghost: foodView.ghostFood },
  { active: false, bonus: true, start: new THREE.Vector3(), t: 0, dur: 0.2, points: 0, combo: 1, ghost: foodView.ghostBonus },
];

function onGameEvent(type, d) {
  switch (type) {
    case 'eat':
    case 'bonus': {
      const p = pending[type === 'bonus' ? 1 : 0];
      if (p.active) finishPending(p);
      p.active = true;
      p.start.set(d.x - HALF, d.y - HALF, d.z - HALF);
      p.t = 0;
      p.dur = game.interval * 1.4;
      p.points = d.points;
      p.combo = d.combo;
      p.ghost.visible = true;
      p.ghost.position.copy(p.start);
      if (type === 'bonus') foodView.bonus.hide();
      break;
    }
    case 'foodSpawn': foodView.food.spawn(d.x, d.y, d.z); break;
    case 'bonusSpawn': foodView.bonus.spawn(d.x, d.y, d.z); break;
    case 'bonusExpired':
      particles.emit(foodView.bonus.pos.x, foodView.bonus.pos.y, foodView.bonus.pos.z, 24, tmpC.setRGB(1.4, 1.0, 0.3), 1.5, 0.22, 0.8);
      foodView.bonus.hide();
      break;
    case 'turn': if (!attract) audio.turn(); break;
    case 'die': onDie(d.cause); break;
    default:
  }
}

const game = new Game(onGameEvent);

function finishPending(p) {
  p.active = false;
  p.ghost.visible = false;
  const h = snakeView.headPos;
  if (p.bonus) {
    particles.emit(h.x, h.y, h.z, 60, tmpC.setRGB(1.8, 1.3, 0.4), 4.5, 0.32, 1.0, 0.2);
    rig.kick(5, 0.25);
  } else {
    particles.emit(h.x, h.y, h.z, 36, tmpC.setRGB(1.6, 0.45, 1.1), 3.6, 0.26, 0.85, 0.2);
    particles.emit(h.x, h.y, h.z, 12, tmpC.copy(PALETTE.teal).multiplyScalar(1.6), 2.2, 0.2, 0.7, 0.2);
    rig.kick(2.6, 0.08);
  }
  snakeView.swallow();
  if (attract) return;
  if (p.bonus) audio.bonus(); else audio.eat(p.combo, game.eaten);
  audio.setIntensity(speed01());
  ui.setScore(game.score, true);
  ui.popup(`+${p.points}`, p.bonus);
}

function updatePending(dt) {
  for (const p of pending) {
    if (!p.active) continue;
    p.t += dt;
    const k = Math.min(1, p.t / p.dur);
    const e = k * k;
    p.ghost.position.lerpVectors(p.start, snakeView.headPos, e);
    p.ghost.scale.setScalar(1 - 0.75 * e);
    p.ghost.rotation.y += dt * 8;
    if (k >= 1) finishPending(p);
  }
}

function clearPending() {
  for (const p of pending) { p.active = false; p.ghost.visible = false; }
}

const speed01 = () => (game.rate - START_RATE) / MAX_EXTRA_RATE;

// ---------- UI ----------
const ui = new UI({
  onPlay: () => startGame(),
  onResume: () => resume(),
  onRestart: () => startGame(),
  onMenu: () => toTitle(),
  onQuality: (q) => {
    settings.quality = q;
    store.set('ss3000.settings', settings);
    renderer.setQuality(q);
  },
  onSound: (on) => {
    settings.sound = on;
    store.set('ss3000.settings', settings);
    audio.setEnabled(on);
    if (on) audio.unlock();
    audio.ui();
  },
}, settings);
ui.setBest(best);

// ---------- flow ----------
function resetWorld() {
  clearPending();
  game.reset();
  foodView.bonus.hide();
  snakeView.reset();
  particles.clear();
  guide.measure(game);
  acc = 0;
  deathT = 0;
  alpha = 0;
}

function toTitle() {
  attract = true;
  resetWorld();
  state = 'title';
  stateT = 0;
  rig.setMode('orbit');
  ui.show('title');
  ui.hud(false);
  ui.ready(false);
  audio.pause(false);
  audio.setMusic(0.6);
  audio.ui();
}

function startGame() {
  audio.unlock();
  attract = false;
  resetWorld();
  state = 'ready';
  stateT = 0;
  rig.setMode('chase');
  rig.yaw = 0;
  rig.vert = 0;
  ui.show(null);
  ui.hud(true);
  ui.resetHud();
  ui.setBest(best);
  ui.setLength(game.length);
  ui.ready(true, 'Ready');
  ui.hint(true);
  hintVisible = true;
  updateAltitude();
  audio.pause(false);
  audio.setMusic(1);
  audio.setIntensity(0);
  audio.start();
}

function pause() {
  if (state !== 'playing' && state !== 'ready') return;
  pausedFrom = state;
  state = 'paused';
  ui.show('pause');
  audio.pause(true);
}

function resume() {
  if (state !== 'paused') return;
  state = pausedFrom;
  ui.show(null);
  audio.pause(false);
  audio.ui();
}

function onDie() {
  clearPending();
  deathT = 0;
  if (attract) return;
  state = 'dying';
  stateT = 0;
  flash = 1;
  rig.kick(0, 1.0);
  audio.die();
  audio.setMusic(0.4);
}

function gameOver() {
  state = 'over';
  rig.focus.copy(snakeView.headPos);
  rig.setMode('death');
  const newBest = game.score > best;
  if (newBest) { best = game.score; store.set('ss3000.best', best); }
  ui.setBest(best);
  ui.hud(false);
  ui.gameOver({
    score: game.score, length: game.length, orbs: game.eaten, best, newBest: newBest && game.score > 0, cause: game.deathCause,
  });
  ui.show('over');
}

function updateAltitude() {
  const b = game.bonus;
  ui.setAltitude(game.snake.y(0), game.food.y, b.active ? b.y : null);
}

// ---------- input ----------
new Input(canvas, {
  onCommand: (cmd) => {
    if (state === 'playing' || state === 'ready') game.enqueue(cmd);
  },
  onAction: (kind) => {
    if (state === 'title' && kind !== 'restart') startGame();
    else if (state === 'over') startGame();
    else if (state === 'paused') { if (kind === 'restart') startGame(); else resume(); }
  },
  onPause: () => {
    if (state === 'paused') resume();
    else if (state === 'over') toTitle();
    else pause();
  },
  onBack: () => { if (state === 'paused' || state === 'over') toTitle(); },
  onMute: () => {
    settings.sound = !settings.sound;
    store.set('ss3000.settings', settings);
    audio.setEnabled(settings.sound);
    ui.syncSettings();
  },
});
let showFps = false;
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyF' && !e.repeat) { showFps = !showFps; if (!showFps) ui.fps(null); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('blur', () => pause());

// ---------- simulation ----------
function onTick() {
  guide.measure(game);
  if (!attract) {
    updateAltitude();
    ui.setLength(game.length);
  }
}

function simulate(dt) {
  acc += dt;
  let steps = 0;
  while (acc >= game.interval && game.alive && steps < 4) {
    acc -= game.interval;
    if (attract) {
      const c = ai.decide(game);
      if (c >= 0) game.enqueue(c);
    }
    game.tick();
    steps++;
    if (game.alive) onTick();
  }
  if (steps === 4 && acc > game.interval) acc = 0; // hitch protection: never spiral
  if (!game.alive) acc = 0;
}

// ---------- frame loop ----------
let last = performance.now();
let time = 0;
let fpsAcc = 0, fpsN = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const rawDt = Math.max(0, (now - last) / 1000);
  last = now;
  const dt = Math.min(0.1, rawDt);
  renderer.adapt(rawDt);
  time += dt;
  stateT += dt;

  let push = 0;
  let dissolve = -1;

  switch (state) {
    case 'title':
      if (game.alive) {
        simulate(dt);
        if (game.ticks > 2400) resetWorld(); // keep the attract loop fresh
      } else {
        deathT += dt;
        if (deathT > 2.2) resetWorld();
      }
      break;
    case 'ready':
      if (stateT > 1.0) { state = 'playing'; stateT = 0; ui.ready(false); }
      break;
    case 'playing':
      simulate(dt);
      if (hintVisible && stateT > 9) { hintVisible = false; ui.hint(false); }
      break;
    case 'dying':
      deathT += dt;
      if (stateT > 1.9) gameOver();
      break;
    default:
  }

  if (game.alive) {
    alpha = state === 'paused' || state === 'ready' ? alpha : Math.min(1, acc / game.interval);
  } else {
    alpha = 1;
    push = Math.min(0.42, deathT * 3.5);
    if (deathT > 0.3) dissolve = Math.min(1, (deathT - 0.3) / 0.9);
  }

  const simDt = state === 'paused' ? 0 : dt;
  snakeView.update(game, alpha, push, time, simDt, dissolve);
  updatePending(simDt);
  foodView.update(game, time, dt, state === 'playing');

  dirVec.set(game.dir[0], game.dir[1], game.dir[2]);
  const sn = game.snake;
  headSim.set(sn.x(0) - HALF, sn.y(0) - HALF, sn.z(0) - HALF);
  world.update(
    time, camera, renderer.pixelRatio, snakeView.headPos, headSim, dirVec,
    foodView.food.pos, foodView.bonus.pos, game.bonus.active ? 1 : 0, game.alive ? 1 : 0, 1,
  );
  guide.update(snakeView.headPos, time, game.alive ? (attract ? 0.5 : 1) : 0);
  particles.update(simDt, renderer.pixelRatio);

  rig.titleOffset = window.innerWidth > 760 ? 7.5 : 0;
  rig.update(dt, time, snakeView.headPos, game.yaw * Math.PI / 2, game.dir[1], speed01());

  if (!attract && (state === 'playing' || state === 'ready' || state === 'paused')) {
    ui.setCombo(game.combo, game.comboTime / COMBO_WINDOW);
    updateArrow();
  } else {
    ui.arrow(false);
  }

  flash = Math.max(0, flash - dt * 2.2);
  // Crash is one move away: a soft red pulse at the screen edges.
  const danger = state === 'playing' && game.alive && guide.freeCells === 0 ? 0.18 + 0.1 * Math.sin(time * 16) : 0;
  renderer.render(time, Math.max(flash * flash, danger));

  if (showFps) {
    fpsAcc += rawDt; fpsN++;
    if (fpsAcc > 0.5) {
      ui.fps(`${Math.round(fpsN / fpsAcc)} fps · ${renderer.pixelRatio.toFixed(2)}x · ${renderer.renderer.info.render.calls} calls`);
      fpsAcc = 0; fpsN = 0;
    }
  }
}

/** Edge-of-screen chevron pointing at the orb when it is out of view. */
function updateArrow() {
  tmpV.copy(foodView.food.pos).project(camera);
  const behind = tmpV.z > 1;
  let x = tmpV.x, y = tmpV.y;
  if (!behind && Math.abs(x) < 0.94 && Math.abs(y) < 0.9) { ui.arrow(false); return; }
  if (behind) { x = -x; y = -y; }
  const m = Math.max(Math.abs(x) / 0.84, Math.abs(y) / 0.74, 1e-4); // stay clear of HUD corners
  x /= m; y /= m;
  const w = window.innerWidth, h = window.innerHeight;
  ui.arrow(true, (x * 0.5 + 0.5) * w, (-y * 0.5 + 0.5) * h, Math.atan2(x, y));
}

toTitle();
requestAnimationFrame(frame);

// QA/debug handle, dev server only (used by the automated browser tests).
if (import.meta.env.DEV) {
  window.__ss3000 = { game, state: () => state, startGame, renderer, scene, snakeView, rig, camera };
}
