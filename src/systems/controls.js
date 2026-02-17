import { getRenderer, getScene, getCamera } from '../core/scene.js';
import { getPlayerState, toggleCamera } from '../entities/player.js';
import { toggleNearestDoor, getNearestDoor } from '../world/doors.js';
import { talkToNearestSoldier } from '../systems/npcAI.js';
import { pickNearestFlower, getInventory, plantFlower, isPreviewValid, hideFlowerPreview } from '../world/flowers.js';
import { pickNearestRock } from '../world/vegetation.js';
import { selectSlot, getSelectedSlot, getSlotItem, isPlacementMode, setPlacementMode, isAltMode, enterAltMode, exitAltMode, moveCursor, cursorDown, cursorUp, addItemToSlot, clearItemSlot } from '../systems/hotbar.js';
import { spawnProjectile } from '../systems/projectiles.js';
import { pickNearestTorch, hideHeldTorch, isTorchPreviewValid, placeTorchAtPreview } from '../world/torches.js';
import { isTouchDevice, initTouch, setMobileGameActive, isMobileGameActive } from './touch.js';

const keys = {};
let pointerLocked = false;
let rightMouseDown = false;
let pendingLockEl = null;
let helpVisible = false;

// Virtual-cursor pause: ESC pauses with simulated cursor, click/key resumes instantly
let simPause = false;
let resuming = false;
let simCursorEl = null;
let simCursorX = 0, simCursorY = 0;
let skipSimMove = false;

// Silently swallow SecurityError when browser blocks pointer lock
function tryLock(el) {
  const p = el.requestPointerLock();
  if (p && p.catch) p.catch(() => {});
}

function showSimCursor() {
  if (!simCursorEl) {
    simCursorEl = document.createElement('div');
    simCursorEl.id = 'sim-cursor';
    document.body.appendChild(simCursorEl);
  }
  simCursorX = window.innerWidth / 2;
  simCursorY = window.innerHeight * 0.62;
  simCursorEl.style.left = simCursorX + 'px';
  simCursorEl.style.top = simCursorY + 'px';
  simCursorEl.style.display = 'block';
  skipSimMove = true;
}

function hideSimCursor() {
  if (simCursorEl) simCursorEl.style.display = 'none';
}

function enterSimPause(blocker) {
  simPause = true;
  resuming = false;
  document.body.style.cursor = 'none';
  blocker.style.cursor = 'none';
  blocker.style.display = 'flex';
  blocker.style.background = 'rgba(0, 0, 0, 0.45)';
  const panel = document.getElementById('menu-panel');
  const loading = document.getElementById('menu-loading');
  const keysEl = document.getElementById('menu-keys');
  const pause = document.getElementById('menu-pause');
  if (panel) panel.style.display = 'none';
  if (loading) loading.style.display = 'none';
  if (keysEl) keysEl.style.display = 'none';
  if (pause) pause.style.display = 'flex';
  const pt = document.getElementById('pause-text');
  const ph = document.getElementById('pause-hint');
  if (pt) pt.textContent = 'Paused';
  if (ph) ph.textContent = 'Click or press any key to resume';
  showSimCursor();
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
export function isGameActive() { return pointerLocked || resuming || isMobileGameActive(); }
export function isRightMouseDown() { return rightMouseDown; }

export function doInteract() {
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
    if (getNearestDoor()) toggleNearestDoor();
    else if (!talkToNearestSoldier()) {
      if (pickNearestFlower()) { addItemToSlot('flower'); setPlacementMode(false); }
      else if (pickNearestRock(getInventory())) { addItemToSlot('stone'); setPlacementMode(false); }
      else if (pickNearestTorch(getInventory())) { addItemToSlot('torch'); setPlacementMode(false); }
    }
  }
}

export function doUseItem() {
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
}

export function initControls() {
  const renderer = getRenderer();
  const blocker = document.getElementById('blocker');
  const player = getPlayerState();

  // Before game starts, clicking blocker/canvas requests pointer lock
  blocker.addEventListener('mousedown', (e) => {
    if (blocker.dataset.mode !== 'game') return;
    if (simPause) return; // handled by document-level simPause click
    if (e.target.closest('#daynight-toggle')) return;
    if (e.target.closest('#menu-panel')) return;
    if (e.target.closest('#menu-loading')) return;
    pendingLockEl = renderer.domElement;
    tryLock(renderer.domElement);
  });

  renderer.domElement.addEventListener('mousedown', () => {
    if (!pointerLocked && !simPause && !resuming) {
      pendingLockEl = renderer.domElement;
      tryLock(renderer.domElement);
    }
  });

  // Click to resume from simPause
  document.addEventListener('mousedown', (e) => {
    if (simPause) {
      // Stop other document mousedown handlers from treating this as a game click
      e.stopImmediatePropagation();
      simPause = false;
      resuming = true;
      hideSimCursor();
      blocker.style.display = 'none';
      blocker.style.cursor = '';
      document.body.style.cursor = 'none';
      pendingLockEl = renderer.domElement;
      tryLock(renderer.domElement);
      return;
    }
  });

  let skipNextMove = false;
  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === renderer.domElement;
    if (pointerLocked) {
      pendingLockEl = null;
      blocker.style.display = 'none';
      hideSimCursor();
      resuming = false;
      document.body.style.cursor = '';
      skipNextMove = true; // ignore first mousemove after re-lock (has junk delta)
    } else {
      if (isAltMode()) exitAltMode();
      hideFlowerPreview();
      hideHeldTorch();
      setPlacementMode(false);

      // Help overlay released pointer lock — don't show pause screen
      if (helpVisible) return;

      if (blocker.dataset.mode === 'game') {
        // Enter simulated-cursor pause instead of full pause
        pendingLockEl = renderer.domElement;
        enterSimPause(blocker);
      } else {
        blocker.style.display = 'flex';
      }
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (pointerLocked) {
      if (skipNextMove) { skipNextMove = false; return; }
      if (isAltMode()) {
        moveCursor(e.movementX, e.movementY);
        return;
      }
      player.yaw -= e.movementX * 0.002;
      player.pitch -= e.movementY * 0.002;
      player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch));
    } else if (simPause && simCursorEl) {
      // Move virtual cursor via relative delta (avoids jerk from OS cursor mismatch)
      if (skipSimMove) { skipSimMove = false; return; }
      simCursorX = Math.max(0, Math.min(window.innerWidth, simCursorX + e.movementX));
      simCursorY = Math.max(0, Math.min(window.innerHeight, simCursorY + e.movementY));
      simCursorEl.style.left = simCursorX + 'px';
      simCursorEl.style.top = simCursorY + 'px';
    } else if (resuming) {
      // Camera control while waiting for pointer lock
      player.yaw -= e.movementX * 0.002;
      player.pitch -= e.movementY * 0.002;
      player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch));
    }
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

    // ESC during simPause or resuming → back to sim-pause
    if (e.code === 'Escape' && (simPause || (resuming && !pointerLocked))) {
      e.preventDefault();
      if (resuming) { resuming = false; enterSimPause(blocker); }
      return;
    }

    // ALT key — press to enter cursor mode, release to exit
    if ((e.code === 'AltLeft' || e.code === 'AltRight')) {
      e.preventDefault();
      if (!isAltMode() && pointerLocked) enterAltMode();
      return;
    }

    // Any key during simPause → resume (like click)
    if (simPause && e.code !== 'Escape' && e.code !== 'AltLeft' && e.code !== 'AltRight') {
      simPause = false;
      resuming = true;
      hideSimCursor();
      blocker.style.display = 'none';
      blocker.style.cursor = '';
      document.body.style.cursor = 'none';
      tryLock(renderer.domElement);
      return;
    }

    if (e.code === 'KeyV' && !isAltMode()) toggleCamera();

    // Block game keys during ALT mode
    if (isAltMode()) return;

    // Number keys 1-5 select hotbar slots
    if ((pointerLocked || resuming) && e.code >= 'Digit1' && e.code <= 'Digit5') {
      selectSlot(parseInt(e.code.charAt(5)) - 1);
    }

    if (e.code === 'KeyE' && (pointerLocked || resuming)) {
      doInteract();
    }
  });

  document.addEventListener('keyup', (e) => {
    keys[e.code] = false;

    // ALT released — exit cursor mode
    if ((e.code === 'AltLeft' || e.code === 'AltRight') && isAltMode()) {
      exitAltMode();
    }
  });

  // Right-click zoom
  document.addEventListener('mousedown', (e) => {
    if (e.button === 2 && (pointerLocked || resuming)) rightMouseDown = true;
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 2) rightMouseDown = false;
    if (e.button === 0 && isAltMode()) cursorUp();
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // Left-click item action (or virtual cursor in ALT mode)
  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (simPause || (!pointerLocked && !resuming)) return;
    if (isAltMode()) { cursorDown(); return; }
    doUseItem();
  });

  // Mobile: tap blocker to resume from pause
  if (isTouchDevice) {
    blocker.addEventListener('touchstart', (e) => {
      if (blocker.dataset.mode !== 'game') return;
      if (e.target.closest('#menu-panel')) return;
      if (e.target.closest('#menu-loading')) return;
      e.preventDefault();
      setMobileGameActive(true);
      blocker.style.display = 'none';
    });
  }

  initTouch();
}
