import { N } from '../game/constants.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString('en-US');

/** Thin DOM layer: screens, HUD, settings. Only touches the DOM when values change. */
export class UI {
  constructor(handlers, settings) {
    this.h = handlers;
    this.settings = settings;
    this.screens = { title: $('title'), pause: $('pause'), over: $('over'), hud: $('hud') };
    this.el = {
      score: $('score'), combo: $('combo'), comboFill: $('combo-fill'), hudBest: $('hud-best'), hudLen: $('hud-len'),
      titleBest: $('title-best'), ready: $('ready'), popups: $('popups'), hint: $('hint'),
      arrow: $('food-arrow'), alt: $('alt'), altHead: $('alt-head'), altFood: $('alt-food'), altBonus: $('alt-bonus'),
      overCause: $('over-cause'), finalScore: $('final-score'), finalLen: $('final-len'), finalOrbs: $('final-orbs'),
      finalBest: $('final-best'), newBest: $('new-best'), fps: $('fps'),
    };
    this._last = {};

    $('play').addEventListener('click', () => handlers.onPlay());
    document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.act;
      if (a === 'resume') handlers.onResume();
      else if (a === 'restart') handlers.onRestart();
      else if (a === 'menu') handlers.onMenu();
    }));
    this._buildSettings($('settings-title'));
    this._buildSettings($('settings-pause'));
  }

  _buildSettings(root) {
    const seg = (label, key, options, onChange) => {
      const wrap = document.createElement('div');
      wrap.className = 'seg';
      wrap.innerHTML = `<span class="seg-label">${label}</span>`;
      for (const [value, text] of options) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = text;
        b.dataset.key = key;
        b.dataset.value = String(value);
        b.addEventListener('click', () => { onChange(value); this.syncSettings(); b.blur(); });
        wrap.appendChild(b);
      }
      root.appendChild(wrap);
    };
    seg('Graphics', 'quality', [['auto', 'Auto'], ['high', 'High'], ['low', 'Low']], (v) => this.h.onQuality(v));
    seg('Sound', 'sound', [[true, 'On'], [false, 'Off']], (v) => this.h.onSound(v));
    this.syncSettings();
  }

  syncSettings() {
    document.querySelectorAll('.seg button').forEach((b) => {
      const cur = String(this.settings[b.dataset.key]);
      b.setAttribute('aria-pressed', cur === b.dataset.value ? 'true' : 'false');
    });
  }

  show(name) {
    for (const [k, el] of Object.entries(this.screens)) {
      if (k === 'hud') continue;
      el.classList.toggle('hidden', k !== name);
    }
    const focus = name === 'title' ? $('play') : name ? this.screens[name]?.querySelector('.btn-primary') : null;
    if (focus) setTimeout(() => focus.focus({ preventScroll: true }), 60);
    else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }

  hud(visible) { this.screens.hud.classList.toggle('hidden', !visible); }

  setBest(best) {
    this.el.titleBest.textContent = fmt(best);
    this.el.hudBest.textContent = fmt(best);
  }

  setScore(score, bump = false) {
    if (this._last.score === score) return;
    this._last.score = score;
    const el = this.el.score;
    el.textContent = fmt(score);
    if (bump) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
  }

  setLength(len) {
    if (this._last.len === len) return;
    this._last.len = len;
    this.el.hudLen.textContent = len;
  }

  setCombo(combo, frac) {
    const show = combo > 1;
    if (this._last.comboShow !== show) { this._last.comboShow = show; this.el.combo.classList.toggle('hidden', !show); }
    if (show && this._last.combo !== combo) { this._last.combo = combo; this.el.combo.querySelector('b').textContent = combo; }
    const q = Math.round(frac * 100) / 100;
    if (this._last.comboFrac !== q) { this._last.comboFrac = q; this.el.comboFill.style.transform = `scaleX(${q})`; }
  }

  setAltitude(headY, foodY, bonusY) {
    const pct = (y) => `${((y + 0.5) / N) * 100}%`;
    this.el.altHead.style.bottom = pct(headY);
    this.el.altFood.style.bottom = pct(foodY);
    if (bonusY === null) this.el.altBonus.classList.add('hidden');
    else { this.el.altBonus.classList.remove('hidden'); this.el.altBonus.style.bottom = pct(bonusY); }
    this.el.alt.classList.toggle('aligned', headY === foodY);
  }

  ready(show, text = 'Ready') {
    this.el.ready.textContent = text;
    this.el.ready.classList.toggle('show', show);
  }

  hint(show) { this.el.hint.classList.toggle('fade', !show); }

  popup(text, gold = false) {
    const p = document.createElement('div');
    p.className = gold ? 'popup gold' : 'popup';
    p.textContent = text;
    this.el.popups.appendChild(p);
    setTimeout(() => p.remove(), 1000);
  }

  /** Off-screen orb indicator. */
  arrow(visible, x, y, angle) {
    const a = this.el.arrow;
    if (this._last.arrow !== visible) { this._last.arrow = visible; a.classList.toggle('hidden', !visible); }
    if (visible) a.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${angle.toFixed(3)}rad)`;
  }

  gameOver({ score, length, orbs, best, newBest, cause }) {
    const causes = { wall: 'You hit the wall', self: 'You bit your own tail', win: 'The arena is full. Perfection.' };
    this.el.overCause.textContent = causes[cause] || 'Game over';
    this.el.finalScore.textContent = fmt(score);
    this.el.finalLen.textContent = length;
    this.el.finalOrbs.textContent = orbs;
    this.el.finalBest.textContent = fmt(best);
    this.el.newBest.classList.toggle('hidden', !newBest);
  }

  resetHud() {
    this._last = {};
    this.setScore(0);
    this.setCombo(1, 0);
    this.el.popups.innerHTML = '';
  }

  fps(text) {
    if (text === null) { this.el.fps.classList.add('hidden'); return; }
    this.el.fps.classList.remove('hidden');
    this.el.fps.textContent = text;
  }
}
