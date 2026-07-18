import { toggleCamera } from '../entities/player.js';
// Circular with controls.js (it imports this module) — safe: only called at
// runtime from an event handler, never during module evaluation.
import { setupHelpTabs } from './controls.js';

export const isTouchDevice = 'ontouchstart' in window;

// --- State ---
let moveX = 0, moveZ = 0;       // Joystick: -1 to 1
let lookDx = 0, lookDy = 0;     // Look delta (consumed per frame)
let jumpPressed = false;
let interactPressed = false;
let usePressed = false;
let gameActive = false;
let slotTapped = -1;            // Hotbar slot tapped this frame

// Touch tracking
let joystickId = -1;
let lookId = -1;
let joystickStartX = 0, joystickStartY = 0;
let lookPrevX = 0, lookPrevY = 0;

// Long-press interaction
let lpActive = false;
let lpStart = 0;
let lpOriginX = 0, lpOriginY = 0;
const LP_DURATION = 1000;       // 1 second hold
const LP_MOVE_THRESH = 12;      // pixels before cancel

const JOYSTICK_RADIUS = 50;
const LOOK_SENSITIVITY = 0.004;
const ARC_LEN = 2 * Math.PI * 34; // circumference for r=34

// Cached DOM elements (set in initTouch)
let progressEl, progressArc, progressLabel;
let joystickEl, knobEl;

function showProgress(text) {
  if (!progressEl) return;
  progressLabel.textContent = text;
  progressArc.style.strokeDashoffset = ARC_LEN;
  progressEl.style.display = 'flex';
}

function hideProgress() {
  if (progressEl) progressEl.style.display = 'none';
  lpActive = false;
}

// --- Exports ---
export function getTouchMove() { return { x: moveX, z: moveZ }; }
export function consumeTouchLook() {
  const dx = lookDx, dy = lookDy;
  lookDx = 0; lookDy = 0;
  return { dx, dy };
}
export function consumeJump() {
  const v = jumpPressed; jumpPressed = false; return v;
}
export function consumeInteract() {
  const v = interactPressed; interactPressed = false; return v;
}
export function consumeUse() {
  const v = usePressed; usePressed = false; return v;
}
export function consumeSlotTap() {
  const v = slotTapped; slotTapped = -1; return v;
}
export function isMobileGameActive() { return gameActive; }

/**
 * Drop any in-flight joystick/look drag when a modal takes over the screen.
 * The #overlay bypasses in touchstart only block NEW touches — they cannot
 * release a touch that is already latched. This matters most for the sleep
 * menu, which opens FROM a right-side long press, so lookId is ALWAYS still
 * latched at that moment.
 *
 * Zeroing lookDx/lookDy is the load-bearing part: touchmove is NOT gated on
 * gameActive and keeps accumulating look delta for a latched lookId, while the
 * only drain (consumeTouchLook) sits inside main.js's frozen isGameActive()
 * block. Without this, dragging that same thumb across the panel banks a whole
 * gesture's worth of yaw and replays it as one camera whip on close.
 */
export function releaseTouchDrags() {
  joystickId = -1; lookId = -1;
  moveX = 0; moveZ = 0;
  lookDx = 0; lookDy = 0;
  hideProgress();
  if (joystickEl) joystickEl.style.display = 'none';
}
export function setMobileGameActive(v) {
  gameActive = v;
  const tc = document.getElementById('touch-controls');
  if (tc) tc.style.display = v ? 'block' : 'none';
}

/** Called each frame from main.js — updates long-press progress ring */
export function updateTouchProgress() {
  if (!lpActive) return;
  // Cancel if interact hint disappeared (e.g. walked away)
  const hintEl = document.getElementById('interact-hint');
  if (!hintEl || hintEl.style.display === 'none') {
    hideProgress();
    return;
  }
  const elapsed = performance.now() - lpStart;
  const progress = Math.min(1, elapsed / LP_DURATION);
  if (progressArc) {
    progressArc.style.strokeDashoffset = ARC_LEN * (1 - progress);
  }
  if (progress >= 1) {
    interactPressed = true;
    hideProgress();
  }
}

// --- Init ---
export function initTouch() {
  if (!isTouchDevice) return;

  // Cache progress ring elements
  progressEl = document.getElementById('touch-progress');
  progressArc = document.getElementById('progress-arc');
  progressLabel = document.getElementById('progress-label');

  joystickEl = document.getElementById('touch-joystick');
  knobEl = document.getElementById('joystick-knob');

  document.addEventListener('touchstart', (e) => {
    for (const t of e.changedTouches) {
      const target = document.elementFromPoint(t.clientX, t.clientY);
      if (target && target.closest('#touch-buttons')) continue;
      if (target && target.closest('#touch-top-buttons')) continue;
      if (target && target.closest('#blocker')) continue;
      // The guide sits over the game surface: without this, touches on it fall
      // through to joystick/look and get preventDefault'd — which kills the tab
      // buttons (click is synthesized from touch), kills scrolling, and walks
      // the player around behind the overlay.
      if (target && target.closest('#help-overlay')) continue;
      // Same trap: #sleep-ui is a full-screen fixed overlay (z-index 55) over
      // the game surface. Without this its touches fall through to
      // joystick/look and get preventDefault'd — no synthesized click, so the
      // Sleep/Cancel buttons and the range thumb are all dead. And since it
      // also covers #touch-controls (z-index 10), even the pause and help
      // buttons are unreachable — a reload-only soft-lock, because
      // setTimeStopped(true) is cleared ONLY by closeSleepMenu.
      if (target && target.closest('#sleep-ui')) continue;

      // Hotbar slot tap
      const slot = target && target.closest('.hotbar-slot');
      if (slot) {
        const idx = parseInt(slot.dataset.slot);
        if (!isNaN(idx)) slotTapped = idx;
        e.preventDefault();
        continue;
      }

      if (!gameActive) continue;

      // Left 40% = joystick
      if (t.clientX < window.innerWidth * 0.4 && joystickId < 0) {
        joystickId = t.identifier;
        joystickStartX = t.clientX;
        joystickStartY = t.clientY;
        if (joystickEl) {
          joystickEl.style.left = t.clientX + 'px';
          joystickEl.style.top = t.clientY + 'px';
          joystickEl.style.display = 'block';
        }
        if (knobEl) {
          knobEl.style.left = '50%';
          knobEl.style.top = '50%';
        }
        e.preventDefault();
      }
      // Right 60% = camera look + long-press interact
      else if (t.clientX >= window.innerWidth * 0.4 && lookId < 0) {
        lookId = t.identifier;
        lookPrevX = t.clientX;
        lookPrevY = t.clientY;

        // Start long-press check if interactable is nearby
        const hintEl = document.getElementById('interact-hint');
        if (hintEl && hintEl.style.display !== 'none' && hintEl.dataset.source) {
          lpOriginX = t.clientX;
          lpOriginY = t.clientY;
          lpStart = performance.now();
          lpActive = true;
          // Extract action word from hint text (strip "Hold to " prefix)
          const raw = hintEl.textContent || '';
          const label = raw.replace(/^Hold to /, '');
          showProgress(label);
        }

        e.preventDefault();
      }
    }
  }, { passive: false });

  document.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === joystickId) {
        const dx = t.clientX - joystickStartX;
        const dy = t.clientY - joystickStartY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const clampDist = Math.min(dist, JOYSTICK_RADIUS);
        const angle = Math.atan2(dy, dx);
        const normDist = clampDist / JOYSTICK_RADIUS;

        moveX = Math.cos(angle) * normDist;
        moveZ = Math.sin(angle) * normDist;

        if (knobEl) {
          const kx = Math.cos(angle) * clampDist;
          const ky = Math.sin(angle) * clampDist;
          knobEl.style.left = `calc(50% + ${kx}px)`;
          knobEl.style.top = `calc(50% + ${ky}px)`;
        }
        e.preventDefault();
      }
      if (t.identifier === lookId) {
        // Cancel long-press if finger moved too far
        if (lpActive) {
          const dx = t.clientX - lpOriginX;
          const dy = t.clientY - lpOriginY;
          if (dx * dx + dy * dy > LP_MOVE_THRESH * LP_MOVE_THRESH) {
            hideProgress();
          }
        }
        lookDx += (t.clientX - lookPrevX) * LOOK_SENSITIVITY;
        lookDy += (t.clientY - lookPrevY) * LOOK_SENSITIVITY;
        lookPrevX = t.clientX;
        lookPrevY = t.clientY;
        e.preventDefault();
      }
    }
  }, { passive: false });

  const endTouch = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === joystickId) {
        joystickId = -1;
        moveX = 0; moveZ = 0;
        if (joystickEl) joystickEl.style.display = 'none';
      }
      if (t.identifier === lookId) {
        lookId = -1;
        if (lpActive) hideProgress();
      }
    }
  };
  document.addEventListener('touchend', endTouch);
  document.addEventListener('touchcancel', endTouch);

  // Action buttons
  const bind = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('touchstart', (e) => { e.preventDefault(); fn(); }, { passive: false });
  };
  bind('touch-jump', () => { jumpPressed = true; });
  bind('touch-use', () => { usePressed = true; });
  bind('touch-camera', () => { toggleCamera(); });

  // Pause button — show blocker with pause screen
  bind('touch-pause', () => {
    if (!gameActive) return;
    gameActive = false;
    releaseTouchDrags();
    const tc = document.getElementById('touch-controls');
    if (tc) tc.style.display = 'none';
    const blocker = document.getElementById('blocker');
    if (blocker) {
      blocker.style.display = 'flex';
      blocker.style.background = 'rgba(0, 0, 0, 0.45)';
    }
    const panel = document.getElementById('menu-panel');
    const loading = document.getElementById('menu-loading');
    const keys = document.getElementById('menu-keys');
    const pause = document.getElementById('menu-pause');
    if (panel) panel.style.display = 'none';
    if (loading) loading.style.display = 'none';
    if (keys) keys.style.display = 'none';
    if (pause) pause.style.display = 'flex';
    // Mobile-friendly text
    const pt = document.getElementById('pause-text');
    const ph = document.getElementById('pause-hint');
    if (pt) pt.textContent = 'Tap to Resume';
    if (ph) ph.textContent = 'Tap anywhere to resume';
  });

  // Help button — toggle help overlay
  bind('touch-help', () => {
    const helpEl = document.getElementById('help-overlay');
    if (!helpEl) return;
    const visible = helpEl.style.display === 'flex';
    if (!visible) {
      // Wire tabs + select the Touch tab BEFORE showing. Without this the panel
      // opens empty on mobile: the CSS hides the Controls tab content (the only
      // one marked active in the markup) and nothing else ever gets .active.
      setupHelpTabs(helpEl);
      releaseTouchDrags();
    }
    helpEl.style.display = visible ? 'none' : 'flex';
    // Gates body's touch-action so the guide can scroll — see styles.css
    document.body.classList.toggle('help-open', !visible);
  });

  // Mobile help close button
  const closeBtn = document.getElementById('help-close-mobile');
  if (closeBtn) {
    closeBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const helpEl = document.getElementById('help-overlay');
      if (helpEl) helpEl.style.display = 'none';
      document.body.classList.remove('help-open');
    }, { passive: false });
  }
}
