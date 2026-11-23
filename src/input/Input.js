import { CMD_LEFT, CMD_RIGHT, CMD_UP, CMD_DOWN } from '../game/constants.js';

const KEYMAP = {
  ArrowLeft: CMD_LEFT, KeyA: CMD_LEFT,
  ArrowRight: CMD_RIGHT, KeyD: CMD_RIGHT,
  ArrowUp: CMD_UP, KeyW: CMD_UP,
  ArrowDown: CMD_DOWN, KeyS: CMD_DOWN,
};

/**
 * Keyboard + touch input. Directional input is delivered immediately via
 * callback (and queued by the game) so nothing is lost between ticks.
 */
export class Input {
  constructor(target, { onCommand, onAction, onPause, onBack, onMute }) {
    window.addEventListener('keydown', (e) => {
      const cmd = KEYMAP[e.code];
      if (cmd !== undefined) {
        e.preventDefault();
        if (!e.repeat) onCommand(cmd);
        return;
      }
      if (e.repeat) return;
      switch (e.code) {
        case 'Space': case 'Enter': case 'NumpadEnter':
          if (e.target instanceof HTMLButtonElement) return; // let focused buttons click
          e.preventDefault(); onAction(); break;
        case 'Escape': case 'KeyP': e.preventDefault(); onPause(); break;
        case 'KeyQ': onBack(); break;
        case 'KeyM': onMute(); break;
        case 'KeyR': onAction('restart'); break;
        default:
      }
    });

    // Swipes: left/right turn, up/down climb/dive. Tap = action.
    let sx = 0, sy = 0, st = 0, tracking = false;
    target.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      sx = t.clientX; sy = t.clientY; st = performance.now(); tracking = true;
    }, { passive: true });
    target.addEventListener('touchmove', (e) => {
      if (!tracking) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > 28) {
        tracking = false;
        if (Math.abs(dx) > Math.abs(dy)) onCommand(dx < 0 ? CMD_LEFT : CMD_RIGHT);
        else onCommand(dy < 0 ? CMD_UP : CMD_DOWN);
      }
      e.preventDefault();
    }, { passive: false });
    target.addEventListener('touchend', () => {
      if (tracking && performance.now() - st < 250) onAction('tap');
      tracking = false;
    });
  }
}
