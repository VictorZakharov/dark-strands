import { getRenderer, getScene, getCamera } from '../core/scene.js';
import { getPlayerState, toggleCamera } from '../entities/player.js';
import { toggleNearestDoor, getNearestDoor } from '../world/doors.js';
import { talkToNearestSoldier } from '../systems/npcAI.js';
import { pickNearestFlower, getInventory, plantFlower, isPreviewValid, hideFlowerPreview } from '../world/flowers.js';
import { pickNearestRock } from '../world/vegetation.js';
import { selectSlot, getSelectedSlot, getSlotItem, isPlacementMode, setPlacementMode, isAltMode, enterAltMode, exitAltMode, moveCursor, cursorDown, cursorUp, addItemToSlot, clearItemSlot } from '../systems/hotbar.js';
import { spawnProjectile, isRockPreviewValid, placeRockAtPreview, pickNearestInFlightRock } from '../systems/projectiles.js';
import { pickNearestTorch, hideHeldTorch, isTorchPreviewValid, placeTorchAtPreview } from '../world/torches.js';
import { isTouchDevice, initTouch, setMobileGameActive, isMobileGameActive } from './touch.js';

const keys = {};
let pointerLocked = false;
let rightMouseDown = false;
let pendingLockEl = null;
let helpVisible = false;
let lastThrowTime = 0;
const THROW_COOLDOWN = 500;

export function getThrowCooldownFrac() {
  const elapsed = performance.now() - lastThrowTime;
  if (elapsed >= THROW_COOLDOWN) return 0;
  return 1 - elapsed / THROW_COOLDOWN;
}
let gameStarted = false;

// simPause = Tab pause — pointer lock stays active, virtual cursor shown
let simPause = false;
let simCursorEl = null;
let simCursorX = 0, simCursorY = 0;

// Timestamp-based mousemove ignore — skips junk deltas after lock/unlock transitions
let moveIgnoreUntil = 0;
function ignoreMovesFor(ms) { moveIgnoreUntil = performance.now() + ms; }

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
}

function hideSimCursor() {
  if (simCursorEl) simCursorEl.style.display = 'none';
}

function showPauseUI(blocker, hint) {
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
  if (pt) pt.textContent = 'Paused';
  const ph = document.getElementById('pause-hint');
  if (ph) ph.textContent = hint;
}

// Tab pause — pointer lock stays active, mouse fully trapped
function enterSimPause(blocker) {
  simPause = true;
  blocker.style.cursor = 'none';
  document.body.style.cursor = 'none';
  showPauseUI(blocker, 'Tab to resume · ESC to release cursor');
  showSimCursor();
}

// ESC during Tab-pause — pointer lock lost, game still paused, OS cursor visible
function enterPausedReleased(blocker) {
  // simPause stays true — game remains frozen
  hideSimCursor();
  blocker.style.cursor = '';
  document.body.style.cursor = '';
  showPauseUI(blocker, 'Click or press any key to resume');
}

function resumeFromPause(blocker) {
  simPause = false;
  hideSimCursor();
  blocker.style.display = 'none';
  blocker.style.cursor = '';
  document.body.style.cursor = '';
  if (!pointerLocked) {
    // Need to re-lock — game resumes fully once pointerlockchange fires
    ignoreMovesFor(150);
    tryLock(getRenderer().domElement);
  }
}

function toggleHelp() {
  const el = document.getElementById('help-overlay');
  if (!el) return;
  helpVisible = !helpVisible;
  el.style.display = helpVisible ? 'flex' : 'none';
  if (helpVisible) {
    document.exitPointerLock();
  } else {
    const renderer = getRenderer();
    pendingLockEl = renderer.domElement;
    tryLock(renderer.domElement);
  }
}

export function isHelpVisible() { return helpVisible; }

export function getKeys() { return keys; }
export function isPointerLocked() { return pointerLocked; }
export function isGameActive() { return (gameStarted && !simPause) || isMobileGameActive(); }
export function isRightMouseDown() { return rightMouseDown; }

export function doInteract() {
  const hintEl = document.getElementById('interact-hint');
  const source = hintEl ? hintEl.dataset.source : '';
  let handled = false;

  if (source === 'door') {
    toggleNearestDoor(); handled = true;
  } else if (source === 'soldier') {
    talkToNearestSoldier(); handled = true;
  } else if (source === 'flower') {
    if (pickNearestFlower()) { addItemToSlot('flower'); setPlacementMode(false); handled = true; }
  } else if (source === 'rock') {
    if (pickNearestRock(getInventory()) || pickNearestInFlightRock(getInventory())) { addItemToSlot('stone'); setPlacementMode(false); handled = true; }
  } else if (source === 'torch') {
    if (pickNearestTorch(getInventory())) { addItemToSlot('torch'); setPlacementMode(false); handled = true; }
  } else {
    if (getNearestDoor()) { toggleNearestDoor(); handled = true; }
    else if (talkToNearestSoldier()) { handled = true; }
    else if (pickNearestFlower()) { addItemToSlot('flower'); setPlacementMode(false); handled = true; }
    else if (pickNearestRock(getInventory()) || pickNearestInFlightRock(getInventory())) { addItemToSlot('stone'); setPlacementMode(false); handled = true; }
    else if (pickNearestTorch(getInventory())) { addItemToSlot('torch'); setPlacementMode(false); handled = true; }
  }

  // E toggles throw/place mode for stones when nothing to interact with
  if (!handled && getSlotItem(getSelectedSlot()) === 'stone' && getInventory().stones > 0) {
    setPlacementMode(!isPlacementMode());
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
    if (isPlacementMode()) {
      if (isRockPreviewValid()) {
        placeRockAtPreview(getScene());
        inv.stones--;
        if (inv.stones <= 0) { clearItemSlot('stone'); setPlacementMode(false); }
      }
    } else {
      if (performance.now() - lastThrowTime < THROW_COOLDOWN) return;
      spawnProjectile(getCamera(), getScene());
      lastThrowTime = performance.now();
      inv.stones--;
      if (inv.stones <= 0) clearItemSlot('stone');
    }
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

  // Clicking canvas requests pointer lock (for initial entry or re-lock after ESC)
  renderer.domElement.addEventListener('mousedown', () => {
    if (!pointerLocked && !simPause) {
      pendingLockEl = renderer.domElement;
      tryLock(renderer.domElement);
    }
  });

  // Click to resume from Tab-pause
  document.addEventListener('mousedown', (e) => {
    if (simPause) {
      e.stopImmediatePropagation();
      resumeFromPause(blocker);
      return;
    }
  });

  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === renderer.domElement;
    if (pointerLocked) {
      // Lock acquired — enter/resume game
      pendingLockEl = null;
      gameStarted = true;
      blocker.style.display = 'none';
      hideSimCursor();
      document.body.style.cursor = '';
      ignoreMovesFor(150);
    } else {
      if (isAltMode()) exitAltMode();
      hideFlowerPreview();
      hideHeldTorch();
      setPlacementMode(false);

      if (helpVisible) return;

      if (blocker.dataset.mode === 'game') {
        ignoreMovesFor(150);

        if (simPause) {
          // ESC during Tab-pause → show pause UI with OS cursor
          enterPausedReleased(blocker);
        }
        // else: ESC during gameplay → game keeps running, cursor free
      } else {
        blocker.style.display = 'flex';
      }
    }
  });

  document.addEventListener('mousemove', (e) => {
    // Skip junk deltas during lock/unlock transitions
    if (performance.now() < moveIgnoreUntil) return;

    // simPause — pointer lock active, drive virtual cursor with movementX/Y
    if (simPause && simCursorEl) {
      simCursorX = Math.max(0, Math.min(window.innerWidth, simCursorX + e.movementX));
      simCursorY = Math.max(0, Math.min(window.innerHeight, simCursorY + e.movementY));
      simCursorEl.style.left = simCursorX + 'px';
      simCursorEl.style.top = simCursorY + 'px';
    } else if (pointerLocked) {
      if (isAltMode()) {
        moveCursor(e.movementX, e.movementY);
        return;
      }
      player.yaw -= e.movementX * 0.002;
      player.pitch -= e.movementY * 0.002;
      player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch));
    }
  });

  document.addEventListener('keydown', (e) => {
    keys[e.code] = true;

    if (e.key === '?' && e.shiftKey) {
      toggleHelp();
      return;
    }

    if (e.code === 'Escape' && helpVisible) {
      e.preventDefault();
      helpVisible = false;
      const helpEl = document.getElementById('help-overlay');
      if (helpEl) helpEl.style.display = 'none';
      pendingLockEl = renderer.domElement;
      return;
    }

    // Tab or Pause key toggles pause (pointer lock stays active — mouse trapped)
    if (e.code === 'Tab' || e.code === 'Pause') {
      e.preventDefault();
      if (simPause) {
        resumeFromPause(blocker);
      } else if (pointerLocked) {
        enterSimPause(blocker);
      }
      return;
    }

    // ESC during Tab pause → release pointer lock for real
    // Keep simPause=true so pointerlockchange calls enterPausedReleased()
    if (e.code === 'Escape' && simPause) {
      hideSimCursor();
      ignoreMovesFor(150);
      document.exitPointerLock();
      return;
    }

    if ((e.code === 'AltLeft' || e.code === 'AltRight')) {
      e.preventDefault();
      if (!isAltMode() && pointerLocked && !simPause) enterAltMode();
      return;
    }

    // Any key during simPause (released state) → resume
    if (simPause && !pointerLocked && e.code !== 'Escape' && e.code !== 'AltLeft' && e.code !== 'AltRight') {
      resumeFromPause(blocker);
      return;
    }

    if (e.code === 'KeyV' && !isAltMode()) toggleCamera();

    if (isAltMode()) return;

    if (pointerLocked && e.code >= 'Digit1' && e.code <= 'Digit5') {
      selectSlot(parseInt(e.code.charAt(5)) - 1);
    }

    if (e.code === 'KeyE' && pointerLocked) {
      doInteract();
    }
  });

  document.addEventListener('keyup', (e) => {
    keys[e.code] = false;
    if ((e.code === 'AltLeft' || e.code === 'AltRight') && isAltMode()) {
      exitAltMode();
    }
  });

  document.addEventListener('mousedown', (e) => {
    if (e.button === 2 && pointerLocked && !simPause) rightMouseDown = true;
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 2) rightMouseDown = false;
    if (e.button === 0 && isAltMode()) cursorUp();
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (simPause || !pointerLocked) return;
    if (isAltMode()) { cursorDown(); return; }
    doUseItem();
  });

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
