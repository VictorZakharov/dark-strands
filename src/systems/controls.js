import { getRenderer } from '../core/scene.js';
import { getPlayerState, toggleCamera } from '../entities/player.js';
import { toggleNearestDoor, getNearestDoor } from '../world/doors.js';
import { talkToNearestSoldier } from '../systems/npcAI.js';
import { pickNearestFlower } from '../world/flowers.js';

const keys = {};
let pointerLocked = false;
let rightMouseDown = false;
let pendingLockEl = null;
let helpVisible = false;

// Silently swallow SecurityError when browser blocks pointer lock
function tryLock(el) {
  const p = el.requestPointerLock();
  if (p && p.catch) p.catch(() => {});
}

function toggleHelp() {
  const el = document.getElementById('help-overlay');
  if (!el) return;
  helpVisible = !helpVisible;
  el.style.display = helpVisible ? 'flex' : 'none';
  if (helpVisible) {
    // Release pointer lock so the cursor is visible
    document.exitPointerLock();
  } else {
    // Re-lock pointer to resume gameplay
    const renderer = getRenderer();
    pendingLockEl = renderer.domElement;
    tryLock(renderer.domElement);
  }
}

export function isHelpVisible() { return helpVisible; }

export function getKeys() { return keys; }
export function isPointerLocked() { return pointerLocked; }
export function isRightMouseDown() { return rightMouseDown; }

export function initControls() {
  const renderer = getRenderer();
  const blocker = document.getElementById('blocker');
  const player = getPlayerState();

  // When paused (ESC), clicking blocker re-enters game
  blocker.addEventListener('mousedown', (e) => {
    if (blocker.dataset.mode !== 'game') return;
    if (e.target.closest('#daynight-toggle')) return;
    if (e.target.closest('#menu-panel')) return;
    if (e.target.closest('#menu-loading')) return;
    pendingLockEl = renderer.domElement;
    tryLock(renderer.domElement);
  });

  renderer.domElement.addEventListener('mousedown', () => {
    if (!pointerLocked) {
      pendingLockEl = renderer.domElement;
      tryLock(renderer.domElement);
    }
  });

  // Retry pointer lock on any user gesture while paused
  // (browser may enforce a brief cooldown after ESC; real user gestures
  //  like mousedown/keydown can re-lock once the cooldown expires)
  document.addEventListener('mousedown', () => {
    if (pendingLockEl && !pointerLocked) tryLock(pendingLockEl);
  });

  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === renderer.domElement;
    if (pointerLocked) {
      pendingLockEl = null;
      blocker.style.display = 'none';
    } else {
      // Help overlay released pointer lock — don't show pause screen
      if (helpVisible) return;

      blocker.style.display = 'flex';
      if (blocker.dataset.mode === 'game') {
        pendingLockEl = renderer.domElement;
        const panel = document.getElementById('menu-panel');
        const loading = document.getElementById('menu-loading');
        const keys = document.getElementById('menu-keys');
        const pause = document.getElementById('menu-pause');
        if (panel) panel.style.display = 'none';
        if (loading) loading.style.display = 'none';
        if (keys) keys.style.display = 'none';
        if (pause) pause.style.display = 'flex';
        blocker.style.background = 'rgba(0, 0, 0, 0.45)';
      }
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (!pointerLocked) return;
    player.yaw -= e.movementX * 0.002;
    player.pitch -= e.movementY * 0.002;
    player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch));
  });

  document.addEventListener('keydown', (e) => {
    keys[e.code] = true;

    // SHIFT+? (Shift+Slash) toggles help overlay
    if (e.key === '?' && e.shiftKey) {
      toggleHelp();
      return;
    }

    // ESC closes help — browser blocks requestPointerLock from ESC,
    // so just close the overlay and let next click/key re-enter the game
    if (e.code === 'Escape' && helpVisible) {
      e.preventDefault();
      helpVisible = false;
      const helpEl = document.getElementById('help-overlay');
      if (helpEl) helpEl.style.display = 'none';
      pendingLockEl = renderer.domElement;
      return;
    }

    // Any key while paused → try to resume (keydown is a user gesture)
    // Skip ESC — browsers block requestPointerLock from Escape key
    if (pendingLockEl && !pointerLocked && e.code !== 'Escape') {
      tryLock(pendingLockEl);
      return;
    }
    if (e.code === 'KeyV') toggleCamera();
    if (e.code === 'KeyE' && pointerLocked) {
      if (getNearestDoor()) toggleNearestDoor();
      else if (!talkToNearestSoldier()) pickNearestFlower();
    }
  });

  document.addEventListener('keyup', (e) => {
    keys[e.code] = false;
  });

  // Right-click zoom
  document.addEventListener('mousedown', (e) => {
    if (e.button === 2 && pointerLocked) rightMouseDown = true;
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 2) rightMouseDown = false;
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
}
