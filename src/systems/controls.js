import { getRenderer } from '../core/scene.js';
import { getPlayerState, toggleCamera } from '../entities/player.js';
import { toggleNearestDoor, getNearestDoor } from '../world/doors.js';
import { talkToNearestSoldier } from '../systems/npcAI.js';

const keys = {};
let pointerLocked = false;
let rightMouseDown = false;

export function getKeys() { return keys; }
export function isPointerLocked() { return pointerLocked; }
export function isRightMouseDown() { return rightMouseDown; }

export function initControls() {
  const renderer = getRenderer();
  const blocker = document.getElementById('blocker');
  const player = getPlayerState();

  // When paused (ESC), clicking blocker re-enters game
  blocker.addEventListener('click', (e) => {
    if (blocker.dataset.mode !== 'game') return; // only works after entering game
    if (e.target.closest('#daynight-toggle')) return;
    if (e.target.closest('#menu-panel')) return;
    if (e.target.closest('#menu-loading')) return;
    renderer.domElement.requestPointerLock();
  });

  renderer.domElement.addEventListener('click', () => {
    if (!pointerLocked) renderer.domElement.requestPointerLock();
  });

  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === renderer.domElement;
    if (pointerLocked) {
      blocker.style.display = 'none';
    } else {
      blocker.style.display = 'flex';
      // If game was playing (not menu mode), show pause overlay
      if (blocker.dataset.mode === 'game') {
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
    if (e.code === 'KeyV') toggleCamera();
    if (e.code === 'KeyE' && pointerLocked) {
      if (getNearestDoor()) toggleNearestDoor();
      else talkToNearestSoldier();
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
