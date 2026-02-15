import * as THREE from 'three';
import { getPlayerState } from '../entities/player.js';
import { getCamera } from '../core/scene.js';
import { randomWalkablePos } from './grid.js';
import { getTerrainHeight } from './terrain.js';

const flowers = [];
const PICK_DIST = 2.5;
const _projFlower = new THREE.Vector3();

const inventory = { flowers: 0 };

export function getInventory() { return inventory; }
export function getFlowers() { return flowers; }

export function registerFlower(model, wx, wz) {
  flowers.push({ model, wx, wz, active: true, respawnTimer: 0 });
}

export function getNearestFlower() {
  const p = getPlayerState();
  let best = null;
  let bestDist = PICK_DIST;

  for (const f of flowers) {
    if (!f.active) continue;
    const dx = p.x - f.wx;
    const dz = p.z - f.wz;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < bestDist) {
      bestDist = dist;
      best = f;
    }
  }
  return best;
}

export function pickNearestFlower() {
  const f = getNearestFlower();
  if (!f) return false;

  f.active = false;
  f.model.visible = false;
  f.respawnTimer = 15 + Math.random() * 15;
  inventory.flowers++;
  return true;
}

export function updateFlowers(dt, camera) {
  const p = getPlayerState();

  for (const f of flowers) {
    if (f.active) continue;
    f.respawnTimer -= dt;
    if (f.respawnTimer > 0) continue;

    // Find a new position far from player and outside camera view
    let placed = false;
    for (let i = 0; i < 30; i++) {
      const pos = randomWalkablePos();
      if (!pos) continue;

      // Must be far from player
      const dx = pos.x - p.x;
      const dz = pos.z - p.z;
      if (dx * dx + dz * dz < 40 * 40) continue;

      // Must not be in camera view
      const ty = getTerrainHeight(pos.x, pos.z);
      _projFlower.set(pos.x, ty + 0.2, pos.z);
      _projFlower.project(camera);
      if (_projFlower.z < 1 && Math.abs(_projFlower.x) < 1.2 && Math.abs(_projFlower.y) < 1.2) continue;

      // Good position — respawn here
      f.wx = pos.x;
      f.wz = pos.z;
      f.model.position.set(pos.x, ty, pos.z);
      f.model.visible = true;
      f.active = true;
      placed = true;
      break;
    }

    if (!placed) {
      f.respawnTimer = 1.0; // Retry in 1 second
    }
  }
}

export function updateFlowerHint() {
  const el = document.getElementById('interact-hint');
  if (!el) return;

  // Don't override door or soldier hints
  if (el.style.display === 'block' && (el.dataset.source === 'door' || el.dataset.source === 'soldier')) return;

  const flower = getNearestFlower();
  if (!flower) {
    if (el.dataset.source === 'flower') {
      el.style.display = 'none';
      el.dataset.source = '';
    }
    return;
  }

  const camera = getCamera();
  const ty = getTerrainHeight(flower.wx, flower.wz);
  _projFlower.set(flower.wx, ty + 0.3, flower.wz);
  _projFlower.project(camera);

  if (_projFlower.z > 1) {
    if (el.dataset.source === 'flower') el.style.display = 'none';
    return;
  }

  const hw = window.innerWidth / 2;
  const hh = window.innerHeight / 2;
  el.textContent = '[E] Pick';
  el.style.fontSize = '21px';
  el.style.left = (_projFlower.x * hw + hw) + 'px';
  el.style.top = (-_projFlower.y * hh + hh) + 'px';
  el.style.display = 'block';
  el.dataset.source = 'flower';
}
