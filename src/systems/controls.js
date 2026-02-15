import { getRenderer, getScene, getCamera } from '../core/scene.js';
import { getPlayerState, toggleCamera } from '../entities/player.js';
import { toggleNearestDoor, getNearestDoor } from '../world/doors.js';
import { talkToNearestSoldier } from '../systems/npcAI.js';
import { pickNearestFlower, getInventory, plantFlower, isPreviewValid, hideFlowerPreview } from '../world/flowers.js';
import { pickNearestRock } from '../world/vegetation.js';
import { selectSlot, getSelectedSlot, getSlotItem, isPlacementMode, setPlacementMode, isAltMode, enterAltMode, exitAltMode, addItemToSlot, clearItemSlot } from '../systems/hotbar.js';
import { spawnProjectile } from '../systems/projectiles.js';
import { pickNearestTorch, hideHeldTorch, isTorchPreviewValid, placeTorchAtPreview } from '../world/torches.js';

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

  let skipNextMove = false;
  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === renderer.domElement;
    if (pointerLocked) {
      pendingLockEl = null;
      blocker.style.display = 'none';
      skipNextMove = true; // ignore first mousemove after re-lock (has junk delta)
    } else {
      hideFlowerPreview();
      hideHeldTorch();
      setPlacementMode(false);

      // Help overlay or ALT mode released pointer lock — don't show pause screen
      if (helpVisible || isAltMode()) return;

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
    if (skipNextMove) { skipNextMove = false; return; }
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

    // ALT key — show cursor for hotbar drag-and-drop
    if ((e.code === 'AltLeft' || e.code === 'AltRight') && pointerLocked) {
      e.preventDefault();
      enterAltMode();
      document.exitPointerLock();
      return;
    }

    // Any key while paused → try to resume (keydown is a user gesture)
    // Skip ESC and ALT — browsers block requestPointerLock from Escape key
    if (pendingLockEl && !pointerLocked && e.code !== 'Escape'
        && e.code !== 'AltLeft' && e.code !== 'AltRight') {
      tryLock(pendingLockEl);
      return;
    }
    if (e.code === 'KeyV') toggleCamera();

    // Number keys 1-5 select hotbar slots
    if (pointerLocked && e.code >= 'Digit1' && e.code <= 'Digit5') {
      selectSlot(parseInt(e.code.charAt(5)) - 1);
    }

    if (e.code === 'KeyE' && pointerLocked) {
      // Act on whatever the crosshair-based hint is showing
      const hintEl = document.getElementById('interact-hint');
      const source = hintEl ? hintEl.dataset.source : '';
      if (source === 'door') {
        toggleNearestDoor();
      } else if (source === 'soldier') {
        talkToNearestSoldier();
      } else if (source === 'flower') {
        if (pickNearestFlower()) { addItemToSlot('flower'); setPlacementMode(false); }
      } else if (source === 'rock') {
        if (pickNearestRock(getInventory())) { addItemToSlot('stone'); setPlacementMode(false); }
      } else if (source === 'torch') {
        if (pickNearestTorch(getInventory())) { addItemToSlot('torch'); setPlacementMode(false); }
      } else {
        // No hint visible — try fallback chain for cases where hint hasn't updated yet
        if (getNearestDoor()) toggleNearestDoor();
        else if (!talkToNearestSoldier()) {
          if (pickNearestFlower()) { addItemToSlot('flower'); setPlacementMode(false); }
          else if (pickNearestRock(getInventory())) { addItemToSlot('stone'); setPlacementMode(false); }
          else if (pickNearestTorch(getInventory())) { addItemToSlot('torch'); setPlacementMode(false); }
        }
      }
    }
  });

  document.addEventListener('keyup', (e) => {
    keys[e.code] = false;

    // ALT released — re-lock pointer
    if ((e.code === 'AltLeft' || e.code === 'AltRight') && isAltMode()) {
      exitAltMode();
      pendingLockEl = renderer.domElement;
      tryLock(renderer.domElement);
    }
  });

  // Right-click zoom
  document.addEventListener('mousedown', (e) => {
    if (e.button === 2 && pointerLocked) rightMouseDown = true;
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 2) rightMouseDown = false;
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // Left-click item action
  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !pointerLocked) return;

    const slot = getSelectedSlot();
    const item = getSlotItem(slot);
    const inv = getInventory();

    if (item === 'flower') {
      if (inv.flowers <= 0) return;
      if (isPlacementMode()) {
        if (isPreviewValid()) {
          plantFlower(getScene());
          if (inv.flowers <= 0) clearItemSlot('flower');
        }
      } else {
        setPlacementMode(true);
      }
    } else if (item === 'stone') {
      if (inv.stones <= 0) return;
      spawnProjectile(getCamera(), getScene());
      inv.stones--;
      if (inv.stones <= 0) clearItemSlot('stone');
    } else if (item === 'torch') {
      if (inv.torches <= 0) return;
      if (isPlacementMode()) {
        if (isTorchPreviewValid()) {
          placeTorchAtPreview(getScene());
          if (inv.torches <= 0) { clearItemSlot('torch'); setPlacementMode(false); }
        }
      } else {
        setPlacementMode(true);
      }
    }
  });
}
