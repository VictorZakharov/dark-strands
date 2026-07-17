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
import { getNearestBed } from '../world/furniture.js';
import { isCycleEnabled } from './daynight.js';
import { openSleepMenu, isSleepMenuActive } from './sleep.js';

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
const _lookHist = []; // (t, yaw, pitch) ring — unlock-jerk rewind buffer
let timeStopped = false; // Used for completely freezing game logic without showing the ESC-Pause UI
let simCursorEl = null;
let simCursorX = 0, simCursorY = 0;

export function setSimPause(p) { simPause = p; }
export function isSimPaused() { return simPause; }
/**
 * True whenever the world should freeze: Tab-pause, or ANY desktop state
 * where the pointer is free ("Click to resume" ESC overlay included — the
 * original spec kept the game running there, which just reads as broken
 * pause). Mobile has no pointer lock and uses its own active flag.
 */
export function isWorldFrozen() {
  // Debug/automation escape hatch — pointer lock can't be acquired without
  // a user gesture, which would freeze every automated test session
  if (typeof window !== 'undefined' && window._noFreeze) return false;
  if (simPause) return true;
  if (isMobileGameActive()) return false;
  return gameStarted && !pointerLocked;
}
export function isTimeStopped() { return timeStopped; }
export function setTimeStopped(s) { timeStopped = s; }

// Timestamp-based mousemove ignore — skips junk deltas after lock/unlock transitions
let moveIgnoreUntil = 0;
function ignoreMovesFor(ms) { moveIgnoreUntil = performance.now() + ms; }

// Silently swallow SecurityError when browser blocks pointer lock
function tryLock(el) {
  const p = el.requestPointerLock();
  if (p && p.catch) p.catch(() => { });
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

function setupHelpTabs(panel) {
  if (panel._tabsReady) return;
  panel._tabsReady = true;
  const tabs = panel.querySelectorAll('.help-tab');
  const contents = panel.querySelectorAll('.help-tab-content');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      contents.forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const target = panel.querySelector(`.help-tab-content[data-tab="${tab.dataset.tab}"]`);
      if (target) target.classList.add('active');
    });
  });
  // On mobile, default to touch tab
  const isMobile = 'ontouchstart' in window;
  if (isMobile) {
    const touchTab = panel.querySelector('.help-tab[data-tab="touch"]');
    if (touchTab) touchTab.click();
  }
}

function toggleHelp() {
  const el = document.getElementById('help-overlay');
  if (!el) return;
  helpVisible = !helpVisible;
  el.style.display = helpVisible ? 'flex' : 'none';
  if (helpVisible) {
    setupHelpTabs(el);
    document.exitPointerLock();
  } else {
    const renderer = getRenderer();
    pendingLockEl = renderer.domElement;
    tryLock(renderer.domElement);
  }
}

export function isHelpVisible() { return helpVisible; }

function clearKeys() {
  for (const k in keys) keys[k] = false;
}

export function getKeys() { return keys; }
export function isPointerLocked() { return pointerLocked; }
export function setGameStarted(v) { gameStarted = v; }
export function isGameActive() {
  if (simPause || timeStopped) return false;
  // Game keeps running even when pointer lock is lost (ESC frees cursor, game continues)
  return gameStarted || isMobileGameActive();
}
export function isRightMouseDown() { return rightMouseDown; }

export function doInteract() {
  const hintEl = document.getElementById('interact-hint');
  const source = (hintEl && hintEl.style.display !== 'none') ? hintEl.dataset.source : '';
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
  } else if (source === 'bed') {
    if (isCycleEnabled()) {
      openSleepMenu((hours) => {
        console.log(`[SLEEP] doInteract dispatching sleep-requested for ${hours} hours`);
        const ev = new CustomEvent('sleep-requested', { detail: { hours } });
        window.dispatchEvent(ev);
      });
      handled = true;
    }
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
      } else {
        // DEBUG: log failed torch placement attempt
        const p = getPlayerState();
        const cam = getCamera();
        console.log('[TORCH NO-HIT]', {
          player: { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) },
          cam: { x: +cam.globalPosition.x.toFixed(2), y: +cam.globalPosition.y.toFixed(2), z: +cam.globalPosition.z.toFixed(2) },
          dir: cam.getForwardRay(1).direction.toString(),
        });
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

  // Clicking anywhere re-locks pointer when game is running but cursor is free
  // Use both document-level and canvas-level handlers for maximum reliability.
  // Some browsers only allow requestPointerLock from gesture on the target element.
  function tryRelock() {
    if (gameStarted && !pointerLocked && !simPause && !helpVisible && !isSleepMenuActive()) {
      ignoreMovesFor(150);
      tryLock(renderer.domElement);
    }
  }
  document.addEventListener('mousedown', tryRelock);
  renderer.domElement.addEventListener('click', tryRelock);

  // Click to resume from Tab-pause
  document.addEventListener('mousedown', (e) => {
    if (simPause && !isSleepMenuActive()) {
      e.stopImmediatePropagation();
      resumeFromPause(blocker);
      return;
    }
  });

  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === renderer.domElement;
    if (!pointerLocked) {
      // Native ESC unlock: Chrome exits the lock itself (often without even
      // delivering an ESC keydown) and sprays junk mouse deltas before this
      // event fires — no pre-filter can reliably catch them. Instead, REWIND
      // the camera to where it was 150ms before the unlock; any legit look
      // input inside that window is imperceptible.
      const cutoff = performance.now() - 150;
      for (let i = 0; i < _lookHist.length; i++) {
        if (_lookHist[i].t >= cutoff) {
          player.yaw = _lookHist[i].yaw;
          player.pitch = _lookHist[i].pitch;
          break;
        }
      }
      _lookHist.length = 0;
    }
    if (pointerLocked) {
      // Lock acquired — enter/resume game
      pendingLockEl = null;
      gameStarted = true;
      blocker.style.display = 'none';
      hideSimCursor();
      document.body.style.cursor = '';
      ignoreMovesFor(150);
    } else {
      clearKeys();
      if (isAltMode()) exitAltMode();
      hideFlowerPreview();
      hideHeldTorch();
      setPlacementMode(false);

      if (helpVisible) return;

      if (blocker.dataset.mode === 'game') {
        ignoreMovesFor(150);

        if (isSleepMenuActive()) {
          // Sleep menu opened — don't show any overlay, let the sleep UI handle it
        } else if (simPause) {
          // ESC during Tab-pause → show pause UI with OS cursor
          enterPausedReleased(blocker);
        } else {
          // ESC during gameplay → show click-to-resume overlay
          blocker.style.display = 'flex';
          blocker.style.background = 'rgba(0, 0, 0, 0.25)';
          const panel = document.getElementById('menu-panel');
          const loading = document.getElementById('menu-loading');
          const keysEl = document.getElementById('menu-keys');
          const pause = document.getElementById('menu-pause');
          if (panel) panel.style.display = 'none';
          if (loading) loading.style.display = 'none';
          if (keysEl) keysEl.style.display = 'none';
          if (pause) pause.style.display = 'flex';
          const pt = document.getElementById('pause-text');
          if (pt) pt.textContent = '';
          const ph = document.getElementById('pause-hint');
          if (ph) ph.textContent = 'Click to resume';
        }
      } else {
        blocker.style.display = 'flex';
      }
    }
  });

  document.addEventListener('mousemove', (e) => {
    // Skip junk deltas during lock/unlock transitions
    if (performance.now() < moveIgnoreUntil) return;
    // Pointer-lock EXIT can deliver junk deltas BEFORE the pointerlockchange
    // event fires — a single huge one (discarded here) and/or several
    // moderate ones (suppressed by arming the ignore window on the ESC/Tab
    // KEYDOWN itself, below). Both paths are needed: the keydown arm alone
    // misses OS-initiated unlocks, the size filter alone misses medium spikes.
    if (Math.abs(e.movementX) > 200 || Math.abs(e.movementY) > 200) return;

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
      // History for the unlock rewind (see pointerlockchange): record BEFORE
      // applying this event's delta
      _lookHist.push({ t: performance.now(), yaw: player.yaw, pitch: player.pitch });
      if (_lookHist.length > 32) _lookHist.shift();
      player.yaw -= e.movementX * 0.002;
      player.pitch -= e.movementY * 0.002;
      player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch));
    }
  });

  document.addEventListener('keydown', (e) => {
    keys[e.code] = true;

    // Arm the mousemove ignore window the instant a pause/unlock key goes
    // down — pointer-lock exit junk deltas arrive BEFORE pointerlockchange,
    // so arming only in that handler is too late (camera jerked on pause)
    if (e.code === 'Escape' || e.code === 'Tab' || e.code === 'Pause') {
      ignoreMovesFor(300);
    }

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

  // Clear stuck keys when window loses focus (Alt+Tab, taskbar click, etc.)
  window.addEventListener('blur', clearKeys);

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
