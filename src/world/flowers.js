import * as THREE from 'three';
import { getPlayerState } from '../entities/player.js';
import { getCamera } from '../core/scene.js';
import { randomWalkablePos, isWalkable } from './grid.js';
import { getTerrainHeight } from './terrain.js';
import { isInsideBuilding } from './generator.js';
import { collidesWithRock } from './vegetation.js';
import { CFG } from '../config.js';

const flowers = [];
const PICK_DIST = 2.5;
const _projFlower = new THREE.Vector3();

const inventory = { flowers: 0, stones: 0, torches: 0 };

export function getInventory() { return inventory; }
export function getFlowers() { return flowers; }

export function registerFlower(model, wx, wz) {
  flowers.push({ model, wx, wz, active: true, respawnTimer: 0 });
}

// Flower template for planting clones
let flowerTemplate = null;
export function setFlowerTemplate(model) {
  flowerTemplate = model;
}

// Flower placement preview
let previewMesh = null;
let previewValid = false;

export function isPreviewValid() { return previewValid; }

export function initFlowerPreview(scene) {
  if (!flowerTemplate) return;
  previewMesh = flowerTemplate.clone();
  // Make all materials transparent with green tint
  previewMesh.traverse(c => {
    if (c.isMesh) {
      c.material = c.material.clone();
      c.material.transparent = true;
      c.material.opacity = 0.6;
      c.material.depthWrite = false;
      c.material.color.set(0x44ff44);
      c.castShadow = false;
      c.receiveShadow = false;
    }
  });
  previewMesh.visible = false;
  scene.add(previewMesh);
}

export function updateFlowerPreview(camera, active) {
  if (!previewMesh) return;
  if (!active || inventory.flowers <= 0) {
    previewMesh.visible = false;
    previewValid = false;
    return;
  }

  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();
  // Ray from camera position (matches crosshair in both 1st/3rd person)
  camera.getWorldPosition(origin);
  camera.getWorldDirection(dir);

  // Player position for distance checks
  const p = getPlayerState();
  const px = p.x, pz = p.z;

  // Looking up — no ground intersection
  if (dir.y >= -0.01) {
    previewMesh.visible = false;
    previewValid = false;
    return;
  }

  // Iterative ground plane intersection (handles terrain curvature)
  let groundY = 0;
  let hitX, hitZ, t;
  for (let i = 0; i < 3; i++) {
    t = (groundY - origin.y) / dir.y;
    if (t < 0.1 || t > 20) {
      previewMesh.visible = false;
      previewValid = false;
      return;
    }
    hitX = origin.x + dir.x * t;
    hitZ = origin.z + dir.z * t;
    groundY = getTerrainHeight(hitX, hitZ);
  }

  // Check distance from player (not camera) to placement point
  const dxp = hitX - px, dzp = hitZ - pz;
  const distPlayer = Math.sqrt(dxp * dxp + dzp * dzp);
  if (distPlayer > CFG.PLANT_MAX_DIST) {
    previewMesh.visible = false;
    previewValid = false;
    return;
  }

  // Validate placement
  const inside = isInsideBuilding(hitX, hitZ);
  const underwater = !CFG.SNOW_MODE && groundY < CFG.WATER_Y;
  const walkable = isWalkable(hitX, hitZ);
  const rockBlock = collidesWithRock(hitX, hitZ, 0.3);

  previewValid = !inside && !underwater && walkable && !rockBlock;

  // Tint green (valid) or red (invalid)
  const tint = previewValid ? 0x44ff44 : 0xff4444;
  previewMesh.traverse(c => {
    if (c.isMesh) c.material.color.set(tint);
  });

  previewMesh.position.set(hitX, groundY, hitZ);
  previewMesh.visible = true;
}

export function plantFlower(scene) {
  if (!previewValid || inventory.flowers <= 0 || !previewMesh || !previewMesh.visible) return false;

  const wx = previewMesh.position.x;
  const wz = previewMesh.position.z;
  const ty = getTerrainHeight(wx, wz);

  let mesh;
  if (flowerTemplate) {
    mesh = flowerTemplate.clone();
    mesh.traverse(c => { if (c.isMesh) c.frustumCulled = false; });
    mesh.position.set(wx, ty, wz);
    mesh.rotation.y = Math.random() * Math.PI * 2;
  } else {
    const geo = new THREE.ConeGeometry(0.15, 0.35, 6);
    const mat = new THREE.MeshStandardMaterial({ color: 0xff69b4 });
    mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(wx, ty + 0.15, wz);
  }
  mesh.castShadow = true;
  scene.add(mesh);
  registerFlower(mesh, wx, wz);

  inventory.flowers--;
  return true;
}

export function hideFlowerPreview() {
  if (previewMesh) {
    previewMesh.visible = false;
    previewValid = false;
  }
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

    let placed = false;
    for (let i = 0; i < 30; i++) {
      const pos = randomWalkablePos();
      if (!pos) continue;

      const dx = pos.x - p.x;
      const dz = pos.z - p.z;
      if (dx * dx + dz * dz < 40 * 40) continue;

      const ty = getTerrainHeight(pos.x, pos.z);
      _projFlower.set(pos.x, ty + 0.2, pos.z);
      _projFlower.project(camera);
      if (_projFlower.z < 1 && Math.abs(_projFlower.x) < 1.2 && Math.abs(_projFlower.y) < 1.2) continue;

      f.wx = pos.x;
      f.wz = pos.z;
      f.model.position.set(pos.x, ty, pos.z);
      f.model.visible = true;
      f.active = true;
      placed = true;
      break;
    }

    if (!placed) {
      f.respawnTimer = 1.0;
    }
  }
}

export function updateFlowerHint() {
  const el = document.getElementById('interact-hint');
  if (!el) return;

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
